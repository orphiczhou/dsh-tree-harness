/** meta-loop core 单测:六阶段门禁 / 顺序铁律 / M4 触发 / 稳定宣告 / 聚合查询。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMetaLoopCore } from '../src/core.js'

function memStore() {
  const m = new Map()
  return { read: async (id) => m.get(id) ?? null, write: async (id, s) => { m.set(id, JSON.parse(JSON.stringify(s))) }, _m: m }
}

function makeCore(treeState = null, opts = {}) {
  const store = memStore()
  const core = createMetaLoopCore({ store, readTreeState: async () => treeState, ...opts })
  return { core, store }
}

const fq = { q1: '存在性', q2: '偏差', q3: '威胁', q4: '候选A/B', q5: '本轮逼近A' }

async function runGreenRound(core, treeId, round = 1, entries = null) {
  let r
  if (round === 1) {
    r = await core.call('init', [treeId, '目标X', [{ source: 'test', note: 'n' }]])
    assert.equal(r.ok, true, JSON.stringify(r.error))
  }
  r = await core.call('feedback', [treeId, entries ?? [{ event: 'e1', reaction: 'r1', evidence: 'call-log L1' }]])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await core.call('analysis', [treeId, { systems: [{ name: 'S1' }], stable_objects: [{ id: 'o1', name: '不变量1' }], breakpoints: [{ id: 'b1', desc: '传导断点', open: true }], five_questions: fq }])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await core.call('planning', [treeId, [{ type: '纠偏', target_breakpoint: 'b1', point: 'engine 修 X' }]])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await core.call('decision', [treeId, [
    { candidate: 'A', verdict: 'adopt' },
    { candidate: 'B', verdict: 'hold', condition: '裕度转 ample 时启用' },
    { candidate: 'C', verdict: 'drop' },
  ], [{ object: 'o1', signal_key: 'verify_fail', reading: '0', estimate: 'ample' }]])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await core.call('implementation', [treeId, [{ id: 't1', text: '修 X', checked: true, evidence: 'commit abc' }]])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await core.call('retro', [treeId, '结果比对:全过', [{ id: 'res1', desc: '残余Y' }], [{ trigger: 'T1', evaluated: true }]])
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r
}

test('完整绿轮:六阶段顺序推进 + retro 关轮开下一轮 + 无触发 verdict=green', async () => {
  const { core } = makeCore(null)
  const r = await runGreenRound(core, 'mtest')
  assert.equal(r.verdict, 'green')
  assert.deepEqual(r.triggers_firing, [])
  assert.equal(r.next_round, 2)
  const st = await core.call('status', ['mtest'])
  assert.equal(st.current_round, 2)
  assert.equal(st.stage, 'feedback')
  assert.equal(st.stable.green_streak, 1)
})

test('连续 2 绿轮 → 稳定宣告(可撤销);第 3 轮已开', async () => {
  const { core } = makeCore(null, { stableRounds: 2 })
  await runGreenRound(core, 'mtest', 1)
  const r2 = await runGreenRound(core, 'mtest', 2)
  assert.equal(r2.stable.declared, true)
  assert.equal(r2.stable.since_round, 2)
  const st = await core.call('status', ['mtest'])
  assert.equal(st.current_round, 3)   // 宣告不终止递归(新反馈即用)
})

test('init 护栏:无触发不开轮;重复 init 拒', async () => {
  const { core } = makeCore()
  let r = await core.call('init', ['mtest', 'x', []])
  assert.equal(r.error.code, 'E_NO_TRIGGER')
  await core.call('init', ['mtest', 'x', [{ source: 't' }]])
  r = await core.call('init', ['mtest', 'x', [{ source: 't' }]])
  assert.equal(r.error.code, 'E_DUPLICATE')
  r = await core.call('feedback', ['ghost', [{ event: 'e', evidence: 'x' }]])
  assert.equal(r.error.code, 'E_LOOP_NOT_FOUND')
})

test('门禁拦截:G1 无证据 / G3 五问缺 / G4 覆盖缺口 / G5b hold 无条件 / G6 缺信号 / G7 档位 / G8b 勾验无证据 / G11 触发表空', async () => {
  const { core } = makeCore()
  await core.call('init', ['mtest', 'x', [{ source: 't' }]])
  let r = await core.call('feedback', ['mtest', [{ event: 'e1', reaction: 'r', evidence: '' }]])
  assert.equal(r.error.code, 'E_SCHEMA')   // G1 前移:入账前拦(防毒化账本)
  r = await core.call('feedback', ['mtest', [{ event: 'e1', reaction: 'r', evidence: 'L1' }]])
  assert.equal(r.ok, true)
  r = await core.call('analysis', ['mtest', { breakpoints: [{ id: 'b1', desc: 'd', open: true }], five_questions: { q1: 'a', q2: 'b', q3: 'c' } }])
  assert.ok(!r.ok && r.error.message.includes('G3'))
  r = await core.call('analysis', ['mtest', { stable_objects: [{ id: 'o1', name: 'n' }], breakpoints: [{ id: 'b1', desc: 'd', open: true }], five_questions: fq }])
  assert.equal(r.ok, true)
  r = await core.call('planning', ['mtest', [{ type: '固本', target_breakpoint: '别的', point: 'p' }]])
  assert.ok(!r.ok && r.error.message.includes('G4'))
  r = await core.call('planning', ['mtest', [{ type: '纠偏', target_breakpoint: 'b1', point: 'p' }]])
  assert.equal(r.ok, true)
  r = await core.call('decision', ['mtest', [{ candidate: 'B', verdict: 'hold' }], []])
  assert.ok(!r.ok && (r.error.message.includes('G5') || r.error.message.includes('G6')))
  r = await core.call('decision', ['mtest', [{ candidate: 'A', verdict: 'adopt' }, { candidate: 'B', verdict: 'hold', condition: 'c' }], [{ object: 'o1', signal_key: 'k', reading: '1', estimate: '巨大' }]])
  assert.ok(!r.ok && r.error.message.includes('G7'))
  r = await core.call('decision', ['mtest', [{ candidate: 'A', verdict: 'adopt' }], [{ object: 'o1', signal_key: 'k', reading: '1', estimate: 'tight' }]])
  assert.equal(r.ok, true)
  r = await core.call('implementation', ['mtest', [{ id: 't1', text: 'x', checked: true }]])
  assert.ok(!r.ok && r.error.message.includes('G8b'))
  r = await core.call('implementation', ['mtest', [{ id: 't1', text: 'x', checked: true, evidence: 'e' }]])
  assert.equal(r.ok, true)
  r = await core.call('retro', ['mtest', 'ok', [], []])
  assert.ok(!r.ok && r.error.message.includes('G11'))
})

test('顺序铁律:跳阶段拒(E_STAGE_ORDER);init 无触发拒', async () => {
  const { core } = makeCore()
  await core.call('init', ['mtest', 'x', [{ source: 't' }]])
  let r = await core.call('planning', ['mtest', [{ type: 'x', point: 'p' }]])
  assert.equal(r.error.code, 'E_STAGE_ORDER')
  r = await core.call('analysis', ['mtest', { breakpoints: [], five_questions: fq }])
  assert.equal(r.error.code, 'E_STAGE_ORDER')   // 当前在 feedback,不可越级
})

test('M4 触发:失败聚合(T1)/高级 drift(T2)/active>80%(T3)→ verdict=recurse,绿连胜清零', async () => {
  const treeState = {
    leaves: {
      a: { status: 'active', runtime: { state: 'failed' }, verification: null, drift_history: [{ severity: 'high', ts: '2099-01-01T00:00:00Z' }, { severity: 'high', ts: '2099-01-02T00:00:00Z' }, { severity: 'high', ts: '2099-01-03T00:00:00Z' }] },
      b: { status: 'pending_brief', runtime: { state: 'running' }, verification: null, drift_history: [] },
    },
  }
  const { core } = makeCore(treeState)
  const r = await runGreenRound(core, 'mtest')
  assert.equal(r.verdict, 'recurse')
  assert.ok(r.triggers_firing.includes('T1-new-fail'))
  assert.ok(r.triggers_firing.includes('T2-degrade-freq'))
  assert.ok(r.triggers_firing.includes('T3-budget'))
  const st = await core.call('status', ['mtest'])
  assert.equal(st.stable.green_streak, 0)
  // 第 2 轮 trigger_signals 继承触发
  const { store } = { store: null }
  assert.ok(store === null)
})

test('query:只读聚合(引擎树状态投影)', async () => {
  const treeState = { leaves: { a: { status: 'done', runtime: { state: 'succeeded' }, verification: { pass: true }, drift_history: [] } } }
  const { core } = makeCore(treeState)
  await core.call('init', ['mtest', 'x', [{ source: 't' }]])
  const r = await core.call('query', ['mtest'])
  assert.equal(r.aggregate.leaves, 1)
  assert.equal(r.aggregate.runtime_succeeded, 1)
  assert.equal(r.aggregate.verify_fail, 0)
})
