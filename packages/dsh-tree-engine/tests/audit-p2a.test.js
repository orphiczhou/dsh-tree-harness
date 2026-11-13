/**
 * flash 审计剩余项 · D24 P2-A 批次单测（#8 / #15 / #20 / #21 / #22 / #28 / #30）。
 *
 * 背景：docs/archive/flaudit-report.md（2026-10-04，33 条）。D23 已处理 #1/#7/#19 + R1/R2 复核项；
 * 本文件覆盖第二批 P0/P1：信任闸（#8/#15）、竹节预算与唯一性（#20）、护栏与写面（#21/#22）、
 * 灾备（#28）、GC 与观测滚动（#30）。测试均为「修复前必红、修复后必绿」的行为断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../src/engine.js'
import { memoryStore, fsStore, CALL_LOG_MAX_BYTES } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { validateAuditMeta } from '../src/config.js'
import { TOOLS } from '../index.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CMD = '22222222-2222-4222-8222-222222222222'
const OWNER = '33333333-3333-4333-8333-333333333333'
const OWNER2 = '44444444-4444-4444-8444-444444444444'
const STRANGER = '55555555-5555-4555-8555-555555555555'

/** 假编排端口：记录调用；sessionId 递增（可 over 覆盖）。 */
function fakePorts(over = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    async dispatch(spec) { calls.push(['dispatch', spec]); n += 1; return { sessionId: `sess-${n}` } },
    async interrupt(id) { calls.push(['interrupt', id]) },
    async promptHandoff(id) { calls.push(['promptHandoff', id]); return 'BRIEF' },
    async lastOutputAt() { return null },
    async usagePct() { return null },
    ...over,
  }
}

async function setup({ config = {}, orchestra = {}, ports = fakePorts(), clock = new VirtualClock(1_000_000) } = {}) {
  const store = memoryStore()
  const engine = createEngine({ store, clock, ports, config, orchestra })
  return { engine, store, clock, ports }
}

