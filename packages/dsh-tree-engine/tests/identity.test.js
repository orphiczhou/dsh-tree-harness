/**
 * W2.6（2026-11-12）root 会话 id 兼容单测。
 *
 * 背景：DSH 根/主会话的 DSH_SESSION_ID 带 `session-` 前缀（本机实测
 * `session-ae8a7881-...`），而 dispatch 返回的 subagent childId 是裸 UUID。
 * 修复前：tree_plan 传真实 $env:DSH_SESSION_ID → E_INVALID_UUID_STRICT；
 *         root 写面（信任锚）比较 caller 与裸 UUID root.session_id 永不相等 → 权限退化。
 * 修复后：写入侧归一化存储、比较侧归一化比较（历史 state 里带前缀的旧值也兼容）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import {
  normalizeSessionId, isNormalizedStrictUuidV4, sameSession, assertLeafWriter,
} from '../src/guards.js'

const ROOT_BARE = '11111111-1111-4111-8111-111111111111'
const ROOT_PREFIXED = `session-${ROOT_BARE}`
const S1_BARE = '22222222-2222-4222-8222-222222222222'
const S1_PREFIXED = `session-${S1_BARE}`
const S2_BARE = '33333333-3333-4333-8333-333333333333'
const S2_PREFIXED = `session-${S2_BARE}`
const S3_BARE = '44444444-4444-4444-8444-444444444444'
const STRANGER = 'session-99999999-9999-4999-8999-999999999999'

async function newEngine(over = {}) {
  const clock = new VirtualClock(1_700_000_000_000)
  const store = memoryStore()
  const engine = createEngine({ store, clock, config: { max_sessions: 8, node_budget: 6, ...over } })
  return { engine, clock, store }
}

/** root 用真实（带前缀）形态 init，再建一个 worker（owner=裸 UUID）。 */
async function seededPrefixRoot(over) {
  const ctx = await newEngine(over)
  await ctx.engine.call('init', ['w26id', { goal: 'x' }, { dod: 'y' }, ROOT_PREFIXED])
  await ctx.engine.call('leaf:add', ['w26id', {
    leaf_id: 'w26id-C1-worker', session_id: S1_BARE, parent: 'w26id-root', path: 'C1', role: 'worker', added_by: ROOT_PREFIXED,
  }], ROOT_PREFIXED)
  return ctx
}

// ── 归一化基础函数 ─────────────────────────────────────────────
test('normalizeSessionId / isNormalizedStrictUuidV4 / sameSession：前缀与裸 UUID 视为同一会话', () => {
  assert.equal(normalizeSessionId(ROOT_PREFIXED), ROOT_BARE)
  assert.equal(normalizeSessionId(ROOT_BARE), ROOT_BARE)
  assert.equal(normalizeSessionId(`  ${ROOT_PREFIXED}  `), ROOT_BARE)
  // UUID 大小写不敏感：归一化统一折小写（否则同一会话大小写形态去重失败）
  assert.equal(normalizeSessionId(ROOT_PREFIXED.toUpperCase()), ROOT_BARE)
  assert.equal(normalizeSessionId(ROOT_BARE.toUpperCase()), ROOT_BARE)
  assert.ok(sameSession(ROOT_PREFIXED.toUpperCase(), ROOT_BARE))
  assert.ok(sameSession(ROOT_BARE.toUpperCase(), ROOT_BARE))
  assert.equal(normalizeSessionId(null), null)
  assert.equal(normalizeSessionId(42), 42)
  assert.ok(isNormalizedStrictUuidV4(ROOT_PREFIXED))
  assert.ok(isNormalizedStrictUuidV4(ROOT_BARE))
  assert.ok(!isNormalizedStrictUuidV4('session-not-a-uuid'))
  assert.ok(!isNormalizedStrictUuidV4(''))
  assert.ok(sameSession(ROOT_PREFIXED, ROOT_BARE))
  assert.ok(sameSession(ROOT_PREFIXED, ROOT_PREFIXED))
  assert.ok(!sameSession(ROOT_PREFIXED, S1_BARE))
  assert.ok(!sameSession(undefined, undefined))   // fail-closed：都不存在不算匹配
  assert.ok(!sameSession('', ''))
})

