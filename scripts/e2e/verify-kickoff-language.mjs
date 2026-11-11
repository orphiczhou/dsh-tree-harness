#!/usr/bin/env node
/**
 * Assert that a successor session's first user message (the handoff kickoff
 * prompt) is written in the DSH interface language, not hard-coded English.
 *
 * Usage (bundled node is fine):
 *   node scripts/e2e/verify-kickoff-language.mjs --session <successorId> [--expect zh|en] [--json]
 *
 * Evidence source: the session log (`~/.dsh/sessions/<workspace>/<id>/session.v4.jsonl.zstd`,
 * multi-frame zstd), decoded through the same read-only helpers the skill E2E uses.
 */
import { loadSession, byType, contentTexts } from '../skill-e2e/lib.mjs'

const HAS_CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/
const HAS_LATIN = /[A-Za-z]/

function parseArgs(argv) {
  const out = { session: null, expect: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') out.json = true
    else if (arg === '--session') out.session = argv[++i]
    else if (arg === '--expect') out.expect = argv[++i]
    else if (!out.session) out.session = arg
  }
  return out
}

function detectLanguage(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const latin = (text.match(/[A-Za-z]/g) || []).length
  if (cjk === 0 && latin === 0) return 'unknown'
  return cjk >= Math.max(2, latin / 8) ? 'zh' : 'en'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.session) {
    console.error('usage: node scripts/e2e/verify-kickoff-language.mjs --session <successorId> [--expect zh|en] [--json]')
    process.exit(2)
  }
  const loaded = loadSession(args.session)
  if (!loaded) {
    console.error(`no session log found for ${args.session} (workspace encoding may differ)`)
    process.exit(2)
  }
  const events = loaded.decoded?.events ?? loaded.events ?? []
  const sessionId = loaded.id ?? args.session
  const messages = byType(events, 'user/message')
  // The first user/message of a successor is the kickoff prompt. Session logs
  // may also carry catalog system-reminders, so take the first non-empty text.
  let first = null
  let text = ''
  for (const message of messages) {
    const candidate = contentTexts(message)
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    first = message
    text = candidate
    break
  }
  const language = detectLanguage(text)
  const pass = args.expect ? language === args.expect : true
  const report = {
    session: sessionId,
    first_message_seq: first ? first.seq : null,
    language,
    expect: args.expect ?? null,
    pass,
    mentions_handoff_file: /HANDOFF-[A-Za-z0-9-]+\.md/.test(text),
    excerpt: text.replace(/\s+/g, ' ').slice(0, 320),
  }
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`session: ${report.session}`)
    console.log(`first user message: seq=${report.first_message_seq} language=${report.language}${report.expect ? ` (expect ${report.expect})` : ''}`)
    console.log(`mentions handoff file: ${report.mentions_handoff_file}`)
    console.log(`excerpt: ${report.excerpt}`)
    console.log(report.pass ? 'PASS' : 'FAIL')
  }
  process.exit(pass ? 0 : 1)
}

main()
