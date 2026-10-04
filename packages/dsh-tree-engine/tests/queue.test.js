/** S1 第一批单测：per-tree 串行队列 + 虚拟时钟（假时钟断言载体）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enqueue, resetQueues } from '../src/queue.js'
import { VirtualClock } from '../src/clock.js'

test('同 tree 串行：并发调用按提交序执行，无交错', async () => {
  resetQueues()
  const order = []
  await Promise.all([
    enqueue('t1', async () => { order.push('a-start'); await new Promise((r) => setTimeout(r, 20)); order.push('a-end') }),
    enqueue('t1', async () => { order.push('b-start'); await new Promise((r) => setTimeout(r, 5)); order.push('b-end') }),
    enqueue('t1', async () => { order.push('c-start'); order.push('c-end') }),
  ])
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end'])
})

test('异 tree 并行：互不阻塞', async () => {
  resetQueues()
  const order = []
  await Promise.all([
    enqueue('t1', async () => { order.push('t1-start'); await new Promise((r) => setTimeout(r, 30)); order.push('t1-end') }),
    enqueue('t2', async () => { order.push('t2-start'); await new Promise((r) => setTimeout(r, 5)); order.push('t2-end') }),
  ])
  assert.deepEqual(order, ['t1-start', 't2-start', 't2-end', 't1-end'])
})

test('临界区抛错不毒化队列：后续调用照常', async () => {
  resetQueues()
  await enqueue('t', async () => { throw new Error('boom') }).catch(() => {})
  const r = await enqueue('t', async () => 42)
  assert.equal(r, 42)
})

test('虚拟时钟：周期回调按 advance 手动 tick，取消函数生效', () => {
  const clock = new VirtualClock(1000)
  let ticks = 0
  const cancel = clock.scheduleInterval(() => { ticks += 1 }, 100)
  assert.equal(ticks, 0)
  clock.advance(50)
  assert.equal(ticks, 0)
  clock.advance(60)   // 跨过 1100 触发点
  assert.equal(ticks, 1)
  clock.advance(100)  // 到 1210，再触发一次（1200）
  assert.equal(ticks, 2)
  cancel()
  clock.advance(1000)
  assert.equal(ticks, 2)
  assert.equal(clock.activeTimers, 0)
  assert.equal(clock.now(), 1000 + 50 + 60 + 100 + 1000)
})
