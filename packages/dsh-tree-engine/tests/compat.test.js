/**
 * W2.3 RC2 兼容层单测（node:test）：双形探测 / 返回解析 / 中断 authority 候选构造。
 * 只测 src/compat.js 的纯逻辑——不装配宿主服务、不做 IO；断言口径对齐 index.js L315-L348 现实现。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInterruptAuthorities,
  buildStartRequest,
  detectInterruptMechanism,
  detectStartMechanism,
  NO_START_MECHANISM_MESSAGE,
  resolveActivationResult,
  resolveContinuableResult,
} from '../src/compat.js'

const LEGACY_PREFIX = 'unrecognized startContinuable result: '
const ACTIVATION_PREFIX = 'unrecognized startActivation result: '
const EVIDENCE_LIMIT = 200
const LIVE_AGENT = { id: 'agent-live' }

test('legacy startContinuable 返回三形都能解析：childId / sessionId / session.id', () => {
  assert.equal(resolveContinuableResult({ childId: 'child-1' }), 'child-1')
  assert.equal(resolveContinuableResult({ sessionId: 'sess-1' }), 'sess-1')
  assert.equal(resolveContinuableResult({ session: { id: 'nested-1' } }), 'nested-1')
  // 优先级：childId > sessionId > session.id（与现实现 ?? 链逐字一致）
  assert.equal(resolveContinuableResult({ childId: 'c', sessionId: 's', session: { id: 'n' } }), 'c')
  assert.equal(resolveContinuableResult({ sessionId: 's', session: { id: 'n' } }), 's')
})

test('legacy 不可识别形状抛错：message 含前缀与截断证据（≤200 字符）', () => {
  assert.throws(() => resolveContinuableResult({ unexpected: true }), (e) => {
    assert.match(e.message, /^unrecognized startContinuable result: /)
    assert.ok(e.message.includes('"unexpected":true'))
    assert.ok(e.message.length <= LEGACY_PREFIX.length + EVIDENCE_LIMIT)
    return true
  })
  // 超长返回值：证据截到 200 字符（现实现 slice(0, 200) 同口径）
  try {
    resolveContinuableResult({ blob: 'x'.repeat(500) })
    assert.fail('long unrecognized result must throw')
  } catch (e) {
    const evidence = e.message.slice(LEGACY_PREFIX.length)
    assert.equal(evidence.length, EVIDENCE_LIMIT)
    assert.ok(evidence.startsWith('{"blob":"xxx'))
  }
  // 空/undefined 也给出可读证据（纯模块对 JSON.stringify(undefined) 的防御性降级）
  assert.throws(() => resolveContinuableResult(undefined), (e) => {
    assert.equal(e.message, 'unrecognized startContinuable result: undefined')
    return true
  })
})

test('rc.2 startActivation 返回解析：childId / sessionId，childId 优先', () => {
  assert.equal(resolveActivationResult({ childId: 'child-2' }), 'child-2')
  assert.equal(resolveActivationResult({ sessionId: 'sess-2' }), 'sess-2')
  assert.equal(resolveActivationResult({ childId: 'c', sessionId: 's' }), 'c')
})

test('activation 不可识别抛错：不认 legacy 的 session.id，证据随 message', () => {
  assert.throws(() => resolveActivationResult({ session: { id: 'nested-2' } }), (e) => {
    assert.match(e.message, /^unrecognized startActivation result: /)
    assert.ok(e.message.includes('"session":{"id":"nested-2"}'))
    return true
  })
  assert.throws(() => resolveActivationResult(null), (e) => {
    assert.equal(e.message, 'unrecognized startActivation result: null')
    return true
  })
})

test('detectStartMechanism：两形都有 → legacy；仅 activation → activation；都缺 → none', () => {
  assert.equal(detectStartMechanism({ startContinuable() {} }), 'legacy')
  assert.equal(detectStartMechanism({ startActivation() {} }), 'activation')
  assert.equal(detectStartMechanism({ startContinuable() {}, startActivation() {} }), 'legacy')
  assert.equal(detectStartMechanism({}), 'none')
})

test('detectStartMechanism 负例：null/undefined/非对象/非函数字段/异常 getter → none', () => {
  assert.equal(detectStartMechanism(null), 'none')
  assert.equal(detectStartMechanism(undefined), 'none')
  assert.equal(detectStartMechanism('subagents'), 'none')
  assert.equal(detectStartMechanism(42), 'none')
  assert.equal(detectStartMechanism({ startContinuable: 'not-a-function', startActivation: 42 }), 'none')
  const hostile = { get startContinuable() { throw new Error('boom') } }
  assert.equal(detectStartMechanism(hostile), 'none')
})

test('detectInterruptMechanism：interrupt 存在即用；形状随起始机制（两形并存仍 legacy）', () => {
  assert.equal(detectInterruptMechanism({ interrupt() {}, startContinuable() {} }), 'legacy')
  assert.equal(detectInterruptMechanism({ interrupt() {}, startActivation() {} }), 'activation')
  assert.equal(detectInterruptMechanism({ interrupt() {}, startContinuable() {}, startActivation() {} }), 'legacy')
  // interrupt-only：legacy 基线可能只暴露 interrupt，缺省按 legacy 处理
  assert.equal(detectInterruptMechanism({ interrupt() {} }), 'legacy')
})

test('detectInterruptMechanism 负例：无 interrupt / 非函数 / 非对象 → none', () => {
  assert.equal(detectInterruptMechanism({ startActivation() {} }), 'none')
  assert.equal(detectInterruptMechanism({ interrupt: 'nope' }), 'none')
  assert.equal(detectInterruptMechanism(null), 'none')
  assert.equal(detectInterruptMechanism(undefined), 'none')
  const hostile = { get interrupt() { throw new Error('boom') } }
  assert.equal(detectInterruptMechanism(hostile), 'none')
})

test('buildInterruptAuthorities：活祖先 + 父地址 → ancestor → user → parent 顺序（形状对齐现实现）', () => {
  assert.deepEqual(buildInterruptAuthorities({ parentSessionId: 'parent-1', liveAncestorAgent: LIVE_AGENT }), [
    { kind: 'ancestor', agent: LIVE_AGENT },
    // 现实现 L337 携带字段是 parentSessionId（非任务书草写的 sessionId），此处冻结形状
    { kind: 'user', parentSessionId: 'parent-1' },
    { kind: 'parent', parentSessionId: 'parent-1' },
  ])
})

test('buildInterruptAuthorities 边界：无活祖先收敛为 user → parent；缺父地址不产候选', () => {
  assert.deepEqual(buildInterruptAuthorities({ parentSessionId: 'parent-1' }), [
    { kind: 'user', parentSessionId: 'parent-1' },
    { kind: 'parent', parentSessionId: 'parent-1' },
  ])
  assert.deepEqual(buildInterruptAuthorities({ parentSessionId: 'parent-1', liveAncestorAgent: null }), [
    { kind: 'user', parentSessionId: 'parent-1' },
    { kind: 'parent', parentSessionId: 'parent-1' },
  ])
  assert.deepEqual(buildInterruptAuthorities({}), [])
  assert.deepEqual(buildInterruptAuthorities(), [])
  assert.deepEqual(buildInterruptAuthorities({ parentSessionId: '' }), [])
  // 契约：活祖先由调用方在 parentSessionId 存在时才检索（同 index.js L334）；本纯函数传入即采用
  assert.deepEqual(buildInterruptAuthorities({ liveAncestorAgent: LIVE_AGENT }), [
    { kind: 'ancestor', agent: LIVE_AGENT },
  ])
})

test('两形都缺的协议错文案冻结（与 index.js L327 逐字一致）', () => {
  assert.equal(NO_START_MECHANISM_MESSAGE, 'host subagents service exposes neither startContinuable nor startActivation')
})

// ── v0.8.1（D22）：起始请求体构建（maxDepth 注入）──────────────

test('buildStartRequest：显式 maxDepth 原样注入；构造 prompt/parent/agentOptions', () => {
  const parent = { id: 'agent-1' }
  const req = buildStartRequest({ promptText: 'hello', parent, agentOptions: { model: 'm' }, maxDepth: 7 })
  assert.deepEqual(req, {
    prompt: [{ type: 'text', text: 'hello' }],
    parent,
    agentOptions: { model: 'm' },
    maxDepth: 7,
  })
  // maxDepth=0 是合法绝对值（不允许任何子会话），必须保留而非当作缺省丢弃
  assert.equal(buildStartRequest({ promptText: 'x', parent, maxDepth: 0 }).maxDepth, 0)
})

test('buildStartRequest：maxDepth 缺省不产生该字段（保持旧宿主形状）；agentOptions 缺省省略', () => {
  const req = buildStartRequest({ promptText: 'x', parent: { id: 'a' } })
  assert.deepEqual(req, { prompt: [{ type: 'text', text: 'x' }], parent: { id: 'a' } })
  assert.equal('maxDepth' in req, false)
  assert.equal('agentOptions' in req, false)
})

test('buildStartRequest：非法 maxDepth fail-closed（非整数 / 负数 / 字符串 / NaN）', () => {
  for (const bad of [1.5, -1, '5', NaN, Infinity, null]) {
    assert.throws(
      () => buildStartRequest({ promptText: 'x', parent: {}, maxDepth: bad }),
      /maxDepth must be a non-negative integer/,
      'maxDepth=' + String(bad) + ' must be rejected',
    )
  }
})
