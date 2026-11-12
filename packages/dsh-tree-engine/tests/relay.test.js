/**
 * per-leaf relay 开关单测（v0.8.0 P0-A）+ relay parent Agent 重解析（v0.8.0 P1-D）。
 *
 * 背景（S1 真机 E2E）：竹节 relay 会 interrupt 旧会话——若该会话正在跑外部编排（flow run /
 * tree_verify / 长命令），flow journal 直接 cancelled / E_RUN_CANCELLED。修复 = leaf 级开关：
 *   - leaf.relay 缺省 'auto'（参与竹节）；'off' 时 sweep 在竹节判定前跳过该 leaf（超时/收割语义不变、
 *     不改 runtime.state）；
 *   - 写权 = creator/root（LEAF_WRITE_MATRIX.relay，owner 不得自关竹节）；
 *   - 工具面 tree_node 新增 action:"set-relay"（schema 锁死枚举）；
 *   - P1-D：热更 reload 后进程内 Agent 缓存为空 → 按 parentSessionId 经 agents 服务安全重解析。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { TOOLS, makePorts } from '../index.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'
const OWNER = '33333333-3333-4333-8333-333333333333'
const STRANGER = '44444444-4444-4444-8444-444444444444'
const PARENT = '55555555-5555-4555-8555-555555555555'
const LEAF = 'relay-C1-worker'

/** 假编排端口：记录调用序；usagePct 缺省 null（自报优先语义）。 */
function fakePorts(over = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    async dispatch(spec) { calls.push(['dispatch', spec]); n += 1; return { sessionId: `sess-${n}` } },
    async interrupt(id) { calls.push(['interrupt', id]) },
    async promptHandoff(id) { calls.push(['promptHandoff', id]); return 'BRIEF: K1…/K2无/K5…' },
    async lastOutputAt() { return null },
    async usagePct() { return null },
    ...over,
  }
}

async function setup(ports, clock, orchestra = {}) {
  const store = memoryStore()
  const engine = createEngine({ store, clock, ports, orchestra })
  await engine.call('init', ['relay', { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', ['relay', { leaf_id: LEAF, session_id: OWNER, parent: 'relay-root', path: 'C1', role: 'worker', added_by: CMD }], CMD)
  return { store, engine }
}

const leafOf = async (engine, leafId = LEAF) => (await engine.call('leaf:get', ['relay', leafId])).leaf

// ── A：leaf 级开关（持久化 / 合法值 / 写权矩阵）──────────────

test('A1 缺省 auto：新建 leaf 持久化 relay="auto"；set-relay off → auto 往返', async () => {
  const { engine } = await setup(fakePorts(), new VirtualClock(1000))
  assert.equal((await leafOf(engine)).relay, 'auto')

  const off = await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)
  assert.equal(off.ok, true, JSON.stringify(off.error))
  assert.equal(off.leaf.relay, 'off')
  assert.equal((await leafOf(engine)).relay, 'off', 'relay must be persisted on the leaf')

  const back = await engine.call('leaf:set-relay', ['relay', LEAF, 'auto'], CMD)
  assert.equal(back.ok, true)
  assert.equal((await leafOf(engine)).relay, 'auto')
})

test('A2 非法值 fail-closed：on/disabled/数字/布尔 → E_SCHEMA_INVALID，状态不变', async () => {
  const { engine } = await setup(fakePorts(), new VirtualClock(1000))
  for (const bad of ['on', 'disabled', 0, true, null]) {
    const r = await engine.call('leaf:set-relay', ['relay', LEAF, bad], CMD)
    assert.equal(r.ok, false, `relay=${JSON.stringify(bad)} must be rejected`)
    assert.equal(r.error.code, 'E_SCHEMA_INVALID', JSON.stringify(r.error))
    assert.match(r.error.message, /"auto" or "off"/)
  }
  assert.equal((await leafOf(engine)).relay, 'auto')
})

test('A3 写权矩阵：creator/root 放行；owner/陌生人/缺 caller 拒（E_BORROWED_IDENTITY，信息含 kind relay）', async () => {
  const { engine } = await setup(fakePorts(), new VirtualClock(1000))

  const owner = await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], OWNER)
  assert.equal(owner.error.code, 'E_BORROWED_IDENTITY')
  assert.match(owner.error.message, /relay/)

  const stranger = await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], STRANGER)
  assert.equal(stranger.error.code, 'E_BORROWED_IDENTITY')

  const anon = await engine.call('leaf:set-relay', ['relay', LEAF, 'off'])
  assert.equal(anon.error.code, 'E_BORROWED_IDENTITY', 'caller 提取失败必须 fail-closed')

  const rootOk = await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], ROOT)
  assert.equal(rootOk.ok, true, JSON.stringify(rootOk.error))
  assert.equal(rootOk.leaf.relay, 'off', 'root session (trust anchor) is allowed')

  const creatorOk = await engine.call('leaf:set-relay', ['relay', LEAF, 'auto'], CMD)
  assert.equal(creatorOk.ok, true, JSON.stringify(creatorOk.error))
})

