/**
 * @local/dsh-tree-engine — host adapter v0.2（S1 第二批）
 *
 * 装配：
 *   - 持久化 = fsStore（<DSH_PROFILE_DIR>/tree-engine-data/，原子写 tmp+rename）；
 *   - 编排端口尽力装配（subagents/sessionQuery/timer 形状待 S1 smoke 冻结；任何端口失败
 *     fail-closed 返回 E_PORTS_NOT_WIRED / E_PORTS_PROTOCOL，绝不静默降级）；
 *   - sweep 随插件启动：宿主 timer 服务可用 → 用它的 interval；不可用 → systemClock 的进程内
 *     60s interval 兜底（sweepMode 恒为 timer；tree_status {action:"harvest"} 仍可显式立即收割）。
 *
 * v0.2 边界（诚实声明）：
 *   - startContinuable / prompt / interrupt 的精确 spec 形状未 smoke（装载后用
 *     tree_dispatch 单节点实测修正——这正是 S1 smoke 清单第一项）；
 *   - usagePct 端口暂缺（tokenMeter 形状未定）→ 竹节依赖执行者自报（tree_report {context}），
 *     这正是源引擎的自报语义，宿主测量接入后自动生效（先到者生效）。
 */
import { createEngine } from './src/engine.js'
import { createVerifier } from './src/verify.js'
import { createAdversarial } from './src/adversarial.js'
import { fsStore } from './src/store.js'
import { systemClock } from './src/clock.js'
import { configFromEnv } from './src/config.js'
import { runDoctor } from './src/doctor.js'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { spawn } from 'node:child_process'

export const name = 'tree-engine'
// hmr 热更触发标记：generation probe

const HANDOFF_INSTRUCTION =
  '竹节交接指令：你的上下文已接近阈值。请立即输出结构化交接简报（K1 结论与进度 / K2 未决与阻塞（无则写"无"）/ ' +
  'K3 产物引用（文件路径或 tool:<name>@<seq>，逐行独立）/ K4 契约变更（无则写"无"）/ K5 继续执行指针），' +
  '然后停止工作等待收割。不要开始新的任务步骤。'

