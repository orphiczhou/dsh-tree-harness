/**
 * P1-05 写面护栏回归（docs/audit-tree-system-2026-11-11.md）：统一 assertLeafWriter 写权矩阵。
 *
 * 覆盖矩阵（详见 src/guards.js LEAF_WRITE_MATRIX 注释；A4 起含 delegate 轴）：
 *   context       owner | root              （creator 不得代报水位）
 *   verification  creator | root | delegate （owner 不得自验；delegate=verify_delegates 授权委托，A4）
 *   event:<type>  owner | creator           （done 例外：仅 owner）
 *   cancel        owner | creator | root
 *   status        owner | creator | root    （保持既有语义）
 *   set-session   creator                   （保持既有语义：added_by；root 例外未开）
 *
 * 所有非法写一律 E_BORROWED_IDENTITY + 错误信息含 kind / leaf_id / caller 前 8 字符。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { LEAF_WRITE_MATRIX, assertCallerIs, assertLeafWriter } from '../src/guards.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'      // commander：worker 的 creator（added_by）
const OWNER = '33333333-3333-4333-8333-333333333333'    // worker 的 owner（leaf.session_id）
const STRANGER = '44444444-4444-4444-8444-444444444444'
const NEW_SESSION = '55555555-5555-4555-8555-555555555555'

const TREE = 'wguard'
const WORKER = 'wguard-C2a-worker'
const COMMANDER = 'wguard-C2-commander'

/** 树形：root(ROOT) → commander(CMD, added_by=ROOT) → worker(OWNER, added_by=CMD)。 */
async function seeded({ ports } = {}) {
  const store = memoryStore()
  const clock = new VirtualClock(1_700_000_000_000)
  const engine = createEngine({ store, clock, config: { max_sessions: 10, node_budget: 10 }, ports })
  await engine.call('init', [TREE, { goal: 'g' }, { dod: 'd' }, ROOT])
  await engine.call('leaf:add', [TREE, { leaf_id: COMMANDER, session_id: CMD, parent: `${TREE}-root`, path: 'C2', role: 'commander', added_by: ROOT }], ROOT)
  await engine.call('leaf:add', [TREE, { leaf_id: WORKER, session_id: OWNER, parent: COMMANDER, path: 'C2a', role: 'worker', added_by: CMD }], CMD)
  return { engine, store, clock }
}

/** 断言 E_BORROWED_IDENTITY 且错误信息带定位片段（kind / leaf / caller 前 8 字符）。 */
function expectBorrowed(r, { kind, leaf = WORKER, caller }) {
  assert.equal(r.ok, false, `expected rejection, got ${JSON.stringify(r).slice(0, 300)}`)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY', JSON.stringify(r.error))
  if (kind) assert.ok(r.error.message.includes(kind), `message must name kind "${kind}": ${r.error.message}`)
  if (leaf) assert.ok(r.error.message.includes(leaf), `message must name leaf "${leaf}": ${r.error.message}`)
  if (caller) assert.ok(r.error.message.includes(caller.slice(0, 8)), `message must name caller prefix: ${r.error.message}`)
}

// ── context：owner / root 放行；creator 不得代报；陌生人 + 缺失 caller 拒 ──
test('set-context：owner/root 通过；creator 不得代报；陌生人/缺失 caller → E_BORROWED_IDENTITY', async () => {
  const { engine } = await seeded()
  let r = await engine.call('leaf:set-context', [TREE, WORKER, 10], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.leaf.context_usage_pct, 10)
  r = await engine.call('leaf:set-context', [TREE, WORKER, 11], ROOT)   // root 信任锚
  assert.equal(r.ok, true, JSON.stringify(r.error))
  expectBorrowed(await engine.call('leaf:set-context', [TREE, WORKER, 12], CMD), { kind: 'context', caller: CMD })
  expectBorrowed(await engine.call('leaf:set-context', [TREE, WORKER, 13], STRANGER), { kind: 'context', caller: STRANGER })
  expectBorrowed(await engine.call('leaf:set-context', [TREE, WORKER, 14]), { kind: 'context' })   // caller 提取失败 → fail-closed
})