test('A4 leaf:add 支持 relay:"off" 创建（派发前关竹节）；非法 relay 在 add 时拒', async () => {
  const { engine } = await setup(fakePorts(), new VirtualClock(1000))
  const add = await engine.call('leaf:add', ['relay', {
    leaf_id: 'relay-C2-worker', session_id: null, parent: 'relay-root', path: 'C2', role: 'worker', added_by: CMD, relay: 'off',
  }], CMD)
  assert.equal(add.ok, true, JSON.stringify(add.error))
  assert.equal((await leafOf(engine, 'relay-C2-worker')).relay, 'off')

  const bad = await engine.call('leaf:add', ['relay', {
    leaf_id: 'relay-C3-worker', session_id: null, parent: 'relay-root', path: 'C3', role: 'worker', added_by: CMD, relay: 'paused',
  }], CMD)
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'E_SCHEMA_INVALID')
  assert.match(bad.error.message, /leaf\.relay/)
})

// ── A：sweep 行为（off 跳过 relay；其余收割语义不变）──────────

test('A5 relay=off：sweep 跳过竹节（不呼 promptHandoff/interrupt、不改 runtime.state/owner/segmentChain）', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const { engine } = await setup(ports, clock, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  const d = await engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  const session = d.node.session_id
  assert.equal((await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)).ok, true)

  const callsBefore = ports.calls.length
  const r = await engine.sweepTick()
  assert.deepEqual(r.swept[0].events, [], 'relay=off must produce no bamboo event')
  assert.deepEqual(ports.calls.slice(callsBefore), [], 'relay=off must not call promptHandoff/interrupt/dispatch')

  const leaf = await leafOf(engine)
  assert.equal(leaf.runtime.state, 'running', 'skipping relay must not change runtime.state')
  assert.equal(leaf.session_id, session, 'owner must not be rebound when relay is skipped')
  assert.deepEqual(leaf.runtime.segmentChain, [])
  assert.equal(leaf.runtime.segmentChain.length, 0)
})

test('A6 控制组：off → 回 auto 后同一 leaf 恢复竹节接力（开关可逆、不粘连）', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const { engine } = await setup(ports, clock, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)
  assert.deepEqual((await engine.sweepTick()).swept[0].events, [])

  await engine.call('leaf:set-relay', ['relay', LEAF, 'auto'], CMD)
  const r = await engine.sweepTick()
  assert.equal(r.swept[0].events.length, 1)
  assert.equal(r.swept[0].events[0].event, 'bamboo')
  assert.equal(r.swept[0].events[0].relay, 'ok')
  const leaf = await leafOf(engine)
  assert.equal(leaf.runtime.segmentChain.length, 1)
  assert.equal(leaf.runtime.state, 'running')
})

test('A7 per-leaf 粒度：同树 off 的 leaf 不接力、auto 的 leaf 照常接力（互不影响）', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const { engine } = await setup(ports, clock, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await engine.call('leaf:add', ['relay', { leaf_id: 'relay-C2-worker', session_id: null, parent: 'relay-root', path: 'C2', role: 'worker', added_by: CMD }], CMD)
  await engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  await engine.call('dispatch:start', ['relay', 'relay-C2-worker', {}], OWNER)
  await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)

  const r = await engine.sweepTick()
  const events = r.swept[0].events
  assert.equal(events.length, 1, JSON.stringify(events))
  assert.equal(events[0].leaf_id, 'relay-C2-worker')
  assert.equal(events[0].event, 'bamboo')
  assert.equal((await leafOf(engine, 'relay-C2-worker')).runtime.segmentChain.length, 1)
  assert.deepEqual((await leafOf(engine, LEAF)).runtime.segmentChain, [])
})

