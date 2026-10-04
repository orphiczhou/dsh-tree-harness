/** S1 第三批单测：验证策略层第一批（self-report/artifact/command）+ DoD 前置注入。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerifier, validatePolicies, DEFAULT_POLICIES } from '../src/verify.js'

function fakeFsPorts(files) {
  return {
    async glob(pattern) {
      // 简化 glob：去掉通配符做包含匹配（测试可控）
      const needle = pattern.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^\//, '')
      return Object.keys(files).filter((f) => (needle ? f.includes(needle) : true))
    },
    async readFile(p) { return files[p] ?? '' },
  }
}

test('装载期校验：未知 mode → 报错含键名（不静默回退）；llm-judge 缺 rubric 同拦', () => {
  assert.throws(
    () => validatePolicies({ 'my-policy': { verify: [{ mode: 'vibes' }] } }),
    (e) => e.message.includes('my-policy') && e.message.includes('vibes'),
  )
  assert.throws(
    () => validatePolicies({ 'judge-bad': { verify: [{ mode: 'llm-judge' }] } }),
    (e) => e.message.includes('judge-bad') && e.message.includes('rubric'),
  )
  assert.doesNotThrow(() => validatePolicies({ 'judge-ok': { verify: [{ mode: 'llm-judge', rubric: 'r' }] } }))
  assert.throws(
    () => validatePolicies({ 'cmd-bad': { verify: [{ mode: 'command' }] } }),
    (e) => e.message.includes('cmd-bad') && e.message.includes('run'),
  )
  assert.throws(
    () => validatePolicies({ 'art-bad': { verify: [{ mode: 'artifact' }] } }),
    (e) => e.message.includes('art-bad') && e.message.includes('glob'),
  )
  assert.throws(
    () => validatePolicies({ 'comp-bad': { verify: [{ mode: 'composite' }] } }),
    (e) => e.message.includes('comp-bad') && e.message.includes('checks'),
  )
  assert.doesNotThrow(() => validatePolicies(DEFAULT_POLICIES))
})

test('self-report：自述即过（缺省兜底）', async () => {
  const v = createVerifier({})
  const r = await v.runVerifications('default', { cwd: '.' })
  assert.equal(r.pass, true)
  assert.equal(r.verdicts[0].mode, 'self-report')
})

test('artifact：产物缺失 → fail；形状不符（minSize/regex/jsonSchema）→ fail', async () => {
  const v = createVerifier({ ports: fakeFsPorts({}) })
  let r = await v.runVerifications('artifact-doc', { cwd: '/ws' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('no artifact'))

  const v2 = createVerifier({ ports: fakeFsPorts({ 'docs/x.md': 'short' }) })
  r = await v2.runVerifications('artifact-doc', { cwd: '/ws' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('minSize'))

  const v3 = createVerifier({
    policies: { 'json-out': { verify: [{ mode: 'artifact', glob: '**/*.json', jsonSchema: { type: 'object', required: ['result'] } }] } },
    ports: fakeFsPorts({ 'out/result.json': '{"foo":1}' }),
  })
  r = await v3.runVerifications('json-out', { cwd: '/ws' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('missing required "result"'))
})

