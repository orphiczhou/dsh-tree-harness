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

/** call-log 单文件上限（flash 审计 #4/#30：无界 append 会长期膨胀；超限滚动保留 1 份）。 */
export const CALL_LOG_MAX_BYTES = 10 * 1024 * 1024

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
  /** call-log 追加（read 的灾备恢复留痕与 appendCallLog 端口共用；双层吞错铁律）。 */
  async function appendCallLogLine(treeId, line) {
    try {
      await fsp.mkdir(dirOf(treeId), { recursive: true })
      const p = logPath(treeId)
      // flash 审计 #4/#30：10MB 滚动（rename → .1，旧 .1 覆盖）。旧实现 appendFile 无大小检查，长跑树无界膨胀。
      try {
        const st = await fsp.stat(p)
        if (st.size >= CALL_LOG_MAX_BYTES) {
          await fsp.unlink(p + '.1').catch(() => {})
          await fsp.rename(p, p + '.1').catch(() => {})
        }
      } catch { /* 文件不存在 / stat 失败：直接 append */ }
      await fsp.appendFile(p, JSON.stringify(line) + '\n', 'utf-8')
    } catch { /* swallow */ }
  }
  return {
    async read(treeId) {
      const primary = statePath(treeId)
      const parse = async (/** @type {string} */ p) => JSON.parse(await fsp.readFile(p, 'utf-8'))
      try {
        return await parse(primary)
      } catch (/** @type {any} */ e) {
        if (e && e.code === 'ENOENT') {
          // 主文件缺失：若存在 write() 的原子写残留（writeFile 成功、rename 前崩溃）→ 只读恢复。
          try { return await parse(primary + '.tmp') } catch { return null }
        }
        // flash 审计 #28：主文件损坏（写中断/半截 JSON）时，旧实现整棵树 read 抛错 → 所有操作死锁。
        // 回退尝试 .tmp 原子写副本（下次 write 会把修复后的 state 落回主文件）；失败才抛原错误。
        // R1 复核 P2-3（2026-11-13）：灾备恢复**不得静默**——保留损坏原件副本（取证）+ call-log 留痕
        // （state.recovered 含来源/损坏副本路径/解析错误摘要）。
        try {
          const recovered = await parse(primary + '.tmp')
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const corruptCopy = `${primary}.corrupt-${stamp}`
          await fsp.copyFile(primary, corruptCopy).catch(() => {})
          await appendCallLogLine(treeId, {
            ts: new Date().toISOString(), event: 'state.recovered', source: `${primary}.tmp`,
            corrupt_copy: corruptCopy, error: String(e?.message ?? e).slice(0, 300),
          })
          return recovered
        } catch { throw e }
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
      await appendCallLogLine(treeId, line)
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
