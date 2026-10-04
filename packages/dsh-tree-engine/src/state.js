/**
 * 状态机与枚举闭集 — 逐行对齐源引擎 tree-engine.cjs L64–83（差分保真）。
 * 纯逻辑：不 import 任何 DSH API（S1 架构红线）。
 */

/** @returns {never} */
export function treeError(code, message, helpTopic) {
  const err = new Error(message)
  err.name = 'TreeStateError'
  err.code = code
  err.helpTopic = helpTopic
  throw err
}

export const STATUS_ENUM = /** @type {const} */ (['active', 'done', 'pruned', 'archived', 'segment_pending', 'pending_brief'])

/** 状态机流转白名单（P0-3；幂等 X→X 允许；pending_brief↔active 灵活；segment_pending 仅可回 active）。 */
export const STATUS_TRANSITIONS = /** @type {const} */ ({
  pending_brief: ['active', 'done', 'pruned', 'archived', 'pending_brief'],
  active: ['done', 'pruned', 'archived', 'segment_pending', 'pending_brief', 'active'],
  done: ['pruned', 'archived', 'done'],
  pruned: ['archived', 'pruned'],
  archived: ['archived'],
  segment_pending: ['active', 'segment_pending'],
})

export const EVENT_TYPE_ENUM = /** @type {const} */ (['done', 'blocked', 'plan', 'brief_echo', 'heartbeat_reply', 'nudge', 'limit', 'status_check', 'review_round', 'subagent_spawn', 'progress', 'child_done'])
export const DRIFT_KIND_ENUM = /** @type {const} */ (['production', 'direction', 'rhythm', 'security'])
export const DRIFT_SEVERITY_ENUM = /** @type {const} */ (['low', 'mid', 'high', 'red'])
export const DRIFT_ACTION_ENUM = /** @type {const} */ (['nudge', 'limit', 'prune', 'self_correct', 'declare', 'handoff'])
export const ROLE_ENUM = /** @type {const} */ (['root', 'commander', 'worker', 'auditor'])

/** tree_id 前缀规则（L941）：root leaf_id 由 tree_id 派生，前置到 init 即拦。 */
export const TREE_ID_RE = /^[a-z][a-z0-9_]{3,7}$/
/** leaf_id 命名（L64）：prefix-Role-seq[-sN|iN]，path 段须与 leaf_id 一致。 */
export const LEAF_NAME_RE = /^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/

const E = (code, msg) => treeError(code, msg)

/**
 * 断言 from→to 在闭集内（未列出者非法）。
 * @param {string} from
 * @param {string} to
 */
export function assertTransition(from, to) {
  if (!STATUS_ENUM.includes(/** @type {any} */ (from))) E('E_SCHEMA_INVALID', `invalid from-status "${from}"`)
  if (!STATUS_ENUM.includes(/** @type {any} */ (to))) E('E_SCHEMA_INVALID', `invalid status "${to}" (enum: ${STATUS_ENUM.join('|')})`)
  const allowed = STATUS_TRANSITIONS[/** @type {any} */ (from)]
  if (!allowed.includes(/** @type {any} */ (to))) {
    E('E_STATUS_TRANSITION_INVALID', `status transition "${from}" -> "${to}" not allowed (allowed: ${allowed.join('|')})`, 'error_code_index')
  }
}

/** done 三重闸之二：set-status done 前必须已有 type=done 事件（V10-status-event-sync，反序被拒）。 */
export function assertDoneEventGate(leaf) {
  if (!Array.isArray(leaf.events) || !leaf.events.some((ev) => ev.type === 'done')) {
    E('E_SCHEMA_INVALID', `cannot set done: leaf has no 'done' event (append type=done event first; V10-status-event-sync)`, 'alignment_workflow')
  }
}

/** done 三重闸之一：milestones 非空且全部 audit_pass=true。 */
export function assertMilestoneGate(leaf) {
  const ms = Array.isArray(leaf.milestones) ? leaf.milestones : []
  if (ms.length === 0) E('E_SCHEMA_INVALID', 'cannot set done: milestones empty (expect_outputs required per v0.7 V3)')
  for (const m of ms) {
    if (m.audit_pass !== true) {
      E('E_SCHEMA_INVALID', `cannot set done: milestone "${m.id}" audit_pass !== true`)
    }
  }
}

/** 7-strike（V10-nudge-escalation）：nudge_count ≥7 强制 pruned，拒绝继续 nudge。 */
export const NUDGE_STRIKE_LIMIT = 7

/**
 * @param {number} nudgeCount
 * @returns {{ severity: 'low'|'mid'|'high', forcedPrune: boolean }}
 */
export function nudgeEscalation(nudgeCount) {
  if (nudgeCount >= NUDGE_STRIKE_LIMIT) return { severity: 'high', forcedPrune: true }
  if (nudgeCount >= 5) return { severity: 'high', forcedPrune: false }
  if (nudgeCount >= 3) return { severity: 'mid', forcedPrune: false }
  return { severity: 'low', forcedPrune: false }
}
