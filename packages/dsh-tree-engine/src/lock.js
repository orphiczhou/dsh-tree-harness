/**
 * 跨进程文件锁（flash 审计 #1：store 规约承诺的 .lock 文件锁实现）。
 * 纯 Node fs，无 DSH 依赖（仅复用 state.js 的 treeError 以对齐 TreeStateError 形态）。
 *
 * 语义：
 *  - acquireTreeLock(dir, opts)：fs.open('wx')（O_EXCL）原子建锁，被持 → retryMs 退避重试至 timeoutMs；
 *    超时抛 TreeStateError + code=E_TREE_LOCK_TIMEOUT（message 含 tree_id 与 lock 路径）。
 *  - 锁内容 = 持有者元信息 {pid, host, ts, nonce}；release 仅当文件内容 nonce 与句柄一致才删除（防误删他人新锁）。
 *  - 陈旧锁接管：锁文件 mtime/内容 ts 超过 staleMs（缺省 15s）→ rename 抢占（唯一临时名，成功者继续、失败者重试），
 *    接管留痕（句柄 takeovers + best-effort 落盘 tree-lock-takeover.log）。
 *  - 持有期间心跳（fsStore.withLock 侧）：周期性 utimes 刷新 mtime，活持有者不会被误判陈旧（长临界区安全）。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { treeError } from './state.js'

export const LOCK_FILE_NAME = 'tree-state.lock'
export const TAKEOVER_LOG_NAME = 'tree-lock-takeover.log'

/** 缺省锁参数：staleMs 15s（陈旧接管窗口）、retryMs 50、timeoutMs 30s。 */
export const DEFAULT_LOCK_OPTS = Object.freeze({ staleMs: 15_000, retryMs: 50, timeoutMs: 30_000 })

/** @param {string} dir 树目录 @returns {string} 锁文件路径 */
export function lockPathFor(dir) {
  return path.join(dir, LOCK_FILE_NAME)
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))
const newNonce = () => crypto.randomBytes(8).toString('hex')
const isEnoent = (/** @type {any} */ e) => e && e.code === 'ENOENT'

/** 一次性建锁（O_EXCL）。成功 → 句柄；EEXIST → null；其余错误上抛。 */
async function openExclusive(/** @type {string} */ dir) {
  await fsp.mkdir(dir, { recursive: true })
  const lockPath = lockPathFor(dir)
  const meta = { pid: process.pid, host: os.hostname(), ts: Date.now(), nonce: newNonce() }
  try {
    await fsp.writeFile(lockPath, JSON.stringify(meta), { flag: 'wx' })
  } catch (/** @type {any} */ e) {
    if (e && e.code === 'EEXIST') return null
    throw e
  }
  return { path: lockPath, meta, takeovers: [], release: null }
}

/**
 * 一次性尝试拿锁（供测试与 acquireTreeLock 内部分步语义）。
 * @param {string} dir
 * @returns {Promise<object|null>} 句柄或 null（已被持锁）
 */
export async function tryAcquireTreeLock(/** @type {string} */ dir) {
  const h = await openExclusive(dir)
  if (!h) return null
  h.release = () => releaseTreeLock(h)
  return h
}

/** 读锁内容元信息（解析失败/缺失 → null）。 */
async function readLockMeta(/** @type {string} */ lockPath) {
  try {
    const txt = await fsp.readFile(lockPath, 'utf-8')
    try { return JSON.parse(txt) } catch { return null }
  } catch (/** @type {any} */ e) {
    if (isEnoent(e)) return null
    return null
  }
}

/**
 * 释放锁：仅当锁文件当前内容 nonce 与句柄一致才删除（防误删他人新锁）。
 * 锁已被接管（rename 走）/已不存在 → 静默。
 */
export async function releaseTreeLock(/** @type {any} */ handle) {
  if (!handle || typeof handle.path !== 'string' || !handle.meta?.nonce) return
  const cur = await readLockMeta(handle.path)
  if (cur && cur.nonce === handle.meta.nonce) {
    await fsp.unlink(handle.path).catch((/** @type {any} */ e) => { if (!isEnoent(e)) throw e })
  }
}

/**
 * 陈旧锁 rename 抢占：把 stale 锁 rename 到唯一临时名（唯一成功者），
 * 成功者记录接管并清理临时文件，失败者（ENOENT/EPERM 等）返回 false 继续正常重试。
 * @returns {Promise<boolean>} 是否抢占成功
 */
async function tryTakeover(/** @type {string} */ dir, /** @type {string} */ lockPath) {
  const tempName = `${lockPath}.stale-${process.pid}-${newNonce()}`
  try {
    await fsp.rename(lockPath, tempName)
  } catch {
    return false
  }
  await fsp.appendFile(path.join(dir, TAKEOVER_LOG_NAME), JSON.stringify({ ts: Date.now(), lockPath, pid: process.pid, host: os.hostname() }) + '\n').catch(() => {})
  await fsp.unlink(tempName).catch(() => {})
  return true
}

/** 锁陈旧性采样：mtime 与内容 ts 取新（任何一面新鲜即不陈旧；文件消失 → 不存在）。 */
async function lockStaleness(/** @type {string} */ lockPath) {
  try {
    const st = await fsp.stat(lockPath)
    const meta = await readLockMeta(lockPath)
    return { exists: true, mtimeMs: st.mtimeMs, contentTs: typeof meta?.ts === 'number' ? meta.ts : null }
  } catch {
    return { exists: false, mtimeMs: null, contentTs: null }
  }
}

/**
 * 阻塞式拿锁（含陈旧接管与超时）。
 * @param {string} dir 树目录（basename 即 tree_id，用于错误信息）
 * @param {{staleMs?: number, retryMs?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{path: string, meta: object, takeovers: object[], release: () => Promise<void>}>}
 */
export async function acquireTreeLock(/** @type {string} */ dir, opts = {}) {
  const { staleMs, retryMs, timeoutMs } = { ...DEFAULT_LOCK_OPTS, ...opts }
  await fsp.mkdir(dir, { recursive: true })
  const lockPath = lockPathFor(dir)
  const deadline = Date.now() + timeoutMs
  const takeovers = []
  for (;;) {
    const h = await tryAcquireTreeLock(dir)
    if (h) { h.takeovers = takeovers; return h }
    const st = await lockStaleness(lockPath)
    if (st.exists) {
      const age = Date.now() - Math.max(st.mtimeMs, st.contentTs ?? 0)
      if (age > staleMs) {
        const won = await tryTakeover(dir, lockPath)
        if (won) {
          takeovers.push({ ts: Date.now(), path: lockPath })
          const h2 = await tryAcquireTreeLock(dir)
          if (h2) { h2.takeovers = takeovers; return h2 }
        }
      }
    }
    if (Date.now() >= deadline) {
      treeError('E_TREE_LOCK_TIMEOUT', `tree lock acquire timeout for tree "${path.basename(dir)}" (lock path: ${lockPath}; timeoutMs=${timeoutMs}, staleMs=${staleMs})`)
    }
    await sleep(retryMs)
  }
}
