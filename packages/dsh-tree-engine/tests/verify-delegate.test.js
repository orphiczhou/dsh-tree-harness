/**
 * A4：验证授权委托（tree:verify-delegate）单测。
 *
 * 背景（D22 实测缺口）：现场建树模式（flow 节点一次性会话 tree_plan 建树后 dispose）下
 * root/creator 消失，事后 tree_verify 补验证被 E_BORROWED_IDENTITY 拒绝。
 * 方案：root 会话可在结束前把「补验证」写权授予受信会话（tree 级 verify_delegates，全量替换）。
 * 最小授权面：被授权者仅能写 leaf.verification（LEAF_WRITE_MATRIX.verification.delegate=true），
 * event/status/context/relay/set-session/cancel 等其余 kind 一律不放行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { assertLeafWriter } from '../src/guards.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'        // commander：worker 的 creator（added_by）
const OWNER = '33333333-3333-4333-8333-333333333333'      // worker 的 owner（leaf.session_id）
const STRANGER = '44444444-4444-4444-8444-444444444444'   // 未被授权的路人
const X = '66666666-6666-4666-8666-666666666666'          // 被授权者 X
const Y = '77777777-7777-4777-8777-777777777777'          // 后续替换的被授权者 Y

const TREE = 'vdel'
const TREE2 = 'vdel2'
const WORKER = 'vdel-C2a-worker'
const COMMANDER = 'vdel-C2-commander'

/** 树形：root(ROOT) → commander(CMD, added_by=ROOT) → worker(OWNER, added_by=CMD)。 */
async function seeded(treeId = TREE) {
  const store = memoryStore()
  const clock = new VirtualClock(1_700_000_000_000)
  const engine = createEngine({ store, clock, config: { max_sessions: 20, node_budget: 20 } })
  await engine.call('init', [treeId, { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', [treeId, { leaf_id: COMMANDER, session_id: CMD, parent: `${treeId}-root`, path: 'C2', role: 'commander', added_by: ROOT }], ROOT)
  await engine.call('leaf:add', [treeId, { leaf_id: WORKER, session_id: OWNER, parent: COMMANDER, path: 'C2a', role: 'worker', added_by: CMD }], CMD)
  return { engine, store, clock }
}

const VERDICT = { policyId: 'self-report', pass: true, verdicts: [{ mode: 'self-report', pass: true }] }

/** 断言 E_BORROWED_IDENTITY。 */
function expectBorrowed(r, code = 'E_BORROWED_IDENTITY', fragment) {
  assert.equal(r.ok, false, `expected rejection, got ${JSON.stringify(r).slice(0, 300)}`)
  assert.equal(r.error.code, code, JSON.stringify(r.error))
  if (fragment) assert.ok(r.error.message.includes(fragment), `message must contain "${fragment}": ${r.error.message}`)
}

// ── 1. 授权 happy path：root 授权 X → X 可写 leaf.verification；返回 {tree_id, verify_delegates} ──
test('root 授权 X → X 可写 leaf.verification；返回归一化列表；新树自带 verify_delegates:[]', async () => {
  const { engine } = await seeded()
  const dump = await engine.call('treeDump', [TREE])
  assert.deepEqual(dump.tree.verify_delegates, [], 'tree_init must seed verify_delegates: []')
  const r = await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.tree_id, TREE)
  assert.deepEqual(r.verify_delegates, [X])
  // 被授权者写 verification 成功（写 leaf.verification 落账）
  const v = await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X)
  assert.equal(v.ok, true, JSON.stringify(v.error))
  assert.equal(v.leaf.verification.pass, true)
  assert.equal((await engine.call('leaf:get', [TREE, WORKER])).leaf.verification.pass, true)
})

// ── 1b. session- 前缀归一化：授权 'session-<uuid>' → 存裸 UUID；带前缀 caller 也可写 ──
test('归一化：授权带 session- 前缀 → 存裸 UUID；带前缀 caller 可写 verification', async () => {
  const { engine } = await seeded()
  const r = await engine.call('tree:verify-delegate', [TREE, [`session-${X}`]], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.deepEqual(r.verify_delegates, [X])
  const v = await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], `session-${X}`)
  assert.equal(v.ok, true, JSON.stringify(v.error))
})

