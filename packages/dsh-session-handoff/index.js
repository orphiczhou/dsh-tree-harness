/**
 * @local/dsh-session-handoff — host-only session self-handoff (context handoff).
 *
 * Why this plugin exists: a session that approaches its context budget cannot
 * keep making progress, and the Harness exposes no model-callable "continue as
 * a fresh session" primitive. `session_handoff` closes that gap from the Host
 * side with capabilities verified against DSH 0.2.2-rc.1:
 *
 *   - `tokenMeter.contextPressure(session)` → `{pressureTokens?, contextWindow?}`
 *   - `session.requestHeader()?.config`     → `{provider, model, reasoningEffort?, maxTokens?}`
 *   - `session.header`                      → `{id, cwd?, parentSession?}`
 *   - `agents.create(options)` + `agent.followup(userMessage)` → a new root session
 *   - `subagents.startActivation({provider:'spawn', ...})`    → a sibling session
 *
 * Two deliberate choices:
 *
 *   1. The successor is **detached from the caller's turn**. The tool passes a
 *      fresh, never-aborting AbortSignal instead of `exec.signal`: stopping the
 *      old session after the handoff must not cancel the session that is meant
 *      to replace it. Cancellation of the old turn only stops this call before
 *      the successor exists.
 *   2. The handoff file is written **before** the successor is started and is
 *      never deleted by a spawn failure: the file is the durable artifact and
 *      the tool reports `spawn_error` alongside it instead of failing silently.
 *
 * Nothing from `@deepseek-ai/*` is imported. The tool is registered as the
 * plain object shape `defineTool()` produces (JSON-Schema `parameters`), and
 * the package declares no dependencies or `peerDependencies` — the only
 * compatibility field DSH enforces — so the bundle stays installable across
 * DSH versions.
 *
 * Registration is optional-service-gated: `ctx.inject([...])` only fires when
 * the four Host services are present, so a composition without them simply
 * never sees the tool instead of failing the whole plugin.
 *
 * @module @local/dsh-session-handoff
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'session-handoff'

/** Marker returned instead of guessing a value a service could not provide. */
const UNAVAILABLE = 'unavailable'
const DEFAULT_THRESHOLD_PCT = 50
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000
/** Spawn backend used for the sibling case (same provider as the `subagent` tool). */
const SUCCESSOR_PROVIDER = 'spawn'
/** Bounds that keep both the tool result and the written recap file bounded. */
const MAX_ARRAY_ITEMS = 50
const MAX_ITEM_CHARS = 1000
const MAX_TEXT_CHARS = 8000

