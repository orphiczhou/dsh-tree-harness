/** S1 第一批单测：护栏（UUID 严格 / macp2 预算 / 会话唯一 / caller 防借身份）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStrictUuidV4, sessionBudget, activeLeafBudget, findSessionConflict, assertCallerIs } from '../src/guards.js'

const V4 = '3f8b2c1a-9d4e-4a2b-8c7f-1e5d6a7b8c9e'
const V4B = '77a1b2c3-d4e5-4f6a-9b8c-2d3e4f5a6b7c'

test('UUID 严格：全 0 / 全 f / 非 v4 / 空 全拒', () => {
  assert.ok(isStrictUuidV4(V4))
  assert.ok(!isStrictUuidV4('00000000-0000-0000-0000-000000000000'))
  assert.ok(!isStrictUuidV4('ffffffff-ffff-ffff-ffff-ffffffffffff'))
  assert.ok(!isStrictUuidV4('3f8b2c1a-9d4e-1a2b-8c7f-1e5d6a7b8c9e'))  // version ≠ 4
  assert.ok(!isStrictUuidV4('not-uuid'))
  assert.ok(!isStrictUuidV4(''))
  assert.ok(!isStrictUuidV4(null))
})

test('macp2 会话预算：跨 leaf.session / segment_chain / registry 去重计数', () => {
  const state = {
    leaves: {
      a: { session_id: V4, segment_chain: [V4B] },
      b: { session_id: null, segment_chain: [] },
    },
    session_registry: {},
  }
  assert.deepEqual(sessionBudget(state, V4), { count: 2, max: 50, reached: false, isNew: false })  // 已存在不多计
  assert.deepEqual(sessionBudget(state, V4B), { count: 2, max: 50, reached: false, isNew: false })
  const fresh = sessionBudget(state, '11111111-2222-4333-8444-555566667777')
  assert.equal(fresh.count, 3)
  assert.equal(fresh.isNew, true)
})

test('macp2 会话预算：超限 reached=true', () => {
  const state = { leaves: {}, session_registry: {} }
  for (let i = 0; i < 50; i++) {
    state.leaves[`l${i}`] = { session_id: `0000000${i}-0000-4000-8000-00000000000${i}`.replace(/00(\d)$/, '$1').padEnd(36, '0'), segment_chain: [] }
  }
  // 构造 50 个合法互异 v4 太啰嗦，直接用计数语义测：49 个 + 新的 1 个 = 50 未超，50 个 + 新的 = 51 超
  const st49 = { leaves: Object.fromEntries(Object.entries(state.leaves).slice(0, 49)), session_registry: {} }
  assert.equal(sessionBudget(st49, V4).reached, false)
  assert.equal(sessionBudget(state, V4).reached, true)
})

test('会话全树唯一冲突检测（leaf.session / segment_chain / registry 三集合）', () => {
  const state = {
    leaves: { a: { leaf_id: 'a', session_id: V4, segment_chain: [] }, b: { leaf_id: 'b', session_id: null, segment_chain: [V4B] } },
    session_registry: { '99999999-9999-4999-8999-999999999999': { source: 'bypass' } },
  }
  assert.ok(findSessionConflict(state, V4).includes('already used by leaf "a"'))
  assert.ok(findSessionConflict(state, V4B).includes('segment_chain'))
  assert.ok(findSessionConflict(state, '99999999-9999-4999-8999-999999999999').includes('session_registry'))
  assert.equal(findSessionConflict(state, V4, 'a'), null)  // 排除自身
})

test('caller 防借身份：不匹配即 E_BORROWED_IDENTITY', () => {
  assert.doesNotThrow(() => assertCallerIs(V4, V4, 'leaf_add'))
  assert.throws(() => assertCallerIs(V4B, V4, 'leaf_add'), (e) => e.code === 'E_BORROWED_IDENTITY')
})
