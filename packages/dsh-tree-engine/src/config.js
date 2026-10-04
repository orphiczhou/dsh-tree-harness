/**
 * Config schema 装载期校验（PLAN §4.7 键表；handoff §7 任务 8）。
 * 输入来源：process.env.TREE_ENGINE_CONFIG（JSON）或显式对象。
 * 失败语义：抛错含键名（类型/约束类），不静默回退——与 validatePolicies 同款纪律。
 */

/** 已知键 → {type, 约束}（§4.7 + 编排配置；未知键拒绝而非忽略，防拼写静默失效）。 */
export const CONFIG_SCHEMA = {
  // 护栏（audit_meta 面）
  node_budget: { type: 'integer', min: 1, max: 500 },
  max_sessions: { type: 'integer', min: 1, max: 1000 },
  max_subagent_spawn_per_leaf: { type: 'integer', min: 1, max: 100 },
  commander_max_depth: { type: 'integer', min: 1, max: 5 },
  ctx_segment_threshold: { type: 'integer', min: 1, max: 100 },
  segment_max_chain_length: { type: 'integer', min: 1, max: 10 },
  // 编排面（orchestra）
  nodeTimeoutMs: { type: 'integer', min: 1_000, max: 24 * 3600_000 },
  sweepIntervalMs: { type: 'integer', min: 1_000, max: 3600_000 },
  graceMs: { type: 'integer', min: 0, max: 3600_000 },
  bambooThresholdPct: { type: 'integer', min: 1, max: 100 },
}

/**
 * @param {object} cfg 待校验对象
 * @param {string} [sourceLabel] 报错定位前缀
 * @returns {object} 原样返回（校验通过）
 * @throws {Error} message 含首个违规键名
 */
export function validateConfig(cfg, sourceLabel = 'config') {
  if (cfg === undefined || cfg === null) return {}
  if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${sourceLabel}: object required (got ${Array.isArray(cfg) ? 'array' : typeof cfg})`)
  for (const [k, v] of Object.entries(cfg)) {
    const rule = CONFIG_SCHEMA[k]
    if (!rule) throw new Error(`${sourceLabel}["${k}"]: unknown config key (known: ${Object.keys(CONFIG_SCHEMA).join(', ')})`)
    if (rule.type === 'integer') {
      if (!Number.isInteger(v)) throw new Error(`${sourceLabel}["${k}"]: integer required (got ${typeof v} "${String(v)}")`)
      if (v < rule.min || v > rule.max) throw new Error(`${sourceLabel}["${k}"]: ${v} out of range [${rule.min}, ${rule.max}]`)
    } else if (rule.type === 'string') {
      if (typeof v !== 'string') throw new Error(`${sourceLabel}["${k}"]: string required`)
    } else if (rule.type === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(`${sourceLabel}["${k}"]: boolean required`)
    }
  }
  return cfg
}

/** 环境装载入口：TREE_ENGINE_CONFIG JSON → 校验 → {config, orchestra} 拆分；非法时抛错含键名。 */
export function configFromEnv(env = process.env) {
  const raw = env.TREE_ENGINE_CONFIG
  if (!raw) return { config: {}, orchestra: {} }
  let parsed
  try { parsed = JSON.parse(raw) } catch (e) { throw new Error(`TREE_ENGINE_CONFIG: invalid JSON (${e.message})`) }
  validateConfig(parsed, 'TREE_ENGINE_CONFIG')
  const orchestrationKeys = new Set(['nodeTimeoutMs', 'sweepIntervalMs', 'graceMs', 'bambooThresholdPct'])
  const config = {}, orchestra = {}
  for (const [k, v] of Object.entries(parsed)) (orchestrationKeys.has(k) ? orchestra : config)[k] = v
  return { config, orchestra }
}