// ── 2. 未授权会话 Y 写 verification → E_BORROWED_IDENTITY ──
test('未授权会话写 verification → E_BORROWED_IDENTITY', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], STRANGER), 'E_BORROWED_IDENTITY', 'verification')
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], Y), 'E_BORROWED_IDENTITY', 'verification')
  // 缺失 caller 也 fail-closed
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT]), 'E_BORROWED_IDENTITY', 'verification')
})

// ── 3. 非 root 会话尝试授权 → E_BORROWED_IDENTITY（message 含 delegated/root 说明）──
test('非 root 尝试授权 → E_BORROWED_IDENTITY，message 含 root/delegated 说明', async () => {
  const { engine } = await seeded()
  for (const bad of [CMD, OWNER, STRANGER, X, undefined]) {
    const r = await engine.call('tree:verify-delegate', [TREE, [X]], bad)
    expectBorrowed(r, 'E_BORROWED_IDENTITY')
    assert.ok(/root/i.test(r.error.message), `message must mention root: ${r.error.message}`)
    assert.ok(/delegat/i.test(r.error.message), `message must mention delegated: ${r.error.message}`)
  }
  // 拒绝后委托列表未被污染
  assert.deepEqual((await engine.call('treeDump', [TREE])).tree.verify_delegates, [])
})

// ── 4. 最小授权面：被授权者 X 写 event/status/context/relay → 仍拒 ──
test('最小授权面：被授权者只能写 verification，event/status/context/relay 仍拒', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'progress', { m: 1 }], X), 'E_BORROWED_IDENTITY', 'event:progress')
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'done', {}], X), 'E_BORROWED_IDENTITY', 'event:done')
  expectBorrowed(await engine.call('leaf:set-status', [TREE, WORKER, 'active'], X), 'E_BORROWED_IDENTITY', 'status')
  expectBorrowed(await engine.call('leaf:set-context', [TREE, WORKER, 10], X), 'E_BORROWED_IDENTITY', 'context')
  expectBorrowed(await engine.call('leaf:set-relay', [TREE, WORKER, 'off'], X), 'E_BORROWED_IDENTITY', 'relay')
  expectBorrowed(await engine.call('leaf:set-session', [TREE, WORKER, Y], X), 'E_BORROWED_IDENTITY', 'set-session')
  // verification 仍可写（委托面仅此一项）
  const v = await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X)
  assert.equal(v.ok, true, JSON.stringify(v.error))
})

// ── 5. 清空（[]）后 X 再写 verification → 拒 ──
test('清空委托（[]）后 X 失权；返回 verify_delegates=[]', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  const clear = await engine.call('tree:verify-delegate', [TREE, []], ROOT)
  assert.equal(clear.ok, true, JSON.stringify(clear.error))
  assert.deepEqual(clear.verify_delegates, [])
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X), 'E_BORROWED_IDENTITY', 'verification')
})

