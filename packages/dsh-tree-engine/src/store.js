/**
 * 树状态持久化端口（冻结版 §4.1：优先 storageDomain，回退插件数据目录直写）。
 * 核心只依赖本端口；宿主装配层决定落点。原子写语义（tmp+rename）由实现保证。
 * 观测铁律继承：call-log append-only、绝不进 tree-state。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/**
 * @typedef {Object} TreeStore
 * @property {(treeId: string) => Promise<any|null>} read        null = 树不存在
 * @property {(treeId: string, state: any) => Promise<void>} write 原子写
 * @property {(treeId: string) => Promise<string[]>} list
 * @property {(treeId: string, line: object) => Promise<void>} appendCallLog 观测层（吞错，绝不影响业务）
 */

/** 内存实现（单测 / 宿主 v0.1 装配回退）。 */
export function memoryStore() {
  /** @type {Map<string, any>} */
  const trees = new Map()
  /** @type {Map<string, object[]>} */
  const callLogs = new Map()
  return {
    async read(treeId) { return trees.has(treeId) ? structuredClone(trees.get(treeId)) : null },
    async write(treeId, state) { trees.set(treeId, structuredClone(state)) },
    async list() { return [...trees.keys()] },
    async appendCallLog(treeId, line) {
      const arr = callLogs.get(treeId) ?? []
      arr.push(line)
      callLogs.set(treeId, arr)
    },
    _callLog: (treeId) => callLogs.get(treeId) ?? [],
  }
}

/** 文件系统实现（每树一目录，tmp+rename 原子写；对齐源引擎布局）。 */
export function fsStore(/** @type {string} */ rootDir) {
  const dirOf = (treeId) => path.join(rootDir, treeId)
  const statePath = (treeId) => path.join(dirOf(treeId), 'tree-state.json')
  const logPath = (treeId) => path.join(dirOf(treeId), 'call-log.jsonl')
  return {
    async read(treeId) {
      try {
        const txt = await fsp.readFile(statePath(treeId), 'utf-8')
        return JSON.parse(txt)
      } catch (/** @type {any} */ e) {
        if (e && e.code === 'ENOENT') return null
        throw e
      }
    },
    async write(treeId, state) {
      await fsp.mkdir(dirOf(treeId), { recursive: true })
      const tmp = statePath(treeId) + '.tmp'
      await fsp.writeFile(tmp, JSON.stringify(state), 'utf-8')
      await fsp.rename(tmp, statePath(treeId))
    },
    async list() {
      try {
        const entries = await fsp.readdir(rootDir, { withFileTypes: true })
        return entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch { return [] }
    },
    async appendCallLog(treeId, line) {
      try { // 双层吞错铁律：观测层绝不影响业务
        await fsp.mkdir(dirOf(treeId), { recursive: true })
        await fsp.appendFile(logPath(treeId), JSON.stringify(line) + '\n', 'utf-8')
      } catch { /* swallow */ }
    },
  }
}
