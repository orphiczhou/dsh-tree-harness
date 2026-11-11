/**
 * W2.1（2026-11-12）会话预算纳入竹节链单测。
 *
 * 背景：`max_sessions` 护栏旧口径只统计 leaf.session_id + leaf.segment_chain +
 * session_registry；竹节接力（engine.js 的 bambooRelay）把每个接手会话写入
 * leaf.runtime.segmentChain，并把 leaf.session_id 重绑为最新接手会话（v0.5.0），
 * 因此高频接力的树看起来永远只有「每叶 1 个会话」，max_sessions 形同虚设。
 *
 * 修复口径（Lead 预落地 src/guards.js）：
 *   - sessionBudget：计数集合并入 leaf.runtime.segmentChain，按 normalizeSessionId 归一化去重；
 *   - findSessionConflict：同样纳入 leaf.runtime.segmentChain，跨 `session-` 前缀/裸 UUID 比较；
 *   - engine.validate：重复检测纳入 leaf.runtime.segmentChain（本文件 e 组覆盖）。
 *
 * 本文件断言的「真实会话数」口径 = 四集合的归一化并集：
 *   leaf.session_id ∪ leaf.segment_chain ∪ leaf.runtime.segmentChain ∪ session_registry
 * （接力前的旧会话记录在 runtime.history，不属本口径——见 leaf 回报中的独立 review）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionBudget, findSessionConflict, normalizeSessionId } from '../src/guards.js'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const R = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'
const S3 = '44444444-4444-4444-8444-444444444444'
const S4 = '55555555-5555-4555-8555-555555555555'
const S5 = '66666666-6666-4666-8666-666666666666'
const D1 = '77777777-7777-4777-8777-777777777777'
const N1 = '88888888-8888-4888-8888-888888888888'
const M1 = '99999999-9999-4999-8999-999999999999'

/** W2.6 形态：DSH 根/主会话 id 可能带 `session-` 前缀。 */
const P = (sid) => `session-${sid}`

async function newEngine(over = {}) {
  const clock = new VirtualClock(1_700_000_000_000)
  const store = memoryStore()
  const engine = createEngine({ store, clock, config: { max_sessions: 5, node_budget: 10, ...over } })
  return { engine, clock, store }
}

/** 直接构造一个合法形状的 leaf（只填计数/校验消费到的字段）。 */
function leafOf(leafId, sessionId, segmentChain = [], runtimeChain = [], parent = 'w21bud-root') {
  return {
    leaf_id: leafId, session_id: sessionId, parent, path: leafId.split('-')[1], role: 'worker',
    status: 'pending_brief', added_by: R, events: [], milestones: [], segment_chain: segmentChain,
    drift_history: [], context_usage_pct: 0, nudge_count: 0,
    runtime: { state: 'pending', subagentSessionId: null, attempt: 0, segmentChain: runtimeChain, history: [] },
  }
}

// ── a. 旧行为不回归：session_id + segment_chain + registry ─────────────
test('旧行为不回归：leaf.session_id + leaf.segment_chain + session_registry 去重计数（复刻 guards.test 样例）', () => {
  const state = {
    leaves: {
      a: { session_id: S1, segment_chain: [S2] },
      b: { session_id: null, segment_chain: [] },
    },
    session_registry: {},
  }
  // 与 tests/guards.test.js「macp2 会话预算：跨 leaf.session / segment_chain / registry 去重计数」同口径同数字
  assert.deepEqual(sessionBudget(state, S1), { count: 2, max: 50, reached: false, isNew: false })
  assert.deepEqual(sessionBudget(state, S2), { count: 2, max: 50, reached: false, isNew: false })
  assert.deepEqual(sessionBudget(state, S3), { count: 3, max: 50, reached: false, isNew: true })
  // registry 作为第三集合仍计入（旧口径不回归）
  state.session_registry[S4] = { source: 'bypass' }
  assert.equal(sessionBudget(state, S3).count, 4)
  // max 仍可被 guards 覆盖；reached 语义 = 「加入该会话后 > max」
  assert.equal(sessionBudget(state, S1, { max_sessions: 2 }).reached, true)
  assert.equal(sessionBudget(state, S1, { max_sessions: 3 }).reached, false)
})

