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
  DEFAULT_GUARDS, isStrictUuidV4, sessionBudget, activeLeafBudget, spawnBudget,
  assertCallerIs, findSessionConflict,
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
    const [treeId, rootBrief, rootDod, sessionId, auditMeta] = args
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
      const { leaf_id, session_id, parent, path: leafPath, role, added_by } = leaf
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
        ...leaf, status: leaf.role === 'worker' ? 'pending_brief' : 'active',
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
      // caller：owner / creator / root（P1 防借身份）
      const rootSession = state.leaves[`${treeId}-root`].session_id
      if (caller !== leaf.session_id && caller !== leaf.added_by && caller !== rootSession) {
        treeError('E_BORROWED_IDENTITY', `caller not authorized to set status of "${leafId}" (owner/creator/root only)`)
      }
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
    const [treeId, leafId, sessionId] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
      assertCallerIs(caller, leaf.added_by, 'set-session')
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

  // ── set-context（竹节刚性触发）────────────────────────
  async function setContext(args) {
    const [treeId, leafId, pct] = args
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) treeError('E_SCHEMA_INVALID', `pct "${pct}" must be an integer 0-100`)
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
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
      // done event 所有权：caller 必须 === leaf.session_id（V10-trust-anchor-fix：明确移除 added_by 代写权，
      // 堵 commander 谎报 worker done——源 L2759-2760 失守根因）
      if (type === 'done') {
        if (caller !== leaf.session_id) {
          treeError('E_BORROWED_IDENTITY', `caller cannot write done event for "${leafId}" (owner session only)`)
        }
      }
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
    const [treeId, leafId, newSessionId] = args
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
      const seen = new Map()
      for (const leaf of Object.values(state.leaves)) {
        if (leaf.session_id) {
          if (seen.has(leaf.session_id)) issues.push({ type: 'session_duplicate', leaf_id: leaf.leaf_id, detail: `duplicates ${seen.get(leaf.session_id)}` })
          else seen.set(leaf.session_id, leaf.leaf_id)
        }
        for (const sid of leaf.segment_chain ?? []) {
          if (seen.has(sid)) issues.push({ type: 'session_duplicate', leaf_id: leaf.leaf_id, detail: `segment_chain duplicates ${seen.get(sid)}` })
          else seen.set(sid, leaf.leaf_id)
        }
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
      needPort('dispatch')
      const session = await ports.dispatch({
        treeId, leafId, prompt: spec?.prompt ?? leaf.brief, assignee: spec?.assignee, dod: spec?.dod ?? leaf.dod,
        parentAgent: spec?.parentAgent, parentSessionId: spec?.parentSessionId ?? caller,
        attempt: rt.attempt + 1,
      })
      if (!session || typeof session !== 'object') treeError('E_PORTS_PROTOCOL', 'ports.dispatch must resolve {sessionId}')
      rt.history.push({ sessionId: rt.subagentSessionId, state: rt.state, endedAt: clock.now() })
      rt.state = 'running'
      rt.subagentSessionId = session.sessionId
      // E2E#5 修复：派发即绑定执行者为节点 owner（否则 done 事件所有权 caller===session_id 永远不可满足，
      // 执行者无法自举结算；重派时绑定最新执行者）。手动 set-session（creator-only）不受影响。
      leaf.session_id = session.sessionId
      rt.parentSessionId = spec?.parentSessionId ?? caller ?? null
      rt.attempt += 1                     // 竹节不改 attempt（仅失败/超时重派计）
      rt.dispatchedAt = clock.now()
      rt.lastOutputAt = clock.now()
      rt.handoffBrief = null
      rt.taskPrompt = spec?.prompt ?? leaf.brief ?? null   // E2E#4 修复：任务正文持久化（竹节接力的提示词来源）
      await store.write(treeId, state)
      return { node: { leaf_id: leafId, state: rt.state, session_id: rt.subagentSessionId, attempt: rt.attempt } }
    })
  }

  /** dispatch:cancel — 取消（先到者生效：与超时硬截止/竹节不叠加）。 */
  async function dispatchCancel(args, caller) {
    const [treeId, leafId] = args
    return withTree(treeId, async (state) => {
      const leaf = mustLeaf(state, leafId)
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
  async function bambooRelay(treeId, leaf, rt, briefFallback = null) {
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
    const session = await ports.dispatch({
      treeId, leafId: leaf.leaf_id, prompt: rt.taskPrompt ?? leaf.brief, dod: leaf.dod,
      assignee: leaf.model ? { model: leaf.model } : undefined,
      handoffBrief: brief, segmentIndex: (rt.segmentChain ?? []).length + 1, attempt: rt.attempt,
    })
    rt.history.push({ sessionId: rt.subagentSessionId, state: 'running', endedAt: clock.now(), note: 'bamboo-relay' })
    if (briefState === 'ok' || briefState === 'manual') rt.handoffBrief = brief
    rt.segmentChain.push(session.sessionId)
    rt.subagentSessionId = session.sessionId
    rt.lastHandoffAt = clock.now()
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
            let usage = null
            try { if (typeof ports.usagePct === 'function') usage = await ports.usagePct(rt.subagentSessionId) } catch { usage = null }
            const pct = (typeof usage === 'number') ? usage : (leaf.context_usage_pct ?? 0)
            if (pct >= orchCfg.bambooThresholdPct && leaf.role !== 'root') {
              const r = await bambooRelay(treeId, leaf, rt)
              events.push({ leaf_id: leaf.leaf_id, event: 'bamboo', ...r })
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
        if (l.session_id === targetSessionId || (l.segment_chain ?? []).includes(targetSessionId)) { targetLeafId = l.leaf_id; break }
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
    const [treeId, sessionId, source, caller] = args
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
