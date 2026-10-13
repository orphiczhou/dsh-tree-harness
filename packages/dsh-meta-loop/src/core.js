/**
 * 元系统工作法方法轮核心(meta-loop core)v0.1 — 纯逻辑,不 import DSH API。
 * 设计真源:docs/meta-loop-design.md(metalp 树产出)。
 *
 * 定位:「循环记账员 + 门禁判官」,不是循环执行器——
 *   机器管顺序与完整性(轮次/阶段/工件/门禁/裕度);人管方向与价值(向心/六类/第一人称,留 SKILL 层);
 *   引擎管把活干完(建点/派发/结算主权全在 tree-engine,本核心零写引擎状态)。
 *
 * 主链:feedback → analysis(1115) → planning(六类) → decision(APX+裕度) → implementation → retro(总体检视)
 * 每阶段 record = 工件落账 + G-* 门禁判定 + 通过即推进;retro 关轮 + M4 触发判定 + 开下一轮或宣告稳定(可撤销)。
 */

const STAGES = ['feedback', 'analysis', 'planning', 'decision', 'implementation', 'retro']
const ESTIMATES = ['ample', 'tight', 'negative', 'unknown']
const VERDICTS = ['adopt', 'hold', 'drop']
const DEFAULT_STABLE_ROUNDS = 2

class MetaError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const nowIso = () => new Date().toISOString()

/** G-* 门禁(机械可验子集;12 条)。返回 checks:[{rule, pass, detail}]。 */
function gateFor(stage, cycle) {
  const t = (v) => (typeof v === 'string' && v.trim().length > 0)
  switch (stage) {
    case 'feedback': {
      const entries = cycle.stages?.feedback?.entries ?? []
      const checks = [
        { rule: 'G1-evidence', pass: entries.length > 0 && entries.every((e) => t(e.evidence)), detail: '每条反馈须有可验证出处(无证据不进分析)' },
      ]
      return checks
    }
    case 'analysis': {
      const a = cycle.stages?.analysis ?? {}
      const bps = a.breakpoints ?? []
      const fq = a.five_questions ?? {}
      return [
        { rule: 'G2-breakpoints-flagged', pass: bps.length > 0 && bps.every((b) => typeof b.open === 'boolean' && t(b.desc)), detail: '断点逐条存在且标开/闭' },
        { rule: 'G3-five-questions', pass: t(fq.q4) && t(fq.q5), detail: '五问之 Q4(候选方向)/Q5(本轮逼近方向)非空' },
      ]
    }
    case 'planning': {
      const acts = (cycle.stages?.planning?.actions) ?? []
      const openBps = (cycle.stages?.analysis?.breakpoints ?? []).filter((b) => b.open)
      const covered = new Set(acts.map((a) => a.target_breakpoint).filter(Boolean))
      return [
        { rule: 'G4-coverage', pass: openBps.length > 0 ? openBps.every((b) => (b.id ? covered.has(b.id) : covered.size > 0)) : acts.length > 0, detail: '覆盖性:每个开放断点至少 1 条有落点动作(或无开放断点时至少 1 条动作)' },
      ]
    }
    case 'decision': {
      const d = cycle.stages?.decision ?? {}
      const rulings = d.rulings ?? []
      const margins = d.margins ?? []
      const objs = (cycle.stages?.analysis?.stable_objects ?? []).map((o) => o.id ?? o.name).filter(Boolean)
      const margined = new Set(margins.map((m) => m.object).filter(Boolean))
      return [
        { rule: 'G5-verdict-enum', pass: rulings.length > 0 && rulings.every((r) => VERDICTS.includes(r.verdict)), detail: `裁决 ∈ ${VERDICTS.join('|')} 且非空` },
        { rule: 'G5b-hold-condition', pass: rulings.filter((r) => r.verdict === 'hold').every((r) => t(r.condition)), detail: '「缓」项写明启用条件' },
        { rule: 'G6-margin-signal', pass: margins.length > 0 && (objs.length === 0 || objs.every((o) => margined.has(o))), detail: '每个稳定对象 ≥1 可测裕度信号' },
        { rule: 'G7-estimate-enum', pass: margins.every((m) => ESTIMATES.includes(m.estimate)), detail: `裕度档位 ∈ ${ESTIMATES.join('|')}` },
      ]
    }
    case 'implementation': {
      const items = (cycle.stages?.implementation?.checklist) ?? []
      return [
        { rule: 'G8-checklist', pass: items.length > 0 && items.every((i) => t(i.id) && t(i.text) && typeof i.checked === 'boolean'), detail: '清单非空且逐条可勾验(id/text/checked)' },
        { rule: 'G8b-done-evidence', pass: items.filter((i) => i.checked).every((i) => t(i.evidence)), detail: '已勾项须有证据' },
      ]
    }
    case 'retro': {
      const r = cycle.stages?.retro ?? {}
      const tt = r.trigger_table ?? []
      return [
        { rule: 'G10-results-residuals', pass: t(r.results) && Array.isArray(r.residuals), detail: '结果比对完成 + 残余逐条登记' },
        { rule: 'G11-trigger-evaluated', pass: tt.length > 0 && tt.every((x) => typeof x.evaluated === 'boolean'), detail: '触发表 ≥1 条且逐条被评估' },
      ]
    }
    default: return []
  }
}

