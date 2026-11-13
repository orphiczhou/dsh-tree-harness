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
  let r = await engine.call('leaf:set-context', ['macp2', 'macp2-C1-worker', 41], S1_)
  assert.equal(r.ok, true)
  assert.equal(r.leaf.segment_pending, false)
  r = await engine.call('leaf:set-context', ['macp2', 'macp2-C1-worker', 42], S1_)
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
  // nudge-reset（R1 复核修复后需 caller：owner/creator/root；本 fixture added_by=ROOT）
  await engine.call('nudge:append', ['macp2', 'macp2-C1-worker'])
  r = await engine.call('nudge:reset', ['macp2', 'macp2-C1-worker'], ROOT)
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

// ── §7 任务1：dependencies 引擎侧 enforcement ─────────────
test('dependencies：装载期形状/存在性/自指/重复 全部拦截；合法声明落账', async () => {
  const { engine } = await seeded({ node_budget: 5 })
  const mk = (id, deps) => engine.call('leaf:add', ['macp2', { leaf_id: id, session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT, ...(deps ? { dependencies: deps } : {}) }], ROOT)
  let r = await mk('macp2-C3-worker', 'not-array')
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await mk('macp2-C3-worker', [])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await mk('macp2-C3-worker', ['macp2-ghost'])
  assert.equal(r.error.code, 'E_LEAF_NOT_FOUND')
  r = await mk('macp2-C3-worker', ['macp2-C3-worker'])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await mk('macp2-C3-worker', ['macp2-C1-worker', 'macp2-C1-worker'])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  // 合法：依赖存在即通过并落账
  r = await mk('macp2-C3-worker', ['macp2-C1-worker'])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leaf = (await engine.call('leaf:get', ['macp2', 'macp2-C3-worker'])).leaf
  assert.deepEqual(leaf.dependencies, ['macp2-C1-worker'])
})

test('dependencies 环检测：既有环上挂新依赖不误伤（DFS 纵深防御不拦合法链）', async () => {
  const { engine, store } = await seeded({ node_budget: 5 })
  const mk = (id, deps) => engine.call('leaf:add', ['macp2', { leaf_id: id, session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT, ...(deps ? { dependencies: deps } : {}) }], ROOT)
  await mk('macp2-C3-worker', ['macp2-C1-worker'])
  await mk('macp2-C4-worker', ['macp2-C3-worker'])
  // 洁净室直改（validate 测试同款手法）：C3 反向依赖 C4 构成既有环 C3→C4→C3
  const st = await store.read('macp2')
  st.leaves['macp2-C3-worker'].dependencies = ['macp2-C4-worker']
  await store.write('macp2', st)
  // 新候选 C5 依赖 C3：DFS 命中在栈节点（非候选自身）→ 非候选成环，不误伤
  //（add-不可变模型下候选成环除自指外不可能出现；DFS 为纵深防御，此处固化不误伤语义）
  const r = await mk('macp2-C5-worker', ['macp2-C1-worker', 'macp2-C3-worker'])
  assert.equal(r.ok, true, JSON.stringify(r.error))
})

test('依赖闸：dependencies 未全部 done → dispatch 拒；全 done → 放行；taskType 透传派发端口', async () => {
  const { engine, store } = await seeded({ node_budget: 5 })
  const mk = (id, deps, taskType) => engine.call('leaf:add', ['macp2', { leaf_id: id, session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT, ...(deps ? { dependencies: deps } : {}), ...(taskType ? { taskType } : {}) }], ROOT)
  await mk('macp2-C3-worker', ['macp2-C1-worker'], 'code-change')
  await mk('macp2-C4-worker')
  const seen = []
  engine.attachPorts({ dispatch: async (spec) => { seen.push(spec); return { sessionId: `sess-${seen.length}` } } })
  // C1 未 done → 拒
  let r = await engine.call('dispatch:start', ['macp2', 'macp2-C3-worker', { prompt: 'p' }], undefined)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_DEPENDENCY_NOT_MET')
  assert.ok(r.error.message.includes('macp2-C1-worker'))
  // C1 走 done 三重闸（event 先行 + milestone audit_pass；milestone 面经 store 直改注入，等价 E2E audit_append）
  await engine.call('event:append', ['macp2', 'macp2-C1-worker', 'done', { self_check: [] }], S1_)
  const st = await store.read('macp2')
  st.leaves['macp2-C1-worker'].milestones.push({ id: 'm1', audit_pass: true })
  await store.write('macp2', st)
  r = await engine.call('leaf:set-status', ['macp2', 'macp2-C1-worker', 'done'], S1_)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  // 依赖满足 → 放行 + taskType 透传
  r = await engine.call('dispatch:start', ['macp2', 'macp2-C3-worker', { prompt: 'p' }], undefined)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(seen.at(-1).taskType, 'code-change')
  // 无 taskType 节点 → undefined（宿主回落 default）
  r = await engine.call('dispatch:start', ['macp2', 'macp2-C4-worker', { prompt: 'p' }], undefined)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(seen.at(-1).taskType, undefined)
  // runtime succeeded（工具面正常路径：worker 报 done 事件 → 回流 succeeded，无需 status done）也满足依赖闸
  const st2 = await store.read('macp2')
  st2.leaves['macp2-C4-worker'].runtime = { state: 'succeeded', subagentSessionId: 'sess-2', history: [] }
  await store.write('macp2', st2)
  const r5 = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C6-worker', session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT, dependencies: ['macp2-C4-worker'] }], ROOT)
  assert.equal(r5.ok, true, JSON.stringify(r5.error))
  const r6 = await engine.call('dispatch:start', ['macp2', 'macp2-C6-worker', { prompt: 'p' }], undefined)
  assert.equal(r6.ok, true, JSON.stringify(r6.error))
})

