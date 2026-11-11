/**
 * Offline tests for @local/dsh-session-handoff.
 *
 * The four Host services are mocked at the seam the tool consumes:
 * `tools`/`agents`/`subagents`/`tokenMeter`, plus the optional
 * `workingDirectory` fallback. No @deepseek-ai package is loaded, no real
 * session is created; files are written to a throw-away temp workspace.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, makeExecute } from '../index.js'

const PARENT_ID = 'session-parent-00000000'

/** A throw-away workspace directory removed after each test. */
async function makeWorkspace(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-handoff-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })
  return dir
}

function makeSession({ id = 'session-current-abcd1234', cwd, parentSession, config } = {}) {
  const header = { id }
  if (cwd !== undefined) header.cwd = cwd
  if (parentSession !== undefined) header.parentSession = parentSession
  return {
    id,
    header,
    requestHeader: () => (config === undefined ? undefined : { config }),
  }
}

const DEFAULT_CONFIG = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  reasoningEffort: 'high',
  maxTokens: 8192,
}

function makeExec(session) {
  return { agent: { session }, signal: new AbortController().signal }
}

/**
 * Mock Host services and a call log. Overrides are shallow-merged, so a test can
 * replace `services.agents.create` or drop a whole service.
 */
function makeServices(overrides = {}, { pressureTokens = 60000, contextWindow = 100000 } = {}) {
  const calls = { create: [], followup: [], startActivation: [], get: [] }
  const parentAgent = { id: PARENT_ID }
  const services = {
    tokenMeter: {
      contextPressure: () => ({ pressureTokens, contextWindow }),
    },
    agents: {
      get: (id) => {
        calls.get.push(id)
        return id === PARENT_ID ? parentAgent : undefined
      },
      create: async (options) => {
        calls.create.push(options)
        const agent = {
          id: options.sessionId,
          followup: async (message) => {
            calls.followup.push({ options, message })
          },
        }
        return { agent, dispose: async () => {} }
      },
    },
    subagents: {
      startActivation: async (spec) => {
        calls.startActivation.push(spec)
        return { childId: 'session-successor-sibling-1' }
      },
    },
    workingDirectory: { get: () => '/working-directory-fallback' },
    ...overrides,
  }
  return { services, calls, parentAgent }
}

async function handoffFiles(dir) {
  const entries = await fsp.readdir(dir)
  return entries.filter((entry) => /^HANDOFF-.*\.md$/.test(entry)).sort()
}

async function exists(file) {
  try {
    await fsp.access(file)
    return true
  } catch {
    return false
  }
}

test('status：pressure/model/cwd 齐全时返回真实百分比与继承信息', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const status = await execute({ action: 'status' }, makeExec(session))

  assert.equal(status.action, 'status')
  assert.equal(status.context_pct, 60)
  assert.equal(status.pressure_tokens, 60000)
  assert.equal(status.context_window, 100000)
  assert.equal(status.threshold_pct, 50)
  assert.equal(status.provider, 'deepseek')
  assert.equal(status.model, 'deepseek-chat')
  assert.equal(status.reasoning_effort, 'high')
  assert.equal(status.cwd, cwd)
  assert.equal(status.session_id, session.id)
  assert.equal(status.parent_session, 'unavailable')
  assert.equal(status.successor_available, true)
  assert.equal(status.successor_kind, 'root')
  assert.equal(status.recommended_action, 'handoff')
  assert.deepEqual(status.notes, [])
})

test('status：pressure 字段缺失时显式 unavailable，不猜', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({ tokenMeter: { contextPressure: () => ({}) } })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const status = await execute({ action: 'status' }, makeExec(session))

  assert.equal(status.context_pct, 'unavailable')
  assert.equal(status.pressure_tokens, 'unavailable')
  assert.equal(status.context_window, 'unavailable')
  assert.ok(status.notes.some((note) => /pressure/i.test(note)))
  assert.equal(status.recommended_action, 'continue')
  assert.equal(status.provider, 'deepseek')
})

test('status：tokenMeter 整个缺失时不抛错，其余字段仍诚实可用', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({ tokenMeter: undefined })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const status = await execute({ action: 'status' }, makeExec(session))

  assert.equal(status.context_pct, 'unavailable')
  assert.ok(status.notes.some((note) => /tokenMeter/i.test(note)))
  assert.equal(status.model, 'deepseek-chat')
})

test('status：header.cwd 缺失时回退 workingDirectory.get；无 requestHeader 时 provider unavailable', async (t) => {
  const { services } = makeServices()
  const session = makeSession({ config: undefined })
  delete session.header.cwd
  const execute = makeExecute(services)

  const status = await execute({ action: 'status' }, makeExec(session))

  assert.equal(status.cwd, '/working-directory-fallback')
  assert.equal(status.provider, 'unavailable')
  assert.equal(status.model, 'unavailable')
  assert.equal(status.reasoning_effort, 'unavailable')
})

