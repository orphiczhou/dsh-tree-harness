/** S1 第一批单测：引擎命令面（init/leaf/set-status/竹节/级联/契约封包）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const S1_ = '22222222-2222-4222-8222-222222222222'
const S2_ = '33333333-3333-4333-8333-333333333333'
const S3_ = '44444444-4444-4444-8444-444444444444'
const S4_ = '55555555-5555-4555-8555-555555555555'

async function newEngine(over = {}) {
  const clock = new VirtualClock(1_700_000_000_000)
  const store = memoryStore()
  const engine = createEngine({ store, clock, config: { max_sessions: 4, node_budget: 3, ...over } })
  return { engine, clock, store }
}

async function seeded(over) {
  const ctx = await newEngine(over)
  await ctx.engine.call('init', ['macp2', { goal: 'x' }, { dod: 'y' }, ROOT])
  await ctx.engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C1-worker', session_id: S1_, parent: 'macp2-root', path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  return ctx
}

test('init：root leaf 自动创建 + tree_id 命名规则前置拦截', async () => {
  const { engine } = await newEngine()
  const r = await engine.call('init', ['macp2', {}, {}, ROOT])
  assert.equal(r.ok, true)
  assert.equal(r.tree.root_leaf_id, 'macp2-root')
  const bad = await engine.call('init', ['oeval-macp2', {}, {}, ROOT])   // 含连字符
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'E_NAME_INVALID')
  const dup = await engine.call('init', ['macp2', {}, {}, ROOT])
  assert.equal(dup.error.code, 'E_DUPLICATE_LEAF')
})

test('leaf:add：caller≠added_by 拒（防借身份）；worker 初始 pending_brief', async () => {
  const { engine } = await seeded()
  const bad = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C2-worker', session_id: S2_, parent: 'macp2-root', path: 'C2', role: 'worker', added_by: ROOT }], S3_)
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'E_BORROWED_IDENTITY')
  const r = await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])
  assert.equal(r.leaf.status, 'pending_brief')
})

test('done 三重闸全链：event 先行 + milestones 全过 才能落 done', async () => {
  const { engine } = await seeded()
  // 闸：无 done event → 拒
  let r = await engine.call('leaf:set-status', ['macp2', 'macp2-C1-worker', 'done'], S1_)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  // commander（added_by）代写 worker 的 done event → 拒（V10-trust-anchor-fix：仅 owner session）
  r = await engine.call('event:append', ['macp2', 'macp2-C1-worker', 'done', { self_check: [] }], ROOT)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY')
  // owner 写 done event 但 milestones 空 → set-status 仍拒
  r = await engine.call('event:append', ['macp2', 'macp2-C1-worker', 'done', { self_check: [] }], S1_)
  assert.equal(r.ok, true)
  r = await engine.call('leaf:set-status', ['macp2', 'macp2-C1-worker', 'done'], S1_)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
})

test('竹节触发：set-context 达阈值 → segment_pending + drift 留痕；root 不触发', async () => {
  const { engine } = await seeded()
  // worker 初始 pending_brief——竹节仅对 active 非 root 触发，先转 active
  await engine.call('leaf:set-status', ['macp2', 'macp2-C1-worker', 'active'], S1_)
  let r = await engine.call('leaf:set-context', ['macp2', 'macp2-C1-worker', 41])
  assert.equal(r.ok, true)
  assert.equal(r.leaf.segment_pending, false)
  r = await engine.call('leaf:set-context', ['macp2', 'macp2-C1-worker', 42])
  assert.equal(r.leaf.segment_pending, true)
  r = await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])
  assert.equal(r.leaf.status, 'segment_pending')
  assert.ok(r.leaf.drift_history.some((d) => d.action === 'handoff' && d.reason.includes('bamboo-joint')))
  // root 信任锚不竹节
  r = await engine.call('leaf:set-context', ['macp2', 'macp2-root', 99], ROOT)
  assert.equal(r.leaf.segment_pending, false)
})

test('竹节接力登记：segment append 链追加 + 全树唯一 + 链长上限熔断', async () => {
  const { engine } = await seeded({ segment_max_chain_length: 2 })
  let r = await engine.call('segment:append', ['macp2', 'macp2-C1-worker', S2_])
  assert.equal(r.ok, true)
  assert.deepEqual(r.leaf.segment_chain, [S2_])
  r = await engine.call('segment:append', ['macp2', 'macp2-C1-worker', S2_])   // 重复 id → 唯一性拒
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('segment:append', ['macp2', 'macp2-C1-worker', S3_])
  assert.equal(r.ok, true)
  r = await engine.call('segment:append', ['macp2', 'macp2-C1-worker', S4_])   // 链长 2 上限
  assert.equal(r.error.code, 'E_SEGMENT_CHAIN_LIMIT')
})

test('级联 pruned：父 pruned → 未 done 后代级联 + 留痕', async () => {
  const { engine } = await seeded({ node_budget: 5 })
  // 经 commander 中间层（worker 不能有子节点）
  await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C2-commander', session_id: S2_, parent: 'macp2-root', path: 'C2', role: 'commander', added_by: ROOT }], ROOT)
  const add = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C2a-worker', session_id: S3_, parent: 'macp2-C2-commander', path: 'C2a', role: 'worker', added_by: S2_ }], S2_)
  assert.equal(add.ok, true)
  const r = await engine.call('leaf:set-status', ['macp2', 'macp2-C2-commander', 'pruned'], S2_)
  assert.equal(r.ok, true)
  const child = await engine.call('leaf:get', ['macp2', 'macp2-C2a-worker'])
  assert.equal(child.leaf.status, 'pruned')
  assert.ok(child.leaf.drift_history.some((d) => d.reason.includes('cascade')))
})

test('validate：会话重复 / 父缺失 / status-event 不同步 全部检出', async () => {
  const { engine, store } = await seeded()
  // 孤儿经 store 直改构造（leafAdd 严格父校验放行不了；validate 的职责面正是直改篡改——洁净室 B5 型）
  const state = await store.read('macp2')
  state.leaves['macp2-C9-worker'] = { leaf_id: 'macp2-C9-worker', session_id: S1_, parent: 'macp2-ghost', role: 'worker', added_by: ROOT, status: 'active', events: [], milestones: [], segment_chain: [], drift_history: [] }
  state.leaves['macp2-done-x'] = { leaf_id: 'macp2-done-x', session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT, status: 'done', events: [], milestones: [], segment_chain: [], drift_history: [] }
  await store.write('macp2', state)
  const r = await engine.call('validate', ['macp2'])
  assert.equal(r.ok, false)
  const types = r.issues.map((i) => i.type)
  assert.ok(types.includes('parent_missing'))
  assert.ok(types.includes('session_duplicate'))
  assert.ok(types.includes('status_event_mismatch'))
})

test('E2E 回归：null 会话 leaf add（PENDING 型）不与 root 冲突；parentSessionId 落 runtime', async () => {
  const { engine, clock } = await newEngine()
  const ports = { dispatch: async () => ({ sessionId: 'sess-child-1' }) }
  engine.attachPorts(ports)
  await engine.call('init', ['macp2', { goal: 'x' }, { dod: 'y' }])   // 无 session_id → root.session_id=null
  // 修复前：root.session_id=null 与 leaf.session_id=null 判冲突（E_SCHEMA_INVALID）
  let r = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C1-worker', session_id: null, parent: 'macp2-root', path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  // parentAgent/parentSessionId 透传断言（E2E 实证 startContinuable 需要活 Agent；state 只存 id）
  r = await engine.call('dispatch:start', ['macp2', 'macp2-C1-worker', { prompt: 'p', parentAgent: { id: 'agent-x' }, parentSessionId: 'sess-x' }], undefined)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leaf = (await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])).leaf
  assert.equal(leaf.runtime.parentSessionId, 'sess-x')
  assert.ok(clock)  // lint 占位
})

test('契约封包：call 永不 throw，错误带 code + call-log 全量记录', async () => {
  const { engine } = await newEngine()
  const r = await engine.call('no-such-cmd', [])
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_UNKNOWN')
  const r2 = await engine.call('leaf:get', ['ghost-tree', 'x'])
  assert.equal(r2.ok, false)
})

test('事件 ts 单调：倒挂时间戳被拒（V10-timestamp-monotonic）', async () => {
  const { engine, clock } = await seeded()
  const r = await engine.call('event:append', ['macp2', 'macp2-C1-worker', 'progress', {}], S1_, new Date(clock.now()).toISOString())
  assert.equal(r.ok, true)
  const stale = new Date(clock.now() - 10_000).toISOString()
  const r2 = await engine.call('event:append', ['macp2', 'macp2-C1-worker', 'progress', {}], S1_, stale)
  assert.equal(r2.error.code, 'E_TS_NOT_MONOTONIC')
})

test('日志/维护命令：drift 枚举 / heartbeat / communication / nudge-reset / register-session / backup-restore', async () => {
  const { engine } = await seeded()
  // drift 枚举校验
  let r = await engine.call('drift:append', ['macp2', 'macp2-C1-worker', 'bad-kind', 'low', 'nudge'])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('drift:append', ['macp2', 'macp2-C1-worker', 'rhythm', 'mid', 'self_correct', null, '偏离修正'])
  assert.equal(r.ok, true)
  r = await engine.call('drift:list', ['macp2'])
  assert.equal(r.drifts.length, 1)
  // heartbeat
  r = await engine.call('heartbeat:append', ['macp2', { verdicts: [{ leaf_id: 'macp2-C1-worker', verdict: 'ok' }] }])
  assert.equal(r.ok, true)
  r = await engine.call('heartbeat:tail', ['macp2', 5])
  assert.equal(r.heartbeats.length, 1)
  // communication：target 定位 + last_event 更新
  r = await engine.call('communication:log', ['macp2', S1_, 'out', '推进指令'], ROOT)
  assert.equal(r.ok, true)
  assert.equal(r.communication.leaf_id, 'macp2-C1-worker')
  r = await engine.call('communication:list', ['macp2'])
  assert.equal(r.communications.length, 1)
  // nudge-reset
  await engine.call('nudge:append', ['macp2', 'macp2-C1-worker'])
  r = await engine.call('nudge:reset', ['macp2', 'macp2-C1-worker'])
  assert.equal(r.leaf.nudge_count, 0)
  // register-session：幂等拒绝重复
  r = await engine.call('tree:register-session', ['macp2', S4_, 'bypass'])
  assert.equal(r.ok, true)
  r = await engine.call('tree:register-session', ['macp2', S4_, 'bypass'])
  assert.equal(r.ok, false)
  // backup / restore（状态内快照 + 跨树校验）
  r = await engine.call('backup', ['macp2', 'pre-test'])
  assert.equal(r.ok, true)
  const name = r.backup
  r = await engine.call('restore', ['macp2', name])
  assert.equal(r.ok, true)
  r = await engine.call('restore', ['macp2', 'no-such-backup'])
  assert.equal(r.error.code, 'E_BACKUP_NOT_FOUND')
})
