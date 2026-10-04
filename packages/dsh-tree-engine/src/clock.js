/**
 * 时钟/定时器注入缝（冻结版 §4.1：假时钟断言载体；引擎核心不 import DSH API）。
 * 生产装配：now = Date.now, scheduleInterval = ctx.timer.interval 适配。
 * 测试装配：虚拟时钟（可控时刻 + 手动 tick）。
 */

/**
 * @typedef {Object} Clock
 * @property {() => number} now
 * @property {(cb: () => void, ms: number) => () => void} scheduleInterval  返回取消函数
 */

/** @returns {Clock} */
export function systemClock() {
  return {
    now: () => Date.now(),
    scheduleInterval: (cb, ms) => {
      const t = setInterval(cb, ms)
      return () => clearInterval(t)
    },
  }
}

/** 虚拟时钟（S1 假时钟断言载体：可控时刻 + 手动 tick）。 */
export class VirtualClock {
  constructor(/** @type {number} */ startMs = 0) {
    this.t = startMs
    this.timers = []
  }
  now() { return this.t }
  /** 注册周期定时器，返回取消函数。 */
  scheduleInterval(cb, ms) {
    const timer = { cb, ms, next: this.t + ms, cancelled: false }
    this.timers.push(timer)
    return () => { timer.cancelled = true }
  }
  /** 推进时间并触发到期定时器（sweep 断言：手动 tick 驱动周期性）。 */
  advance(ms) {
    const target = this.t + ms
    // 简单轮：足够测试用（每轮触发至多一次回调）
    for (;;) {
      const due = this.timers.filter((tm) => !tm.cancelled && tm.next <= target)
      if (due.length === 0) break
      due.sort((a, b) => a.next - b.next)
      const first = due[0]
      this.t = first.next
      first.next += first.ms
      first.cb()
    }
    this.t = target
  }
  /** 虚拟时钟不占宿主定时器。 */
  get activeTimers() { return this.timers.filter((t) => !t.cancelled).length }
}
