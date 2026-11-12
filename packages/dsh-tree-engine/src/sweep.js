/**
 * sweep 生命周期注册表（v0.8.0 P1-C）——跨模块实例的定时器所有权。
 *
 * 背景（S1 真机 E2E 实证）：树宿主半热更（plugin_manager disable→enable / Loader 重导入）后，
 * 旧模块实例的 `let currentStopSweep` 随旧实例一起不可达；新实例的 `currentStopSweep` 是 null，
 * 于是旧 sweep interval **永远不会被停** → 僵尸定时器（实测 24 条 `inactive context`、
 * 14 条 `sweep_error`、tree-state tmp rename ENOENT 写竞态）。
 *
 * 修复：把「当前 sweep 停止器」放到跨实例共享的注册表
 * （`globalThis[Symbol.for('dsh-tree-engine.sweeps')]`，以 dataDir 为键）：
 *   - 新实例 start 前先 stop 旧实例（同 dataDir 只允许一个活跃 sweep）；
 *   - stop 后从注册表移除（幂等）；
 *   - stop 异常不吞：无 onError 钩子时向上抛（fail-closed，不制造第二个 sweep）。
 *
 * 纯逻辑：不 import 宿主 API；registry holder 可注入（单测用 `{}` 隔离，绝不污染 globalThis）。
 */

/** 跨模块实例共享注册表的全局键（同包多实例/热更后仍命中同一个 Map）。 */
export const SWEEP_REGISTRY_SYMBOL = Symbol.for('dsh-tree-engine.sweeps')

/** holder 不可写（极端 sealed 全局）时的退化表（至少同实例内正确）。 */
const FALLBACK_REGISTRY = new Map()

/**
 * 取 holder 上的注册表（Map<key, entry>）；不存在则创建。
 * @param {any} [holder]
 * @returns {Map<string, any>}
 */
export function getSweepRegistry(holder = globalThis) {
  if (!holder || (typeof holder !== 'object' && typeof holder !== 'function')) return FALLBACK_REGISTRY
  try {
    const existing = holder[SWEEP_REGISTRY_SYMBOL]
    if (existing instanceof Map) return existing
    const registry = new Map()
    holder[SWEEP_REGISTRY_SYMBOL] = registry
    return registry
  } catch {
    return FALLBACK_REGISTRY
  }
}

/**
 * 启动受管 sweep：同 key 的旧 sweep 先被 stop，新 sweep 注册为当前活跃。
 * `start()` 抛错直接向上传播（异常不吞）且不注册；旧 sweep stop 抛错时：
 * 有 onError → 交给钩子处理后继续启动新 sweep；无 onError → 向上抛（不静默制造双 sweep）。
 *
 * @param {object} opts
 * @param {string} opts.key 注册表键（宿主传 `path.resolve(dataDir)`——同一数据目录即同一引擎实例）
 * @param {() => any} opts.start 启动函数：返回 `{stop}` / stop 函数（或其它值，value 原样透传）
 * @param {any} [opts.holder] 注册表宿主（缺省 globalThis；单测注入 `{}` 隔离）
 * @param {(error: any, info: { key: string, phase: string, previous: any }) => void} [opts.onError]
 *        旧 sweep stop 失败的钩子（宿主用它 diag；钩子自身抛错仍向上传播）
 * @returns {{ key: string, value: any, stoppedPrevious: boolean,
 *             active: boolean, stop: () => boolean }}
 */
export function startManagedSweep({ key, start, holder = globalThis, onError } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new TypeError('startManagedSweep: key must be a non-empty string')
  if (typeof start !== 'function') throw new TypeError('startManagedSweep: start must be a function')

  const registry = getSweepRegistry(holder)
  /** @type {any} */
  const previous = registry.get(key)
  let stoppedPrevious = false
  if (previous) {
    try {
      previous.stop?.()
    } catch (e) {
      if (typeof onError === 'function') onError(e, { key, phase: 'stop-previous', previous })
      else throw e   // 异常不吞：没有处理钩子时 fail-closed
    }
    registry.delete(key)
    stoppedPrevious = true
  }

  const value = start()   // start 抛错向上传播（此时不注册）
  const rawStop = (value && typeof value.stop === 'function') ? value.stop : (typeof value === 'function' ? value : null)
  const startedAt = Date.now()
  /** @type {any} */
  const entry = { key, stop: rawStop, startedAt, value }
  registry.set(key, entry)
  let stopped = false

  const handle = {
    key,
    value,
    stoppedPrevious,
    startedAt,
    /** 当前实例是否仍是该 key 的唯一活跃 sweep（被新实例顶替后为 false）。 */
    get active() { return !stopped && registry.get(key) === entry },
    /**
     * 停止本 sweep：幂等（第二次返回 false）；先执行原始 stop 再清注册表，
     * 原始 stop 抛错时仍清注册表并向上抛（异常不吞、不留幽灵条目）。
     * @returns {boolean} 本次是否真正执行了停止
     */
    stop() {
      if (stopped) return false
      stopped = true
      try {
        if (rawStop) rawStop()
      } finally {
        if (registry.get(key) === entry) registry.delete(key)
      }
      return true
    },
  }
  return handle
}
