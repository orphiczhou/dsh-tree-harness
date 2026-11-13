/**
 * release-gate.test.mjs — 发布门禁纯逻辑单测（node --test scripts/e2e/lib/release-gate.test.mjs）
 *
 * 全部用临时目录 + now 注入，不依赖本机时钟、不写仓库。
 * 另用仓库内真实 artifact（release-20261112T171827Z.json）锁 schema 兼容性。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkReleaseGate, parseArtifactFilenameTime, selectLatestArtifact, DEFAULT_MAX_AGE_HOURS } from './release-gate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ARTIFACT = join(HERE, '..', 'artifacts', 'release-20261112T171827Z.json')

const STAMP = '20261112T171827Z'
const INTERNAL_TS = '2026-11-12T17:18:28.027Z'

function goodArtifact(mutate = null) {
  const doc = {
    tool: 'release-e2e',
    version: '1.0.0',
    mode: 'live',
    real_machine: true,
    timestamp: INTERNAL_TS,
    steps: [
      {
        id: 'verify-handoff',
        required: true,
        status: 'PASS',
        pass: true,
        exitCode: 0,
        evidence: { verdict: 'PASS', total: 12, passed: 12, failedCount: 0, failed: [] },
      },
      {
        id: 'verify-kickoff-language',
        required: true,
        status: 'PASS',
        pass: true,
        exitCode: 0,
        evidence: { language: 'zh', expect: 'zh', mentions_handoff_file: true },
      },
      {
        id: 'collect-skills',
        required: true,
        status: 'PASS',
        pass: true,
        exitCode: 0,
        evidence: { verdict: 'PASS', sessionCount: 1, found: 1, missingSessions: 0 },
      },
      { id: 'summarize-run', required: false, status: 'PASS', pass: true, exitCode: 0, evidence: {} },
    ],
    overall: { verdict: 'PASS', required: 3, passed: 3, failed: 0, skipped: 0, exitCode: 0 },
  }
  if (mutate) mutate(doc)
  return doc
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'd23x-gate-'))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeArtifact(dir, name, doc, raw = null) {
  const path = join(dir, name)
  writeFileSync(path, raw ?? JSON.stringify(doc, null, 2), 'utf8')
  return path
}

const NOW = new Date('2026-11-13T00:00:00.000Z') // artifact 后 ~6.7h，默认 168h 内

test('新鲜 + 三断言全 PASS → ok=true', () => {
  const dir = tempDir()
  const path = writeArtifact(dir, `release-${STAMP}.json`, goodArtifact())
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.artifactPath, path)
  assert.equal(result.hint, null)
  assert.ok(result.ageHours > 6 && result.ageHours < 7, `ageHours=${result.ageHours}`)
  for (const name of ['artifact-found', 'schema', 'overall-pass', 'required-steps-pass', 'assert-handoff', 'assert-kickoff-language', 'assert-collect-skills', 'freshness']) {
    const item = result.checks.find((check) => check.name === name)
    assert.ok(item, `缺少检查 ${name}`)
    assert.equal(item.ok, true, `${name} 应通过: ${item.detail}`)
  }
})

test('断言失败（kickoff 语种 FAIL）→ ok=false 且 checks 指出失败项', () => {
  const dir = tempDir()
  const path = writeArtifact(
    dir,
    `release-${STAMP}.json`,
    goodArtifact((doc) => {
      doc.steps[1].status = 'FAIL'
      doc.steps[1].pass = false
      doc.steps[1].exitCode = 1
      doc.steps[1].evidence.language = 'en'
      doc.steps[1].evidence.expect = 'zh'
      doc.overall = { verdict: 'FAIL', required: 3, passed: 2, failed: 1, skipped: 0, exitCode: 1 }
    }),
  )
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, false)
  const failedNames = result.checks.filter((check) => !check.ok).map((check) => check.name)
  assert.ok(failedNames.includes('assert-kickoff-language'), `应点名 assert-kickoff-language: ${failedNames}`)
  assert.ok(failedNames.includes('overall-pass') && failedNames.includes('required-steps-pass'), `总闸也应失败: ${failedNames}`)
  assert.match(result.hint, /run-release-e2e\.mjs/)
  assert.match(result.hint, /assert-kickoff-language/)
})

test('artifact 过期（now 注入 +200h）→ ok=false，freshness 失败', () => {
  const dir = tempDir()
  writeArtifact(dir, `release-${STAMP}.json`, goodArtifact())
  const result = checkReleaseGate({ artifactsDir: dir, now: new Date(new Date(INTERNAL_TS).getTime() + 200 * 3_600_000) })
  assert.equal(result.ok, false)
  const fresh = result.checks.find((check) => check.name === 'freshness')
  assert.equal(fresh.ok, false)
  assert.match(fresh.detail, /过期/)
  assert.ok(result.ageHours > 199 && result.ageHours < 201, `ageHours=${result.ageHours}`)
  assert.ok(result.checks.find((check) => check.name === 'assert-handoff').ok, '断言本身应仍通过')
})

test('目录无 artifact → ok=false + hint', () => {
  const dir = tempDir()
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.artifactPath, null)
  const found = result.checks.find((check) => check.name === 'artifact-found')
  assert.equal(found.ok, false)
  assert.match(result.hint, /run-release-e2e\.mjs/)
})

test('指定 artifactPath 不存在 → ok=false + hint', () => {
  const dir = tempDir()
  const missing = join(dir, 'release-20990101T000000Z.json')
  const result = checkReleaseGate({ artifactsDir: dir, artifactPath: missing, now: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.artifactPath, missing)
  assert.match(result.checks.find((check) => check.name === 'artifact-found').detail, /不存在/)
  assert.match(result.hint, /run-release-e2e\.mjs/)
})

test('JSON 损坏 → ok=false + hint，不抛异常', () => {
  const dir = tempDir()
  const path = writeArtifact(dir, `release-${STAMP}.json`, null, '{"tool": "release-e2e", "steps": [ 被截断了')
  const result = checkReleaseGate({ artifactsDir: dir, artifactPath: path, now: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((check) => check.name === 'schema').ok, false)
  assert.match(result.hint, /schema/)
})

test('maxAgeHours 自定义生效：同一 100h 旧 artifact，168h 过 / 50h 不过', () => {
  const dir = tempDir()
  writeArtifact(dir, `release-${STAMP}.json`, goodArtifact())
  const now100 = new Date(new Date(INTERNAL_TS).getTime() + 100 * 3_600_000)
  assert.equal(checkReleaseGate({ artifactsDir: dir, now: now100 }).ok, true)
  const strict = checkReleaseGate({ artifactsDir: dir, now: now100, maxAgeHours: 50 })
  assert.equal(strict.ok, false)
  assert.match(strict.checks.find((check) => check.name === 'freshness').detail, /maxAgeHours 50/)
  assert.equal(DEFAULT_MAX_AGE_HOURS, 168)
})

test('选最新：两个 release-*.json 取文件名 UTC 戳最大者', () => {
  const dir = tempDir()
  writeArtifact(dir, 'release-20261110T010000Z.json', goodArtifact((doc) => { doc.timestamp = '2026-11-10T01:00:01.000Z' }))
  const newer = writeArtifact(dir, `release-${STAMP}.json`, goodArtifact())
  assert.equal(selectLatestArtifact(dir), newer)
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(result.artifactPath, newer)
})

test('文件名时间解析 + 未来时间戳按不新鲜处理', () => {
  const parsed = parseArtifactFilenameTime(`release-${STAMP}.json`)
  assert.ok(parsed instanceof Date)
  assert.equal(parsed.toISOString(), '2026-11-12T17:18:27.000Z')
  assert.equal(parseArtifactFilenameTime('notes.json'), null)
  const dir = tempDir()
  writeArtifact(dir, 'release-20990101T000000Z.json', goodArtifact((doc) => { doc.timestamp = '2099-01-01T00:00:00.000Z' }))
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, false)
  assert.match(result.checks.find((check) => check.name === 'freshness').detail, /未来/)
})

test('真实仓库 artifact（release-20261112T171827Z.json）schema 兼容 → ok=true', () => {
  const result = checkReleaseGate({
    artifactPath: REPO_ARTIFACT,
    now: new Date('2026-11-13T00:00:00.000Z'),
    maxAgeHours: 24,
  })
  assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2))
  assert.equal(result.ageHours, 6.7)
})

// ── R2 复核修复回归（2026-11-13）────────────────────────────────────────────

test('R2-P1：artifact 顶层为 JSON null → ok=false 且不抛异常（永不抛异常契约）', () => {
  const dir = tempDir()
  const path = writeArtifact(dir, `release-${STAMP}.json`, null, 'null')
  let result
  assert.doesNotThrow(() => {
    result = checkReleaseGate({ artifactsDir: dir, artifactPath: path, now: NOW })
  }, '顶层 null 不得抛 TypeError（契约：本模块永不抛异常）')
  assert.equal(result.ok, false)
  const schema = result.checks.find((check) => check.name === 'schema')
  assert.equal(schema.ok, false)
  assert.match(schema.detail, /顶层必须是 JSON 对象.*null/)
  assert.match(result.hint, /run-release-e2e\.mjs/)
})

test('R2-P1b：artifact 顶层为数组/标量 → ok=false 不抛异常', () => {
  const dir = tempDir()
  for (const [name, raw] of [['release-20261113T000001Z.json', '[]'], ['release-20261113T000002Z.json', '"PASS"']]) {
    const path = writeArtifact(dir, name, null, raw)
    const result = checkReleaseGate({ artifactsDir: dir, artifactPath: path, now: NOW })
    assert.equal(result.ok, false, `${raw} 应 fail-closed`)
    assert.match(result.checks.find((check) => check.name === 'schema').detail, /顶层必须是 JSON 对象/)
  }
})

test('R2-P2：无 UTC 戳文件名的 artifact（即使 mtime 更新）不遮蔽带戳 artifact', () => {
  const dir = tempDir()
  const dated = writeArtifact(
    dir,
    'release-20261110T010000Z.json',
    goodArtifact((doc) => { doc.timestamp = '2026-11-10T01:00:01.000Z' }),
  )
  // 手改名文件：mtime 更新（刚写入），但无 UTC 戳 → 按模块契约「视为更旧」
  writeArtifact(dir, 'release-manual-edit.json', goodArtifact())
  assert.equal(selectLatestArtifact(dir), dated, '无 UTC 戳文件不得遮蔽带戳 artifact')
})

test('R2-P2b：collect-skills evidence 缺 missingSessions → FAIL（收紧，缺失不再视为通过）', () => {
  const dir = tempDir()
  writeArtifact(
    dir,
    `release-${STAMP}.json`,
    goodArtifact((doc) => {
      delete doc.steps[2].evidence.missingSessions
    }),
  )
  const result = checkReleaseGate({ artifactsDir: dir, now: NOW })
  assert.equal(result.ok, false)
  const skills = result.checks.find((check) => check.name === 'assert-collect-skills')
  assert.equal(skills.ok, false)
  assert.match(skills.detail, /missingSessions=\(missing\)/)
})
