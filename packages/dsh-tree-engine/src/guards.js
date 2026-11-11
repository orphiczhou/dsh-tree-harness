/**
 * 护栏（Z6 稳定对象）— macp2 三件套 + UUID 严格校验 + caller 透传校验 + 命名校验。
 * 缺省值对齐源引擎 L325-327；全部可被 audit_meta / Config 覆盖。
 */

/** 严格 UUID v4（V10-uuid-format-strict：拒全 0/全 f/非 v4/空/null）。 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALL_ZERO = '00000000-0000-0000-0000-000000000000'
const ALL_F = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

/** @returns {boolean} */
export function isStrictUuidV4(/** @type {any} */ sid) {
  if (typeof sid !== 'string' || !sid.trim()) return false
  const s = sid.toLowerCase()
  if (s === ALL_ZERO || s === ALL_F) return false
  return UUID_V4_RE.test(s)
}

export const DEFAULT_GUARDS = /** @type {const} */ ({
  node_budget: 20,              // active leaf 上限（2026-07-08 macp2 后 10→20）
  max_subagent_spawn_per_leaf: 15,
  max_sessions: 50,             // ≈ node_budget × 2.5，留量给 segment 交接/auditor
  commander_max_depth: 3,
  ctx_segment_threshold: 85,    // 源缺省；DSH 配置缺省 42（PLAN §7）在引擎构造时注入
})

/**
 * macp2 会话爆炸护栏：树总会话（leaf.session_id + segment_chain + registry）去重计数。
 * @param {object} state
 * @param {string} newSessionId
 * @param {Partial<typeof DEFAULT_GUARDS>} guards
 * @returns {{ count: number, max: number, reached: boolean, isNew: boolean }}
 */
export function sessionBudget(state, newSessionId, guards = {}) {
  const max = typeof guards.max_sessions === 'number' ? guards.max_sessions : DEFAULT_GUARDS.max_sessions
  const ids = new Set()
  for (const leaf of Object.values(state.leaves ?? {})) {
    if (leaf.session_id) ids.add(leaf.session_id)
    for (const sid of leaf.segment_chain ?? []) ids.add(sid)
  }
  for (const sid of Object.keys(state.session_registry ?? {})) ids.add(sid)
  const isNew = !ids.has(newSessionId)
  const count = ids.size + (isNew ? 1 : 0)
  return { count, max, reached: count > max, isNew }
}

/** active leaf 数护栏（leaf_add 前置）。 */
export function activeLeafBudget(state, guards = {}) {
  const max = typeof guards.node_budget === 'number' ? guards.node_budget : DEFAULT_GUARDS.node_budget
  const count = Object.values(state.leaves ?? {}).filter((l) => l.status === 'active' || l.status === 'segment_pending' || l.status === 'pending_brief').length
  return { count, max, reached: count + 1 > max }
}

/** 单 leaf subagent_spawn 事件护栏。 */
export function spawnBudget(leaf, guards = {}) {
  const max = typeof guards.max_subagent_spawn_per_leaf === 'number' ? guards.max_subagent_spawn_per_leaf : DEFAULT_GUARDS.max_subagent_spawn_per_leaf
  const count = (leaf.events ?? []).filter((e) => e.type === 'subagent_spawn').length
  return { count, max, reached: count + 1 > max }
}

/**
 * caller 透传校验（防借身份，V10-self-audit-forbidden-v2 等五处）。
 * 规则族：caller 必须 === 期望会话（owner）；root 信任锚例外（由需 root 的调用点显式断言）。
 * fail-closed（P1-05 附带）：caller/expected 缺失、空串、非字符串一律视为不匹配——
 * 旧实现 assertCallerIs(undefined, undefined) 会通过，与 README「提取不到 → fail-closed」矛盾。
 */
export function assertCallerIs(/** @type {any} */ caller, /** @type {string} */ expected, /** @type {string} */ what) {
  const matched = typeof caller === 'string' && caller.length > 0 && typeof expected === 'string' && expected.length > 0 && caller === expected
  if (!matched) {
    const err = new Error(`caller mismatch for ${what}: expected session "${String(expected ?? '(none)').slice(0, 8)}", got "${String(caller).slice(0, 8)}" (borrowed identity rejected)`)
    err.name = 'TreeStateError'
    err.code = 'E_BORROWED_IDENTITY'
    throw err
  }
}

/**
 * leaf 写权矩阵（P1-05 统一写面护栏，审计 docs/audit-tree-system-2026-11-11.md P1-05）。
 *
 * 三个角色（每次判定都从当前 state 实时读取，竹节接力重绑 owner 后自动跟随）：
 *   owner   = leaf.session_id —— 当前执行者会话（首次派发/竹节接力后自动绑定）；
 *   creator = leaf.added_by  —— 创建该节点的指挥官会话（root 节点为 null → 无人可当 creator）；
 *   root    = 树根 leaf 的 session_id —— 信任锚（root 往往同时是 creator）。
 *
 * kind               owner  creator  root   语义
 *   context           ✅      ❌      ✅   自报上下文水位/竹节触发：执行者本人；root 监控兜底
 *   verification      ❌      ✅      ✅   tree_verify 落账：creator 验 owner——owner 不得自验
 *   event             ✅      ✅      ❌   非 done 事件（brief_echo/plan/progress/blocked/…）
 *   event:done        ✅      ❌      ❌   保持 V10-trust-anchor-fix：done 仅 owner，禁止代写
 *   cancel            ✅      ✅      ✅   dispatch:cancel：执行者/指挥官/root 均可止血
 *   status            ✅      ✅      ✅   保持既有语义（owner/creator/root）
 *   set-session       ❌      ✅      ❌   保持既有语义（仅 added_by 重绑；root 例外未开，避免扩大写面）
 *
 * 判定 fail-closed：caller 必须是 owner/creator/root 中的非空会话 id 字符串之一；
 * 缺失/空串/非字符串（含 caller 提取失败）一律拒。
 */
