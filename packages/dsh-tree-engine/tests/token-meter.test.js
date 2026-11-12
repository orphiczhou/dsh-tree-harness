/**
 * tokenMeter 使用率提取单测（v0.8.0 P0-B）。
 *
 * 背景：宿主 `usagePct` 曾因未 inject 服务属性访问抛错而恒 null；修复把「安全获取」与
 * 「百分比提取」拆成纯逻辑。本文件锁死形状兼容与归一化语义：
 *   pct / contextPct / context.pct / pressure.pct / usage.pct → 0-100 整数；
 *   0-1 归一；>100 截断；非法 → null（绝不返回 NaN/负数/越界，否则竹节静默失效）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractUsagePct, isLiveSessionLike, normalizeUsagePct, pctFromTokens,
  resolveLiveSession, resolveTokenMeter, resolveUsagePct,
} from '../src/token-meter.js'

test('pct：直接百分数 → 整数（0 / 42 / 100 原样）', () => {
  assert.equal(extractUsagePct({ pct: 42 }), 42)
  assert.equal(extractUsagePct({ pct: 0 }), 0)
  assert.equal(extractUsagePct({ pct: 100 }), 100)
})

test('contextPct / context.pct：两种上下文形状都支持', () => {
  assert.equal(extractUsagePct({ contextPct: 55 }), 55)
  assert.equal(extractUsagePct({ context: { pct: 33 } }), 33)
})

test('pressure.pct / usage.pct：压力与用量形状兜底', () => {
  assert.equal(extractUsagePct({ pressure: { pct: 61 } }), 61)
  assert.equal(extractUsagePct({ usage: { pct: 77 } }), 77)
})

test('0-1 归一：比例值 ×100 四舍五入（0.42→42、1→100、0→0、0.005→1）', () => {
  assert.equal(extractUsagePct({ pct: 0.42 }), 42)
  assert.equal(extractUsagePct({ pct: 1 }), 100)
  assert.equal(extractUsagePct({ pct: 0 }), 0)
  assert.equal(extractUsagePct({ pct: 0.005 }), 1)
})

test('0-100 截断与四舍五入：>100 → 100；小数取整', () => {
  assert.equal(extractUsagePct({ pct: 105 }), 100)
  assert.equal(extractUsagePct({ pct: 99.6 }), 100)
  assert.equal(extractUsagePct({ pct: 12.4 }), 12)
  assert.equal(normalizeUsagePct(1000), 100)
})

test('非法值 → null（负数 / NaN / Infinity / 字符串 / 布尔 / 空对象 / null / undefined）', () => {
  for (const bad of [{ pct: -1 }, { pct: Number.NaN }, { pct: Number.POSITIVE_INFINITY }, { pct: '42' }, { pct: true }, {}, null, undefined]) {
    assert.equal(extractUsagePct(bad), null, `expected null for ${JSON.stringify(bad)}`)
  }
  assert.equal(normalizeUsagePct(-0.5), null)
  assert.equal(normalizeUsagePct(Number.NaN), null)
  assert.equal(normalizeUsagePct('80'), null)
})

test('候选顺序：非法候选跳过、继续找下一个（pct 非法 → contextPct；再 → pressure.pct）', () => {
  assert.equal(extractUsagePct({ pct: '42', contextPct: 30 }), 30)
  assert.equal(extractUsagePct({ pct: -1, pressure: { pct: 80 } }), 80)
  assert.equal(extractUsagePct({ pct: Number.NaN, context: { pct: 66 } }), 66)
})

test('异常 getter 不抛穿：坏形状跳过 → 继续下一个候选', () => {
  const hostile = {
    get pct() { throw new Error('boom') },
    contextPct: 28,
  }
  assert.equal(extractUsagePct(hostile), 28)
  assert.doesNotThrow(() => extractUsagePct({ get pct() { throw new Error('boom') } }))
  assert.equal(extractUsagePct({ get pct() { throw new Error('boom') } }), null)
})

test('resolveTokenMeter：ctx.get 优先；services 未 inject 属性访问抛错也不炸', () => {
  const viaCtx = { measure: () => ({ pct: 5 }) }
  const ctx = { get: (name) => (name === 'tokenMeter' ? viaCtx : undefined) }
  // services 的 tokenMeter 属性访问抛错（模拟宿主代理未 inject）——必须被 try 吞掉，不得抛穿
  const services = Object.defineProperty({}, 'tokenMeter', { get() { throw new Error('cannot get property "tokenMeter" without inject') } })
  assert.equal(resolveTokenMeter({ services, ctx }), viaCtx)
})

test('resolveTokenMeter：ctx.get 抛错 / 返回非 meter → 回退 services.tokenMeter', () => {
  const viaServices = { measure: () => ({}) }
  const ctx = { get: () => { throw new Error('no such service') } }
  assert.equal(resolveTokenMeter({ services: { tokenMeter: viaServices }, ctx }), viaServices)
  // ctx.get 返回不含 measure 的对象 → 不算命中
  const ctxLoose = { get: () => ({ nope: true }) }
  assert.equal(resolveTokenMeter({ services: { tokenMeter: viaServices }, ctx: ctxLoose }), viaServices)
})

test('resolveTokenMeter：全不可用 → null（不抛错），measure 非函数过滤', () => {
  assert.equal(resolveTokenMeter(), null)
  assert.equal(resolveTokenMeter({}), null)
  assert.equal(resolveTokenMeter({ services: { tokenMeter: { measure: 'not-a-fn' } }, ctx: { get: () => undefined } }), null)
  // ctx 自身抛错的 get 也不得抛穿
  assert.equal(resolveTokenMeter({ services: {}, ctx: { get() { throw new Error('boom') } } }), null)
  // ctx.get 不可用 + services.tokenMeter 属性访问抛错（未 inject 的宿主代理）→ null 而不是抛错
  const hostileServices = Object.defineProperty({}, 'tokenMeter', { get() { throw new Error('cannot get property "tokenMeter" without inject') } })
  assert.doesNotThrow(() => resolveTokenMeter({ services: hostileServices }))
  assert.equal(resolveTokenMeter({ services: hostileServices }), null)
})

// ── v0.8.0 收口（E2E F3）：活 Session 解析 / 容量折算 / 双读面综合 ──────

/** 最小活 Session 形状（tokenMeter 需要 seq/eventAt/snapshotEvents）。 */
const LIVE = Object.freeze({ seq: 7, eventAt: () => ({}), snapshotEvents: () => [] })
const looksLikeSnapshot = Object.freeze({ header: { sessionId: 'x' }, events: [] })   // readSession 快照：没有 Session 方法