// ── verification：creator / root 放行；owner 不得自验；陌生人拒 ──
test('set-verification：creator/root 通过；owner 自验拒；陌生人拒；非法载荷仍走 schema 校验', async () => {
  const { engine } = await seeded()
  const result = { policyId: 'self-report', pass: true, verdicts: [{ mode: 'self-report', pass: true }] }
  let r = await engine.call('leaf:set-verification', [TREE, WORKER, result], CMD)   // creator 验 owner
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.leaf.verification.pass, true)
  r = await engine.call('leaf:set-verification', [TREE, WORKER, result], ROOT)      // root
  assert.equal(r.ok, true, JSON.stringify(r.error))
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, result], OWNER), { kind: 'verification', caller: OWNER })  // owner 不得自验
  expectBorrowed(await engine.call('leaf:set-verification', [TREE, WORKER, result], STRANGER), { kind: 'verification', caller: STRANGER })
  // 合法 caller + 非法载荷：不被写权错误掩盖
  r = await engine.call('leaf:set-verification', [TREE, WORKER, { pass: 'yes' }], CMD)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
})

// ── event：非 done owner/creator 放行；done 仍仅 owner ──
test('event:append：非 done 事件 owner/creator 通过、陌生人拒；done 仍仅 owner（回归）', async () => {
  const { engine } = await seeded()
  let r = await engine.call('event:append', [TREE, WORKER, 'progress', { m: 1 }], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await engine.call('event:append', [TREE, WORKER, 'plan', { steps: ['a'] }], CMD)   // creator 可补报非 done
  assert.equal(r.ok, true, JSON.stringify(r.error))
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'blocked', { reason: 'x' }], STRANGER), { kind: 'event:blocked', caller: STRANGER })
  // done 仅 owner：creator/root/陌生人都不能代写（V10-trust-anchor-fix 不被本次统一矩阵放宽）
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'done', {}], CMD), { kind: 'event:done', caller: CMD })
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'done', {}], ROOT), { kind: 'event:done', caller: ROOT })
  expectBorrowed(await engine.call('event:append', [TREE, WORKER, 'done', {}], STRANGER), { kind: 'event:done', caller: STRANGER })
  r = await engine.call('event:append', [TREE, WORKER, 'done', { self_check: [] }], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
})

// ── cancel：owner / creator / root 放行；陌生人拒且不改变 running 状态 ──
test('dispatch:cancel：owner/creator/root 通过；陌生人拒（running 不被越权取消）', async () => {
  let n = 0
  const { engine } = await seeded({ ports: { dispatch: async () => ({ sessionId: `sess-cancel-${++n}` }), interrupt: async () => {} } })
  let r = await engine.call('dispatch:start', [TREE, WORKER, { prompt: 'p' }], CMD)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const ownerSession = r.node.session_id
  // 陌生人越权取消 running → 拒，且节点仍在 running（未被取消）
  expectBorrowed(await engine.call('dispatch:cancel', [TREE, WORKER], STRANGER), { kind: 'cancel', caller: STRANGER })
  let leaf = (await engine.call('leaf:get', [TREE, WORKER])).leaf
  assert.equal(leaf.runtime.state, 'running')
  // owner 止血 → cancelled
  r = await engine.call('dispatch:cancel', [TREE, WORKER], ownerSession)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.node.state, 'cancelled')
  // 重派后 creator 止血 → cancelled
  r = await engine.call('dispatch:start', [TREE, WORKER, { prompt: 'p2' }], CMD)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await engine.call('dispatch:cancel', [TREE, WORKER], CMD)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.node.state, 'cancelled')
  // 再重派后 root 止血 → cancelled
  r = await engine.call('dispatch:start', [TREE, WORKER, { prompt: 'p3' }], CMD)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await engine.call('dispatch:cancel', [TREE, WORKER], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
})

// ── 回归：status 保持 owner/creator/root 既有语义 ──
test('回归 set-status：owner/creator/root 放行；陌生人拒（现有语义不变）', async () => {
  const { engine } = await seeded()
  let r = await engine.call('leaf:set-status', [TREE, WORKER, 'active'], OWNER)   // owner：pending_brief → active
  assert.equal(r.ok, true, JSON.stringify(r.error))
  expectBorrowed(await engine.call('leaf:set-status', [TREE, WORKER, 'pruned'], STRANGER), { kind: 'status', caller: STRANGER })
  r = await engine.call('leaf:set-status', [TREE, WORKER, 'segment_pending'], CMD)   // creator
  assert.equal(r.ok, true, JSON.stringify(r.error))
  r = await engine.call('leaf:set-status', [TREE, WORKER, 'active'], ROOT)           // root
  assert.equal(r.ok, true, JSON.stringify(r.error))
})

