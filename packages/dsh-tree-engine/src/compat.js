/**
 * 宿主 subagents 服务兼容层（纯逻辑）—— index.js 双形探测/返回解析的可单测抽取。
 *
 * 用途
 *   DSH 0.2.1-rc.2 升级后，宿主 `subagents` 服务存在两套形状；本模块只做「辨认 + 解析 + 候选构造」，
 *   不触碰宿主服务、不做 IO、无第三方依赖、不 import 任何 `@deepseek-ai/*`。调用宿主函数仍由 index.js 完成。
 *   - legacy 基线（引擎 v0.4.0 编写期）：
 *       startContinuable({ provider, label, signal, request })
 *       返回 { childId } | { sessionId } | { session: { id } }；
 *       interrupt(id, { kind: 'parent', parentSessionId })
 *   - 现役 rc.2：
 *       startActivation({ provider, label, request, signal, delivery })
 *       返回 { childId } | { sessionId }；
 *       interrupt(id, { kind: 'ancestor', agent } | { kind: 'user', parentSessionId })
 *
 * 分支表（冻结）
 *   detectStartMechanism(subagents)
 *     subagents 非对象 / 两形都缺              → 'none'（调用方 fail-closed 报 NO_START_MECHANISM_MESSAGE）
 *     typeof startContinuable === 'function'   → 'legacy'（即使 startActivation 同时存在）
 *     typeof startActivation === 'function'    → 'activation'
 *   detectInterruptMechanism(subagents)   —— interrupt 存在即可用；形状差异由 buildInterruptAuthorities 的候选顺序体现
 *     subagents 非对象 / interrupt 非函数       → 'none'（调用方静默跳过中断）
 *     startContinuable 是函数 / startActivation 缺席 → 'legacy'（legacy 基线也可能只暴露 interrupt）
 *     仅 startActivation 是函数                → 'activation'
 *   resolveContinuableResult(r)  → r.childId ?? r.sessionId ?? r.session?.id；全空 → 抛错（证据 ≤200 字符）
 *   resolveActivationResult(r)   → r.childId ?? r.sessionId；全空 → 抛错（证据 ≤200 字符）
 *   buildInterruptAuthorities({ parentSessionId, liveAncestorAgent })
 *     → [{ kind: 'ancestor', agent }] → [{ kind: 'user', parentSessionId }] → [{ kind: 'parent', parentSessionId }]
 *
 * 与 index.js 的集成点（行号按 master e09f39b）
 *   - L315-L328 startChildSession：legacy/rc.2 双形探测 + 返回解析 → detectStartMechanism 分派，
 *     resolveContinuableResult / resolveActivationResult 解析；两形都缺抛 NO_START_MECHANISM_MESSAGE。
 *   - L331-L348 interruptChildCompat：候选构造 → buildInterruptAuthorities（L334 的活 Agent 查找
 *     pickLiveAncestorAgent 触碰宿主服务，保留在 index.js，其结果作为 liveAncestorAgent 入参）。
 *   - L293 resolveAgentsService / L301 pickLiveAncestorAgent 保留在 index.js（非纯逻辑）。
 *
 * legacy 优先语义冻结
 *   `detectStartMechanism` 必须先判 startContinuable、再判 startActivation：两形并存的旧宿主行为
 *   不得因 rc.2 支持而改变。中断仍按 ancestor → user → parent 顺序逐候选尝试（首个不抛错者胜出）；
 *   parentSessionId 缺失时只剩 legacy 形状候选，无候选则调用方静默返回（同现实现）。
 *
 * 注意（以现实现为准，勿照任务书草写的形状改）
 *   现实现 L337 的 user 候选携带字段是 `parentSessionId`（不是 `sessionId`）；本模块逐字保留。
 */

/** 错误证据截断上限（与 index.js L318/L324 的 slice(0, 200) 一致）。 */
const EVIDENCE_LIMIT = 200