test('status：agents/subagents 缺失时 successor_available=false', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({ agents: undefined, subagents: undefined })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const status = await execute({ action: 'status' }, makeExec(session))

  assert.equal(status.successor_available, false)
  assert.equal(status.successor_kind, 'root')
})

test('handoff：pct 低于阈值 → 拒绝并返回当前 pct，不写文件', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({}, { pressureTokens: 30000, contextWindow: 100000 })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'should not happen' }, makeExec(session))

  assert.equal(result.status, 'rejected')
  assert.equal(result.reason, 'below-threshold')
  assert.equal(result.context_pct, 30)
  assert.equal(result.threshold_pct, 50)
  assert.deepEqual(await handoffFiles(cwd), [])
})

test('handoff：达到阈值 → 写出 HANDOFF 文件，模板字段齐全', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({}, { pressureTokens: 50000, contextWindow: 100000 })
  const session = makeSession({
    id: 'session-abcdef1234567890',
    cwd,
    config: DEFAULT_CONFIG,
  })
  const execute = makeExecute(services)

  const result = await execute(
    {
      action: 'handoff',
      summary: 'Implement the session handoff feature',
      next_steps: ['Run the offline tests', 'Report evidence to the Lead'],
      files: ['packages/dsh-session-handoff/index.js'],
      open_questions: ['Does the sidebar show created root sessions?'],
      note: 'Chose agents.create + followup over a setup callback.',
    },
    makeExec(session),
  )

  assert.equal(result.status, 'handed-off')
  assert.equal(result.context_pct, 50)
  assert.equal(result.session_id, session.id)
  assert.equal(path.dirname(result.handoff_path), cwd)
  assert.match(path.basename(result.handoff_path), /^HANDOFF-abcdef12-\d{8}-\d{6}\.md$/)
  assert.equal(await exists(result.handoff_path), true)

  const content = await fsp.readFile(result.handoff_path, 'utf8')
  for (const needle of [
    '## Task',
    'Implement the session handoff feature',
    '## Current status',
    '## Decisions',
    'Chose agents.create + followup over a setup callback.',
    '## Changed files',
    'packages/dsh-session-handoff/index.js',
    '## Next steps',
    '1. Run the offline tests',
    '2. Report evidence to the Lead',
    '## Open questions',
    'Does the sidebar show created root sessions?',
    '## Original session',
    session.id,
    'deepseek/deepseek-chat',
    'reasoning effort: high',
    '## Successor instructions',
    'First read the handoff file at:',
  ]) {
    assert.ok(content.includes(needle), `handoff file is missing: ${needle}`)
  }
})

test('handoff：根会话 → agents.create（session-* / meta.cwd / agentOptions）后再 followup', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ id: 'session-abcdef1234567890', cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'Root successor' }, makeExec(session))

  assert.equal(calls.create.length, 1)
  const options = calls.create[0]
  assert.match(String(options.sessionId), /^session-[0-9a-f-]{36}$/)
  assert.equal(options.meta.cwd, cwd)
  assert.deepEqual(options.agentOptions, DEFAULT_CONFIG)
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(options.signal.aborted, false)
  assert.equal(result.successor.kind, 'root')
  assert.equal(result.successor.session_id, options.sessionId)
  assert.equal(result.successor.parent_session, 'unavailable')
  assert.equal(result.successor.inherited, 'session-route')

  assert.equal(calls.followup.length, 1)
  const { message } = calls.followup[0]
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0)
  assert.deepEqual(message.source, { kind: 'user' })
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.ok(message.content[0].text.includes(result.handoff_path))
  assert.match(message.content[0].text, /read the handoff file/i)
})

test('handoff：子会话且父 Agent 活 → startActivation 启动兄弟会话（同父、同层级）', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls, parentAgent } = makeServices()
  const session = makeSession({ cwd, parentSession: PARENT_ID, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'Sibling successor' }, makeExec(session))

  assert.equal(calls.create.length, 0)
  assert.equal(calls.startActivation.length, 1)
  const spec = calls.startActivation[0]
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.request.parent, parentAgent)
  assert.equal(spec.request.cwd, cwd)
  assert.deepEqual(spec.request.agentOptions, DEFAULT_CONFIG)
  assert.equal(spec.request.prompt.length, 1)
  assert.equal(spec.request.prompt[0].type, 'text')
  assert.ok(spec.request.prompt[0].text.includes(result.handoff_path))
  assert.match(spec.request.prompt[0].text, /read the handoff file/i)
  assert.match(String(spec.label), /^handoff /)
  assert.ok(spec.signal instanceof AbortSignal)
  assert.equal(spec.signal.aborted, false)

  assert.equal(result.status, 'handed-off')
  assert.equal(result.successor.kind, 'sibling')
  assert.equal(result.successor.session_id, 'session-successor-sibling-1')
  assert.equal(result.successor.parent_session, PARENT_ID)
  assert.equal('degraded' in result, false)
})

