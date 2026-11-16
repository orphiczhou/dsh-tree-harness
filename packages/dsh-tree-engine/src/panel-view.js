/**
 * Tree 运行面板 · Host 侧只读投影（与 flow 插件 lib/panel-view.js 同构的纯函数层）。
 *
 * 定位（对齐 flow M1/T12 口径）：
 *   - 数据源唯一：store.list()/store.read()（tree_doctor 同款只读读取面）——**绝不走 engine.call()**
 *     （call 会落 call-log 观测账本，面板轮询会把账本写爆；doctor 先例 L184 注释同因）；
 *   - 纯函数投影：树状态 → 面板 JSON 形状；截断/脱敏口径在本文件集中实现；
 *   - 零写副作用：除 store.read/list 与 tree-state.json mtime stat 外不触碰任何 IO。
 *
 * 安全口径（对照 flow ADR-013 §5 / lib/panel-view.js 截断口径）：
 *   - **绝不输出**：leaf.brief/dod 正文、事件 meta 内容、runtime.handoffBrief/runtime.history、
 *     drift reason、verdict detail（可能含 stderr/stdout 片段）、session_registry 的会话 id 明细、
 *     任何 token/密钥形态字段；done 事件只透出 meta.summary 且 ≤200 字符；
 *     runtime 只透出结算态 `state` 一个字符串（v1.6.2 起，供派生展示状态）；
 *   - assignee 只透出 provider/model/effort 三键（preset/mechanism 等一律剥除）；
 *   - verification 投影为 {pass, attempts, lastVerdict, policy}（缺省 null）；
 *   - 事件只给信封（seq/ts/leafId/type），绝不给 payload/meta 全文；
 *   - **展示状态派生**（v1.6.2 起，见 {@link displayStateOf}）：`leaf.status` 是启封态，
 *     结算权威在 done 事件 → `runtime.state` + `verification.pass`；投影的 `status` 字段
 *     因此是派生展示态，原始 `leaf.status` 另存 `rawStatus`、`runtime.state` 另存 `runtimeState`。
 *
 * seq 语义（本仓树状态无原生事件 seq，flow journal 的 seq 在此为派生序）：
 *   flattenEvents() 把全树事件按 (ts 升序, leafId 升序, 叶内序) 稳定排序后 1 起编号。
 *   各叶事件 ts 单调（引擎 E_TS_NOT_MONOTONIC 保证），追加式写入的新事件 ts 为当前最大
 *   → 既有 seq 在正常追加流量下不变；仅「迟到旧 ts 事件」会整体平移后续 seq（只读观测面可容忍，
 *   客户端重复拉取幂等无害）。lastSeq = 全树最大 seq（含被 leaf 过滤掉的分支）。
 *
 * 纯逻辑：只 import node 内建（fs/path 用于 mtime 与路径拼接），不 import 任何宿主 API。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/** 面板投影上限（API 契约逐字：列表 limit 钳 1..200 缺省 50；事件 limit 钳 1..500 缺省 100）。 */
export const PANEL_LIMITS = Object.freeze({
  treesDefault: 50,
  treesMax: 200,
  eventsDefault: 100,
  eventsMax: 500,
  goalPreviewChars: 120,   // rootGoalPreview ≤120 字符
  summaryPreviewChars: 200, // doneSummaryPreview ≤200 字符
})

/**
 * treeId 外层白名单（API 契约逐字：不匹配 → 404）。
 * 注意：引擎自身 TREE_ID_RE（state.js L34 /^[a-z][a-z0-9_]{3,7}$/）更严——面板契约是宽松外闸，
 * 两闸叠加语义：形状不匹配 404；形状合法但树不存在同样 404（见 createPanelView.readTree）。
 */
export const TREE_PANEL_TREE_ID_RE = /^[a-z0-9_]{3,32}$/

// ===================== 基础工具 =====================

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value) {
  return typeof value === 'string' ? value : null
}

/** 查询参数/入参整数钳制（非法值回退默认；不抛）。 */
export function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  const number = Math.trunc(value)
  if (number < min) return min
  if (number > max) return max
  return number
}

/**
 * 字符数截断（契约按「字符」计：≤120 / ≤200 字符；截断时以 '…' 结尾且总长恰为上限）。
 * 预览是给 UI 的短文本，字符口径比 flow 的 UTF-8 字节口径（2048B payload 摘要）更贴合本契约。
 */