test('A8 off 不影响收割/超时语义：超时仍落 timeout；done 事件仍回流 succeeded', async () => {
  // ① 超时硬截止照旧（relay off 也不豁免）
  const clock = new VirtualClock(0)
  const ports = fakePorts({ usagePct: async () => 45 })
  const { engine } = await setup(ports, clock, { nodeTimeoutMs: 1_000, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  await engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)
  clock.advance(2_000)
  const timedOut = await engine.sweepTick()
  assert.ok(!timedOut.swept[0].events.some((e) => e.event === 'bamboo'))
  assert.equal((await leafOf(engine)).runtime.state, 'timeout')

  // ② done 事件回流照旧（off 只跳过竹节，不动 done 收割路径）
  const clock2 = new VirtualClock(1000)
  const ports2 = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const s2 = await setup(ports2, clock2, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  const d = await s2.engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  await s2.engine.call('leaf:set-relay', ['relay', LEAF, 'off'], CMD)
  await s2.engine.call('event:append', ['relay', LEAF, 'done', { summary: 'ok' }], d.node.session_id)
  const swept = await s2.engine.sweepTick()
  assert.deepEqual(swept.swept[0].events, [])
  assert.equal((await leafOf(s2.engine)).runtime.state, 'succeeded')
})

test('A9 tree_node 工具面：action 枚举含 set-relay、relay 枚举 auto|off（schema 锁死）', async () => {
  const nodeTool = TOOLS.find((t) => t.name === 'tree_node')
  assert.ok(nodeTool, 'tree_node must be registered')
  assert.ok(nodeTool.parameters.properties.action.enum.includes('set-relay'), JSON.stringify(nodeTool.parameters.properties.action.enum))
  assert.deepEqual(nodeTool.parameters.properties.relay.type, 'string')
  assert.deepEqual(nodeTool.parameters.properties.relay.enum, ['auto', 'off'])
  assert.match(nodeTool.description, /set-relay/)
  assert.match(nodeTool.description, /creator|root/)
})

test('A10 双信号取高：宿主测量低/自报高 → relay；测量高/自报低 → relay（F3 生效后的“∨”口径）', async () => {
  // ① 测量 5 / 自报 45 → 自报信号不被宿主测量覆盖（旧实现 pct=usage ?? self 会压掉自报）
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 5, lastOutputAt: async () => 1000 })
  const { engine } = await setup(ports, clock, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  const d = await engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  const set = await engine.call('leaf:set-context', ['relay', LEAF, 45], d.node.session_id)
  assert.equal(set.ok, true, JSON.stringify(set.error))
  const r1 = await engine.sweepTick()
  assert.equal(r1.swept[0].events[0]?.event, 'bamboo', JSON.stringify(r1.swept[0].events))

  // ② 测量 50 / 自报 0 → 宿主测量生效（执行者忘了自报也能按真实上下文接力）
  const clock2 = new VirtualClock(1000)
  const ports2 = fakePorts({ usagePct: async () => 50, lastOutputAt: async () => 1000 })
  const s2 = await setup(ports2, clock2, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await s2.engine.call('dispatch:start', ['relay', LEAF, {}], OWNER)
  const r2 = await s2.engine.sweepTick()
  assert.equal(r2.swept[0].events[0]?.event, 'bamboo', JSON.stringify(r2.swept[0].events))
})

// ── D：relay parent Agent 安全重解析（reload 后缓存为空）─────────

/** 假宿主 subagents/agents（legacy startContinuable 形状）。 */
function fakeHostServices({ liveParents = new Map(), agentCalls = [] } = {}) {
  const started = []
  const services = {
    agents: {
      get: (id) => { agentCalls.push(id); return liveParents.get(id) },
    },
    subagents: {
      async startContinuable(spec) { started.push(spec); return { childId: 'child-1' } },
    },
    sessionQuery: { async readSession() { return null } },
  }
  return { services, started, agentCalls }
}

test('D1 缓存未命中：dispatch 按 parentSessionId 从 agents 重解析活 Agent（reload 后 relay 自愈）', async () => {
  const LIVE_PARENT = { id: 'live-parent-agent' }
  const { services, started, agentCalls } = fakeHostServices({ liveParents: new Map([[PARENT, LIVE_PARENT]]) })
  const logs = []
  const ports = makePorts(services, (m) => logs.push(m))

  const r = await ports.dispatch({ treeId: 'relay', leafId: 'relay-C1-worker', prompt: 'p', parentSessionId: PARENT })
  assert.deepEqual(r, { sessionId: 'child-1' })
  assert.equal(agentCalls[0], PARENT, 'agents.get(parentSessionId) must be attempted')
  assert.equal(started[0].request.parent, LIVE_PARENT, 'the re-resolved live Agent must be used as request.parent')
  assert.ok(logs.some((m) => /re-resolved/.test(m)), JSON.stringify(logs))

  // 第二次 dispatch（同 leaf，无 parentAgent/parentSessionId）→ 进程内缓存命中，不再重解析
  await ports.dispatch({ treeId: 'relay', leafId: 'relay-C1-worker', prompt: 'p' })
  assert.equal(agentCalls.length, 1, 'cached parent must not trigger another agents.get')
  assert.equal(started[1].request.parent, LIVE_PARENT)
})

test('D2 重解析失败 → 保持原错误（E_PORTS_PROTOCOL，不伪造 parent/不静默降级）', async () => {
  const { services } = fakeHostServices({ liveParents: new Map() })
  const errors = []
  const ports = makePorts(services, (m) => errors.push(m))
  await assert.rejects(
    () => ports.dispatch({ treeId: 'relay', leafId: 'relay-C1-worker', prompt: 'p', parentSessionId: PARENT }),
    (e) => e.code === 'E_PORTS_PROTOCOL' && /no live parent Agent/.test(e.message),
  )
})
