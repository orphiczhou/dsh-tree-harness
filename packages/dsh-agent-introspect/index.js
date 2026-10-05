/**
 * @local/dsh-agent-introspect — 子会话自省插件 v0.1
 *
 * 需求来源(用户 2026-10-05,agspec 树分析落地):
 *   A. 可观测性——一次性/可续子会话都应能看到自己的运行配置(模型/权限/作用域/token 用量);
 *   B. 可控性——运行中改 agentOptions/权限/温度 = 物理不可能(宿主启动时一次性 resolve,见 agspec W4 §4.2),
 *      唯一出路 = cancel+带 assignee 重派(树引擎 tree_dispatch 已支持,且 assignee 已持久化跨竹节保持)。
 *
 * 本插件提供工具 self_spec:从工具调用方会话(exec.agent.session)出发,
 * 读 DSH 会话 projcache(~/.dsh/storages/session_projcache/sessions/<id>.json)投影运行配置;
 * 不可得字段(effort=仅存请求头、temperature=宿主链路无配置点)显式标注 unavailable 与原因——诚实降级,不猜。
 */
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'agent-introspect'

const ok = (text) => (args, value) => [{ type: 'text', text: typeof text === 'function' ? text(value) : text }]

/** projcache 候选路径(形状防御:版本/布局变化时逐个尝试)。 */
function projcacheCandidates(sessionId) {
  const home = os.homedir()
  return [
    path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions', `${sessionId}.json`),
    path.join(home, '.dsh', 'session_projcache', 'sessions', `${sessionId}.json`),
  ]
}

/** 从 projcache JSON 投影配置面。实测形状(2026-10-05,E2E 对齐):
 *  { version, record: { identity:{cwd}, rows: { <key>: {ver,seq,val} } } }——字段值包在 .val 里。 */
function projectSpec(raw, sessionId) {
  const rec = raw?.record ?? raw ?? {}
  const rows = rec?.rows ?? {}
  const cell = (k) => (k in rows ? rows[k]?.val : rec?.[k])
  const spec = { session_id: sessionId }
  const modelSel = cell('modelSelection')
  spec.model = modelSel?.lastUsed
    ? `${modelSel.lastUsed.provider ?? '?'}/${modelSel.lastUsed.model ?? '?'}`
    : undefined
  const policy = cell('subagentModelSelectionPolicy')
  spec.model_selection_policy = Array.isArray(policy) ? policy.map((p) => `${p.provider ?? '?'}/${p.model ?? '?'}`) : policy
  const perms = cell('permissions')
  spec.permissions = perms && typeof perms === 'object'
    ? { preset: perms.preset, sandbox: perms.sandbox ?? perms.sandboxMode, approval: perms.approval }
    : undefined
  spec.sandbox_mode = cell('sandboxMode')
  spec.cwd = rec?.identity?.cwd ?? rec?.cwd
  spec.token_usage = cell('tokenUsage')
  return spec
}

const SELF_SPEC = {
  name: 'self_spec',
  description:
    'Introspect the calling session runtime configuration: model, permissions (preset/sandbox/approval), sandbox mode, workspace cwd, token usage — ' +
    'projected from the DSH session projcache. Effort (request-header only) and temperature (no host channel) are explicitly unavailable. ' +
    'Runtime mutation of these values is impossible by design; the only path is cancel + re-dispatch with a new assignee (e.g. tree_dispatch).',
  parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  output: {
    schema: { type: 'object' },
    render: ok((v) => {
      const s = v?.spec ?? {}
      return `self_spec: session=${String(s.session_id ?? '?').slice(0, 8)} model=${s.model ?? '?'} · perms=${s.permissions?.preset ?? '?'}${s.permissions?.approval ? '/' + s.permissions.approval : ''} · sandbox=${s.sandbox_mode ?? '?'} · cwd=${s.cwd ?? '?'}${v?.source ? ' (' + v.source + ')' : ''}`
    }),
  },
  execute: async (_args, exec) => {
    const session = exec?.agent?.session
    const sessionId = session?.id ?? session?.header?.sessionId ?? session?.header?.id ?? process.env.DSH_SESSION_ID ?? null
    if (!sessionId) {
      throw new Error('self_spec: cannot resolve calling session id (exec.agent.session unavailable and DSH_SESSION_ID unset)')
    }
    const notes = {
      effort: 'unavailable: reasoning effort lives only in LLM request headers; no persistent channel (host change required)',
      temperature: 'unavailable: no temperature field in the host subagent chain (AgentOptions/agent-loop); not configurable at all',
      mutation: 'runtime mutation of agentOptions/toolFilter/persona/permissions is impossible for a started session (resolved once at start); use cancel + re-dispatch with new assignee',
    }
    for (const p of projcacheCandidates(sessionId)) {
      try {
        const raw = JSON.parse(await fsp.readFile(p, 'utf-8'))
        return lossless({ spec: projectSpec(raw, sessionId), source: `projcache ${p}`, notes })
      } catch { /* 下一候选 */ }
    }
    // projcache 不可读(会话尚未落盘/布局变更):仍返回会话身份与诚实降级说明
    return lossless({
      spec: projectSpec({}, sessionId),
      source: 'degraded: projcache not found for this session',
      notes,
    })
  },
}

/** 宿主工具通道要求 lossless JSON:递归剔除 undefined 值(宿主序列化拒收 undefined 字段——E2E 实证)。 */
function lossless(value) {
  if (Array.isArray(value)) return value.map(lossless)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = lossless(v)
    return out
  }
  return value
}

export function apply(ctx) {
  const diag = (m) => { try { console.error(`[agent-introspect] ${m}`) } catch {} }
  try {
    ctx.inject(['tools'], (scoped) => {
      try {
        const services = scoped || ctx
        services.tools.register(SELF_SPEC)
        diag(`registered 1/1 tools (self_spec)`)
        console.log('[agent-introspect] v0.1 registered self_spec (session introspection)')
      } catch (e) { diag(`inject callback THREW: ${e?.stack ?? e}`) }
    })
  } catch (e) { diag(`ctx.inject THREW: ${e?.stack ?? e}`) }
}
