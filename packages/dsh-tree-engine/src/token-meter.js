/**
 * tokenMeter 使用率提取（v0.8.0 P0-B）——纯逻辑，不 import 任何宿主 API。
 *
 * 背景（S1 真机 E2E 实证，docs/reports/e2e-composition-relay-2026-11-12.md）：
 *   `index.js` 的 apply 只 inject `['tools','subagents','sessionQuery']`；在宿主代理上访问未 inject
 *   的服务属性（`services.tokenMeter`）会直接抛 `cannot get property "tokenMeter" without inject`，
 *   旧实现 catch 后 `return null` → 而 `ctxRef.get('tokenMeter')` 兜底在该 catch 内根本不可达
 *   → 宿主 usagePct **恒 null**（竹节只剩自报信号）。
 *
 * 修复拆成两半：
 *   ① 安全获取（`resolveTokenMeter`，本模块；每条候选路径独立 try，绝不让属性访问抛穿）；
 *   ② 纯提取（`extractUsagePct`，本模块；tokenMeter.measure 返回形状未冻结 → 候选字段防御提取）。
 *
 * v0.8.0 收口（E2E F3，docs/reports/e2e-relay-switch-2026-11-12.md §6）：拿到服务后入参契约仍不匹配——
 *   `measure()` 期望**活 Session 实例**（内部用 `session.seq` / `session.eventAt()`，投影 stateOf 调
 *   `session.snapshotEvents()`），而旧实现传的是 `sessionQuery.readSession()` 快照 →
 *   `session.snapshotEvents is not a function`。故新增：
 *   ③ 活 Session 解析（`resolveLiveSession`：`ctx.get('sessions').get(id)` 首要，Agent.session 兜底）；
 *   ④ 占用率综合（`resolveUsagePct`：`measure().totalTokens` 与 `contextPressure().pressureTokens /
 *      contextWindow` 两个读面）。
 *
 * 语义：
 *   - 返回 0–100 的整数；`null` 表示「无可用测量」→ 调用方回落自报（先到者生效），
 *     绝不返回 NaN / 负值 / 越界值（NaN 会让 `pct >= threshold` 恒 false，等于静默失效）。
 *   - 0–1 视为比例（归一化成百分数：0.42 → 42）；>1 视为百分数并截断到 100。
 */

/** measure() 返回形状的候选字段（顺序即优先级；形状未冻结，故多路径兼容）。 */
const CANDIDATE_READERS = Object.freeze([
  (m) => m?.pct,
  (m) => m?.contextPct,
  (m) => m?.context?.pct,
  (m) => m?.pressure?.pct,
  (m) => m?.usage?.pct,
])

/**
 * 单个数值归一化：0–1 → 百分数（四舍五入）；>1 → 百分数并截断 100；非法 → null。
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeUsagePct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value)
  return Math.min(100, pct)
}

/**
 * 从 tokenMeter.measure() 返回值中提取使用率百分比（纯函数，永不 throw）。
 * 依次尝试 pct / contextPct / context.pct / pressure.pct / usage.pct；
 * 单个候选非法（缺失/负数/NaN/字符串/异常 getter）→ 跳过继续找下一个。
 * @param {unknown} measure
 * @returns {number|null} 0–100 整数；无可用测量 → null
 */
export function extractUsagePct(measure) {
  for (const read of CANDIDATE_READERS) {
    let raw
    try { raw = read(measure) } catch { raw = undefined }   // 恶意/异常 getter 不抛穿
    const pct = normalizeUsagePct(raw)
    if (pct !== null) return pct
  }
  return null
}

/**
 * 安全获取 tokenMeter 服务（每条候选路径独立 try；宿主未 inject 的属性访问会抛错，绝不让它抛穿）。
 * 候选顺序：ctx.get('tokenMeter')（显式服务查找，最安全）→ services.tokenMeter（scoped 代理，
 * 未 inject 会抛，必须 try）→ ctx.tokenMeter（mixin 面兜底）。
 * 返回对象只要具备 measure() 或 contextPressure() 之一即算可用（真实 tokenMeter 两个都有）。
 * @param {{ services?: any, ctx?: any }} [sources]
 * @returns {{ measure?: (session: unknown) => any, contextPressure?: (session: unknown) => any } | null}
 */
export function resolveTokenMeter({ services, ctx } = {}) {
  /** @type {Array<() => any>} */
  const readers = [
    () => (typeof ctx?.get === 'function' ? ctx.get('tokenMeter') : undefined),
    () => services?.tokenMeter,
    () => ctx?.tokenMeter,
  ]
  for (const read of readers) {
    let meter
    try { meter = read() } catch { continue }
    if (meter && (typeof meter.measure === 'function' || typeof meter.contextPressure === 'function')) return meter
  }
  return null
}