// ── b. runtime.segmentChain 计入 ────────────────────────────────────
test('runtime.segmentChain 计入：5 个接力历史会话 + 其它 leaf 会话 → count = 去重后真实会话数', () => {
  const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const chain = [S1, S2, S3, S4, S5]   // 5 条接力历史；最新接手会话 S5 同时是 leaf.session_id（只算一次）
  const state = {
    leaves: {
      'w21bud-root': { session_id: R, segment_chain: [] },
      'w21bud-C1-worker': { session_id: S5, runtime: { segmentChain: chain } },
      'w21bud-C2-worker': { session_id: T, segment_chain: [] },
    },
    session_registry: {},
  }
  // R + {S1..S5} + T = 7
  const got = sessionBudget(state, S5)
  assert.deepEqual(got, { count: 7, max: 50, reached: false, isNew: false })
  assert.equal(sessionBudget(state, S1).isNew, false)
  // 旧口径（抹掉 runtime.segmentChain）只看得到 3 个会话 —— 佐证修复前漏计 5 个接力会话
  const legacy = {
    ...state,
    leaves: Object.fromEntries(Object.entries(state.leaves).map(([k, l]) => [k, { ...l, runtime: { segmentChain: [] } }])),
  }
  assert.equal(sessionBudget(legacy, S5).count, 3)   // R + S5 + T
  // 超限边界（count=7）：max=7 不超，max=6 超
  assert.equal(sessionBudget(state, S5, { max_sessions: 7 }).reached, false)
  assert.equal(sessionBudget(state, S5, { max_sessions: 6 }).reached, true)
  // 新会话 → +1
  assert.deepEqual(sessionBudget(state, D1), { count: 8, max: 50, reached: false, isNew: true })
})

// ── c. 去重：四集合同一会话 + 跨形态归一化 ──────────────────────────
test('去重：同一会话同时出现在四集合、且 session- 前缀与裸 UUID 混用 → 只算 1', () => {
  const state = {
    leaves: {
      'w21bud-root': { session_id: P(R), segment_chain: [] },              // 前缀形态
      'w21bud-C1-worker': {
        session_id: S1,                                                    // 裸形态
        segment_chain: [P(S1)],                                            // 前缀形态（同一会话）
        runtime: { segmentChain: [P(S1), S2] },                            // 前缀 + 裸
      },
    },
    session_registry: { [P(S1)]: { source: 'bypass' }, [S2]: { source: 'bypass' } },
  }
  // S1 出现在四集合（两形态）、S2 出现在两集合（两形态）→ 归一化后仅 {R,S1,S2} = 3
  assert.equal(normalizeSessionId(P(S1)), S1)
  assert.deepEqual(sessionBudget(state, P(S1)), { count: 3, max: 50, reached: false, isNew: false })
  assert.equal(sessionBudget(state, S1).isNew, false)
  assert.equal(sessionBudget(state, P(S2)).isNew, false)
  const fresh = sessionBudget(state, S3)
  assert.deepEqual({ count: fresh.count, isNew: fresh.isNew }, { count: 4, isNew: true })
})

