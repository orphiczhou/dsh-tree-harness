/**
 * flash 审计 #19 验收：leaf:add 输入字段白名单（fail-closed）。
 *  - runtime/verification 等内部字段注入 → E_SCHEMA_INVALID（message 含非法键名与允许清单）；
 *  - 未知字段 foo → 拒；白名单外键不落账（leaf 不创建）；
 *  - 合法 payload（含 brief/dod/model/channel/taskType/dependencies/relay）仍成功且返回形状不变；
 *  - 攻击路径回归：注入被拒后正常建点 + 派发不回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, LEAF_ADD_ALLOWED_FIELDS } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const TREE = 'lwlst'
const ROOT = '11111111-1111-4111-8111-111111111111'

async function seeded({ ports } = {}) {
  const store = memoryStore()
  const engine = createEngine({ store, clock: new VirtualClock(1_700_000_000_000), config: { node_budget: 20 }, ports })
  await engine.call('init', [TREE, { goal: 'g' }, { dod: 'd' }, ROOT])
  return { store, engine }
}
const base = (leafId, extra = {}) => ({ leaf_id: leafId, session_id: null, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: ROOT, ...extra })

test('白名单快照：13 字段闭集（防实现与文档漂移）', () => {
  assert.deepEqual([...LEAF_ADD_ALLOWED_FIELDS].sort(), ['added_by', 'brief', 'channel', 'dependencies', 'dod', 'leaf_id', 'model', 'parent', 'path', 'relay', 'role', 'session_id', 'taskType'].sort())
})

test('runtime:{state:"succeeded"} 注入 → E_SCHEMA_INVALID，message 含 runtime 与允许清单', async () => {
  const { engine } = await seeded()
  const r = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { runtime: { state: 'succeeded' } })], ROOT)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.ok(r.error.message.includes('runtime'), r.error.message)
  assert.ok(r.error.message.includes('allowed'), r.error.message)
})

test('verification:{pass:true} 注入 → E_SCHEMA_INVALID，message 含 verification', async () => {
  const { engine } = await seeded()
  const r = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { verification: { pass: true } })], ROOT)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.ok(r.error.message.includes('verification'), r.error.message)
})

test('未知字段 foo → E_SCHEMA_INVALID，message 含 foo；白名单外键不落账（leaf 不创建）', async () => {
  const { engine } = await seeded()
  const r = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { foo: 'bar' })], ROOT)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.ok(r.error.message.includes('foo'), r.error.message)
  assert.ok(r.error.message.includes('allowed'), r.error.message)
  const g = await engine.call('leaf:get', [TREE, 'lwlst-C1-worker'])
  assert.equal(g.error.code, 'E_LEAF_NOT_FOUND', '被拒的 add 不得创建 leaf')
})

test('合法 payload（含 brief/dod/model/channel/taskType/dependencies/relay）仍成功，内部字段由引擎初始化', async () => {
  const { engine } = await seeded()
  const dep = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { taskType: 'research' })], ROOT)
  assert.equal(dep.ok, true, JSON.stringify(dep.error))
  const r = await engine.call('leaf:add', [TREE, {
    leaf_id: 'lwlst-C2-worker', session_id: null, parent: `${TREE}-root`, path: 'C2', role: 'worker', added_by: ROOT,
    brief: '任务书摘要', dod: { pass: '验证通过' }, model: 'test-model', channel: 'test-provider',
    taskType: 'code-change', dependencies: ['lwlst-C1-worker'], relay: 'off',
  }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leaf = r.leaf
  assert.equal(leaf.brief, '任务书摘要')
  assert.deepEqual(leaf.dod, { pass: '验证通过' })
  assert.equal(leaf.model, 'test-model')
  assert.equal(leaf.channel, 'test-provider')
  assert.equal(leaf.taskType, 'code-change')
  assert.deepEqual(leaf.dependencies, ['lwlst-C1-worker'])
  assert.equal(leaf.relay, 'off')
  // 内部字段引擎初始化，永不接受调用方输入
  assert.equal(leaf.status, 'pending_brief')
  assert.deepEqual(leaf.events, [])
  assert.deepEqual(leaf.milestones, [])
  assert.deepEqual(leaf.segment_chain, [])
  assert.deepEqual(leaf.drift_history, [])
  assert.equal(leaf.context_usage_pct, 0)
  assert.equal(leaf.nudge_count, 0)
  assert.equal(leaf.runtime, undefined)
  assert.ok(leaf.created_at)
})

test('攻击路径回归：注入 runtime+verification 被拒后，正常建点 + 正常派发不回归', async () => {
  let n = 0
  const { engine } = await seeded({ ports: { dispatch: async () => ({ sessionId: `sess-wl-${++n}` }) } })
  const bad = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { runtime: { state: 'succeeded' }, verification: { pass: true } })], ROOT)
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'E_SCHEMA_INVALID')
  assert.ok(bad.error.message.includes('runtime') && bad.error.message.includes('verification'), bad.error.message)
  const good = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker')], ROOT)
  assert.equal(good.ok, true, JSON.stringify(good.error))
  assert.equal(good.leaf.status, 'pending_brief')   // 注入未生效：初始 pending_brief，非 succeeded
  const d = await engine.call('dispatch:start', [TREE, 'lwlst-C1-worker', { prompt: 'p' }], ROOT)
  assert.equal(d.ok, true, JSON.stringify(d.error))
  assert.equal(d.node.state, 'running')
  const leaf = (await engine.call('leaf:get', [TREE, 'lwlst-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'running')
  assert.equal(leaf.verification, undefined)        // 注入未生效：verification 仍由引擎初始化为缺省
})

// ── R1 复核修复回归（2026-11-13）────────────────────────────────────────────

test('R1-P1：既存 leaf_id re-add → E_DUPLICATE_LEAF，archived 终态/事件/drift 不被擦除', async () => {
  const { engine } = await seeded()
  const add = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker')], ROOT)
  assert.equal(add.ok, true, JSON.stringify(add.error))
  // 造出带终态 + 事件的节点（archived 不可逆语义）
  await engine.call('event:append', [TREE, 'lwlst-C1-worker', 'progress', { note: 'before-archive' }], ROOT)
  await engine.call('leaf:set-status', [TREE, 'lwlst-C1-worker', 'archived'], ROOT)
  const before = (await engine.call('leaf:get', [TREE, 'lwlst-C1-worker'])).leaf
  assert.equal(before.status, 'archived')
  assert.ok(before.events.length >= 1)

  // re-add 同名（旧实现直接覆盖 → 可擦除终态/事件/drift、重置 nudge_count）
  const readd = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker')], ROOT)
  assert.equal(readd.ok, false, '既存 leaf_id 必须拒 re-add')
  assert.equal(readd.error.code, 'E_DUPLICATE_LEAF')
  assert.ok(readd.error.message.includes('already exists'), readd.error.message)

  const after = (await engine.call('leaf:get', [TREE, 'lwlst-C1-worker'])).leaf
  assert.equal(after.status, 'archived', 'archived 终态不得被 re-add 擦除')
  assert.deepEqual(after.events, before.events, 'done/progress 事件不得被清空')
  assert.deepEqual(after.drift_history, before.drift_history)
  assert.equal(after.nudge_count, before.nudge_count)

  // 节点复用走 dispatch / set-session：re-dispatch 现有 leaf 仍可行
  const d = await engine.call('dispatch:start', [TREE, 'lwlst-C1-worker', { prompt: 'p' }], ROOT)
  assert.equal(d.ok, false, 'archived 节点不应可再派发（状态机外）')
})

test('R1-P2：model/channel 非字符串 → E_SCHEMA_INVALID（防形状污染流入 relay assignee）', async () => {
  const { engine } = await seeded()
  const badModel = await engine.call('leaf:add', [TREE, base('lwlst-C1-worker', { model: { nested: 'obj' } })], ROOT)
  assert.equal(badModel.ok, false)
  assert.equal(badModel.error.code, 'E_SCHEMA_INVALID')
  assert.ok(badModel.error.message.includes('model'), badModel.error.message)
  const badChannel = await engine.call('leaf:add', [TREE, base('lwlst-C2-worker', { path: 'C2', channel: ['arr'] })], ROOT)
  assert.equal(badChannel.ok, false)
  assert.equal(badChannel.error.code, 'E_SCHEMA_INVALID')
  assert.ok(badChannel.error.message.includes('channel'), badChannel.error.message)
  // 合法字符串仍通过
  const ok = await engine.call('leaf:add', [TREE, base('lwlst-C3-worker', { path: 'C3', model: 'test-model', channel: 'test-provider' })], ROOT)
  assert.equal(ok.ok, true, JSON.stringify(ok.error))
})
