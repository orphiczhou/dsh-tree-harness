#!/usr/bin/env node
/**
 * release-all.mjs — 会话树单包「一条命令发布」（W2.7）
 *
 * 把 docs/guides/publishing.md 的发布流程串成一条命令：
 *   预检（版本 / 分支 / remote / 镜像状态 / SHA 对账 / 一致性 / 测试）
 *   → release-plugin 单向同步 + SHA-256 对账
 *   → 本仓 git add -A + commit（只有 --push 才 push）
 *   → 镜像仓 commit + tag vX.Y.Z（只有 --push 才 push）
 *   → git ls-remote 核对远端 main/tag 与本地一致
 *
 * 唯一源码事实源 = 本仓 packages/<pkg>/；公开镜像 = orphiczhou/dsh-session-tree。
 * 同步只走 scripts/release-plugin.mjs（单向），本脚本不手工双写任何文件。
 *
 * 版本纪律（D6）：
 *   - 包内容有变化但 version 未 bump → 真实运行拒绝（dry-run 只报告 GATE）。
 *   - 包内容与镜像逐字节一致且 version 相同 → 「包内容无变化不需要发布」，no-op。
 *
 * 安全与凭据：
 *   - 默认 dry-run：只读预检 + 打印完整步骤计划，不写文件、不运行 git 写命令。
 *   - 只有显式 --push 才执行远端写（本仓 push、镜像 push main + tag）。
 *   - --skip-push / --apply 执行本地同步 + commit + tag，但不推送（离线演练）。
 *   - GH_TOKEN 只在需要 push 时从进程环境或 Windows User 环境变量读入内存，
 *     经子进程环境变量 GIT_CONFIG_* 注入 http.extraheader（git 2.31+）：
 *     不写 git config、不进 argv、不打印；所有子进程输出打印前统一 redact。
 *   - 失败即停：每一步失败立即非 0 退出，并打印「已完成 / 下一步 / 回滚命令」。
 *
 * 退出码：
 *   0 = 成功 / no-op / dry-run 完成（dry-run 即使有 GATE 也返回 0）
 *   1 = 执行失败、被发布门禁拒绝，或预检环境错误（如镜像 checkout 不存在）
 *   2 = 用法错误（未知参数、缺少参数值）
 *
 * 纯 ESM，仅 Node 内置模块；不引第三方依赖。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(SCRIPT_PATH)
const REPO_ROOT = dirname(SCRIPT_DIR)
const RELEASE_PLUGIN = join(SCRIPT_DIR, 'release-plugin.mjs')
const CONSISTENCY_SCRIPT = join(SCRIPT_DIR, 'check-version-consistency.mjs')

const SOURCE_REPO_SLUG = 'orphiczhou/dsh-tree-harness'
const DEFAULT_PKG = '@orphiczhou/dsh-session-tree'
const DEFAULT_BRANCH = 'master'
const MIRROR_BRANCH = 'main'

const SKIP_DIRS = new Set(['node_modules', '.git'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

// Tokens/base64 headers held in memory only; every line we print goes through redact().
const SECRETS = []
let PROXY_CONFIGURED = false

const USAGE = `release-all.mjs — 一条命令发布 packages/<pkg> 到公开镜像仓（W2.7）

用法:
  node scripts/release-all.mjs [options]

模式:
  默认（无参数）           dry-run：只做只读预检 + 打印完整步骤计划，不写任何文件
  --skip-push / --apply    执行本地全链路：同步 + 本仓 commit + 镜像 commit/tag，但不 push
  --push                   完整发布：本地全链路 + 本仓 push + 镜像 push main/tag（需要 GH_TOKEN）

参数:
  --mirror-dir <dir>   公开镜像仓本地 checkout（git 工作树，分支 main）；缺省读环境变量 DSH_MIRROR_DIR
  --pkg <name>         包名或目录名，缺省 ${DEFAULT_PKG}
  --push               显式推送（唯一会联网写远端的开关）
  --skip-push          执行本地写，但不推送（离线演练；与 --push 互斥）
  --apply              --skip-push 的别名（保留给习惯 apply 语义的使用者）
  --dry-run            强制只读演练（默认；不能与 --push/--skip-push/--apply 同用）
  --skip-tests         跳过包测试（发布提速；仍会跑 check-version-consistency.mjs）
  --summary <text>     本仓发布 commit 的摘要（模板 feat/release: <pkg> vX.Y.Z — <摘要>）
  --require-clean      工作树必须 clean（默认把未提交改动列为 WARN：它们会随 git add -A 进入发布提交）
  -h, --help           显示本帮助

退出码: 0 = 成功/no-op/dry-run 完成；1 = 失败、被门禁拒绝或预检环境错误（如镜像 checkout 不存在）；2 = 用法错误（未知参数/缺参数值）

前置条件:
  1. 本仓在 ${DEFAULT_BRANCH} 分支，origin = https://github.com/${SOURCE_REPO_SLUG}.git；
  2. --mirror-dir 指向 orphiczhou/dsh-session-tree 的干净 checkout（main 分支）；
  3. 包内容有变化时先在 packages/<pkg>/package.json bump version（D6）；
  4. 需要推送时 GH_TOKEN 存在于 User 环境变量（脚本只在 push 时读取）。
`

// ------------------------------------------------------------------ small utils

function log(message = '') {
  console.log(redact(message))
}

function warn(message) {
  console.error(redact(`[WARN] ${message}`))
}

function redact(text) {
  let out = String(text)
  for (const secret of SECRETS) {
    if (!secret) continue
    out = out.split(secret).join('***')
  }
  return out
}

function tail(text, max = 1600) {
  const value = String(text ?? '').trim()
  if (value.length <= max) return value
  return `…${value.slice(value.length - max)}`
}

function quoteArg(arg) {
  const text = String(arg)
  if (text === '') return '""'
  return /\s|["']/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

function formatCommand(program, args) {
  return [program, ...args].map(quoteArg).join(' ')
}

function echoCommand(program, args, cwd) {
  const where = cwd ? ` (cwd: ${cwd})` : ''
  log(`  $ ${formatCommand(program, args)}${where}`)
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(String(value ?? '').trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return NaN
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

function remoteSlug(url) {
  const text = String(url ?? '').trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const match = /github\.com[/:]([^/]+)\/([^/]+)$/i.exec(text)
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

function urlHasCredentials(url) {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(String(url ?? '').trim())
}

function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(`:${sep}`)
}

function walkFiles(root) {
  const files = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(abs, rel)
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue
        files.push(rel)
      }
    }
  }
  walk(root, '')
  return files.sort()
}

/** Parse one `git status --porcelain` line into { code, path }. */
function parseStatusEntry(line) {
  const code = line.slice(0, 2)
  let entryPath = line.slice(3).trim()
  if (entryPath.startsWith('"') && entryPath.endsWith('"')) entryPath = entryPath.slice(1, -1)
  if (entryPath.includes(' -> ')) entryPath = entryPath.split(' -> ').pop()
  return { code, path: entryPath }
}

// --------------------------------------------------------------- process / git

class UsageError extends Error {}

class ReleaseError extends Error {
  constructor(message, { step = null, hint = null } = {}) {
    super(message)
    this.name = 'ReleaseError'
    this.step = step
    this.hint = hint
  }
}