function makePorts(services, log, opts = {}) {
  /** 派发者捕获表（E2E 实证 startContinuable 的 request.parent 必须是活 Agent；
   *  首派从工具 exec.agent 捕获，竹节接力复用；进程内引用，不序列化）。 */
  const parents = new Map()   // `${treeId}/${leafId}` → { agent, sessionId }
  const ctxRef = opts.ctx ?? null   // tokenMeter 等经 ctx 直取（mixin 面）的兜底引用
  /** 简报宽限（handoff §7 任务 4）：promptHandoff 发出交棒指令后轮询 readSession 提取 K1–K5。
   *  上限 = min(graceMs, 12s)（sweep 逐树串行，过长阻塞同树其他调用）。 */
  const graceMs = Math.min(opts.graceMs ?? 12_000, 12_000)
  const pollMs = 2_000
  let usageShapeLogged = false

  /** 从 readSession 快照防御性提取含 K1 标记的简报文本（形状未冻结——尽力提取，失败降级）。 */
  function extractHandoffBrief(snap) {
    const texts = []
    const visit = (v, depth) => {
      if (!v || depth > 8 || texts.length > 20) return
      if (typeof v === 'string') { if (v.length > 20 && v.length < 20_000) texts.push(v); return }
      if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return }
      if (typeof v === 'object') {
        for (const k of ['text', 'content', 'message', 'messages', 'turns', 'blocks', 'output', 'entries', 'items']) {
          if (k in v) visit(v[k], depth + 1)
        }
      }
    }
    visit(snap, 0)
    for (const t of texts.reverse()) {   // 最近的在前
      const i = t.indexOf('K1')
      if (i >= 0 && /K2/.test(t) && /K5/.test(t)) return t.slice(Math.max(0, i - 200), i + 4_000).trim()
    }
    return null
  }

  return {
    /** 派发/接力新会话（≅ subagents.startContinuable）。权威形状（asar 源 + E2E 实证）：
     *  ContinuableStartSpec = { provider*, label*, childId?, request{ prompt: ContentBlock[], parent: Agent }, signal }
     *  → ContinuableStart = { childId, messageId }。parent 必须是 ctx.agents 中的活 Agent（非字符串 id）。 */
    async dispatch(spec) {
      const dodText = verifier ? verifier.dodPrompt(spec.policyId ?? spec.taskType ?? 'default') : `[DoD] ${JSON.stringify(spec.dod ?? {})}`
      const settleText = `\n\n[结算指令] 你是树节点 ${spec.treeId}/${spec.leafId} 的执行者。任务完成（含结论自述与关键产出）后，必须调用工具 tree_report {action:"event", tree_id:"${spec.treeId}", leaf_id:"${spec.leafId}", type:"done", meta:{summary:"<一句话结论>"}} 登记完成；失败/无法完成时同样回报 done 并在 summary 写明失败原因。除此之外不得操作树。`
      // [agspec-C3] 自描述块已移至引擎侧渲染(engine dispatchStart,随 taskPrompt 持久化+竹节接力保持)
      const promptText = (spec.handoffBrief != null
        ? `${spec.prompt ?? ''}\n\n${dodText}${settleText}\n\n[竹节第 ${spec.segmentIndex} 节 · 交接简报]\n${spec.handoffBrief ?? '（no-handoff-summary：前会话未产出简报，依任务书与 DoD 继续）'}`
        : `${spec.prompt ?? ''}\n\n${dodText}${settleText}`)
      const key = `${spec.treeId}/${spec.leafId}`
      let parentAgent = spec.parentAgent
      let parentSessionId = spec.parentSessionId
      if (!parentAgent) {
        const cached = parents.get(key)
        if (cached?.agent) ({ agent: parentAgent, sessionId: parentSessionId } = cached)
      }
      if (!parentAgent) {
        const err = new Error('no live parent Agent: dispatch must be invoked via tree_dispatch tool call (exec.agent); bamboo relay requires the dispatcher session still live')
        err.code = 'E_PORTS_PROTOCOL'
        throw err
      }
      parents.set(key, { agent: parentAgent, sessionId: parentSessionId })
      const agentOptions = (spec.assignee?.provider || spec.assignee?.model || spec.assignee?.effort)
        ? {
            ...(spec.assignee?.provider ? { provider: spec.assignee.provider } : {}),
            ...(spec.assignee?.model ? { model: spec.assignee.model } : {}),
            ...(spec.assignee?.effort ? { reasoningEffort: spec.assignee.effort } : {}),
          }
        : undefined
      try {
        const sessionId = await startChildSession(services, {
          provider: spec.assignee?.mechanism ?? DEFAULT_MECHANISM,
          label: `tree:${spec.treeId}/${spec.leafId}${spec.segmentIndex ? `#s${spec.segmentIndex}` : ''}`,
          parent: parentAgent,
          promptText,
          agentOptions,
        })
        return { sessionId }
      } catch (e) {
        const err = new Error(`ports.dispatch failed: ${e?.message ?? e}`)
        err.code = 'E_PORTS_PROTOCOL'
        throw err
      }
    },
    /** 中断旧会话（竹节先 interrupt 后 start 的 ①）。兼容 rc.2 authority 形状（见 startChildSession 注）。 */
    async interrupt(sessionId, parentSessionIdHint) {
      try {
        let parentSessionId = parentSessionIdHint
        if (!parentSessionId) {
          const records = await services.sessionQuery.filterSessions([{ kind: 'id', values: [sessionId] }])
          parentSessionId = records?.[0]?.header?.parentSession
        }
        if (!parentSessionId) throw new Error('cannot resolve parentSession for interrupt authority')
        interruptChildCompat(services, sessionId, parentSessionId)
      }
      catch (e) { log(`ports.interrupt failed for ${sessionId}: ${e?.message ?? e}`) }
    },
    /** 交棒指令（旧形 subagents.prompt / 现役 sendMessage 双形）+ K1–K5 简报宽限回收（任务 4）。 */
    async promptHandoff(sessionId) {
      try {
        const records = await services.sessionQuery.filterSessions([{ kind: 'id', values: [sessionId] }])
        const parent = records?.[0]?.header?.parentSession
        if (!parent) return null
        const content = [{ type: 'text', text: HANDOFF_INSTRUCTION }]
        let delivered = false
        if (typeof services.subagents?.sendMessage === 'function') {
          const liveParent = pickLiveAncestorAgent(services, parent)
          if (liveParent) {
            await services.subagents.sendMessage(liveParent, sessionId, content, { signal: new AbortController().signal })
            delivered = true
          }
        }
        if (!delivered) {
          await services.subagents.prompt({
            requestId: `tree-engine-handoff-${Date.now().toString(36)}`,
            parentSessionId: parent, childSessionId: sessionId, mode: 'continuable', delivery: 'queue',
            content,
          }, new AbortController().signal)
        }
        // 宽限轮询：旧会话在 grace 期内产出 K1–K5 简报 → 全文回收；超时/不可提取 → null 降级
        const deadline = Date.now() + graceMs
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, pollMs))
          try {
            const snap = await services.sessionQuery.readSession(sessionId)
            const brief = extractHandoffBrief(snap)
            if (brief) { log(`handoff brief recovered (${brief.length} chars) for ${String(sessionId).slice(0, 8)}`); return brief }
          } catch { /* 快照暂不可读：继续宽限 */ }
        }
        log(`handoff brief: grace ${graceMs}ms expired for ${String(sessionId).slice(0, 8)} → no-handoff-summary`)
        return null
      } catch (e) {
        log(`ports.promptHandoff failed for ${sessionId}: ${e?.message ?? e}`)
        return null
      }
    },
    /** 收割时刷新 lastOutputAt（readSession 尽力提取；失败保守旧值）。 */
    async lastOutputAt(sessionId) {
      try {
        const snap = await services.sessionQuery.readSession(sessionId)
        const t = snap?.header?.lastActivityAt ?? snap?.lastActivityAt ?? null
        return typeof t === 'number' ? t : (t ? Date.parse(t) : null)
      } catch { return null }
    },
    /** 宿主侧上下文测量（handoff §7 任务 5：tokenMeter.measure；形状防御性提取——
     *  返回字段首次调用经 log 冻结；任何失败返回 null → 自报信号生效（先到者生效语义））。 */
    async usagePct(sessionId) {
      try {
        const meter = services.tokenMeter ?? (typeof ctxRef?.get === 'function' ? ctxRef.get('tokenMeter') : null) ?? ctxRef?.tokenMeter ?? null
        if (!meter || typeof meter.measure !== 'function') return null
        const snap = await services.sessionQuery.readSession(sessionId)
        if (!snap) return null
        const m = await meter.measure(snap)
        if (!usageShapeLogged) { usageShapeLogged = true; log(`tokenMeter.measure shape: ${JSON.stringify(m).slice(0, 400)}`) }
        // 候选字段防御提取：pct / context.pct / pressure.pct / usage.pct（0-100 或 0-1 归一）
        const cands = [m?.pct, m?.contextPct, m?.context?.pct, m?.pressure?.pct, m?.usage?.pct]
        for (const c of cands) if (typeof c === 'number' && c >= 0) return c <= 1 ? Math.round(c * 100) : Math.min(100, Math.round(c))
        return null
      } catch (e) {
        if (!usageShapeLogged) { usageShapeLogged = true; log(`tokenMeter.measure unavailable: ${e?.message ?? e} → self-report only`) }
        return null
      }
    },
  }
}

const dataDir = path.join(process.env.DSH_PROFILE_DIR ?? process.env.DSH_HOME ?? '.', 'tree-engine-data')
/** 引擎实例：apply() 装配期创建（端口与时钟随服务可用性定形）；服务缺失时保持未装配。 */
let engine = null
/** 验证器：宿主端口 = node fs（工作区经 exec.cwd）+ child_process exec（超时硬杀）。 */
let verifier = null
/** 编排配置（apply 期由 TREE_ENGINE_CONFIG 填充；tree_doctor 报告 sweepMode/超时口径用）。 */
let orchestraCfg = {}
/** 当前 sweep 停止器（热更时清理上一代僵尸定时器——E2E#5）。 */
let currentStopSweep = null