async function baseTree(t = 'aud24', ctx = {}) {
  const s = await setup(ctx)
  await s.engine.call('init', [t, { goal: 'g' }, { dod: 'd' }, ROOT])
  await s.engine.call('leaf:add', [t, { leaf_id: `${t}-C1-worker`, session_id: OWNER, parent: `${t}-root`, path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  return { ...s, t }
}

// ══════════════════════════════════════════════════════════════════════════
// #8 依赖闸：已验证失败（verification.pass=false）不得放行下游 / stale done 不回流
// ══════════════════════════════════════════════════════════════════════════

test('#8 依赖闸：dependency 的 verification.pass=false 拒绝下游派发；pass=true 恢复放行', async () => {
  const { engine, t } = await baseTree('aud8a', { config: { max_sessions: 10, node_budget: 10 } })
  await engine.call('leaf:add', [t, { leaf_id: `${t}-C2-worker`, session_id: OWNER2, parent: `${t}-root`, path: 'C2', role: 'worker', added_by: ROOT, dependencies: [`${t}-C1-worker`] }], ROOT)
  const d = await engine.call('dispatch:start', [t, `${t}-C1-worker`, {}], ROOT)
  assert.equal(d.ok, true, JSON.stringify(d.error))
  const owner = d.node.session_id
  // owner 自报 done → runtime succeeded（依赖闸的既有结算信号）
  assert.equal((await engine.call('event:append', [t, `${t}-C1-worker`, 'done', { summary: 'ok' }], owner)).ok, true)
  // creator 落一条 FAIL 裁决 → 依赖不得放行
  const vf = await engine.call('leaf:set-verification', [t, `${t}-C1-worker`, { pass: false, policyId: 'self-report', verdicts: [{ mode: 'self-report', pass: false }] }], ROOT)
  assert.equal(vf.ok, true, JSON.stringify(vf.error))
  const blocked = await engine.call('dispatch:start', [t, `${t}-C2-worker`, {}], ROOT)
  assert.equal(blocked.ok, false, 'verified-failed dependency must not unblock downstream')
  assert.equal(blocked.error.code, 'E_DEPENDENCY_NOT_MET')
  assert.match(blocked.error.message, /verification=FAIL/)
  // 重验 PASS → 放行
  const vp = await engine.call('leaf:set-verification', [t, `${t}-C1-worker`, { pass: true, policyId: 'self-report', verdicts: [{ mode: 'self-report', pass: true }] }], ROOT)
  assert.equal(vp.ok, true, JSON.stringify(vp.error))
  const ok = await engine.call('dispatch:start', [t, `${t}-C2-worker`, {}], ROOT)
  assert.equal(ok.ok, true, JSON.stringify(ok.error))
  assert.equal(ok.node.state, 'running')
})

test('#8 sweep 回流：旧 attempt 的 done 事件不得把重派后的新 attempt 判 succeeded（stale-done 旁路）', async () => {
  const clock = new VirtualClock(1_000_000)
  const { engine, t } = await baseTree('aud8b', { clock, config: { nodeTimeoutMs: 5_000 }, orchestra: { nodeTimeoutMs: 5_000, sweepIntervalMs: 60_000 } })
  const d1 = await engine.call('dispatch:start', [t, `${t}-C1-worker`, {}], ROOT)
  assert.equal(d1.ok, true, JSON.stringify(d1.error))
  assert.equal((await engine.call('event:append', [t, `${t}-C1-worker`, 'done', { summary: 'first' }], d1.node.session_id)).ok, true)
  clock.advance(1)
  const d2 = await engine.call('dispatch:start', [t, `${t}-C1-worker`, {}], ROOT)
  assert.equal(d2.ok, true, JSON.stringify(d2.error))
  assert.equal(d2.node.attempt, 2, 're-dispatch bumps attempt')
  clock.advance(10_000)
  const sw = await engine.call('sweep:tick', [])
  assert.equal(sw.ok, true)
  const leaf = (await engine.call('leaf:get', [t, `${t}-C1-worker`])).leaf
  assert.equal(leaf.runtime.state, 'timeout', 'stale done from attempt 1 must not settle attempt 2 as succeeded')
})

// ══════════════════════════════════════════════════════════════════════════
// #15 验证裁决落账：verdicts/pass 一致性 + 形状校验
// ══════════════════════════════════════════════════════════════════════════

test('#15 set-verification：pass 与 verdicts AND 不一致 / 非法形状 → E_SCHEMA_INVALID（伪造裁决被拒）', async () => {
  const { engine, t } = await baseTree('aud15')
  const leafId = `${t}-C1-worker`
  let r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, verdicts: [{ mode: 'self-report', pass: false }] }], ROOT)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  assert.match(r.error.message, /inconsistent/)
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: false, verdicts: 'nope' }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, verdicts: [null] }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, verdicts: [{ mode: 'x' }] }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID', 'verdict without boolean pass must be rejected')
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, policyId: 123 }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, rounds: 'nope' }], ROOT)
  assert.equal(r.error.code, 'E_SCHEMA_INVALID')
  // 合法（AND 一致）仍可落账
  r = await engine.call('leaf:set-verification', [t, leafId, { pass: true, policyId: 'self-report', verdicts: [{ mode: 'self-report', pass: true }] }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leaf = (await engine.call('leaf:get', [t, leafId])).leaf
  assert.equal(leaf.verification.pass, true)
  // 落账鉴权不回归：owner 自验仍拒
  const self = await engine.call('leaf:set-verification', [t, leafId, { pass: true }], OWNER)
  assert.equal(self.error.code, 'E_BORROWED_IDENTITY')
})

// ══════════════════════════════════════════════════════════════════════════
// #20 竹节接力：预算预检 / 会话唯一 / 单一接力账本
// ══════════════════════════════════════════════════════════════════════════

test('#20 竹节接力预算：max_sessions 满额 → frozen（不静默续烧），drift security/high 留痕', async () => {
  const { engine, t } = await baseTree('aud20a', {
    config: { max_sessions: 2, ctx_segment_threshold: 10, node_budget: 10 },
    orchestra: { bambooThresholdPct: 10, nodeTimeoutMs: 600_000 },
  })
  const leafId = `${t}-C1-worker`
  const d = await engine.call('dispatch:start', [t, leafId, {}], ROOT)
  assert.equal(d.ok, true, JSON.stringify(d.error))
  assert.equal((await engine.call('leaf:set-status', [t, leafId, 'active'], d.node.session_id)).ok, true)
  assert.equal((await engine.call('leaf:set-context', [t, leafId, 20], d.node.session_id)).ok, true)
  const sw = await engine.call('sweep:tick', [])
  assert.equal(sw.ok, true)
  const leaf = (await engine.call('leaf:get', [t, leafId])).leaf
  assert.equal(leaf.runtime.state, 'frozen', 'relay must freeze when session budget is exhausted')
  assert.ok(leaf.drift_history.some((x) => x.severity === 'high' && String(x.reason).includes('session budget')), JSON.stringify(leaf.drift_history))
  assert.equal(leaf.runtime.segmentChain.length, 0, 'no relay session may be burned')
})