// ── c'. findSessionConflict 同口径（runtime.segmentChain + 归一化） ──
test('findSessionConflict：纳入 runtime.segmentChain；跨形态命中 registry/segment_chain；排除自身', () => {
  const state = {
    leaves: {
      a: { leaf_id: 'a', session_id: R, segment_chain: [], runtime: { segmentChain: [P(S1)] } },
      b: { leaf_id: 'b', session_id: null, segment_chain: [P(S2)], runtime: { segmentChain: [] } },
    },
    session_registry: { [P(S3)]: { source: 'bypass' } },
  }
  // 裸 UUID 输入命中 runtime 前缀记录；前缀输入同样命中
  assert.match(String(findSessionConflict(state, S1)), /runtime\.segmentChain/)
  assert.match(String(findSessionConflict(state, P(S1))), /runtime\.segmentChain/)
  assert.match(String(findSessionConflict(state, S2)), /segment_chain/)
  assert.match(String(findSessionConflict(state, P(S3))), /session_registry/)
  assert.match(String(findSessionConflict(state, R)), /already used by leaf "a"/)
  // 排除自身 leaf（set-session 场景）→ 本 leaf 内记录不构成冲突
  assert.equal(findSessionConflict(state, P(S1), 'a'), null)
  assert.equal(findSessionConflict(state, S4), null)
  assert.equal(findSessionConflict(state, null), null)   // 非会话 id → fail-closed 无冲突
})

// ── d. 小引擎：register-session 与 sessionCount 探针同口径 ──────────
test('小引擎：runtime.segmentChain 内会话不能旁路重复登记；sessionCount 探针 count-1 正确', async () => {
  const { engine, store } = await newEngine({ max_sessions: 5 })
  await engine.call('init', ['w21bud', { goal: 'g' }, { dod: 'd' }, R])
  const state = await store.read('w21bud')
  state.leaves['w21bud-C1-worker'] = leafOf('w21bud-C1-worker', S1, [], [S2, P(S3)])
  await store.write('w21bud', state)
  // 可见会话 = {R, S1, S2, S3} = 4；探针用 '__probe__'（恒为 new）后 count-1 = 实际数
  const sc = await engine.call('sessionCount', ['w21bud'])
  assert.deepEqual({ count: sc.count, max: sc.max, reached: sc.reached }, { count: 4, max: 5, reached: false })
  // 竹节历史里的会话（前缀形态）再旁路登记 → 冲突（唯一性同口径，不只是计数）
  let r = await engine.call('tree:register-session', ['w21bud', P(S3), { source: 'bypass' }])
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.match(r.error.message, /runtime\.segmentChain/)
  // 全新会话可登记；登记后探针 +1
  r = await engine.call('tree:register-session', ['w21bud', S4, { source: 'bypass' }])
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual({ count: (await engine.call('sessionCount', ['w21bud'])).count }, { count: 5 })
})