/**
 * Run one child process with captured output. Never prints by itself.
 * On non-zero exit either returns (allowFailure=true) or throws ReleaseError.
 */
function runProcess(program, args, { cwd = REPO_ROOT, env = process.env, allowFailure = false, timeout = 600_000 } = {}) {
  const res = spawnSync(program, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true,
  })
  const status = typeof res.status === 'number' ? res.status : 1
  const output = { status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', error: res.error ?? null }
  if (res.error && !allowFailure) {
    throw new ReleaseError(`无法执行命令: ${formatCommand(program, args)}\n${res.error.message}`)
  }
  if (status !== 0 && !allowFailure) {
    throw new ReleaseError(
      `命令失败（exit ${status}）: ${formatCommand(program, args)}\n${tail(output.stderr || output.stdout)}`,
    )
  }
  return output
}

function git(args, options = {}) {
  const { token = null, env, ...rest } = options
  // Token (if any) is injected only into the child environment, never into argv.
  return runProcess('git', args, { ...rest, env: env ?? gitEnv(token) })
}

function gitOut(args, options = {}) {
  return git(args, options).stdout.trim()
}

/** Environment used for git children. Token (if any) travels via GIT_CONFIG_* only. */
function gitEnv(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
    if (!SECRETS.includes(basic)) SECRETS.push(basic)
    env.GIT_CONFIG_COUNT = '1'
    env.GIT_CONFIG_KEY_0 = 'http.extraheader'
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`
  }
  return env
}

/** Read GH_TOKEN from process env or the Windows User environment (never printed). */
function readGhToken() {
  if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim()) return process.env.GH_TOKEN.trim()
  if (process.platform !== 'win32') return null
  const psCommand = "[Environment]::GetEnvironmentVariable('GH_TOKEN','User')"
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const res = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    })
    if (res.status === 0 && res.stdout && res.stdout.trim()) {
      const token = res.stdout.trim()
      if (!SECRETS.includes(token)) SECRETS.push(token)
      return token
    }
  }
  return null
}

function requireToken() {
  const token = readGhToken()
  if (!token) {
    throw new ReleaseError(
      '缺少 GH_TOKEN：推送需要 User 环境变量 GH_TOKEN（[Environment]::GetEnvironmentVariable(\'GH_TOKEN\',\'User\')）。' +
        '本脚本不会打印/落盘 token；未产生远端写入。',
      { step: '凭据', hint: '在本机 User 环境变量设置 GH_TOKEN 后重跑 --push（本地提交可复用）。' },
    )
  }
  return token
}

/** One network git command; retry once with `-c http.proxy=` when a proxy error is detected. */
function gitNetwork(args, options = {}) {
  const first = git(args, { ...options, allowFailure: true })
  if (first.status === 0) return first
  const detail = `${first.stdout}\n${first.stderr}`
  const looksNetwork = /(proxy|CONNECT|Could not resolve|Failed to connect|timed out|connection (refused|reset)|ECONN|RPC failed)/i.test(
    detail,
  )
  if (PROXY_CONFIGURED && looksNetwork) {
    warn(`网络命令失败，按 agent.md 约定用 -c http.proxy= 直连重试一次：git ${args.join(' ')}`)
    return git(['-c', 'http.proxy=', ...args], { ...options, allowFailure: true })
  }
  return first
}

// ------------------------------------------------------------ release-plugin

function runReleasePlugin(args, { allowFailure = true } = {}) {
  return runProcess(process.execPath, [RELEASE_PLUGIN, ...args], {
    cwd: REPO_ROOT,
    allowFailure,
    timeout: 300_000,
  })
}

function parseSyncSummary(output) {
  const match = /files=(\d+)\s+match=(\d+)\s+mismatch=(\d+)\s+missing=(\d+)\s+extra=(\d+)/.exec(String(output))
  if (!match) return null
  return {
    files: Number(match[1]),
    match: Number(match[2]),
    mismatch: Number(match[3]),
    missing: Number(match[4]),
    extra: Number(match[5]),
  }
}

function syncClean(summary) {
  return Boolean(
    summary && summary.mismatch === 0 && summary.missing === 0 && summary.extra === 0 && summary.match === summary.files,
  )
}

function syncSummaryLine(summary) {
  if (!summary) return '无法解析 release-plugin 输出'
  return `files=${summary.files} match=${summary.match} mismatch=${summary.mismatch} missing=${summary.missing} extra=${summary.extra}`
}

/** LF-normalized bytes, so a CRLF checkout is not mistaken for a content change. */
function normalizedBytes(file) {
  return readFileSync(file).toString('latin1').replace(/\r\n/g, '\n')
}

/**
 * release-plugin compares raw bytes. On Windows a fresh clone may be checked out
 * with CRLF (core.autocrlf) while the source is LF: every file then reports
 * MISMATCH even though the content is identical. Classify those mismatches.
 *
 * Returns { eolOnly, effectiveInSync } — effectiveInSync means "byte-identical
 * after the single supported sync", which is what the D6 gate/no-op needs.
 */
function analyzeContent(mirrorDir, pkgDir, summary, output) {
  const mismatchPaths = [...String(output).matchAll(/\[MISMATCH\]\s+(.+?)\s*$/gm)].map((match) => match[1].trim())
  let eolOnly = mismatchPaths.length > 0 && mismatchPaths.length === summary?.mismatch
  if (eolOnly) {
    for (const rel of mismatchPaths) {
      try {
        if (normalizedBytes(join(pkgDir, ...rel.split('/'))) !== normalizedBytes(join(mirrorDir, ...rel.split('/')))) {
          eolOnly = false
          break
        }
      } catch {
        eolOnly = false
        break
      }
    }
  }
  const effectiveInSync = Boolean(
    summary &&
      summary.mismatch === 0 &&
      summary.missing === 0 &&
      summary.extra === 0 &&
      summary.match === summary.files,
  ) || Boolean(
    summary &&
      summary.missing === 0 &&
      summary.extra === 0 &&
      summary.match + summary.mismatch === summary.files &&
      eolOnly,
  )
  return { eolOnly, effectiveInSync, mismatchPaths }
}

// ------------------------------------------------------------------ CLI parse

function requiredValue(flag, value) {
  if (value === undefined || value === null || value === '' || String(value).startsWith('--')) {
    throw new UsageError(`${flag} 需要一个值`)
  }
  return value
}

function parseArgs(argv) {
  const opts = {
    dryRunFlag: false,
    apply: false,
    push: false,
    skipPush: false,
    mirrorDir: null,
    pkg: DEFAULT_PKG,
    skipTests: false,
    summary: null,
    requireClean: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') opts.help = true
    else if (arg === '--dry-run') opts.dryRunFlag = true
    else if (arg === '--apply') opts.apply = true
    else if (arg === '--push') opts.push = true
    else if (arg === '--skip-push') opts.skipPush = true
    else if (arg === '--skip-tests') opts.skipTests = true
    else if (arg === '--require-clean') opts.requireClean = true
    else if (arg === '--mirror-dir') opts.mirrorDir = requiredValue(arg, argv[++i])
    else if (arg.startsWith('--mirror-dir=')) opts.mirrorDir = requiredValue('--mirror-dir', arg.slice('--mirror-dir='.length))
    else if (arg === '--pkg') opts.pkg = requiredValue(arg, argv[++i])
    else if (arg.startsWith('--pkg=')) opts.pkg = requiredValue('--pkg', arg.slice('--pkg='.length))
    else if (arg === '--summary') opts.summary = requiredValue(arg, argv[++i])
    else if (arg.startsWith('--summary=')) opts.summary = requiredValue('--summary', arg.slice('--summary='.length))
    else throw new UsageError(`未知参数: ${arg}`)
  }

  if (opts.help) return opts
  if (opts.dryRunFlag && (opts.apply || opts.push || opts.skipPush)) {
    throw new UsageError('--dry-run 不能与 --push / --apply / --skip-push 同时使用')
  }
  if (opts.push && opts.skipPush) throw new UsageError('--push 与 --skip-push 互斥')
  if (!opts.mirrorDir && process.env.DSH_MIRROR_DIR) opts.mirrorDir = process.env.DSH_MIRROR_DIR
  opts.execute = opts.apply || opts.push || opts.skipPush
  opts.dryRun = !opts.execute
  opts.push = opts.push && opts.execute
  return opts
}

// ------------------------------------------------------------------ preflight

function createState() {
  return {
    info: null,
    stepsDone: [],
    syncAttempted: false,
    syncWrote: false,
    sourceBefore: null,
    sourceAfter: null,
    sourceCommitted: false,
    sourcePushed: false,
    mirrorBefore: null,
    mirrorAfter: null,
    mirrorCommitted: false,
    mirrorPushed: false,
    mirrorMainPushed: false,
    tagCreated: false,
    tagExisted: false,
    tagPushed: false,
    anyPushed: false,
    token: null,
  }
}

function preflight(opts) {
  const info = {
    checks: [],
    gates: [],
    warnings: [],
    pkg: null,
    mirror: null,
    content: null,
    tagVersion: null,
    noop: false,
    testCommands: [],
    proxyConfigured: false,
  }

  const record = (level, message) => {
    info.checks.push({ level, message })
    const label = { ok: '[OK]', warn: '[WARN]', gate: '[GATE]', skip: '[SKIP]', info: '[INFO]' }[level] ?? '[INFO]'
    log(`  ${label} ${message}`)
  }
  const gate = (message) => {
    info.gates.push(message)
    record('gate', message)
  }
  const fail = (message, hint) => {
    throw new ReleaseError(message, { step: '预检', hint })
  }

  log('== 0. 预检（只读） ==')

  // --- repository -----------------------------------------------------------
  if (!existsSync(RELEASE_PLUGIN)) fail(`缺少同步脚本: ${RELEASE_PLUGIN}`, '确认在 dsh-tree-harness 仓库内运行。')
  if (!existsSync(join(REPO_ROOT, '.git'))) fail(`${REPO_ROOT} 不是 git 仓库根（缺少 .git）`)

  const topRes = git(['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (topRes.status !== 0) fail(`git rev-parse 失败: ${tail(topRes.stderr)}`)
  const top = resolve(topRes.stdout.trim())
  if (top.toLowerCase() !== REPO_ROOT.toLowerCase()) {
    fail(`脚本不在仓库根解析（repo root=${top}，脚本父目录=${REPO_ROOT}）`, '把脚本放在 <repo>/scripts/ 下运行。')
  }
  record('ok', `仓库根 ${REPO_ROOT}`)

  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true })
  if (!branch || branch === 'HEAD') gate('当前处于 detached HEAD，发布要求 master 分支')
  else if (branch !== DEFAULT_BRANCH) gate(`当前分支 ${branch} != ${DEFAULT_BRANCH}，发布要求 ${DEFAULT_BRANCH}`)
  else record('ok', `分支 ${branch}`)

  const originRes = git(['remote', 'get-url', 'origin'], { allowFailure: true })
  if (originRes.status !== 0) fail('缺少 origin remote')
  const originUrl = originRes.stdout.trim()
  if (urlHasCredentials(originUrl)) {
    fail('origin URL 含内嵌凭据（禁止把 token 写进 remote URL）', '先 git remote set-url origin https://github.com/orphiczhou/dsh-tree-harness.git')
  }
  const originSlug = remoteSlug(originUrl)
  if (originSlug !== SOURCE_REPO_SLUG) gate(`origin=${originUrl}，期望 github.com/${SOURCE_REPO_SLUG}`)
  else record('ok', `origin ${originSlug}`)

  const statusText = gitOut(['status', '--porcelain'])
  const statusLines = statusText ? statusText.split(/\r?\n/).filter(Boolean) : []
  info.statusLines = statusLines
  const conflicts = gitOut(['diff', '--name-only', '--diff-filter=U'])
  if (conflicts) gate(`存在未合并冲突: ${conflicts.split(/\r?\n/).join(', ')}`)
  if (statusLines.length) {
    const details = statusLines.slice(0, 25).map((line) => `      ${line}`)
    if (opts.requireClean) {
      log(details.join('\n'))
      gate(`工作树非 clean（${statusLines.length} 项，--require-clean 已开启）`)
    } else {
      log(`  [WARN] 工作树有 ${statusLines.length} 项未提交改动：将随「本仓 git add -A」进入发布提交（--require-clean 可改为拒绝）`)
      for (const line of details) log(line)
      if (statusLines.length > 25) log(`      …（其余 ${statusLines.length - 25} 项省略）`)
      info.warnings.push(`工作树 dirty（${statusLines.length} 项）`)
    }
  } else {
    record('ok', '工作树 clean（git status --porcelain 为空）')
  }

  const headSha = gitOut(['rev-parse', 'HEAD'])
  record('info', `本仓 HEAD ${headSha}`)
  const sourceIdentity = git(['var', 'GIT_AUTHOR_IDENT'], { allowFailure: true })
  if (sourceIdentity.status !== 0) {
    gate(`本仓缺少 git 提交身份（user.name/user.email）：git config user.name "…" && git config user.email "…"`)
  }

  // --- package --------------------------------------------------------------
  const short = String(opts.pkg).split('/').pop()
  const pkgDir = join(REPO_ROOT, 'packages', short)
  const pkgJsonFile = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonFile)) {
    fail(`找不到包目录/package.json: ${pkgJsonFile}`, `用 --pkg 指定 packages/ 下的目录名（当前缺省 ${DEFAULT_PKG}）。`)
  }
  let pkgJson
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonFile, 'utf8'))
  } catch (error) {
    fail(`无法解析 ${pkgJsonFile}: ${error.message}`)
  }
  if (typeof pkgJson.name !== 'string' || typeof pkgJson.version !== 'string') {
    fail(`${pkgJsonFile} 缺少 name/version 字符串`)
  }
  if (String(opts.pkg).startsWith('@') && opts.pkg !== pkgJson.name) {
    fail(`--pkg ${opts.pkg} 与 package.json name ${pkgJson.name} 不一致`)
  }
  if (!parseSemver(pkgJson.version)) fail(`package.json.version 不是合法 semver: ${pkgJson.version}`)
  const sourceFiles = walkFiles(pkgDir)
  info.pkg = {
    short,
    name: pkgJson.name,
    version: pkgJson.version,
    dir: pkgDir,
    fileCount: sourceFiles.length,
  }
  record('ok', `包 ${pkgJson.name}@${pkgJson.version}（${sourceFiles.length} 个文件）`)

  // --- mirror checkout ------------------------------------------------------
  if (!opts.mirrorDir) {
    throw new ReleaseError(
      '缺少镜像 checkout：用 --mirror-dir <dir> 或环境变量 DSH_MIRROR_DIR 指定（脚本不硬编码开发机路径）',
      { step: '预检', hint: '先 clone 公开镜像仓到本地：git clone https://github.com/orphiczhou/dsh-session-tree.git <dir>' },
    )
  }
  const mirrorDir = resolve(opts.mirrorDir)
  if (!existsSync(mirrorDir)) {
    throw new ReleaseError(`镜像 checkout 不存在: ${mirrorDir}`, {
      step: '预检',
      hint: `先 clone：git clone https://github.com/orphiczhou/dsh-session-tree.git "${mirrorDir}"，并确认分支 main。`,
    })
  }
  if (!statSync(mirrorDir).isDirectory()) fail(`--mirror-dir 不是目录: ${mirrorDir}`)
  const mirrorNorm = mirrorDir.toLowerCase()
  if (mirrorNorm === REPO_ROOT.toLowerCase() || isInside(REPO_ROOT, mirrorDir) || isInside(mirrorDir, REPO_ROOT)) {
    fail(`--mirror-dir 不能与本仓重叠: ${mirrorDir}`)
  }
  const mirrorTopRes = git(['-C', mirrorDir, 'rev-parse', '--show-toplevel'], { allowFailure: true })
  if (mirrorTopRes.status !== 0) fail(`--mirror-dir 不是 git 工作树: ${mirrorDir}`)
  if (resolve(mirrorTopRes.stdout.trim()).toLowerCase() !== mirrorNorm) {
    fail(`--mirror-dir 是仓库子目录而非仓库根: ${mirrorDir}`)
  }

  const mirrorBranch = gitOut(['-C', mirrorDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true })
  if (mirrorBranch !== MIRROR_BRANCH) gate(`镜像分支 ${mirrorBranch || '(unknown)'} != ${MIRROR_BRANCH}`)

  const mirrorOriginRes = git(['-C', mirrorDir, 'remote', 'get-url', 'origin'], { allowFailure: true })
  if (mirrorOriginRes.status !== 0) fail('镜像 checkout 缺少 origin remote')
  const mirrorOrigin = mirrorOriginRes.stdout.trim()
  if (urlHasCredentials(mirrorOrigin)) fail('镜像 origin URL 含内嵌凭据（禁止 token 写入 remote URL）')
  const ownerMatch = /^@([^/]+)\//.exec(pkgJson.name)
  const expectedMirrorSlug = `${ownerMatch ? ownerMatch[1] : 'orphiczhou'}/${short}`.toLowerCase()
  const mirrorSlug = remoteSlug(mirrorOrigin)
  if (mirrorSlug !== expectedMirrorSlug) gate(`镜像 origin=${mirrorOrigin}，期望 github.com/${expectedMirrorSlug}`)

  const mirrorStatusText = gitOut(['-C', mirrorDir, 'status', '--porcelain'])
  const mirrorStatusLines = mirrorStatusText ? mirrorStatusText.split(/\r?\n/).filter(Boolean) : []
  const mirrorIdentity = git(['-C', mirrorDir, 'var', 'GIT_AUTHOR_IDENT'], { allowFailure: true })
  if (mirrorIdentity.status !== 0) {
    gate(
      `镜像 checkout 缺少 git 提交身份（user.name/user.email）：` +
        `git -C "${mirrorDir}" config user.name "…" && git -C "${mirrorDir}" config user.email "…"`,
    )
  }

  const mirrorHead = gitOut(['-C', mirrorDir, 'rev-parse', 'HEAD'])
  let mirrorPkg = null
  const mirrorPkgFile = join(mirrorDir, 'package.json')
  if (existsSync(mirrorPkgFile)) {
    try {
      mirrorPkg = JSON.parse(readFileSync(mirrorPkgFile, 'utf8'))
    } catch {
      /* 非 JSON：交给 release-plugin --check 报错 */
    }
  }
  if (mirrorPkg && mirrorPkg.name && mirrorPkg.name !== pkgJson.name) {
    gate(`镜像 package.json.name=${mirrorPkg.name} 与源 ${pkgJson.name} 不一致（疑似错仓）`)
  }
  const tagListRaw = gitOut(['-C', mirrorDir, 'for-each-ref', '--sort=-v:refname', '--format=%(refname:short)', 'refs/tags'], {
    allowFailure: true,
  })
  const semverTags = tagListRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(tag))
  const latestTag = semverTags[0] ?? null
  const tagVersion = latestTag ? latestTag.replace(/^v/, '') : (mirrorPkg?.version ?? null)
  info.mirror = {
    dir: mirrorDir,
    branch: mirrorBranch,
    origin: mirrorOrigin,
    slug: mirrorSlug,
    head: mirrorHead,
    latestTag,
    tagVersion,
    packageVersion: mirrorPkg?.version ?? null,
  }
  record('ok', `镜像 ${mirrorSlug ?? mirrorOrigin} @ ${mirrorHead.slice(0, 7)}（分支 ${mirrorBranch}，最新 tag ${latestTag ?? '无'}）`)

  // --- content drift (read-only release-plugin --check) ---------------------
  const checkRes = runReleasePlugin(['--check', '--target', mirrorDir, '--source', pkgDir])
  const checkOutput = `${checkRes.stdout}\n${checkRes.stderr}`
  const checkSummary = parseSyncSummary(checkOutput)
  if (!checkSummary) {
    fail(`无法解析 release-plugin --check 输出（exit ${checkRes.status}）: ${tail(checkRes.stderr || checkRes.stdout)}`)
  }
  const content = analyzeContent(mirrorDir, pkgDir, checkSummary, checkOutput)
  const inSync = content.effectiveInSync
  info.content = { summary: checkSummary, inSync, eolOnly: content.eolOnly, mismatchPaths: content.mismatchPaths }
  const detail = content.eolOnly
    ? `（${checkSummary.mismatch} 个 MISMATCH 仅为 CRLF 行尾差异，sync 后字节一致；Windows checkout 噪声）`
    : inSync
      ? '（与镜像逐字节一致）'
      : '（与镜像有实质差异）'
  record(inSync ? 'ok' : 'warn', `内容对账 ${syncSummaryLine(checkSummary)}${detail}`)

  // Mirror dirty state: a previous failed run may have synced the files but not
  // committed them. Accept that when the working tree already equals the source
  // (resumable); anything else must be cleaned by a human first.
  if (mirrorStatusLines.length) {
    const dirty = mirrorStatusLines.map(parseStatusEntry)
    const resumable =
      inSync &&
      dirty.every(({ code, path: dirtyPath }) => code.includes('D') || sourceFiles.includes(dirtyPath))
    if (resumable) {
      record('info', `镜像工作树有 ${dirty.length} 项上次同步遗留的未提交改动（与源一致，可继续提交）`)
    } else {
      gate(`镜像工作树非 clean（${dirty.length} 项）：同步/提交前必须干净（先人工处理或重新 clone）`)
    }
  } else {
    record('ok', '镜像工作树 clean')
  }

  // --- version discipline (D6) ---------------------------------------------
  if (!tagVersion) {
    gate('镜像仓没有可用 tag / package.json.version，无法做版本推进判断（先人工确认镜像状态）')
  } else {
    const cmp = compareSemver(pkgJson.version, tagVersion)
    if (Number.isNaN(cmp)) {
      gate(`版本无法比较：源 ${pkgJson.version} vs 镜像 ${tagVersion}`)
    } else if (cmp < 0) {
      gate(`版本回退：源 ${pkgJson.version} < 镜像 tag v${tagVersion}`)
    } else if (cmp === 0) {
      if (inSync) {
        info.noop = true
        record('ok', `包内容无变化不需要发布（版本 ${pkgJson.version} = 镜像 tag v${tagVersion}，SHA 全一致）`)
      } else {
        gate(
          `版本未 bump：包内容已变化但 version 仍为 ${pkgJson.version}（镜像 tag v${tagVersion}）→ ` +
            `先 bump packages/${short}/package.json 的 version（D6），再重跑`,
        )
      }
    } else {
      record('ok', `版本推进 v${tagVersion} → v${pkgJson.version}`)
      const existingTag = git(['-C', mirrorDir, 'rev-parse', '--verify', `refs/tags/v${pkgJson.version}`], { allowFailure: true })
      if (existingTag.status === 0) {
        const existingSha = gitOut(['-C', mirrorDir, 'rev-parse', `refs/tags/v${pkgJson.version}^{commit}`])
        if (existingSha !== mirrorHead) {
          gate(`镜像已存在 tag v${pkgJson.version} 且指向 ${existingSha.slice(0, 7)} != 当前 HEAD ${mirrorHead.slice(0, 7)}`)
        } else {
          record('info', `镜像已存在 tag v${pkgJson.version}（指向当前 HEAD，将复用）`)
        }
      }
    }
  }
  if (mirrorPkg?.version && tagVersion && compareSemver(mirrorPkg.version, tagVersion) !== 0) {
    record('warn', `镜像 package.json.version=${mirrorPkg.version} 与最新 tag v${tagVersion} 不一致（历史状态，记录备查）`)
  }

  // --- version consistency script (W2.4, if present) -----------------------
  if (existsSync(CONSISTENCY_SCRIPT)) {
    const res = runProcess(process.execPath, [CONSISTENCY_SCRIPT], { cwd: REPO_ROOT, allowFailure: true, timeout: 180_000 })
    for (const line of `${res.stdout}\n${res.stderr}`.trim().split(/\r?\n/).filter(Boolean).slice(-8)) log(`      ${line}`)
    if (res.status !== 0) gate(`scripts/check-version-consistency.mjs 失败（exit ${res.status}）`)
    else record('ok', 'scripts/check-version-consistency.mjs 通过')
  } else {
    record('skip', 'scripts/check-version-consistency.mjs 不存在（W2.4 尚未产出，跳过）')
  }

  // --- tests (planned here, executed only in real modes) --------------------
  if (short === 'dsh-session-tree') {
    const candidates = [
      'test/handoff.test.js',
      'test/skills.test.cjs',
      'test/style-guard.cjs',
      'test/render.test.cjs',
      'scripts/verify-bundle.mjs',
    ]
    info.testCommands = candidates.filter((rel) => existsSync(join(pkgDir, rel))).map((rel) => ({ rel }))
  }
  if (opts.skipTests) record('skip', '测试（--skip-tests）')
  else if (info.testCommands.length === 0) record('warn', '未找到已知测试入口（未知 --pkg），发布前请自行确认测试')
  else record('ok', `测试计划 ${info.testCommands.length} 条（dry-run 只打印，实跑执行）`)

  info.proxyConfigured = Boolean(gitOut(['config', '--get', 'http.proxy'], { allowFailure: true }))
  PROXY_CONFIGURED = info.proxyConfigured
  if (info.proxyConfigured) record('info', '检测到 git http.proxy；网络命令失败时自动用 -c http.proxy= 直连重试一次')

  return info
}

