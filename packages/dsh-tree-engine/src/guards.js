/**
 * 护栏（Z6 稳定对象）— macp2 三件套 + UUID 严格校验 + caller 透传校验 + 命名校验。
 * 缺省值对齐源引擎 L325-327；全部可被 audit_meta / Config 覆盖。
 *
 * W2.6（2026-11-12）root 会话 id 兼容：DSH 根/主会话 id 带 `session-` 前缀
 * （本机实测 `DSH_SESSION_ID=session-ae8a...`），而 subagent / dispatch 返回的 childId
 * 是裸 UUID。引擎内部一律以「归一化后的裸 UUID」为规范形：
 *   - 写入侧（engine.js init/leaf_add/set-session/segment/register）先归一化再校验/存储；
 *   - 比较侧（assertCallerIs / assertLeafWriter / sessionBudget / findSessionConflict /
 *     validate）比较前归一化——历史 state 里存的带前缀旧值也能继续匹配。
 * 未改动 leaf owner 存储语义（仍是裸 UUID），未放宽 UUID v4 严格性（归一化后仍严格校验）。
 */

/** 严格 UUID v4（V10-uuid-format-strict：拒全 0/全 f/非 v4/空/null）。 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALL_ZERO = '00000000-0000-0000-0000-000000000000'
const ALL_F = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const SESSION_PREFIX = 'session-'

/** @returns {boolean} */
export function isStrictUuidV4(/** @type {any} */ sid) {
  if (typeof sid !== 'string' || !sid.trim()) return false
  const s = sid.toLowerCase()
  if (s === ALL_ZERO || s === ALL_F) return false
  return UUID_V4_RE.test(s)
}

/**
 * 会话 id 归一化（W2.6）：剥掉可选 `session-` 前缀、trim、统一小写（UUID 大小写不敏感；
 * `isStrictUuidV4` 用 /i 接受大写，若归一化不折小写，同一会话的大小写形态会去重失败）。
 * 非字符串原样返回。只用于身份比较与存储规范形，不做校验（校验见 isStrictUuidV4 / isNormalizedStrictUuidV4）。
 * @param {any} v
 * @returns {any}
 */
export function normalizeSessionId(v) {
  if (typeof v !== 'string') return v
  const s = v.trim()
  const body = s.toLowerCase().startsWith(SESSION_PREFIX) ? s.slice(SESSION_PREFIX.length) : s
  return body.toLowerCase()
}

/** 严格 UUID v4，允许可选 `session-` 前缀（先归一化再校验；W2.6）。 */
export function isNormalizedStrictUuidV4(/** @type {any} */ sid) {
  return isStrictUuidV4(normalizeSessionId(sid))
}

/**
 * 归一化后比较两个会话 id（W2.6 身份比较唯一入口；fail-closed）。
 * 任一缺失/空串/非字符串 → false（不把「都没值」当成匹配）。
 */
export function sameSession(/** @type {any} */ a, /** @type {any} */ b) {
  const na = normalizeSessionId(a)
  const nb = normalizeSessionId(b)
  return typeof na === 'string' && na.length > 0 && typeof nb === 'string' && nb.length > 0 && na === nb
}

export const DEFAULT_GUARDS = /** @type {const} */ ({
  node_budget: 20,              // active leaf 上限（2026-07-08 macp2 后 10→20）
  max_subagent_spawn_per_leaf: 15,
  max_sessions: 50,             // ≈ node_budget × 2.5，留量给 segment 交接/auditor
  commander_max_depth: 3,
  // v0.8.1（D22）：派发子会话的绝对深度上限（写入宿主 `request.maxDepth`）。
  // 宿主 dsh-subagent 仅在调用方显式传该字段时校验；tree 派发此前缺省不传 → 无上限（D22 实测 depth 6 未被拒）。
  // 缺省与 desktop profile `subagent.maxDepth=5` 对齐。
  max_subagent_depth: 5,
  ctx_segment_threshold: 85,    // 源缺省；DSH 配置缺省 42（PLAN §7）在引擎构造时注入
})

/**
 * macp2 会话爆炸护栏：树总会话（leaf.session_id + segment_chain + registry）去重计数。
 * W2.1（2026-11-12）：把 runtime.segmentChain（竹节接力产生的历史会话）也纳入计数；
 * 比较前按 normalizeSessionId 归一化，跨前缀/裸 UUID 形态只算一次。
 * @param {object} state
 * @param {string} newSessionId
 * @param {Partial<typeof DEFAULT_GUARDS>} guards
 * @returns {{ count: number, max: number, reached: boolean, isNew: boolean }}
 */
