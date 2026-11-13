/**
 * flash 审计 #1 验收：跨进程写安全（store.withLock 端口 + lock.js 文件锁）。
 * 覆盖任务书验收 (a)-(e) + lock.js 单元语义（元信息/超时/陈旧接管/rename 抢占/nonce 防误删）。
 * 测试尽量确定性：陈旧接管用 mtime/内容 ts 回拨触发，超时用短 timeoutMs（无真实长 sleep）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../src/engine.js'
import { memoryStore, fsStore } from '../src/store.js'
import { acquireTreeLock, releaseTreeLock, tryAcquireTreeLock, lockPathFor, TAKEOVER_LOG_NAME } from '../src/lock.js'
import { VirtualClock } from '../src/clock.js'

const TREE = 'lockx'
const LEAF = 'lockx-C1-worker'
const ROOT = '11111111-1111-4111-8111-111111111111'

const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))
const tmpdir = () => fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-tree-lock-'))
const enoent = (/** @type {any} */ e) => e && e.code === 'ENOENT'

/** fsStore 引擎 + 一树一 worker（session_id=null 的 PENDING 型）。 */
async function seededFs(root) {
  const store = fsStore(root)
  const engine = createEngine({ store, clock: new VirtualClock(1_700_000_000_000) })
  await engine.call('init', [TREE, { goal: 'g' }, { dod: 'd' }, ROOT])
  const add = await engine.call('leaf:add', [TREE, { leaf_id: LEAF, session_id: null, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  assert.equal(add.ok, true, JSON.stringify(add.error))
  return { store, engine }
}

// ── (a) 双引擎（各持 fsStore 同一根）并发 20+20 无丢失更新 ──
test('(a) 双引擎同 fsStore 根并发 20+20 nudge:append == 40；store 层裸读-改-写并发亦无丢失', async () => {
  const root = await tmpdir()
  try {
    const sA = fsStore(root)
    const sB = fsStore(root)
    const engA = createEngine({ store: sA, clock: new VirtualClock(1_700_000_000_000) })
    const engB = createEngine({ store: sB, clock: new VirtualClock(1_700_000_000_000) })
    await engA.call('init', [TREE, {}, {}, ROOT])
    await engA.call('leaf:add', [TREE, { leaf_id: LEAF, session_id: null, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
    const rs = await Promise.all([
      ...times(20, () => engA.call('nudge:append', [TREE, LEAF])),
      ...times(20, () => engB.call('nudge:append', [TREE, LEAF])),
    ])
    assert.ok(rs.every((r) => r.ok === true), JSON.stringify(rs.find((r) => !r.ok)))
    const got = await engA.call('leaf:get', [TREE, LEAF])
    assert.equal(got.leaf.nudge_count, 40, '双引擎并发不得丢失更新')

    // store 层裸读-改-写并发（不经引擎队列/互斥，纯靠文件锁串行）：40 次 +1 必须全数落账
    await Promise.all([
      ...times(20, () => sA.withLock(TREE, async () => { const st = await sA.read(TREE); st.leaves[LEAF].nudge_count += 1; await sA.write(TREE, st) })),
      ...times(20, () => sB.withLock(TREE, async () => { const st = await sB.read(TREE); st.leaves[LEAF].nudge_count += 1; await sB.write(TREE, st) })),
    ])
    assert.equal((await sA.read(TREE)).leaves[LEAF].nudge_count, 80, '无锁时 last-writer-wins 会丢更新，文件锁必须全数落账')
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

// ── (b) 操作完成后锁文件不存在（正常释放）──
test('(b) 操作完成后锁文件不存在（正常释放）', async () => {
  const root = await tmpdir()
  try {
    const { store, engine } = await seededFs(root)
    const r = await engine.call('nudge:append', [TREE, LEAF])
    assert.equal(r.ok, true, JSON.stringify(r.error))
    await assert.rejects(fsp.access(store._lockPath(TREE)), enoent)
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

// ── (c) 手工构造陈旧锁 → 后续操作接管成功并留痕 ──
test('(c) 陈旧锁接管：mtime/内容 ts 超龄残留锁被 rename 抢占，操作成功、接管留痕、锁正常释放', async () => {
  const root = await tmpdir()
  try {
    const { store, engine } = await seededFs(root)
    const lockPath = store._lockPath(TREE)
    // 手工构造「崩溃残留」锁：内容 ts 与 mtime 均为 60s 前（远超缺省 staleMs=15s）
    const staleTs = Date.now() - 60_000
    await fsp.writeFile(lockPath, JSON.stringify({ pid: 424242, host: 'ghost', ts: staleTs, nonce: 'stale-nonce' }), 'utf-8')
    const old = new Date(staleTs)
    await fsp.utimes(lockPath, old, old)
    const r = await engine.call('nudge:append', [TREE, LEAF])
    assert.equal(r.ok, true, JSON.stringify(r.error))
    assert.equal(r.leaf.nudge_count, 1)
    // 接管留痕（best-effort 落盘）
    const log = await fsp.readFile(path.join(root, TREE, TAKEOVER_LOG_NAME), 'utf-8')
    assert.ok(log.includes('tree-state.lock'))
    // 操作完成后锁正常释放
    await assert.rejects(fsp.access(lockPath), enoent)
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

// ── (d) fn 抛错路径：锁释放、后续操作不被阻塞 ──
test('(d) 抛错路径：读失败时锁经 finally 释放，后续操作不被阻塞；store.withLock fn 抛错同理', async () => {
  const root = await tmpdir()
  try {
    const { store, engine } = await seededFs(root)
    const statePath = path.join(root, TREE, 'tree-state.json')
    const good = await store.read(TREE)
    await fsp.writeFile(statePath, '{corrupted', 'utf-8')
    const r = await engine.call('nudge:append', [TREE, LEAF])
    assert.equal(r.ok, false)                                        // 读损坏状态 → 命令失败
    await assert.rejects(fsp.access(store._lockPath(TREE)), enoent)  // 锁已释放
    await store.write(TREE, good)                                    // 修复状态
    const r2 = await engine.call('nudge:append', [TREE, LEAF])       // 后续操作不被阻塞
    assert.equal(r2.ok, true, JSON.stringify(r2.error))
    // store.withLock 直接抛错 → 同样释放
    await assert.rejects(store.withLock(TREE, async () => { throw new Error('boom') }), /boom/)
    assert.equal(await store.withLock(TREE, async () => 'ok'), 'ok')
    await assert.rejects(fsp.access(store._lockPath(TREE)), enoent)
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
})

// ── (e) memoryStore 并发无丢失（in-process 串行）──
test('(e) memoryStore：双引擎并发 20+20 nudge == 40；store.withLock 直接并发亦无丢失', async () => {
  const store = memoryStore()
  const engA = createEngine({ store, clock: new VirtualClock(1) })
  const engB = createEngine({ store, clock: new VirtualClock(1) })
  await engA.call('init', [TREE, {}, {}, ROOT])
  await engA.call('leaf:add', [TREE, { leaf_id: LEAF, session_id: null, parent: `${TREE}-root`, path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  const rs = await Promise.all([
    ...times(20, () => engA.call('nudge:append', [TREE, LEAF])),
    ...times(20, () => engB.call('nudge:append', [TREE, LEAF])),
  ])
  assert.ok(rs.every((r) => r.ok === true), JSON.stringify(rs.find((r) => !r.ok)))
  assert.equal((await engA.call('leaf:get', [TREE, LEAF])).leaf.nudge_count, 40)
  // store 层 withLock 直接并发（不经引擎队列）
  await Promise.all(times(40, () => store.withLock(TREE, async () => { const st = await store.read(TREE); st.leaves[LEAF].nudge_count += 1; await store.write(TREE, st) })))
  assert.equal((await store.read(TREE)).leaves[LEAF].nudge_count, 80)
})

// ── lock.js 单元：拿锁/元信息/tryAcquire/释放/再拿 ──
test('lock 单元：拿锁写元信息 {pid,host,ts,nonce}；tryAcquire 被持时 null；释放后可再拿', async () => {
  const dir = await tmpdir()
  try {
    const h = await acquireTreeLock(dir)
    const content = JSON.parse(await fsp.readFile(lockPathFor(dir), 'utf-8'))
    assert.deepEqual(Object.keys(content).sort(), ['host', 'nonce', 'pid', 'ts'])
    assert.equal(content.pid, process.pid)
    assert.equal(await tryAcquireTreeLock(dir), null)   // 已被持 → null（不阻塞）
    await releaseTreeLock(h)
    await assert.rejects(fsp.access(lockPathFor(dir)), enoent)
    const h2 = await tryAcquireTreeLock(dir)            // 释放后可再拿
    assert.ok(h2 && h2.meta.nonce)
    await releaseTreeLock(h2)
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

// ── lock.js 单元：超时 → E_TREE_LOCK_TIMEOUT（message 含 tree_id 与 lock 路径）──
test('lock 单元：被持且未陈旧 → 超时抛 E_TREE_LOCK_TIMEOUT，message 含 tree_id 与 lock 路径', async () => {
  const dir = await tmpdir()
  try {
    const holder = await acquireTreeLock(dir, { staleMs: 60_000 })
    await assert.rejects(
      acquireTreeLock(dir, { staleMs: 60_000, retryMs: 10, timeoutMs: 150 }),
      (/** @type {any} */ e) => e.code === 'E_TREE_LOCK_TIMEOUT'
        && e.name === 'TreeStateError'
        && e.message.includes(path.basename(dir))
        && e.message.includes(lockPathFor(dir)),
    )
    await releaseTreeLock(holder)
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})

// ── lock.js 单元：陈旧接管 + 双接管者 rename 抢占恰一胜者 + nonce 防误删 ──
test('lock 单元：陈旧锁双接管者 rename 抢占恰一胜者；nonce 不匹配不误删他人新锁', async () => {
  const dir = await tmpdir()
  try {
    await fsp.mkdir(dir, { recursive: true })
    const lockPath = lockPathFor(dir)
    await fsp.writeFile(lockPath, JSON.stringify({ pid: 999999, host: 'ghost', ts: Date.now() - 60_000, nonce: 'stale-nonce' }), 'utf-8')
    const old = new Date(Date.now() - 60_000)
    await fsp.utimes(lockPath, old, old)
    // 双接管者并发：恰一个成功拿锁（takeover 留痕），另一个超时
    const opts = { staleMs: 5_000, retryMs: 10, timeoutMs: 400 }
    const [a, b] = await Promise.allSettled([acquireTreeLock(dir, opts), acquireTreeLock(dir, opts)])
    const fulfilled = a.status === 'fulfilled' ? [a] : []
    const rejected = a.status === 'rejected' ? [a] : []
    if (b.status === 'fulfilled') fulfilled.push(b); else rejected.push(b)
    assert.equal(fulfilled.length, 1, 'rename 抢占必须恰一胜者')
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].reason.code, 'E_TREE_LOCK_TIMEOUT')
    const h = fulfilled[0].value
    assert.ok(h.takeovers.length >= 1, '接管须留痕')
    // 伪造他人句柄（nonce 不匹配）→ 不得删除当前锁
    await releaseTreeLock({ path: h.path, meta: { ...h.meta, nonce: 'forged' } })
    await fsp.access(lockPath)   // 锁仍在（不抛）
    await releaseTreeLock(h)     // 真句柄释放
    await assert.rejects(fsp.access(lockPath), enoent)
  } finally { await fsp.rm(dir, { recursive: true, force: true }) }
})
