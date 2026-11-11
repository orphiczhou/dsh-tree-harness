/**
 * S1 第二批单测：编排层（派发/sweep 硬截止/误判保护/竹节自动接力）。
 * 假时钟 + 假端口驱动（冻结版 §8：屏蔽全部外部触发，周期性来自被注入定时器的手动 tick）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const S1_ = '22222222-2222-4222-8222-222222222222'

/** 假端口：记录调用序（Z6 顺序断言用），行为可逐测试覆写。 */
function fakePorts(over = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    async dispatch(spec) { calls.push(['dispatch', spec]); n += 1; return { sessionId: `sess-${n}` } },
    async interrupt(id) { calls.push(['interrupt', id]) },
    async promptHandoff(id) { calls.push(['promptHandoff', id]); return 'BRIEF: 进度…/关键发现…/未完成…' },
    async lastOutputAt(id) { calls.push(['lastOutputAt', id]); return null },
    async usagePct(id) { return null },
    ...over,
  }
}

async function setup(ports, clock, orchestra, extraConfig = {}) {
  const store = memoryStore()
  const engine = createEngine({ store, clock, ports, orchestra, config: extraConfig })
  await engine.call('init', ['bamboo', { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', ['bamboo', { leaf_id: 'bamboo-C1-worker', session_id: S1_, parent: 'bamboo-root', path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  return engine
}

test('dispatch:start：置 running、记 sessionId、attempt+1；重复派发拒绝', async () => {
  const clock = new VirtualClock(1000)
  const engine = await setup(fakePorts(), clock)
  let r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', { prompt: 'do it' }])
  assert.equal(r.ok, true)
  assert.equal(r.node.state, 'running')
  assert.equal(r.node.attempt, 1)
  r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
})

test('端口未装配：fail-closed（E_PORTS_NOT_WIRED），不静默', async () => {
  const clock = new VirtualClock(1000)
  const engine = await setup({}, clock)
  const r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  assert.equal(r.error.code, 'E_PORTS_NOT_WIRED')
})

test('超时硬截止（假时钟）：无外部触发，最迟 阈值+sweep周期 内落定 timeout；不早于阈值', async () => {
  const clock = new VirtualClock(0)
  const TIMEOUT = 600_000, SWEEP = 60_000
  const engine = await setup(fakePorts({ lastOutputAt: async () => null }), clock, { nodeTimeoutMs: TIMEOUT, sweepIntervalMs: SWEEP, bambooThresholdPct: 101 })
  const { sweepMode } = engine.startSweep()
  assert.equal(sweepMode, 'timer')
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  clock.advance(TIMEOUT - 1)            // 阈值前：不落定
  let leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'running')
  clock.advance(SWEEP + 1)              // 阈值+sweep 内：sweep tick 收割
  leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'timeout')
})

test('误判保护（lastOutputAt 收割时刷新）：持续产出不结束的会话不被判 timeout', async () => {
  const clock = new VirtualClock(0)
  const TIMEOUT = 600_000, SWEEP = 60_000
  let lastOut = 0
  const ports = fakePorts({
    lastOutputAt: async () => lastOut,   // 每次 sweep 前都有新产出（时间顺延）
    usagePct: async () => 0,
  })
  const engine = await setup(ports, clock, { nodeTimeoutMs: TIMEOUT, sweepIntervalMs: SWEEP, bambooThresholdPct: 101 })
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  for (let i = 0; i < 5; i++) {
    lastOut = clock.now() + 1            // 持续产出
    clock.advance(SWEEP)
    await engine.sweepTick()             // 显式收割（等价定时器 tick；二者同一逻辑）
  }
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'running')   // 5 个 sweep 周期远超阈值但持续产出 → 不误判
})

test('竹节自动接力：usage≥42 触发；先 interrupt 后 dispatch（顺序断言）；attempt 不变；基准重置；链+1', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const engine = await setup(ports, clock, { nodeTimeoutMs: 10**9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  const callsBefore = ports.calls.length
  const r = await engine.sweepTick()
  const ev = r.swept[0].events[0]
  assert.equal(ev.event, 'bamboo')
  assert.equal(ev.relay, 'ok')
  // 顺序铁律：promptHandoff → interrupt → dispatch（只看 sweep 期间的调用）
  const seq = ports.calls.slice(callsBefore).map((c) => c[0]).filter((x) => ['promptHandoff', 'interrupt', 'dispatch'].includes(x))
  assert.deepEqual(seq, ['promptHandoff', 'interrupt', 'dispatch'])
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'running')        // 竹节不改节点状态
  assert.equal(leaf.runtime.attempt, 1)              // 竹节≠重试
  assert.equal(leaf.runtime.segmentChain.length, 1)
  assert.equal(leaf.runtime.dispatchedAt, clock.now())  // 基准时刻重置
  assert.ok(leaf.runtime.handoffBrief.startsWith('BRIEF'))
})

