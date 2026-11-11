#!/usr/bin/env node
/**
 * run-release-e2e.mjs — 发布前「三条真机断言」统一 runner（W2.5 常态化）。
 *
 * 一条命令串起三份既有的独立取证脚本，统一收集退出码、关键证据与 artifacts，
 * 落一份汇总 JSON 并打印 PASS/FAIL 表，便于直接贴进发布记录：
 *
 *   1. scripts/e2e/verify-handoff.mjs           接替会话的继承/归属（多帧 zstd + projcache + workspace.json）
 *   2. scripts/e2e/verify-kickoff-language.mjs 接替会话首条 user/message 的语种
 *   3. scripts/skill-e2e/collect-skills.mjs    会话可见的 skill 列表
 *   4. scripts/skill-e2e/summarize-run.mjs     工具/分层/交接序列（--summarize 追加，仅信息，不参与判定）
 *
 * 本 runner 只编排与汇总，不改变上述脚本的语义；不发起会话、不消耗模型配额。
 *
 * 用法：
 *   node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> [options]
 *   node scripts/e2e/run-release-e2e.mjs --replay <artifact.json> [--replay ...] [options]
 *
 * 选项：
 *   --source <sessionId>          被交接的源会话 id（必填；允许带/不带 "session-" 前缀）
 *   --successor <sessionId>       接替会话 id（必填）
 *   --expect-kind root|sibling    传给 verify-handoff 的期望接替类型（默认 root）
 *   --expect-lang zh|en           传给 verify-kickoff-language 的期望语种（默认 zh）
 *   --skill-session <sessionId>   collect-skills 的目标会话（默认 = --successor）
 *   --wait <ms>                   传给 verify-handoff 的等待（默认 0 = 快速失败；真机可 120000）
 *   --json                        仅输出汇总 JSON 到 stdout（文件照常落盘）
 *   --artifacts-dir <dir>         子 artifacts 目录（默认 scripts/e2e/artifacts/release-<ts>/）
 *   --summarize                   追加 summarize-run.mjs（信息性：失败不改变整体判定）
 *   --fail-fast                   首个必需断言失败即停（其余步骤标记 SKIP）
 *   --timeout <ms>                单个子脚本超时（默认 180000；超时按 FAIL 记录）
 *   --replay <artifact.json>      离线复核既有 JSON artifact（可重复）；只验 JSON 断言与一致性，
 *                                 不连真机、不能替代真机断言（见输出中的 DISCLAIMER）
 *   --help / -h                   显示本帮助
 *
 * artifacts 布局（默认）：
 *   scripts/e2e/artifacts/release-<ts>/verify-handoff.json       # verify-handoff --out
 *   scripts/e2e/artifacts/release-<ts>/kickoff-language.json     # 由 --json stdout 落盘
 *   scripts/e2e/artifacts/release-<ts>/collect-skills.json       # collect-skills --out
 *   scripts/e2e/artifacts/release-<ts>/summarize-run.json        # 仅 --summarize
 *   scripts/e2e/artifacts/release-<ts>/raw/<step>.{stdout,stderr}.txt  # 原始输出（证据保真）
 *   scripts/e2e/artifacts/release-<ts>.json                      # 汇总（= 目录去尾分隔符 + .json）
 *
 * 退出码：
 *   0 = 三条必需断言全 PASS（且各自 artifact 落盘）
 *   1 = 任一必需断言 FAIL / 无法判定（子脚本退出码 1 或 2）/ 超时
 *   2 = 用法错误（参数缺失、非法值、--replay 文件不存在）
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL = 'release-e2e'
const VERSION = '1.0.0'
const SCRIPT_FILE = fileURLToPath(import.meta.url)
const HERE = path.dirname(SCRIPT_FILE)
const REPO_ROOT = path.resolve(HERE, '..', '..')
const ARTIFACTS_ROOT = path.join(REPO_ROOT, 'scripts', 'e2e', 'artifacts')
const SKILL_SCRIPTS = path.join(REPO_ROOT, 'scripts', 'skill-e2e')

const USAGE_LINE = 'usage: node scripts/e2e/run-release-e2e.mjs --source <id> --successor <id> [--expect-kind root|sibling] [--expect-lang zh|en] [--skill-session <id>] [--wait <ms>] [--json] [--artifacts-dir <dir>] [--summarize] [--fail-fast] [--timeout <ms>]  |  --replay <artifact.json>  |  --help'

const HINTS = {
  'verify-handoff':
    'exit 2 = 无法判定：核对 source/successor 会话 id、workspace 编码目录与日志是否已产生（真机需接替会话首轮完成）；exit 1 = 有条目 FAIL（看 failed 断言 id 与 expected/actual）。',
  'verify-kickoff-language':
    'exit 2 = 找不到会话日志；exit 1 = 首条提示语种不符（检查 DSH 界面语言设置与 session-handoff 提示构造）。',
  'collect-skills':
    'exit 1 = 目标 skill 缺失或会话日志不存在；默认期望 tree-commander / tree-worker / session-handoff（可用 collect-skills --expect 自行扩展）。',
  'summarize-run': '信息性步骤，失败只影响参考，不改变整体判定。',
}

// ---------------------------------------------------------------------------
// 参数与通用工具
// ---------------------------------------------------------------------------

class UsageError extends Error {}

function printHelp() {
  const text = fs.readFileSync(SCRIPT_FILE, 'utf8')
  const m = text.match(/\/\*\*([\s\S]*?)\*\//)
  process.stdout.write((m ? m[1] : text).replace(/^\s*\* ?/gm, '') + '\n')
}

function parseArgs(argv) {
  const opts = {
    help: false,
    source: null,
    successor: null,
    expectKind: 'root',
    expectLang: 'zh',
    skillSession: null,
    waitMs: 0,
    json: false,
    artifactsDir: null,
    replay: [],
    summarize: false,
    failFast: false,
    timeoutMs: 180000,
    explicit: { expectKind: false, expectLang: false },
  }
  const take = (i, name) => {
    if (i + 1 >= argv.length) throw new UsageError(`missing value for ${name}`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true
        break
      case '--source':
        opts.source = take(i, a); i++
        break
      case '--successor':
        opts.successor = take(i, a); i++
        break
      case '--expect-kind':
        opts.expectKind = take(i, a); i++
        opts.explicit.expectKind = true
        break
      case '--expect-lang':
        opts.expectLang = take(i, a); i++
        opts.explicit.expectLang = true
        break
      case '--skill-session':
        opts.skillSession = take(i, a); i++
        break
      case '--wait':
        opts.waitMs = Number(take(i, a)); i++
        break
      case '--timeout':
        opts.timeoutMs = Number(take(i, a)); i++
        break
      case '--artifacts-dir':
        opts.artifactsDir = take(i, a); i++
        break
      case '--replay':
        opts.replay.push(take(i, a)); i++
        break
      case '--json':
        opts.json = true
        break
      case '--summarize':
        opts.summarize = true
        break
      case '--fail-fast':
        opts.failFast = true
        break
      default:
        throw new UsageError(`unknown argument: ${a} (use --help)`)
    }
  }
  if (opts.help) return opts
  if (!['root', 'sibling'].includes(opts.expectKind)) {
    throw new UsageError(`--expect-kind must be root|sibling, got ${opts.expectKind}`)
  }
  if (!['zh', 'en'].includes(opts.expectLang)) {
    throw new UsageError(`--expect-lang must be zh|en, got ${opts.expectLang}`)
  }
  if (!Number.isInteger(opts.waitMs) || opts.waitMs < 0) {
    throw new UsageError(`--wait must be a non-negative integer (ms), got ${opts.waitMs}`)
  }
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new UsageError(`--timeout must be a positive integer (ms), got ${opts.timeoutMs}`)
  }
  if (opts.replay.length === 0) {
    if (!opts.source || !opts.successor) {
      throw new UsageError('--source and --successor are required (or use --replay <artifact.json>)')
    }
  }
  if (!opts.skillSession) opts.skillSession = opts.successor
  return opts
}

/** 文件名安全的时间戳（UTC，秒级）：20261112T004500Z */
function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** 仓内路径转正斜杠相对路径；仓外路径原样返回。 */
function rel(p) {
  if (!p) return null
  const r = path.relative(REPO_ROOT, p)
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function parseJsonLoose(text) {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch { /* fall through */ }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch { /* ignore */ }
  }
  return null
}