test('command：退出码非 0 → fail；超时 → fail（=verdict fail）；stdoutRegex 判定', async () => {
  const mk = (impl) => createVerifier({
    policies: { 'code-change': { verify: [{ mode: 'command', run: 'pnpm test', timeoutMs: 1000 }] } },
    ports: { exec: impl },
  })
  let r = await mk(async () => ({ code: 1, stdout: '', stderr: '2 failing tests' })).runVerifications('code-change', { cwd: '/ws' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('exit=1'))

  r = await mk(async () => { const e = new Error('TIMEOUT after 1000ms'); throw e }).runVerifications('code-change', { cwd: '/ws' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('timeout'))

  r = await mk(async () => ({ code: 0, stdout: 'all green\n10 passed', stderr: '' })).runVerifications('code-change', { cwd: '/ws' })
  assert.equal(r.pass, true)
})

test('AND 短路：第一个 fail 即停（失败链保留已跑 verdicts）', async () => {
  const v = createVerifier({
    policies: { 'two-step': { verify: [{ mode: 'command', run: 'a' }, { mode: 'command', run: 'b' }] } },
    ports: { exec: async (cmd) => (cmd === 'a' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' }) },
  })
  const r = await v.runVerifications('two-step', { cwd: '.' })
  assert.equal(r.pass, false)
  assert.equal(r.verdicts.length, 1)   // 短路：b 未跑
})

test('DoD 前置注入：dodPrompt 含策略全部条目（字符串断言——§9 派发提示词断言的生成侧）', async () => {
  const v = createVerifier({})
  const text = v.dodPrompt('code-change')
  assert.ok(text.includes('[DoD 验收标准'))
  assert.ok(text.includes('退出码 0'))
  // taskType 解析：code-change 任务类型 → 同名策略
  assert.equal(v.policyFor('code-change'), v.policyFor(v.taskTypeMap['code-change']))
})

test('端口未装配：artifact/command fail-closed（pass=false 且 detail 指明缺哪个端口）', async () => {
  const v = createVerifier({})
  let r = await v.runVerifications('artifact-doc', { cwd: '.' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('ports not wired'))
  r = await v.runVerifications('code-change', { cwd: '.' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('exec'))
})

// ── batch-2：llm-judge / composite / human ──────────────
test('llm-judge：judge 端口裁决透传；未装配 fail-closed；非法返回形状 fail', async () => {
  let v = createVerifier({ policies: { 'judge-x': { verify: [{ mode: 'llm-judge', rubric: '结论含出处' }] } } })
  let r = await v.runVerifications('judge-x', { cwd: '.' })   // 未装配 judge 端口
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('judge'))
  v = createVerifier({ policies: { 'judge-x': { verify: [{ mode: 'llm-judge', rubric: '结论含出处' }] } }, ports: { judge: async () => ({ pass: true, score: 0.9 }) } })
  r = await v.runVerifications('judge-x', { cwd: '.' })
  assert.equal(r.pass, true)
  assert.match(r.verdicts[0].detail, /0\.9/)
  v = createVerifier({ policies: { 'judge-x': { verify: [{ mode: 'llm-judge', rubric: 'r' }] } }, ports: { judge: async () => ({ oops: 1 }) } })
  r = await v.runVerifications('judge-x', { cwd: '.' })
  assert.equal(r.pass, false)
  assert.ok(r.verdicts[0].detail.includes('invalid shape'))
})

test('human：approval=never 降级 = frozen 待裁（pass=false + pending=true）；复合策略 AND 短路展开', async () => {
  const v = createVerifier({
    policies: {
      'human-gate': { verify: [{ mode: 'human' }], onFail: 'frozen' },
      'comp': { verify: [{ mode: 'composite', checks: [{ mode: 'self-report' }, { mode: 'human' }] }], onFail: 'frozen' },
    },
  })
  let r = await v.runVerifications('human-gate', { cwd: '.' })
  assert.equal(r.pass, false)
  assert.equal(r.verdicts[0].pending, true)
  assert.ok(r.verdicts[0].detail.includes('approval=never'))
  // composite 展开：self-report 过 → human 冻结待裁 → 短路
  r = await v.runVerifications('comp', { cwd: '.' })
  assert.equal(r.verdicts.length, 2)
  assert.deepEqual(r.verdicts.map((x) => x.mode), ['self-report', 'human'])
  assert.equal(r.pass, false)
})

// ── Config 装载期校验（§7 任务 8）──────────────────────
test('validateConfig：未知键/类型/范围 违规报错含键名；合法原样通过', async () => {
  const { validateConfig, configFromEnv } = await import('../src/config.js')
  assert.throws(() => validateConfig({ node_budgt: 5 }), (e) => e.message.includes('node_budgt') && e.message.includes('unknown'))
  assert.throws(() => validateConfig({ node_budget: '20' }), (e) => e.message.includes('node_budget') && e.message.includes('integer'))
  assert.throws(() => validateConfig({ ctx_segment_threshold: 0 }), (e) => e.message.includes('ctx_segment_threshold') && e.message.includes('range'))
  assert.throws(() => validateConfig({ commander_max_depth: 9 }), (e) => e.message.includes('commander_max_depth'))
  assert.deepEqual(validateConfig({ node_budget: 30, graceMs: 5000 }), { node_budget: 30, graceMs: 5000 })
  // 环境入口拆分：护栏键进 config、编排键进 orchestra
  const split = configFromEnv({ TREE_ENGINE_CONFIG: '{"node_budget":30,"sweepIntervalMs":60000}' })
  assert.deepEqual(split, { config: { node_budget: 30 }, orchestra: { sweepIntervalMs: 60000 } })
  assert.throws(() => configFromEnv({ TREE_ENGINE_CONFIG: '{"bogus":1}' }), (e) => e.message.includes('bogus'))
  assert.deepEqual(configFromEnv({}), { config: {}, orchestra: {} })
})
