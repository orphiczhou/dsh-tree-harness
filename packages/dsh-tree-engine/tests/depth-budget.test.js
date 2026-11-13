/**
 * v0.8.1（D22）深度预算单测：tree 派发/竹节接力向宿主显式传 `request.maxDepth`。
 *
 * 背景（v2 真机试点实证）：`@deepseek-ai/dsh-subagent` 的 `startActivation`/`startContinuable`
 * **只**校验调用方显式传入的 `request.maxDepth`（asar `lib/index.js:1402/1405`）；配置读取
 * `resolveMaxDepth` 只被模型工具 `subagent` 使用。tree 派发此前不传 → depth 6 子会话未被拒。
 *
 * 修复口径：`DEFAULT_GUARDS.max_subagent_depth = 5`（可经 `TREE_ENGINE_CONFIG.max_subagent_depth` 覆盖）；
 * `dispatch:start` 与竹节 relay 的 `ports.dispatch` spec 均携带 `maxDepth`；
 * `index.js startChildSession` 经 `buildStartRequest` 构造后写入宿主 maxDepth
 * （legacy = 嵌套 `request.maxDepth`；rc.3 activation = 扁平 `spec.maxDepth`，v0.10.1 D28 适配；
 * 纯函数单测在 compat.test.js）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { DEFAULT_GUARDS } from '../src/guards.js'
import { configFromEnv } from '../src/config.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'
const OWNER = '33333333-3333-4333-8333-333333333333'
const LEAF = 'depth-C1-worker'

/** 假端口：记录 dispatch spec（竹节接力需要 usagePct/promptHandoff/interrupt）。 */
function fakePorts({ usagePct = null } = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    async dispatch(spec) { calls.push(spec); n += 1; return { sessionId: `sess-${n}` } },
    async interrupt() {},
    async promptHandoff() { return 'BRIEF: K1…/K2无/K5…' },
    async lastOutputAt() { return 1000 },
    async usagePct() { return usagePct },
  }
}

async function setup({ config, orchestra, ports } = {}) {
  const store = memoryStore()
  const engine = createEngine({ store, clock: new VirtualClock(1000), ports: ports ?? fakePorts(), ...(config ? { config } : {}), ...(orchestra ? { orchestra } : {}) })
  await engine.call('init', ['depth', { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', ['depth', { leaf_id: LEAF, session_id: OWNER, parent: 'depth-root', path: 'C1', role: 'worker', added_by: CMD }], CMD)
  return { engine, store }
}

test('B1 缺省：DEFAULT_GUARDS.max_subagent_depth=5；dispatch spec 显式携带 maxDepth=5', async () => {
  assert.equal(DEFAULT_GUARDS.max_subagent_depth, 5)
  const ports = fakePorts()
  const { engine } = await setup({ ports })
  const r = await engine.call('dispatch:start', ['depth', LEAF, { prompt: 'p' }], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(ports.calls.length, 1)
  assert.equal(ports.calls[0].maxDepth, 5, 'dispatch spec must carry maxDepth=5 by default')
})

test('B2 配置覆盖：TREE_ENGINE_CONFIG.max_subagent_depth=7 → spec.maxDepth=7 且写入 audit_meta', async () => {
  const ports = fakePorts()
  const { engine, store } = await setup({ config: { max_subagent_depth: 7 }, ports })
  const r = await engine.call('dispatch:start', ['depth', LEAF, { prompt: 'p' }], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(ports.calls[0].maxDepth, 7)
  const state = await store.read('depth')
  assert.equal(state.audit_meta?.max_subagent_depth, 7, 'configured cap must be persisted in audit_meta')
})

test('B3 竹节接力：relay 的 dispatch spec 同样携带 maxDepth（接力不绕过上限）', async () => {
  const ports = fakePorts({ usagePct: 45 })
  const { engine } = await setup({ ports, orchestra: { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42 } })
  const d = await engine.call('dispatch:start', ['depth', LEAF, { prompt: 'p' }], OWNER)
  assert.equal(d.ok, true, JSON.stringify(d.error))
  const first = ports.calls[0]
  assert.equal(first.maxDepth, 5)

  // 水位 45 ≥ 42 → sweep 触发竹节接力（先 interrupt 后 dispatch 第二次）
  const r = await engine.sweepTick()
  const bamboo = (r.swept[0].events ?? []).find((e) => e.event === 'bamboo' && e.leaf_id === LEAF)
  assert.ok(bamboo, JSON.stringify(r.swept[0].events))
  const relayDispatch = ports.calls.filter((c) => c.handoffBrief !== undefined || c.segmentIndex !== undefined)
  assert.equal(relayDispatch.length, 1, 'bamboo relay must issue exactly one dispatch')
  assert.equal(relayDispatch[0].maxDepth, 5, 'relay dispatch must carry maxDepth too')
})

test('B4 配置校验：max_subagent_depth 非法值（0 / 越界）装载期失败并含键名；合法值透传', () => {
  assert.throws(
    () => configFromEnv({ TREE_ENGINE_CONFIG: JSON.stringify({ max_subagent_depth: 0 }) }),
    /max_subagent_depth/,
  )
  assert.throws(
    () => configFromEnv({ TREE_ENGINE_CONFIG: JSON.stringify({ max_subagent_depth: 101 }) }),
    /max_subagent_depth/,
  )
  assert.throws(
    () => configFromEnv({ TREE_ENGINE_CONFIG: JSON.stringify({ max_subagent_depth: '5' }) }),
    /max_subagent_depth/,
  )
  const { config } = configFromEnv({ TREE_ENGINE_CONFIG: JSON.stringify({ max_subagent_depth: 7 }) })
  assert.equal(config.max_subagent_depth, 7)
})