/** Read a failure the way the Harness reports it (RemoteError carries `code`). */
function reasonOf(error) {
  if (error === null || error === undefined) return 'unknown error'
  const code = error && error.code ? `${error.code}: ` : ''
  return `${code}${(error && error.message) || String(error)}`
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function round1(value) {
  return Math.round(value * 10) / 10
}

/**
 * Read one optional Host service without letting a missing/scoped service crash
 * the call. Cordis contexts throw on absent service accessors, so prefer the
 * safe `ctx.get(name)` lookup and fall back to property access (plain-object
 * service mocks in the offline tests).
 */
function requestedService(services, key) {
  if (!services) return undefined
  try {
    if (typeof services.get === 'function') {
      const found = services.get(key)
      if (found !== undefined) return found
    }
  } catch {
    // fall through to property access
  }
  try {
    return services[key]
  } catch {
    return undefined
  }
}

/** Bound free text; a truncated value is marked so the successor knows. */
function normalizeText(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > MAX_TEXT_CHARS ? `${trimmed.slice(0, MAX_TEXT_CHARS)}…` : trimmed
}

/** Bound a string list (item count and item length) and drop empties. */
function normalizeList(value) {
  if (!Array.isArray(value)) return []
  const items = []
  for (const raw of value) {
    if (raw === null || raw === undefined) continue
    const text = String(raw).trim()
    if (!text) continue
    items.push(text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text)
    if (items.length >= MAX_ARRAY_ITEMS) break
  }
  return items
}

function normalizeThreshold(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return isNumber(number) && number >= 0 && number <= 100 ? number : DEFAULT_THRESHOLD_PCT
}

/** `kind` input: root / sibling force the layer; anything else means auto. */
function normalizeKind(value) {
  const kind = String(value || '').trim()
  return kind === 'root' || kind === 'sibling' ? kind : 'auto'
}

function sessionOf(exec) {
  const session = exec && exec.agent && exec.agent.session
  if (!session || typeof session !== 'object') {
    throw new Error(
      'session_handoff: no calling session (exec.agent.session is unavailable; this tool is session-scoped)',
    )
  }
  return session
}

/** `HANDOFF-<短id>-<yyyyMMdd-HHmmss>.md` — the short id is filesystem-safe. */
function shortSessionId(sessionId) {
  const cleaned = String(sessionId || '')
    .replace(/^session-/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
  return cleaned.slice(0, 8) || 'session'
}

function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * Collect every fact the tool reasons about, marking missing values with
 * `undefined` (rendered as `unavailable` at the tool boundary — never guessed).
 */
function collectFacts(services, session) {
  const notes = []
  const header = session && typeof session.header === 'object' ? session.header : {}
  const sessionId = String(session && session.id ? session.id : header.id || '')
  const parentSession = header.parentSession ? String(header.parentSession) : ''

  let pressure
  const tokenMeter = requestedService(services, 'tokenMeter')
  if (tokenMeter && typeof tokenMeter.contextPressure === 'function') {
    try {
      pressure = tokenMeter.contextPressure(session)
    } catch (error) {
      notes.push(`tokenMeter.contextPressure failed: ${reasonOf(error)}`)
    }
    if (!pressure || (!isNumber(pressure.pressureTokens) || !isNumber(pressure.contextWindow))) {
      notes.push(
        'context pressure unavailable: the session log has no usable pressureTokens/contextWindow yet',
      )
    }
  } else {
    notes.push('tokenMeter service unavailable: context percentage is unavailable')
  }
  const pressureTokens = pressure && isNumber(pressure.pressureTokens) ? pressure.pressureTokens : undefined
  const contextWindow = pressure && isNumber(pressure.contextWindow) ? pressure.contextWindow : undefined
  const pct =
    isNumber(pressureTokens) && isNumber(contextWindow) && contextWindow > 0
      ? (pressureTokens / contextWindow) * 100
      : undefined

  let config
  try {
    if (typeof session.requestHeader === 'function') {
      const epoch = session.requestHeader()
      config = epoch && typeof epoch === 'object' ? epoch.config : undefined
    }
  } catch (error) {
    notes.push(`session.requestHeader failed: ${reasonOf(error)}`)
  }
  const provider = config && typeof config.provider === 'string' ? config.provider : ''
  const model = config && typeof config.model === 'string' ? config.model : ''
  const reasoningEffort =
    config && typeof config.reasoningEffort === 'string' ? config.reasoningEffort : ''
  const maxTokens = config && isNumber(config.maxTokens) ? config.maxTokens : undefined

  let cwd = typeof header.cwd === 'string' && header.cwd.trim() ? header.cwd : ''
  let cwdSource = cwd ? 'session.header.cwd' : ''
  if (!cwd) {
    const workingDirectory = requestedService(services, 'workingDirectory')
    if (workingDirectory && typeof workingDirectory.get === 'function') {
      try {
        const fallback = workingDirectory.get(session)
        if (typeof fallback === 'string' && fallback.trim()) {
          cwd = fallback
          cwdSource = 'workingDirectory.get'
        }
      } catch (error) {
        notes.push(`workingDirectory.get failed: ${reasonOf(error)}`)
      }
    }
  }

  return {
    sessionId,
    parentSession,
    cwd,
    cwdSource,
    pressureTokens,
    contextWindow,
    pct,
    provider,
    model,
    reasoningEffort,
    maxTokens,
    notes: notes.slice(0, 4),
  }
}

/**
 * Resolve the successor plan without acting on it.
 *
 * Matrix (frozen by the feature spec):
 *   - child with a LIVE parent and the subagents service → sibling under that parent
 *   - anything else (root, or child whose parent is gone, or `kind:"root"`) → new
 *     root session; a child that degrades to root reports `degraded` explicitly
 *   - no `agents` service → unavailable (the tool reports it, never guesses)
 *
 * `kind` may force the layer: `root` always builds a top-level session; `sibling`
 * requests a sibling and degrades to root when that is impossible.
 */
function planSuccessor(services, facts, requestedKind = 'auto') {
  const parentSession = facts.parentSession
  const agents = requestedService(services, 'agents')
  const subagents = requestedService(services, 'subagents')

  let liveParent
  if (parentSession && agents && typeof agents.get === 'function') {
    try {
      liveParent = agents.get(parentSession)
    } catch {
      liveParent = undefined
    }
  }
  const siblingCapable = Boolean(
    parentSession &&
      liveParent &&
      subagents &&
      typeof subagents.startActivation === 'function',
  )

  if (requestedKind !== 'root' && siblingCapable) {
    return { kind: 'sibling', available: true, parentSession, parentAgent: liveParent, degraded: '' }
  }
  if (agents && typeof agents.create === 'function') {
    const degraded =
      requestedKind !== 'root' && parentSession
        ? !liveParent
          ? 'parent-inactive'
          : 'subagents-unavailable'
        : ''
    return { kind: 'root', available: true, parentSession, parentAgent: undefined, degraded }
  }
  return {
    kind: 'root',
    available: false,
    parentSession,
    parentAgent: undefined,
    degraded: '',
    reason: 'agents service unavailable',
  }
}

/** Model/effort/workspace inheritance payload for the successor Agent. */
function buildAgentOptions(facts) {
  const options = {}
  if (facts.provider) options.provider = facts.provider
  if (facts.model) options.model = facts.model
  if (facts.reasoningEffort) options.reasoningEffort = facts.reasoningEffort
  if (isNumber(facts.maxTokens)) options.maxTokens = facts.maxTokens
  return options
}

function inheritanceLabel(facts) {
  return facts.provider && facts.model ? 'session-route' : 'provider-default'
}

/**
 * A detached AbortSignal: never aborted, so the successor outlives the handing-
 * off turn. See the module comment for the rationale.
 */
function detachedSignal() {
  return new AbortController().signal
}

function buildStatus(services, session, thresholdPct) {
  const facts = collectFacts(services, session)
  const plan = planSuccessor(services, facts)
  return {
    action: 'status',
    context_pct: isNumber(facts.pct) ? round1(facts.pct) : UNAVAILABLE,
    pressure_tokens: isNumber(facts.pressureTokens) ? facts.pressureTokens : UNAVAILABLE,
    context_window: isNumber(facts.contextWindow) ? facts.contextWindow : UNAVAILABLE,
    threshold_pct: thresholdPct,
    provider: facts.provider || UNAVAILABLE,
    model: facts.model || UNAVAILABLE,
    reasoning_effort: facts.reasoningEffort || UNAVAILABLE,
    cwd: facts.cwd || UNAVAILABLE,
    session_id: facts.sessionId || UNAVAILABLE,
    parent_session: facts.parentSession || UNAVAILABLE,
    successor_available: plan.available,
    successor_kind: plan.kind,
    recommended_action:
      isNumber(facts.pct) && facts.pct >= thresholdPct ? 'handoff' : 'continue',
    notes: facts.notes,
  }
}

function buildSuccessorPrompt({ facts, handoffPath }) {
  const origin = facts.sessionId || 'the previous session'
  return [
    `You are the successor session for ${origin}, which handed off because its context budget is nearly full.`,
    '',
    `First read the handoff file at: ${handoffPath}`,
    '',
    'It records the task, current status, decisions, changed files, next steps and open questions.',
    'Then continue advancing the work from its next steps: do not redo work the handoff records',
    'as done, keep the same working directory and model/effort, and begin by stating in one short',
    'paragraph what you will do next.',
  ].join('\n')
}

function bulletList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['_(none recorded)_']
}

function numberedList(items) {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`) : ['_(none recorded)_']
}

function normalizeDetails(args) {
  return {
    summary: normalizeText(args.summary),
    nextSteps: normalizeList(args.next_steps),
    files: normalizeList(args.files),
    openQuestions: normalizeList(args.open_questions),
    note: normalizeText(args.note),
  }
}

/** Deterministic recap template: task / status / decisions / files / next / open questions / origin. */
function renderHandoffFile({ facts, details, handoffPath, stamp, nowIso, thresholdPct }) {
  const contextLine = isNumber(facts.pct)
    ? `${round1(facts.pct)}% of ${facts.contextWindow} tokens (threshold ${thresholdPct}%)`
    : UNAVAILABLE
  const modelLine = facts.provider && facts.model ? `${facts.provider}/${facts.model}` : UNAVAILABLE
  const effortLine = facts.reasoningEffort || UNAVAILABLE
  return [
    `# Session handoff — ${stamp}`,
    '',
    '> Generated by the `session_handoff` tool. Read this file first, then continue the work it records.',
    '',
    '## Task',
    details.summary || '_(not recorded)_',
    '',
    '## Current status',
    `- Session: \`${facts.sessionId || UNAVAILABLE}\``,
    `- Parent session: \`${facts.parentSession || UNAVAILABLE}\``,
    `- Workspace: \`${facts.cwd || UNAVAILABLE}\``,
    `- Handoff file: \`${handoffPath}\``,
    `- Context: ${contextLine}`,
    `- Model: ${modelLine} · reasoning effort: ${effortLine}`,
    '',
    '## Decisions',
    details.note || '_(not recorded)_',
    '',
    '## Changed files',
    ...bulletList(details.files),
    '',
    '## Next steps',
    ...numberedList(details.nextSteps),
    '',
    '## Open questions',
    ...bulletList(details.openQuestions),
    '',
    '## Original session',
    `- session_id: \`${facts.sessionId || UNAVAILABLE}\``,
    `- parent_session: \`${facts.parentSession || UNAVAILABLE}\``,
    `- provider: ${facts.provider || UNAVAILABLE}`,
    `- model: ${facts.model || UNAVAILABLE}`,
    `- reasoning_effort: ${effortLine}`,
    `- cwd: \`${facts.cwd || UNAVAILABLE}\``,
    `- generated_at: ${nowIso}`,
    '',
    '## Successor instructions',
    buildSuccessorPrompt({ facts, handoffPath }),
    '',
  ].join('\n')
}

