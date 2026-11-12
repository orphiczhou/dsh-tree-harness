#!/usr/bin/env node
/**
 * handoff-prompt.mjs — session_handoff 接替提示的「语言无关」识别（zh / en）。
 *
 * 背景（2026-11-13 真机 E2E 暴露）：
 *   session-tree v1.3.1 起，`session_handoff` 的接替提示跟随 DSH 界面语言生成
 *   （packages/dsh-session-tree/index.js `buildSuccessorPrompt`，zh/en 两套措辞），
 *   而 `scripts/e2e/verify-handoff.mjs` 早期只认英文措辞——
 *   `You are the successor session for` / `First read the handoff file at`。
 *   中文界面下真机 E2E 因此假 FAIL 两条断言：
 *     - handoff_prompt_present（isHandoffPrompt=false）
 *     - handoff_prompt_names_source（namedSource=null）
 *   本模块把识别规则集中到一处并导出，供 verify-handoff.mjs 消费与单测锁定。
 *
 * 只做纯文本判定：不读日志、不碰文件系统，便于 `node --test` 直接测。
 */

/** 交接文件路径：Windows 绝对路径（可含中文/短横线目录）或裸 HANDOFF-*.md。 */
export const HANDOFF_FILE_RE =
  /([A-Za-z]:\\[^\s"'<>]*?HANDOFF[^\s"'<>\\]*\.md)|HANDOFF[-A-Za-z0-9._]*\.md/i

/** 单条语言识别规则：subject/file 同时命中才算交接提示；source 用于绑定源会话。 */
export const HANDOFF_PROMPT_PATTERNS = {
  en: {
    subject: /You are the successor session for/i,
    file: /First read the handoff file at/i,
    source: /You are the successor session for\s+([A-Za-z0-9._:-]+)/i,
  },
  zh: {
    // 「你是 <origin> 的接替会话。」——origin 可能是 session-<uuid>，也可能是「上一个会话」兜底。
    subject: /你是[^\n。]{0,160}的接替会话/,
    file: /读取交接文件/,
    source:
      /你是\s*(session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*的接替会话/i,
  },
}

/**
 * 识别一段接替提示文本。
 *
 * @param {string} text - successor 首条 user/message 文本
 * @returns {{textHead: string, isHandoffPrompt: boolean, language: 'zh'|'en'|null,
 *            namedSource: string|null, handoffFileMentioned: string|null}}
 *   - `isHandoffPrompt`：命中任一语言的 subject + file 措辞（语言无关判定）；
 *   - `language`：命中的语言；两种都不命中为 null；
 *   - `namedSource`：提示点名的源会话 id（原样，带 `session-` 前缀时可被调用方归一化）；
 *     origin 是兜底文案（如「上一个会话」/「the previous session」）时为 null；
 *   - `handoffFileMentioned`：提示里出现的 HANDOFF 文件路径（绝对或裸文件名）。
 */
export function analyzeHandoffText(text) {
  const value = typeof text === 'string' ? text : ''
  let language = null
  let namedSource = null
  for (const [lang, patterns] of Object.entries(HANDOFF_PROMPT_PATTERNS)) {
    if (!patterns.subject.test(value) || !patterns.file.test(value)) continue
    language = lang
    const srcMatch = value.match(patterns.source)
    if (srcMatch) namedSource = srcMatch[1]
    break
  }
  const fileMatch = value.match(HANDOFF_FILE_RE)
  return {
    textHead: value.slice(0, 600),
    isHandoffPrompt: language !== null,
    language,
    namedSource,
    handoffFileMentioned: fileMatch ? fileMatch[0] : null,
  }
}

/**
 * 从 verify-handoff 风格的 session summary 上取首条 user/message 文本再识别。
 * @param {{firstUserMessage?: {text?: string}}} summary
 */
export function analyzeHandoffPrompt(summary) {
  return analyzeHandoffText(summary?.firstUserMessage?.text || '')
}
