/**
 * validate 不变式回归（v0.8.0 收口 F1 + 工具层 F2）。
 *
 * F1（v0.7.0 W2.1 存量）：竹节 relay 的合法形态是「当前执行者 session_id 同时出现在本 leaf 的
 * runtime.segmentChain 里」（relay 先 push 新会话，再把它绑成 leaf.session_id）；旧 validate 先记
 * session_id 再遍历 chain → 每个接力过的 leaf 必报 `session_duplicate` 假阳性（E2E：rly8b/rly8c/s1rl1）。
 * 修复口径：每个 leaf 的每个会话集合允许「自己的当前 session_id」出现一次；同 id 在自有 chain 里
 * 重复、或跨 leaf 复用，仍是真重复。
 *
 * F2：`tree_status{action:"validate"}` 对 `{ok:false, issues}`（无 error 对象）走 `toError(r)` →
 * `TypeError: Cannot read properties of undefined (reading 'code')`，issues 不可见。修复后由
 * queryResultToTool 原样返回 issues，render 展示前几条 issue。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { TOOLS, queryResultToTool } from '../index.js'

const TREE = 'v8val'
const LEAF = 'v8val-C1-worker'
const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'
const OWNER = '33333333-3333-4333-8333-333333333333'
const OWNER2 = '44444444-4444-4444-8444-444444444444'

/** 严格 UUID v4 夹具（dispatch/segment 校验用）。 */
let seq = 0
function nextUuid() {
  seq += 1
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`
}

/** 假编排端口：dispatch 返回严格 UUID（segment:append 等路径需要）。 */
function fakePorts() {
  return {
    async dispatch() { return { sessionId: nextUuid() } },
    async interrupt() {},
    async promptHandoff() { return 'BRIEF: K1…/K2无/K5…' },
    async lastOutputAt() { return 1000 },
    async usagePct() { return 45 },
  }
}

async function setup(orchestra = {}) {
  const store = memoryStore()
  const clock = new VirtualClock(1000)
  const engine = createEngine({ store, clock, ports: fakePorts(), orchestra: { nodeTimeoutMs: 10 ** 9, sweepIntervalMs: 60_000, bambooThresholdPct: 42, ...orchestra } })
  await engine.call('init', [TREE, { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', [TREE, { leaf_id: LEAF, session_id: OWNER, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: CMD }], CMD)
  return { store, engine }
}

/** 触发一次竹节 relay（dispatch → sweep；usagePct=45 ≥ 42）。 */
async function dispatchAndRelay(engine, leafId = LEAF) {
  await engine.call('dispatch:start', [TREE, leafId, {}], OWNER)
  const r = await engine.sweepTick()
  assert.equal(r.swept[0].events[0]?.event, 'bamboo', JSON.stringify(r.swept[0].events))
  return (await engine.call('leaf:get', [TREE, leafId])).leaf
}

// ── F1：合法竹节形态（PASS）────────────────────────────────

test('F1 竹节 relay 后的树 validate PASS（当前 session_id 合法出现在自己的 runtime.segmentChain）', async () => {
  const { engine } = await setup()
  const leaf = await dispatchAndRelay(engine)
  assert.equal(leaf.runtime.segmentChain.length, 1)
  assert.equal(leaf.session_id, leaf.runtime.segmentChain[0], 'relay 后 owner = 最新接力会话（合法共享形态）')

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, true, JSON.stringify(r.issues))
  assert.deepEqual(r.issues, [])
})

test('F1 连续两次竹节 relay（链 [S2,S3]，owner=S3）仍 validate PASS', async () => {
  const { engine } = await setup()
  await dispatchAndRelay(engine)
  const leaf = await dispatchAndRelay(engine)   // 第二次 sweep：usagePct 仍 45
  assert.equal(leaf.runtime.segmentChain.length, 2)
  assert.equal(leaf.session_id, leaf.runtime.segmentChain[1])

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, true, JSON.stringify(r.issues))
  assert.deepEqual(r.issues, [])
})

test('F1 segment_chain 里出现当前 session_id 一次 → validate PASS（手动 segment 通道同口径）', async () => {
  const { engine } = await setup()
  const d = await engine.call('dispatch:start', [TREE, LEAF, {}], OWNER)
  const current = d.node.session_id
  const seg = await engine.call('segment:append', [TREE, LEAF, current])
  assert.equal(seg.ok, true, JSON.stringify(seg.error))

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, true, JSON.stringify(r.issues))
})

// ── F1：真重复仍 FAIL ─────────────────────────────────────

test('F1 真重复①：同一 id 在自己的 runtime.segmentChain 里出现两次 → validate FAIL', async () => {
  const { store, engine } = await setup()
  const leaf = await dispatchAndRelay(engine)
  const state = await store.read(TREE)
  state.leaves[LEAF].runtime.segmentChain.push(leaf.session_id)   // 合法的一次 + 真重复的第二次
  await store.write(TREE, state)

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, false)
  const dup = r.issues.find((i) => i.type === 'session_duplicate' && i.leaf_id === LEAF)
  assert.ok(dup, JSON.stringify(r.issues))
  assert.match(dup.detail, /runtime\.segmentChain duplicates/)
})

test('F1 真重复②：跨 leaf 复用同一会话 id → validate FAIL（接力会话不得被别的 leaf 认领）', async () => {
  const { store, engine } = await setup()
  const leaf = await dispatchAndRelay(engine)
  await engine.call('leaf:add', [TREE, { leaf_id: 'v8val-C2-worker', session_id: OWNER2, parent: `${TREE}-root`, path: 'C2', role: 'worker', added_by: CMD }], CMD)
  const state = await store.read(TREE)
  state.leaves['v8val-C2-worker'].session_id = leaf.session_id   // 跨 leaf 复用
  await store.write(TREE, state)

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, false)
  const dup = r.issues.find((i) => i.type === 'session_duplicate' && i.leaf_id === 'v8val-C2-worker')
  assert.ok(dup, JSON.stringify(r.issues))
  assert.match(dup.detail, new RegExp(`duplicates ${LEAF}`))
})

test('F1 真重复③：同一 leaf 的 session_id 与 segment_chain 中的旧 id 冲突（当前 id 出现在两个自身集合也只豁免一次）', async () => {
  const { store, engine } = await setup()
  const d = await engine.call('dispatch:start', [TREE, LEAF, {}], OWNER)
  const current = d.node.session_id
  const state = await store.read(TREE)
  state.leaves[LEAF].segment_chain.push(current)                // 集合 1
  state.leaves[LEAF].runtime.segmentChain.push(current)         // 集合 2（同名但另一集合 → 不再豁免）
  await store.write(TREE, state)

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.type === 'session_duplicate'), JSON.stringify(r.issues))
})

// ── F2：工具层不再 TypeError，issues 可读 ─────────────────

test('F2 引擎真 issues 结果经 queryResultToTool 原样返回（旧实现此处读 r.error.code → TypeError）', async () => {
  const { store, engine } = await setup()
  const state = await store.read(TREE)
  state.leaves[LEAF].runtime = { state: 'running', subagentSessionId: OWNER, segmentChain: [OWNER, OWNER], history: [] }
  state.leaves[LEAF].session_id = OWNER
  await store.write(TREE, state)

  const r = await engine.call('validate', [TREE])
  assert.equal(r.ok, false)
  assert.equal(r.error, undefined, 'validate 的失败形态是 issues，不是 error 对象')
  assert.ok(r.issues.length > 0)

  let toolResult
  assert.doesNotThrow(() => { toolResult = queryResultToTool(r, 'timer') })
  assert.equal(toolResult.ok, false)
  assert.deepEqual(toolResult.issues, r.issues)
  assert.equal(toolResult.sweepMode, 'timer')
})

test('F2 queryResultToTool：error 形态仍 fail-closed 抛错；成功结果透传', () => {
  assert.throws(
    () => queryResultToTool({ ok: false, error: { code: 'E_TREE_NOT_FOUND', message: 'tree missing' } }, 'timer'),
    (e) => e.code === 'E_TREE_NOT_FOUND' && /tree missing/.test(e.message),
  )
  assert.deepEqual(queryResultToTool({ ok: true, issues: [] }, 'idle'), { ok: true, issues: [], sweepMode: 'idle' })
})

test('F2 tree_status validate render：FAIL 时展示 issues 摘要，不再被 TypeError 掩盖', () => {
  const tool = TOOLS.find((t) => t.name === 'tree_status')
  assert.ok(tool)
  const rendered = tool.output.render(undefined, {
    ok: false,
    sweepMode: 'timer',
    issues: [
      { type: 'session_duplicate', leaf_id: LEAF, detail: 'runtime.segmentChain duplicates x' },
      { type: 'parent_missing', leaf_id: 'v8val-C3-worker', detail: 'parent not found' },
    ],
  })
  const text = rendered.map((x) => x.text).join('\n')
  assert.match(text, /validate FAIL \(2 issues/)
  assert.match(text, new RegExp(`session_duplicate@${LEAF}`))
  assert.match(text, /parent_missing@v8val-C3-worker/)
})