// ── init / root 信任锚 ────────────────────────────────────────
test('init：root session_id 传带 session- 前缀 → 成功且归一化存储（修复前 E_INVALID_UUID_STRICT）', async () => {
  const { engine } = await newEngine()
  const r = await engine.call('init', ['w26id', { goal: 'x' }, { dod: 'y' }, ROOT_PREFIXED])
  assert.equal(r.ok, true, JSON.stringify(r))
  const dump = await engine.call('treeDump', ['w26id'])
  assert.equal(dump.tree.leaves['w26id-root'].session_id, ROOT_BARE)   // 规范形 = 裸 UUID
})

test('init：非法 session_id 仍严格拒绝（不因前缀放宽 UUID v4）', async () => {
  const { engine } = await newEngine()
  const bad1 = await engine.call('init', ['w26id', {}, {}, 'session-not-a-uuid'])
  assert.equal(bad1.error.code, 'E_INVALID_UUID_STRICT')
  const bad2 = await engine.call('init', ['w26id', {}, {}, '11111111-1111-1111-8111-111111111111'])
  assert.equal(bad2.error.code, 'E_INVALID_UUID_STRICT')
})

test('root 信任锚：带前缀 root caller 可对 worker 走 status/verification 写权；陌生前缀会话仍拒', async () => {
  const { engine } = await seededPrefixRoot()
  // root（带前缀）→ worker 的 status / verification 均允许（root 角色）
  let r = await engine.call('leaf:set-status', ['w26id', 'w26id-C1-worker', 'active'], ROOT_PREFIXED)
  assert.equal(r.ok, true, JSON.stringify(r))
  r = await engine.call('leaf:set-verification', ['w26id', 'w26id-C1-worker', { pass: true, policyId: 'self-report' }], ROOT_PREFIXED)
  assert.equal(r.ok, true, JSON.stringify(r))
  // 陌生人（同样带前缀）→ 仍 fail-closed
  r = await engine.call('leaf:set-status', ['w26id', 'w26id-C1-worker', 'active'], STRANGER)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY')
})

// ── leaf:add 身份/创建者归一化 ────────────────────────────────
test('leaf:add：added_by 与 caller 可分别为「前缀/裸」混合形态；存储归一化', async () => {
  const { engine } = await seededPrefixRoot()
  // caller 带前缀 + added_by 裸 UUID → 归一化后相同，允许
  let r = await engine.call('leaf:add', ['w26id', {
    leaf_id: 'w26id-C2-worker', session_id: S2_BARE, parent: 'w26id-root', path: 'C2', role: 'worker', added_by: ROOT_BARE,
  }], ROOT_PREFIXED)
  assert.equal(r.ok, true, JSON.stringify(r))
  // caller 裸 + added_by 带前缀 → 同允许
  r = await engine.call('leaf:add', ['w26id', {
    leaf_id: 'w26id-C3-worker', session_id: S3_BARE, parent: 'w26id-root', path: 'C3', role: 'worker', added_by: ROOT_PREFIXED,
  }], ROOT_BARE)
  assert.equal(r.ok, true, JSON.stringify(r))
  const g = await engine.call('leaf:get', ['w26id', 'w26id-C2-worker'])
  assert.equal(g.leaf.added_by, ROOT_BARE)   // 存储规范形
  // 真正不匹配（不同会话）仍拒
  r = await engine.call('leaf:add', ['w26id', {
    leaf_id: 'w26id-C4-worker', session_id: '55555555-5555-4555-8555-555555555555', parent: 'w26id-root', path: 'C4', role: 'worker', added_by: S1_PREFIXED,
  }], ROOT_PREFIXED)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY')
})

// ── done 所有权（owner 存储裸 UUID，接手 caller 带前缀） ─────
test('done 所有权：owner=裸 UUID 时，带 session- 前缀的 owner caller 可写 done；creator 代写仍拒', async () => {
  const { engine } = await seededPrefixRoot()
  // creator（root 带前缀）代写 done → 仍拒（V10-trust-anchor-fix 不放宽）
  let r = await engine.call('event:append', ['w26id', 'w26id-C1-worker', 'done', { self_check: [] }], ROOT_PREFIXED)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY')
  // owner 会话的 DSH_SESSION_ID 若带前缀（同一裸 UUID）→ 归一化后命中 owner
  r = await engine.call('event:append', ['w26id', 'w26id-C1-worker', 'done', { self_check: [] }], S1_PREFIXED)
  assert.equal(r.ok, true, JSON.stringify(r))
})

