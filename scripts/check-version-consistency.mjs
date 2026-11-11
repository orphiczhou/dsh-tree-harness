#!/usr/bin/env node
// W2.4 — Skill / README / code version-consistency checker (READ-ONLY).
//
// Usage:
//   node scripts/check-version-consistency.mjs               # full static check (human readable)
//   node scripts/check-version-consistency.mjs --json        # machine-readable result
//   node scripts/check-version-consistency.mjs --run-tests   # additionally execute the tree-engine suite
//   node scripts/check-version-consistency.mjs --root <dir>  # check another checkout (self-test only)
//
// Exit codes: 0 = all checks pass, 1 = at least one check failed, 2 = usage / root error.
//
// ---------------------------------------------------------------------------
// 口径（facts）与局限
// ---------------------------------------------------------------------------
// 事实源：
//   1. packages/*/package.json 的 "version"（tree-engine / session-tree / agent-introspect）。
//   2. packages/dsh-tree-engine/index.js 的 `export const TOOLS = Object.freeze([...])`：
//      静态解析（不 import / 不执行插件代码），按 TOOLS.length 得到工具数，并从每个
//      `const TREE_X = { name: 'tree_x' }` 定义里取出工具名；不硬编码期望清单。
//   3. 3 份 SKILL.md 的 YAML frontmatter（name / description / whenToUse）。
//   4. tree-engine 测试数：默认取 README.md「# tests N / pass N / fail 0（分解式…）」的
//      当前文档口径（declared），并校验分解式各项之和 == N。**默认不实跑测试**（快、纯只读）；
//      加 --run-tests 才实际执行 `node --test tests/*.test.js`（TAP），把实跑 tests 数与
//      declared 比对。局限：默认模式只能保证「文档之间 + 分解式自洽」，不能证明实跑数字；
//      发版门禁建议用 `--run-tests`（约 5s）。
//
// 断言范围 / 白名单（避免历史段落误报）：
//   - 只断言「当前快照 / 标题行」：
//       README.md 顶部组件表、验证命令块、SKILL 工程化节；
//       agent.md 顶部「最后更新」与 §2 状态快照；
//       docs/README.md 顶部「当前快照」；
//       docs/guides/skills-usage.md 顶部「适用版本」与 §9「版本与升级」；
//       packages/*/README.md 顶部版本节（tree-engine 只查最新 `## vX.Y.Z` 头）；
//       docs/project-map-2026-11-11.html 的 hero / 组件表 / 测试 metric。
//   - CHANGELOG.md 按版本分节，本质是历史 → 只查存在性（Unreleased + 当前版本条目）。
//   - tree-engine 包的 README v0.2–v0.5.x 各节是历史 release notes，不参与断言。
//   - SKILL **正文**里的「8 个工具 / 随 tree-engine v0.5.1 分发」属于 Wave-1 收口遗留
//     文档债（SKILL 自称 v0.5.1 语义），不在本脚本写作用域内修改 → 以 [warn] 观察项
//     报告，不阻断退出码；Lead 修好后观察项自动消失。
//   - project-map 的版本演进 / 页脚 / 历史表同理：只对 hero/组件表/metric 断言，
//     其余漂移（如页脚 v0.5.1、troubleshooting 里的 8 个 tree_*）以 [warn] 报告。
//
// 只读保证：本脚本只使用 readFileSync / existsSync / readdirSync，不写任何文件；
// --run-tests 只 spawn 测试进程（测试自身使用临时目录）。
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PACKAGES = {
  engine: { rel: 'packages/dsh-tree-engine/package.json', name: '@local/dsh-tree-engine' },
  session: { rel: 'packages/dsh-session-tree/package.json', name: '@orphiczhou/dsh-session-tree' },
  introspect: { rel: 'packages/dsh-agent-introspect/package.json', name: '@local/dsh-agent-introspect' },
}
const SKILLS = [
  { rel: 'packages/dsh-tree-engine/skills/tree-commander/SKILL.md', name: 'tree-commander' },
  { rel: 'packages/dsh-tree-engine/skills/tree-worker/SKILL.md', name: 'tree-worker' },
  { rel: 'packages/dsh-session-tree/skills/session-handoff/SKILL.md', name: 'session-handoff' },
]
const DOCS = {
  readme: 'README.md',
  agent: 'agent.md',
  docsReadme: 'docs/README.md',
  skillsUsage: 'docs/guides/skills-usage.md',
  changelog: 'CHANGELOG.md',
  map: 'docs/project-map-2026-11-11.html',
  engineReadme: 'packages/dsh-tree-engine/README.md',
  sessionReadme: 'packages/dsh-session-tree/README.md',
  introspectReadme: 'packages/dsh-agent-introspect/README.md',
}

// ------------------------------ CLI ---------------------------------------

const USAGE = `usage: node scripts/check-version-consistency.mjs [--json] [--run-tests] [--root <dir>]

  (no flags)   full static consistency check (read-only, fast)
  --json       print the structured result as JSON
  --run-tests  also execute packages/dsh-tree-engine tests and compare the
               executed count with the documented count (slower, ~5s)
  --root <dir> check another checkout instead of process.cwd() (self-test)`