/** M4 递归触发表(MVP 硬编码 4 条):输入 = 树聚合 + 本轮数据 → 每条 {trigger, fires, note}。 */
function evaluateTriggers(agg, cycle) {
  const fails = (agg?.runtime_failed ?? 0) + (agg?.runtime_timeout ?? 0) + (agg?.runtime_frozen ?? 0) + (agg?.verify_fail ?? 0)
  return [
    { trigger: 'T1-new-fail', fires: fails > 0, note: `新增失败/超时/冻结/验证FAIL 合计 ${fails} → 回分析` },
    { trigger: 'T2-degrade-freq', fires: (agg?.drift_high_severity ?? 0) > 2, note: `高级别 drift ${agg?.drift_high_severity ?? 0} 条 > 2 → 回分析` },
    { trigger: 'T3-budget', fires: (agg?.active_ratio ?? 0) > 0.8, note: `active 占比 ${Math.round((agg?.active_ratio ?? 0) * 100)}% > 80% → 回决策` },
    { trigger: 'T4-new-feedback', fires: (cycle.stages?.feedback?.entries ?? []).some((e) => e.source === 'external') || (agg?.recent_drifts ?? 0) > 0, note: '新外部反馈/新 drift → 回反馈' },
  ]
}

/**
 * @param {object} opts
 * @param {{read(id:string):Promise<object|null>, write(id:string, state:object):Promise<void>}} opts.store  状态 store(键 = tree_id)
 * @param {(treeId:string) => Promise<object|null>} [opts.readTreeState]  只读聚合源(tree-engine tree-state.json;缺省 → 全 0 聚合)
 * @param {number} [opts.stableRounds]
 */
