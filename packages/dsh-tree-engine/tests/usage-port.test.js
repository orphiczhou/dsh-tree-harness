/**
 * 宿主 usagePct 端口回归（v0.8.0 P0-B + 收口 F3）。
 *
 * 修复前（S1 E2E）：`makePorts.usagePct` 直接访问 `services.tokenMeter`——宿主代理对未 inject 的
 * 服务抛 `cannot get property "tokenMeter" without inject`，catch 后恒 null。
 * v0.8.0 首轮 E2E（F3）进一步实证：拿到 meter 后 `measure(sessionQuery.readSession 快照)` 入参契约
 * 仍不对——tokenMeter 期望**活 Session 实例**（`session.seq` / `eventAt` / `snapshotEvents`），
 * 报 `session.snapshotEvents is not a function` → 仍恒 null。
 *
 * 本文件锁死端口层最终行为：
 *   ① 活 Session（ctx.get('sessions').get）→ contextPressure/measure 正确入参 → 返回真实占用率，
 *      `tokenMeter.measure shape:` 只打一次；
 *   ② 只拿到 readSession 快照 → 不调用 measure（绝不把快照塞给 tokenMeter），回落 null + 日志一次；
 *   ③ meter 抛错/形状缺容量/服务不可达 → null（不抛穿、不拖垮 sweep）；
 *   ④ agents.get(id).session 兜底路径可用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePorts } from '../index.js'

const SESSION = '11111111-1111-4111-8111-111111111111'

/** 最小活 Session 形状（tokenMeter 需要 seq/eventAt/snapshotEvents；投影按对象身份工作）。 */
const LIVE = Object.freeze({
  seq: 3,
  eventAt: () => ({}),
  snapshotEvents: () => [],
})

/** 宿主 services 夹具：tokenMeter 属性访问可选地抛错（模拟未 inject 的 scoped 代理）。 */
function fakeServices({ meter, attributeThrows = true } = {}) {
  const services = {
    // readSession 返回的只是快照——绝不能当 Session 传给 tokenMeter（F3 根因）
    sessionQuery: { readSession: async () => ({ header: { sessionId: SESSION }, events: [] }) },
  }
  Object.defineProperty(services, 'tokenMeter', {
    get() {
      if (attributeThrows) throw new Error('cannot get property "tokenMeter" without inject')
      return meter
    },
  })
  return services
}

/** 假 ctx：`services` map 按名字返回（sessions / agents / tokenMeter）。 */
function fakeCtx(map) {
  return { get: (name) => map[name] }
}

/** 记录调用参数的假 meter（measure/contextPressure 都模拟真实契约：必须收到活 Session）。 */
function trackingMeter({ measureResult, pressureResult, measureThrows = false, pressureThrows = false } = {}) {
  const calls = { measure: [], contextPressure: [] }
  /** 模拟真实 tokenMeter：内部要 session.seq/eventAt()/snapshotEvents()，传 readSession 快照会 TypeError。 */
  const assertLiveSession = (session) => {
    if (session?.seq === undefined || typeof session.eventAt !== 'function' || typeof session.snapshotEvents !== 'function') {
      throw new TypeError('session.snapshotEvents is not a function')
    }
  }
  return {
    calls,
    measure(session) {
      calls.measure.push(session)
      if (measureThrows) throw new Error('session.snapshotEvents is not a function')
      assertLiveSession(session)
      return measureResult
    },
    contextPressure(session) {
      calls.contextPressure.push(session)
      if (pressureThrows) throw new Error('projection exploded')
      assertLiveSession(session)
      return pressureResult
    },
  }
}

test('B1 活 Session → measure/contextPressure 收到活 Session，provider 占用率 42；shape 日志一次', async () => {
  const meter = trackingMeter({
    measureResult: { totalTokens: 50_000, surfaceTokens: 40_000 },   // 真实 measure() 形状（无 pct 字段）
    pressureResult: { pressureTokens: 42_000, contextWindow: 100_000 },
  })
  const sessions = { get: (id) => (id === SESSION ? LIVE : undefined) }
  const logs = []
  const ports = makePorts(fakeServices({ attributeThrows: true }), (m) => logs.push(m), {
    ctx: fakeCtx({ tokenMeter: meter, sessions }),
  })

  assert.equal(await ports.usagePct(SESSION), 42)
  assert.equal(await ports.usagePct(SESSION), 42)
  assert.deepEqual(meter.calls.measure, [LIVE, LIVE], 'measure must receive the live Session')
  assert.deepEqual(meter.calls.contextPressure, [LIVE, LIVE])
  const shapeLogs = logs.filter((m) => m.startsWith('tokenMeter.measure shape:'))
  assert.equal(shapeLogs.length, 1, JSON.stringify(logs))
  assert.match(shapeLogs[0], /pressureTokens|totalTokens/)
})