test('#20 竹节接力会话唯一性：接力返回冲突 sessionId → frozen + interrupt 回滚；正常接力只用 runtime.segmentChain 单账本', async () => {
  // 冲突：第二次 dispatch（接力）返回 root 会话 id（已被 root leaf 占用）
  let n = 0
  const conflictPorts = fakePorts({
    async dispatch() { n += 1; return { sessionId: n === 1 ? 'sess-first' : ROOT } },
  })
  const a = await baseTree('aud20b', { ports: conflictPorts, config: { max_sessions: 10, ctx_segment_threshold: 10 }, orchestra: { bambooThresholdPct: 10 } })
  const leafA = `${a.t}-C1-worker`
  const dA = await a.engine.call('dispatch:start', [a.t, leafA, {}], ROOT)
  assert.equal(dA.ok, true, JSON.stringify(dA.error))
  await a.engine.call('leaf:set-status', [a.t, leafA, 'active'], dA.node.session_id)
  await a.engine.call('leaf:set-context', [a.t, leafA, 20], dA.node.session_id)
  const swA = await a.engine.call('sweep:tick', [])
  assert.equal(swA.ok, true)
  const lA = (await a.engine.call('leaf:get', [a.t, leafA])).leaf
  assert.equal(lA.runtime.state, 'frozen', 'conflicting relay session must freeze the node')
  assert.ok(conflictPorts.calls.some(([k, id]) => k === 'interrupt' && id === ROOT), 'conflicting session must be interrupted (rollback)')
  assert.equal(lA.session_id, 'sess-first', 'conflicting session must not be bound as owner')

  // 正常：接力 sess-2，账本只在 runtime.segmentChain；validate PASS（F1 语义不回归）
  const normalPorts = fakePorts()
  const b = await baseTree('aud20c', { ports: normalPorts, config: { max_sessions: 10, ctx_segment_threshold: 10 }, orchestra: { bambooThresholdPct: 10 } })
  const leafB = `${b.t}-C1-worker`
  const dB = await b.engine.call('dispatch:start', [b.t, leafB, {}], ROOT)
  await b.engine.call('leaf:set-status', [b.t, leafB, 'active'], dB.node.session_id)
  await b.engine.call('leaf:set-context', [b.t, leafB, 20], dB.node.session_id)
  await b.engine.call('sweep:tick', [])
  const lB = (await b.engine.call('leaf:get', [b.t, leafB])).leaf
  assert.equal(lB.runtime.state, 'running')
  assert.deepEqual(lB.runtime.segmentChain, ['sess-2'])
  assert.deepEqual(lB.segment_chain, [], 'manual segment ledger stays disjoint from the relay ledger')
  const v = await b.engine.call('validate', [b.t])
  assert.equal(v.ok, true, JSON.stringify(v.issues))
})

// ══════════════════════════════════════════════════════════════════════════
// #21 audit_meta 护栏覆盖：严格校验 + 放宽留痕 + 阈值回退
// ══════════════════════════════════════════════════════════════════════════

test('#21 validateAuditMeta：未知键/类型/范围拒绝；比基线宽松的上调被识别', () => {
  assert.throws(() => validateAuditMeta({ ctx_segment_threshold: '200' }, { ctx_segment_threshold: 42 }), /audit_meta/)
  assert.throws(() => validateAuditMeta({ unknown_key: 1 }, {}), /unknown config key/)
  assert.throws(() => validateAuditMeta({ node_budget: 0 }, { node_budget: 20 }), /out of range/)
  assert.throws(() => validateAuditMeta([1, 2], {}), /object required/)
  assert.deepEqual(validateAuditMeta(undefined, {}), { meta: {}, uplifted: [] })
  const up = validateAuditMeta({ node_budget: 500, max_sessions: 50 }, { node_budget: 20, max_sessions: 50 })
  assert.deepEqual(up.uplifted, [{ key: 'node_budget', base: 20, value: 500 }], 'only relaxed (larger) guards are flagged')
})

