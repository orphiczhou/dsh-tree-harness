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
 *   - 现役 rc.2（嵌套形状，已被 rc.3 删除）：
 *       startActivation({ provider, label, request, signal, delivery })
 *       返回 { childId } | { sessionId }；
 *       interrupt(id, { kind: 'ancestor', agent } | { kind: 'user', parentSessionId })
 *   - 现役 rc.3（扁平形状，D28 真机实测 2026-11-13）：
 *       startActivation({ provider, label, signal, delivery, prompt, parent, agentOptions?, maxDepth? })
 *       —— `request` 字段展开到 spec 顶层（权威参考调用方 `dsh-tool-subagent:454-475` 用
 *       `...request` 展开；宿主 `dsh-subagent/lib/index.js:3021/3024/3025` 读
 *       `spec.maxDepth` / `spec.parent.id` / `spec.outputSchema` 顶层）。
 *       嵌套形状在 rc.3 下 `spec.parent === undefined` → TypeError "reading 'id'"
 *       → 所有派发 1 次调用内失败（真机 2026-11-13 22:2x E_PORTS_PROTOCOL 实证）。
 *       返回与 interrupt 形状 rc.2 → rc.3 不变（interrupt 三形 authority 兼容）。
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
 *   buildStartRequest({...})     → 起始请求体（v0.8.1：注入 maxDepth；非法值 fail-closed）
 *   buildActivationSpec({...})   → rc.3 扁平 startActivation spec（v0.10.1：request 展开到顶层）
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
 * 构造宿主起始请求体（v0.8.1，D22）：统一注入 `maxDepth`。
 *
 * 背景（asar 实证）：`@deepseek-ai/dsh-subagent` 的 `startActivation` / `startContinuable`
 * **只**校验调用方显式传入的 `request.maxDepth`（`lib/index.js:1402/1405`）；配置读取
 * `resolveMaxDepth`（`:3038-3045`）只被模型工具 `dsh-tool-subagent:452-462` 使用。
 * tree 派发此前不传该字段 → 组合路径深度无平台兜底（D22 实测 depth 6 未被拒）。
 *
 * @param {{ promptText?: string, parent?: any, agentOptions?: object, maxDepth?: number }} [input]
 * @returns {{ prompt: Array<{type:'text',text:string}>, parent: any, agentOptions?: object, maxDepth?: number }}
 * @throws {Error} maxDepth 非「非负整数」时 fail-closed（形状防御，不静默丢弃上限）
 */
export function buildStartRequest({ promptText, parent, agentOptions, maxDepth } = {}) {
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
    throw new Error(`maxDepth must be a non-negative integer (got ${typeof maxDepth} "${String(maxDepth)}")`)
  }
  const request = { prompt: [{ type: 'text', text: promptText ?? '' }], parent }
  if (agentOptions) request.agentOptions = agentOptions
  if (maxDepth !== undefined) request.maxDepth = maxDepth
  return request
}

/**
 * rc.3 扁平 startActivation spec（v0.10.1 / D28，2026-11-13 真机实测）。
 *
 * rc.3 起 `startActivation` 的 spec 为**扁平形状**：`request` 里的 prompt/parent/agentOptions/maxDepth
 * 必须展开到 spec 顶层（权威参考调用方 `dsh-tool-subagent/lib/index.js:454-475` 以 `...request` 展开；
 * 宿主 `dsh-subagent/lib/index.js:3018-3036` 直接读 `spec.maxDepth`/`spec.parent.id`/`spec.outputSchema`）。
 * rc.1/rc.2 的嵌套 `request:{...}` 形状在 rc.3 下 `spec.parent === undefined`
 * → TypeError `Cannot read properties of undefined (reading 'id')` → 派发全量失败
 * （tree-engine 真机 2026-11-13 22:2x `E_PORTS_PROTOCOL` 实证；flow 插件同款问题同日修复，见
 * flow 仓 T-2b-RC3-ADAPTER.md）。
 *
 * legacy（`startContinuable`）仍为嵌套 request 形状——本函数只服务 activation 分支；
 * `buildStartRequest` 仍是字段构造的唯一入口（含 maxDepth fail-closed），本函数只做展开。
 *
 * @param {{ provider?: string, label?: string, request?: object, signal?: AbortSignal, delivery?: string }} [input]
 * @returns {object} 扁平 spec：provider/label/signal/delivery 保留 + request 字段展开到顶层（不含 `request` 键）
 */
export function buildActivationSpec({ provider, label, request, signal, delivery } = {}) {
  const spec = {}
  if (provider !== undefined) spec.provider = provider
  if (label !== undefined) spec.label = label
  if (signal !== undefined) spec.signal = signal
  if (delivery !== undefined) spec.delivery = delivery
  return Object.assign(spec, request ?? {})
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
