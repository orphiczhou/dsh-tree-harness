/** 对抗式验证(adversarial.js)单测:攻防循环 / 修复回注 / 轮数上限 / 裁决落账透传。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdversarial } from '../src/adversarial.js'
import { createVerifier } from '../src/verify.js'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const S1_ = '22222222-2222-4222-8222-222222222222'

test('攻防循环:第 1 轮攻击 FAIL → 修复回注 → 第 2 轮 PASS;findings 透传;record 落账', async () => {
  const verifier = createVerifier({})   // default self-report → structural 恒过
  const fixCalls = [], waits = [], records = []
  let attackCalls = 0
  const adv = createAdversarial({
    verifier,
    attack: async ({ round }) => { attackCalls += 1; return round === 1 ? { pass: false, findings: ['事实错误:宣称零成本'] } : { pass: true, findings: [] } },
    fix: async (o) => { fixCalls.push(o); return true },
    wait: async (ms) => { waits.push(ms) },
    record: async (r) => { records.push(r) },
  })
  const r = await adv.run({ treeId: 't', leafId: 'l', policyId: 'default', cwd: '.', target: { kind: 'doc', text: 'x'.repeat(100) }, fixWaitMs: 5_000 })
  assert.equal(r.pass, true)
  assert.equal(r.policyId, 'default+adversarial')
  assert.equal(r.rounds.length, 2)
  assert.equal(attackCalls, 2)
  assert.deepEqual(fixCalls[0].findings, ['事实错误:宣称零成本'])
  assert.deepEqual(waits, [5_000])
  assert.equal(records.length, 1)
  assert.equal(records[0].rounds.length, 2)
  assert.equal(records[0].rounds[0].fixed, true)
})

test('结构 FAIL:攻击跳过;连续失败耗尽 3 轮 → pass=false 且每轮带结构 findings', async () => {
  const verifier = createVerifier({
    policies: { 'always-fail': { verify: [{ mode: 'artifact', glob: 'no-such-*.md', minSize: 1 }] } },
    ports: { glob: async () => [], readFile: async () => '' },
  })
  const attackCalls = []
  const adv = createAdversarial({
    verifier,
    attack: async (o) => { attackCalls.push(o); return { pass: true, findings: [] } },
    fix: async () => false,   // 修复不可达(执行者已死) → 不等待直接下一轮
    wait: async () => { throw new Error('should not wait when fix undelivered') },
    record: async () => {},
  })
  const r = await adv.run({ treeId: 't', leafId: 'l', policyId: 'always-fail', cwd: '.', target: { kind: 'doc', text: 'x' } })
  assert.equal(r.pass, false)
  assert.equal(r.rounds.length, 3)
  assert.equal(attackCalls.length, 0)   // 结构不过 → 攻击不浪费
  assert.ok(r.verdicts.some((v) => v.mode === 'artifact' && v.pass === false))
})

test('攻击端口抛错 → fail-closed;max_rounds 钳制 1–5;target 函数形态生效', async () => {
  const verifier = createVerifier({})
  const adv = createAdversarial({
    verifier,
    attack: async () => { throw new Error('judge session boom') },
    fix: async () => true,
    wait: async () => {},
    record: async () => {},
    maxRounds: 99,
  })
  const targets = []
  const r = await adv.run({
    treeId: 't', leafId: 'l', policyId: 'default', cwd: '.',
    target: async (round, structural) => { targets.push({ round, pass: structural.pass }); return { kind: 'fn', text: 'y' } },
    fixWaitMs: 0,
  })
  assert.equal(r.pass, false)
  assert.equal(r.rounds.length, 5)   // 钳到 5
  assert.ok(r.rounds.every((x) => x.attack.detail.includes('attack port error')))
  assert.ok(targets.every((t) => t.pass === true))
})

test('engine:leaf:set-verification 透传 rounds(adversarial 裁决落账)', async () => {
  const engine = createEngine({ store: memoryStore(), clock: new VirtualClock(0) })
  await engine.call('init', ['macp2', {}, {}, ROOT])
  await engine.call('leaf:add', ['macp2', { leaf_id: 'macp2-C1-worker', session_id: S1_, parent: 'macp2-root', path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  const result = { policyId: 'doc+adversarial', pass: true, verdicts: [], rounds: [{ round: 1, attack: { pass: false, findings: ['a'] } }, { round: 2, attack: { pass: true, findings: [] } }] }
  const r = await engine.call('leaf:set-verification', ['macp2', 'macp2-C1-worker', result], ROOT)
  assert.equal(r.ok, true)
  const leaf = (await engine.call('leaf:get', ['macp2', 'macp2-C1-worker'])).leaf
  assert.equal(leaf.verification.policy_id, 'doc+adversarial')
  assert.equal(leaf.verification.rounds.length, 2)
})

test('hostGlob（advtx P0 修复回归）:顶层文件命中 **/*.md;返回绝对路径;尾段 ** 递归;子目录命中', async () => {
  const { hostGlob } = await import('../index.js')
  const { promises: fsp } = await import('node:fs')
  const path = await import('node:path')
  const os = await import('node:os')
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'glob-'))
  try {
    await fsp.writeFile(path.join(dir, 'top.md'), 'x')
    await fsp.mkdir(path.join(dir, 'sub'), { recursive: true })
    await fsp.writeFile(path.join(dir, 'sub', 'deep.md'), 'x')
    await fsp.writeFile(path.join(dir, 'sub', 'notes.txt'), 'x')
    // ① **/*.md：顶层 + 子目录都要命中；② 绝对路径
    let r = await hostGlob('**/*.md', dir)
    assert.deepEqual(r.sort(), [path.join(dir, 'sub', 'deep.md'), path.join(dir, 'top.md')].sort())
    assert.ok(r.every((f) => path.isAbsolute(f)))
    // ③ 尾段 **（docs/** 形态）递归收集
    r = await hostGlob('**', dir)
    assert.ok(r.some((f) => f.endsWith('top.md')) && r.some((f) => f.endsWith('notes.txt')))
    // ④ 定字面目录段
    r = await hostGlob('sub/*.md', dir)
    assert.deepEqual(r, [path.join(dir, 'sub', 'deep.md')])
    // ⑤ 空目录不炸
    const empty = await fsp.mkdtemp(path.join(os.tmpdir(), 'globempty-'))
    assert.deepEqual(await hostGlob('**/*.md', empty), [])
  } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}) }
})