/** 简易 glob（'*' 与双星展开为段匹配；够 artifact 判定，非全量 minimatch）。
 *  advtx E2E 修复：①双星支持零段匹配（cwd 顶层文件可命中「双星斜杠星.md」）②返回绝对路径
 *  （此前返回相对路径、readFile 按引擎进程 cwd 解析 → ctx.cwd≠进程 cwd 即 ENOENT）；Set 去重。 */
export async function hostGlob(pattern, cwd) {
  const segs = pattern.split('/')
  const out = new Set()
  const MAX_DEPTH = 16
  async function walk(absDir, prefix, depth) {
    if (depth >= segs.length || prefix.length > MAX_DEPTH) return
    const seg = segs[depth]
    const last = depth === segs.length - 1
    let entries
    try { entries = await fsp.readdir(absDir, { withFileTypes: true }) } catch { return }
    if (seg === '**') {
      // 零段匹配：'**' 不消费任何段，直接用下一段在当前目录匹配（顶层文件命中路径）
      await walk(absDir, prefix, depth + 1)
      if (last) {
        // '**' 为尾段（如 'docs/**'）：递归收集全部文件
        const collect = async (d) => {
          let es; try { es = await fsp.readdir(d, { withFileTypes: true }) } catch { return }
          for (const e of es) { if (e.name.startsWith('.')) continue; const c = path.join(d, e.name); if (e.isDirectory()) await collect(c); else out.add(c) }
        }
        await collect(absDir)
      }
      for (const e of entries) {
        const child = path.join(absDir, e.name)
        if (e.isDirectory()) await walk(child, [...prefix, e.name], depth)      // ** 继续深入
      }
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && seg !== '.**') continue
      const child = path.join(absDir, e.name)
      if (seg.includes('*')) {
        const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')
        if (!re.test(e.name)) continue
        if (last) { if (e.isFile()) out.add(child) }
        else if (e.isDirectory()) await walk(child, [...prefix, e.name], depth + 1)
      } else if (e.name === seg) {
        if (last) { if (e.isFile()) out.add(child) }
        else if (e.isDirectory()) await walk(child, [...prefix, e.name], depth + 1)
      }
    }
  }
  await walk(path.resolve(cwd), [], 0)
  return [...out].sort()
}

function hostExec(cmd, { cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(cmd, { shell: true, cwd })
    } catch (e) { resolve({ code: -1, stdout: '', stderr: String(e?.message ?? e) }); return }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, timeoutMs)
    child.stdout?.on('data', (d) => { if (stdout.length < 100_000) stdout += d })
    child.stderr?.on('data', (d) => { if (stderr.length < 100_000) stderr += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e?.message ?? e) }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) resolve({ code: 124, stdout, stderr: `TIMEOUT: command exceeded ${timeoutMs}ms (=verdict fail)` })
      else resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** caller 会话 id 权威提取（asar 源 dsh-tools 实证：exec.agent.session 为 Session 对象）。 */
function callerOf(exec) {
  const s = exec?.agent?.session
  return s?.id ?? s?.header?.sessionId ?? s?.header?.id ?? undefined
}

/** 派发缺省机制（E2E 实证：ContinuableStartSpec.provider 是会话生成机制名 spawn|fork，非 LLM 供应商；
 *  模型路由在 request.agentOptions {provider, model, reasoningEffort}）。 */
const DEFAULT_MECHANISM = process.env.TREE_ENGINE_MECHANISM ?? 'spawn'

/** 宿主 subagents 服务兼容层（2026-10-17 DSH 0.2.1-rc.2 升级后实测）：
 *  - legacy 基线（引擎 v0.4.0 编写期）：startContinuable(spec) / interrupt(id,{kind:'parent',parentSessionId}) / prompt(req)
 *  - 现役 rc.2：startActivation({provider,label,request,signal,delivery}) / interrupt(id,{kind:'ancestor'|'user',...}) / sendMessage(parentAgent,childId,content,{signal})
 *  双形探测：legacy 优先（不改变旧宿主行为），缺席时走现役；两形都缺 → fail-closed 报协议错。
 *  缺陷出处：树仓 handoff §7 任务 4「startContinuable/prompt/interrupt 精确形状待 smoke」——
 *  本次 nanju live E2E 首次真机派发即暴露（rc.2 已删除 startContinuable）。 */
function resolveAgentsService(services) {
  try {
    if (services && typeof services.agents?.get === 'function') return services.agents
    const viaCtx = typeof servicesRef?.get === 'function' ? servicesRef.get('agents') : undefined
    return viaCtx && typeof viaCtx.get === 'function' ? viaCtx : undefined
  } catch { return undefined }
}

function pickLiveAncestorAgent(services, parentSessionId) {
  try {
    const agents = resolveAgentsService(services)
    return agents?.get?.(parentSessionId)
  } catch { return undefined }
}

async function startChildSession(services, { provider, label, parent, promptText, agentOptions }) {
  const request = {
    prompt: [{ type: 'text', text: promptText }],
    parent,
    ...(agentOptions ? { agentOptions } : {}),
  }
  const signal = new AbortController().signal
  if (typeof services.subagents?.startContinuable === 'function') {
    const r = await services.subagents.startContinuable({ provider, label, signal, request })
    const sessionId = r?.childId ?? r?.sessionId ?? r?.session?.id
    if (!sessionId) throw new Error(`unrecognized startContinuable result: ${JSON.stringify(r).slice(0, 200)}`)
    return sessionId
  }
  if (typeof services.subagents?.startActivation === 'function') {
    const r = await services.subagents.startActivation({ provider, label, request, signal, delivery: 'parent' })
    const sessionId = r?.childId ?? r?.sessionId
    if (!sessionId) throw new Error(`unrecognized startActivation result: ${JSON.stringify(r).slice(0, 200)}`)
    return sessionId
  }
  throw new Error('host subagents service exposes neither startContinuable nor startActivation')
}

/** 中断会话：按现役 authority 形状逐候选尝试（ancestor 活 Agent → user 父地址 → legacy parent 形状）。 */
function interruptChildCompat(services, sessionId, parentSessionId) {
  if (typeof services.subagents?.interrupt !== 'function') return
  const authorities = []
  const liveAncestor = parentSessionId ? pickLiveAncestorAgent(services, parentSessionId) : undefined
  if (liveAncestor) authorities.push({ kind: 'ancestor', agent: liveAncestor })
  if (parentSessionId) {
    authorities.push({ kind: 'user', parentSessionId })
    authorities.push({ kind: 'parent', parentSessionId })
  }
  let lastError = null
  for (const authority of authorities) {
    try {
      services.subagents.interrupt(sessionId, authority)
      return
    } catch (e) { lastError = e }
  }
  if (lastError) throw lastError
}