test('#21 init：audit_meta 非法 → E_SCHEMA_INVALID；放宽护栏 → security/high drift 留痕', async () => {
  const { engine } = await setup()
  const bad = await engine.call('init', ['aud21a', {}, {}, ROOT, { ctx_segment_threshold: '200' }])
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'E_SCHEMA_INVALID')
  assert.match(bad.error.message, /audit_meta/)
  const ok = await engine.call('init', ['aud21b', {}, {}, ROOT, { node_budget: 500, ctx_segment_threshold: 42 }])
  assert.equal(ok.ok, true, JSON.stringify(ok.error))
  const st = await engine.call('treeDump', ['aud21b'])
  assert.equal(st.tree.audit_meta.node_budget, 500)
  assert.ok(st.tree.drift_log.some((d) => d.kind === 'security' && d.severity === 'high' && String(d.reason).includes('audit_meta uplift: node_budget')), JSON.stringify(st.tree.drift_log))
  // 未放宽（等于基线/更严格）不产 drift
  const strict = await engine.call('init', ['aud21c', {}, {}, ROOT, { node_budget: 10 }])
  assert.equal(strict.ok, true)
  const st2 = await engine.call('treeDump', ['aud21c'])
  assert.equal(st2.tree.drift_log.length, 0)
})

test('#21/#23 set-context：旧树 audit_meta 缺阈值键 → 回退 cfg（#23 死回退修复）；坏值同样回退不静默失效', async () => {
  const { engine, store, t } = await baseTree('aud21d', { config: { ctx_segment_threshold: 42 } })
  const leafA = `${t}-C1-worker`
  await engine.call('leaf:set-status', [t, leafA, 'active'], OWNER)
  // 旧树：删掉阈值键（历史 state 形态）
  const st = await store.read(t)
  delete st.audit_meta.ctx_segment_threshold
  await store.write(t, st)
  const r1 = await engine.call('leaf:set-context', [t, leafA, 42], OWNER)
  assert.equal(r1.ok, true)
  assert.equal(r1.leaf.segment_pending, true, 'missing audit_meta key must fall back to cfg threshold (42)')
  // 坏值（历史注入）：字符串阈值 → 回退 cfg，仍按 42 触发
  await engine.call('leaf:add', [t, { leaf_id: `${t}-C2-worker`, session_id: OWNER2, parent: `${t}-root`, path: 'C2', role: 'worker', added_by: ROOT }], ROOT)
  const st2 = await store.read(t)
  st2.audit_meta.ctx_segment_threshold = '200'
  await store.write(t, st2)
  await engine.call('leaf:set-status', [t, `${t}-C2-worker`, 'active'], OWNER2)
  const r2 = await engine.call('leaf:set-context', [t, `${t}-C2-worker`, 42], OWNER2)
  assert.equal(r2.leaf.segment_pending, true, 'corrupted threshold must fall back instead of silently disabling bamboo')
})

// ══════════════════════════════════════════════════════════════════════════
// #22 subagent_spawn 预算事件：仅 owner 可写（防 creator DoS 预算）
// ══════════════════════════════════════════════════════════════════════════