// ---------------------------------------------------------------------- plan

function sourceCommitMessage(opts, info) {
  const summary = opts.summary || `发布 v${info.pkg.version} 到公开镜像仓`
  return `feat/release: ${info.pkg.name} v${info.pkg.version} — ${summary}`
}

function mirrorCommitMessage(info) {
  return `sync: ${info.pkg.name}@${info.pkg.version} from dsh-tree-harness packages/${info.pkg.short}`
}

function printPlan(opts, info) {
  const mirror = info.mirror.dir
  const version = info.pkg.version
  const tag = `v${version}`
  const pushNote = opts.push ? '' : '   # 未给 --push：不执行'
  log('')
  log('== 步骤计划 ==')
  log('  1. 预检（只读；上方已执行，GATE 项会阻止真实运行）')
  if (opts.skipTests) log('  1b. 测试：[跳过 --skip-tests]')
  else if (info.testCommands.length) {
    log('  1b. 测试（本仓包目录内）:')
    for (const test of info.testCommands) log(`        node ${test.rel}`)
  } else log('  1b. 测试：未配置')
  log(`  2. 同步（单向，release-plugin.mjs；写入镜像 checkout）:`)
  log(`        node scripts/release-plugin.mjs --check --target "${mirror}"`)
  log(`        node scripts/release-plugin.mjs --target "${mirror}" --prune`)
  log(`        node scripts/release-plugin.mjs --check --target "${mirror}"      # 期望 ${info.pkg.fileCount}/${info.pkg.fileCount} SHA 一致`)
  log('  3. 本仓:')
  log('        git add -A')
  log(`        git commit -m "${sourceCommitMessage(opts, info)}"`)
  log(`        git push origin ${DEFAULT_BRANCH}${pushNote}`)
  log('  4. 镜像仓:')
  log(`        git -C "${mirror}" add -A`)
  log(`        git -C "${mirror}" commit -m "${mirrorCommitMessage(info)}"`)
  log(`        git -C "${mirror}" tag ${tag}`)
  log(`        git -C "${mirror}" push origin ${MIRROR_BRANCH}${pushNote}`)
  log(`        git -C "${mirror}" push origin ${tag}${pushNote}`)
  log('  5. 核对（远端 = 本地才成功）:')
  log(`        git ls-remote origin refs/heads/${DEFAULT_BRANCH}`)
  log(`        git ls-remote "${info.mirror.origin}" refs/heads/${MIRROR_BRANCH} refs/tags/${tag}`)
}