export function sessionBudget(state, newSessionId, guards = {}) {
  const max = typeof guards.max_sessions === 'number' ? guards.max_sessions : DEFAULT_GUARDS.max_sessions
  const ids = new Set()
  for (const leaf of Object.values(state.leaves ?? {})) {
    if (leaf.session_id) ids.add(normalizeSessionId(leaf.session_id))
    for (const sid of leaf.segment_chain ?? []) ids.add(normalizeSessionId(sid))
    // W2.1：竹节接力（bambooRelay）只把历史会话写入 leaf.runtime.segmentChain；旧实现漏计导致 max_sessions 失效。
    for (const sid of leaf.runtime?.segmentChain ?? []) ids.add(normalizeSessionId(sid))
  }
  for (const sid of Object.keys(state.session_registry ?? {})) ids.add(normalizeSessionId(sid))
  const normNew = normalizeSessionId(newSessionId)
  const isNew = !ids.has(normNew)
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
 * W2.6：比较走归一化 sameSession（`session-` 前缀与裸 UUID 视为同一会话）。
 */
export function assertCallerIs(/** @type {any} */ caller, /** @type {string} */ expected, /** @type {string} */ what) {
  const matched = sameSession(caller, expected)
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
 *   owner    = leaf.session_id —— 当前执行者会话（首次派发/竹节接力后自动绑定）；
 *   creator  = leaf.added_by  —— 创建该节点的指挥官会话（root 节点为 null → 无人可当 creator）；
 *   root     = 树根 leaf 的 session_id —— 信任锚（root 往往同时是 creator）；
 *   delegate = state.verify_delegates —— A4 验证授权委托：root 会话事前授予的受信会话列表
 *             （tree 级、全量替换语义；现场建树模式 root 会话 dispose 后由被授权者事后补验证）。
 *
 * kind               owner  creator  root  delegate  语义
 *   context           ✅      ❌      ✅      ❌    自报上下文水位/竹节触发：执行者本人；root 监控兜底
 *   verification      ❌      ✅      ✅      ✅    tree_verify 落账：creator 验 owner——owner 不得自验；
 *                                                  A4 授权委托：verify_delegates 命中者可补验证（最小授权面，
 *                                                  仅 verification 放行 delegate，其余 kind 一律 ❌）
 *   event             ✅      ✅      ❌      ❌    非 done 事件（brief_echo/plan/progress/blocked/…）
 *   event:done        ✅      ❌      ❌      ❌    保持 V10-trust-anchor-fix：done 仅 owner，禁止代写
 *   event:subagent_spawn ✅   ❌      ❌      ❌    flash 审计 #22：预算事件仅 owner 自报（creator/root 代写
 *                                                  可把他人 leaf 的 15 次 spawn 预算一次耗尽 = 预算 DoS 向量）
 *   cancel            ✅      ✅      ✅      ❌    dispatch:cancel：执行者/指挥官/root 均可止血
 *   status            ✅      ✅      ✅      ❌    保持既有语义（owner/creator/root）
 *   set-session       ❌      ✅      ❌      ❌    保持既有语义（仅 added_by 重绑；root 例外未开，避免扩大写面）
 *   relay             ❌      ✅      ✅      ❌    v0.8.0 per-leaf 竹节开关（set-relay）：指挥官/root 决定节点是否参与竹节；
 *                                                  执行者（owner）不得自关——等待外部编排的 leaf 由派发方在派发前/后设置
 *
 * 判定 fail-closed：caller 必须是 owner/creator/root/delegate 中的非空会话 id 字符串之一
 * （delegate 仅在 kind 的 delegate 列为 ✅ 时参与判定；命中 verify_delegates 但写其它 kind 一律拒）；
 * 缺失/空串/非字符串（含 caller 提取失败）一律拒。
 * W2.6：四类角色比较均走归一化 sameSession（root 会话带 `session-` 前缀时仍可命中裸 UUID 信任锚；
 * verify_delegates 由写入侧（engine verify-delegate）归一化后存储，比较侧再次归一化双保险）。
 * A4 授权面收口：owner 自验禁令不放宽——owner 除非同时是 creator/root/delegate，否则写 verification 仍拒。
 */
export const LEAF_WRITE_MATRIX = Object.freeze({
  context: Object.freeze({ owner: true, creator: false, root: true, delegate: false }),
  verification: Object.freeze({ owner: false, creator: true, root: true, delegate: true }),
  event: Object.freeze({ owner: true, creator: true, root: false, delegate: false }),
  'event:done': Object.freeze({ owner: true, creator: false, root: false, delegate: false }),
  // flash 审计 #22：subagent_spawn 是**预算事件**——仅 owner（执行者本人）可自报；
  // creator/root 代写可把他人 leaf 的 15 次 spawn 预算一次耗尽（预算反成 DoS 向量）。
  'event:subagent_spawn': Object.freeze({ owner: true, creator: false, root: false, delegate: false }),
  cancel: Object.freeze({ owner: true, creator: true, root: true, delegate: false }),
  status: Object.freeze({ owner: true, creator: true, root: true, delegate: false }),
  'set-session': Object.freeze({ owner: false, creator: true, root: false, delegate: false }),
  // v0.8.0（P0-A）：per-leaf 竹节开关。仅指挥官（creator）与 root 信任锚可改——owner 不得自关竹节。
  relay: Object.freeze({ owner: false, creator: true, root: true, delegate: false }),
})

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

/** 归一 kind：event:<type> 除 done / subagent_spawn 外全部共用 'event' 规则。 */
function ruleForKind(kind) {
  if (typeof kind !== 'string' || !kind) return null
  if (kind.startsWith('event:')) {
    if (kind === 'event:done') return LEAF_WRITE_MATRIX['event:done']
    if (kind === 'event:subagent_spawn') return LEAF_WRITE_MATRIX['event:subagent_spawn']
    return LEAF_WRITE_MATRIX.event
  }
  return LEAF_WRITE_MATRIX[kind] ?? null
}

/**
 * 统一 leaf 写面所有权断言（P1-05）：按 LEAF_WRITE_MATRIX 判定 caller 是否有权写 leaf。
 * 非法 → TreeStateError + E_BORROWED_IDENTITY；错误信息含 kind、leaf_id、caller 前 8 字符。
 * A4：kind='verification' 时额外放行 state.verify_delegates 命中者（验证授权委托，归一化比较）；
 * 其它 kind 即使命中 verify_delegates 也一律拒（最小授权面；owner 自验禁令不受 delegate 放宽）。
 *
 * @param {object} state 当前树状态（用于在省略 rootSessionId 时解析 root 信任锚 / verify_delegates）
 * @param {object} leaf 目标 leaf（须已存在；缺失由调用方 mustLeaf 先处理）
 * @param {string} caller 调用会话 id
 * @param {'context'|'verification'|`event:${string}`|'cancel'|'status'|'set-session'|'relay'} kind 写操作种类
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
  // W2.6：归一化比较（caller 带 session- 前缀、state 存裸 UUID 时仍命中）
  const owner = isNonEmptyString(caller) && sameSession(caller, leaf?.session_id)
  const creator = isNonEmptyString(caller) && sameSession(caller, leaf?.added_by)
  const root = isNonEmptyString(caller) && sameSession(caller, rootSid)
  // A4 验证授权委托：tree 级 verify_delegates（写入侧已归一化存储；旧树缺字段惰性缺省 []）。
  // 仅 kind 的 delegate 列为 true 时参与判定——命中列表但写其它 kind 一律不放行（最小授权面）。
  const delegates = Array.isArray(state?.verify_delegates) ? state.verify_delegates : []
  const delegated = isNonEmptyString(caller) && delegates.some((sid) => sameSession(caller, sid))
  const allowed = (rule.owner === true && owner)
    || (rule.creator === true && creator)
    || (rule.root === true && root)
    || (rule.delegate === true && delegated)
  if (!allowed) {
    const roles = ['owner', 'creator', 'root', 'delegate'].filter((r) => rule[/** @type {'owner'|'creator'|'root'|'delegate'} */ (r)] === true).join('|') || 'none'
    const err = new Error(`caller "${String(caller ?? '(missing)').slice(0, 8)}" cannot write ${kind} on leaf "${leaf?.leaf_id ?? '(unknown)'}" (allowed: ${roles}) — borrowed identity rejected`)
    err.name = 'TreeStateError'
    err.code = 'E_BORROWED_IDENTITY'
    throw err
  }
  return true
}

/**
 * 会话 id 全树唯一（leaf.session_id / segment_chain / runtime.segmentChain / registry
 * 跨集合不重复；W2.6 归一化比较、W2.1 纳入 runtime 竹节链）。
 * @returns {string|null} 冲突说明，null = 通过
 */
export function findSessionConflict(state, sessionId, excludeLeafId = undefined) {
  const norm = normalizeSessionId(sessionId)
  for (const leaf of Object.values(state.leaves ?? {})) {
    if (leaf.leaf_id === excludeLeafId) continue
    if (sameSession(leaf.session_id, norm)) return `session_id "${sessionId}" already used by leaf "${leaf.leaf_id}"`
    if ((leaf.segment_chain ?? []).some((sid) => sameSession(sid, norm))) return `session_id "${sessionId}" already in segment_chain of leaf "${leaf.leaf_id}"`
    if ((leaf.runtime?.segmentChain ?? []).some((sid) => sameSession(sid, norm))) return `session_id "${sessionId}" already in runtime.segmentChain of leaf "${leaf.leaf_id}"`
  }
  if (state.session_registry) {
    for (const key of Object.keys(state.session_registry)) {
      if (sameSession(key, norm)) return `session_id "${sessionId}" already in session_registry`
    }
  }
  return null
}