// ── 6. 非法 UUID（非 v4 / 全 0 / 带前缀非 v4）→ E_INVALID_UUID_STRICT；非数组/非字符串 → E_SCHEMA_INVALID ──
test('非法入参：非 v4 / 全 0 → E_INVALID_UUID_STRICT；非数组/非字符串条目 → E_SCHEMA_INVALID', async () => {
  const { engine } = await seeded()
  const bad = [
    '12345678-1234-1234-1234-123456789012',               // version nibble ≠ 4
    '00000000-0000-0000-0000-000000000000',               // 全 0
    'ffffffff-ffff-ffff-ffff-ffffffffffff',                // 全 f
    'session-12345678-1234-1234-1234-123456789012',       // 归一化后仍非 v4
  ]
  for (const id of bad) {
    const r = await engine.call('tree:verify-delegate', [TREE, [id]], ROOT)
    expectBorrowed(r, 'E_INVALID_UUID_STRICT')
  }
  // 数组里混入非法条目：整批拒绝，委托不被部分写入
  const mixed = await engine.call('tree:verify-delegate', [TREE, [X, 'not-a-uuid']], ROOT)
  expectBorrowed(mixed, 'E_INVALID_UUID_STRICT')
  assert.deepEqual((await engine.call('treeDump', [TREE])).tree.verify_delegates, [])
  // 非数组 / 非字符串条目 / 空字符串
  expectBorrowed(await engine.call('tree:verify-delegate', [TREE, X], ROOT), 'E_SCHEMA_INVALID')
  expectBorrowed(await engine.call('tree:verify-delegate', [TREE, undefined], ROOT), 'E_SCHEMA_INVALID')
  expectBorrowed(await engine.call('tree:verify-delegate', [TREE, [42]], ROOT), 'E_SCHEMA_INVALID')
  expectBorrowed(await engine.call('tree:verify-delegate', [TREE, ['']], ROOT), 'E_SCHEMA_INVALID')
})

// ── 7. 旧树无 verify_delegates 字段：读路径正常、默认无人被授权；root 授权可惰性补写 ──
test('旧树无 verify_delegates：读路径正常、默认无人被授权、授权时惰性补写', async () => {
  const { engine, store } = await seeded()
  // 手工模拟旧树：删掉该字段
  const oldState = await store.read(TREE)
  delete oldState.verify_delegates
  await store.write(TREE, oldState)
  // 读路径正常（treeDump/drift:list 不因缺字段报错）
  const dump = await engine.call('treeDump', [TREE])
  assert.equal(dump.ok, true, JSON.stringify(dump.error))
  assert.equal(dump.tree.verify_delegates, undefined)
  assert.equal((await engine.call('drift:list', [TREE])).ok, true)
  // 默认无人被授权：X 写 verification → 拒；creator/root 照常放行
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X), 'E_BORROWED_IDENTITY', 'verification')
  assert.equal((await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], CMD)).ok, true)
  assert.equal((await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], ROOT)).ok, true)
  // root 授权 → 惰性补写字段（不要求迁移）
  const r = await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.deepEqual((await engine.call('treeDump', [TREE])).tree.verify_delegates, [X])
  assert.equal((await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X)).ok, true)
})

// ── 8. 审计留痕：授权后 drift:list 含 kind:'security' 记录（action=declare、leaf_id=null、reason 含授予对象与调用者）──
test('审计留痕：授权后 drift:list 含 kind=security 记录', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X, Y]], ROOT)
  const { drifts } = await engine.call('drift:list', [TREE])
  const sec = drifts.filter((d) => d.kind === 'security')
  assert.equal(sec.length, 1, JSON.stringify(drifts))
  assert.equal(sec[0].action, 'declare')
  assert.equal(sec[0].leaf_id, null)
  assert.ok(sec[0].reason.includes(X), `reason must name granted ${X}: ${sec[0].reason}`)
  assert.ok(sec[0].reason.includes(Y), `reason must name granted ${Y}: ${sec[0].reason}`)
  assert.ok(sec[0].reason.includes(ROOT), `reason must name caller ${ROOT}: ${sec[0].reason}`)
  // 清空也留痕（可仍留一条审计记录）
  await engine.call('tree:verify-delegate', [TREE, []], ROOT)
  const sec2 = (await engine.call('drift:list', [TREE])).drifts.filter((d) => d.kind === 'security')
  assert.equal(sec2.length, 2)
})

// ── 9. owner 不得自验（除非它同时是 creator/root/delegate）──
test('owner 自验禁令不放宽：owner 非 creator/root/delegate 时写 verification 仍拒', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  // OWNER 不在委托列表 → 仍拒（delegate 轴不覆盖 owner 自验禁令）
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], OWNER), 'E_BORROWED_IDENTITY', 'verification')
  // root 显式把 owner 会话加入委托 → 经 delegate 轴放行（「除非它同时是 delegate」分支）
  await engine.call('tree:verify-delegate', [TREE, [X, OWNER]], ROOT)
  assert.equal((await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], OWNER)).ok, true)
})