function printDryRunResult(opts, info) {
  log('')
  log('== DRY-RUN RESULT ==')
  if (info.noop) {
    log('NO-OP — 包内容无变化不需要发布；真实运行不会做任何写操作。')
  } else if (info.gates.length) {
    log(`BLOCKED — ${info.gates.length} 个发布门禁未通过；真实运行会在任何写操作之前停止（exit 1）：`)
    for (const gate of info.gates) log(`  - ${gate}`)
    log('dry-run 只做只读预检，因此 exit 0；修复上述 GATE 后再跑 --push/--skip-push。')
  } else {
    log('READY — 预检通过；真实运行将按上面步骤执行' + (opts.push ? '（含推送）' : '（未给 --push，不推送）') + '。')
  }
  log('DRY-RUN: 未写入任何文件、未运行 git 写命令、未读取 GH_TOKEN。')
}

// ----------------------------------------------------------------- tests run

function runTests(opts, info) {
  if (opts.skipTests) {
    log('[SKIP] 测试（--skip-tests）')
    return
  }
  if (!info.testCommands.length) {
    log('[WARN] 没有已知测试入口，跳过测试')
    return
  }
  log('')
  log(`== 步骤 1b: 测试（${info.pkg.short}） ==`)
  for (const test of info.testCommands) {
    echoCommand(process.execPath, [test.rel], info.pkg.dir)
    const res = runProcess(process.execPath, [test.rel], {
      cwd: info.pkg.dir,
      allowFailure: true,
      timeout: 900_000,
    })
    const lines = `${res.stdout}\n${res.stderr}`.trim().split(/\r?\n/).filter(Boolean)
    for (const line of lines.slice(-6)) log(`      ${line}`)
    if (res.status !== 0) {
      throw new ReleaseError(`测试失败: node ${test.rel}（exit ${res.status}）`, {
        step: '测试',
        hint: '先修到测试全绿再发布；测试阶段无写入，仓库与镜像均未改变。',
      })
    }
    log(`  [OK] ${test.rel}`)
  }
}