function successorUserMessage(prompt) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }
}

/**
 * Send the handoff prompt to the new root Agent. `followup` is the documented
 * primitive; `send` is the same inbox path and is kept as a defensive fallback
 * for a Host build that renames/removes the alias.
 */
async function sendFirstMessage(agent, message) {
  if (typeof agent.followup === 'function') {
    await agent.followup(message)
    return
  }
  if (typeof agent.send === 'function') {
    await agent.send(message)
    return
  }
  throw new Error('successor agent exposes neither followup() nor send()')
}

/**
 * Start the successor session. Throws on every failure path; the caller keeps
 * the already-written handoff file and reports `spawn_error` instead.
 */
async function spawnSuccessor({ services, plan, facts, prompt }) {
  const agentOptions = buildAgentOptions(facts)
  const inherited = inheritanceLabel(facts)

  if (plan.kind === 'sibling') {
    const subagents = requestedService(services, 'subagents')
    const activation = await subagents.startActivation({
      provider: SUCCESSOR_PROVIDER,
      label: `handoff ${shortSessionId(facts.sessionId)}`,
      request: {
        prompt: [{ type: 'text', text: prompt }],
        parent: plan.parentAgent,
        cwd: facts.cwd,
        ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
      },
      signal: detachedSignal(),
      delivery: 'parent',
    })
    const childId = activation && activation.childId
    if (!childId) throw new Error('subagents.startActivation returned no childId')
    return {
      session_id: String(childId),
      kind: 'sibling',
      parent_session: plan.parentSession || UNAVAILABLE,
      model: facts.model || UNAVAILABLE,
      reasoning_effort: facts.reasoningEffort || UNAVAILABLE,
      inherited,
    }
  }

  const agents = requestedService(services, 'agents')
  const sessionId = `session-${randomUUID()}`
  const handle = await agents.create({
    sessionId,
    meta: { cwd: facts.cwd },
    ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
    signal: detachedSignal(),
  })
  const agent = handle && handle.agent
  if (!agent) throw new Error('agents.create returned no agent handle')
  await sendFirstMessage(agent, successorUserMessage(prompt))
  return {
    session_id: String(agent.id || sessionId),
    kind: 'root',
    parent_session: UNAVAILABLE,
    model: facts.model || UNAVAILABLE,
    reasoning_effort: facts.reasoningEffort || UNAVAILABLE,
    inherited,
  }
}