// ── 10. 全量替换语义（不是追加）：先 [X] 再 [Y] → X 失权、Y 得权 ──
test('全量替换：二次授权 [Y] 后 X 失权、Y 得权（不追加）', async () => {
  const { engine } = await seeded()
  await engine.call('tree:verify-delegate', [TREE, [X]], ROOT)
  const r = await engine.call('tree:verify-delegate', [TREE, [Y]], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.deepEqual(r.verify_delegates, [Y])
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], X), 'E_BORROWED_IDENTITY', 'verification')
  assert.equal((await engine.call('leaf:set-verification', [TREE, WORKER, VERDICT], Y)).ok, true)
})

// ── 11. 幂等：相同列表重复调用不报错 ──
test('幂等：相同列表重复调用不报错（仍留审计记录）', async () => {
  const { engine } = await seeded()
  const a = await engine.call('tree:verify-delegate', [TREE, [X, Y]], ROOT)
  const b = await engine.call('tree:verify-delegate', [TREE, [X, Y]], ROOT)
  assert.equal(a.ok, true, JSON.stringify(a.error))
  assert.equal(b.ok, true, JSON.stringify(b.error))
  assert.deepEqual(b.verify_delegates, [X, Y])
  const sec = (await engine.call('drift:list', [TREE])).drifts.filter((d) => d.kind === 'security')
  assert.equal(sec.length, 2)
})

// ── 12. root 会话为 null 的树 → 拒绝并说明 ──
test('root 会话为 null 的树：verify-delegate 拒绝并说明（E_BORROWED_IDENTITY）', async () => {
  const store = memoryStore()
  const engine = createEngine({ store, clock: new VirtualClock(1_700_000_000_000), config: { max_sessions: 20, node_budget: 20 } })
  const r0 = await engine.call('init', [TREE2, { goal: 'g' }, { dod: 'd' }, null])
  assert.equal(r0.ok, true, JSON.stringify(r0.error))
  const r = await engine.call('tree:verify-delegate', [TREE2, [X]], X)
  expectBorrowed(r, 'E_BORROWED_IDENTITY')
  assert.ok(/null/i.test(r.error.message), `message must explain null root session: ${r.error.message}`)
})

// ── 13. assertLeafWriter 单元：delegate 轴仅 verification 生效；旧树缺字段缺省 [] ──
test('assertLeafWriter 单元：delegate 轴仅 verification 生效；缺字段树缺省 []', () => {
  const leaf = { leaf_id: WORKER, session_id: OWNER, added_by: CMD }
  const state = { tree_id: TREE, leaves: { [`${TREE}-root`]: { session_id: ROOT } }, verify_delegates: [X] }
  // 命中委托列表：verification 放行；其它 kind 一律拒
  assert.equal(assertLeafWriter(state, leaf, X, 'verification'), true)
  assert.throws(() => assertLeafWriter(state, leaf, X, 'status'), (e) => e.code === 'E_BORROWED_IDENTITY')
  assert.throws(() => assertLeafWriter(state, leaf, X, 'context'), (e) => e.code === 'E_BORROWED_IDENTITY')
  assert.throws(() => assertLeafWriter(state, leaf, X, 'event:done'), (e) => e.code === 'E_BORROWED_IDENTITY')
  // 缺 verify_delegates 字段（旧树）→ 惰性缺省 []，委托轴不生效
  const oldState = { tree_id: TREE, leaves: { [`${TREE}-root`]: { session_id: ROOT } } }
  assert.throws(() => assertLeafWriter(oldState, leaf, X, 'verification'), (e) => e.code === 'E_BORROWED_IDENTITY')
  assert.equal(assertLeafWriter(oldState, leaf, CMD, 'verification'), true)
  // 命中列表但 caller 缺失 → fail-closed
  assert.throws(() => assertLeafWriter(state, leaf, undefined, 'verification'), (e) => e.code === 'E_BORROWED_IDENTITY')
})