export const LEAF_WRITE_MATRIX = Object.freeze({
  context: Object.freeze({ owner: true, creator: false, root: true }),
  verification: Object.freeze({ owner: false, creator: true, root: true }),
  event: Object.freeze({ owner: true, creator: true, root: false }),
  'event:done': Object.freeze({ owner: true, creator: false, root: false }),
  cancel: Object.freeze({ owner: true, creator: true, root: true }),
  status: Object.freeze({ owner: true, creator: true, root: true }),
  'set-session': Object.freeze({ owner: false, creator: true, root: false }),
})

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

/** 归一 kind：event:<type> 除 done 外全部共用 'event' 规则（done 是独立更严规则）。 */
function ruleForKind(kind) {
  if (typeof kind !== 'string' || !kind) return null
  if (kind.startsWith('event:')) return kind === 'event:done' ? LEAF_WRITE_MATRIX['event:done'] : LEAF_WRITE_MATRIX.event
  return LEAF_WRITE_MATRIX[kind] ?? null
}

/**
 * 统一 leaf 写面所有权断言（P1-05）：按 LEAF_WRITE_MATRIX 判定 caller 是否有权写 leaf。
 * 非法 → TreeStateError + E_BORROWED_IDENTITY；错误信息含 kind、leaf_id、caller 前 8 字符。
 *
 * @param {object} state 当前树状态（用于在省略 rootSessionId 时解析 root 信任锚）
 * @param {object} leaf 目标 leaf（须已存在；缺失由调用方 mustLeaf 先处理）
 * @param {string} caller 调用会话 id
 * @param {'context'|'verification'|`event:${string}`|'cancel'|'status'|'set-session'} kind 写操作种类
 * @param {string} [rootSessionId] root leaf 的 session_id（缺省从 state.tree_id 派生）
 * @returns {true}
 */
export function assertLeafWriter(/** @type {any} */ state, /** @type {any} */ leaf, /** @type {any} */ caller, /** @type {string} */ kind, /** @type {string} */ rootSessionId = undefined) {
  const rule = ruleForKind(kind)
  if (!rule) {
    const err = new Error(`unknown leaf write kind "${String(kind)}" (not in LEAF_WRITE_MATRIX)`)
    err.name = 'TreeStateError'
    err.code = 'E_INTERNAL'
    throw err
  }
  const rootSid = rootSessionId !== undefined
    ? rootSessionId
    : state?.leaves?.[`${state?.tree_id ?? ''}-root`]?.session_id
  const owner = isNonEmptyString(caller) && isNonEmptyString(leaf?.session_id) && caller === leaf.session_id
  const creator = isNonEmptyString(caller) && isNonEmptyString(leaf?.added_by) && caller === leaf.added_by
  const root = isNonEmptyString(caller) && isNonEmptyString(rootSid) && caller === rootSid
  const allowed = (rule.owner === true && owner) || (rule.creator === true && creator) || (rule.root === true && root)
  if (!allowed) {
    const roles = ['owner', 'creator', 'root'].filter((r) => rule[/** @type {'owner'|'creator'|'root'} */ (r)] === true).join('|') || 'none'
    const err = new Error(`caller "${String(caller ?? '(missing)').slice(0, 8)}" cannot write ${kind} on leaf "${leaf?.leaf_id ?? '(unknown)'}" (allowed: ${roles}) — borrowed identity rejected`)
    err.name = 'TreeStateError'
    err.code = 'E_BORROWED_IDENTITY'
    throw err
  }
  return true
}

/**
 * 会话 id 全树唯一（leaf.session_id / segment_chain / registry 跨集合不重复）。
 * @returns {string|null} 冲突说明，null = 通过
 */
export function findSessionConflict(state, sessionId, excludeLeafId = undefined) {
  for (const leaf of Object.values(state.leaves ?? {})) {
    if (leaf.leaf_id === excludeLeafId) continue
    if (leaf.session_id === sessionId) return `session_id "${sessionId}" already used by leaf "${leaf.leaf_id}"`
    if ((leaf.segment_chain ?? []).includes(sessionId)) return `session_id "${sessionId}" already in segment_chain of leaf "${leaf.leaf_id}"`
  }
  if (state.session_registry && Object.prototype.hasOwnProperty.call(state.session_registry, sessionId)) {
    return `session_id "${sessionId}" already in session_registry`
  }
  return null
}