/** One-line, bounded render for the calling model (never the recap body). */
function renderSummary(args, value) {
  const action = (args && args.action) || (value && value.action) || ''
  if (!value || typeof value !== 'object') return `session_handoff: ${action || 'done'}`
  const oneLine = (text) => String(text).replace(/\s+/g, ' ').slice(0, 400)
  if (action === 'status') {
    return oneLine(
      `session_handoff status: context=${value.context_pct}` +
        `${value.context_pct === UNAVAILABLE ? '' : '%'} (threshold ${value.threshold_pct}%)` +
        ` pressure=${value.pressure_tokens}/${value.context_window}` +
        ` model=${value.provider}/${value.model} effort=${value.reasoning_effort}` +
        ` successor=${value.successor_available ? value.successor_kind : 'unavailable'}` +
        ` next=${value.recommended_action}`,
    )
  }
  if (value.status === 'rejected') {
    return oneLine(
      value.reason === 'below-threshold'
        ? `session_handoff rejected: context ${value.context_pct}% is below threshold ${value.threshold_pct}% (pass force:true to override)`
        : `session_handoff rejected: a handoff already succeeded in this session (${value.last_handoff_at}); pass force:true to override`,
    )
  }
  if (value.status === 'file-only') {
    return oneLine(`session_handoff: wrote ${value.handoff_path} (no successor spawned)`)
  }
  if (value.status === 'handed-off') {
    const successor = value.successor || {}
    return oneLine(
      `session_handoff: wrote ${value.handoff_path}; successor ${successor.session_id} ` +
        `kind=${successor.kind}${value.degraded ? ` degraded=${value.degraded}` : ''} ` +
        `inherited=${successor.inherited}`,
    )
  }
  if (value.spawn_error) {
    return oneLine(
      `session_handoff: wrote ${value.handoff_path}; successor FAILED: ${value.spawn_error}`,
    )
  }
  return oneLine(`session_handoff: ${value.status || 'done'}`)
}