test('v0.5.0 B1 回归：竹节接力后 owner 重绑到接手会话，接手者可写 done → runtime.succeeded', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 45, lastOutputAt: async () => 1000 })
  const engine = await setup(ports, clock, { nodeTimeoutMs: 10**9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 })
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  const r = await engine.sweepTick()
  const relaySession = r.swept[0].events[0].sessionId
  assert.ok(relaySession, 'bamboo relay must report the successor session id')
  let leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.session_id, relaySession, 'the leaf owner must follow the receiving session')
  assert.notEqual(leaf.session_id, S1_)
  // 接手会话写 done → 不再 E_BORROWED_IDENTITY，done 事件回流 succeeded
  const ev = await engine.call('event:append', ['bamboo', 'bamboo-C1-worker', 'done', { summary: 'relay ok' }], relaySession)
  assert.equal(ev.ok, true, JSON.stringify(ev.error ?? {}))
  leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'succeeded')
})

test('竹节降级：简报缺失 → no-handoff-summary 照常接手，节点不 failed', async () => {  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 50, promptHandoff: async () => null })
  const engine = await setup(ports, clock, { nodeTimeoutMs: 10**9, bambooThresholdPct: 42 })
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  const r = await engine.sweepTick()
  assert.equal(r.swept[0].events[0].briefState, 'no-handoff-summary')
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'running')
})

test('竹节链长上限：触顶 → frozen 等裁决（不再接力）', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ usagePct: async () => 50 })
  const engine = await setup(ports, clock, { nodeTimeoutMs: 10**9, bambooThresholdPct: 42 }, { segment_max_chain_length: 2 })
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  await engine.sweepTick()   // chain 1
  await engine.sweepTick()   // chain 2
  const r = await engine.sweepTick()   // 第 3 次：触顶
  assert.equal(r.swept[0].events[0].relay, 'frozen-chain-limit')
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'frozen')
})

test('cancel：running → cancelled；非 running 拒绝', async () => {
  const clock = new VirtualClock(1000)
  const engine = await setup(fakePorts(), clock)
  let r = await engine.call('dispatch:cancel', ['bamboo', 'bamboo-C1-worker'], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')   // 未派发（pending）
  await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  r = await engine.call('dispatch:cancel', ['bamboo', 'bamboo-C1-worker'], ROOT)
  assert.equal(r.node.state, 'cancelled')
})

test('sweep 降级：时钟无 scheduleInterval → sweepMode=degraded-lazy', async () => {
  const clock = new VirtualClock(0)
  clock.scheduleInterval = undefined
  const engine = await setup(fakePorts(), clock)
  const { sweepMode } = engine.startSweep()
  assert.equal(sweepMode, 'degraded-lazy')
})

// ── E2E#5 回归（v0.3.6）：成功终态回流 + 派发自动绑定执行者 ──

test('E2E#5a：dispatch:start 自动绑定 leaf.session_id = 执行者（done 所有权可自举满足）', async () => {
  const clock = new VirtualClock(1000)
  const engine = await setup(fakePorts(), clock)
  const r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  assert.equal(r.ok, true)
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.session_id, r.node.session_id)          // 执行者 = owner
  // 执行者以自身会话写 done event → 应被接受（caller === leaf.session_id）
  const ev = await engine.call('event:append', ['bamboo', 'bamboo-C1-worker', 'done', { summary: 'ok' }], leaf.session_id)
  assert.equal(ev.ok, true, JSON.stringify(ev.error))
})

test('E2E#5b：done 事件 → runtime succeeded 回流（不再卡 running 到 timeout）', async () => {
  const clock = new VirtualClock(1000)
  const engine = await setup(fakePorts(), clock)
  const r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  await engine.call('event:append', ['bamboo', 'bamboo-C1-worker', 'done', { summary: 'ok' }], r.node.session_id)
  let leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'succeeded')             // 事件路径即时回流
  // 成功终态后可再派发（重试语义不被 running 卡死）
  const again = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  assert.equal(again.ok, true, JSON.stringify(again.error))
  assert.equal(again.node.attempt, 2)
})

test('E2E#5c：sweep 兜底回流——done 事件已存在但 runtime 仍 running → succeeded', async () => {
  const clock = new VirtualClock(1000)
  const ports = fakePorts({ lastOutputAt: async () => 1000 })
  const engine = await setup(ports, clock, { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000 })
  const r = await engine.call('dispatch:start', ['bamboo', 'bamboo-C1-worker', {}])
  // 模拟历史遗留形状：done 事件已写（事件路径在旧版不回流），此处直接验证 sweep 对 done+running 的处置
  await engine.call('event:append', ['bamboo', 'bamboo-C1-worker', 'done', { summary: 'ok' }], r.node.session_id)
  const swept = await engine.sweepTick()
  const leaf = (await engine.call('leaf:get', ['bamboo', 'bamboo-C1-worker'])).leaf
  assert.equal(leaf.runtime.state, 'succeeded')
  assert.ok(!swept.swept[0].events.some((e) => e.event === 'timeout'), JSON.stringify(swept.swept[0].events))
})
