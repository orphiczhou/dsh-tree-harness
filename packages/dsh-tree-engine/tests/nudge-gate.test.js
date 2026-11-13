/**
 * flash 审计 #7 验收：nudgeAppend 强制 prune 必须走状态机闭集（assertTransition）。
 *  - archived（不可逆语义）：第 7 次 nudge 被拒 E_STATUS_TRANSITION_INVALID，不写状态、不落 drift、nudge_count 不持久化增加；
 *  - done：第 7 次按白名单 done→pruned 成功，drift_history 留 high/rhythm/prune 痕；
 *  - active/pending_brief 不回归（<7 不 prune）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const TREE = 'ndggt'
const LEAF = 'ndggt-C1-worker'
const ROOT = '11111111-1111-4111-8111-111111111111'

async function seeded() {
  const store = memoryStore()
  const engine = createEngine({ store, clock: new VirtualClock(1_700_000_000_000) })
  await engine.call('init', [TREE, { goal: 'g' }, { dod: 'd' }, ROOT])
  const add = await engine.call('leaf:add', [TREE, { leaf_id: LEAF, session_id: null, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  assert.equal(add.ok, true, JSON.stringify(add.error))
  return { store, engine }
}
const nudge = (engine) => engine.call('nudge:append', [TREE, LEAF])
const leafOf = async (engine) => (await engine.call('leaf:get', [TREE, LEAF])).leaf

test('archived 叶子：前 6 次 nudge OK 不 prune；第 7 次 E_STATUS_TRANSITION_INVALID 且不落账', async () => {
  const { engine } = await seeded()
  await engine.call('leaf:set-status', [TREE, LEAF, 'archived'], ROOT)
  for (let i = 0; i < 6; i++) {
    const r = await nudge(engine)
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.leaf.forced_prune, false)
    assert.equal(r.leaf.nudge_count, i + 1)
  }
  let leaf = await leafOf(engine)
  assert.equal(leaf.status, 'archived')
  assert.equal(leaf.nudge_count, 6)
  const r7 = await nudge(engine)
  assert.equal(r7.ok, false)
  assert.equal(r7.error.code, 'E_STATUS_TRANSITION_INVALID')
  leaf = await leafOf(engine)
  assert.equal(leaf.status, 'archived', 'archived 语义不可逆：状态不得被强制 prune 改写')
  assert.equal(leaf.nudge_count, 6, '抛错在 write 前：nudge_count 不得持久化增加')
  assert.equal(leaf.drift_history.filter((d) => d.action === 'prune').length, 0, '非法迁移不得落 prune drift')
})

test('done 叶子：第 7 次 nudge 按白名单转 pruned，drift_history 有 high/rhythm/prune 留痕', async () => {
  const { store, engine } = await seeded()
  // 直改构造 done（set-status done 需 done 事件 + milestones 双闸；store 直改对齐 engine.test.js 洁净室 B5 手法）
  const st = await store.read(TREE)
  st.leaves[LEAF].status = 'done'
  await store.write(TREE, st)
  for (let i = 0; i < 6; i++) {
    const r = await nudge(engine)
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.leaf.forced_prune, false)
  }
  const r7 = await nudge(engine)
  assert.equal(r7.ok, true, JSON.stringify(r7.error))
  assert.equal(r7.leaf.forced_prune, true)
  const leaf = await leafOf(engine)
  assert.equal(leaf.status, 'pruned')
  assert.equal(leaf.nudge_count, 7)
  const pruneDrift = leaf.drift_history.filter((d) => d.action === 'prune')
  assert.equal(pruneDrift.length, 1)
  assert.equal(pruneDrift[0].severity, 'high')
  assert.equal(pruneDrift[0].kind, 'rhythm')
})

test('active 叶子不回归：<7 次 nudge 不 prune，计数照常', async () => {
  const { engine } = await seeded()
  await engine.call('leaf:set-status', [TREE, LEAF, 'active'], ROOT)
  for (let i = 0; i < 5; i++) {
    const r = await nudge(engine)
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.leaf.forced_prune, false)
    assert.equal(r.leaf.nudge_count, i + 1)
  }
  const leaf = await leafOf(engine)
  assert.equal(leaf.status, 'active')
  assert.equal(leaf.drift_history.filter((d) => d.action === 'prune').length, 0)
})

test('pending_brief 叶子不回归：第 7 次照常 prune（pending_brief→pruned 合法），8 次后幂等', async () => {
  const { engine } = await seeded()
  for (let i = 0; i < 6; i++) await nudge(engine)
  const r7 = await nudge(engine)
  assert.equal(r7.ok, true, JSON.stringify(r7.error))
  assert.equal(r7.leaf.forced_prune, true)
  assert.equal((await leafOf(engine)).status, 'pruned')
  const r8 = await nudge(engine)   // pruned→pruned 幂等（原 7-strike 语义不回退）
  assert.equal(r8.ok, true, JSON.stringify(r8.error))
  assert.equal(r8.leaf.nudge_count, 8)
})

// ── R1 复核修复回归（2026-11-13）────────────────────────────────────────────

const ROOT_LEAF = `${TREE}-root`
const STRANGER = '22222222-2222-4222-8222-222222222222'

test('R1-P2：root 叶子 nudge → E_SCHEMA_INVALID（信任锚不得被 7-strike 摘除）', async () => {
  const { engine } = await seeded()
  const r = await engine.call('nudge:append', [TREE, ROOT_LEAF])
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.ok(r.error.message.includes('root'), r.error.message)
  const root = (await engine.call('leaf:get', [TREE, ROOT_LEAF])).leaf
  assert.equal(root.nudge_count, 0, 'root nudge_count 不得增加')
  assert.notEqual(root.status, 'pruned')
})

test('R1-P2：nudge:reset 鉴权——陌生人拒（#7 显式旁路封口），creator/root 放行', async () => {
  const { engine } = await seeded()
  // 先累计 3 次（active 不 prune）
  await engine.call('leaf:set-status', [TREE, LEAF, 'active'], ROOT)
  for (let i = 0; i < 3; i++) await nudge(engine)
  // 陌生人 reset → 拒
  const denied = await engine.call('nudge:reset', [TREE, LEAF], STRANGER)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'E_BORROWED_IDENTITY')
  assert.equal((await leafOf(engine)).nudge_count, 3, '拒绝后计数不变')
  // creator/root（本 fixture added_by=ROOT）reset → 放行
  const reset = await engine.call('nudge:reset', [TREE, LEAF], ROOT)
  assert.equal(reset.ok, true, JSON.stringify(reset.error))
  assert.equal((await leafOf(engine)).nudge_count, 0)
})
