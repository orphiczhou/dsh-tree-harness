/** S1 第一批单测：状态机闭集 + done 三重闸 + 7-strike（继承冻结版 §8 断言风格）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertTransition, assertDoneEventGate, assertMilestoneGate, nudgeEscalation,
  STATUS_TRANSITIONS, NUDGE_STRIKE_LIMIT,
} from '../src/state.js'

const throws = (code, fn) => {
  try { fn(); assert.fail(`expected TreeStateError ${code}`) }
  catch (e) { assert.equal(e.code, code, `code mismatch: got ${e.code}, msg=${e.message}`) }
}

test('迁移闭集：合法迁移放行', () => {
  assert.doesNotThrow(() => assertTransition('active', 'done'))
  assert.doesNotThrow(() => assertTransition('active', 'segment_pending'))
  assert.doesNotThrow(() => assertTransition('segment_pending', 'active'))
  assert.doesNotThrow(() => assertTransition('pending_brief', 'active'))
  assert.doesNotThrow(() => assertTransition('active', 'active'))          // 幂等
  assert.doesNotThrow(() => assertTransition('done', 'done'))              // 幂等
  assert.doesNotThrow(() => assertTransition('done', 'pruned'))
})

test('迁移闭集：非法迁移拒绝（done→active 回退 / archived 复活 / segment_pending→done）', () => {
  throws('E_STATUS_TRANSITION_INVALID', () => assertTransition('done', 'active'))
  throws('E_STATUS_TRANSITION_INVALID', () => assertTransition('archived', 'active'))
  throws('E_STATUS_TRANSITION_INVALID', () => assertTransition('pruned', 'active'))
  throws('E_STATUS_TRANSITION_INVALID', () => assertTransition('segment_pending', 'done'))
  throws('E_SCHEMA_INVALID', () => assertTransition('active', 'bogus'))
})

test('done 闸 1：无 done event 拒绝 set-status done（反序操作被拒）', () => {
  throws('E_SCHEMA_INVALID', () => assertDoneEventGate({ events: [{ type: 'progress' }] }))
  assert.doesNotThrow(() => assertDoneEventGate({ events: [{ type: 'done' }] }))
})

test('done 闸 2：milestones 空或未全 audit_pass 拒绝', () => {
  throws('E_SCHEMA_INVALID', () => assertMilestoneGate({ milestones: [] }))
  throws('E_SCHEMA_INVALID', () => assertMilestoneGate({ milestones: [{ id: 'm1', audit_pass: false }] }))
  assert.doesNotThrow(() => assertMilestoneGate({ milestones: [{ id: 'm1', audit_pass: true }] }))
})

test('7-strike 升级：3→mid、5→high、7→强制 pruned', () => {
  assert.deepEqual(nudgeEscalation(1), { severity: 'low', forcedPrune: false })
  assert.deepEqual(nudgeEscalation(3), { severity: 'mid', forcedPrune: false })
  assert.deepEqual(nudgeEscalation(5), { severity: 'high', forcedPrune: false })
  assert.deepEqual(nudgeEscalation(NUDGE_STRIKE_LIMIT), { severity: 'high', forcedPrune: true })
})

test('迁移表快照（差分锚点：与源引擎 L72-79 逐行一致）', () => {
  assert.deepEqual(STATUS_TRANSITIONS, {
    pending_brief: ['active', 'done', 'pruned', 'archived', 'pending_brief'],
    active: ['done', 'pruned', 'archived', 'segment_pending', 'pending_brief', 'active'],
    done: ['pruned', 'archived', 'done'],
    pruned: ['archived', 'pruned'],
    archived: ['archived'],
    segment_pending: ['active', 'segment_pending'],
  })
})
