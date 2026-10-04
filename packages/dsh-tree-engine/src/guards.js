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
 * 规则族：caller 必须 === 期望会话（owner）；root 信任锚例外。
 */
export function assertCallerIs(/** @type {any} */ caller, /** @type {string} */ expected, /** @type {string} */ what) {
  if (caller !== expected) {
    const err = new Error(`caller mismatch for ${what}: expected session of owner, got "${String(caller).slice(0, 8)}" (borrowed identity rejected)`)
    err.name = 'TreeStateError'
    err.code = 'E_BORROWED_IDENTITY'
    throw err
  }
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