let json = false
let runTests = false
let rootArg = null
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') json = true
  else if (a === '--run-tests') runTests = true
  else if (a === '--root') rootArg = argv[++i]
  else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0) }
  else {
    console.error(`check-version-consistency: unknown argument: ${a}\n\n${USAGE}`)
    process.exit(2)
  }
}
if (rootArg !== null && (!rootArg || rootArg.startsWith('--'))) {
  console.error('check-version-consistency: --root requires a directory argument')
  process.exit(2)
}
const root = path.resolve(rootArg ?? process.cwd())
if (!existsSync(path.join(root, PACKAGES.engine.rel))) {
  console.error(`check-version-consistency: not a dsh-tree-harness checkout: ${root} (missing ${PACKAGES.engine.rel})`)
  process.exit(2)
}

// ---------------------------- helpers -------------------------------------

class CheckFailure extends Error {
  constructor(detail, fields = {}) {
    super(detail)
    this.detail = detail
    this.file = fields.file
    this.line = fields.line
    this.expected = fields.expected
    this.actual = fields.actual
  }
}

function fail(detail, fields = {}) {
  throw new CheckFailure(detail, fields)
}

function assertEqual(actual, expected, detail, fields = {}) {
  if (actual !== expected) fail(detail || 'value mismatch', { ...fields, expected, actual })
}

function read(rel) {
  const abs = path.join(root, rel)
  if (!existsSync(abs)) fail('file does not exist', { file: rel })
  return readFileSync(abs, 'utf8')
}

function lineOfIndex(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function allMatches(text, re) {
  if (!re.global) throw new Error('allMatches requires a /g regexp')
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m, index: m.index, line: lineOfIndex(text, m.index) })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

// Find the first line matching a per-line regexp; returns { m, line, text } or null.
function findLine(text, re) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (m) return { m, line: i + 1, text: lines[i] }
  }
  return null
}

function anchor(text, re, rel, what) {
  const hit = findLine(text, re)
  if (!hit) fail(`anchor not found: ${what}`, { file: rel })
  return hit
}

function stripBold(s) {
  return s.replace(/\*/g, '').trim()
}

function yamlScalar(raw) {
  let v = raw.trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  return v.trim()
}

// Numbers in a test breakdown such as "62 引擎 + 4 技能打包 + 1 B1 回归 + …".
// A naive /\d+/ would also grab the "1" inside "B1", so exclude digits that
// are preceded by an ASCII letter.
function breakdownNumbers(text) {
  return [...text.matchAll(/(?<![A-Za-z])(\d+)/g)].map((m) => Number(m[1]))
}

// --------------------------- fact loading ---------------------------------

const factCache = new Map()
function cached(key, fn) {
  if (!factCache.has(key)) {
    try {
      factCache.set(key, { ok: true, value: fn() })
    } catch (e) {
      factCache.set(key, { ok: false, error: e })
    }
  }
  const c = factCache.get(key)
  if (!c.ok) throw c.error
  return c.value
}

function readPackage(key) {
  const def = PACKAGES[key]
  const text = read(def.rel)
  let pkg
  try {
    pkg = JSON.parse(text)
  } catch (e) {
    fail(`invalid JSON: ${e.message}`, { file: def.rel })
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version ?? '')) {
    fail('version is not semver', { file: def.rel, actual: pkg.version })
  }
  const nameLine = findLine(text, /"name"\s*:\s*"([^"]+)"/)
  assertEqual(pkg.name, def.name, 'unexpected package name', {
    file: def.rel,
    line: nameLine?.line,
    actual: pkg.name,
  })
  return { ...pkg, __text: text }
}

function versions() {
  return cached('versions', () => ({
    engine: readPackage('engine').version,
    session: readPackage('session').version,
    introspect: readPackage('introspect').version,
  }))
}

function loadTools() {
  return cached('tools', () => {
    const rel = 'packages/dsh-tree-engine/index.js'
    const text = read(rel)
    const arr = text.match(/export\s+const\s+TOOLS\s*=\s*Object\.freeze\s*\(\s*\[([\s\S]*?)\]\s*\)/)
    if (!arr) fail('cannot locate `export const TOOLS = Object.freeze([...])`', { file: rel })
    const ids = [...arr[1].matchAll(/\bTREE_[A-Z0-9_]+\b/g)].map((m) => m[0])
    const unique = [...new Set(ids)]
    const line = lineOfIndex(text, arr.index)
    if (unique.length !== ids.length) fail('TOOLS array contains duplicate identifiers', { file: rel, line })
    if (unique.length === 0) fail('TOOLS array is empty', { file: rel, line })
    const names = unique.map((id) => {
      const def = new RegExp('const\\s+' + id + '\\s*=\\s*\\{')
      const m = def.exec(text)
      if (!m) fail(`TOOLS entry ${id} has no \`const ${id} = {\` definition`, { file: rel, line })
      const block = text.slice(m.index, m.index + 900)
      const nm = block.match(/name:\s*'([^']+)'/)
      if (!nm) fail(`cannot read the \`name\` field of ${id}`, { file: rel, line: lineOfIndex(text, m.index) })
      return nm[1]
    })
    for (const name of names) {
      if (!/^tree_[a-z0-9_]+$/.test(name)) fail(`unexpected tool name: ${name}`, { file: rel, line })
    }
    if (new Set(names).size !== names.length) fail('duplicate tool names in TOOLS', { file: rel, line })
    return { count: names.length, names, rel, line }
  })
}

