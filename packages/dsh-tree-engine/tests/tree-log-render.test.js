/**
 * tree_log 工具面 render 机读化单测（A2）。
 * 只测 index.js TREE_LOG.output.render 的纯函数输出——不装配宿主、不写 IO。
 * 核心诉求：events 的 done 事件 meta（summary/probe_result 等）可被调用方直接读到；
 * 事件过多时只渲染尾部 50 条，超长 meta 单行截断，输出长度受控。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../index.js'

const treeLog = TOOLS.find((t) => t.name === 'tree_log')
assert.ok(treeLog, 'TOOLS 中必须有 tree_log')

const render = (value) => treeLog.output.render(undefined, value).map((x) => x.text).join('\n')

test('tree_log events render：done 事件 meta 可机读（probe_result 与 DENIED 可见）', () => {
  const text = render({
    events: [{ leaf_id: 'x-C1-commander', type: 'done', ts: '2026-11-13T00:00:00Z', meta: { summary: 'ok', probe_result: 'DENIED' } }],
  })
  const lines = text.split('\n')
  assert.equal(lines[0], 'tree_log: 1 event(s)')
  assert.equal(lines.length, 2)
  assert.equal(lines[1], '[2026-11-13T00:00:00Z] x-C1-commander done meta={"summary":"ok","probe_result":"DENIED"}')
  assert.match(text, /probe_result/)
  assert.match(text, /DENIED/)
})

test('tree_log events render：60 条只渲染最后 50 条 + 截断提示，尾部 done meta 仍在', () => {
  const events = []
  for (let i = 0; i < 59; i++) {
    events.push({
      leaf_id: 'x-C1-worker',
      type: `ev${String(i).padStart(2, '0')}`,
      ts: `2026-11-13T00:00:${String(i).padStart(2, '0')}Z`,
      meta: { i },
    })
  }
  events.push({ leaf_id: 'x-C1-commander', type: 'done', ts: '2026-11-13T00:01:00Z', meta: { summary: 'tail-ok' } })

  const text = render({ events: events })
  const lines = text.split('\n')
  assert.equal(lines[0], 'tree_log: 60 event(s)')
  assert.equal(lines.length, 52, '计数行 + 最后 50 条 + 1 行截断提示')
  // 只含最后 50 条：ev10..ev58 + 尾部 done；更早的 ev00..ev09 不渲染
  assert.ok(!text.includes('ev09'), 'ev09（第 10 条）应被截断')
  assert.ok(text.includes(' ev10 '), 'ev10 是保留窗口的第一条')
  assert.ok(text.includes(' ev58 '), 'ev58 是保留窗口的倒数第二条（原始顺序）')
  assert.match(lines[1], /^\[2026-11-13T00:00:10Z\] x-C1-worker ev10 meta=\{"i":10\}$/)
  assert.equal(lines[51], '…(+10 earlier events truncated; use leaf_id/type filters)')
  // 尾部 done 事件（含 meta）必须是最后一条数据行且完整可读
  assert.equal(lines[50], '[2026-11-13T00:01:00Z] x-C1-commander done meta={"summary":"tail-ok"}')
})

test('tree_log events render：超长 meta 单行截断（…(+K chars) 结尾，行长度受控）', () => {
  const longValue = 'x'.repeat(2000)
  const json = JSON.stringify({ summary: longValue })
  const text = render({
    events: [{ leaf_id: 'x-C1-worker', type: 'done', ts: '2026-11-13T00:00:00Z', meta: { summary: longValue } }],
  })
  const lines = text.split('\n')
  assert.equal(lines.length, 2, 'meta 内的长字符串不得引入换行')
  const line = lines[1]
  assert.ok(json.length > 800, '前置条件：原始紧凑 JSON 超过 800 字符')
  assert.match(line, /…\(\+\d+ chars\)$/)
  assert.ok(line.endsWith(`…(+${json.length - 800} chars)`), 'K = 原始紧凑 JSON 长度 - 800')
  assert.ok(line.length < 1000, `单行长度应受控（实际 ${line.length}）`)
})

test('tree_log drift / heartbeat / communication render：一行一条、关键字段可见', () => {
  const drift = render({
    drifts: [{ ts: '2026-11-13T01:00:00Z', leaf_id: 'x-C1-worker', kind: 'rhythm', severity: 'mid', action: 'declare', reason: 'heartbeat frozen verdict' }],
  })
  assert.equal(drift.split('\n')[0], 'tree_log: 1 drift(s)')
  assert.equal(
    drift.split('\n')[1],
    '[2026-11-13T01:00:00Z] x-C1-worker kind=rhythm severity=mid action=declare reason="heartbeat frozen verdict"',
  )

  const heartbeat = render({
    heartbeats: [{ ts: '2026-11-13T02:00:00Z', verdicts: [{ leaf_id: 'x-C1-worker', verdict: 'frozen' }] }],
  })
  assert.equal(heartbeat.split('\n')[0], 'tree_log: 1 heartbeat(s)')
  assert.equal(
    heartbeat.split('\n')[1],
    '[2026-11-13T02:00:00Z] heartbeat verdicts=[{"leaf_id":"x-C1-worker","verdict":"frozen"}]',
  )

  const communication = render({
    communications: [{
      ts: '2026-11-13T03:00:00Z', leaf_id: 'x-C1-commander', from: 'session-a',
      target_session_id: 'session-b', direction: 'out', note: 'relay brief',
    }],
  })
  assert.equal(communication.split('\n')[0], 'tree_log: 1 communication(s)')
  assert.equal(
    communication.split('\n')[1],
    '[2026-11-13T03:00:00Z] x-C1-commander from=session-a target=session-b direction=out note="relay brief"',
  )
})

test('tree_log 空结果：计数为 0 且不抛错；空 meta 对象省略 meta=', () => {
  assert.equal(render({ events: [] }), 'tree_log: 0 event(s)')
  assert.equal(render({ drifts: [] }), 'tree_log: 0 drift(s)')
  assert.doesNotThrow(() => treeLog.output.render(undefined, undefined))
  assert.equal(render(undefined), 'tree_log: 0 event(s)')
  assert.equal(render({}), 'tree_log: 0 event(s)')

  const text = render({ events: [{ leaf_id: 'x-C1-worker', type: 'progress', ts: '2026-11-13T04:00:00Z', meta: {} }] })
  assert.equal(text.split('\n')[1], '[2026-11-13T04:00:00Z] x-C1-worker progress')
  assert.ok(!text.includes('meta='), '空对象 meta 不应渲染 meta=')
})