/**
 * Model-facing tool definition. Wording follows the repository's agent-
 * experience convention: when to use first, parameter rules on the parameters,
 * bounded one-line results.
 */
export const HANDOFF_TOOL = {
  name: 'session_handoff',
  description:
    'Hand off this session to a fresh successor session before its context fills. Call with action "status" ' +
    'when context is near 50% to read the current context pressure and the successor plan; call action "handoff" ' +
    'at or above the threshold (default 50%) or when the user asks to hand off. handoff writes a ' +
    'HANDOFF-<id>-<timestamp>.md recap into the session working directory and, unless spawn:false, starts a ' +
    'same-level successor: a sibling under the same live parent when this session is a child, otherwise a new ' +
    'root session with the same provider/model/reasoning effort and working directory. The successor is told to ' +
    'read the handoff file and continue. Returns bounded JSON: handoff_path, successor identity, degraded/' +
    'spawn_error when applicable; a below-threshold or repeated call is rejected with its current percentage.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'handoff'],
        description: 'status reads only; handoff writes the recap file and may start the successor.',
      },
      kind: {
        type: 'string',
        enum: ['root', 'sibling', 'auto'],
        description:
          'handoff only. auto (default) uses sibling when this session is a child whose parent is live, else root. ' +
          'root forces a new top-level session; sibling requests a sibling and degrades to root with ' +
          'degraded:"parent-inactive" when the parent is gone.',
      },
      summary: {
        type: 'string',
        description:
          'handoff only, required. One-paragraph task recap written into the file\'s Task section.',
      },
      next_steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'handoff only. Ordered remaining steps for the successor.',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'handoff only. Files this session created or modified.',
      },
      open_questions: {
        type: 'array',
        items: { type: 'string' },
        description: 'handoff only. Unresolved questions the successor must keep in view.',
      },
      note: {
        type: 'string',
        description: 'handoff only. Decisions and constraints worth preserving.',
      },
      spawn: {
        type: 'boolean',
        description:
          'handoff only. false writes the recap file and skips the successor session; default true.',
      },
      threshold_pct: {
        type: 'number',
        description:
          'handoff guard and status reference: minimum context percentage required without force, 0-100, default 50.',
      },
      force: {
        type: 'boolean',
        description:
          'handoff only. Bypass both the threshold guard and the 5-minute duplicate guard; default false.',
      },
    },
    required: ['action'],
  },
  output: {
    schema: { type: 'object' },
    render: (args, value) => [{ type: 'text', text: renderSummary(args, value) }],
  },
}

/**
 * Build the tool executor. Exported for offline tests; `apply` wires it to the
 * real Host services. `options.state` (Map of session id → last handoff) is the
 * in-memory duplicate guard; `options.now` and `options.duplicateWindowMs` let
 * tests control time.
 */