function declaredTests() {
  return cached('declaredTests', () => {
    const rel = DOCS.readme
    const text = read(rel)
    const hit = anchor(
      text,
      /# tests (\d+) \/ pass (\d+) \/ fail (\d+)（([^）]*)）/,
      rel,
      '`# tests N / pass N / fail 0（breakdown）` verification block',
    )
    const [, testsS, passS, failS, breakdown] = hit.m
    const tests = Number(testsS)
    const pass = Number(passS)
    const failed = Number(failS)
    const parts = breakdownNumbers(breakdown)
    assertEqual(pass, tests, 'README pass count must equal tests count', {
      file: rel,
      line: hit.line,
      actual: pass,
    })
    assertEqual(failed, 0, 'README fail count must be 0', { file: rel, line: hit.line, actual: failed })
    if (parts.length < 2) fail('README test breakdown has no components', { file: rel, line: hit.line })
    const sum = parts.reduce((a, b) => a + b, 0)
    assertEqual(sum, tests, 'README breakdown components must sum to tests count', {
      file: rel,
      line: hit.line,
      actual: sum,
    })
    return { count: tests, parts, file: rel, line: hit.line }
  })
}

// ---------------------------- checks ---------------------------------------

const checks = []
function check(id, fn) {
  try {
    const detail = fn()
    checks.push({ id, ok: true, detail: detail ?? undefined })
  } catch (e) {
    if (e instanceof CheckFailure) {
      checks.push({ id, ok: false, detail: e.detail, file: e.file, line: e.line, expected: e.expected, actual: e.actual })
    } else {
      checks.push({ id, ok: false, detail: e && e.message ? e.message : String(e) })
    }
  }
}

// --- facts -----------------------------------------------------------------

check('facts/package-json', () => {
  const v = versions()
  // readPackage already validates name + semver; force-load all three packages.
  const names = Object.keys(PACKAGES).map((k) => `${k}=${v[k]}`)
  return names.join(', ')
})

check('facts/tools-export', () => {
  const tools = loadTools()
  return `${tools.count} tools: ${tools.names.join(', ')}`
})

check('facts/tree-engine-description-tool-count', () => {
  const pkg = readPackage('engine')
  const tools = loadTools()
  const hit = findLine(pkg.__text, /\((\d+) tree_\* tools\)/)
  if (!hit) fail('package.json description does not state `(N tree_* tools)`', { file: PACKAGES.engine.rel })
  assertEqual(Number(hit.m[1]), tools.count, 'package.json description tool count != TOOLS.length', {
    file: PACKAGES.engine.rel,
    line: hit.line,
    actual: Number(hit.m[1]),
  })
  return `description says ${tools.count} tree_* tools`
})

// --- SKILL frontmatter ------------------------------------------------------

function skillFrontmatter(rel, expectedName) {
  const text = read(rel)
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!fm) fail('SKILL.md must start with a YAML frontmatter block (`---`)', { file: rel, line: 1 })
  const lines = fm[1].split(/\r?\n/)
  const fields = new Map()
  const fieldLine = new Map()
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (m) {
      fields.set(m[1], m[2])
      fieldLine.set(m[1], i + 2) // file line: frontmatter starts at line 1, content at line 2
    }
  }
  const name = yamlScalar(fields.get('name') ?? '')
  const description = yamlScalar(fields.get('description') ?? '')
  const whenToUse = yamlScalar(fields.get('whenToUse') ?? '')

  if (!fields.has('name')) fail('frontmatter field `name` is missing', { file: rel, line: 1 })
  assertEqual(name, expectedName, `frontmatter name must be ${expectedName}`, {
    file: rel,
    line: fieldLine.get('name'),
    actual: name,
  })
  const dirName = path.basename(path.dirname(rel))
  assertEqual(name, dirName, 'frontmatter name must equal its directory name', {
    file: rel,
    line: fieldLine.get('name'),
    actual: name,
  })
  if (!fields.has('description')) fail('frontmatter field `description` is missing', { file: rel, line: 1 })
  if (description.length === 0) fail('frontmatter `description` is empty', { file: rel, line: fieldLine.get('description') })
  if (!fields.has('whenToUse')) fail('frontmatter field `whenToUse` is missing', { file: rel, line: 1 })
  if (whenToUse.length === 0) fail('frontmatter `whenToUse` is empty', { file: rel, line: fieldLine.get('whenToUse') })
  return `${expectedName}: description ${description.length} chars, whenToUse ${whenToUse.length} chars`
}

for (const skill of SKILLS) {
  check(`skill/${skill.name}/frontmatter`, () => skillFrontmatter(skill.rel, skill.name))
}

// --- README.md --------------------------------------------------------------

function componentRow(rel, packageDir) {
  const text = read(rel)
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|') && lines[i].includes('`' + packageDir + '`')) {
      return { cells: lines[i].split('|').map((s) => s.trim()), line: i + 1, text: lines[i] }
    }
  }
  fail(`component table row for \`${packageDir}\` not found`, { file: rel })
}

check('readme/component-versions', () => {
  const v = versions()
  const out = []
  for (const [key, def] of Object.entries(PACKAGES)) {
    const dir = def.rel.split('/').slice(0, 2).join('/') // packages/<pkg>
    const row = componentRow(DOCS.readme, dir)
    const actual = stripBold(row.cells[2] ?? '')
    assertEqual(actual, v[key], `README component version for ${dir}`, {
      file: DOCS.readme,
      line: row.line,
      actual,
    })
    out.push(`${dir}=${v[key]}`)
  }
  return out.join(', ')
})