/** 攻击审计缺省路由（异族 + 最强档：随感 #33/#30——检验者不得用次级模型、不得与执行者同源；
 *  环境覆盖 TREE_ENGINE_JUDGE_ASSIGNEE='{"provider":...,"model":...}'）。 */
function judgeAssignee() {
  const fallback = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
  const raw = process.env.TREE_ENGINE_JUDGE_ASSIGNEE
  if (!raw) return fallback
  try { const a = JSON.parse(raw); return (a && typeof a === 'object' && a.provider && a.model) ? a : fallback }
  catch { return fallback }
}

/** 攻击超时钳制（30s–600s，缺省 300s——E2E 实证真实异族 judge 需 2-4 分钟）。 */
function clampAttackTimeout(ms) {
  if (!Number.isFinite(ms)) return 300_000
  return Math.max(30_000, Math.min(600_000, Math.round(ms)))
}

/** tree_verify 执行时的 exec 快照（攻击会话派发需要活 parent Agent——同 dispatch 捕获模式）。 */
let verifyExec = null
/** apply 期捕获：宿主服务表与自诊断日志（tree_verify adversarial 攻击/修复端口用）。 */
let servicesRef = null
let diagRef = (m) => { try { console.error(`[tree-engine] ${m}`) } catch {} }

/** 从攻击会话 readSession 快照防御性提取 `ATTACK_VERDICT: {...}` JSON 行。 */
function extractAttackVerdict(snap) {
  const texts = []
  const visit = (v, depth) => {
    if (!v || depth > 8 || texts.length > 30) return
    if (typeof v === 'string') { if (v.length > 10 && v.length < 60_000) texts.push(v); return }
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return }
    if (typeof v === 'object') for (const k of ['text', 'content', 'message', 'messages', 'turns', 'blocks', 'output', 'entries', 'items']) if (k in v) visit(v[k], depth + 1)
  }
  visit(snap, 0)
  for (const t of texts.reverse()) {
    const i = t.indexOf('ATTACK_VERDICT:')
    if (i >= 0) {
      try { return JSON.parse(t.slice(i + 'ATTACK_VERDICT:'.length).split('\n')[0].trim()) } catch { /* 非 JSON 行继续找 */ }
    }
  }
  return null
}

/** 派发异族攻击评审会话并回收裁决。
 *  回收双通道（advtx 复跑实证 readSession 轮询与 judge 完成时序不稳——裁决常在超时后/形状不达）：
 *  ①文件握手（主）：judge 被要求把裁决 JSON 写到 verdictPath，引擎轮询该文件（确定性）；
 *  ②readSession 提取（辅）：ATTACK_VERDICT 行兜底。超时 fail-closed（缺省 300s）。 */
async function runAttackSession(services, log, { treeId, leafId, round, rubric, target, timeoutMs = 300_000 }) {
  const parentAgent = verifyExec?.agent
  if (!parentAgent) throw new Error('no live parent Agent for attack session (tree_verify must be called via tool exec)')
  const assignee = judgeAssignee()
  // 握手路径强制绝对化（advtx 三跑实证：dataDir 可能是相对路径——引擎与 judge 各按自己 cwd 解析，
  // 引擎轮询 profile 侧 / judge 写工作区侧，永远握不上手）
  const verdictDir = path.resolve(dataDir, 'attack')
  const verdictPath = path.join(verdictDir, `${treeId}_${leafId}_r${round}.json`)
  try { await fsp.mkdir(verdictDir, { recursive: true }); await fsp.rm(verdictPath, { force: true }) } catch { /* 尽力而为 */ }
  const prompt = [
    `你是树 ${treeId}/${leafId} 第 ${round} 轮的攻击审计员（红队）。以下是验收标准与攻击目标。`,
    `验收标准：\n${rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    `攻击目标（${target.kind}）：\n${String(target.text).slice(0, 12_000)}`,
    '',
    '尽力推翻它：事实错误、夸大、逻辑漏洞、未兑现承诺、遗漏。裁决必须只基于目标文本与你的知识，不得臆造目标中不存在的内容。',
    '完成后必须做两件事：',
    `①把裁决 JSON 原样写入文件 ${verdictPath}（内容恰为 {"pass":true|false,"findings":["问题1","问题2"]}，用写文件工具或 pwsh 均可）`,
    '②在回答末尾输出同一行：ATTACK_VERDICT: {"pass":...,"findings":[...]}',
    'pass=true 仅当找不到任何实质问题；找到任一实质问题即 pass=false 并逐条列出 findings。写完文件即可结束，不要等待。',
  ].join('\n')
  const judgeId = await startChildSession(services, {
    provider: DEFAULT_MECHANISM,
    label: `tree-attack:${treeId}/${leafId}#r${round}`,
    parent: parentAgent,
    promptText: prompt,
    agentOptions: assignee,
  })
  const normalize = (v) => (v && typeof v.pass === 'boolean')
    ? { pass: v.pass, findings: Array.isArray(v.findings) ? v.findings.map(String) : [], detail: `judge=${assignee.provider}/${assignee.model} round=${round}` }
    : null
  const tryOnce = async () => {
    // ① 文件握手（主通道）
    try {
      const raw = await fsp.readFile(verdictPath, 'utf-8')
      const v = normalize(JSON.parse(raw))
      if (v) return v
    } catch { /* 文件未就绪：走辅通道 */ }
    // ② readSession 提取（辅通道）
    try {
      const v = normalize(extractAttackVerdict(await services.sessionQuery.readSession(judgeId)))
      if (v) return v
    } catch { /* 快照暂不可读 */ }
    return null
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 5_000))
    const v = await tryOnce()
    if (v) { try { interruptChildCompat(services, judgeId, verifyExec?.agent?.session?.id) } catch { /* 尽力而为 */ } return v }
  }
  await new Promise((res) => setTimeout(res, 8_000))
  const final = await tryOnce()
  if (final) return final
  return { pass: false, findings: [], detail: `attack session timeout > ${timeoutMs}ms (fail-closed), judge=${assignee.provider}/${assignee.model}` }
}