// ------------------------------------------------------------- execute steps

function syncStep(opts, info, state) {
  log('')
  log('== 步骤 2: 同步 packages → 镜像（release-plugin，单向 + SHA-256） ==')
  const mirror = info.mirror.dir
  state.syncAttempted = true

  log('  -- 同步前 --check（只读，记录差异）')
  echoCommand(process.execPath, [RELEASE_PLUGIN, '--check', '--target', mirror, '--source', info.pkg.dir])
  const before = runReleasePlugin(['--check', '--target', mirror, '--source', info.pkg.dir])
  const beforeSummary = parseSyncSummary(`${before.stdout}\n${before.stderr}`)
  log(`      ${syncSummaryLine(beforeSummary)}`)

  log('  -- 同步 + prune')
  echoCommand(process.execPath, [RELEASE_PLUGIN, '--target', mirror, '--source', info.pkg.dir, '--prune'])
  const sync = runReleasePlugin(['--target', mirror, '--source', info.pkg.dir, '--prune'], { allowFailure: false })
  state.syncWrote = true
  for (const line of `${sync.stdout}`.trimEnd().split(/\r?\n/)) log(`      ${line}`)
  const syncSummary = parseSyncSummary(`${sync.stdout}\n${sync.stderr}`)
  if (!syncClean(syncSummary)) {
    throw new ReleaseError(`同步后 SHA 对账未通过: ${syncSummaryLine(syncSummary)}`, {
      step: '同步',
      hint: '检查 release-plugin 输出的 mismatch/missing 行；镜像已部分写入，按回滚提示先 restore 再重试。',
    })
  }

  log('  -- 同步后 --check（必须全部一致）')
  echoCommand(process.execPath, [RELEASE_PLUGIN, '--check', '--target', mirror, '--source', info.pkg.dir])
  const after = runReleasePlugin(['--check', '--target', mirror, '--source', info.pkg.dir], { allowFailure: false })
  const afterSummary = parseSyncSummary(`${after.stdout}\n${after.stderr}`)
  if (!syncClean(afterSummary)) {
    throw new ReleaseError(`同步后 --check 未通过: ${syncSummaryLine(afterSummary)}`, {
      step: '同步',
      hint: 'target 与 source 仍不一致，检查是否有外部进程同时改镜像 checkout。',
    })
  }
  if (afterSummary.files !== info.pkg.fileCount) {
    warn(`release-plugin 报告 files=${afterSummary.files}，脚本统计源包文件数=${info.pkg.fileCount}（跳过规则差异，请复核）`)
  }
  const mirrorVersion = JSON.parse(readFileSync(join(mirror, 'package.json'), 'utf8')).version
  if (mirrorVersion !== info.pkg.version) {
    throw new ReleaseError(`同步后镜像 package.json.version=${mirrorVersion} != 源 ${info.pkg.version}`, { step: '同步' })
  }
  log(`  [OK] 同步完成：files=${afterSummary.files} match=${afterSummary.match} mismatch=0 missing=0 extra=0（SHA-256 全部一致）`)
  state.stepsDone.push(`2 同步（${afterSummary.files}/${afterSummary.files} SHA）`)
}