check('readme/tool-count', () => {
  const tools = loadTools()
  const rel = DOCS.readme
  const text = read(rel)
  const claims = [
    ...allMatches(text, /(\d+)\s*个\s*`tree_\*`\s*工具/g).map((x) => ({ n: Number(x.match[1]), line: x.line })),
    ...allMatches(text, /实际注册的\s*(\d+)\s*个工具/g).map((x) => ({ n: Number(x.match[1]), line: x.line })),
  ]
  if (claims.length === 0) fail('no tool-count claim found (`N 个 tree_* 工具`)', { file: rel })
  for (const c of claims) {
    assertEqual(c.n, tools.count, 'README tool count != TOOLS.length', { file: rel, line: c.line, actual: c.n })
  }
  const row = componentRow(rel, 'packages/dsh-tree-engine')
  for (const name of tools.names) {
    if (!row.text.includes('`' + name + '`')) {
      fail(`README component table does not list tool \`${name}\``, { file: rel, line: row.line })
    }
  }
  return `${claims.length} claim(s) = ${tools.count}; component row lists all ${tools.count} names`
})

check('readme/test-count', () => {
  const d = declaredTests()
  return `${d.count}/${d.count} (${d.parts.join('+')}=${d.count}) at ${d.file}:${d.line}`
})

check('readme/skill-versions', () => {
  const v = versions()
  const rel = DOCS.readme
  const text = read(rel)
  const head = anchor(text, /SKILL 工程化，v([\d.]+) \/ v([\d.]+)/, rel, '`### 随包 Skill（SKILL 工程化，vX / vY）` heading')
  assertEqual(head.m[1], v.engine, 'README SKILL section tree-engine version', { file: rel, line: head.line, actual: head.m[1] })
  assertEqual(head.m[2], v.session, 'README SKILL section session-tree version', { file: rel, line: head.line, actual: head.m[2] })

  for (const [pkg, expected] of [['packages/dsh-tree-engine', v.engine], ['packages/dsh-session-tree', v.session]]) {
    const hits = allMatches(text, new RegExp('`' + pkg + '`\\s+v(\\d+\\.\\d+\\.\\d+)', 'g'))
    if (hits.length === 0) fail(`no \`${pkg}\` vX.Y.Z row found`, { file: rel })
    for (const h of hits) {
      assertEqual(h.match[1], expected, `README bundled-Skill table version for ${pkg}`, {
        file: rel,
        line: h.line,
        actual: h.match[1],
      })
    }
  }
  return `tree-engine ${v.engine} / session-tree ${v.session}`
})

// --- agent.md ---------------------------------------------------------------

check('agent/status-snapshot', () => {
  const v = versions()
  const tools = loadTools()
  const rel = DOCS.agent
  const text = read(rel)

  const header = anchor(text, /tree-engine \*\*v([\d.]+)\*\*/, rel, 'top `tree-engine **vX.Y.Z**` status note')
  assertEqual(header.m[1], v.engine, 'agent.md header tree-engine version', { file: rel, line: header.line, actual: header.m[1] })
  const headerCounts = anchor(text, /口径刷新到 (\d+) 工具 \/ (\d+)-(\d+)/, rel, 'top `N 工具 / T-T` status note')
  assertEqual(Number(headerCounts.m[1]), tools.count, 'agent.md header tool count', {
    file: rel,
    line: headerCounts.line,
    actual: Number(headerCounts.m[1]),
  })
  const declared = declaredTests()
  assertEqual(Number(headerCounts.m[2]), declared.count, 'agent.md header test count (first)', {
    file: rel,
    line: headerCounts.line,
    actual: Number(headerCounts.m[2]),
  })
  assertEqual(Number(headerCounts.m[3]), declared.count, 'agent.md header test count (second)', {
    file: rel,
    line: headerCounts.line,
    actual: Number(headerCounts.m[3]),
  })

  const comp = anchor(text, /\*\*组件\*\*：/, rel, '`**组件**` status-snapshot line')
  const compLine = comp.text
  const engine = compLine.match(/`dsh-tree-engine` \*\*v([\d.]+)\*\*/)
  const toolPair = compLine.match(/（\*\*(\d+) 工具\*\* = (\d+) 既有/)
  const intro = compLine.match(/`dsh-agent-introspect` v([\d.]+)/)
  const session = compLine.match(/`dsh-session-tree` \*\*v([\d.]+)\*\*/)
  if (!engine || !toolPair || !intro || !session) fail('component status line does not match the expected shape', { file: rel, line: comp.line })
  assertEqual(engine[1], v.engine, 'agent.md component tree-engine version', { file: rel, line: comp.line, actual: engine[1] })
  assertEqual(Number(toolPair[1]), tools.count, 'agent.md component tool count', {
    file: rel,
    line: comp.line,
    actual: Number(toolPair[1]),
  })
  assertEqual(Number(toolPair[2]), tools.count - 1, 'agent.md "既有" tool count must be TOOLS.length - 1', {
    file: rel,
    line: comp.line,
    actual: Number(toolPair[2]),
  })
  assertEqual(intro[1], v.introspect, 'agent.md component agent-introspect version', { file: rel, line: comp.line, actual: intro[1] })
  assertEqual(session[1], v.session, 'agent.md component session-tree version', { file: rel, line: comp.line, actual: session[1] })

  const testLine = anchor(text, /\*\*测试\*\*：/, rel, '`**测试**` status-snapshot line')
  const engineTests = testLine.text.match(/tree-engine \*\*(\d+)\/(\d+)\*\*/)
  if (!engineTests) fail('test status line has no `tree-engine **N/N**`', { file: rel, line: testLine.line })
  assertEqual(Number(engineTests[1]), declared.count, 'agent.md test status tree-engine count', {
    file: rel,
    line: testLine.line,
    actual: Number(engineTests[1]),
  })
  assertEqual(Number(engineTests[2]), declared.count, 'agent.md test status tree-engine denominator', {
    file: rel,
    line: testLine.line,
    actual: Number(engineTests[2]),
  })
  return `v${v.engine}, ${tools.count} tools, ${declared.count}/${declared.count}`
})