function firstLine(text, max = 300) {
  if (!text) return ''
  const line = String(text).split(/\r?\n/).find((l) => l.trim()) || ''
  const s = line.trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function tail(text, max = 1500) {
  if (!text) return ''
  const s = String(text).replace(/\r\n/g, '\n').trim()
  return s.length > max ? `…${s.slice(-max)}` : s
}

function shortVal(v, max = 120) {
  let s
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (s === undefined) s = 'undefined'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 目录已存在时追加 -2/-3…，避免同一秒内多次运行的 artifact 互相覆盖。 */
function uniqueDir(base) {
  if (!fs.existsSync(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(`cannot allocate artifacts dir for ${base}`)
}

function createContext(opts) {
  const base = path.resolve(process.cwd(), opts.artifactsDir || path.join(ARTIFACTS_ROOT, `release-${stamp()}`))
  const dir = uniqueDir(base.replace(/[\\/]+$/, ''))
  const summaryPath = `${dir}.json`
  fs.mkdirSync(dir, { recursive: true })
  return { dir, summaryPath, opts, startedAt: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// 子脚本执行与证据提取
// ---------------------------------------------------------------------------

function buildSteps(opts) {
  const steps = [
    {
      id: 'verify-handoff',
      title: '接替会话继承与归属',
      required: true,
      script: path.join(REPO_ROOT, 'scripts', 'e2e', 'verify-handoff.mjs'),
      args: ['--source', opts.source, '--successor', opts.successor, '--expect-kind', opts.expectKind, '--wait', String(opts.waitMs)],
      outKind: 'flag',
    },
    {
      id: 'verify-kickoff-language',
      title: '接替首条提示语种',
      required: true,
      script: path.join(REPO_ROOT, 'scripts', 'e2e', 'verify-kickoff-language.mjs'),
      args: ['--session', opts.successor, '--expect', opts.expectLang],
      outKind: 'stdout',
    },
    {
      id: 'collect-skills',
      title: '会话可见 skill 列表',
      required: true,
      script: path.join(SKILL_SCRIPTS, 'collect-skills.mjs'),
      args: ['--session', opts.skillSession],
      outKind: 'flag',
    },
  ]
  if (opts.summarize) {
    steps.push({
      id: 'summarize-run',
      title: '工具/分层/交接序列（信息性）',
      required: false,
      script: path.join(SKILL_SCRIPTS, 'summarize-run.mjs'),
      args: ['--session', opts.skillSession],
      outKind: 'flag',
    })
  }
  return steps
}

function executeStep(def, ctx) {
  const outPath = path.join(ctx.dir, `${def.id}.json`)
  const args = [...def.args, '--json']
  if (def.outKind === 'flag') args.push('--out', outPath)
  const rawStdout = path.join(ctx.dir, 'raw', `${def.id}.stdout.txt`)
  const rawStderr = path.join(ctx.dir, 'raw', `${def.id}.stderr.txt`)
  const argv = [def.script, ...args]
  const t0 = Date.now()
  let res = null
  let spawnError = null
  try {
    res = spawnSync(process.execPath, argv, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: ctx.opts.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (e) {
    spawnError = e
  }
  const durationMs = Date.now() - t0
  const stdout = res?.stdout ?? ''
  const stderr = res?.stderr ?? (spawnError ? String(spawnError.message || spawnError) : '')
  fs.mkdirSync(path.dirname(rawStdout), { recursive: true })
  fs.writeFileSync(rawStdout, stdout, 'utf8')
  fs.writeFileSync(rawStderr, stderr, 'utf8')

  const timedOut = Boolean(res?.error && res.error.code === 'ETIMEDOUT') || Boolean(res?.signal)
  const exitCode = typeof res?.status === 'number' ? res.status : null

  let artifact = readJsonSafe(outPath)
  if (def.outKind === 'stdout') {
    // kickoff 脚本只有 --json stdout，没有 --out：runner 负责把 JSON 落盘（解析失败时保留 raw 包装）。
    if (!artifact) artifact = parseJsonLoose(stdout)
    fs.writeFileSync(
      outPath,
      JSON.stringify(artifact ?? { raw_stdout: stdout, raw_stderr: stderr, exit_code: exitCode }, null, 2) + '\n',
      'utf8',
    )
    artifact = readJsonSafe(outPath)
  }
  // artifact 缺失 = 证据链断裂：即使退出码为 0 也不算 PASS（发布门禁要求 artifacts 落盘）。
  if (def.outKind === 'flag' && exitCode === 0 && !artifact) {
    fs.writeFileSync(outPath, JSON.stringify({ artifact_missing: true, exit_code: exitCode, stdout_tail: tail(stdout), stderr_tail: tail(stderr) }, null, 2) + '\n', 'utf8')
  }

  const evidence = buildEvidence(def.id, artifact)
  if (exitCode === 0 && !artifact && def.outKind === 'flag') evidence.error = 'artifact missing or unparsable'
  const artifactWritten = fs.existsSync(outPath)
  const pass = exitCode === 0 && !timedOut && !evidence.error
  let status = 'PASS'
  if (!pass) {
    if (timedOut) status = 'TIMEOUT'
    else if (exitCode === 2) status = 'UNJUDGEABLE'
    else status = 'FAIL'
  }
  if (exitCode === 0 && evidence.error) status = 'FAIL'

  return {
    id: def.id,
    title: def.title,
    required: def.required,
    script: rel(def.script),
    argv,
    exitCode,
    pass,
    status,
    duration_ms: durationMs,
    timedOut,
    artifact: rel(outPath),
    artifactWritten,
    evidence,
    stderr_first: firstLine(stderr),
    stderr_tail: tail(stderr),
    stdout_tail: tail(stdout, 800),
    spawn_error: spawnError ? String(spawnError.message || spawnError) : null,
    raw: { stdout: rel(rawStdout), stderr: rel(rawStderr) },
  }
}

function skipRecord(def) {
  return {
    id: def.id,
    title: def.title,
    required: def.required,
    script: rel(def.script),
    argv: null,
    exitCode: null,
    pass: false,
    status: 'SKIP',
    duration_ms: 0,
    timedOut: false,
    artifact: null,
    artifactWritten: false,
    evidence: { skipped: '--fail-fast：上游失败后未执行' },
    stderr_first: '',
    stderr_tail: '',
    stdout_tail: '',
    spawn_error: null,
    raw: null,
  }
}

function buildEvidence(id, artifact) {
  if (!artifact) return { missing: true, error: 'artifact not produced by child script' }
  try {
    if (id === 'verify-handoff') return handoffEvidence(artifact)
    if (id === 'verify-kickoff-language') return kickoffEvidence(artifact)
    if (id === 'collect-skills') return skillsEvidence(artifact)
    if (id === 'summarize-run') return summarizeEvidence(artifact)
    return { error: `unknown step id: ${id}` }
  } catch (e) {
    return { error: `artifact shape error: ${e.message}` }
  }
}

function handoffEvidence(doc) {
  if (doc.tool !== 'verify-handoff' || !Array.isArray(doc.assertions) || !doc.summary) {
    return { error: 'not a verify-handoff report' }
  }
  const failed = doc.assertions
    .filter((a) => !a.pass)
    .map((a) => ({ id: a.id, expected: shortVal(a.expected), actual: shortVal(a.actual) }))
  return {
    verdict: doc.summary.verdict,
    total: doc.summary.total,
    passed: doc.summary.pass,
    failedCount: doc.summary.fail,
    failed: failed.slice(0, 10),
    expectKind: doc.options?.expectKind ?? null,
    sourceLog: doc.paths?.sourceLog ?? null,
    successorLog: doc.paths?.successorLog ?? null,
    workspaceRegistry: doc.paths?.workspaceRegistry ?? null,
  }
}

function kickoffEvidence(doc) {
  if (doc && (doc.raw_stdout !== undefined || doc.raw_stderr !== undefined || doc.artifact_missing)) {
    // runner 在解析失败时落的 raw 包装：等价于「没有可用 JSON artifact」。
    return { missing: true, error: 'child produced no parseable JSON artifact' }
  }
  if (typeof doc.language !== 'string' || !('pass' in doc)) return { error: 'not a verify-kickoff-language report' }
  return {
    language: doc.language,
    expect: doc.expect ?? null,
    first_message_seq: doc.first_message_seq ?? null,
    mentions_handoff_file: doc.mentions_handoff_file ?? null,
    excerpt: typeof doc.excerpt === 'string' ? doc.excerpt.slice(0, 200) : null,
  }
}

function skillsEvidence(doc) {
  if (doc.tool !== 'collect-skills' || !doc.summary || !Array.isArray(doc.sessions)) {
    return { error: 'not a collect-skills report' }
  }
  return {
    verdict: doc.summary.verdict,
    sessionCount: doc.summary.sessions,
    found: doc.summary.found,
    missingSessions: doc.summary.missingSessions,
    expected: doc.expected ?? [],
    sessions: doc.sessions.map((s) => ({
      id: s.id,
      ok: s.ok,
      log: s.log ?? null,
      missing: s.missing ?? [],
      atCreationCount: s.atCreation?.count ?? null,
      latestCount: s.latest?.count ?? null,
      skillLoads: Array.isArray(s.skillLoads) ? s.skillLoads.length : 0,
    })),
  }
}

function summarizeEvidence(doc) {
  if (doc.tool !== 'summarize-run' || !doc.summary) return { error: 'not a summarize-run report' }
  return {
    sessions: doc.summary.sessions,
    roots: doc.summary.roots,
    children: doc.summary.children,
    checks: `${doc.summary.passCount}/${doc.summary.totalChecks}`,
    trees: Array.isArray(doc.layering?.trees) ? doc.layering.trees.length : null,
    nodes: Array.isArray(doc.layering?.nodes) ? doc.layering.nodes.length : null,
    handoffs: Array.isArray(doc.handoffs) ? doc.handoffs.length : null,
  }
}

function evidenceText(step) {
  const ev = step.evidence || {}
  if (ev.missing) return step.status === 'UNJUDGEABLE' ? 'not judged (see stderr)' : 'no artifact (see stderr)'
  if (ev.error) return `artifact: ${ev.error}`
  if (ev.skipped) return ev.skipped
  if (step.id === 'verify-handoff') {
    const failed = (ev.failed || []).map((f) => f.id).join(', ')
    return `assertions ${ev.passed}/${ev.total} PASS${ev.failedCount ? `; failed: ${failed}` : ''}`
  }
  if (step.id === 'verify-kickoff-language') {
    return `language=${ev.language} expect=${ev.expect ?? '-'} seq=${ev.first_message_seq ?? '-'}`
  }
  if (step.id === 'collect-skills') {
    const missing = (ev.sessions || []).flatMap((s) => s.missing || [])
    return `sessions ${ev.found}/${ev.sessionCount} ok; missing: ${missing.length ? missing.join(', ') : 'none'}`
  }
  if (step.id === 'summarize-run') {
    return `checks ${ev.checks}; sessions=${ev.sessions}; trees=${ev.trees ?? '-'} nodes=${ev.nodes ?? '-'} handoffs=${ev.handoffs ?? '-'}`
  }
  return ''
}

// ---------------------------------------------------------------------------
// live 模式
// ---------------------------------------------------------------------------

function runLive(opts) {
  const ctx = createContext(opts)
  const defs = buildSteps(opts)
  const steps = []
  let stop = false
  for (const def of defs) {
    if (stop) {
      steps.push(skipRecord(def))
      continue
    }
    const rec = executeStep(def, ctx)
    steps.push(rec)
    if (opts.failFast && def.required && !rec.pass) stop = true
  }

  const required = steps.filter((s) => s.required)
  const requiredFailed = required.filter((s) => !s.pass)
  const optional = steps.filter((s) => !s.required)
  const verdict = requiredFailed.length === 0 ? 'PASS' : 'FAIL'
  const overall = {
    verdict,
    required: required.length,
    passed: required.filter((s) => s.pass).length,
    failed: requiredFailed.length,
    skipped: steps.filter((s) => s.status === 'SKIP').length,
    optional_failed: optional.filter((s) => !s.pass).map((s) => s.id),
    exitCode: verdict === 'PASS' ? 0 : 1,
  }

  const doc = {
    tool: TOOL,
    version: VERSION,
    mode: 'live',
    real_machine: true,
    timestamp: new Date().toISOString(),
    node: process.version,
    repo_root: REPO_ROOT,
    dsh_home: dshHome(),
    params: {
      source: opts.source,
      successor: opts.successor,
      expect_kind: opts.expectKind,
      expect_lang: opts.expectLang,
      skill_session: opts.skillSession,
      wait_ms: opts.waitMs,
      timeout_ms: opts.timeoutMs,
      fail_fast: opts.failFast,
      summarize: opts.summarize,
      artifacts_dir: rel(ctx.dir),
      artifacts_dir_abs: ctx.dir,
      summary: rel(ctx.summaryPath),
    },
    steps,
    overall,
    artifacts: {
      dir: rel(ctx.dir),
      dir_abs: ctx.dir,
      summary: rel(ctx.summaryPath),
      files: steps.filter((s) => s.artifactWritten).map((s) => s.artifact),
      declared: steps.filter((s) => s.artifact).map((s) => s.artifact),
      raw: steps.filter((s) => s.raw).map((s) => s.raw),
    },
    notes: [
      'runner 只编排既有脚本，不发起会话、不消耗模型配额。',
      '真机断言依赖本机 DSH 会话日志（<DSH_HOME>/sessions/**/session.v4.jsonl.zstd），需在接替会话首轮完成后执行。',
      'verify-handoff --wait 默认 0（快速失败）；真机发布建议 --wait 120000。',
      'collect-skills 默认期望 tree-commander / tree-worker / session-handoff；runner 未改动其语义。',
      '任一必需断言 FAIL/无法判定（子脚本退出码 1 或 2）→ 整体 exit 1。',
    ],
  }

  fs.writeFileSync(ctx.summaryPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  if (opts.json) process.stdout.write(JSON.stringify(doc, null, 2) + '\n')
  else printLiveReport(doc)
  return overall.exitCode
}

function printLiveReport(doc) {
  const lines = []
  lines.push(`${TOOL} ${doc.timestamp}  mode=live  node=${doc.node}`)
  lines.push(`source       : ${doc.params.source}`)
  lines.push(`successor    : ${doc.params.successor}  expect-kind=${doc.params.expect_kind}  expect-lang=${doc.params.expect_lang}`)
  lines.push(`skill-session: ${doc.params.skill_session}  wait=${doc.params.wait_ms}ms  timeout=${doc.params.timeout_ms}ms`)
  lines.push(`artifacts    : ${doc.artifacts.dir}/`)
  lines.push('')
  lines.push(`${'RESULT'.padEnd(12)}${'STEP'.padEnd(26)}${'EXIT'.padEnd(6)}${'EVIDENCE'}`)
  for (const s of doc.steps) {
    const exit = s.exitCode === null ? '-' : String(s.exitCode)
    const tag = s.required ? '' : ' (optional)'
    lines.push(`${s.status.padEnd(12)}${(s.id + tag).padEnd(26)}${exit.padEnd(6)}${evidenceText(s)}`)
  }
  lines.push('')

  const failures = doc.steps.filter((s) => !s.pass && (s.required || s.id === 'summarize-run'))
  if (failures.length) {
    lines.push('FAILURE DETAIL')
    for (const s of failures) {
      lines.push(`- ${s.id} (exit ${s.exitCode ?? 'n/a'}${s.timedOut ? ', TIMEOUT' : ''}): ${s.status}`)
      const ev = s.evidence || {}
      if (ev.missing) lines.push('    脚本在写出 artifact 前退出（无 JSON 可汇总），见 stderr')
      else if (ev.error) lines.push(`    ${ev.error}`)
      if (s.id === 'verify-handoff' && Array.isArray(ev.failed)) {
        for (const f of ev.failed) {
          lines.push(`    ${f.id}: expected=${f.expected} actual=${f.actual}`)
        }
      }
      if (s.id === 'collect-skills' && Array.isArray(ev.sessions)) {
        for (const sess of ev.sessions) {
          if (sess.missing && sess.missing.length) lines.push(`    session ${sess.id}: missing ${sess.missing.join(', ')}${sess.log ? '' : ' (no session log)'}`)
        }
      }
      if (s.stderr_first) lines.push(`    stderr: ${s.stderr_first}`)
      if (HINTS[s.id]) lines.push(`    hint: ${HINTS[s.id]}`)
    }
    lines.push('')
  }

  lines.push(
    `SUMMARY: ${doc.overall.verdict} (${doc.overall.passed}/${doc.overall.required} required PASS) -> ${doc.artifacts.summary}`,
  )
  if (doc.overall.optional_failed.length) {
    lines.push(`NOTE: optional step failed: ${doc.overall.optional_failed.join(', ')} (informational only)`)
  }
  lines.push('NOTE: 真机执行需真实会话与日志；runner 不发起会话，发布前由人工/Lead 触发。')
  process.stdout.write(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// replay 模式（离线：只复核既有 JSON artifact）
// ---------------------------------------------------------------------------

function classify(doc) {
  if (!doc || typeof doc !== 'object') return 'unknown'
  if (doc.tool === 'verify-handoff') return 'verify-handoff'
  if (doc.tool === 'collect-skills') return 'collect-skills'
  if (doc.tool === 'summarize-run') return 'summarize-run'
  if (doc.tool === TOOL) return 'release-e2e'
  if (typeof doc.language === 'string' && 'pass' in doc && 'excerpt' in doc) return 'verify-kickoff-language'
  return 'unknown'
}

function replayOne(file, opts) {
  const abs = path.resolve(process.cwd(), file)
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (e) {
    return {
      artifact: rel(abs),
      kind: 'unparsable',
      pass: false,
      checks: [{ name: 'json-parse', pass: false, detail: e.message }],
    }
  }
  const kind = classify(doc)
  const checks = []
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail === undefined ? null : String(detail) })

  if (kind === 'verify-handoff') {
    const list = Array.isArray(doc.assertions) ? doc.assertions : null
    const s = doc.summary || null
    add('summary-present', !!s, s ? `verdict=${s.verdict} ${s.pass}/${s.total}` : 'no summary')
    if (s && list) {
      const passCount = list.filter((a) => a.pass).length
      const failCount = list.length - passCount
      add('total-consistent', s.total === list.length, `summary.total=${s.total} assertions=${list.length}`)
      add('count-consistent', s.pass === passCount && s.fail === failCount, `stored=${s.pass}/${s.fail} recomputed=${passCount}/${failCount}`)
      add('verdict-consistent', s.verdict === (failCount === 0 ? 'PASS' : 'FAIL'), `stored=${s.verdict}`)
      add(
        'assertions-pass',
        failCount === 0,
        failCount ? `failed: ${list.filter((a) => !a.pass).map((a) => a.id).join(', ')}` : `${passCount}/${list.length}`,
      )
    }
    if (opts.explicit.expectKind) {
      const k = doc.options?.expectKind ?? null
      add('expect-kind-match', !k || k === opts.expectKind, `artifact=${k ?? 'unknown'} requested=${opts.expectKind}`)
    }
  } else if (kind === 'collect-skills') {
    const s = doc.summary || null
    const sessions = Array.isArray(doc.sessions) ? doc.sessions : null
    add('summary-present', !!s, s ? `verdict=${s.verdict} ${s.found}/${s.sessions}` : 'no summary')
    if (s && sessions) {
      const okCount = sessions.filter((x) => x.ok).length
      add('sessions-consistent', s.sessions === sessions.length, `summary.sessions=${s.sessions} sessions=${sessions.length}`)
      add('found-consistent', s.found === okCount, `stored=${s.found} recomputed=${okCount}`)
      add('missing-consistent', s.missingSessions === sessions.length - okCount, `stored=${s.missingSessions} recomputed=${sessions.length - okCount}`)
      add('all-present-consistent', s.allExpectedPresent === sessions.every((x) => x.ok), `stored=${s.allExpectedPresent}`)
      add('verdict-consistent', s.verdict === (sessions.every((x) => x.ok) ? 'PASS' : 'FAIL'), `stored=${s.verdict}`)
      add(
        'skills-present',
        sessions.every((x) => x.ok),
        sessions.flatMap((x) => x.missing || []).join(', ') || 'all expected present',
      )
    }
  } else if (kind === 'verify-kickoff-language') {
    const derived = !doc.expect || doc.language === doc.expect
    add('language-field', ['zh', 'en', 'unknown'].includes(doc.language), `language=${doc.language}`)
    add('tracked-pass-consistent', doc.pass === derived, `stored=${doc.pass} derived=${derived} expect=${doc.expect ?? '-'}`)
    add('language-matches-expect', derived, `language=${doc.language} expect=${doc.expect ?? '-'}`)
    if (opts.explicit.expectLang) {
      add('expect-lang-match', !doc.expect || doc.expect === opts.expectLang, `artifact=${doc.expect ?? 'unknown'} requested=${opts.expectLang}`)
    }
  } else if (kind === 'release-e2e') {
    const list = Array.isArray(doc.steps) ? doc.steps : null
    const o = doc.overall || null
    add('overall-present', !!o && typeof o.verdict === 'string', o ? `verdict=${o.verdict} mode=${doc.mode}` : 'no overall')
    if (list && o) {
      const req = list.filter((x) => x.required)
      const reqFail = req.filter((x) => !x.pass).length
      add('required-derived', o.verdict === (reqFail === 0 ? 'PASS' : 'FAIL'), `stored=${o.verdict} recomputed=${reqFail === 0 ? 'PASS' : 'FAIL'}`)
      add('exit-consistent', o.exitCode === (o.verdict === 'PASS' ? 0 : 1), `stored exitCode=${o.exitCode}`)
      add('artifacts-referenced', list.every((x) => x.artifact), `${list.filter((x) => !x.artifact).length} step(s) without artifact`)
    }
  } else if (kind === 'summarize-run') {
    add('report-shape', !!doc.summary, doc.summary ? `checks ${doc.summary.passCount}/${doc.summary.totalChecks}` : 'no summary')
    add('informational-only', true, 'summarize-run 不参与发布判定')
  } else {
    add('recognized', false, `unknown artifact shape (keys: ${Object.keys(doc).slice(0, 8).join(', ')})`)
  }

  const pass = checks.length > 0 && checks.every((c) => c.pass)
  return { artifact: rel(abs), kind, pass, checks }
}

function runReplay(opts) {
  const missing = opts.replay.filter((f) => !fs.existsSync(path.resolve(process.cwd(), f)))
  if (missing.length) {
    process.stderr.write(`${TOOL}: --replay file(s) not found: ${missing.join(', ')}\n`)
    process.stderr.write(`${USAGE_LINE}\n`)
    return 2
  }
  const ctx = createContext(opts)
  const results = opts.replay.map((f) => replayOne(f, opts))
  const failed = results.filter((r) => !r.pass)
  const overall = {
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    replayed: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    exitCode: failed.length === 0 ? 0 : 1,
  }
  const doc = {
    tool: TOOL,
    version: VERSION,
    mode: 'replay',
    real_machine: false,
    timestamp: new Date().toISOString(),
    node: process.version,
    repo_root: REPO_ROOT,
    dsh_home: dshHome(),
    disclaimer: 'replay 只复核既有 JSON artifact 的存储判定与内部一致性，不读取会话日志、不产生新证据，不能替代真机三断言。',
    params: {
      replay: opts.replay.map((f) => rel(path.resolve(process.cwd(), f))),
      expect_kind: opts.explicit.expectKind ? opts.expectKind : null,
      expect_lang: opts.explicit.expectLang ? opts.expectLang : null,
      artifacts_dir: rel(ctx.dir),
      artifacts_dir_abs: ctx.dir,
      summary: rel(ctx.summaryPath),
    },
    results,
    overall,
    artifacts: {
      dir: rel(ctx.dir),
      dir_abs: ctx.dir,
      summary: rel(ctx.summaryPath),
      files: [rel(path.join(ctx.dir, 'replay.json'))],
    },
    notes: [
      'replay 不连真机、不解码会话日志；PASS 仅表示既有证据自洽。',
      '发布门禁仍以真机三断言全 PASS 为准。',
    ],
  }
  fs.writeFileSync(path.join(ctx.dir, 'replay.json'), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  fs.writeFileSync(ctx.summaryPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  if (opts.json) process.stdout.write(JSON.stringify(doc, null, 2) + '\n')
  else printReplayReport(doc)
  return overall.exitCode
}

function printReplayReport(doc) {
  const lines = []
  lines.push(`${TOOL} replay ${doc.timestamp}  mode=replay  node=${doc.node}  [OFFLINE]`)
  lines.push('NOTE: replay 只复核既有 JSON artifact 的存储判定与内部一致性；不读会话日志，不能替代真机断言。')
  lines.push('')
  lines.push(`${'RESULT'.padEnd(12)}${'KIND'.padEnd(24)}${'CHECKS'.padEnd(9)}ARTIFACT`)
  for (const r of doc.results) {
    const checks = `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`
    lines.push(`${(r.pass ? 'PASS' : 'FAIL').padEnd(12)}${r.kind.padEnd(24)}${checks.padEnd(9)}${r.artifact}`)
  }
  lines.push('')
  const failed = doc.results.filter((r) => !r.pass)
  if (failed.length) {
    lines.push('FAILURE DETAIL')
    for (const r of failed) {
      lines.push(`- ${r.kind}: ${r.artifact}`)
      for (const c of r.checks.filter((x) => !x.pass)) lines.push(`    ${c.name}: ${c.detail ?? ''}`)
    }
    lines.push('')
  }
  lines.push(`SUMMARY: ${doc.overall.verdict} (${doc.overall.passed}/${doc.overall.replayed} artifacts re-evaluated) -> ${doc.artifacts.summary}`)
  lines.push('DISCLAIMER: replay 通过仅说明「既有证据自洽」；发布门禁仍需真机三断言 PASS。')
  process.stdout.write(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${TOOL}: ${e.message}\n`)
    process.stderr.write(`${USAGE_LINE}\n`)
    return 2
  }
  if (opts.help) {
    printHelp()
    return 0
  }
  return opts.replay.length ? runReplay(opts) : runLive(opts)
}

process.exitCode = main()