function toError(r) {
  const err = new Error(`${r.error.code}: ${r.error.message}`)
  err.code = r.error.code
  return err
}

const ok = (text) => (args, value) => [{ type: 'text', text: typeof text === 'function' ? text(value) : text }]

const TREE_PLAN = {
  name: 'tree_plan',
  description:
    'Create and configure a task tree (plan → layered dispatch → bamboo relay → verify). ' +
    'tree_id: 4-8 chars, lowercase letters/digits/underscore, no hyphen. Root leaf "<tree_id>-root" is created automatically. ' +
    'Only a top-level session that OWNS no tree yet should call create: a dispatched commander already carries a tree_id and must ' +
    'add its nodes with tree_node instead of creating a second tree (a duplicate tree_id is rejected with E_DUPLICATE_LEAF).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['create'] },
      tree_id: { type: 'string' },
      root_brief: { type: 'object', description: 'Root brief (goal, context, constraints).' },
      root_dod: { type: 'object', description: 'Root definition-of-done.' },
      session_id: { type: 'string', description: 'Root owner session id (strict UUID v4), optional.' },
    },
    required: ['action', 'tree_id', 'root_brief', 'root_dod'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_plan: created tree ${v?.tree?.tree_id ?? '?'} (root ${v?.tree?.root_leaf_id ?? '?'})`) },
  execute: async (args) => {
    const r = await engine.call('init', [args.tree_id, args.root_brief, args.root_dod, args.session_id])
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_NODE = {
  name: 'tree_node',
  description:
    'Node CRUD. add: {leaf_id, session_id, parent, path, role(commander|worker|auditor), added_by, dependencies?[], taskType?}; naming <prefix>-<Role><seq>-<name> (path segment must start uppercase). ' +
    'dependencies must be existing leaf_ids (cycle-checked; dispatch requires all deps done). taskType routes verification policy (research|question|doc|code-change|default). ' +
    'set-status: the closed state machine requires a done event first; the milestone commands are not exposed as tool actions, so set-status done is not reachable from the tool surface — ' +
    'settlement is the done event flowing runtime.state to succeeded plus tree_verify result (two gates, no third structure check).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['add', 'get', 'list', 'list-all', 'set-status', 'set-session'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      leaf: { type: 'object' }, status: { type: 'string' }, session_id: { type: 'string' },
    },
    required: ['action', 'tree_id'],
  },
  output: {
    schema: { type: 'object' },
    render: ok((v) => {
      const l = v?.leaf
      if (!l) return `tree_node: ${v?.leaves?.length ?? '?'} leaves`
      const rt = l.runtime
      const rtText = rt ? ` · runtime[state=${rt.state} attempt=${rt.attempt} chain=${(rt.segmentChain ?? []).length} sess=${String(rt.subagentSessionId ?? '').slice(0, 8)}]` : ' · (未派发)'
      const ms = (l.milestones ?? []).length ? ` · ms[${l.milestones.map((m) => `${m.id}:${m.audit_pass ? 'pass' : '...'}`).join(',')}]` : ''
      return `tree_node: ${l.leaf_id} status=${l.status}${rtText}${ms} ctx=${l.context_usage_pct ?? 0}%`
    }),
  },
  execute: async (args, exec) => {
    const map = {
      add: { cmd: 'leaf:add', argv: (a) => [a.tree_id, a.leaf], caller: true },
      get: { cmd: 'leaf:get', argv: (a) => [a.tree_id, a.leaf_id], caller: false },
      list: { cmd: 'leaf:list-active', argv: (a) => [a.tree_id], caller: false },
      'list-all': { cmd: 'leaf:list-all', argv: (a) => [a.tree_id], caller: false },
      'set-status': { cmd: 'leaf:set-status', argv: (a) => [a.tree_id, a.leaf_id, a.status], caller: true },
      'set-session': { cmd: 'leaf:set-session', argv: (a) => [a.tree_id, a.leaf_id, a.session_id], caller: true },
    }
    const m = map[args.action]
    if (!m) throw new Error(`tree_node: unknown action "${args.action}"`)
    const r = await engine.call(m.cmd, m.argv(args), m.caller ? callerOf(exec) : undefined)
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_DISPATCH = {
  name: 'tree_dispatch',
  description:
    'Dispatch / cancel a node execution (engine relays to continuable subagents). start: {prompt?, assignee?{provider?,model?,effort?}, dod?} — ' +
    'assignee is persisted on the leaf and survives bamboo relays; a <session-config-declared> self-descriptor block is appended to the dispatch prompt. ' +
    'dod is accepted for compatibility but does NOT reach the child prompt: the acceptance text comes from the leaf taskType policy ' +
    '(leaf.dod is only used by the verifier fallback). assignee.preset is accepted by the schema but is not applied to the child session (known limitation). ' +
    'node stays pending→running; bamboo-joint auto-relay runs inside running (context threshold 42%: brief → interrupt old → start successor; ' +
    'v0.5.0 rebinds leaf.session_id to the successor so it can report done). cancel: first-wins vs timeout hard deadline.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['start', 'cancel'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      prompt: { type: 'string' },
      assignee: { type: 'object', description: '{provider?, model?, effort?} (preset is schema-accepted but not applied)' },
      dod: { type: 'object', description: 'Accepted for compatibility; the child prompt DoD comes from the leaf taskType policy.' },
    },
    required: ['action', 'tree_id', 'leaf_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_dispatch: ${v?.node?.leaf_id ?? '?'} → ${v?.node?.state ?? '?'}`) },
  execute: async (args, exec) => {
    const cmd = args.action === 'start' ? 'dispatch:start' : 'dispatch:cancel'
    const argv = args.action === 'start'
      ? [args.tree_id, args.leaf_id, { prompt: args.prompt, assignee: args.assignee, dod: args.dod, parentAgent: exec?.agent, parentSessionId: callerOf(exec) }]
      : [args.tree_id, args.leaf_id]
    const r = await engine.call(cmd, argv, callerOf(exec))
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_REPORT = {
  name: 'tree_report',
  description:
    'Executor upward reporting. context: report context_usage_pct 0-100 (auto-triggers bamboo-joint relay at 42%; host-side tokenMeter measurement is also wired — ' +
    'whichever signal arrives first wins). event: append brief_echo/plan/progress/blocked/done/... (12-type closed set; done requires the leaf owner as caller).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['context', 'event'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      pct: { type: 'number' }, type: { type: 'string' }, meta: { type: 'object' },
    },
    required: ['action', 'tree_id', 'leaf_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_report: ok (${v?.leaf?.leaf_id ?? '?'})`) },
  execute: async (args, exec) => {
    const r = args.action === 'context'
      ? await engine.call('leaf:set-context', [args.tree_id, args.leaf_id, args.pct], callerOf(exec))
      : await engine.call('event:append', [args.tree_id, args.leaf_id, args.type, args.meta], callerOf(exec))
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_STATUS = {
  name: 'tree_status',
  description: 'Query: overview (dump), validate (invariants), sessions (budget precheck), harvest (immediate sweep; the engine also sweeps periodically on its timer, or on an in-process interval when no timer service is available).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['overview', 'validate', 'sessions', 'harvest'] },
      tree_id: { type: 'string' },
    },
    required: ['action', 'tree_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => v?.swept ? `tree_status: harvest ${v.swept.map((s) => `${s.tree_id}:${(s.events ?? []).map((e) => e.event + (e.relay ? `(${e.relay})` : '')).join(',') || '∅'}`).join(' | ')} (sweepMode=${v.sweepMode})` : v?.issues ? `tree_status: validate ${v.ok ? 'PASS' : 'FAIL'} (${v.issues.length} issues)` : `tree_status: ok (sweepMode=${v?.sweepMode ?? '?'})`) },
  execute: async (args) => {
    if (args.action === 'harvest') {
      const r = await engine.sweepTick()
      return { ...r, sweepMode: engine.sweepModeOf() }
    }
    const cmd = { overview: 'treeDump', validate: 'validate', sessions: 'sessionCount' }[args.action]
    const r = await engine.call(cmd, [args.tree_id])
    if (!r.ok) throw toError(r)
    return { ...r, sweepMode: engine.sweepModeOf() }
  },
}

const TREE_VERIFY = {
  name: 'tree_verify',
  description:
    'Run verification policies on a node (modes: self-report | artifact | command | llm-judge | composite | human). Policy resolution: explicit policyId → leaf.taskType map → default. ' +
    'cwd defaults to the caller exec cwd (or the explicit cwd parameter); it is not derived from leaf.path. Verdicts are recorded to leaf.verification, ' +
    'but FAIL is returned as result.pass=false — it does not throw and does not block runtime.succeeded, so the commander must read result.pass before accepting the node. ' +
    'adversarial: attack-defense-audit iteration (≤max_rounds, default 3) — structural checks + cross-family judge attack; FAIL rounds feed findings back to the executor for repair.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['run', 'dod', 'adversarial'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      policy_id: { type: 'string', description: 'Explicit policy override; omit to resolve via taskType/default.' },
      cwd: { type: 'string', description: 'Workspace root for artifact/command checks; defaults to exec cwd.' },
      max_rounds: { type: 'number', description: 'Adversarial iteration cap (1-5, default 3).' },
      attack_timeout_ms: { type: 'number', description: 'Per-round judge session timeout ms (30_000-600_000, default 300_000).' },
    },
    required: ['action', 'tree_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_verify: ${v?.result?.pass ? 'PASS' : 'FAIL'} (${(v?.result?.verdicts ?? []).map((x) => x.mode).join(',')}${v?.result?.rounds ? ` × ${v.result.rounds.length} 轮` : ''})`) },
  execute: async (args, exec) => {
    verifyExec = exec   // 攻击会话派发的 parent Agent 捕获（同 dispatch 模式）
    // P1-05 写权矩阵：verification 落账仅 creator/root、非 done event 仅 owner/creator——
    // 两处落账都必须带上真实写入者，否则 fail-closed 报 E_BORROWED_IDENTITY。
    const verifyCaller = callerOf(exec)
    // 策略路由（§5.2）：显式 policyId > leaf.taskType（经 taskTypeMap 映射）> default
    let policyId = args.policy_id
    let leaf = null
    if (!policyId && args.leaf_id) {
      const lr = await engine.call('leaf:get', [args.tree_id, args.leaf_id])
      if (lr.ok) leaf = lr.leaf
      policyId = leaf?.taskType ?? 'default'
    }
    if (args.action === 'dod') {
      const text = verifier.dodPrompt(policyId ?? 'default')
      return { dod: text, ...(policyId ? { resolved_policy_id: policyId } : {}) }
    }
    policyId = policyId ?? 'default'
    const cwd = args.cwd ?? exec?.cwd ?? process.cwd()

    if (args.action === 'adversarial') {
      if (!args.leaf_id) throw new Error('tree_verify adversarial requires leaf_id')
      if (!leaf) { const lr = await engine.call('leaf:get', [args.tree_id, args.leaf_id]); if (!lr.ok) throw toError(lr); leaf = lr.leaf }
        const adv = createAdversarial({
        verifier,
        attack: (o) => runAttackSession(servicesRef, diagRef, { treeId: args.tree_id, leafId: args.leaf_id, timeoutMs: clampAttackTimeout(args.attack_timeout_ms), ...o }),
        fix: async ({ round, findings }) => {
          const findingsText = findings.map((f) => `- ${f}`).join('\n')
          // 路径①:交棒通道回注原执行者(父会话仍活时;同竹节 prompt 模式)
          try {
            const rt = leaf.runtime
            if (rt?.subagentSessionId && rt?.parentSessionId) {
              await servicesRef.subagents.prompt({
                requestId: `tree-attack-fix-${Date.now().toString(36)}`,
                parentSessionId: rt.parentSessionId, childSessionId: rt.subagentSessionId, mode: 'continuable', delivery: 'queue',
                content: [{ type: 'text', text: `第 ${round} 轮攻击审计未通过。审计发现：\n${findingsText}\n\n请立即修复你此前产出的产物（只改产物文件/结论本身），不要重新登记 done。修完输出一行：FIX_DONE <一句话>` }],
              })
              return true
            }
          } catch { /* 原会话通道不可用 → 路径② */ }
          // 路径②(advtx 四跑实证需要):同叶重派修复任务(新会话),轮询至 succeeded(≤240s)再进下一轮
          const r = await engine.call('dispatch:start', [args.tree_id, args.leaf_id, {
            prompt: `第 ${round} 轮异族攻击审计未通过,你是一次性修复执行者。审计发现：\n${findingsText}\n\n请立即修复本节点此前的产物文件(只按 findings 修正,不要重写无关内容),修完按结算指令 tree_report 登记 done 事件(summary 写修复要点)。`,
            parentAgent: exec?.agent, parentSessionId: callerOf(exec),
          }], callerOf(exec))
          if (!r.ok) return false
          const deadline = Date.now() + 240_000
          while (Date.now() < deadline) {
            await new Promise((res) => setTimeout(res, 10_000))
            const g = await engine.call('leaf:get', [args.tree_id, args.leaf_id])
            if (g.ok && g.leaf.runtime?.state === 'succeeded') return true
          }
          return false
        },
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        record: (result) => engine.call('leaf:set-verification', [args.tree_id, args.leaf_id, result], verifyCaller).then((r) => { if (!r.ok) throw toError(r) }),
        maxRounds: args.max_rounds,
      })
      // 攻击目标：结构检查的 artifact 全文优先；否则 leaf 的 done/progress 事件证据
      const target = async (round, structural) => {
        const artifactPath = structural.verdicts.map((v) => v.artifact).filter(Boolean)[0]
        if (artifactPath) {
          try { return { kind: `artifact ${artifactPath}`, text: await fsp.readFile(path.resolve(cwd, artifactPath), 'utf-8') } } catch { /* 读失败回落 */ }
        }
        const ev = leaf.events ?? []
        return { kind: 'leaf events', text: JSON.stringify(ev.slice(-8).map((e) => ({ type: e.type, meta: e.meta }))) }
      }
      const result = await adv.run({ treeId: args.tree_id, leafId: args.leaf_id, policyId, cwd, target, fixWaitMs: 60_000 })
      const e = await engine.call('event:append', [args.tree_id, args.leaf_id, 'progress', { verification: { policy_id: result.policyId, pass: result.pass, rounds: result.rounds.length } }], verifyCaller)
      if (!e.ok) throw toError(e)
      return { result }
    }

    const result = await verifier.runVerifications(policyId, { cwd })
    // 落账：leaf.verification（裁决判据持久化）+ progress 事件（观测层）；PASS 才可 set-status done 的闸由调用方遵守
    if (args.leaf_id) {
      const r = await engine.call('leaf:set-verification', [args.tree_id, args.leaf_id, result], verifyCaller)
      if (!r.ok) throw toError(r)
      const e = await engine.call('event:append', [args.tree_id, args.leaf_id, 'progress', { verification: { policy_id: result.policyId, pass: result.pass } }], verifyCaller)
      if (!e.ok) throw toError(e)
    }
    return { result }
  },
}

const TREE_LOG = {
  name: 'tree_log',
  description: 'Query node logs: events (by leaf/type), drift history (by leaf/since), heartbeat tail, communication log.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['events', 'drift', 'heartbeat', 'communication'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      type: { type: 'string' }, since: { type: 'string' }, n: { type: 'number' }, target: { type: 'string' },
    },
    required: ['action', 'tree_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_log: ${v?.events?.length ?? v?.drifts?.length ?? v?.heartbeats?.length ?? v?.communications?.length ?? 0} entries`) },
  execute: async (args) => {
    const map = {
      events: { cmd: 'event:list', argv: (a) => [a.tree_id, a.leaf_id, a.type] },
      drift: { cmd: 'drift:list', argv: (a) => [a.tree_id, a.leaf_id, a.since] },
      heartbeat: { cmd: 'heartbeat:tail', argv: (a) => [a.tree_id, a.n] },
      communication: { cmd: 'communication:list', argv: (a) => [a.tree_id, a.leaf_id, a.target, a.since] },
    }
    const m = map[args.action]
    const r = await engine.call(m.cmd, m.argv(args))
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_MAINTAIN = {
  name: 'tree_maintain',
  description:
    'Maintenance: backup (in-state snapshot, keep 10) / restore (tree_id match + before-restore snapshot) / nudge-reset / register-session (bypass session into budget, idempotent).',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['backup', 'restore', 'nudge-reset', 'register-session'] },
      tree_id: { type: 'string' }, leaf_id: { type: 'string' },
      label: { type: 'string' }, backup_file: { type: 'string' },
      session_id: { type: 'string' }, source: { type: 'string' },
    },
    required: ['action', 'tree_id'],
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_maintain: ok (${v?.backup ?? v?.restored_from ?? v?.registered ?? v?.leaf?.leaf_id ?? '?'})`) },
  execute: async (args) => {
    const map = {
      backup: { cmd: 'backup', argv: (a) => [a.tree_id, a.label] },
      restore: { cmd: 'restore', argv: (a) => [a.tree_id, a.backup_file] },
      'nudge-reset': { cmd: 'nudge:reset', argv: (a) => [a.tree_id, a.leaf_id] },
      'register-session': { cmd: 'tree:register-session', argv: (a) => [a.tree_id, a.session_id, a.source] },
    }
    const m = map[args.action]
    const r = await engine.call(m.cmd, m.argv(args))
    if (!r.ok) throw toError(r)
    return r
  },
}

const TREE_DOCTOR = {
  name: 'tree_doctor',
  description:
    'Read-only self-diagnosis for "tools/Skills did not show up" symptoms (not installed, not reloaded, stale session, missing skill provider, version drift, corrupt tree data). ' +
    'action "run" (default) runs 7 checks: package (package.json name/version vs the README version section), tool-count (9 = 8 existing + tree_doctor, verified against the TOOLS export), ' +
    'skills (bundled skills/*/SKILL.md frontmatter name + cordis.patch.yml mounts @deepseek-ai/dsh-skill-filesystem with providerName=tree-engine), ' +
    'tree-data (state root readability, tree/node counts, and — when tree_id is given — tree_id format/existence/engine validate invariants), ' +
    'stale (when tree_id is given: running nodes past nodeTimeoutMs + segment_pending counts), sweep (sweepMode + immediate-harvest hint), ' +
    'env (bundled test node path / DSH version probes; unprobeable → WARN, never FAIL). ' +
    'Zero write side effects. FAIL never throws: read checks[]/summary/hint (doctor diagnoses, it does not gate). Only an unknown action throws.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['run'], description: 'Only "run" (default): a read-only diagnosis round.' },
      tree_id: { type: 'string', description: 'Optional: validate this tree (format/existence/invariants) and count stale running nodes.' },
    },
  },
  output: { schema: { type: 'object' }, render: ok((v) => `tree_doctor: ${v?.checks?.length ?? 0} checks · pass=${v?.summary?.pass ?? 0} warn=${v?.summary?.warn ?? 0} fail=${v?.summary?.fail ?? 0} · version=${v?.version ?? '?'}`) },
  execute: async (args) => runDoctor({
    action: args.action ?? 'run',                 // 非法 action 由 runDoctor fail-closed 抛错
    treeId: args.tree_id,
    toolNames: TOOLS.map((t) => t.name),          // 与实际注册表同源，不复制期望清单
    engine,                                        // 只读面：table.validate / table.treeDump
    store: fsStore(dataDir),                       // 只读 list/read；doctor 不写任何文件
    stateRoot: path.resolve(dataDir),
    sweepMode: engine ? engine.sweepModeOf() : null,
    sweepIntervalMs: orchestraCfg.sweepIntervalMs,
    nodeTimeoutMs: orchestraCfg.nodeTimeoutMs,
  }),
}

/** 注册表（apply 逐项注册；tree_doctor 自身用它核对「注册工具数 = 9」，避免清单两处维护）。 */
export const TOOLS = Object.freeze([TREE_PLAN, TREE_NODE, TREE_DISPATCH, TREE_REPORT, TREE_STATUS, TREE_VERIFY, TREE_LOG, TREE_MAINTAIN, TREE_DOCTOR])

export function apply(ctx) {
  /** 文件自诊断（Loader 缓存下唯一可靠观测通道）：apply 全程留痕 + 全程容错。 */
  const diagPath = path.join(dataDir, 'apply.log')
  const diag = (msg) => { try { fsp.mkdir(path.dirname(diagPath), { recursive: true }).then(() => fsp.appendFile(diagPath, `${new Date().toISOString()} ${msg}\n`)).catch(() => {}) } catch {} }
  diag(`apply() entered (v0.6.0); PROFILE_DIR=${process.env.DSH_PROFILE_DIR ?? '?'}`)
  try {
    ctx.inject(['tools', 'subagents', 'sessionQuery'], (scoped) => {
      try {
        const services = scoped || ctx
        const log = (m) => { console.error(`[tree-engine] ${m}`); diag(m) }
        servicesRef = services   // tree_verify adversarial 攻击/修复端口捕获
        diagRef = diag
        diag('inject callback entered')

        // 时钟：timer 权威结论（asar 源 cordis-plugin-timer 实证）——ctx.mixin("timer")，ctx.timer 直接可用；
        // 兜底 ctx.get('timer')；服务都不可用时 systemClock() 仍提供进程内 60s 间隔兜底（sweepMode 仍为 timer，审计 B3）
        let timer = null
        try { timer = ctx.timer ?? (typeof ctx.get === 'function' ? ctx.get('timer') : null) } catch (e) { diag(`timer resolve failed: ${e?.message ?? e}`) }
        const clock = systemClock()
        if (timer && typeof timer.interval === 'function') {
          clock.scheduleInterval = (cb, ms) => timer.interval(cb, ms)
        } else {
          log('sweep: no host timer service — using the in-process interval fallback (sweepMode=timer); tree_status {action:"harvest"} still triggers an immediate sweep')
        }

        // Config 装载期校验（§7 任务 8）：TREE_ENGINE_CONFIG JSON → 全键类型/约束校验，
        // 非法即装载失败（apply 终止、工具不注册），报错含键名——不静默回退
        let envConfig = { config: {}, orchestra: {} }
        try { envConfig = configFromEnv() }
        catch (e) {
          diag(`config validation FAILED (load aborted): ${e.message}`)
          console.error(`[tree-engine] config validation failed, plugin NOT loaded: ${e.message}`)
          return
        }
        if (Object.keys(envConfig.config).length || Object.keys(envConfig.orchestra).length) diag(`config loaded: ${JSON.stringify(envConfig)}`)
        orchestraCfg = { ...envConfig.orchestra }   // tree_doctor 报告 sweepMode/超时口径（只读）

        engine = createEngine({ store: fsStore(dataDir), clock, ...(Object.keys(envConfig.config).length ? { config: envConfig.config } : {}), ...(Object.keys(envConfig.orchestra).length ? { orchestra: envConfig.orchestra } : {}) })
        engine.attachPorts(makePorts(services, log, { ctx, graceMs: envConfig.orchestra.graceMs }))
        const { sweepMode, stop } = engine.startSweep()
        if (currentStopSweep) { try { currentStopSweep() } catch {} ; diag('previous sweep disposed (hot-reload zombie)') }   // E2E#5：僵尸 sweep 清理
        currentStopSweep = stop
        verifier = createVerifier({ ports: { glob: hostGlob, readFile: (p) => fsp.readFile(p, 'utf-8'), exec: hostExec } })
        diag(`engine ready (sweepMode=${sweepMode})`)

        let okCount = 0
        for (const tool of TOOLS) {
          try { services.tools.register(tool); okCount += 1; diag(`register OK: ${tool.name}`) }
          catch (e) { diag(`register FAILED: ${tool.name}: ${e?.message ?? e}`) }
        }
        console.log(`[tree-engine] v0.6.0 registered ${okCount}/${TOOLS.length} tools (fs persistence @ ${dataDir}; sweepMode=${sweepMode})`)
        diag(`apply complete: ${okCount}/${TOOLS.length} registered`)
      } catch (e) {
        diag(`inject callback THREW: ${e?.stack ?? e}`)
        console.error(`[tree-engine] apply failed: ${e?.stack ?? e}`)
      }
    })
  } catch (e) {
    diag(`ctx.inject THREW: ${e?.stack ?? e}`)
    console.error(`[tree-engine] ctx.inject failed: ${e?.stack ?? e}`)
  }
}