check('agent/test-breakdown', () => {
  const rel = DOCS.agent
  const text = read(rel)
  const hit = anchor(text, /node --test tests\/\*\.test\.js\s+# packages\/dsh-tree-engine → (\d+)\/(\d+)（([^）]+)）/, rel, 'agent.md test command line')
  const declared = declaredTests()
  assertEqual(Number(hit.m[1]), declared.count, 'agent.md breakdown tests count', {
    file: rel,
    line: hit.line,
    actual: Number(hit.m[1]),
  })
  const parts = breakdownNumbers(hit.m[3])
  const sum = parts.reduce((a, b) => a + b, 0)
  assertEqual(sum, Number(hit.m[1]), 'agent.md breakdown components must sum to its tests count', {
    file: rel,
    line: hit.line,
    actual: sum,
  })
  return `${parts.join('+')}=${sum}`
})

// --- docs/README.md ---------------------------------------------------------

check('docs-readme/current-snapshot', () => {
  const v = versions()
  const tools = loadTools()
  const declared = declaredTests()
  const rel = DOCS.docsReadme
  const text = read(rel)
  const hit = anchor(
    text,
    /tree-engine \*\*v([\d.]+)\*\*（(\d+) 工具 \/ (\d+)-(\d+) 测试）· session-tree \*\*v([\d.]+)\*\*/,
    rel,
    '`当前快照：… tree-engine vX（N 工具 / T-T 测试）· session-tree vY`',
  )
  const [, engineV, toolN, t1, t2, sessionV] = hit.m
  assertEqual(engineV, v.engine, 'docs/README snapshot tree-engine version', { file: rel, line: hit.line, actual: engineV })
  assertEqual(Number(toolN), tools.count, 'docs/README snapshot tool count', { file: rel, line: hit.line, actual: Number(toolN) })
  assertEqual(Number(t1), declared.count, 'docs/README snapshot test count (first)', { file: rel, line: hit.line, actual: Number(t1) })
  assertEqual(Number(t2), declared.count, 'docs/README snapshot test count (second)', { file: rel, line: hit.line, actual: Number(t2) })
  assertEqual(sessionV, v.session, 'docs/README snapshot session-tree version', { file: rel, line: hit.line, actual: sessionV })
  return `v${v.engine} / ${tools.count} tools / ${declared.count}-${declared.count} / v${v.session}`
})

// --- docs/guides/skills-usage.md -------------------------------------------

check('skills-usage/versions', () => {
  const v = versions()
  const rel = DOCS.skillsUsage
  const text = read(rel)
  const header = anchor(
    text,
    /适用版本：`packages\/dsh-tree-engine` \*\*v([\d.]+)\*\*、`packages\/dsh-session-tree` \*\*v([\d.]+)\*\*/,
    rel,
    '顶部「适用版本」line',
  )
  assertEqual(header.m[1], v.engine, 'skills-usage header tree-engine version', { file: rel, line: header.line, actual: header.m[1] })
  assertEqual(header.m[2], v.session, 'skills-usage header session-tree version', { file: rel, line: header.line, actual: header.m[2] })

  const section = anchor(text, /`dsh-tree-engine` ([\d.]+) \/ `dsh-session-tree` ([\d.]+)/, rel, '§9 「三个 Skill 随包版本走」line')
  assertEqual(section.m[1], v.engine, 'skills-usage §9 tree-engine version', { file: rel, line: section.line, actual: section.m[1] })
  assertEqual(section.m[2], v.session, 'skills-usage §9 session-tree version', { file: rel, line: section.line, actual: section.m[2] })
  return `tree-engine ${v.engine} / session-tree ${v.session}`
})

check('skills-usage/tool-count', () => {
  const tools = loadTools()
  const rel = DOCS.skillsUsage
  const text = read(rel)
  const toolDoctor = anchor(text, /（tree-engine ≥ ([\d.]+)）。它是第 (\d+) 个 `tree_\*` 工具/, rel, '`tree_doctor ≥ vX / 第 N 个` line')
  assertEqual(toolDoctor.m[1], versions().engine, 'skills-usage tree_doctor minimum version', {
    file: rel,
    line: toolDoctor.line,
    actual: toolDoctor.m[1],
  })
  assertEqual(Number(toolDoctor.m[2]), tools.count, 'skills-usage `第 N 个 tree_* 工具`', {
    file: rel,
    line: toolDoctor.line,
    actual: Number(toolDoctor.m[2]),
  })
  const upgrade = anchor(text, /新增第 (\d+) 个工具/, rel, '§9 `新增第 N 个工具` line')
  assertEqual(Number(upgrade.m[1]), tools.count, 'skills-usage §9 tool ordinal', {
    file: rel,
    line: upgrade.line,
    actual: Number(upgrade.m[1]),
  })
  return `${tools.count} tools`
})

check('skills-usage/test-count', () => {
  const v = versions()
  const declared = declaredTests()
  const rel = DOCS.skillsUsage
  const text = read(rel)
  const hit = anchor(text, /tree-engine ([\d.]+)\*\*：新增第 \d+ 个工具[\s\S]*?测试数 \d+→\*\*(\d+)\/(\d+)\*\*/, rel, '§9 tree-engine 版本增量 line')
  assertEqual(hit.m[1], v.engine, 'skills-usage §9 increment version', { file: rel, line: hit.line, actual: hit.m[1] })
  assertEqual(Number(hit.m[2]), declared.count, 'skills-usage §9 test count', { file: rel, line: hit.line, actual: Number(hit.m[2]) })
  assertEqual(Number(hit.m[3]), declared.count, 'skills-usage §9 test count denominator', {
    file: rel,
    line: hit.line,
    actual: Number(hit.m[3]),
  })
  return `${declared.count}/${declared.count}`
})

// --- package READMEs --------------------------------------------------------

check('tree-engine-readme/latest-version-section', () => {
  const v = versions()
  const tools = loadTools()
  const rel = DOCS.engineReadme
  const text = read(rel)
  const heading = anchor(text, /^## v(\d+\.\d+\.\d+)/, rel, 'latest `## vX.Y.Z` section heading')
  assertEqual(heading.m[1], v.engine, 'tree-engine README latest version section', {
    file: rel,
    line: heading.line,
    actual: heading.m[1],
  })
  const top = anchor(text, /`index\.js` 的 (\d+) 个工具 schema/, rel, 'top `index.js 的 N 个工具 schema`')
  assertEqual(Number(top.m[1]), tools.count, 'tree-engine README top tool count', {
    file: rel,
    line: top.line,
    actual: Number(top.m[1]),
  })
  const registered = anchor(text, /注册工具应为 \*\*(\d+)\*\*/, rel, '`注册工具应为 **N**` line')
  assertEqual(Number(registered.m[1]), tools.count, 'tree-engine README registered tool count', {
    file: rel,
    line: registered.line,
    actual: Number(registered.m[1]),
  })
  return `v${v.engine}, ${tools.count} tools`
})

check('session-tree-readme/current-release', () => {
  const v = versions()
  const rel = DOCS.sessionReadme
  const text = read(rel)
  const hit = anchor(text, /Current release: v(\d+\.\d+\.\d+)\./, rel, '`**Current release: vX.Y.Z.**` line')
  assertEqual(hit.m[1], v.session, 'session-tree README current release', { file: rel, line: hit.line, actual: hit.m[1] })
  return `v${v.session}`
})

check('docs/session-tree-test-counts', () => {
  const readmeText = read(DOCS.readme)
  const row = componentRow(DOCS.readme, 'packages/dsh-session-tree')
  const handoffReadme = row.text.match(/handoff \*\*(\d+)\/(\d+)\*\*/)
  const styleReadme = row.text.match(/style-guard (\d+)\/(\d+)/)
  if (!handoffReadme || !styleReadme) fail('README session-tree row lacks handoff/style-guard counts', { file: DOCS.readme, line: row.line })

  const agentText = read(DOCS.agent)
  const handoffAgentLine = anchor(agentText, /node test\/handoff\.test\.js/, DOCS.agent, 'agent.md handoff test command')
  const handoffAgent = handoffAgentLine.text.match(/→ (\d+)\/(\d+)/)
  const styleAgentLine = anchor(agentText, /node test\/style-guard\.cjs/, DOCS.agent, 'agent.md style-guard test command')
  const styleAgent = styleAgentLine.text.match(/→ (\d+)\/(\d+)/)
  if (!handoffAgent || !styleAgent) fail('agent.md test command lines lack `→ N/N` counts', { file: DOCS.agent })

  for (const [label, a, b, fileA, fileB] of [
    ['handoff', handoffReadme, handoffAgent, DOCS.readme, DOCS.agent],
    ['style-guard', styleReadme, styleAgent, DOCS.readme, DOCS.agent],
  ]) {
    assertEqual(a[1], a[2], `README ${label} count must have equal numerator/denominator`, {
      file: fileA,
      line: row.line,
      actual: `${a[1]}/${a[2]}`,
    })
    assertEqual(a[1], b[1], `README vs agent.md ${label} count mismatch`, {
      file: fileB,
      line: label === 'handoff' ? handoffAgentLine.line : styleAgentLine.line,
      actual: b[1],
    })
  }
  // readmeText is read for a stable early failure if README is missing; keep the reference explicit.
  if (!readmeText.includes('dsh-session-tree')) fail('README does not mention dsh-session-tree', { file: DOCS.readme })
  return `handoff ${handoffReadme[1]}/${handoffReadme[2]}, style-guard ${styleReadme[1]}/${styleReadme[2]} (README == agent.md)`
})

// --- CHANGELOG --------------------------------------------------------------

check('changelog/current-entries', () => {
  const rel = DOCS.changelog
  const text = read(rel)
  const unreleased = allMatches(text, /^## \[Unreleased\]/gm)
  const released = allMatches(text, /^## \[(\d+\.\d+\.\d+)\]/gm)
  if (unreleased.length === 0) fail('no `## [Unreleased]` section', { file: rel })
  if (released.length === 0) fail('no released `## [x.y.z]` section', { file: rel })
  const v = versions()
  const current = released.find((r) => r.match[1] === v.session)
  if (!current) fail(`no CHANGELOG entry for the current session-tree v${v.session}`, { file: rel })
  return `${released.length} released headings; Unreleased present; latest current=v${v.session}`
})

// --- project map (current-snapshot anchors only) ----------------------------

check('map/hero-snapshot', () => {
  const v = versions()
  const tools = loadTools()
  const declared = declaredTests()
  const rel = DOCS.map
  const text = read(rel)
  const hit = anchor(
    text,
    /tree-engine <b>v([\d.]+)<\/b> · (\d+) 工具 · <b>(\d+)\/(\d+)<\/b>/,
    rel,
    'hero `tree-engine vX · N 工具 · T/T` span',
  )
  assertEqual(hit.m[1], v.engine, 'project map hero tree-engine version', { file: rel, line: hit.line, actual: hit.m[1] })
  assertEqual(Number(hit.m[2]), tools.count, 'project map hero tool count', { file: rel, line: hit.line, actual: Number(hit.m[2]) })
  assertEqual(Number(hit.m[3]), declared.count, 'project map hero test count', { file: rel, line: hit.line, actual: Number(hit.m[3]) })
  assertEqual(Number(hit.m[4]), declared.count, 'project map hero test count denominator', {
    file: rel,
    line: hit.line,
    actual: Number(hit.m[4]),
  })
  return `v${v.engine} / ${tools.count} tools / ${declared.count}/${declared.count}`
})

check('map/component-versions', () => {
  const v = versions()
  const rel = DOCS.map
  const text = read(rel)
  for (const [key, def] of Object.entries(PACKAGES)) {
    const dir = def.rel.split('/').slice(0, 2).join('/')
    const hits = allMatches(text, new RegExp('<code>' + path.basename(dir) + '</code></td><td class="num">(\\d+\\.\\d+\\.\\d+)</td>', 'g'))
    if (hits.length === 0) fail(`project-map component row for ${path.basename(dir)} not found`, { file: rel })
    // The current component table is the first occurrence; later occurrences
    // belong to the version-evolution snapshot section (see whitelist in header)
    // and are reported as [warn] by obs/project-map-drift instead.
    assertEqual(hits[0].match[1], v[key], `project-map component version for ${path.basename(dir)}`, {
      file: rel,
      line: hits[0].line,
      actual: hits[0].match[1],
    })
  }
  return `tree-engine ${v.engine}, session-tree ${v.session}, agent-introspect ${v.introspect}`
})

check('map/metric-test-count', () => {
  const declared = declaredTests()
  const rel = DOCS.map
  const text = read(rel)
  const hit = anchor(text, /<div class="v">(\d+)\/(\d+)<\/div><div class="l">tree-engine<\/div>/, rel, 'tree-engine test metric')
  assertEqual(Number(hit.m[1]), declared.count, 'project map tree-engine metric test count', {
    file: rel,
    line: hit.line,
    actual: Number(hit.m[1]),
  })
  assertEqual(Number(hit.m[2]), declared.count, 'project map tree-engine metric denominator', {
    file: rel,
    line: hit.line,
    actual: Number(hit.m[2]),
  })
  return `${declared.count}/${declared.count}`
})

// --- optional runtime ground truth -----------------------------------------

if (runTests) {
  check('runtime/tree-engine-tests', () => {
    const declared = declaredTests()
    const pkgDir = path.join(root, 'packages/dsh-tree-engine')
    const testsDir = path.join(pkgDir, 'tests')
    let files
    try {
      files = readdirSync(testsDir)
        .filter((f) => f.endsWith('.test.js'))
        .sort()
        .map((f) => path.join(testsDir, f))
    } catch (e) {
      fail(`cannot list tests/: ${e.message}`, { file: 'packages/dsh-tree-engine/tests' })
    }
    if (files.length === 0) fail('no *.test.js files found', { file: 'packages/dsh-tree-engine/tests' })
    const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
      cwd: pkgDir,
      encoding: 'utf8',
      timeout: 180000,
      windowsHide: true,
    })
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    const testsM = out.match(/^# tests (\d+)$/m)
    const passM = out.match(/^# pass (\d+)$/m)
    const failM = out.match(/^# fail (\d+)$/m)
    if (!testsM || !passM || !failM) {
      fail(`could not parse TAP summary (exit ${res.status}); output tail: ${out.slice(-300).replace(/\s+/g, ' ')}`, {
        file: 'packages/dsh-tree-engine/tests',
      })
    }
    const actual = Number(testsM[1])
    const pass = Number(passM[1])
    const failed = Number(failM[1])
    assertEqual(pass, actual, 'executed pass count != tests count', { file: 'packages/dsh-tree-engine/tests', actual: pass })
    assertEqual(failed, 0, 'executed suite has failures', { file: 'packages/dsh-tree-engine/tests', actual: failed })
    assertEqual(actual, declared.count, 'executed test count != documented count (README.md)', {
      file: declared.file,
      line: declared.line,
      actual,
    })
    return `executed ${actual}/${actual}; documented ${declared.count}`
  })
}

// -------------------------- observations ----------------------------------
// Non-blocking, explicitly out-of-scope drift. These are printed as [warn] and
// never change the exit code; they disappear once the owning docs are updated.

const observations = []
function observe(id, fn) {
  try {
    const detail = fn()
    if (detail) observations.push({ id, detail })
  } catch (e) {
    observations.push({ id, detail: e && e.message ? e.message : String(e), file: e.file, line: e.line })
  }
}

observe('obs/skill-body-drift', () => {
  const v = versions()
  const tools = loadTools()
  const out = []
  for (const skill of SKILLS) {
    const text = read(skill.rel)
    const body = text.replace(/^---[\s\S]*?\r?\n---\r?\n/, '')
    const tm = body.match(/(\d+)\s*个\s*(?:`tree_\*`\s*)?工具/)
    if (tm && Number(tm[1]) !== tools.count) {
      out.push(`${skill.rel}:${lineOfIndex(text, text.indexOf(tm[0]))} says ${tm[1]} 工具 (TOOLS.length=${tools.count})`)
    }
    const vm = body.match(/随 tree-engine v([\d.]+) 分发/)
    if (vm && vm[1] !== v.engine) {
      out.push(`${skill.rel}:${lineOfIndex(text, text.indexOf(vm[0]))} says 随 tree-engine v${vm[1]} 分发 (package.json=${v.engine})`)
    }
  }
  return out.length ? out.join('; ') : ''
})

observe('obs/readme-test-file-count', () => {
  const rel = DOCS.readme
  const text = read(rel)
  const claim = text.match(/tests\/（(\d+) 个 \.test\.js/)
  if (!claim) return ''
  let actual = 0
  try {
    actual = readdirSync(path.join(root, 'packages/dsh-tree-engine/tests')).filter((f) => f.endsWith('.test.js')).length
  } catch {
    return ''
  }
  if (Number(claim[1]) !== actual) {
    return `${rel}:${lineOfIndex(text, claim.index)} says ${claim[1]} 个 .test.js, actual ${actual}`
  }
  return ''
})

observe('obs/project-map-drift', () => {
  const v = versions()
  const tools = loadTools()
  const rel = DOCS.map
  const text = read(rel)
  const out = []
  for (const m of allMatches(text, /tree-engine v(\d+\.\d+\.\d+)/g)) {
    if (m.match[1] !== v.engine) out.push(`${rel}:${m.line} says tree-engine v${m.match[1]} (package.json=${v.engine})`)
  }
  for (const m of allMatches(text, /(\d+) 个 <code>tree_\*<\/code>/g)) {
    if (Number(m.match[1]) !== tools.count) out.push(`${rel}:${m.line} says ${m.match[1]} 个 <code>tree_*</code> (TOOLS.length=${tools.count})`)
  }
  for (const m of allMatches(text, /tag <code>v(\d+\.\d+\.\d+)<\/code>/g)) {
    if (m.match[1] !== v.session) out.push(`${rel}:${m.line} shows tag v${m.match[1]} (session-tree package.json=${v.session})`)
  }
  // Later (historical) component tables, e.g. the version-evolution snapshot.
  for (const [key, def] of Object.entries(PACKAGES)) {
    const pkgName = path.basename(def.rel.split('/').slice(0, 2).join('/'))
    for (const m of allMatches(text, new RegExp('<code>' + pkgName + '</code></td><td class="num">(\\d+\\.\\d+\\.\\d+)</td>', 'g'))) {
      if (m.match[1] !== v[key]) out.push(`${rel}:${m.line} shows ${pkgName} ${m.match[1]} (package.json=${v[key]})`)
    }
  }
  return out.join('; ')
})

// ----------------------------- report --------------------------------------

const skipped = []
if (!existsSync(path.join(root, DOCS.introspectReadme))) {
  skipped.push(`${DOCS.introspectReadme}: not shipped by this package — no version section to check`)
}

const failures = checks.filter((c) => !c.ok)
const ok = failures.length === 0

function formatFailure(c) {
  const loc = c.file ? `${c.file}${c.line ? ':' + c.line : ':?'}` : '(checker)'
  const expected = c.expected === undefined ? '' : ` expected=${JSON.stringify(c.expected)}`
  const actual = c.actual === undefined ? '' : ` actual=${JSON.stringify(c.actual)}`
  const detail = c.detail ? ` — ${c.detail}` : ''
  return `[fail] ${c.id}: ${loc}${expected}${actual}${detail}`
}

if (json) {
  const payload = {
    ok,
    root,
    checks,
    observations,
    skipped,
    summary: {
      checks: checks.length,
      failed: failures.length,
      observations: observations.length,
      runTests,
    },
  }
  console.log(JSON.stringify(payload, null, 2))
} else {
  for (const c of checks) {
    if (c.ok) console.log(`[ok] ${c.id}${c.detail ? ': ' + c.detail : ''}`)
    else console.log(formatFailure(c))
  }
  for (const o of observations) console.log(`[warn] ${o.id}${o.detail ? ': ' + o.detail : ''}`)
  for (const s of skipped) console.log(`[skip] ${s}`)
  if (ok) {
    console.log(`VERSION CHECK OK (${checks.length} checks)`)
  } else {
    console.log(`VERSION CHECK FAILED (${checks.length} checks, ${failures.length} failed)`)
  }
}

process.exit(ok ? 0 : 1)