test('isLiveSessionLike：真 Session 形状通过；readSession 快照/空值拒绝', () => {
  assert.equal(isLiveSessionLike(LIVE), true)
  assert.equal(isLiveSessionLike(looksLikeSnapshot), false)
  assert.equal(isLiveSessionLike({ seq: 1, eventAt() {} }), false, 'snapshotEvents missing → reject')
  assert.equal(isLiveSessionLike(null), false)
  assert.equal(isLiveSessionLike(undefined), false)
})

test('resolveLiveSession：ctx.sessions.get 首要路径；快照形状拒绝（不回退把快照当 Session）', () => {
  const sessions = { get: (id) => (id === 'sid-1' ? LIVE : undefined) }
  const ctx = { get: (name) => (name === 'sessions' ? sessions : undefined) }
  assert.equal(resolveLiveSession({ ctx }, 'sid-1'), LIVE)
  assert.equal(resolveLiveSession({ ctx }, 'sid-unknown'), null)
  // sessions 服务只返回快照形状 → 拒绝而不是当 Session 用
  const snapStore = { get: () => looksLikeSnapshot }
  assert.equal(resolveLiveSession({ ctx: { get: () => snapStore } }, 'sid-1'), null)
  assert.equal(resolveLiveSession({ ctx }, ''), null)
  assert.equal(resolveLiveSession({}, undefined), null)
})

test('resolveLiveSession：ctx.get 抛错不炸；agents.get(id).session 兜底', () => {
  const ctxThrow = { get: () => { throw new Error('no service') } }
  assert.equal(resolveLiveSession({ ctx: ctxThrow }, 'sid-1'), null)   // sessions/agents 都拿不到 → null，不抛
  const agents = { get: (id) => (id === 'sid-1' ? { session: LIVE } : undefined) }
  const ctx = { get: (name) => (name === 'agents' ? agents : undefined) }
  assert.equal(resolveLiveSession({ ctx }, 'sid-1'), LIVE)
})

test('pctFromTokens：used/window 折算 0–100 整数；非法/窗口 ≤0 → null', () => {
  assert.equal(pctFromTokens(42_000, 100_000), 42)
  assert.equal(pctFromTokens(0, 100_000), 0)
  assert.equal(pctFromTokens(105_000, 100_000), 100, 'over-window clamps to 100')
  assert.equal(pctFromTokens(1_250, 100_000), 1, 'rounds to nearest integer')
  for (const bad of [[-1, 100], [10, 0], [10, -5], [Number.NaN, 100], [10, Number.NaN], ['42', 100], [42, '100']]) {
    assert.equal(pctFromTokens(...bad), null, JSON.stringify(bad))
  }
})

test('resolveUsagePct：measure 显式百分比优先 → contextPressure 容量折算 → measure.totalTokens 兜底', () => {
  // ① 显式百分比字段优先（形状未冻结的兼容面）
  assert.equal(resolveUsagePct({ measurement: { pct: 42 }, pressure: { pressureTokens: 9, contextWindow: 10 } }), 42)
  // ② provider 报量 / 容量
  assert.equal(resolveUsagePct({ measurement: { totalTokens: 50_000 }, pressure: { pressureTokens: 42_000, contextWindow: 100_000 } }), 42)
  // ③ measure.totalTokens 用 contextPressure.contextWindow 折算
  assert.equal(resolveUsagePct({ measurement: { totalTokens: 25_000 }, pressure: { contextWindow: 100_000 } }), 25)
  // 缺容量 → null（不编造百分比）
  assert.equal(resolveUsagePct({ measurement: { totalTokens: 25_000 }, pressure: {} }), null)
  assert.equal(resolveUsagePct({}), null)
  // pressure 自带百分比字段兜底
  assert.equal(resolveUsagePct({ pressure: { contextPct: 0.68 } }), 68)
})

test('resolveTokenMeter：只有 contextPressure()（无 measure）也算可用服务', () => {
  const pressureOnly = { contextPressure: () => ({}) }
  assert.equal(resolveTokenMeter({ ctx: { get: () => pressureOnly } }), pressureOnly)
})
