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
  // v0.8.1（D22）：tree 派发子会话的绝对深度上限（传给宿主 request.maxDepth）。
  // 缺省 5 与 desktop profile `subagent.maxDepth=5` 对齐；宿主仅在调用方显式传该字段时校验。
  max_subagent_depth: { type: 'integer', min: 1, max: 100 },
  ctx_segment_threshold: { type: 'integer', min: 1, max: 100 },
  // flash 审计 #8（R1 复核 P1-1 收敛）：依赖闸是否要求依赖 leaf 「已验证 PASS」才放行。
  // 缺省 false = 保持既有自报信任模型（SKILL 契约「依赖未 succeeded → E_DEPENDENCY_NOT_MET」）；
  // true = 严格模式（dep.verification.pass===true 才放行，自报 done 不再放行下游）。
  // 默认关闭是**已文档化的信任模型取舍**，切换默认值需用户裁决。
  require_dependency_verification: { type: 'boolean' },
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

/** 编排键（由 engine `opts.orchestra` 消费；audit_meta 不消费，显式拒收）。 */
const ORCHESTRA_KEYS = new Set(['nodeTimeoutMs', 'sweepIntervalMs', 'graceMs', 'bambooThresholdPct'])
/** audit_meta 中**真正被逐树消费**的护栏键（唯一：竹节阈值；其余键只作快照记录）。 */
const AUDIT_META_CONSUMED_KEYS = new Set(['ctx_segment_threshold'])

/**
 * `audit_meta` 覆盖校验（flash 审计 #21；R1 异族复核 P2-2/P3-4 修正）。
 *
 * 背景：engine `init` 的第 5 参 `audit_meta` 此前原样 `{ ...cfg, ...(auditMeta ?? {}) }` 写入 state，
 * 不经 validateConfig——`audit_meta: { ctx_segment_threshold: "200" }` 会让 `pct >= threshold` 恒 false
 * （竹节静默失效）。
 *
 * 本函数的判定顺序（全部 fail-closed）：
 *   ① 编排键（nodeTimeoutMs/sweepIntervalMs/graceMs/bambooThresholdPct）→ 拒收（由 engine orchestra 消费，
 *      audit_meta 永不生效，静默接受会造成「配置了却不生效」的误导）；
 *   ② 其余键走 CONFIG_SCHEMA 同款严格校验（未知键 / 类型 / 范围拒绝）；
 *   ③ 「比基线更宽松」的**数值上调**：仅允许 `ctx_segment_threshold`（唯一被逐树消费的键）——
 *      由调用方写 `security/high` drift 留痕；其余键的上调一律拒绝（它们只被记录、不会被消费，
 *      标记「已放宽」会污染审计真相）。
 *
 * @param {object} [meta] init 传入的 audit_meta
 * @param {Record<string, number>} [baseline] 当前生效配置（engine cfg）
 * @returns {{ meta: object, uplifted: Array<{key: string, base: number, value: number}> }}
 */
export function validateAuditMeta(meta, baseline = {}) {
  if (meta === undefined || meta === null) return { meta: {}, uplifted: [] }
  if (typeof meta !== 'object' || Array.isArray(meta)) throw new Error('audit_meta: object required')
  for (const key of Object.keys(meta)) {
    if (ORCHESTRA_KEYS.has(key)) {
      throw new Error(`audit_meta["${key}"]: orchestration keys are not accepted here (they are consumed from engine orchestra options, never from audit_meta)`)
    }
  }
  validateConfig(meta, 'audit_meta')
  const uplifted = []
  for (const [k, v] of Object.entries(meta)) {
    const base = baseline[/** @type {keyof typeof baseline} */ (k)]
    if (typeof base === 'number' && typeof v === 'number' && v > base) {
      if (!AUDIT_META_CONSUMED_KEYS.has(k)) {
        throw new Error(`audit_meta["${k}"]: cannot relax guard ${base} -> ${v} via audit_meta (this key is recorded-only, not consumed per-tree; configure it via TREE_ENGINE_CONFIG)`)
      }
      uplifted.push({ key: k, base, value: v })
    }
  }
  return { meta, uplifted }
}
