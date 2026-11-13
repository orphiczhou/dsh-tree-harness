/**
 * 引擎核心 v0.1（S1 第一批）：纯逻辑，不 import DSH API。
 * 行为基准 = docs/engine-spec.md（源引擎 tree-engine.cjs 差分保真）。
 * 入口契约继承源 run()：call() 永不 throw；成功 {ok:true,...}，失败 {ok:false,error:{code,message,helpTopic?}}。
 * 全部临界区经 per-tree 串行队列（queue.js）。
 */
import {
  STATUS_ENUM, EVENT_TYPE_ENUM, ROLE_ENUM, DRIFT_KIND_ENUM, DRIFT_SEVERITY_ENUM, DRIFT_ACTION_ENUM,
  TREE_ID_RE, LEAF_NAME_RE,
  assertTransition, assertDoneEventGate, assertMilestoneGate, nudgeEscalation,
  treeError,
} from './state.js'
import {
  DEFAULT_GUARDS, isStrictUuidV4, normalizeSessionId, sameSession, sessionBudget, activeLeafBudget, spawnBudget,
  assertCallerIs, assertLeafWriter, findSessionConflict,
} from './guards.js'
import { enqueue } from './queue.js'
import { systemClock } from './clock.js'

const nowIso = (clock) => new Date(clock.now()).toISOString()

/**
 * @param {object} opts
 * @param {import('./store.js').TreeStore} opts.store
 * @param {import('./clock.js').Clock} [opts.clock]
 * @param {Partial<typeof DEFAULT_GUARDS> & { ctxSegmentThreshold?: number, segmentMaxChainLength?: number }} [opts.config]
 */