// ── set-session / register-session / validate ─────────────────
test('set-session：creator 传带前缀新会话 id → 归一化存裸；非法仍拒', async () => {
  const { engine } = await seededPrefixRoot()
  const fresh = '66666666-6666-4666-8666-666666666666'
  let r = await engine.call('leaf:set-session', ['w26id', 'w26id-C1-worker', `session-${fresh}`], ROOT_PREFIXED)
  assert.equal(r.ok, true, JSON.stringify(r))
  const g = await engine.call('leaf:get', ['w26id', 'w26id-C1-worker'])
  assert.equal(g.leaf.session_id, fresh)
  r = await engine.call('leaf:set-session', ['w26id', 'w26id-C1-worker', 'session-bogus'], ROOT_PREFIXED)
  assert.equal(r.error.code, 'E_INVALID_UUID_STRICT')
})

test('register-session：带前缀登记归一化，裸形态重复登记 → 冲突；预算去重只算一次', async () => {
  const { engine } = await newEngine()
  await engine.call('init', ['w26id', {}, {}, ROOT_PREFIXED])
  const sid = '77777777-7777-4777-8777-777777777777'
  let r = await engine.call('tree:register-session', ['w26id', `session-${sid}`, { source: 'bypass' }, ROOT_PREFIXED])
  assert.equal(r.ok, true, JSON.stringify(r))
  // 同一会话的裸 UUID 形态再登记 → 冲突（归一化去重）
  r = await engine.call('tree:register-session', ['w26id', sid, { source: 'bypass' }, ROOT_PREFIXED])
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.match(r.error.message, /session_registry/)
})

test('validate：前缀/裸形态混存不误报；同一会话跨形态重复仍报 duplicate；runtime.segmentChain 纳入校验', async () => {
  const { engine, store } = await newEngine()
  await engine.call('init', ['w26id', {}, {}, ROOT_PREFIXED])
  const state = await store.read('w26id')
  // 两个 leaf 存同一会话的不同形态 → 是重复（语义正确）
  state.leaves['w26id-C1-worker'] = { leaf_id: 'w26id-C1-worker', parent: 'w26id-root', path: 'C1', role: 'worker', status: 'active', session_id: S1_BARE, added_by: ROOT_BARE, events: [], segment_chain: [], runtime: { segmentChain: [] } }
  state.leaves['w26id-C2-worker'] = { leaf_id: 'w26id-C2-worker', parent: 'w26id-root', path: 'C2', role: 'worker', status: 'active', session_id: S1_PREFIXED, added_by: ROOT_BARE, events: [], segment_chain: [], runtime: { segmentChain: [] } }
  await store.write('w26id', state)
  let v = await engine.call('validate', ['w26id'])
  assert.equal(v.ok, false)
  assert.ok(v.issues.some((i) => i.type === 'session_duplicate' && i.leaf_id === 'w26id-C2-worker'))
  // 修掉跨 leaf 重复；把其它 leaf/root 的会话放进本 leaf 的 runtime.segmentChain → 仍报重复
  // （W2.1 口径；v0.8.0 收口 F1 后只豁免「本 leaf 自己的当前 session_id」，跨 leaf 复用照旧 FAIL）
  state.leaves['w26id-C2-worker'].session_id = S2_BARE
  state.leaves['w26id-C1-worker'].runtime.segmentChain = [ROOT_PREFIXED]
  await store.write('w26id', state)
  v = await engine.call('validate', ['w26id'])
  assert.equal(v.ok, false)
  assert.ok(v.issues.some((i) => i.type === 'session_duplicate' && String(i.detail).includes('runtime.segmentChain')))
})

test('assertLeafWriter：root 会话 id 存储裸 UUID、caller 带前缀时 root/creator 角色仍命中；陌生 caller 拒', () => {
  const state = { tree_id: 'w26id', leaves: { 'w26id-root': { leaf_id: 'w26id-root', session_id: ROOT_BARE, added_by: null } } }
  const leaf = { leaf_id: 'w26id-C1-worker', session_id: S1_BARE, added_by: ROOT_PREFIXED }
  // root 角色允许 verification
  assert.doesNotThrow(() => assertLeafWriter(state, leaf, ROOT_PREFIXED, 'verification'))
  // owner（裸存）用带前缀 caller 写 context
  assert.doesNotThrow(() => assertLeafWriter(state, leaf, S1_PREFIXED, 'context'))
  // 陌生人 fail-closed
  assert.throws(() => assertLeafWriter(state, leaf, STRANGER, 'verification'), (e) => e.code === 'E_BORROWED_IDENTITY')
})