test('handoff：子会话但父不活 → 降级根级并显式 degraded', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  services.agents.get = () => undefined
  const session = makeSession({ cwd, parentSession: PARENT_ID, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'Degraded successor' }, makeExec(session))

  assert.equal(result.status, 'handed-off')
  assert.equal(result.degraded, 'parent-inactive')
  assert.equal(result.successor.kind, 'root')
  assert.equal(calls.create.length, 1)
  assert.equal(calls.startActivation.length, 0)
  assert.equal(calls.create[0].meta.cwd, cwd)
})

test('handoff：kind=root 强制根级（子会话父活也不建兄弟）', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ cwd, parentSession: PARENT_ID, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute(
    { action: 'handoff', kind: 'root', summary: 'Forced root' },
    makeExec(session),
  )

  assert.equal(result.status, 'handed-off')
  assert.equal(result.successor.kind, 'root')
  assert.equal('degraded' in result, false)
  assert.equal(calls.create.length, 1)
  assert.equal(calls.startActivation.length, 0)
})

test('handoff：kind=sibling 但父不活 → 根级 + degraded=parent-inactive', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  services.agents.get = () => undefined
  const session = makeSession({ cwd, parentSession: PARENT_ID, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute(
    { action: 'handoff', kind: 'sibling', summary: 'Explicit sibling gone' },
    makeExec(session),
  )

  assert.equal(result.successor.kind, 'root')
  assert.equal(result.degraded, 'parent-inactive')
  assert.equal(calls.create.length, 1)
})

test('handoff：根会话请求 kind=sibling → 回退根级，根级本身即同层不标降级', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute(
    { action: 'handoff', kind: 'sibling', summary: 'No parent for sibling' },
    makeExec(session),
  )

  assert.equal(result.status, 'handed-off')
  assert.equal(result.successor.kind, 'root')
  assert.equal('degraded' in result, false)
  assert.equal(calls.create.length, 1)
  assert.equal(calls.startActivation.length, 0)
})

test('handoff：spawn 失败但文件已写成功 → 返回 handoff_path + spawn_error，不静默', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices()
  services.agents.create = async () => {
    throw new Error('boom-create')
  }
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'Spawn failure' }, makeExec(session))

  assert.equal(result.status, 'handoff-file-written')
  assert.match(String(result.spawn_error), /boom-create/)
  assert.equal(result.successor, 'unavailable')
  assert.equal(await exists(result.handoff_path), true)
  assert.deepEqual(await handoffFiles(cwd), [path.basename(result.handoff_path)])
})

test('handoff：spawn=false → 只写文件，不启动接替会话', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute(
    { action: 'handoff', summary: 'File only', spawn: false },
    makeExec(session),
  )

  assert.equal(result.status, 'file-only')
  assert.equal(result.spawn, 'skipped')
  assert.equal(result.successor, 'unavailable')
  assert.equal(calls.create.length, 0)
  assert.equal(calls.startActivation.length, 0)
  assert.equal(await exists(result.handoff_path), true)
})

test('handoff：5 分钟内防重复，超过窗口后可再次交接', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const base = Date.parse('2026-11-11T12:00:00Z')
  let clock = base
  const execute = makeExecute(services, { now: () => clock })

  const first = await execute({ action: 'handoff', summary: 'First' }, makeExec(session))
  assert.equal(first.status, 'handed-off')
  assert.deepEqual(await handoffFiles(cwd), [path.basename(first.handoff_path)])

  clock = base + 90_000
  const second = await execute({ action: 'handoff', summary: 'Second too early' }, makeExec(session))
  assert.equal(second.status, 'rejected')
  assert.equal(second.reason, 'recent-handoff')
  assert.equal(second.last_handoff_at, new Date(base).toISOString())
  assert.equal(second.handoff_path, first.handoff_path)
  assert.deepEqual(await handoffFiles(cwd), [path.basename(first.handoff_path)])
  assert.equal(calls.create.length, 1)

  clock = base + 300_001
  const third = await execute({ action: 'handoff', summary: 'Third after window' }, makeExec(session))
  assert.equal(third.status, 'handed-off')
  assert.equal((await handoffFiles(cwd)).length, 2)
  assert.equal(calls.create.length, 2)
})