export function truncateChars(text, maxChars) {
  const source = String(text ?? '')
  const limit = Number.isFinite(maxChars) && maxChars >= 1 ? Math.trunc(maxChars) : 0
  if (limit === 0) return ''
  if (source.length <= limit) return source
  return `${source.slice(0, Math.max(1, limit - 1))}…`
}

/** 任意值 → 有界文本预览（对象走紧凑 JSON；不可序列化降级占位；null/undefined → null）。 */
export function textPreview(value, maxChars = PANEL_LIMITS.goalPreviewChars) {
  if (value === undefined || value === null) return null
  let text
  if (typeof value === 'string') text = value
  else {
    try { text = JSON.stringify(value) } catch { return '[unserializable]' }
  }
  if (typeof text !== 'string') return '[unserializable]'
  return truncateChars(text, clampInt(maxChars, 1, 10_000, PANEL_LIMITS.goalPreviewChars))
}

// ===================== 状态投影（纯函数） =====================

function leafList(leaves) {
  if (!isPlainObject(leaves)) return []
  return Object.keys(leaves).map((id) => (isPlainObject(leaves[id]) ? leaves[id] : { leaf_id: id }))
}

/** 状态计数（counts: {<显示状态>:n}；未知/缺失状态按 'unknown' 计）。 */
export function statusCounts(leaves) {
  const counts = {}
  for (const leaf of leafList(leaves)) {
    const key = displayStateOf(leaf)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * 叶的运行结算态（`leaf.runtime.state`）——**结算权威**。
 *
 * 引擎的闭式状态机把 `leaf.status` 保持在「启封时那一步」（`pending_brief` /
 * `active` / `segment_pending` / `pruned`），结算走 done 事件 → `runtime.state`
 * （`succeeded` / `timeout` …）+ `verification`。面板若直接显示 raw status，
 * 已完成的叶子会永远显示 pending_brief（真实观测：wave2 10 叶里 8 叶是
 * `runtime.state=succeeded` + `verification.pass=true` 但 `status=pending_brief`）。
 * 所以投影层派生一个**展示状态**，raw status 另存 `rawStatus` 供追溯。
 *
 * @param {any} leaf
 * @returns {string|null}
 */
export function runtimeStateOf(leaf) {
  const rt = isPlainObject(leaf?.runtime) ? leaf.runtime : {}
  return asString(rt.state)
}

/**
 * 派生「展示状态」（决策见 {@link runtimeStateOf}）。优先级：
 * 1. `runtime.state` 的失败类（failed / timeout / cancelled / aborted）原样透出（红色系）；
 * 2. `verification.pass === true` → succeeded（已验证即结算成功）；
 * 3. `runtime.state === 'succeeded'` → succeeded（已 done 但未（或未走）验证）；
 * 4. `status === 'pruned'` → pruned（显式剪除，非 pending）；
 * 5. `status === 'segment_pending'` → segment_pending（竹节接力中，按 running 上色）；
 * 6. `last_event_type === 'done'` → succeeded（结算事件压过 raw 启封态；老状态文件 runtime 可能缺省）；
 * 7. `status === 'active'` → running；
 * 8. raw status 的结算/在跑别名归一（done|succeeded|completed → succeeded；running → running；
 *    failed / timeout / cancelled|aborted 原样），避免面板把 `done` 当成未知在跑态；
 * 9. `pending_brief` / `pending` / 缺失 → pending；其余 raw 原样透出。
 *
 * @param {any} leaf
 * @returns {string}
 */
export function displayStateOf(leaf) {
  const raw = asString(leaf?.status) ?? 'unknown'
  const runtimeState = runtimeStateOf(leaf)
  const verif = isPlainObject(leaf?.verification) ? leaf.verification : {}
  if (runtimeState === 'failed') return 'failed'
  if (runtimeState === 'timeout') return 'timeout'
  if (runtimeState === 'cancelled' || runtimeState === 'aborted') return 'cancelled'
  if (verif.pass === true) return 'succeeded'
  if (runtimeState === 'succeeded') return 'succeeded'
  if (raw === 'pruned') return 'pruned'
  if (raw === 'segment_pending') return 'segment_pending'
  // done 事件 = 结算事实，压过 raw 启封态（老状态文件常见 status=active + 末事件 done）
  if (asString(leaf?.last_event_type) === 'done') return 'succeeded'
  if (raw === 'active') return 'running'
  if (raw === 'done' || raw === 'succeeded' || raw === 'completed') return 'succeeded'
  if (raw === 'running') return 'running'
  if (raw === 'failed') return 'failed'
  if (raw === 'timeout') return 'timeout'
  if (raw === 'cancelled' || raw === 'aborted') return 'cancelled'
  if (raw === 'pending_brief' || raw === 'pending' || raw === 'unknown') return 'pending'
  return raw
}

/**
 * 树级展示状态（派生；v0.13.0）。**列表徽标的权威口径**。
 *
 * 引擎的 root leaf 是「容器」：`tree_plan` 建树后不会给它 done 事件，raw status
 * 永远停在 `active`。把 root 计入树级状态会让所有树永远显示 running（真实观测：
 * 36 棵树里 29 棵仅因 root=active 被判 running，而它们的子叶其实已全部结算）。
 * 因此：
 * - root 仍参与**失败**判定（root 真失败 = 树失败），但不参与「在跑 / 未开始」判定；
 * - 有子叶在跑（running / segment_pending）→ running；
 * - 否则有子叶未开始（pending）→ pending；
 * - 否则全部结算（succeeded / pruned / 其它终态）→ succeeded；
 * - 单叶树（无子叶）→ root 自身的展示态。
 * 失败优先于在跑优先于未开始优先于成功。
 *
 * @param {any} leaves 状态文件里的 leaves 映射
 * @param {string|null|undefined} rootLeafId root 叶 id
 * @returns {string}
 */
export function treeStateOf(leaves, rootLeafId) {
  const list = leafList(leaves)
  if (list.length === 0) return 'pending'
  const rootId = asString(rootLeafId)
  let root = null
  const children = []
  for (const leaf of list) {
    if (rootId && asString(leaf?.leaf_id) === rootId) root = leaf
    else children.push(leaf)
  }
  const failureStates = new Set(['failed', 'timeout', 'cancelled', 'error'])
  if (root && failureStates.has(displayStateOf(root))) return 'failed'
  if (children.length === 0) return root ? displayStateOf(root) : 'pending'
  let running = false
  let pending = false
  for (const child of children) {
    const state = displayStateOf(child)
    if (failureStates.has(state)) return 'failed'
    if (state === 'running' || state === 'segment_pending') running = true
    else if (state === 'pending') pending = true
  }
  if (running) return 'running'
  if (pending) return 'pending'
  return 'succeeded'
}

/** assignee 投影：只含 provider/model/effort 三键（preset/mechanism/未知键绝不透出）。 */export function projectAssignee(assignee) {
  if (!isPlainObject(assignee)) return null
  const out = {}
  for (const key of /** @type {const} */ (['provider', 'model', 'effort'])) {
    const v = assignee[key]
    if (typeof v === 'string' && v !== '') out[key] = truncateChars(v, 120)
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * verification 投影：{pass, attempts, lastVerdict, policy}（缺省 null）。
 * verdict 的 detail/artifact 字段绝不透出（detail 可含 stderr/stdout 片段）。
 */
export function projectVerification(verification) {
  if (!isPlainObject(verification)) return null
  const verdicts = Array.isArray(verification.verdicts) ? verification.verdicts : []
  const rounds = Array.isArray(verification.rounds) ? verification.rounds : []
  const last = verdicts.length > 0 ? verdicts[verdicts.length - 1] : null
  return {
    pass: verification.pass === true,
    attempts: rounds.length > 0 ? rounds.length : verdicts.length,
    lastVerdict: isPlainObject(last) && typeof last.mode === 'string'
      ? { mode: truncateChars(last.mode, 60), pass: last.pass === true }
      : null,
    policy: typeof verification.policy_id === 'string' ? truncateChars(verification.policy_id, PANEL_LIMITS.goalPreviewChars) : null,
  }
}

/** 最新 done 事件的 meta.summary → ≤200 字符预览（最新 done 为准；无 summary → null）。 */
function lastDoneSummary(leaf) {
  const events = Array.isArray(leaf?.events) ? leaf.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type !== 'done') continue
    const summary = isPlainObject(ev.meta) ? ev.meta.summary : undefined
    return typeof summary === 'string' && summary !== '' ? truncateChars(summary, PANEL_LIMITS.summaryPreviewChars) : null
  }
  return null
}

/**
 * 单叶投影（契约形状逐字；只输出白名单键，brief/dod/milestones/事件正文一概不透出；
 * `runtime` 只透出结算态 `state` 一个字符串，handoffBrief/history 等正文绝不透出）。
 * @returns {{ leafId: string, parent: string|null, path: string, role: string, status: string,
 *   state: string, rawStatus: string, runtimeState: string|null,
 *   sessionId: string|null, relay: string, taskType: string|null, dependencies: string[],
 *   addedBy: string|null, assignee: object|null, ctxPct: number|null, lastEventAt: string|null,
 *   lastEventType: string|null, verification: object|null, doneSummaryPreview: string|null }}
 */
export function projectLeaf(leaf) {
  const src = isPlainObject(leaf) ? leaf : {}
  const rawStatus = asString(src.status) ?? 'unknown'
  const state = displayStateOf(src)
  return {
    leafId: asString(src.leaf_id) ?? '?',
    parent: asString(src.parent),
    path: asString(src.path) ?? '',
    role: asString(src.role) ?? 'unknown',
    // status = 展示状态（派生；v1.6.2 起）。rawStatus / runtimeState 保留原始事实。
    status: state,
    state,
    rawStatus,
    runtimeState: runtimeStateOf(src),
    sessionId: asString(src.session_id),
    relay: asString(src.relay) ?? 'auto',
    taskType: asString(src.taskType),
    dependencies: Array.isArray(src.dependencies)
      ? src.dependencies.filter((d) => typeof d === 'string' && d !== '').slice(0, 64)
      : [],
    addedBy: asString(src.added_by),
    assignee: projectAssignee(src.assignee),
    ctxPct: Number.isFinite(src.context_usage_pct) ? src.context_usage_pct : null,
    lastEventAt: asString(src.last_event_ts),
    lastEventType: asString(src.last_event_type),
    verification: projectVerification(src.verification),
    doneSummaryPreview: lastDoneSummary(src),
  }
}

function rootLeafIdOf(state) {
  const treeId = asString(state?.tree_id)
  if (treeId && isPlainObject(state?.leaves) && isPlainObject(state.leaves[`${treeId}-root`])) return `${treeId}-root`
  const ids = isPlainObject(state?.leaves) ? Object.keys(state.leaves) : []
  return ids.length > 0 ? ids.sort()[0] : null
}

/**
 * 列表投影（GET /tree-panel/trees 的条目）。
 * @param {any} state 树状态（store.read 原样）
 * @param {{ updatedAt?: string|null }} [extra] updatedAt 由 IO 面提供（tree-state.json mtime；缺省回落 created_at）
 */
export function projectTreeSummary(state, extra = {}) {
  if (!isPlainObject(state) || typeof state.tree_id !== 'string') return null
  const leaves = isPlainObject(state.leaves) ? state.leaves : {}
  const updatedAt = asString(extra.updatedAt) ?? asString(state.created_at)
  const rootLeafId = rootLeafIdOf(state)
  const root = rootLeafId && isPlainObject(leaves[rootLeafId]) ? leaves[rootLeafId] : null
  return {
    treeId: state.tree_id,
    rootLeafId,
    createdAt: asString(state.created_at),
    updatedAt,
    leafCount: Object.keys(leaves).length,
    counts: statusCounts(leaves),
    // 树级展示态（root 容器不参与在跑判定，见 treeStateOf）
    state: treeStateOf(leaves, rootLeafId),
    rootGoalPreview: root ? textPreview(root.brief, PANEL_LIMITS.goalPreviewChars) : null,
  }
}

/**
 * 详情投影（GET /tree-panel/trees/<treeId>）。
 * stats.sessions = max(session_registry 大小, runtime 已知会话 id 去重数)——只给计数，绝不透出 id 明细。
 */
export function projectTreeDetail(state, extra = {}) {
  if (!isPlainObject(state) || typeof state.tree_id !== 'string') return null
  const leaves = isPlainObject(state.leaves) ? state.leaves : {}
  const ids = Object.keys(leaves)
  const rootLeafId = rootLeafIdOf(state)
  const root = rootLeafId && isPlainObject(leaves[rootLeafId]) ? leaves[rootLeafId] : null
  const updatedAt = asString(extra.updatedAt) ?? asString(state.created_at)
  const registry = isPlainObject(state.session_registry) ? state.session_registry : {}
  const runtimeSessions = new Set()
  for (const id of ids) {
    const leaf = isPlainObject(leaves[id]) ? leaves[id] : {}
    const rt = isPlainObject(leaf.runtime) ? leaf.runtime : {}
    for (const sid of [leaf.session_id, rt.subagentSessionId]) {
      if (typeof sid === 'string' && sid !== '') runtimeSessions.add(sid)
    }
    const chain = Array.isArray(rt.segmentChain) ? rt.segmentChain : []
    for (const sid of chain) if (typeof sid === 'string' && sid !== '') runtimeSessions.add(sid)
  }
  return {
    treeId: state.tree_id,
    createdAt: asString(state.created_at),
    updatedAt,
    // 树级展示态（列表徽标同一口径）
    state: treeStateOf(leaves, rootLeafId),
    root: {
      leafId: rootLeafId,
      // 展示状态（派生，见 displayStateOf）；rawStatus 保留启封态事实。
      status: isPlainObject(root) ? displayStateOf(root) : 'missing',
      rawStatus: isPlainObject(root) ? (asString(root.status) ?? 'unknown') : 'missing',
      runtimeState: isPlainObject(root) ? runtimeStateOf(root) : null,
      goalPreview: isPlainObject(root) ? textPreview(root.brief, PANEL_LIMITS.goalPreviewChars) : null,
    },
    leaves: ids.sort().map((id) => projectLeaf(leaves[id])),
    stats: {
      total: ids.length,
      byStatus: statusCounts(leaves),
      sessions: Math.max(Object.keys(registry).length, runtimeSessions.size),
    },
    updatedAt,
  }
}

// ===================== 事件信封投影（纯函数） =====================

/**
 * 全树事件确定性展开：[(ts, leafId, type, 叶内序)] → 按 (ts, leafId, 叶内序) 稳定排序 → seq 1 起。
 * 各叶内 ts 单调（引擎保证）；ts 非字符串（写坏）排在最前（'' 字典序最小）。
 * @returns {{ seq: number, ts: string, leafId: string, type: string }[]}
 */
export function flattenEvents(state) {
  const leaves = isPlainObject(state) && isPlainObject(state.leaves) ? state.leaves : {}
  const rows = []
  for (const leafId of Object.keys(leaves).sort()) {
    const events = Array.isArray(leaves[leafId]?.events) ? leaves[leafId].events : []
    events.forEach((ev, index) => {
      rows.push({
        ts: asString(ev?.ts) ?? '',
        leafId,
        type: asString(ev?.type) ?? 'unknown',
        index,
      })
    })
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.leafId < b.leafId ? -1 : a.leafId > b.leafId ? 1 : a.index - b.index))
  return rows.map((r, i) => ({ seq: i + 1, ts: r.ts, leafId: r.leafId, type: r.type }))
}

/**
 * 事件信封投影（GET /tree-panel/trees/<treeId>/events；since 增量 + limit 尾部截断 + 可选 leaf 过滤）。
 * 只给信封（seq/ts/leafId/type），绝不给 meta/payload 内容。
 * @param {any} state
 * @param {{ since?: number, limit?: number, leaf?: string|null }} [options]
 * @returns {{ events: {seq:number,ts:string,leafId:string,type:string}[], lastSeq: number }}
 */
export function projectEvents(state, options = {}) {
  const all = flattenEvents(state)
  const limit = clampInt(options.limit, 1, PANEL_LIMITS.eventsMax, PANEL_LIMITS.eventsDefault)
  const since = Number.isFinite(options.since) && options.since > 0 ? Math.trunc(options.since) : 0
  const leaf = typeof options.leaf === 'string' && options.leaf !== '' ? options.leaf : null
  const filtered = leaf ? all.filter((e) => e.leafId === leaf) : all
  const tail = filtered.filter((e) => e.seq > since).slice(-limit)
  const lastSeq = all.length > 0 ? all[all.length - 1].seq : 0
  return { events: tail, lastSeq }
}

// ===================== IO 面（store 只读读取 + mtime updatedAt） =====================

/**
 * 面板视图（store 只读面装配；与 tree_doctor 同款读取面，不走 engine.call 避免写 call-log）。
 * @param {{ store: { list: Function, read: Function }, stateRoot?: string|null,
 *          statFile?: (p: string) => Promise<any> }} options
 *        stateRoot 缺省 null（mtime updatedAt 跳过，回落 created_at）；statFile 可注入（单测隔离）。
 */
export function createPanelView({ store, stateRoot = null, statFile } = {}) {
  const stat = typeof statFile === 'function' ? statFile : (p) => fsp.stat(p)
  const stateRootAbs = typeof stateRoot === 'string' && stateRoot !== '' ? path.resolve(stateRoot) : null

  /** 读单树状态：null = 树不存在；读取抛错（损坏）→ 结构化返回，绝不向上抛。 */
  async function readState(treeId) {
    try {
      const state = await store.read(treeId)
      return { state: isPlainObject(state) ? state : null }
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) }
    }
  }

  /** updatedAt：tree-state.json mtime（fsStore 落盘时才有）；不可得 → null（投影回落 created_at）。 */
  async function updatedAtOf(treeId) {
    if (!stateRootAbs) return null
    try {
      const st = await stat(path.join(stateRootAbs, treeId, 'tree-state.json'))
      const mtime = st?.mtime
      return mtime instanceof Date && Number.isFinite(mtime.getTime()) ? mtime.toISOString() : null
    } catch { return null }
  }

  return {
    stateRoot: stateRootAbs,
    /**
     * 列表：{ok:true, trees:[summary], storageRoot, updatedAt, total}（按 updatedAt 降序，null 最后，
     * treeId 升序决胜）| {ok:false, code}（store.list 整体不可用；单树损坏只跳过不致败）。
     */
    async listTrees({ limit } = {}) {
      const capped = clampInt(limit, 1, PANEL_LIMITS.treesMax, PANEL_LIMITS.treesDefault)
      let treeIds
      try { treeIds = typeof store.list === 'function' ? await store.list() : [] } catch {
        return { ok: false, code: 'E_PANEL_STORE_LIST_FAILED', message: 'tree store list unavailable' }
      }
      const rows = []
      for (const treeId of Array.isArray(treeIds) ? treeIds : []) {
        if (typeof treeId !== 'string' || !treeId) continue
        const { state, error } = await readState(treeId)
        if (error) continue   // 损坏树跳过（log 由 handler 面 do）；不阻断其余树
        if (!state) continue
        const summary = projectTreeSummary(state, { updatedAt: await updatedAtOf(treeId) })
        if (summary) rows.push(summary)
      }
      rows.sort((a, b) => {
        const au = a.updatedAt ?? ''
        const bu = b.updatedAt ?? ''
        if (au !== bu) return au > bu ? -1 : 1   // ISO 字典序 = 时间序；''（缺失）沉底
        return a.treeId < b.treeId ? -1 : 1
      })
      return {
        ok: true,
        trees: rows.slice(0, capped),
        storageRoot: stateRootAbs,
        updatedAt: new Date().toISOString(),
        total: rows.length,
      }
    },
    /** 详情：{ok:true, view} | {ok:false, code:'E_TREE_NOT_FOUND'} | {ok:false, code:'E_TREE_STATE_CORRUPT'}。 */
    async readTree(treeId) {
      const { state, error } = await readState(treeId)
      if (error) return { ok: false, code: 'E_TREE_STATE_CORRUPT', message: `tree state unreadable: ${String(error.message).slice(0, 200)}` }
      if (!state) return { ok: false, code: 'E_TREE_NOT_FOUND', message: `tree "${treeId}" not found` }
      return { ok: true, view: projectTreeDetail(state, { updatedAt: await updatedAtOf(treeId) }) }
    },
    /** 事件信封：{ok:true, treeId, events, lastSeq} | {ok:false, code, message}。 */
    async readEvents(treeId, { since, limit, leaf } = {}) {
      const { state, error } = await readState(treeId)
      if (error) return { ok: false, code: 'E_TREE_STATE_CORRUPT', message: `tree state unreadable: ${String(error.message).slice(0, 200)}` }
      if (!state) return { ok: false, code: 'E_TREE_NOT_FOUND', message: `tree "${treeId}" not found` }
      const projected = projectEvents(state, { since, limit, leaf })
      return { ok: true, treeId, events: projected.events, lastSeq: projected.lastSeq }
    },
  }
}
