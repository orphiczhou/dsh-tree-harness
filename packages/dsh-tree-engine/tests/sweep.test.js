/**
 * sweep 跨模块实例生命周期单测（v0.8.0 P1-C）。
 *
 * 背景：宿主热更 reload 后旧模块实例的 `currentStopSweep` 不可达，旧 sweep interval 成为僵尸。
 * 修复 = globalThis Symbol 注册表（按 dataDir 键）+ start 前停旧。本文件用**注入的 holder**
 * （`{}`）隔离，绝不污染真实 globalThis；锁死三条语义：
 *   ① 两次 start → 第一次被 stop、第二次 active；② stop 幂等；③ 异常不吞。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startManagedSweep, getSweepRegistry, SWEEP_REGISTRY_SYMBOL } from '../src/sweep.js'

/** 假 sweep 启动器：返回可观测的 stop（计次 + 标记停止）。 */
function fakeStart(label, { stopThrows = false } = {}) {
  const state = { label, stops: 0, stopped: false }
  state.value = {
    sweepMode: 'timer',
    stop: () => {
      state.stops += 1
      if (stopThrows) throw new Error(`${label} stop exploded`)
      state.stopped = true
    },
  }
  return state
}

test('两次 start 同 key：第一次被 stop（stoppedPrevious=true / active=false），第二次 active', () => {
  const holder = {}
  const first = fakeStart('first')
  const second = fakeStart('second')

  const h1 = startManagedSweep({ key: 'dir-a', holder, start: () => first.value })
  assert.equal(h1.active, true)
  assert.equal(h1.stoppedPrevious, false)
  assert.equal(first.stops, 0)

  const h2 = startManagedSweep({ key: 'dir-a', holder, start: () => second.value })
  assert.equal(first.stops, 1, 'previous sweep must be stopped before the new one starts')
  assert.equal(first.stopped, true)
  assert.equal(h1.active, false, 'the replaced instance must no longer report active')
  assert.equal(h2.stoppedPrevious, true)
  assert.equal(h2.active, true)
  assert.equal(second.stops, 0)
  assert.equal(getSweepRegistry(holder).size, 1)
})

test('不同 key 互不影响（多 dataDir 同时活跃）', () => {
  const holder = {}
  const a = fakeStart('a')
  const b = fakeStart('b')
  const ha = startManagedSweep({ key: 'dir-a', holder, start: () => a.value })
  const hb = startManagedSweep({ key: 'dir-b', holder, start: () => b.value })
  assert.equal(ha.active, true)
  assert.equal(hb.active, true)
  assert.equal(hb.stoppedPrevious, false)
  assert.equal(a.stops, 0)
  assert.equal(getSweepRegistry(holder).size, 2)
})

test('stop 幂等：原始 stop 只执行一次，第二次返回 false；注册表清理', () => {
  const holder = {}
  const sweep = fakeStart('sweep')
  const h = startManagedSweep({ key: 'dir-a', holder, start: () => sweep.value })
  assert.equal(h.stop(), true)
  assert.equal(h.stop(), false, 'second stop is a no-op')
  assert.equal(sweep.stops, 1)
  assert.equal(h.active, false)
  assert.equal(getSweepRegistry(holder).has('dir-a'), false)
})

test('start 抛错不吞：异常向上传播且该 key 不注册', () => {
  const holder = {}
  assert.throws(() => startManagedSweep({ key: 'dir-a', holder, start: () => { throw new Error('start exploded') } }), /start exploded/)
  assert.equal(getSweepRegistry(holder).has('dir-a'), false)
})

test('旧 sweep stop 抛错且无 onError → 异常不吞（向上抛），旧条目保留不被静默清掉', () => {
  const holder = {}
  const bad = fakeStart('bad', { stopThrows: true })
  const h1 = startManagedSweep({ key: 'dir-a', holder, start: () => bad.value })
  const fresh = fakeStart('fresh')
  assert.throws(() => startManagedSweep({ key: 'dir-a', holder, start: () => fresh.value }), /bad stop exploded/)
  assert.equal(bad.stops, 1)
  assert.equal(fresh.stops, 0, 'new sweep must not start when the old one could not be stopped')
  assert.equal(getSweepRegistry(holder).get('dir-a')?.value, h1.value, 'the previous entry must stay registered until it is actually stopped')
  assert.equal(h1.active, true)
})

test('旧 sweep stop 抛错但有 onError 钩子 → 钩子收到错误，新 sweep 照常启动', () => {
  const holder = {}
  const bad = fakeStart('bad', { stopThrows: true })
  startManagedSweep({ key: 'dir-a', holder, start: () => bad.value })
  const fresh = fakeStart('fresh')
  const errors = []
  const h2 = startManagedSweep({
    key: 'dir-a',
    holder,
    start: () => fresh.value,
    onError: (e, info) => errors.push({ message: e.message, phase: info.phase, key: info.key }),
  })
  assert.deepEqual(errors, [{ message: 'bad stop exploded', phase: 'stop-previous', key: 'dir-a' }])
  assert.equal(h2.stoppedPrevious, true)
  assert.equal(h2.active, true)
  assert.equal(getSweepRegistry(holder).size, 1)
})

test('默认 holder=globalThis：注册表挂在 Symbol.for("dsh-tree-engine.sweeps") 上', () => {
  // 用唯一 key，避免与同进程其它测试串扰；结束后 stop 清理。
  const key = `sweep-test-${process.pid}-${Date.now()}`
  const sweep = fakeStart('global')
  const h = startManagedSweep({ key, start: () => sweep.value })
  try {
    assert.equal(SWEEP_REGISTRY_SYMBOL, Symbol.for('dsh-tree-engine.sweeps'))
    const registry = globalThis[SWEEP_REGISTRY_SYMBOL]
    assert.ok(registry instanceof Map, 'cross-instance registry must live on globalThis under the shared symbol')
    assert.equal(registry.get(key)?.stop, sweep.value.stop)
    assert.equal(h.active, true)
  } finally {
    h.stop()
  }
  assert.equal(globalThis[SWEEP_REGISTRY_SYMBOL].has(key), false)
})

test('入参校验：空 key / start 非函数 → TypeError（不静默）', () => {
  assert.throws(() => startManagedSweep({ key: '', start: () => ({}) }), TypeError)
  assert.throws(() => startManagedSweep({ start: () => ({}) }), TypeError)
  assert.throws(() => startManagedSweep({ key: 'dir-a', start: null }), TypeError)
})