export function makeExecute(services, options = {}) {
  const state = options.state instanceof Map ? options.state : new Map()
  const now = typeof options.now === 'function' ? options.now : Date.now
  const duplicateWindowMs = isNumber(options.duplicateWindowMs)
    ? options.duplicateWindowMs
    : DUPLICATE_WINDOW_MS

  return async function execute(rawArgs, exec) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
    const action = String(args.action || '').trim()
    const session = sessionOf(exec)
    const thresholdPct = normalizeThreshold(args.threshold_pct)

    if (action === 'status') return buildStatus(services, session, thresholdPct)
    if (action !== 'handoff') {
      throw new Error('session_handoff: "action" must be "status" or "handoff"')
    }

    const force = args.force === true
    const requestedKind = normalizeKind(args.kind)
    const facts = collectFacts(services, session)

    // 1. Threshold guard: refuse an accidental early handoff, returning the pct.
    if (!force && isNumber(facts.pct) && facts.pct < thresholdPct) {
      return {
        action: 'handoff',
        status: 'rejected',
        reason: 'below-threshold',
        context_pct: round1(facts.pct),
        threshold_pct: thresholdPct,
        hint: 'Pass force:true only when the user explicitly wants to hand off before the threshold.',
        warnings: [],
      }
    }

    if (!facts.cwd) {
      throw new Error(
        'session_handoff: cannot determine the session working directory ' +
          '(session.header.cwd and workingDirectory are both unavailable)',
      )
    }

    // 2. Duplicate guard: one successful handoff per session per 5 minutes.
    const nowMs = Number(now()) || Date.now()
    const previous = state.get(facts.sessionId)
    if (!force && previous && nowMs - previous.at < duplicateWindowMs) {
      return {
        action: 'handoff',
        status: 'rejected',
        reason: 'recent-handoff',
        last_handoff_at: new Date(previous.at).toISOString(),
        handoff_path: previous.path,
        context_pct: isNumber(facts.pct) ? round1(facts.pct) : UNAVAILABLE,
        threshold_pct: thresholdPct,
        hint: 'A handoff already succeeded in this session within the last 5 minutes; pass force:true to write another handoff file.',
        warnings: [],
      }
    }

    const details = normalizeDetails(args)
    if (!details.summary) {
      throw new Error('session_handoff: "summary" is required (non-empty) for action "handoff"')
    }

    const warnings = []
    if (!isNumber(facts.pct)) {
      warnings.push('context percentage unavailable: the threshold guard could not be evaluated')
    }

    // 3. Write the durable recap first: a spawn failure must not lose it.
    const stamp = formatStamp(new Date(nowMs))
    const fileName = `HANDOFF-${shortSessionId(facts.sessionId)}-${stamp}.md`
    const handoffPath = path.resolve(facts.cwd, fileName)
    const prompt = buildSuccessorPrompt({ facts, handoffPath })
    const content = renderHandoffFile({
      facts,
      details,
      handoffPath,
      stamp,
      nowIso: new Date(nowMs).toISOString(),
      thresholdPct,
    })
    try {
      await fsp.mkdir(facts.cwd, { recursive: true })
      await fsp.writeFile(handoffPath, content, 'utf8')
    } catch (error) {
      throw new Error(
        `session_handoff: could not write the handoff file at ${handoffPath} — ${reasonOf(error)}`,
      )
    }
    state.set(facts.sessionId, { at: nowMs, path: handoffPath })

    const response = {
      action: 'handoff',
      status: 'handoff-file-written',
      handoff_path: handoffPath,
      context_pct: isNumber(facts.pct) ? round1(facts.pct) : UNAVAILABLE,
      threshold_pct: thresholdPct,
      context_window: isNumber(facts.contextWindow) ? facts.contextWindow : UNAVAILABLE,
      cwd: facts.cwd,
      session_id: facts.sessionId || UNAVAILABLE,
      parent_session: facts.parentSession || UNAVAILABLE,
      warnings,
    }

    if (args.spawn === false) {
      response.status = 'file-only'
      response.successor = UNAVAILABLE
      response.spawn = 'skipped'
      return response
    }

    // 4. Start the successor. Any failure keeps the file and reports explicitly.
    const plan = planSuccessor(services, facts, requestedKind)
    if (!plan.available) {
      response.spawn_error = `no successor path available (${plan.reason || 'agents service unavailable'})`
      response.successor = UNAVAILABLE
      return response
    }
    try {
      response.successor = await spawnSuccessor({ services, plan, facts, prompt })
      response.status = 'handed-off'
      if (plan.degraded) response.degraded = plan.degraded
      return response
    } catch (error) {
      response.spawn_error = reasonOf(error)
      response.successor = UNAVAILABLE
      return response
    }
  }
}

export function apply(ctx) {
  // Optional-service gate: the tool stays unregistered where these Host
  // services are absent instead of failing the whole plugin.
  ctx.inject(['tools', 'subagents', 'agents', 'tokenMeter'], (scoped) => {
    const services = scoped || ctx
    services.tools.register({ ...HANDOFF_TOOL, execute: makeExecute(services) })
  })
}