// ── 回归：set-session 保持仅 creator（added_by）语义，root 例外未开 ──
test('回归 set-session：仅 creator 可重绑；owner/陌生人/root 均拒（现有语义不变）', async () => {
  const { engine } = await seeded()
  expectBorrowed(await engine.call('leaf:set-session', [TREE, WORKER, NEW_SESSION], OWNER), { kind: 'set-session', caller: OWNER })
  expectBorrowed(await engine.call('leaf:set-session', [TREE, WORKER, NEW_SESSION], STRANGER), { kind: 'set-session', caller: STRANGER })
  expectBorrowed(await engine.call('leaf:set-session', [TREE, WORKER, NEW_SESSION], ROOT), { kind: 'set-session', caller: ROOT })
  const r = await engine.call('leaf:set-session', [TREE, WORKER, NEW_SESSION], CMD)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal((await engine.call('leaf:get', [TREE, WORKER])).leaf.session_id, NEW_SESSION)
})

// ── 只读路径不受影响：list/get/status/log 无 caller 也不新增拒绝 ──
test('只读路径不新增拒绝：leaf get/list、event/drift/heartbeat/communication 查询、treeDump/validate', async () => {
  const { engine } = await seeded()
  const reads = [
    ['leaf:get', [TREE, WORKER]],
    ['leaf:list-active', [TREE]],
    ['leaf:list-all', [TREE]],
    ['event:list', [TREE, WORKER]],
    ['drift:list', [TREE]],
    ['heartbeat:tail', [TREE, 5]],
    ['communication:list', [TREE]],
    ['validate', [TREE]],
    ['treeDump', [TREE]],
  ]
  for (const [cmd, argv] of reads) {
    const r = await engine.call(cmd, argv)   // 不带 caller
    assert.equal(r.ok, true, `${cmd} must stay readable without caller: ${JSON.stringify(r.error)}`)
  }
})

// ── 单元级：矩阵快照 / root 派生 / 未知 kind fail-closed / 旧 assertCallerIs fail-closed ──
test('assertLeafWriter 单元：矩阵快照 + root 派生 + 未知 kind fail-closed；assertCallerIs 缺失 caller 不再放行', () => {
  const leaf = { leaf_id: WORKER, session_id: OWNER, added_by: CMD }
  const state = { tree_id: TREE, leaves: { [`${TREE}-root`]: { session_id: ROOT } } }
  // 矩阵契约快照（防实现与文档漂移；A4 起含 delegate 轴——仅 verification=true，其余一律 false）
  assert.deepEqual(LEAF_WRITE_MATRIX, {
    context: { owner: true, creator: false, root: true, delegate: false },
    verification: { owner: false, creator: true, root: true, delegate: true },
    event: { owner: true, creator: true, root: false, delegate: false },
    'event:done': { owner: true, creator: false, root: false, delegate: false },
    // flash 审计 #22：spawn 预算事件仅 owner（防 creator/root 注入耗尽他人预算）
    'event:subagent_spawn': { owner: true, creator: false, root: false, delegate: false },
    cancel: { owner: true, creator: true, root: true, delegate: false },
    status: { owner: true, creator: true, root: true, delegate: false },
    'set-session': { owner: false, creator: true, root: false, delegate: false },
    relay: { owner: false, creator: true, root: true, delegate: false },
  })
  // root 由 state.tree_id 派生（省略第 5 参也可）
  assert.equal(assertLeafWriter(state, leaf, ROOT, 'context'), true)
  assert.equal(assertLeafWriter(state, leaf, CMD, 'verification'), true)
  // owner 不得自验 / creator 不得代报水位
  assert.throws(() => assertLeafWriter(state, leaf, OWNER, 'verification'), (e) => e.code === 'E_BORROWED_IDENTITY')
  assert.throws(() => assertLeafWriter(state, leaf, CMD, 'context'), (e) => e.code === 'E_BORROWED_IDENTITY')
  // 未知 kind 不得静默放行
  assert.throws(() => assertLeafWriter(state, leaf, OWNER, 'drift:append'), (e) => e.code === 'E_INTERNAL')
  // P1-05 附带：caller 提取失败（undefined/空串）必须 fail-closed
  assert.throws(() => assertCallerIs(undefined, undefined, 'leaf_add'), (e) => e.code === 'E_BORROWED_IDENTITY')
  assert.throws(() => assertCallerIs('', '', 'leaf_add'), (e) => e.code === 'E_BORROWED_IDENTITY')
})