function sourceStep(opts, info, state) {
  log('')
  log(`== 步骤 3: 本仓提交${opts.push ? ' + 推送' : '（不推送）'} ==`)
  state.sourceBefore = gitOut(['rev-parse', 'HEAD'])

  echoCommand('git', ['add', '-A'])
  gitOut(['add', '-A'])
  const staged = git(['diff', '--cached', '--quiet'], { allowFailure: true })
  if (staged.status > 1) throw new ReleaseError(`git diff --cached 失败: ${tail(staged.stderr)}`, { step: '本仓提交' })
  if (staged.status === 0) {
    log('  [SKIP] 无待提交改动（发布内容已在 HEAD 中）')
  } else {
    echoCommand('git', ['diff', '--cached', '--stat'])
    for (const line of gitOut(['diff', '--cached', '--stat']).split(/\r?\n/).filter(Boolean).slice(-20)) log(`      ${line}`)
    const message = sourceCommitMessage(opts, info)
    echoCommand('git', ['commit', '-m', message])
    const commit = git(['commit', '-m', message], { allowFailure: false })
    for (const line of `${commit.stdout}`.trim().split(/\r?\n/).filter(Boolean).slice(0, 6)) log(`      ${line}`)
    state.sourceAfter = gitOut(['rev-parse', 'HEAD'])
    state.sourceCommitted = true
    log(`  [OK] 本仓提交 ${state.sourceBefore.slice(0, 7)} → ${state.sourceAfter.slice(0, 7)}`)
  }

  if (!opts.push) {
    log('  [SKIP] 未推送本仓（未给 --push）')
  } else {
    state.token = state.token || requireToken()
    log('  -- push origin（token 经子进程环境 GIT_CONFIG_* 注入，不打印/不落盘/不进 argv）')
    echoCommand('git', ['push', 'origin', DEFAULT_BRANCH])
    const push = gitNetwork(['push', 'origin', DEFAULT_BRANCH], { token: state.token, allowFailure: true })
    for (const line of `${push.stdout}\n${push.stderr}`.trim().split(/\r?\n/).filter(Boolean).slice(-6)) log(`      ${line}`)
    if (push.status !== 0) {
      throw new ReleaseError(`本仓 push 失败（exit ${push.status}）: ${tail(push.stderr || push.stdout)}`, {
        step: '本仓推送',
        hint: '检查 GH_TOKEN / 网络后重试 push（本地提交已生成，可复用）。',
      })
    }
    state.sourcePushed = true
    state.anyPushed = true
    log(`  [OK] 已推送 origin ${DEFAULT_BRANCH}`)
  }
  state.stepsDone.push(`3 本仓提交${state.sourceCommitted ? '' : '（无新提交）'}${state.sourcePushed ? ' + push' : '（未推送）'}`)
}