test('handoff：force 同时覆盖阈值守卫与 5 分钟防重复', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices({}, { pressureTokens: 10000, contextWindow: 100000 })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const base = Date.parse('2026-11-11T13:00:00Z')
  let clock = base
  const execute = makeExecute(services, { now: () => clock })

  const first = await execute(
    { action: 'handoff', summary: 'Forced below threshold', force: true },
    makeExec(session),
  )
  assert.equal(first.status, 'handed-off')

  clock = base + 1000
  const rejected = await execute({ action: 'handoff', summary: 'No force' }, makeExec(session))
  assert.equal(rejected.reason, 'below-threshold')

  const second = await execute(
    { action: 'handoff', summary: 'Forced duplicate override', force: true },
    makeExec(session),
  )
  assert.equal(second.status, 'handed-off')
  assert.equal((await handoffFiles(cwd)).length, 2)
  assert.equal(calls.create.length, 2)
})

test('handoff：文件写失败 → 整体失败，且未启动接替会话', async (t) => {
  const cwd = await makeWorkspace(t)
  const blocker = path.join(cwd, 'not-a-directory')
  await fsp.writeFile(blocker, 'x', 'utf8')
  const { services, calls } = makeServices()
  const session = makeSession({ cwd: blocker, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  await assert.rejects(
    execute({ action: 'handoff', summary: 'Unwritable' }, makeExec(session)),
    /could not write the handoff file/,
  )
  assert.equal(calls.create.length, 0)
  assert.equal(calls.startActivation.length, 0)
})

test('handoff：threshold_pct 参数生效（显式 80 拒绝，50 放行）', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const rejected = await execute(
    { action: 'handoff', summary: 'Too early for 80', threshold_pct: 80 },
    makeExec(session),
  )
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.threshold_pct, 80)
  assert.equal(rejected.context_pct, 60)

  const status = await execute({ action: 'status', threshold_pct: 80 }, makeExec(session))
  assert.equal(status.threshold_pct, 80)
  assert.equal(status.recommended_action, 'continue')

  const allowed = await execute(
    { action: 'handoff', summary: 'Allowed at 50', threshold_pct: 50 },
    makeExec(session),
  )
  assert.equal(allowed.status, 'handed-off')
})

test('handoff：缺 summary 拒绝（handoff 必填非空）', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices()
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  await assert.rejects(
    execute({ action: 'handoff' }, makeExec(session)),
    /"summary" is required/,
  )
  assert.deepEqual(await handoffFiles(cwd), [])
})

test('handoff：缺 agents/subagents 服务 → 文件仍写成功，spawn_error 明示', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services } = makeServices({ agents: undefined, subagents: undefined })
  const session = makeSession({ cwd, config: DEFAULT_CONFIG })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'No spawn service' }, makeExec(session))

  assert.equal(result.status, 'handoff-file-written')
  assert.match(String(result.spawn_error), /no successor path available/)
  assert.equal(await exists(result.handoff_path), true)
})

test('handoff：读不到 requestHeader().config → 省略 agentOptions 并标 inherited=provider-default', async (t) => {
  const cwd = await makeWorkspace(t)
  const { services, calls } = makeServices()
  const session = makeSession({ cwd, config: undefined })
  const execute = makeExecute(services)

  const result = await execute({ action: 'handoff', summary: 'Provider default' }, makeExec(session))

  assert.equal(result.status, 'handed-off')
  assert.equal(result.successor.inherited, 'provider-default')
  assert.equal(calls.create[0].agentOptions, undefined)
  assert.equal(result.successor.model, 'unavailable')
})

test('execute：没有调用中的会话 → 明确报错', async () => {
  const { services } = makeServices()
  const execute = makeExecute(services)
  await assert.rejects(execute({ action: 'status' }, {}), /no calling session/)
})

test('apply：ctx.inject 四服务后注册 session_handoff，工具为 JSON-Schema 形状且 render 有界', async () => {
  const injected = []
  const registered = []
  const fakeCtx = {
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    inject: (deps, callback) => {
      injected.push(deps)
      callback(fakeCtx)
    },
  }

  apply(fakeCtx)

  assert.deepEqual(injected, [['tools', 'subagents', 'agents', 'tokenMeter']])
  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'session_handoff')
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.additionalProperties, false)
  assert.deepEqual(tool.parameters.properties.action.enum, ['status', 'handoff'])
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.equal(tool.parameters.properties.spawn.type, 'boolean')
  assert.equal(tool.parameters.properties.threshold_pct.type, 'number')
  assert.equal(typeof tool.execute, 'function')
  assert.ok(tool.description.length > 100)
  assert.match(tool.description, /50%/)

  const rendered = tool.output.render(
    { action: 'status' },
    {
      action: 'status',
      context_pct: 62.5,
      threshold_pct: 50,
      pressure_tokens: 125000,
      context_window: 200000,
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning_effort: 'high',
      successor_available: true,
      successor_kind: 'root',
      recommended_action: 'handoff',
    },
  )
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.ok(rendered[0].text.includes('62.5'))
  assert.ok(rendered[0].text.length <= 400)
})