export function createEngine(opts) {
  const store = opts.store
  const clock = opts.clock ?? systemClock()
  const cfg = { ...DEFAULT_GUARDS, ctx_segment_threshold: 42, segment_max_chain_length: 5, ...opts.config }

  async function withTree(treeId, fn) {
    if (typeof treeId !== 'string' || !treeId.trim()) treeError('E_SCHEMA_INVALID', 'tree_id is required')
    if (!TREE_ID_RE.test(treeId)) {
      treeError('E_NAME_INVALID', `tree_id "${treeId}" must match [a-z][a-z0-9_]{3,7} (4-8 chars, lowercase, no hyphen)`)
    }
    return enqueue(treeId, async () => {
      const state = await store.read(treeId)
      return fn(state)
    })
  }

  function mustLeaf(state, leafId) {
    const leaf = state?.leaves?.[leafId]
    if (!leaf) treeError('E_LEAF_NOT_FOUND', `leaf "${leafId}" not found`)
    return leaf
  }

  // ── init ─────────────────────────────────────────────
  async function init(args) {
    const [treeId, rootBrief, rootDod, sessionIdRaw, auditMeta] = args
    // W2.6（2026-11-12）：会话 id 归一化——root/主会话 DSH_SESSION_ID 带 `session-` 前缀，
    // state 一律存归一化裸 UUID 规范形（校验仍严格 v4）。
    const sessionId = normalizeSessionId(sessionIdRaw ?? null)
    return withTree(treeId, async (existing) => {
      if (existing) treeError('E_DUPLICATE_LEAF', `tree "${treeId}" already initialized`)
      const rootLeafId = `${treeId}-root`
      const state = {
        schema_version: 2,
        tree_id: treeId,
        created_at: nowIso(clock),
        audit_meta: { ...cfg, ...(auditMeta ?? {}) },
        leaves: {
          [rootLeafId]: {
            // 差分对齐（源 cmdInit）：root 的 added_by=null、model/channel 缺省 'unknown'
            leaf_id: rootLeafId, session_id: sessionId ?? null, parent: null, path: '',
            role: 'root', model: 'unknown', channel: 'unknown', added_by: null, status: 'active',
            brief: rootBrief, dod: rootDod,
            created_at: nowIso(clock), events: [], milestones: [], segment_chain: [], drift_history: [],
            context_usage_pct: 0, nudge_count: 0,
          },
        },
        drift_log: [], session_registry: {},
      }
      if (sessionId) {
        if (!isStrictUuidV4(sessionId)) treeError('E_INVALID_UUID_STRICT', `session_id "${sessionId}" must be strict UUID v4`)
      }
      await store.write(treeId, state)
      return { tree: { tree_id: treeId, root_leaf_id: rootLeafId, created_at: state.created_at } }
    })
  }

  // ── leaf add ─────────────────────────────────────────
  async function leafAdd(args, caller) {
    const [treeId, leaf] = args
    return withTree(treeId, async (state) => {
      if (!state) treeError('E_TREE_NOT_FOUND', `tree "${treeId}" not found`)
      if (!leaf || typeof leaf !== 'object') treeError('E_SCHEMA_INVALID', 'leaf object required')
      const { leaf_id, session_id: rawSessionId, parent, path: leafPath, role, added_by: rawAddedBy } = leaf
      // v0.8.0（P0-A）：per-leaf 竹节开关持久化；缺省 auto（参与竹节），仅接受 auto|off。
      const relay = leaf.relay === undefined ? 'auto' : leaf.relay
      if (relay !== 'auto' && relay !== 'off') treeError('E_SCHEMA_INVALID', `leaf.relay "${String(leaf.relay)}" must be "auto" or "off"`)
      // W2.6：会话 id / 创建者 id 归一化后再校验/存储（调用方传 `session-` 前缀形态也可）
      const session_id = rawSessionId == null ? rawSessionId : normalizeSessionId(rawSessionId)
      const added_by = normalizeSessionId(rawAddedBy)
      if (!leaf_id) treeError('E_SCHEMA_INVALID', 'leaf_id is required')
      if (!LEAF_NAME_RE.test(leaf_id)) {
        treeError('E_NAME_INVALID', `leaf_id "${leaf_id}" must match ${String(LEAF_NAME_RE)} (prefix-Role-seq[-sN|iN])`, 'naming_convention')
      }
      if (!ROLE_ENUM.includes(role)) treeError('E_SCHEMA_INVALID', `role "${role}" invalid (${ROLE_ENUM.join('|')})`)
      if (role === 'root') treeError('E_SCHEMA_INVALID', 'leaf_add rejects role=root: only tree_init creates the root leaf (V10-trust-anchor)')
      if (parent === leaf_id) treeError('E_SCHEMA_INVALID', 'leaf cannot be its own parent')
      const parentLeaf = parent ? mustLeaf(state, parent) : null
      if (parentLeaf && parentLeaf.role === 'worker') treeError('E_SCHEMA_INVALID', `parent "${parent}" is a worker: workers cannot have children`)
      // 深度护栏（commander 嵌套 ≤3）
      let depth = 1, p = parentLeaf
      while (p) { depth += 1; p = p.parent ? state.leaves[p.parent] : null }
      if (depth > cfg.commander_max_depth) treeError('E_DEPTH_EXCEEDED', `nesting depth ${depth} > max ${cfg.commander_max_depth}`)
      // path 一致性（源 L1237-1241 精确规则，差分冻结）：path 必须逐字等于 leaf_id 解析出的 path 段（如 'C1'），空段只能空
      if (leafPath !== undefined) {
        const m = LEAF_NAME_RE.exec(leaf_id)
        const parsedPath = (m && m[2]) || ''
        if (parsedPath !== (leafPath || '')) {
          treeError('E_SCHEMA_INVALID', `path "${leafPath}" does not match path segment "${parsedPath}" in leaf_id "${leaf_id}"`, 'how_to_init')
        }
      }
      if (session_id && !isStrictUuidV4(session_id)) treeError('E_INVALID_UUID_STRICT', `session_id "${session_id}" must be strict UUID v4`)
      // 依赖声明校验（§7 任务1：dependencies 引擎侧 enforcement——装载期形状/存在性/环检测）
      const deps = leaf.dependencies
      if (deps !== undefined) {
        if (!Array.isArray(deps) || deps.length === 0 || deps.some((d) => typeof d !== 'string' || !d)) {
          treeError('E_SCHEMA_INVALID', 'dependencies must be a non-empty array of leaf_id strings')
        }
        if (new Set(deps).size !== deps.length) treeError('E_SCHEMA_INVALID', 'dependencies contains duplicates')
        if (deps.includes(leaf_id)) treeError('E_SCHEMA_INVALID', `leaf "${leaf_id}" cannot depend on itself`)
        for (const d of deps) mustLeaf(state, d)
        // 环检测：沿既有 leaves 的 dependencies 深搜，回到候选 leaf 即成环（永不满足 → 派发死锁）
        const onStack = new Set([leaf_id]); let cyclic = false
        const dfs = (id) => {
          for (const next of state.leaves[id]?.dependencies ?? []) {
            if (onStack.has(next)) { if (next === leaf_id) cyclic = true; continue }
            onStack.add(next); dfs(next); onStack.delete(next)
            if (cyclic) return
          }
        }
        for (const d of deps) { onStack.add(d); dfs(d); onStack.delete(d); if (cyclic) break }
        if (cyclic) treeError('E_DEPENDENCY_CYCLE', `dependencies of "${leaf_id}" form a cycle (would deadlock dispatch)`)
      }
      // taskType 校验（§7 任务2：自由字符串；策略路由在验证器 taskTypeMap，未知类型回落 default）
      if (leaf.taskType !== undefined && typeof leaf.taskType !== 'string') {
        treeError('E_SCHEMA_INVALID', `taskType "${String(leaf.taskType)}" must be a string`)
      }
      // 防借身份：caller 必须 === added_by（R2 洁净室 D2-B1）
      assertCallerIs(caller, added_by, 'leaf_add (added_by)')
      // 会话唯一 + 预算（E2E 修复：null 会话（PENDING 型）跳过冲突/预算——与 root.session_id=null 不冲突）
      if (session_id != null) {
        const conflict = findSessionConflict(state, session_id)
        if (conflict) treeError('E_SCHEMA_INVALID', conflict)
        const sb = sessionBudget(state, session_id, cfg)
        if (sb.reached) treeError('E_MAX_SESSIONS', `tree "${treeId}" session count ${sb.count} > max_sessions ${sb.max} (macp2 guard)`)
      }
      const ab = activeLeafBudget(state, cfg)
      if (ab.reached) treeError('E_NODE_BUDGET_EXCEEDED', `tree "${treeId}" active leaves ${ab.count + 1} > node_budget ${ab.max}`)
      state.leaves[leaf_id] = {
        ...leaf, relay, status: leaf.role === 'worker' ? 'pending_brief' : 'active',
        created_at: nowIso(clock), events: [], milestones: [], segment_chain: [], drift_history: [],
        context_usage_pct: 0, nudge_count: 0,
      }
      await store.write(treeId, state)
      return { leaf: state.leaves[leaf_id] }
    })
  }

  // ── leaf get / list ──────────────────────────────────
  const leafGet = ([treeId, leafId]) => withTree(treeId, async (s) => ({ leaf: mustLeaf(s, leafId) }))
  const leafListActive = ([treeId]) => withTree(treeId, async (s) => ({ leaves: Object.values(s.leaves).filter((l) => l.status !== 'archived' && l.status !== 'pruned') }))
  const leafListAll = ([treeId]) => withTree(treeId, async (s) => ({ leaves: Object.values(s.leaves) }))

  // ── set-status（含 done 三重闸 + 级联 pruned）─────────
  async function setStatus(args, caller) {
    const [treeId, leafId, status] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      // caller：owner / creator / root（P1-05 统一写权矩阵，语义与旧版一致）
      assertLeafWriter(state, leaf, caller, 'status', state.leaves?.[`${treeId}-root`]?.session_id)
      assertTransition(leaf.status, status)
      if (status === 'done') {
        assertDoneEventGate(leaf)
        assertMilestoneGate(leaf)
      }
      leaf.status = status
      // 级联 pruned：父 pruned → 未 done 后代级联（约束 5，drift 留痕）
      if (status === 'pruned') {
        const cascade = (parentId) => {
          for (const l of Object.values(state.leaves)) {
            if (l.parent === parentId && !['done', 'archived', 'pruned'].includes(l.status)) {
              l.status = 'pruned'
              l.drift_history.push({ ts: nowIso(clock), leaf_id: l.leaf_id, kind: 'rhythm', severity: 'mid', action: 'prune', reason: `cascade from pruned parent ${parentId}` })
              cascade(l.leaf_id)
            }
          }
        }
        cascade(leafId)
      }
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, status: leaf.status } }
    })
  }

  // ── set-session ──────────────────────────────────────
  async function setSession(args, caller) {
    const [treeId, leafId, sessionIdRaw] = args
    const sessionId = normalizeSessionId(sessionIdRaw)
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      // 仅 creator（added_by）可重绑 owner；root 例外未开（P1-05 矩阵，不扩大写面）
      assertLeafWriter(state, leaf, caller, 'set-session')
      if (!isStrictUuidV4(sessionId)) treeError('E_INVALID_UUID_STRICT', `session_id "${sessionId}" must be strict UUID v4`)
      const conflict = findSessionConflict(state, sessionId, leafId)
      if (conflict) treeError('E_SCHEMA_INVALID', conflict)
      const sb = sessionBudget(state, sessionId, cfg)
      if (sb.reached) treeError('E_MAX_SESSIONS', `tree "${treeId}" session count ${sb.count} > max_sessions ${sb.max}`)
      leaf.session_id = sessionId
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, session_id: sessionId } }
    })
  }

  // ── set-verification（验证裁决落账：taskType 路由的判据持久化到 leaf）──
  async function setVerification(args, caller) {
    const [treeId, leafId, result] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      // P1-05：verification 落账仅 creator/root（tree_verify 由指挥官跑；owner 不得自验）
      assertLeafWriter(state, leaf, caller, 'verification', state.leaves?.[`${treeId}-root`]?.session_id)
      if (!result || typeof result !== 'object' || typeof result.pass !== 'boolean') {
        treeError('E_SCHEMA_INVALID', 'verification result object with boolean "pass" required')
      }
      leaf.verification = {
        ts: nowIso(clock), policy_id: result.policyId ?? null, pass: result.pass,
        verdicts: result.verdicts ?? [],
        // 对抗式验证（adversarial.js）逐轮裁决透传
        ...(Array.isArray(result.rounds) ? { rounds: result.rounds } : {}),
      }
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, verification: leaf.verification } }
    })
  }

  // ── set-relay（v0.8.0 P0-A：per-leaf 竹节开关）────────────────
  // 等待外部编排（flow / tree_verify / 长命令）的 leaf 可由指挥官把竹节关掉：
  // leaf.relay='off' 时 sweep 跳过该 leaf 的竹节判定（超时/收割语义不变、不改 runtime.state），
  // 避免 relay 在外部编排运行中 interrupt 旧会话把 flow 打断。
  // 写权：LEAF_WRITE_MATRIX.relay = creator/root（owner 不得自关；root leaf 本身不参与竹节）。
  async function setRelay(args, caller) {
    const [treeId, leafId, relayRaw] = args
    const relay = relayRaw === undefined ? 'auto' : relayRaw
    if (relay !== 'auto' && relay !== 'off') treeError('E_SCHEMA_INVALID', `relay "${String(relayRaw)}" must be "auto" or "off"`)
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      assertLeafWriter(state, leaf, caller, 'relay', state.leaves?.[`${treeId}-root`]?.session_id)
      leaf.relay = relay
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, relay, status: leaf.status } }
    })
  }

  // ── set-context（竹节刚性触发）────────────────────────
  async function setContext(args, caller) {
    const [treeId, leafId, pct] = args
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) treeError('E_SCHEMA_INVALID', `pct "${pct}" must be an integer 0-100`)
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      // P1-05：水位自报仅 owner（执行者本人）或 root（信任锚监控）；creator 不得代报
      assertLeafWriter(state, leaf, caller, 'context', state.leaves?.[`${treeId}-root`]?.session_id)
      leaf.context_usage_pct = pct
      let segTriggered = false
      const threshold = state.audit_meta?.ctx_segment_threshold ?? cfg.ctxSegmentThreshold
      if (pct >= threshold && leaf.role !== 'root' && leaf.status === 'active') {
        leaf.status = 'segment_pending'
        segTriggered = true
        const drift = { ts: nowIso(clock), leaf_id: leafId, kind: 'rhythm', severity: 'high', action: 'handoff', reason: `context_usage_pct ${pct}% >= threshold ${threshold}%, auto segment_pending (bamboo-joint handoff)` }
        leaf.drift_history.push(drift)
        state.drift_log.push(drift)
      }
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, context_usage_pct: pct, segment_pending: segTriggered } }
    })
  }

  // ── event append（枚举 + ts 单调 + done 所有权 + spawn 预算）──
  async function eventAppend(args, caller, tsIso) {
    const [treeId, leafId, type, meta] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      if (!EVENT_TYPE_ENUM.includes(type)) treeError('E_SCHEMA_INVALID', `event type "${type}" invalid (${EVENT_TYPE_ENUM.join('|')})`)
      // 统一写权矩阵（P1-05）：非 done 事件 owner/creator 可写；done 维持 V10-trust-anchor-fix 仅 owner
      // （明确移除 added_by 代写权，堵 commander 谎报 worker done——源 L2759-2760 失守根因）。
      assertLeafWriter(state, leaf, caller, `event:${type}`, state.leaves?.[`${treeId}-root`]?.session_id)
      // 预算护栏（macp2）
      if (type === 'subagent_spawn') {
        const sb = spawnBudget(leaf, cfg)
        if (sb.reached) treeError('E_SUBAGENT_BUDGET_EXCEEDED', `subagent_spawn on "${leafId}" rejected: ${sb.count} existing >= max ${sb.max}`)
      }
      // ts 单调（V10-timestamp-monotonic）
      const ts = tsIso ?? nowIso(clock)
      if (leaf.events.length > 0 && ts < leaf.events[leaf.events.length - 1].ts) {
        treeError('E_TS_NOT_MONOTONIC', `event ts ${ts} earlier than previous event`)
      }
      leaf.events.push({ type, meta: meta ?? {}, ts })
      leaf.last_event_type = type
      leaf.last_event_ts = ts
      // E2E#5 修复：done 事件 → runtime 成功终态回流（收割双轨之「自报 done」路径；此前 succeeded 无任何赋值点，
      // runtime 永远 running 直到 timeout，dispatchStart 拒绝再派发 → 节点卡死）。
      if (type === 'done' && leaf.runtime?.state === 'running') {
        leaf.runtime.history.push({ sessionId: leaf.runtime.subagentSessionId, state: 'running', endedAt: clock.now(), note: 'done event' })
        leaf.runtime.state = 'succeeded'
      }
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, events: leaf.events.length, last_event_type: type } }
    })
  }

  // ── segment append（竹节接力登记，全树唯一）───────────
  async function segmentAppend(args) {
    const [treeId, leafId, newSessionIdRaw] = args
    // W2.6：竹节接力会话 id 归一化（带 `session-` 前缀也可登记）
    const newSessionId = normalizeSessionId(newSessionIdRaw)
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      if (!isStrictUuidV4(newSessionId)) treeError('E_INVALID_UUID_STRICT', `new_session_id "${newSessionId}" must be strict UUID v4`)
      if ((leaf.segment_chain ?? []).includes(newSessionId)) {
        treeError('E_SCHEMA_INVALID', `session_id "${newSessionId}" already in segment_chain of leaf "${leafId}"`)
      }
      if ((leaf.segment_chain ?? []).length >= (cfg.segment_max_chain_length ?? 5)) {
        treeError('E_SEGMENT_CHAIN_LIMIT', `segment chain of "${leafId}" reached max ${cfg.segment_max_chain_length} (frozen for adjudication)`)
      }
      const conflict = findSessionConflict(state, newSessionId, leafId)
      if (conflict) treeError('E_SCHEMA_INVALID', conflict)
      const sb = sessionBudget(state, newSessionId, cfg)
      if (sb.reached) treeError('E_MAX_SESSIONS', `tree "${treeId}" session count ${sb.count} > max_sessions ${sb.max}`)
      if (!Array.isArray(leaf.segment_chain)) leaf.segment_chain = []
      leaf.segment_chain.push(newSessionId)
      leaf.status = 'segment_pending'
      const drift = { ts: nowIso(clock), leaf_id: leafId, kind: 'rhythm', severity: 'low', action: 'handoff', to_session: newSessionId, reason: 'segment_handoff' }
      leaf.drift_history.push(drift)
      state.drift_log.push(drift)
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, status: leaf.status, segment_chain: leaf.segment_chain } }
    })
  }

  // ── nudge append（7-strike）───────────────────────────
  async function nudgeAppend(args) {
    const [treeId, leafId] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      leaf.nudge_count = (leaf.nudge_count ?? 0) + 1
      const esc = nudgeEscalation(leaf.nudge_count)
      if (esc.forcedPrune) {
        leaf.status = 'pruned'
        leaf.drift_history.push({ ts: nowIso(clock), leaf_id: leafId, kind: 'rhythm', severity: 'high', action: 'prune', reason: `auto-pruned after ${leaf.nudge_count} nudges (V10-nudge-escalation)` })
      }
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, nudge_count: leaf.nudge_count, severity: esc.severity, forced_prune: esc.forcedPrune } }
    })
  }

  // ── validate（不变式）─────────────────────────────────
  async function validate(args) {
    const [treeId] = args
    return withTree(treeId, async (state) => {
      const issues = []
      // W2.1 + W2.6：会话唯一性按归一化比较，且 runtime.segmentChain（竹节接力历史）纳入校验。
      // v0.8.0 收口（E2E F1）：竹节 relay 的合法形态是「当前执行者 session_id 同时出现在本 leaf 的
      // 接力链里」（relay 先 push 新会话进 runtime.segmentChain，再把它绑成 leaf.session_id）——
      // 旧口径先记 session_id 再遍历 chain，会把这一合法形态误报成 session_duplicate（rly8b/s1rl1 复现）。
      // 现在：每个 leaf 允许「自己的当前 session_id」在自己的会话集合中出现一次（selfChainSeen 去重）；
      // 同一 id 在自有 chain 里重复出现、或跨 leaf 复用，仍是真重复（照旧 FAIL）。
      const seen = new Map()            // normalized session id → 首次认领它的 leaf_id
      const selfChainSeen = new Set()   // `${leaf_id}\u0000${normalized id}`：已豁免过一次的自身 chain 条目
      const noteSid = (leaf, sid, where) => {
        const norm = normalizeSessionId(sid)
        if (typeof norm !== 'string' || !norm) return
        const firstOwner = seen.get(norm)
        if (firstOwner === undefined) { seen.set(norm, leaf.leaf_id); return }
        const selfKey = `${leaf.leaf_id}\u0000${norm}`
        if (firstOwner === leaf.leaf_id && sameSession(norm, leaf.session_id) && !selfChainSeen.has(selfKey)) {
          selfChainSeen.add(selfKey)
          return
        }
        issues.push({ type: 'session_duplicate', leaf_id: leaf.leaf_id, detail: `${where} duplicates ${firstOwner}` })
      }
      for (const leaf of Object.values(state.leaves)) {
        if (leaf.session_id) noteSid(leaf, leaf.session_id, 'session_id')
        for (const sid of leaf.segment_chain ?? []) noteSid(leaf, sid, 'segment_chain')
        for (const sid of leaf.runtime?.segmentChain ?? []) noteSid(leaf, sid, 'runtime.segmentChain')
        if (leaf.parent && !state.leaves[leaf.parent]) issues.push({ type: 'parent_missing', leaf_id: leaf.leaf_id, detail: `parent "${leaf.parent}" not found` })
        if (leaf.status === 'done') {
          if (!(leaf.events ?? []).some((e) => e.type === 'done')) issues.push({ type: 'status_event_mismatch', leaf_id: leaf.leaf_id, detail: 'status=done but no done event' })
        }
      }
      return { ok: issues.length === 0, issues }
    })
  }

  const treeDump = ([treeId]) => withTree(treeId, async (s) => ({ tree: s }))
  const sessionCount = ([treeId]) => withTree(treeId, async (s) => {
    const sb = sessionBudget(s, '__probe__', cfg) // isNew=true 探针：count-1 = 实际数
    const count = sb.count - 1
    return { count, max: sb.max, reached: count >= sb.max }
  })

  // ── 编排层（S1 第二批）：派发 / 收割 / sweep / 竹节自动接力 ──
  // 端口注入（引擎核心不 import DSH API）：宿主装配 subagents/timer/sessionQuery/tokenMeter。
  // 构造期可空缺，宿主 apply 时经 attachPorts 热装配（测试同入口）。
  // runtime 节点状态机（PLAN 接口缝闭集）：running → succeeded|failed|timeout|cancelled|frozen（竹节在 running 内部轮换会话，不改状态）。
  let ports = opts.ports ?? {}
  const orchCfg = {
    nodeTimeoutMs: 30 * 60_000,
    sweepIntervalMs: 60_000,
    bambooThresholdPct: cfg.ctx_segment_threshold,
    graceMs: 5 * 60_000,
    ...opts.orchestra,
  }
  const needPort = (name) => { if (typeof ports[name] !== 'function') treeError('E_PORTS_NOT_WIRED', `port "${name}" not wired (host adapter responsibility)`) }

  function runtimeOf(leaf) {
    if (!leaf.runtime) {
      leaf.runtime = { state: 'pending', subagentSessionId: null, dispatchedAt: 0, lastOutputAt: 0, attempt: 0, segmentChain: [], lastHandoffAt: 0, handoffBrief: null, history: [] }
    }
    return leaf.runtime
  }

  /** dispatch:start — 派发执行（内部转 ports.dispatch ≅ subagents.startContinuable）。
   *  E2E 实证（2026-10-04）：startContinuable 的 request.parent 必须是活 Agent（ctx.agents 注册校验）——
   *  spec.parentAgent = 工具调用 exec.agent；竹节接力时由宿主 ports 复用捕获的引用。
   *  非可序列化引用只经 ports 透传；state 仅存 parentSessionId（interrupt 持久地址）。 */
  async function dispatchStart(args, caller) {
    const [treeId, leafId, spec] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      if (leaf.role === 'root') treeError('E_SCHEMA_INVALID', 'cannot dispatch root leaf')
      const rt = runtimeOf(leaf)
      if (rt.state === 'running') treeError('E_SCHEMA_INVALID', `node "${leafId}" already running (cancel or wait harvest first)`)
      // 依赖闸（§7 任务1）：所有 dependencies 节点必须已 succeeded（runtime 终态成功 ∨ status done——
      // done 三重闸需 milestone 面经 store/直改注入，工具面正常路径是 runtime succeeded 回流）
      if (Array.isArray(leaf.dependencies) && leaf.dependencies.length > 0) {
        const depDone = (d) => state.leaves[d]?.status === 'done' || state.leaves[d]?.runtime?.state === 'succeeded'
        const unmet = leaf.dependencies.filter((d) => !depDone(d))
        if (unmet.length > 0) {
          treeError('E_DEPENDENCY_NOT_MET', `node "${leafId}" dispatch blocked: dependencies not succeeded [${unmet.map((d) => `${d}(status=${state.leaves[d]?.status ?? 'missing'},runtime=${state.leaves[d]?.runtime?.state ?? 'none'})`).join(', ')}]`)
        }
      }
      needPort('dispatch')
      const session = await ports.dispatch({
        treeId, leafId, prompt: spec?.prompt ?? leaf.brief, assignee: spec?.assignee, dod: spec?.dod ?? leaf.dod,
        taskType: spec?.taskType ?? leaf.taskType,
        parentAgent: spec?.parentAgent, parentSessionId: spec?.parentSessionId ?? caller,
        attempt: rt.attempt + 1,
        // v0.8.1（D22）：显式携带绝对深度上限（宿主只在显式传入时校验；不传=无上限）
        maxDepth: cfg.max_subagent_depth,
      })
      if (!session || typeof session !== 'object') treeError('E_PORTS_PROTOCOL', 'ports.dispatch must resolve {sessionId}')
      rt.history.push({ sessionId: rt.subagentSessionId, state: rt.state, endedAt: clock.now() })
      rt.state = 'running'
      rt.subagentSessionId = session.sessionId
      // E2E#5 修复：派发即绑定执行者为节点 owner（否则 done 事件所有权 caller===session_id 永远不可满足，
      // 执行者无法自举结算；重派时绑定最新执行者）。手动 set-session（creator-only）不受影响。
      leaf.session_id = session.sessionId
      // [agspec-C1] assignee 完整持久化(竹节接力/硬改道重派的 assignee 来源;消除 leaf.model 恒 'unknown')
      const assignee = (spec?.assignee && typeof spec.assignee === 'object')
        ? {
            ...(spec.assignee.provider ? { provider: spec.assignee.provider } : {}),
            ...(spec.assignee.model ? { model: spec.assignee.model } : {}),
            ...(spec.assignee.effort ? { effort: spec.assignee.effort } : {}),
            ...(spec.assignee.preset ? { preset: spec.assignee.preset } : {}),
          }
        : null
      leaf.assignee = assignee
      // 兼容旧观测字段:有声明才覆盖 'unknown'
      if (assignee?.model) { leaf.model = assignee.model; leaf.channel = assignee.provider ?? assignee.model }
      else if (!leaf.model) { leaf.model = 'unknown'; leaf.channel = leaf.channel ?? 'unknown' }
      rt.parentSessionId = spec?.parentSessionId ?? caller ?? null
      rt.attempt += 1                     // 竹节不改 attempt（仅失败/超时重派计）
      rt.dispatchedAt = clock.now()
      rt.lastOutputAt = clock.now()
      rt.handoffBrief = null
      // [agspec-C3] 会话配置自描述块：随 taskPrompt 持久化（竹节接力/重派自然保持;宿主 resolve 可能覆盖意图值,
      // 生效值以 self_spec 工具查询为准;温度在宿主 subagent 链路无配置点——声明≠生效,诚实标注）
      const declared = [
        '<session-config-declared>',
        `label: tree:${treeId}/${leafId}`,
        `parent session: ${rt.parentSessionId ?? '(engine default)'}`,
        `assignee(intent): ${JSON.stringify(assignee ?? { note: 'unspecified → host/parent default resolution' })}`,
        'permissions: inherited from parent at start; approval pinned to "never"; scope fixed for this session lifetime',
        'note: values above are dispatch INTENT; runtime-effective values may differ (host route/preset overrides). Query tool self_spec for observed values.',
        'note: temperature is not configurable in the current host subagent chain at all.',
        '</session-config-declared>',
      ].join('\n')
      rt.taskPrompt = `${spec?.prompt ?? leaf.brief ?? ''}\n\n${declared}`   // E2E#4 修复：任务正文持久化（竹节接力的提示词来源）
      await store.write(treeId, state)
      return { node: { leaf_id: leafId, state: rt.state, session_id: rt.subagentSessionId, attempt: rt.attempt } }
    })
  }

  /** dispatch:cancel — 取消（先到者生效：与超时硬截止/竹节不叠加）。 */
  async function dispatchCancel(args, caller) {
    const [treeId, leafId] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      // P1-05：止血操作 owner/creator/root 均可（陌生人不得取消别人的 running 节点）
      assertLeafWriter(state, leaf, caller, 'cancel', state.leaves?.[`${treeId}-root`]?.session_id)
      const rt = runtimeOf(leaf)
      if (rt.state !== 'running') treeError('E_SCHEMA_INVALID', `cancel requires running node (got ${rt.state})`)
      try { if (typeof ports.interrupt === 'function') await ports.interrupt(rt.subagentSessionId) } catch { /* 中断失败仍置 cancelled（收割侧兜底） */ }
      rt.history.push({ sessionId: rt.subagentSessionId, state: rt.state, endedAt: clock.now() })
      rt.state = 'cancelled'
      await store.write(treeId, state)
      return { node: { leaf_id: leafId, state: rt.state } }
    })
  }

  /**
   * 竹节接力（engine-internal；sweep 触发为主，dispatch {action:"handoff"} 手动兜底）。
   * 顺序铁律（meta-system §4.2 Z6）：先 interrupt 旧会话释放并发名额、后 dispatch 新会话。
   * 简报宽限：ports.promptHandoff 超时/空 → no-handoff-summary 照常接手。
   */
  async function bambooRelay(treeId, leaf, rt, state, briefFallback = null) {
    needPort('promptHandoff'); needPort('interrupt'); needPort('dispatch')
    let brief = briefFallback
    let briefState = briefFallback ? 'manual' : 'ok'
    if (!brief) {
      try {
        brief = await ports.promptHandoff(rt.subagentSessionId)
        if (brief == null) { brief = null; briefState = 'no-handoff-summary' }
      } catch { brief = null; briefState = 'no-handoff-summary' }
    }
    if ((rt.segmentChain ?? []).length >= (cfg.segment_max_chain_length ?? 5)) {
      rt.state = 'frozen'; rt.history.push({ sessionId: rt.subagentSessionId, state: 'running', endedAt: clock.now(), note: 'segment-chain-limit → frozen' })
      return { relay: 'frozen-chain-limit' }
    }
    // ① 先 interrupt（释放 maxActiveSubagents 名额；authority 用持久父地址）
    try { await ports.interrupt(rt.subagentSessionId, rt.parentSessionId) } catch { /* 尽力而为 */ }
    // ② 后 dispatch 新会话（提示词 = 任务正文（E2E#4 修复：rt.taskPrompt 持久化）+ 简报 + 同一 DoD）
    // [agspec-C2] 接力 assignee 原样透传(此前只恢复 model 且 leaf.model 恒 'unknown' → 接力零路由保持,静默降级)
    const session = await ports.dispatch({
      treeId, leafId: leaf.leaf_id, prompt: rt.taskPrompt ?? leaf.brief, dod: leaf.dod,
      assignee: leaf.assignee ?? (leaf.model && leaf.model !== 'unknown' ? { model: leaf.model } : undefined),
      handoffBrief: brief, segmentIndex: (rt.segmentChain ?? []).length + 1, attempt: rt.attempt,
      // v0.8.0（P1-D）：持久父地址随 relay 传给宿主端口——热更后进程内 Agent 缓存丢失时，
      // 宿主可经 agents.get(parentSessionId) 安全重解析活 Agent（否则 reload 后自主 relay 必失败）。
      parentSessionId: rt.parentSessionId ?? null,
      // v0.8.1（D22）：接力会话同样携带深度上限（否则接力可绕过派发侧上限）
      maxDepth: cfg.max_subagent_depth,
    })
    rt.history.push({ sessionId: rt.subagentSessionId, state: 'running', endedAt: clock.now(), note: 'bamboo-relay' })
    if (briefState === 'ok' || briefState === 'manual') rt.handoffBrief = brief
    rt.segmentChain.push(session.sessionId)
    rt.subagentSessionId = session.sessionId
    // v0.5.0（审计 B1 修复）：竹节接力就是"同一 leaf 换会话"——done 所有权必须随之迁移到
    // 接手会话，否则接力会话写 done 会被 E_BORROWED_IDENTITY 拒、leaf 只能等 timeout。
    leaf.session_id = session.sessionId
    rt.lastHandoffAt = clock.now()
    leaf.context_usage_pct = 0   // E2E 终验修复：接力后水位清零（新会话全新上下文；残留会引发连环接力烧链）
    leaf.drift_history.push({ ts: nowIso(clock), leaf_id: leaf.leaf_id, kind: 'rhythm', severity: 'low', action: 'handoff', to_session: session.sessionId, reason: `bamboo relay #${rt.segmentChain.length} (${briefState})` })
    state.drift_log.push(leaf.drift_history[leaf.drift_history.length - 1])   // 源语义对齐：竹节留痕入 drift_log
    rt.dispatchedAt = clock.now()   // 基准时刻重置（sweep 误判保护）
    rt.lastOutputAt = clock.now()
    return { relay: 'ok', briefState, sessionId: session.sessionId }
  }

  /**
   * sweep:tick — 定时收割（硬截止兜底；双轨四路径之④）。
   * 语义：收割前必经 lastOutputAt 刷新（误判保护）；超时判定 = max(dispatchedAt,lastOutputAt)+timeout ≤ now；
   * 竹节检查 = usagePct（宿主测量）∨ leaf.context_usage_pct（自报），先到者生效。
   * 幂等；逐树串行；单树异常不毒化整轮。
   */
  async function sweepTick() {
    const results = []
    for (const treeId of await store.list()) {
      try {
        results.push(await enqueue(treeId, async () => {
          const state = await store.read(treeId)
          if (!state) return { tree_id: treeId, skipped: 'missing' }
          const events = []
          for (const leaf of Object.values(state.leaves)) {
            const rt = leaf.runtime
            if (!rt || rt.state !== 'running') continue
            // E2E#5 修复：收割兜底——已有 done 事件但 runtime 仍 running（历史遗留/写入竞态）→ 补回流 succeeded。
            if ((leaf.events ?? []).some((e) => e.type === 'done')) {
              rt.history.push({ sessionId: rt.subagentSessionId, state: 'running', endedAt: clock.now(), note: 'done event (sweep reflux)' })
              rt.state = 'succeeded'
              events.push({ leaf_id: leaf.leaf_id, event: 'succeeded' })
              continue
            }
            // (b) 收割时刷新：超时判定前必经 lastOutputAt 读取
            if (typeof ports.lastOutputAt === 'function') {
              try {
                const t = await ports.lastOutputAt(rt.subagentSessionId)
                if (typeof t === 'number' && t > rt.lastOutputAt) rt.lastOutputAt = t
              } catch { /* 会话日志不可读：保守用旧值（引擎侧告警责任在宿主装配层） */ }
            }
            const baseline = Math.max(rt.dispatchedAt, rt.lastOutputAt)
            const now = clock.now()
            if (now - baseline >= orchCfg.nodeTimeoutMs) {
              rt.history.push({ sessionId: rt.subagentSessionId, state: 'running', endedAt: now, note: 'timeout hard deadline' })
              rt.state = 'timeout'
              events.push({ leaf_id: leaf.leaf_id, event: 'timeout' })
              continue
            }
            // 竹节检查
            // v0.8.0（P0-A）：per-leaf relay 开关——leaf.relay==='off' 时跳过竹节（只跳过 relay，
            // 超时/收割语义与 runtime.state 不变），供等待外部编排（flow/verify/长命令）的 leaf 使用。
            if (leaf.relay !== 'off') {
              let usage = null
              try { if (typeof ports.usagePct === 'function') usage = await ports.usagePct(rt.subagentSessionId) } catch { usage = null }
              // v0.8.0 收口（F3 生效后的口径）：宿主测量与自报是「∨ / 先到者生效」双信号——
              // 任一信号达阈值即触发。旧写法在测量可用时**覆盖**自报（pct = usage ?? self），
              // 会让「执行者自报已到点、但宿主测量尚未反映」的会话失去竹节；取高即保留两路信号。
              const measured = (typeof usage === 'number') ? usage : -1
              const selfReported = (typeof leaf.context_usage_pct === 'number') ? leaf.context_usage_pct : 0
              const pct = Math.max(measured, selfReported)
              if (pct >= orchCfg.bambooThresholdPct && leaf.role !== 'root') {
                const r = await bambooRelay(treeId, leaf, rt, state)
                events.push({ leaf_id: leaf.leaf_id, event: 'bamboo', ...r })
              }
            }
          }
          await store.write(treeId, state)
          return { tree_id: treeId, events }
        }))
      } catch (e) {
        const errLine = { ts: nowIso(clock), sweep_error: String(e?.message ?? e), stack: String(e?.stack ?? '').slice(0, 500) }
        await store.appendCallLog(treeId, errLine).catch(() => {})
        results.push({ tree_id: treeId, error: String(e?.message ?? e) })
      }
    }
    return { swept: results }
  }

  /** sweep 定时器（timer 注入缝；不可用 → degraded-lazy 模式，tree_status 暴露 sweepMode）。 */
  let stopSweep = null
  let sweepMode = 'idle'
  function startSweep() {
    if (typeof clock.scheduleInterval !== 'function') { sweepMode = 'degraded-lazy'; return { sweepMode, stop: null } }
    stopSweep = clock.scheduleInterval(() => { void sweepTick() }, orchCfg.sweepIntervalMs)
    sweepMode = 'timer'
    return { sweepMode, stop: () => { if (stopSweep) stopSweep(); stopSweep = null; sweepMode = 'idle' } }
  }

  // ── 查询/日志/维护命令（S1 第三批，语义对齐源引擎）──────────
  function eventList(args) {
    const [treeId, leafId, type] = args
    return withTree(treeId, async (state) => {
      let leaves = leafId ? [mustLeaf(state, leafId)] : Object.values(state.leaves)
      const events = []
      for (const l of leaves) for (const ev of l.events ?? []) {
        if (type && ev.type !== type) continue
        events.push({ leaf_id: l.leaf_id, ...ev })
      }
      events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
      return { events }
    })
  }

  async function driftAppend(args) {
    const [treeId, leafId, kind, severity, action, forkTo, reason] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      if (!DRIFT_KIND_ENUM.includes(kind)) treeError('E_SCHEMA_INVALID', `drift kind "${kind}" invalid (${DRIFT_KIND_ENUM.join('|')})`)
      if (!DRIFT_SEVERITY_ENUM.includes(severity)) treeError('E_SCHEMA_INVALID', `drift severity "${severity}" invalid (${DRIFT_SEVERITY_ENUM.join('|')})`)
      if (!DRIFT_ACTION_ENUM.includes(action)) treeError('E_SCHEMA_INVALID', `drift action "${action}" invalid (${DRIFT_ACTION_ENUM.join('|')})`)
      const entry = { ts: nowIso(clock), leaf_id: leafId, kind, severity, action, ...(forkTo ? { fork_to: forkTo } : {}), ...(reason ? { reason } : {}) }
      leaf.drift_history.push(entry)
      state.drift_log.push(entry)
      await store.write(treeId, state)
      return { drift: entry }
    })
  }

  function driftList(args) {
    const [treeId, leafId, since] = args
    return withTree(treeId, async (state) => {
      let log = state.drift_log ?? []
      if (leafId) log = log.filter((d) => d.leaf_id === leafId)
      if (since) log = log.filter((d) => d.ts >= since)
      return { drifts: log }
    })
  }

  async function heartbeatAppend(args) {
    const [treeId, heartbeat] = args
    return withTree(treeId, async (state) => {
      if (!heartbeat || typeof heartbeat !== 'object' || !Array.isArray(heartbeat.verdicts)) {
        treeError('E_SCHEMA_INVALID', 'heartbeat object with verdicts[] required')
      }
      const ts = nowIso(clock)
      const entry = { ts, verdicts: heartbeat.verdicts }
      if (!Array.isArray(state.heartbeat_log)) state.heartbeat_log = []
      state.heartbeat_log.push(entry)
      if (state.heartbeat_log.length > 500) state.heartbeat_log.splice(0, state.heartbeat_log.length - 500)
      state.last_heartbeat = ts
      for (const v of heartbeat.verdicts) {
        const leaf = state.leaves[v.leaf_id]
        if (!leaf) continue
        leaf.last_event_type = 'status_check'
        leaf.last_event_ts = ts
        if (v.verdict === 'frozen') leaf.drift_history.push({ ts, leaf_id: v.leaf_id, kind: 'rhythm', severity: 'mid', action: 'declare', reason: 'heartbeat frozen verdict' })
      }
      await store.write(treeId, state)
      return { heartbeat: { ts, count: heartbeat.verdicts.length } }
    })
  }

  function heartbeatTail(args) {
    const [treeId, n = 10] = args
    return withTree(treeId, async (state) => ({ heartbeats: (state.heartbeat_log ?? []).slice(-n) }))
  }

  async function communicationLog(args, caller) {
    const [treeId, targetSessionId, direction = 'out', note] = args
    return withTree(treeId, async (state) => {
      if (!targetSessionId) treeError('E_SCHEMA_INVALID', 'target_session_id required')
      // 定位 target leaf（leaves.session_id / segment_chain / registry）
      let targetLeafId = null
      for (const l of Object.values(state.leaves)) {
        // W2.6：target 归一化比较（带 `session-` 前缀也可定位 leaf）
        if (sameSession(l.session_id, targetSessionId) || (l.segment_chain ?? []).some((sid) => sameSession(sid, targetSessionId))) { targetLeafId = l.leaf_id; break }
      }
      if (!targetLeafId && state.session_registry?.[targetSessionId]?.leaf_id) targetLeafId = state.session_registry[targetSessionId].leaf_id
      const entry = { ts: nowIso(clock), from: caller ?? null, target_session_id: targetSessionId, direction, ...(note ? { note } : {}), ...(targetLeafId ? { leaf_id: targetLeafId } : {}) }
      if (!Array.isArray(state.communication_log)) state.communication_log = []
      state.communication_log.push(entry)
      // 心跳可观测性：自动更新 target leaf last_event（防误判冻结；源 P1-2 语义）
      if (targetLeafId && state.leaves[targetLeafId]) {
        state.leaves[targetLeafId].last_event_type = 'status_check'
        state.leaves[targetLeafId].last_event_ts = entry.ts
      }
      await store.write(treeId, state)
      return { communication: entry }
    })
  }

  function communicationList(args) {
    const [treeId, leafId, target, since] = args
    return withTree(treeId, async (state) => {
      let log = state.communication_log ?? []
      if (leafId) log = log.filter((c) => c.leaf_id === leafId)
      if (target) log = log.filter((c) => c.target_session_id === target)
      if (since) log = log.filter((c) => c.ts >= since)
      return { communications: log }
    })
  }

  async function nudgeReset(args) {
    const [treeId, leafId] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      leaf.nudge_count = 0
      leaf.nudge_log = []
      await store.write(treeId, state)
      return { leaf: { leaf_id: leafId, nudge_count: 0 } }
    })
  }

  async function registerSession(args) {
    const [treeId, sessionIdRaw, source, caller] = args
    // W2.6：登记会话 id 归一化（带 `session-` 前缀也可）
    const sessionId = normalizeSessionId(sessionIdRaw)
    return withTree(treeId, async (state) => {
      if (!isStrictUuidV4(sessionId)) treeError('E_INVALID_UUID_STRICT', `session_id "${sessionId}" must be strict UUID v4`)
      const conflict = findSessionConflict(state, sessionId)
      if (conflict) treeError('E_SCHEMA_INVALID', conflict)   // 已登记：幂等拒绝重复计（调用方按已存在处理）
      const sb = sessionBudget(state, sessionId, cfg)
      if (sb.reached) treeError('E_MAX_SESSIONS', `register_session rejected: ${sb.count} > ${sb.max} [macp2 guard]`)
      state.session_registry[sessionId] = { ts: nowIso(clock), ...(source ? { source } : {}), ...(caller ? { caller } : {}) }
      await store.write(treeId, state)
      return { registered: sessionId, count: sb.count, max: sb.max }
    })
  }

  // v0.3 backup/restore：状态内快照（保留 10 份；tree_id 匹配校验）。
  // 边界：文件级备份随 storageDomain 适配升级；语义（轮转/恢复前快照/跨树校验）已对齐。
  async function backup(args) {
    const [treeId, label] = args
    return withTree(treeId, async (state) => {
      if (!Array.isArray(state.backups)) state.backups = []
      const name = `backup-${nowIso(clock).replace(/[:.]/g, '-')}${label ? `-${label}` : ''}`
      state.backups.push({ name, ts: nowIso(clock), state: structuredClone(state) })
      // 快照内嵌自身会递归——替换为占位
      state.backups[state.backups.length - 1].state.backups = []
      if (state.backups.length > 10) state.backups.splice(0, state.backups.length - 10)
      await store.write(treeId, state)
      return { backup: name, kept: state.backups.map((b) => b.name) }
    })
  }

  async function restore(args) {
    const [treeId, backupName] = args
    return withTree(treeId, async (state) => {
      const found = (state.backups ?? []).find((b) => b.name === backupName)
      if (!found) treeError('E_BACKUP_NOT_FOUND', `backup "${backupName}" not found (kept: ${(state.backups ?? []).map((b) => b.name).join(', ') || 'none'})`)
      if (found.state.tree_id !== treeId) treeError('E_BACKUP_CORRUPT', `backup tree_id mismatch: ${found.state.tree_id} ≠ ${treeId}`)
      const preRestore = structuredClone(state)
      preRestore.backups = []
      const newBackups = [{ name: `before-restore-${nowIso(clock).replace(/[:.]/g, '-')}`, ts: nowIso(clock), state: preRestore }, ...(found.state.backups ?? [])]
      const restored = structuredClone(found.state)
      restored.backups = newBackups.slice(0, 10)
      await store.write(treeId, restored)
      return { restored_from: backupName, tree_id: treeId }
    })
  }

  const table = {
    init, validate, treeDump, sessionCount,
    'leaf:add': leafAdd, 'leaf:get': leafGet, 'leaf:list-active': leafListActive, 'leaf:list-all': leafListAll,
    'leaf:set-status': setStatus, 'leaf:set-session': setSession, 'leaf:set-context': setContext,
    'leaf:set-verification': setVerification, 'leaf:set-relay': setRelay,
    'event:append': eventAppend, 'event:list': eventList, 'segment:append': segmentAppend,
    'nudge:append': nudgeAppend, 'nudge:reset': nudgeReset,
    'drift:append': driftAppend, 'drift:list': driftList,
    'heartbeat:append': heartbeatAppend, 'heartbeat:tail': heartbeatTail,
    'communication:log': communicationLog, 'communication:list': communicationList,
    'tree:register-session': registerSession, 'backup': backup, 'restore': restore,
    'dispatch:start': dispatchStart, 'dispatch:cancel': dispatchCancel, 'sweep:tick': sweepTick,
  }

  /**
   * 统一入口（run() 契约）：永不 throw。
   * @param {string} cmd
   * @param {any[]} args
   * @param {string} [caller]
   */
  async function call(cmd, args, caller, tsIso) {
    const handler = table[cmd]
    let line
    try {
      if (!handler) treeError('E_UNKNOWN', `unknown command "${cmd}". Available: ${Object.keys(table).join(', ')}`)
      const result = await handler(args ?? [], caller, tsIso)
      line = { ts: nowIso(clock), cmd, ok: true, caller }
      await store.appendCallLog(String(args?.[0] ?? ''), line).catch(() => {})
      return { ok: true, ...result }
    } catch (/** @type {any} */ e) {
      const err = { code: e.code ?? 'E_INTERNAL', message: e.message ?? String(e) }
      if (e.helpTopic) err.helpTopic = e.helpTopic
      line = { ts: nowIso(clock), cmd, ok: false, caller, error: err }
      await store.appendCallLog(String(args?.[0] ?? ''), line).catch(() => {})
      return { ok: false, error: err }
    }
  }

  return { call, table, config: cfg, startSweep, sweepTick, sweepModeOf: () => sweepMode, attachPorts: (p) => { ports = p ?? {} } }
}