test('#22 subagent_spawn 事件仅 owner：creator/root 注入被拒；owner 自报照常；普通事件不受影响', async () => {
  const { engine, t } = await baseTree('aud22')
  const leafId = `${t}-C1-worker`
  let r = await engine.call('event:append', [t, leafId, 'subagent_spawn', { child: 'x' }], ROOT)
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY')
  assert.match(r.error.message, /event:subagent_spawn/)
  r = await engine.call('event:append', [t, leafId, 'subagent_spawn', { child: 'x' }], CMD)
  assert.equal(r.error.code, 'E_BORROWED_IDENTITY', 'commander must not inject spawn budget events')
  r = await engine.call('event:append', [t, leafId, 'subagent_spawn', { child: 'x' }], OWNER)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  // 普通事件 creator 仍可写（不回归；baseTree 的 creator = ROOT）
  r = await engine.call('event:append', [t, leafId, 'progress', { note: 'ok' }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
})

// ══════════════════════════════════════════════════════════════════════════
// #28 fsStore 损坏恢复：.tmp 原子写残留副本
// ══════════════════════════════════════════════════════════════════════════

test('#28 fsStore：主文件半截 JSON + .tmp 完整副本 → read 恢复；两者均坏 → 抛错；主文件缺失 + .tmp → 恢复', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-aud28-'))
  try {
    const store = fsStore(dir)
    await store.write('t1', { ok: 1 })
    const main = path.join(dir, 't1', 'tree-state.json')
    // (a) 主文件损坏、.tmp 完整 → 恢复 .tmp
    await fsp.writeFile(main + '.tmp', JSON.stringify({ recovered: true }))
    await fsp.writeFile(main, '{"broken":')
    assert.deepEqual(await store.read('t1'), { recovered: true })
    // (b) 两者均坏 → 抛错（不静默返回 null）
    await fsp.writeFile(main + '.tmp', 'nope')
    await assert.rejects(() => store.read('t1'))
    // (c) 主文件缺失 + .tmp 完整（rename 前崩溃）→ 恢复
    await fsp.writeFile(main + '.tmp', JSON.stringify({ recovered: 'missing-main' }))
    await fsp.unlink(main)
    assert.deepEqual(await store.read('t1'), { recovered: 'missing-main' })
    // (d) 都不存在 → null
    await fsp.unlink(main + '.tmp')
    assert.equal(await store.read('t1'), null)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

// ══════════════════════════════════════════════════════════════════════════
// #30 GC（archived 账本截断）与 call-log 滚动
// ══════════════════════════════════════════════════════════════════════════

test('#30 tree:gc：root-only + archived 叶子截断保留 done 与最近 N 条；非归档叶子不动；drift_log 截断留痕', async () => {
  const { engine, store, t } = await baseTree('aud30', { config: { node_budget: 10 } })
  const leafA = `${t}-C1-worker`
  // 5 条 progress + 1 条 done（owner 自报）
  for (let i = 0; i < 5; i += 1) await engine.call('event:append', [t, leafA, 'progress', { i }], OWNER)
  await engine.call('event:append', [t, leafA, 'done', { summary: 'done' }], OWNER)
  await engine.call('leaf:set-status', [t, leafA, 'archived'], ROOT)
  // 非归档叶子（active）+ 大量 drift_log
  await engine.call('leaf:add', [t, { leaf_id: `${t}-C2-worker`, session_id: OWNER2, parent: `${t}-root`, path: 'C2', role: 'worker', added_by: ROOT }], ROOT)
  await engine.call('event:append', [t, `${t}-C2-worker`, 'progress', { keep: true }], OWNER2)
  const st = await store.read(t)
  st.drift_log = Array.from({ length: 150 }, (_, i) => ({ ts: `2026-11-13T00:00:${String(i % 60).padStart(2, '0')}.000Z`, leaf_id: null, kind: 'rhythm', action: 'handoff', reason: `bulk-${i}` }))
  await store.write(t, st)

  // 非 root 调用拒
  const denied = await engine.call('tree:gc', [t, { keep: 2 }], STRANGER)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'E_BORROWED_IDENTITY')
  // root 可执行
  const r = await engine.call('tree:gc', [t, { keep: 2 }], ROOT)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.gc.archived_leaves, 1)
  const lA = (await engine.call('leaf:get', [t, leafA])).leaf
  assert.ok(lA.events.some((e) => e.type === 'done'), 'done event is an audit anchor and must survive gc')
  assert.ok(lA.events.length <= 3, `events trimmed to keep+done (got ${lA.events.length})`)
  assert.ok(!lA.events.some((e) => e.type === 'progress' && e.meta?.i === 0), 'oldest progress trimmed')
  const lC = (await engine.call('leaf:get', [t, `${t}-C2-worker`])).leaf
  assert.equal(lC.events.length, 1, 'non-archived leaf untouched')
  const st2 = await store.read(t)
  assert.ok(st2.drift_log.length <= 101, `tree drift_log trimmed (got ${st2.drift_log.length})`)
  assert.ok(st2.drift_log.some((x) => String(x.reason).startsWith('gc:')), 'gc audit entry recorded')

  // 工具面已暴露 gc action
  const tool = TOOLS.find((x) => x.name === 'tree_maintain')
  assert.ok(tool, 'tree_maintain tool present')
  assert.ok(tool.parameters.properties.action.enum.includes('gc'), 'tree_maintain action enum must include gc')
})

test('#30 call-log 10MB 滚动：appendCallLog 超限先 rename 到 .1，再写新行', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-aud30-'))
  try {
    const store = fsStore(dir)
    await fsp.mkdir(path.join(dir, 't1'), { recursive: true })
    const p = path.join(dir, 't1', 'call-log.jsonl')
    await fsp.writeFile(p, 'x'.repeat(CALL_LOG_MAX_BYTES))
    await store.appendCallLog('t1', { ok: true })
    const rotated = await fsp.stat(p + '.1')
    assert.equal(rotated.size, CALL_LOG_MAX_BYTES, 'old log rotated to .1')
    const cur = await fsp.readFile(p, 'utf-8')
    assert.equal(cur.trim(), JSON.stringify({ ok: true }), 'new log starts fresh with the appended line')
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