/** 两形都缺时的协议错文案（index.js L327 逐字冻结）。 */
export const NO_START_MECHANISM_MESSAGE = 'host subagents service exposes neither startContinuable nor startActivation'

/**
 * 安全证据串：JSON.stringify 可能因 undefined / 循环引用 / 异常 getter 抛错（现实现此处会漏出 TypeError），
 * 纯模块统一降级为可读证据。正常形状输出与 `JSON.stringify(value).slice(0, 200)` 逐字一致。
 * @param {unknown} value
 * @returns {string}
 */
function evidenceOf(value) {
  let text
  try {
    const json = JSON.stringify(value)
    text = json === undefined ? String(value) : json
  } catch {
    try { text = String(value) } catch { text = '[unserializable]' }
  }
  return text.slice(0, EVIDENCE_LIMIT)
}

/**
 * 解析 legacy `startContinuable` 返回值：childId ?? sessionId ?? session.id；都取不到 → 抛错。
 * @param {any} result
 * @returns {string}
 */
export function resolveContinuableResult(result) {
  const sessionId = result?.childId ?? result?.sessionId ?? result?.session?.id
  if (!sessionId) throw new Error(`unrecognized startContinuable result: ${evidenceOf(result)}`)
  return sessionId
}

/**
 * 解析 rc.2 `startActivation` 返回值：childId ?? sessionId；都取不到 → 抛错（不认 session.id，同现实现）。
 * @param {any} result
 * @returns {string}
 */
export function resolveActivationResult(result) {
  const sessionId = result?.childId ?? result?.sessionId
  if (!sessionId) throw new Error(`unrecognized startActivation result: ${evidenceOf(result)}`)
  return sessionId
}

/**
 * 起始机制探测：legacy 优先；非对象/两形都缺 → 'none'。异常 getter 按 none 处理（防御性，不吞调用方错误）。
 * @param {any} subagents
 * @returns {'legacy'|'activation'|'none'}
 */
export function detectStartMechanism(subagents) {
  try {
    if (!subagents || typeof subagents !== 'object') return 'none'
    if (typeof subagents.startContinuable === 'function') return 'legacy'
    if (typeof subagents.startActivation === 'function') return 'activation'
    return 'none'
  } catch {
    return 'none'
  }
}

/**
 * 中断机制探测：interrupt 非函数 → 'none'；形状随起始机制（legacy 优先，缺省 legacy 基线）。
 * 仅作粗判/诊断用——实际候选顺序由 buildInterruptAuthorities 决定，调用方仍逐候选尝试。
 * @param {any} subagents
 * @returns {'legacy'|'activation'|'none'}
 */
export function detectInterruptMechanism(subagents) {
  try {
    if (!subagents || typeof subagents !== 'object') return 'none'
    if (typeof subagents.interrupt !== 'function') return 'none'
    if (typeof subagents.startActivation === 'function' && typeof subagents.startContinuable !== 'function') return 'activation'
    return 'legacy'
  } catch {
    return 'none'
  }
}

/**
 * 中断 authority 候选构造（顺序即重试顺序，逐字对齐 index.js L333-L339）：
 *   1) 活祖先 Agent：{ kind: 'ancestor', agent }（仅当调用方传入；index.js 只在 parentSessionId 存在时查找）
 *   2) 父会话地址：  { kind: 'user', parentSessionId }
 *   3) legacy 形状：  { kind: 'parent', parentSessionId }
 * @param {{ parentSessionId?: string, liveAncestorAgent?: any }} [input]
 * @returns {Array<{ kind: 'ancestor', agent: any } | { kind: 'user', parentSessionId: string } | { kind: 'parent', parentSessionId: string }>}
 */
export function buildInterruptAuthorities({ parentSessionId, liveAncestorAgent } = {}) {
  const authorities = []
  if (liveAncestorAgent) authorities.push({ kind: 'ancestor', agent: liveAncestorAgent })
  if (parentSessionId) {
    authorities.push({ kind: 'user', parentSessionId })
    authorities.push({ kind: 'parent', parentSessionId })
  }
  return authorities
}
