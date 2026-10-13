/**
 * @local/dsh-meta-loop — host adapter v0.1
 * 单复合工具 meta_loop {init|feedback|analysis|planning|decision|implementation|retro|status|query}。
 * 状态:<DSH_PROFILE_DIR>/tree-engine-data/<tree_id>.meta-loop.json(tmp+rename 原子写;与引擎状态同目录不同文件,零写引擎状态)。
 * readTreeState 端口:只读聚合 tree-engine 的 tree-state.json(正源原则:不为同一信息建第二真源)。
 */
import { createMetaLoopCore } from './src/core.js'
import path from 'node:path'
import { promises as fsp } from 'node:fs'

export const name = 'meta-loop'

const dataDir = path.resolve(process.env.DSH_PROFILE_DIR ?? process.env.DSH_HOME ?? '.', 'tree-engine-data')

const store = {
  file: (treeId) => path.join(dataDir, `${treeId}.meta-loop.json`),
  async read(treeId) {
    try { return JSON.parse(await fsp.readFile(this.file(treeId), 'utf-8')) } catch { return null }
  },
  async write(treeId, state) {
    await fsp.mkdir(dataDir, { recursive: true })
    const f = this.file(treeId)
    const tmp = `${f}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(state, null, 1), 'utf-8')
    await fsp.rename(tmp, f)
  },
}

async function readTreeState(treeId) {
  try { return JSON.parse(await fsp.readFile(path.join(dataDir, treeId, 'tree-state.json'), 'utf-8')) } catch { return null }
}

const core = createMetaLoopCore({ store, readTreeState })

const ok = (text) => (args, value) => [{ type: 'text', text: typeof text === 'function' ? text(value) : text }]

const META_LOOP = {
  name: 'meta_loop',
  description:
    'Meta-system method loop (治理层): 反馈→分析(1115:一横相关系统/一纵稳定对象/一链断点/五问)→策划(六类:固本正源破链纠偏填坑通渠,自由文本)→决策(APX 裁决 adopt|hold|drop + 相位裕度 estimate ample|tight|negative|unknown)→实施(可勾验清单)→总体检视(结果/残余/M4 触发判定)→下一轮递归。' +
    'Loop state per tree; gates G1-G11 enforce order & completeness mechanically; direction/value judgments stay human (SKILL layer). Task execution belongs to tree-engine — this tool never creates leaves or dispatches.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['init', 'feedback', 'analysis', 'planning', 'decision', 'implementation', 'retro', 'status', 'query'] },
      tree_id: { type: 'string' },
      objective: { type: 'string' },
      triggers: { type: 'array', items: { type: 'object' }, description: 'init: 开轮触发记录(非空才开轮)' },
      entries: { type: 'array', items: { type: 'object' }, description: 'feedback: [{event, reaction, evidence*, source}] — 无证据不进分析(G1)' },
      artifact: { type: 'object', description: 'analysis: {systems[], stable_objects[{id,name}], breakpoints[{id,desc,open}], five_questions{q1..q5}}' },
      actions: { type: 'array', items: { type: 'object' }, description: 'planning: [{type(六类自由文本), target_breakpoint, point}] — 覆盖性 G4' },
      rulings: { type: 'array', items: { type: 'object' }, description: 'decision: [{candidate, verdict: adopt|hold|drop, condition?(hold 必填)}]' },
      margins: { type: 'array', items: { type: 'object' }, description: 'decision: [{object, signal_key, reading, estimate}] — 每稳定对象≥1 信号(G6)' },
      checklist: { type: 'array', items: { type: 'object' }, description: 'implementation: [{id, text, checked, evidence?(勾验必填)}]' },
      results: { type: 'string' }, residuals: { type: 'array', items: { type: 'object' } },
      trigger_table: { type: 'array', items: { type: 'object' }, description: 'retro: [{trigger, evaluated}] — ≥1 条被评估(G11);M4 自动判定另行落账' },
    },
    required: ['action', 'tree_id'],
  },
  output: {
    schema: { type: 'object' },
    render: ok((v) => {
      if (v?.exists === false) return 'meta_loop: (no loop for this tree)'
      const agg = v?.aggregate
      const aggText = agg ? ` · agg[leaves=${agg.leaves} ok=${agg.runtime_succeeded} fail=${(agg.runtime_failed ?? 0) + (agg.runtime_timeout ?? 0) + (agg.runtime_frozen ?? 0)} vfail=${agg.verify_fail} hi-drift=${agg.drift_high_severity} active=${Math.round((agg.active_ratio ?? 0) * 100)}%]` : ''
      const head = v?.round ? `round ${v.round}${v.stage ? ' → ' + v.stage : ''}${v.next_round ? ' ⇒ next ' + v.next_round : ''}` : `round ${v?.current_round ?? '?'} stage=${v?.stage ?? '?'} stable=${v?.stable?.declared ? 'declared(r' + v.stable.since_round + ')' : 'no(' + (v?.stable?.green_streak ?? 0) + ')'}`
      return `meta_loop: ${head}${v?.triggers_firing ? ' fires=[' + v.triggers_firing.join(',') + ']' : ''}${v?.verdict ? ' verdict=' + v.verdict : ''}${aggText}`
    }),
  },
  execute: async (args) => {
    const map = {
      init: (a) => [a.tree_id, a.objective, a.triggers],
      feedback: (a) => [a.tree_id, a.entries],
      analysis: (a) => [a.tree_id, a.artifact],
      planning: (a) => [a.tree_id, a.actions],
      decision: (a) => [a.tree_id, a.rulings, a.margins],
      implementation: (a) => [a.tree_id, a.checklist],
      retro: (a) => [a.tree_id, a.results, a.residuals, a.trigger_table],
      status: (a) => [a.tree_id],
      query: (a) => [a.tree_id],
    }
    const r = await core.call(args.action, map[args.action](args))
    if (!r.ok) { const e = new Error(`${r.error.code}: ${r.error.message}`); e.code = r.error.code; throw e }
    return r
  },
}

export function apply(ctx) {
  const diag = (m) => { try { console.error(`[meta-loop] ${m}`) } catch {} }
  try {
    ctx.inject(['tools'], (scoped) => {
      try {
        const services = scoped || ctx
        services.tools.register(META_LOOP)
        diag('registered 1/1 tools (meta_loop)')
        console.log(`[meta-loop] v0.1 registered meta_loop (state @ ${dataDir}/<tree>.meta-loop.json)`)
      } catch (e) { diag(`inject callback THREW: ${e?.stack ?? e}`) }
    })
  } catch (e) { diag(`ctx.inject THREW: ${e?.stack ?? e}`) }
}