// ── §7 任务2：taskType 验证策略路由 + 裁决落账 ─────────────
test('leaf:set-verification：裁决持久化到 leaf.verification；非法入参拒', async () => {
  const { engine } = await seeded()
  let r = await engine.call('leaf:set-verification', ['macp2', 'macp2-C1-worker', { pass: 'yes' }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  const result = { policyId: 'self-report', pass: true, verdicts: [{ mode: 'self-report', pass: true }] }
  r = await engine.call('leaf:set-verification', ['macp2', 'macp2-C1-worker', result], ROOT)
  assert.equal(r.ok, true)
  const leaf = (await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])).leaf
  assert.equal(leaf.verification.pass, true)
  assert.equal(leaf.verification.policy_id, 'self-report')
  assert.ok(leaf.verification.ts)
})

test('taskType 非字符串拒；合法字符串落账（策略映射在验证器层）', async () => {
  const { engine } = await seeded()
  let r = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C3-worker', session_id: null, parent: 'macp2-root', path: 'C3', role: 'worker', added_by: ROOT, taskType: 42 }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C3-worker', session_id: null, parent: 'macp2-root', path: 'C3', role: 'worker', added_by: ROOT, taskType: 'research' }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal((await engine.call('leaf:get', ['macp2', 'macp2-C3-worker'])).leaf.taskType, 'research')
})

// ── agspec C1/C2/C3：assignee 持久化 + 竹节透传 + 自描述块 ──
test('dispatch:assignee 完整持久化 + leaf.model 覆盖 unknown + taskPrompt 含 <session-config-declared>', async () => {
  const { engine } = await seeded()
  const seen = []
  engine.attachPorts({ dispatch: async (spec) => { seen.push(spec); return { sessionId: 'sess-a' } } })
  const r = await engine.call('dispatch:start', ['macp2', 'macp2-C1-worker', { prompt: 'p', assignee: { provider: 'zai-coding-cn', model: 'glm-5.3-flash', effort: 'low' }, parentAgent: { id: 'a' }, parentSessionId: 'sess-x' }], undefined)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leaf = (await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])).leaf
  assert.deepEqual(leaf.assignee, { provider: 'zai-coding-cn', model: 'glm-5.3-flash', effort: 'low' })
  assert.equal(leaf.model, 'glm-5.3-flash')          // 不再 unknown
  assert.equal(leaf.channel, 'zai-coding-cn')
  assert.ok(leaf.runtime.taskPrompt.includes('<session-config-declared>'))
  assert.ok(leaf.runtime.taskPrompt.includes('"provider":"zai-coding-cn"'))
  assert.ok(leaf.runtime.taskPrompt.includes('temperature'))
  // 无 assignee → 不覆盖,leaf.model 保持缺省
  await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C7-worker', session_id: null, parent: 'macp2-root', role: 'worker', added_by: ROOT }], ROOT)
  await engine.call('dispatch:start', ['macp2', 'macp2-C7-worker', { prompt: 'q', parentAgent: { id: 'a' } }], undefined)
  const l7 = (await engine.call('leaf:get', ['macp2', 'macp2-C7-worker'])).leaf
  assert.equal(l7.assignee, null)
  assert.equal(l7.model, 'unknown')
  assert.ok(l7.runtime.taskPrompt.includes('unspecified'))
})