/**
 * 活 Session 形状判定（tokenMeter 的 measure()/contextPressure() 期望**活 Session 实例**：
 * `measure()` 内部要用 `session.seq` / `session.eventAt(seq)`，投影服务 stateOf 会调
 * `session.snapshotEvents()`；`sessionQuery.readSession()` 返回的快照不是 Session——
 * E2E 实测传快照报 `session.snapshotEvents is not a function`）。
 * @param {any} session
 * @returns {boolean}
 */
export function isLiveSessionLike(session) {
  return !!session && typeof session === 'object' &&
    typeof session.eventAt === 'function' &&
    typeof session.snapshotEvents === 'function' &&
    typeof session.seq === 'number'
}

/**
 * 解析会话 id 对应的**活 Session**（v0.8.0 收口 F3）。
 *
 * tokenMeter.measure(session)/contextPressure(session) 的入参是宿主活 Session，不是 sessionQuery
 * 快照。候选路径（逐条独立 try，失败继续；绝不抛穿）：
 *   ① ctx.get('sessions').get(sessionId)   ← `dsh-session` SessionStore（resolve: get）首要路径
 *   ② services.sessions.get(sessionId)     ← scoped 兜底（未 inject 会抛，已包 try）
 *   ③ ctx.get('agents').get(sessionId).session  ← Agent → 其活 Session
 *   ④ services.agents.get(sessionId).session    ← scoped Agent 服务兜底
 * 只返回通过 {@link isLiveSessionLike} 的实例；会话已结束/仅持久化 → null（调用方回落自报）。
 * @param {{ services?: any, ctx?: any }} [sources]
 * @param {string} sessionId
 * @returns {any | null}
 */
export function resolveLiveSession({ services, ctx } = {}, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return null
  const tryStore = (read) => {
    let store
    try { store = read() } catch { return null }
    if (!store || typeof store.get !== 'function') return null
    let candidate
    try { candidate = store.get(sessionId) } catch { return null }
    // SessionStore.get → 活 Session；agents.get → Agent（取 .session）
    const session = candidate && typeof candidate === 'object' && candidate.session != null ? candidate.session : candidate
    return isLiveSessionLike(session) ? session : null
  }
  /** @type {Array<() => any>} */
  const readers = [
    () => (typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined),
    () => services?.sessions,
    () => (typeof ctx?.get === 'function' ? ctx.get('agents') : undefined),
    () => services?.agents,
  ]
  for (const read of readers) {
    const session = tryStore(read)
    if (session) return session
  }
  return null
}

/**
 * 由「已用 tokens / 上下文窗口」算占用百分比（0–100 整数；参数非法/窗口 ≤0 → null）。
 * UUID 无关，纯算术：clamp(round(used/window×100), 0, 100)。
 * @param {unknown} usedTokens
 * @param {unknown} contextWindow
 * @returns {number|null}
 */
export function pctFromTokens(usedTokens, contextWindow) {
  if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens) || usedTokens < 0) return null
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) return null
  return Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)))
}

/**
 * 从 tokenMeter 的两个读面综合出占用百分比（v0.8.0 收口 F3；纯函数，永不 throw）。
 *
 * 优先级：
 *   ① measurement 上的显式百分比字段（形状未冻结；`pct/contextPct/context.pct/pressure.pct/usage.pct`）；
 *   ② `contextPressure(session).pressureTokens / contextWindow`（provider 报量 / 容量，占用率最权威）；
 *   ③ `measure(session).totalTokens / contextPressure.contextWindow`（replay 测量 / 容量）；
 *   ④ pressure 上的显式百分比字段（未来形状兜底）。
 * 缺容量或数值非法 → null（调用方回落自报；绝不返回 NaN/越界）。
 * @param {{ measurement?: any, pressure?: any }} [readings]
 * @returns {number|null} 0–100 整数
 */
export function resolveUsagePct({ measurement, pressure } = {}) {
  const direct = extractUsagePct(measurement)
  if (direct !== null) return direct
  const window = pressure?.contextWindow
  if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
    const fromPressure = pctFromTokens(pressure?.pressureTokens, window)
    if (fromPressure !== null) return fromPressure
    const fromMeasurement = pctFromTokens(measurement?.totalTokens, window)
    if (fromMeasurement !== null) return fromMeasurement
  }
  return extractUsagePct(pressure)
}
