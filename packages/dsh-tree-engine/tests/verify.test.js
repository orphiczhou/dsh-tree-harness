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

test('装载期校验：未知 mode → 报错含键名（不静默回退）', () => {
  assert.throws(
    () => validatePolicies({ 'my-policy': { verify: [{ mode: 'llm-judge', rubric: 'x' }] } }),
    (e) => e.message.includes('my-policy') && e.message.includes('llm-judge'),
  )
  assert.throws(
    () => validatePolicies({ 'cmd-bad': { verify: [{ mode: 'command' }] } }),
    (e) => e.message.includes('cmd-bad') && e.message.includes('run'),
  )
  assert.throws(
    () => validatePolicies({ 'art-bad': { verify: [{ mode: 'artifact' }] } }),
    (e) => e.message.includes('art-bad') && e.message.includes('glob'),
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