function mirrorStep(opts, info, state) {
  log('')
  log(`== 步骤 4: 镜像仓提交 + tag v${info.pkg.version}${opts.push ? ' + 推送' : '（不推送）'} ==`)
  const mirror = info.mirror.dir
  state.mirrorBefore = gitOut(['-C', mirror, 'rev-parse', 'HEAD'])
  if (state.mirrorBefore !== info.mirror.head) {
    throw new ReleaseError('镜像 HEAD 在预检后被其他进程改变（预检时 HEAD 已过期）', {
      step: '镜像仓提交',
      hint: '重新检查镜像 checkout 状态后重跑；本脚本会重新预检。',
    })
  }

  echoCommand('git', ['-C', mirror, 'add', '-A'])
  gitOut(['-C', mirror, 'add', '-A'])
  const staged = git(['-C', mirror, 'diff', '--cached', '--quiet'], { allowFailure: true })
  if (staged.status > 1) throw new ReleaseError(`git -C mirror diff --cached 失败: ${tail(staged.stderr)}`, { step: '镜像仓提交' })
  if (staged.status === 0) {
    log('  [SKIP] 镜像无待提交改动（内容已在 HEAD 中）')
  } else {
    echoCommand('git', ['-C', mirror, 'diff', '--cached', '--stat'])
    for (const line of gitOut(['-C', mirror, 'diff', '--cached', '--stat']).split(/\r?\n/).filter(Boolean).slice(-20)) {
      log(`      ${line}`)
    }
    const message = mirrorCommitMessage(info)
    echoCommand('git', ['-C', mirror, 'commit', '-m', message])
    const commit = git(['-C', mirror, 'commit', '-m', message], { allowFailure: false })
    for (const line of `${commit.stdout}`.trim().split(/\r?\n/).filter(Boolean).slice(0, 6)) log(`      ${line}`)
    state.mirrorAfter = gitOut(['-C', mirror, 'rev-parse', 'HEAD'])
    state.mirrorCommitted = true
    log(`  [OK] 镜像提交 ${state.mirrorBefore.slice(0, 7)} → ${state.mirrorAfter.slice(0, 7)}`)
  }

  const tag = `v${info.pkg.version}`
  const existing = git(['-C', mirror, 'rev-parse', '--verify', `refs/tags/${tag}`], { allowFailure: true })
  if (existing.status === 0) {
    const tagSha = gitOut(['-C', mirror, 'rev-parse', `${tag}^{commit}`])
    const head = gitOut(['-C', mirror, 'rev-parse', 'HEAD'])
    if (tagSha !== head) {
      throw new ReleaseError(`镜像 tag ${tag} 已存在且指向 ${tagSha.slice(0, 7)} != HEAD ${head.slice(0, 7)}`, {
        step: '镜像 tag',
        hint: `先确认 ${tag} 是否应为旧版本；如确需重发，手工删除错误 tag 后再重跑（不要覆盖已发布 tag）。`,
      })
    }
    state.tagExisted = true
    log(`  [SKIP] tag ${tag} 已存在且指向当前 HEAD`)
  } else {
    echoCommand('git', ['-C', mirror, 'tag', tag])
    gitOut(['-C', mirror, 'tag', tag])
    state.tagCreated = true
    log(`  [OK] 已创建 tag ${tag}`)
  }

  if (!opts.push) {
    log('  [SKIP] 未推送镜像（未给 --push）')
  } else {
    state.token = state.token || requireToken()
    for (const [label, args, isMain] of [
      ['main', ['-C', mirror, 'push', 'origin', MIRROR_BRANCH], true],
      [`tag ${tag}`, ['-C', mirror, 'push', 'origin', tag], false],
    ]) {
      echoCommand('git', args)
      const push = gitNetwork(args, { token: state.token, allowFailure: true })
      for (const line of `${push.stdout}\n${push.stderr}`.trim().split(/\r?\n/).filter(Boolean).slice(-6)) log(`      ${line}`)
      if (push.status !== 0) {
        throw new ReleaseError(`镜像推送失败（${label}，exit ${push.status}）: ${tail(push.stderr || push.stdout)}`, {
          step: '镜像推送',
          hint: '本地 commit/tag 已生成；检查 GH_TOKEN/网络后重试对应 push，或按回滚提示处理。',
        })
      }
      if (isMain) state.mirrorMainPushed = true
      else state.tagPushed = true
      state.anyPushed = true
      log(`  [OK] 已推送 ${label}`)
    }
    state.mirrorPushed = state.mirrorMainPushed
  }
  state.stepsDone.push(
    `4 镜像提交${state.mirrorCommitted ? '' : '（无新提交）'} + tag ${tag}${state.tagPushed ? ' + push' : '（未推送）'}`,
  )
}

function parseLsRemote(text) {
  const map = new Map()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim())
    if (match) map.set(match[2], match[1])
  }
  return map
}