// ── d'. 真实 bambooRelay 接力 3 次 + 新建 1 叶子：计数精确、边界拒绝 ──
test('接力 3 次（真实 bambooRelay）+ 新建 1 叶子：count 精确、owner 跟随、max_sessions 边界 reached/拒绝', async () => {
  const clock = new VirtualClock(1000)
  const dispatches = [D1, S2, S3, S4]   // 首次派发 + 3 次接手会话
  let cursor = 0
  const ports = {
    async dispatch() { return { sessionId: dispatches[cursor++] } },
    async interrupt() { /* 顺序铁律不影响计数 */ },
    async promptHandoff() { return 'K1 进度 / K2 无 / K3 产物 / K4 无 / K5 继续' },
    async lastOutputAt() { return 1000 },
    async usagePct() { return 45 },
  }
  const engine = createEngine({
    store: memoryStore(), clock, ports,
    orchestra: { bambooThresholdPct: 42, nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000 },
    config: { max_sessions: 5, node_budget: 10 },
  })
  await engine.call('init', ['w21bud', {}, {}, R])
  let r = await engine.call('leaf:add', ['w21bud', {
    leaf_id: 'w21bud-C1-worker', session_id: S1, parent: 'w21bud-root', path: 'C1', role: 'worker', added_by: R,
  }], R)
  assert.equal(r.ok, true, JSON.stringify(r))
  r = await engine.call('dispatch:start', ['w21bud', 'w21bud-C1-worker', { prompt: 'go' }])
  assert.equal(r.ok, true, JSON.stringify(r))
  for (let i = 0; i < 3; i++) {
    const swept = await engine.sweepTick()
    assert.equal(swept.swept[0].events[0].relay, 'ok')
  }
  const leafBefore = (await engine.call('leaf:get', ['w21bud', 'w21bud-C1-worker'])).leaf
  assert.deepEqual(leafBefore.runtime.segmentChain, [S2, S3, S4])   // 3 次接力的接手会话全部入账
  assert.equal(leafBefore.session_id, S4)                          // 竹节 v0.5.0：owner 跟随最新接手会话
  // 可见会话 = R + {S2,S3,S4} = 4（S1/D1 被接力重绑后只留在 runtime.history，不属四集合口径）
  let sc = await engine.call('sessionCount', ['w21bud'])
  assert.deepEqual({ count: sc.count, max: sc.max, reached: sc.reached }, { count: 4, max: 5, reached: false })
  // 接力 3 次 + 新建 1 叶子 → 5 个可见会话；count == max 边界仍允许（enforcement 是 count > max）
  r = await engine.call('leaf:add', ['w21bud', {
    leaf_id: 'w21bud-C2-worker', session_id: N1, parent: 'w21bud-root', path: 'C2', role: 'worker', added_by: R,
  }], R)
  assert.equal(r.ok, true, JSON.stringify(r))
  sc = await engine.call('sessionCount', ['w21bud'])
  assert.deepEqual({ count: sc.count, max: sc.max, reached: sc.reached }, { count: 5, max: 5, reached: true })
  // 直接口径：已存在会话不多计（isNew=false）；再 +1 才 reached（count 6 > max 5）
  const dump = await engine.call('treeDump', ['w21bud'])
  assert.deepEqual(sessionBudget(dump.tree, N1, { max_sessions: 5 }), { count: 5, max: 5, reached: false, isNew: false })
  assert.deepEqual(sessionBudget(dump.tree, M1, { max_sessions: 5 }), { count: 6, max: 5, reached: true, isNew: true })
  // 超限拒绝：第 3 个叶子带新会话 → E_MAX_SESSIONS，且不落账
  r = await engine.call('leaf:add', ['w21bud', {
    leaf_id: 'w21bud-C3-worker', session_id: M1, parent: 'w21bud-root', path: 'C3', role: 'worker', added_by: R,
  }], R)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_MAX_SESSIONS')
  assert.equal((await engine.call('leaf:get', ['w21bud', 'w21bud-C3-worker'])).error.code, 'E_LEAF_NOT_FOUND')
  assert.equal((await engine.call('sessionCount', ['w21bud'])).count, 5)
})

// ── e. validate：runtime.segmentChain 纳入重复检测 ──────────────────
test('validate：runtime.segmentChain 与 session_id 同会话（跨形态）→ session_duplicate；修复后 ok', async () => {
  const { engine, store } = await newEngine({ max_sessions: 10 })
  await engine.call('init', ['w21bud', {}, {}, R])
  const state = await store.read('w21bud')
  state.leaves['w21bud-C1-worker'] = leafOf('w21bud-C1-worker', S1, [], [P(S1)])
  await store.write('w21bud', state)
  let v = await engine.call('validate', ['w21bud'])
  assert.equal(v.ok, false)
  assert.ok(v.issues.some((i) => i.type === 'session_duplicate' && i.leaf_id === 'w21bud-C1-worker' && /runtime\.segmentChain/.test(String(i.detail))), JSON.stringify(v.issues))
  // 换成不重复的接力历史 → 无 session_duplicate
  state.leaves['w21bud-C1-worker'].runtime.segmentChain = [P(S2)]
  await store.write('w21bud', state)
  v = await engine.call('validate', ['w21bud'])
  assert.equal(v.ok, true, JSON.stringify(v.issues))
})