export function createMetaLoopCore(opts) {
  const store = opts.store
  const readTreeState = opts.readTreeState ?? (async () => null)
  const stableRounds = opts.stableRounds ?? DEFAULT_STABLE_ROUNDS

  const err = (code, msg) => { throw new MetaError(code, msg) }

  async function load(treeId) {
    const s = await store.read(treeId)
    if (!s) err('E_LOOP_NOT_FOUND', `no meta-loop for tree "${treeId}" (meta_loop init first)`)
    return s
  }

  function currentCycle(s) { return s.rounds[s.rounds.length - 1] }

  function aggregate(state, cycleOpenedAt) {
    const leaves = Object.values(state?.leaves ?? {})
    const active = leaves.filter((l) => ['active', 'pending_brief', 'segment_pending'].includes(l.status)).length
    // T3 口径:未终态占比(以 runtime succeeded ∨ status done 为终态——避开 status/runtime 脱节的误报,e2e3l 审计已知现象)
    const terminal = leaves.filter((l) => l.runtime?.state === 'succeeded' || ['done', 'archived'].includes(l.status)).length
    const drifts = leaves.flatMap((l) => l.drift_history ?? [])
    return {
      leaves: leaves.length,
      active, active_ratio: leaves.length ? Math.max(0, (leaves.length - terminal) / leaves.length) : 0,
      runtime_succeeded: leaves.filter((l) => l.runtime?.state === 'succeeded').length,
      runtime_failed: leaves.filter((l) => l.runtime?.state === 'failed').length,
      runtime_timeout: leaves.filter((l) => l.runtime?.state === 'timeout').length,
      runtime_frozen: leaves.filter((l) => l.runtime?.state === 'frozen').length,
      verify_fail: leaves.filter((l) => l.verification && l.verification.pass === false).length,
      drift_high_severity: drifts.filter((d) => d.severity === 'high').length,
      recent_drifts: cycleOpenedAt ? drifts.filter((d) => !(typeof d.ts === 'string' && d.ts < cycleOpenedAt)).length : 0,
    }
  }

  /** 阶段推进:当前阶段门禁全绿才可进入下一阶段 record。 */
  function ensureStage(cycle, stage) {
    if (cycle.stage !== stage) err('E_STAGE_ORDER', `current stage is "${cycle.stage}" (round ${cycle.round}) — method loop order: ${STAGES.join('→')}`)
    // 前一阶段门禁必须已全绿(顺序铁律)
    const idx = STAGES.indexOf(stage)
    if (idx > 0) {
      const prev = STAGES[idx - 1]
      const checks = gateFor(prev, cycle)
      const failed = checks.filter((c) => !c.pass)
      if (failed.length) err('E_GATE_FAILED', `stage "${prev}" gate not green: ${failed.map((f) => `${f.rule}(${f.detail})`).join('; ')}`)
      cycle.stages[prev].gate = { status: 'pass', checks }
    }
  }

  const actions = {
    init(args) {
      return (async () => {
        const [treeId, objective, triggers] = args
        if (await store.read(treeId)) err('E_DUPLICATE', `meta-loop for "${treeId}" already exists`)
        if (!Array.isArray(triggers) || triggers.length === 0) err('E_NO_TRIGGER', 'init requires non-empty triggers[] — 无触发记录不开轮')
        const ts = nowIso()
        const state = {
          schema_version: 1, tree_id: treeId, objective: objective ?? null,
          created_at: ts, updated_at: ts, stableRounds,
          stable: { declared: false, since_round: 0, green_streak: 0 },
          current_round: 1,
          rounds: [{
            round: 1, opened_at: ts, closed_at: null, stage: 'feedback',
            trigger_signals: triggers,
            stages: { feedback: { entries: [] }, analysis: {}, planning: {}, decision: {}, implementation: {}, retro: {} },
          }],
        }
        await store.write(treeId, state)
        return { loop: { tree_id: treeId, round: 1, stage: 'feedback' } }
      })()
    },

    feedback(args) {
      return (async () => {
        const [treeId, entries] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'feedback')
        if (!Array.isArray(entries) || entries.length === 0) err('E_SCHEMA', 'entries[] required')
        // G1 前移:入账前逐条校验证据,防毒化账本(失败的空证据条目永久卡门禁)
        for (const e of entries) {
          if (!e || typeof e !== 'object' || !(e.event ?? e.reaction)) err('E_SCHEMA', 'each entry needs event/reaction')
          if (!(typeof e.evidence === 'string' && e.evidence.trim())) err('E_SCHEMA', 'G1-evidence: 每条反馈须有可验证出处(无证据不进分析)')
          c.stages.feedback.entries.push({ event: e.event ?? null, reaction: e.reaction ?? null, evidence: e.evidence, source: e.source ?? 'internal', ts: nowIso() })
        }
        // G1 判定:有证据才放行进入分析
        const checks = gateFor('feedback', c)
        c.stages.feedback.gate = { status: checks.every((x) => x.pass) ? 'pass' : 'fail', checks }
        if (c.stages.feedback.gate.status !== 'pass') {
          await store.write(treeId, s)
          err('E_GATE_FAILED', `feedback gate: ${checks.filter((x) => !x.pass).map((x) => `${x.rule}: ${x.detail}`).join('; ')}`)
        }
        c.stage = 'analysis'
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, stage: c.stage, entries: c.stages.feedback.entries.length }
      })()
    },

    analysis(args) {
      return (async () => {
        const [treeId, artifact] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'analysis')
        if (!artifact || typeof artifact !== 'object') err('E_SCHEMA', 'analysis artifact object required {systems, stable_objects, breakpoints, five_questions}')
        c.stages.analysis = { ...artifact }   // 宿主 tool-input 对象不可扩展——浅拷贝后再挂 gate(E2E 缺陷 A)
        const checks = gateFor('analysis', c)
        c.stages.analysis.gate = { status: checks.every((x) => x.pass) ? 'pass' : 'fail', checks }
        if (c.stages.analysis.gate.status !== 'pass') {
          await store.write(treeId, s)
          err('E_GATE_FAILED', `analysis gate (1115): ${checks.filter((x) => !x.pass).map((x) => `${x.rule} ${x.detail}`).join('; ')}`)
        }
        c.stage = 'planning'
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, stage: c.stage }
      })()
    },

    planning(args) {
      return (async () => {
        const [treeId, actions_] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'planning')
        if (!Array.isArray(actions_) || actions_.length === 0) err('E_SCHEMA', 'actions[] required {type(六类,自由文本), target_breakpoint, point}')
        c.stages.planning = { actions: actions_ }
        const checks = gateFor('planning', c)
        c.stages.planning.gate = { status: checks.every((x) => x.pass) ? 'pass' : 'fail', checks }
        if (c.stages.planning.gate.status !== 'pass') {
          await store.write(treeId, s)
          err('E_GATE_FAILED', `planning gate (六类覆盖): ${checks.filter((x) => !x.pass).map((x) => `${x.rule}: ${x.detail}`).join('; ')}`)
        }
        c.stage = 'decision'
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, stage: c.stage }
      })()
    },

    decision(args) {
      return (async () => {
        const [treeId, rulings, margins] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'decision')
        c.stages.decision = { rulings: rulings ?? [], margins: margins ?? [] }
        const checks = gateFor('decision', c)
        c.stages.decision.gate = { status: checks.every((x) => x.pass) ? 'pass' : 'fail', checks }
        if (c.stages.decision.gate.status !== 'pass') {
          await store.write(treeId, s)
          err('E_GATE_FAILED', `decision gate (APX+裕度): ${checks.filter((x) => !x.pass).map((x) => `${x.rule}: ${x.detail}`).join('; ')}`)
        }
        c.stage = 'implementation'
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, stage: c.stage }
      })()
    },

    implementation(args) {
      return (async () => {
        const [treeId, checklist] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'implementation')
        if (!Array.isArray(checklist) || checklist.length === 0) err('E_SCHEMA', 'checklist[] required {id,text,checked,evidence}')
        c.stages.implementation = { checklist }
        const checks = gateFor('implementation', c)
        c.stages.implementation.gate = { status: checks.every((x) => x.pass) ? 'pass' : 'fail', checks }
        if (c.stages.implementation.gate.status !== 'pass') {
          await store.write(treeId, s)
          err('E_GATE_FAILED', `implementation gate: ${checks.filter((x) => !x.pass).map((x) => `${x.rule}: ${x.detail}`).join('; ')}`)
        }
        c.stage = 'retro'
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, stage: c.stage }
      })()
    },

    retro(args) {
      return (async () => {
        const [treeId, results, residuals, triggerTable] = args
        const s = await load(treeId)
        const c = currentCycle(s)
        ensureStage(c, 'retro')
        c.stages.retro = { results: results ?? '', residuals: residuals ?? [], trigger_table: triggerTable ?? [] }
        const checks = gateFor('retro', c)
        if (!checks.every((x) => x.pass)) {
          c.stages.retro.gate = { status: 'fail', checks }
          await store.write(treeId, s)
          err('E_GATE_FAILED', `retro gate (总体检视): ${checks.filter((x) => !x.pass).map((x) => `${x.rule}: ${x.detail}`).join('; ')}`)
        }
        // M4 触发判定(只读聚合 tree-state)
        const treeState = await readTreeState(treeId)
        const agg = aggregate(treeState, c.opened_at)
        const triggers = evaluateTriggers(agg, c)
        const firing = triggers.filter((t) => t.fires)
        c.stages.retro.gate = { status: 'pass', checks }
        c.stages.retro.trigger_evaluation = triggers
        c.closed_at = nowIso()
        // 单轮全绿判定 = 六阶段门禁全过 + 无触发
        const allGreen = STAGES.every((st) => (c.stages[st].gate?.status ?? (st === 'retro' ? 'pass' : 'pass')) === 'pass') && firing.length === 0
        c.verdict = allGreen ? 'green' : 'recurse'
        s.stable.green_streak = allGreen ? s.stable.green_streak + 1 : 0
        if (!s.stable.declared && s.stable.green_streak >= stableRounds) {
          s.stable = { declared: true, since_round: c.round, green_streak: s.stable.green_streak, declared_at: nowIso() }
        }
        // 开下一轮(即使宣告稳定也开——「可撤销宣告」:新反馈到达即用)
        const nextRound = c.round + 1
        s.rounds.push({
          round: nextRound, opened_at: nowIso(), closed_at: null, stage: 'feedback',
          trigger_signals: firing.length ? firing.map((f) => ({ source: 'M4', note: f.note })) : [{ source: 'method', note: '递归:持续逼近动态相对稳定' }],
          stages: { feedback: { entries: [] }, analysis: {}, planning: {}, decision: {}, implementation: {}, retro: {} },
        })
        s.current_round = nextRound
        s.updated_at = nowIso()
        await store.write(treeId, s)
        return { round: c.round, verdict: c.verdict, triggers_firing: firing.map((f) => f.trigger), next_round: nextRound, stable: s.stable }
      })()
    },

    async status(args) {
      const [treeId] = args
      const s = await store.read(treeId)
      if (!s) return { exists: false }
      const c = currentCycle(s)
      return {
        exists: true, tree_id: treeId, objective: s.objective, current_round: s.current_round,
        stage: c.stage, stable: s.stable,
        rounds_summary: s.rounds.map((r) => ({ round: r.round, verdict: r.verdict ?? 'open', closed: !!r.closed_at })),
        // aggregate 仅在 feedback/retro 阶段(聚合以真实树状态为源);undefined 字段剔除——宿主通道拒收(E2E 缺陷 B)
        ...(c.stage === 'feedback' || c.stage === 'retro' ? { aggregate: aggregate(await readTreeState(treeId), c.opened_at) } : {}),
      }
    },

    async query(args) {
      // M2 反馈聚合查询(只读 tree-state,不写)
      const [treeId] = args
      const s = await store.read(treeId)
      if (!s) err('E_LOOP_NOT_FOUND', `no meta-loop for tree "${treeId}"`)
      const s2 = await store.read(treeId)
      const c2 = currentCycle(s2)
      return { tree_id: treeId, round: c2?.round, stage: c2?.stage, aggregate: aggregate(await readTreeState(treeId), c2?.opened_at) }
    },
  }

  /** 统一入口(对齐引擎 run() 契约:永不 throw)。 */
  async function call(action, args) {
    const handler = actions[action]
    if (!handler) return { ok: false, error: { code: 'E_UNKNOWN', message: `unknown action "${action}". Available: ${Object.keys(actions).join(', ')}` } }
    try { return { ok: true, ...(await handler(args ?? [])) } }
    catch (e) { return { ok: false, error: { code: e.code ?? 'E_INTERNAL', message: e.message ?? String(e) } } }
  }

  return { call, actions, STAGES, gateFor, evaluateTriggers, aggregate }
}
