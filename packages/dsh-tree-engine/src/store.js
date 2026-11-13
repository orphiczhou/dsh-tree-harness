/**
 * 树状态持久化端口（冻结版 §4.1：优先 storageDomain，回退插件数据目录直写）。
 * 核心只依赖本端口；宿主装配层决定落点。原子写语义（tmp+rename）由实现保证。
 * 观测铁律继承：call-log append-only、绝不进 tree-state。
 *
 * flash 审计 #1：端口新增可选 withLock(treeId, fn)——读-改-写临界区的跨进程互斥。
 *   fsStore   → lock.js 文件锁（跨进程；活持有者心跳刷新 mtime，崩溃残留锁可陈旧接管）；
 *   memoryStore → 每树 promise 链互斥（in-process 串行）；
 *   未实现 withLock 的旧实现保持兼容（引擎侧直跑，行为=基线）。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { acquireTreeLock, releaseTreeLock, lockPathFor, DEFAULT_LOCK_OPTS } from './lock.js'

/**
 * @typedef {Object} TreeStore
 * @property {(treeId: string) => Promise<any|null>} read        null = 树不存在
 * @property {(treeId: string, state: any) => Promise<void>} write 原子写
 * @property {(treeId: string) => Promise<string[]>} list
 * @property {(treeId: string, line: object) => Promise<void>} appendCallLog 观测层（吞错，绝不影响业务）
 * @property {(treeId: string, fn: () => Promise<T>) => Promise<T>} [withLock] 可选：临界区互斥（fn 内自行 read/write）
 */

/** 内存实现（单测 / 宿主 v0.1 装配回退）。 */
export function memoryStore() {
  /** @type {Map<string, any>} */
  const trees = new Map()
  /** @type {Map<string, object[]>} */
  const callLogs = new Map()
  /** @type {Map<string, Promise<unknown>>} per-tree 互斥链（withLock 专用；与 queue.js 正交） */
  const lockTails = new Map()
  return {
    async read(treeId) { return trees.has(treeId) ? structuredClone(trees.get(treeId)) : null },
    async write(treeId, state) { trees.set(treeId, structuredClone(state)) },
    async list() { return [...trees.keys()] },
    async appendCallLog(treeId, line) {
      const arr = callLogs.get(treeId) ?? []
      arr.push(line)
      callLogs.set(treeId, arr)
    },
    /** 每树 promise 链互斥：同一 tree 的临界区按提交序串行；失败不毒化后续。 */
    async withLock(treeId, fn) {
      const prev = lockTails.get(treeId) ?? Promise.resolve()
      const run = prev.catch(() => {}).then(() => fn())
      const tail = run.catch(() => {})
      lockTails.set(treeId, tail)
      void tail.then(() => { if (lockTails.get(treeId) === tail) lockTails.delete(treeId) }).catch(() => {})
      return run
    },
    _callLog: (treeId) => callLogs.get(treeId) ?? [],
  }
}

/** 文件系统实现（每树一目录，tmp+rename 原子写；对齐源引擎布局）。 */
export function fsStore(/** @type {string} */ rootDir, /** @type {Partial<typeof DEFAULT_LOCK_OPTS>} */ lockOpts = {}) {
  const dirOf = (treeId) => path.join(rootDir, treeId)
  const statePath = (treeId) => path.join(dirOf(treeId), 'tree-state.json')
  const logPath = (treeId) => path.join(dirOf(treeId), 'call-log.jsonl')
  const lockOptions = { ...DEFAULT_LOCK_OPTS, ...lockOpts }
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
    /**
     * 跨进程临界区（flash 审计 #1）：acquire 文件锁 → fn（内部 read+write）→ finally release。
     * 持有期心跳刷新锁 mtime（staleMs/2 封顶 5s）——长临界区（如 dispatch 端口调用）不会被误判陈旧。
     * fn 抛错 / 进程崩溃均不残留锁（finally 释放；崩溃锁经陈旧接管回收）。
     */
    async withLock(treeId, fn) {
      await fsp.mkdir(dirOf(treeId), { recursive: true })
      const handle = await acquireTreeLock(dirOf(treeId), lockOptions)
      // R1 复核（2026-11-13）：心跳间隔 = staleMs/3（下限 100ms，上限 5s）。旧实现下限 1000ms，
      // 当调用方把 staleMs 调到 <1s 时活持有者来不及首轮心跳就会被判陈旧 → 双临界区并发。
      // 现在 staleMs/3 保证任何配置下心跳至少比陈旧窗口快 3 倍。
      const touchMs = Math.max(100, Math.min(5000, Math.floor(lockOptions.staleMs / 3)))
      const touch = setInterval(() => { fsp.utimes(handle.path, new Date(), new Date()).catch(() => {}) }, touchMs)
      if (typeof touch.unref === 'function') touch.unref()
      try {
        return await fn()
      } finally {
        clearInterval(touch)
        await releaseTreeLock(handle)
      }
    },
    /** 测试钩子：锁文件路径（验收测试 (b)/(c) 断言锁存在性）。 */
    _lockPath: (treeId) => lockPathFor(dirOf(treeId)),
  }
}