function verifyStep(opts, info, state) {
  log('')
  log('== 步骤 5: 远端核对（ls-remote） ==')
  if (!opts.push) {
    log('  [SKIP] 未推送（未给 --push）：跳过远端核对；本地提交/tag 已生成。')
    state.stepsDone.push('5 远端核对（跳过：未推送）')
    return
  }

  const localSource = gitOut(['rev-parse', DEFAULT_BRANCH])
  echoCommand('git', ['ls-remote', 'origin', `refs/heads/${DEFAULT_BRANCH}`])
  const sourceRemote = gitNetwork(['ls-remote', 'origin', `refs/heads/${DEFAULT_BRANCH}`], { token: state.token, allowFailure: true })
  if (sourceRemote.status !== 0) {
    throw new ReleaseError(`本仓 ls-remote 失败: ${tail(sourceRemote.stderr)}`, { step: '远端核对' })
  }
  const sourceMap = parseLsRemote(sourceRemote.stdout)
  const remoteSource = sourceMap.get(`refs/heads/${DEFAULT_BRANCH}`)
  if (remoteSource !== localSource) {
    throw new ReleaseError(`本仓远端 ${DEFAULT_BRANCH}=${remoteSource ?? '(missing)'} != 本地 ${localSource}`, {
      step: '远端核对',
      hint: 'push 可能未生效（检查分支保护/网络），或本地在 push 后又有新提交；重试 push 后再核对。',
    })
  }
  log(`  [OK] origin/${DEFAULT_BRANCH} = ${remoteSource}`)

  const mirror = info.mirror.dir
  const tag = `v${info.pkg.version}`
  const localMirrorHead = gitOut(['-C', mirror, 'rev-parse', 'HEAD'])
  const localTag = gitOut(['-C', mirror, 'rev-parse', `${tag}^{commit}`])
  echoCommand('git', ['ls-remote', info.mirror.origin, `refs/heads/${MIRROR_BRANCH}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
  const mirrorRemote = gitNetwork(
    ['ls-remote', info.mirror.origin, `refs/heads/${MIRROR_BRANCH}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    { token: state.token, allowFailure: true },
  )
  if (mirrorRemote.status !== 0) {
    throw new ReleaseError(`镜像 ls-remote 失败: ${tail(mirrorRemote.stderr)}`, { step: '远端核对' })
  }
  const mirrorMap = parseLsRemote(mirrorRemote.stdout)
  const remoteMain = mirrorMap.get(`refs/heads/${MIRROR_BRANCH}`)
  const remoteTagPeeled = mirrorMap.get(`refs/tags/${tag}^{}`) ?? mirrorMap.get(`refs/tags/${tag}`)
  const problems = []
  if (remoteMain !== localMirrorHead) problems.push(`main=${remoteMain ?? '(missing)'} != 本地 ${localMirrorHead}`)
  if (remoteTagPeeled !== localTag) problems.push(`tag ${tag}=${remoteTagPeeled ?? '(missing)'} != 本地 ${localTag}`)
  if (problems.length) {
    throw new ReleaseError(`镜像远端核对失败: ${problems.join('；')}`, {
      step: '远端核对',
      hint: '检查镜像 push 结果与 tag 是否指向同一 commit；必要时按回滚提示删除/重推 tag。',
    })
  }
  log(`  [OK] mirror main = ${remoteMain}`)
  log(`  [OK] mirror tag ${tag} = ${remoteTagPeeled}`)
  state.stepsDone.push('5 远端核对（main + tag = 本地）')
}

function printSuccess(opts, info, state) {
  log('')
  log('== 发布完成 ==')
  log(`  包: ${info.pkg.name}@${info.pkg.version}`)
  log(`  本仓: HEAD ${state.sourceAfter ?? state.sourceBefore ?? '(未提交)'}${state.sourcePushed ? '（已推送）' : '（未推送）'}`)
  log(`  镜像: HEAD ${state.mirrorAfter ?? state.mirrorBefore}${state.mirrorCommitted ? '' : '（无新提交）'}${state.mirrorPushed ? '（main + tag 已推送）' : '（未推送）'}`)
  if (!opts.push) {
    log('  提示: 本次为本地演练（未给 --push），未联网写远端；发布时由 Lead 用 --push 执行。')
  }
}

// ---------------------------------------------------------------- rollback

function rollbackHints(state, opts) {
  const hints = []
  const info = state.info
  const mirror = info?.mirror?.dir || (opts.mirrorDir ? resolve(opts.mirrorDir) : '<mirror-dir>')
  const version = info?.pkg?.version ?? '<version>'
  const tag = `v${version}`

  if (state.sourceCommitted && state.sourceBefore) {
    if (!state.sourcePushed) {
      hints.push(`本仓本地发布提交（未推送）: git reset --soft ${state.sourceBefore}   # 改动回到暂存区，不丢文件`)
    } else {
      hints.push(`本仓发布提交已推送: git revert --no-edit ${state.sourceAfter} && git push origin ${DEFAULT_BRANCH}   # 共享分支不要 force push`)
    }
  }
  if (state.syncAttempted && !state.mirrorCommitted) {
    hints.push(
      `镜像文件已同步但未提交: git -C "${mirror}" checkout -- . && git -C "${mirror}" clean -fd   # 恢复到同步前；有手工改动先备份`,
    )
  }
  if (state.mirrorCommitted && state.mirrorBefore) {
    if (!state.mirrorMainPushed) {
      hints.push(`镜像仓本地提交（未推送）: git -C "${mirror}" reset --soft ${state.mirrorBefore}`)
    } else {
      hints.push(`镜像提交已推送: git -C "${mirror}" revert --no-edit ${state.mirrorAfter} && git -C "${mirror}" push origin ${MIRROR_BRANCH}`)
    }
  }
  if (state.tagCreated) {
    if (state.tagPushed) {
      hints.push(
        `远端 tag 已推送: git -C "${mirror}" push origin :refs/tags/${tag}   # 仅确认无消费者拉取时；更稳妥做法是保留旧 tag、发新 patch 版本`,
      )
    } else {
      hints.push(`本地 tag: git -C "${mirror}" tag -d ${tag}`)
    }
  } else if (state.tagExisted) {
    hints.push(`tag ${tag} 为运行前已存在（本次复用），回滚时不要删除该 tag`)
  }
  if (opts.push && !state.anyPushed) {
    hints.push('重试推送: 确认 GH_TOKEN 与网络后重跑本命令（已完成的本地提交会被复用，不会重复提交）')
  }
  if (!hints.length) {
    hints.push('无自动回滚动作：失败发生在任何写操作之前（预检/测试/门禁），本仓与镜像均未改变。')
  }
  hints.push('本工具不改 profile；若本机插件需回退，按 agent.md §6.1 还原 profile 备份并对相关 bundle 做 disable→enable。')
  return hints
}

function reportFailure(error, state, opts) {
  log('')
  log('='.repeat(72))
  log('release-all: FAILED')
  if (error instanceof ReleaseError && error.step) log(`步骤: ${error.step}`)
  log(`原因: ${error instanceof Error ? error.message : String(error)}`)
  log(`已完成: ${state.stepsDone.length ? state.stepsDone.join('；') : '无（尚未进入写操作）'}`)
  const hint =
    error instanceof ReleaseError && error.hint
      ? error.hint
      : '按上面错误修复后重跑；脚本可重复执行，已完成的同步/提交/tag 会被复用或明确报冲突。'
  log(`下一步人工处置: ${hint}`)
  log('回滚命令（按需、按反向顺序；执行前先确认目标路径与 SHA）:')
  for (const line of rollbackHints(state, opts)) log(`  - ${line}`)
  log('='.repeat(72))
  return 1
}

// -------------------------------------------------------------------- main

function main(argv = process.argv.slice(2)) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    console.error(`release-all: ${error instanceof Error ? error.message : String(error)}`)
    console.error('')
    console.error(USAGE)
    return 2
  }
  if (opts.help) {
    console.log(USAGE)
    return 0
  }

  log(`release-all — ${opts.pkg}  [${opts.dryRun ? 'DRY-RUN' : opts.push ? 'PUSH' : 'LOCAL --skip-push'}]`)
  log(`  repo:   ${REPO_ROOT}`)
  log(`  mirror: ${opts.mirrorDir ? resolve(opts.mirrorDir) : '(未指定)'}`)

  const state = createState()
  try {
    // Fail before any write if --push is requested but no credential is available.
    // (Read only in push mode; dry-run / --skip-push never touch GH_TOKEN.)
    if (!opts.dryRun && opts.push) state.token = requireToken()
    const info = preflight(opts)
    state.info = info
    printPlan(opts, info)
    if (opts.dryRun) {
      printDryRunResult(opts, info)
      return 0
    }
    if (info.noop) {
      log('')
      log('包内容无变化不需要发布：未做任何写操作。')
      return 0
    }
    if (info.gates.length) {
      throw new ReleaseError(info.gates.join('；'), {
        step: '预检 GATE',
        hint: '按上方 GATE 修复后重跑；真实运行在任何写操作之前停止，仓库与镜像均未改变。',
      })
    }
    runTests(opts, info)
    syncStep(opts, info, state)
    sourceStep(opts, info, state)
    mirrorStep(opts, info, state)
    verifyStep(opts, info, state)
    printSuccess(opts, info, state)
    return 0
  } catch (error) {
    return reportFailure(error, state, opts)
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SCRIPT_PATH).toLowerCase()
if (invokedDirectly) {
  process.exitCode = main()
}

export { parseArgs, parseSemver, compareSemver, remoteSlug, syncClean, gitEnv }
