#!/usr/bin/env node
/**
 * handoff-prompt.test.mjs — 接替提示识别的 zh/en 双语言回归（node --test）。
 *
 * 锁死 2026-11-13 真机 E2E 暴露的缺陷：验证器只认英文措辞，
 * 中文界面（locale.preference=zh）下 session_handoff 的接替提示被误判为非交接提示。
 *
 * 运行：node --test scripts/e2e/lib/handoff-prompt.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeHandoffPrompt, analyzeHandoffText } from './handoff-prompt.mjs'

// 与 packages/dsh-session-tree/index.js buildSuccessorPrompt 的 zh 分支逐字对齐。
const ZH_PROMPT = [
  '你是 session-bff3c54c-a11e-4efe-bf4f-d254af6075cc 的接替会话。上一个会话因上下文预算接近上限而把工作交棒给你。',
  '',
  '请先读取交接文件：D:\\Codes\\dsh-tree-harness\\HANDOFF-bff3c54c-20261113-010944.md',
  '',
  '文件中记录了任务、当前状态、决策、变更文件、下一步与未决问题。',
  '请从「下一步」继续推进：不要重做文件中已记为完成的工作，保持相同的工作目录与',
  '模型/思考等级，并用一小段话说明你接下来要做什么。',
].join('\n')

// 与 buildSuccessorPrompt 的 en 分支逐字对齐。
const EN_PROMPT = [
  'You are the successor session for session-bff3c54c-a11e-4efe-bf4f-d254af6075cc, which handed off because its context budget is nearly full.',
  '',
  'First read the handoff file at: D:\\Codes\\dsh-tree-harness\\HANDOFF-bff3c54c-20261113-010944.md',
  '',
  'It records the task, current status, decisions, changed files, next steps and open questions.',
  'Then continue advancing the work from its next steps: do not redo work the handoff records',
  'as done, keep the same working directory and model/effort, and begin by stating in one short',
  'paragraph what you will do next.',
].join('\n')

test('zh：中文接替提示被识别，源会话从提示里点名', () => {
  const prompt = analyzeHandoffText(ZH_PROMPT)
  assert.equal(prompt.isHandoffPrompt, true)
  assert.equal(prompt.language, 'zh')
  assert.equal(prompt.namedSource, 'session-bff3c54c-a11e-4efe-bf4f-d254af6075cc')
  assert.equal(
    prompt.handoffFileMentioned,
    'D:\\Codes\\dsh-tree-harness\\HANDOFF-bff3c54c-20261113-010944.md',
  )
})

test('en：英文接替提示保持原有识别行为（不回归）', () => {
  const prompt = analyzeHandoffText(EN_PROMPT)
  assert.equal(prompt.isHandoffPrompt, true)
  assert.equal(prompt.language, 'en')
  assert.equal(prompt.namedSource, 'session-bff3c54c-a11e-4efe-bf4f-d254af6075cc')
  assert.equal(
    prompt.handoffFileMentioned,
    'D:\\Codes\\dsh-tree-harness\\HANDOFF-bff3c54c-20261113-010944.md',
  )
})

test('zh 兜底 origin（「上一个会话」）：仍是交接提示，但不点名源', () => {
  const text = [
    '你是 上一个会话 的接替会话。上一个会话因上下文预算接近上限而把工作交棒给你。',
    '',
    '请先读取交接文件：D:\\Codes\\dsh-tree-harness\\HANDOFF-unknown-20261113-010944.md',
  ].join('\n')
  const prompt = analyzeHandoffText(text)
  assert.equal(prompt.isHandoffPrompt, true)
  assert.equal(prompt.language, 'zh')
  assert.equal(prompt.namedSource, null)
  assert.equal(
    prompt.handoffFileMentioned,
    'D:\\Codes\\dsh-tree-harness\\HANDOFF-unknown-20261113-010944.md',
  )
})

test('普通用户消息（提到 HANDOFF 文件但非交接提示）：不误判', () => {
  const text = '帮我看看 D:\\Codes\\dsh-tree-harness\\HANDOFF-bff3c54c-20261113-010944.md 这个文件写了什么。'
  const prompt = analyzeHandoffText(text)
  assert.equal(prompt.isHandoffPrompt, false)
  assert.equal(prompt.language, null)
  assert.equal(prompt.namedSource, null)
})

test('两种语言的半截措辞都不算交接提示（subject+file 必须同时命中）', () => {
  const onlySubject = analyzeHandoffText('你是 上一个会话 的接替会话。')
  assert.equal(onlySubject.isHandoffPrompt, false)
  const onlyFile = analyzeHandoffText('请先读取交接文件：HANDOFF-x.md')
  assert.equal(onlyFile.isHandoffPrompt, false)
})

test('analyzeHandoffPrompt：从 session summary 取 firstUserMessage.text', () => {
  const prompt = analyzeHandoffPrompt({ firstUserMessage: { text: ZH_PROMPT, seq: 10 } })
  assert.equal(prompt.isHandoffPrompt, true)
  assert.equal(prompt.language, 'zh')
  const empty = analyzeHandoffPrompt({})
  assert.equal(empty.isHandoffPrompt, false)
  assert.equal(empty.handoffFileMentioned, null)
  // firstUserMessage 的 text 超长时只保留 600 字符预览（报告体积保护）
  const long = analyzeHandoffPrompt({ firstUserMessage: { text: '你是 x 的接替会话。请先读取交接文件：' + 'HANDOFF-x.md\n' + 'y'.repeat(2000) } })
  assert.equal(long.textHead.length, 600)
})