test('B2 services 不可达（tokenMeter 属性抛错且无 ctx）→ null 且不抛穿；失败日志只打一次', async () => {
  const logs = []
  const ports = makePorts(fakeServices({ attributeThrows: true }), (m) => logs.push(m))
  assert.equal(await ports.usagePct(SESSION), null)
  assert.equal(await ports.usagePct(SESSION), null)
  const fails = logs.filter((m) => m.startsWith('tokenMeter.measure unavailable'))
  assert.equal(fails.length, 1, JSON.stringify(logs))
  assert.match(fails[0], /self-report only/)
})

test('B3 只有 readSession 快照（无活 Session）→ 不调用 measure，回落 null + 日志一次（F3 根因回归）', async () => {
  const meter = trackingMeter({
    measureResult: { totalTokens: 1 },           // 若被错误调用会“成功”，故必须断言 0 次
    pressureResult: { pressureTokens: 1, contextWindow: 10 },
  })
  const logs = []
  // ctx.get('sessions')/agents 都不可用；services 里只有 sessionQuery 快照
  const ports = makePorts(fakeServices({ attributeThrows: false }), (m) => logs.push(m), {
    ctx: fakeCtx({ tokenMeter: meter }),          // 无 sessions / agents 服务
  })
  assert.equal(await ports.usagePct(SESSION), null)
  assert.deepEqual(meter.calls.measure, [], 'a readSession snapshot must never be passed to measure()')
  assert.deepEqual(meter.calls.contextPressure, [])
  const fails = logs.filter((m) => m.startsWith('tokenMeter.measure unavailable'))
  assert.equal(fails.length, 1, JSON.stringify(logs))
  assert.match(fails[0], /no live Session/)
  assert.match(fails[0], /self-report only/)
})

test('B4 measure 抛错（旧 bug 形态）但 contextPressure 可用 → 仍用 provider 占用率，不崩', async () => {
  const meter = trackingMeter({
    measureThrows: true,
    pressureResult: { pressureTokens: 105_000, contextWindow: 100_000 },   // 超窗口 → 截断 100
  })
  const logs = []
  const ports = makePorts(fakeServices({ attributeThrows: false }), (m) => logs.push(m), {
    ctx: fakeCtx({ tokenMeter: meter, sessions: { get: () => LIVE } }),
  })
  assert.equal(await ports.usagePct(SESSION), 100)
  assert.equal(meter.calls.measure.length, 1)
  assert.equal(meter.calls.contextPressure.length, 1)
  assert.ok(logs.some((m) => m.startsWith('tokenMeter.measure shape:')), JSON.stringify(logs))
})

test('B5 measure 只带显式百分比字段（无容量）→ 走 direct 提取 63；contextPressure 抛错不影响', async () => {
  const meter = trackingMeter({
    measureResult: { contextPct: 63 },
    pressureThrows: true,
  })
  const ports = makePorts(fakeServices({ attributeThrows: false }), () => {}, {
    ctx: fakeCtx({ tokenMeter: meter, sessions: { get: () => LIVE } }),
  })
  assert.equal(await ports.usagePct(SESSION), 63)
})

test('B6 只有 totalTokens、缺 contextWindow → null（不编造百分比），失败日志一次', async () => {
  const meter = trackingMeter({
    measureResult: { totalTokens: 30_000 },
    pressureResult: {},   // 容量字段未记录
  })
  const logs = []
  const ports = makePorts(fakeServices({ attributeThrows: false }), (m) => logs.push(m), {
    ctx: fakeCtx({ tokenMeter: meter, sessions: { get: () => LIVE } }),
  })
  assert.equal(await ports.usagePct(SESSION), null)
  const fails = logs.filter((m) => m.startsWith('tokenMeter.measure unavailable'))
  assert.equal(fails.length, 1, JSON.stringify(logs))
  assert.match(fails[0], /no pct\/tokens\+contextWindow shape/)
})

test('B7 agents.get(sessionId).session 兜底：sessions 服务缺席时仍能拿到活 Session', async () => {
  const meter = trackingMeter({
    measureResult: { totalTokens: 20_000 },
    pressureResult: { pressureTokens: 25_000, contextWindow: 50_000 },
  })
  const ports = makePorts(fakeServices({ attributeThrows: false }), () => {}, {
    ctx: fakeCtx({ tokenMeter: meter, agents: { get: (id) => (id === SESSION ? { session: LIVE } : undefined) } }),
  })
  assert.equal(await ports.usagePct(SESSION), 50)
  assert.deepEqual(meter.calls.measure, [LIVE])
})
