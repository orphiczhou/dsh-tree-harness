/**
 * per-tree 串行队列（冻结版 §4.1 并发控制）。
 * 同一 tree 的全部临界区按提交序串行；不同 tree 并行。
 * 临界区抛错不毒化队列（catch 后续接）。
 */

/** @type {Map<string, Promise<unknown>>} */
const tails = new Map()

/**
 * @template T
 * @param {string} treeId
 * @param {() => Promise<T> | T} fn 临界区（内部不得再 enqueue 同一 tree —— 禁重入）
 * @returns {Promise<T>}
 */
export function enqueue(treeId, fn) {
  const prev = tails.get(treeId) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(() => fn())
  const tail = run.catch(() => {})          // 链尾吞错：失败不毒化后续
  tails.set(treeId, tail)
  void tail.then(() => {
    if (tails.get(treeId) === tail) tails.delete(treeId)
  }).catch(() => {})
  return run
}

/** 测试辅助：清空全部队列状态。 */
export function resetQueues() { tails.clear() }
