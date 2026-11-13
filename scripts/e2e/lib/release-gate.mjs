/**
 * release-gate.mjs — 发布前「真机三断言 E2E + artifact 新鲜度」门禁纯逻辑（W2.8 / d23x-A3）
 *
 * 输入是 scripts/e2e/run-release-e2e.mjs 生成的汇总 artifact（release-<UTC>.json，schema v1.0.0）：
 *   { tool, version, mode, real_machine, timestamp, steps:[{id,required,status,pass,evidence}], overall:{verdict,...} }
 * 本模块只做校验、不抛异常、无任何写副作用（便于 node:test 单测与 release-all.mjs 预检复用）。
 *
 * 校验面（对应任务书 a/b/c）：
 *   a. schema     —— JSON 可解析，且含 steps[] 与 overall 汇总字段；
 *   b. 三断言     —— verify-handoff（断言计数通过）、verify-kickoff-language（语种 PASS）、
 *                    collect-skills（会话/skill 计数 PASS）三个 required 步骤全部通过；
 *                    另加 overall.verdict 与「全部 required 步骤 PASS」两道总闸；
 *   c. freshness —— artifact 时间（内部 timestamp 优先，回退文件名 UTC 戳）距今 ≤ maxAgeHours（缺省 168=7 天）。
 *
 * 返回：{ ok, artifactPath, ageHours, checks:[{name, ok, detail}], hint }
 *   ok=false 时 hint 给出可操作提示（先跑 runner 生成新 artifact；紧急豁免走 release-all 的 --skip-e2e-gate）。
 * 调用方（release-all.mjs）根据 ok 决定 exit code，本模块不 process.exit。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_MAX_AGE_HOURS = 168

/** release-<YYYYMMDD>T<HHMMSS>Z.json —— runner 汇总 artifact 的文件名时间戳。 */
const RELEASE_FILE_RE = /^release-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/i

/** 从文件名解析 UTC 时间；不匹配返回 null。 */
export function parseArtifactFilenameTime(name) {
  const match = RELEASE_FILE_RE.exec(String(name ?? ''))
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 选最新 release-*.json：优先按文件名 UTC 戳降序；文件名无时间戳的按 mtime 兜底（视为更旧，
 * 除非同层无法比较）。目录不存在 / 无候选 → null。纯读，不抛异常。
 */
export function selectLatestArtifact(artifactsDir) {
  let names
  try {
    names = readdirSync(artifactsDir).filter((name) => /^release-.*\.json$/i.test(name))
  } catch {
    return null
  }
  if (!names.length) return null
  const ranked = names
    .map((name) => {
      const fileTime = parseArtifactFilenameTime(name)
      let mtime = 0
      if (!fileTime) {
        try {
          mtime = statSync(join(artifactsDir, name)).mtimeMs
        } catch {
          mtime = 0
        }
      }
      // R2 复核 P2（2026-11-13）：注释承诺「无 UTC 戳者视为更旧」，旧实现却按裸 mtime 排名，
      // 可能让手改名文件遮蔽真正最新的带戳 artifact。现按「带戳 > 无戳；同类内带戳比时间、无戳比 mtime」排序。
      return { name, dated: Boolean(fileTime), rank: fileTime ? fileTime.getTime() : 0, mtime }
    })
    .sort((a, b) => (b.dated - a.dated) || (b.rank - a.rank) || (b.mtime - a.mtime) || a.name.localeCompare(b.name))
  return join(artifactsDir, ranked[0].name)
}

function buildHint(checks) {
  const failed = checks.filter((check) => !check.ok).map((check) => check.name)
  if (!failed.length) return null
  return (
    '先跑一次真机三断言 runner 生成新鲜 artifact：' +
    'node scripts/e2e/run-release-e2e.mjs --source <会话id> --successor <会话id> --wait 120000' +
    '（汇总写入 scripts/e2e/artifacts/release-<UTC>.json）。' +
    `未通过项: ${failed.join(', ')}。` +
    '紧急豁免仅限显式 --skip-e2e-gate --skip-e2e-reason "<理由>"（发布日志会留下醒目记录）。'
  )
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail }
}

/** 按 id 找步骤；找不到返回 null。 */
function findStep(steps, id) {
  return steps.find((step) => step && step.id === id) ?? null
}

/** 单条 required 断言步骤的通用判定（存在 + status/pass/exitCode）。 */
function stepPassDetail(step) {
  if (!step) return { ok: false, detail: '步骤缺失' }
  const statusOk = step.status === 'PASS' || (step.pass === true && step.exitCode === 0)
  return {
    ok: statusOk && step.required !== false,
    detail: `status=${step.status ?? '(missing)'} pass=${String(step.pass)} exitCode=${String(step.exitCode ?? '(missing)')}`,
  }
}

/**
 * 门禁主入口。参数：
 *   { artifactsDir, artifactPath = null, now = new Date(), maxAgeHours = 168 }
 * 永不抛异常；任何异常路径都转成 checks + hint。
 */
export function checkReleaseGate({ artifactsDir, artifactPath = null, now = new Date(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const checks = []
  const nowDate = now instanceof Date ? now : new Date(now)
  const ageNow = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate
  const ageHoursRounded = (ms) => Math.round((ms / 3_600_000) * 10) / 10

  // ---- 1. 选 artifact -------------------------------------------------------
  let resolvedPath = null
  if (artifactPath) {
    resolvedPath = String(artifactPath)
    let present = false
    try {
      present = existsSync(resolvedPath) && statSync(resolvedPath).isFile()
    } catch {
      present = false
    }
    checks.push(check('artifact-found', present, present ? `指定文件存在: ${resolvedPath}` : `指定 artifact 不存在: ${resolvedPath}`))
  } else {
    resolvedPath = selectLatestArtifact(String(artifactsDir ?? ''))
    checks.push(
      check(
        'artifact-found',
        Boolean(resolvedPath),
        resolvedPath ? `最新 artifact: ${resolvedPath}` : `目录中没有 release-*.json artifact（查找: ${artifactsDir ?? '(未指定)'}）`,
      ),
    )
  }

  if (!resolvedPath || !checks.some((item) => item.name === 'artifact-found' && item.ok)) {
    checks.push(check('schema', false, '无 artifact，跳过解析'))
    return { ok: false, artifactPath: resolvedPath, ageHours: null, checks, hint: buildHint(checks) }
  }

  // ---- 2. 读取 + schema -----------------------------------------------------
  let data = null
  let parseError = null
  try {
    data = JSON.parse(readFileSync(resolvedPath, 'utf8'))
  } catch (error) {
    parseError = error
  }
  if (parseError) {
    checks.push(check('schema', false, `JSON 解析失败: ${parseError.message}`))
    return { ok: false, artifactPath: resolvedPath, ageHours: null, checks, hint: buildHint(checks) }
  }
  // R2 复核 P1（2026-11-13）：JSON 顶层为 null/数组/标量时，下面 `data.steps` 会抛 TypeError，
  // 违反本模块「永不抛异常」契约（dry-run 也会被异常打断）。此处先做顶层形状校验，fail-closed 返回。
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    const got = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data
    checks.push(check('schema', false, `artifact 顶层必须是 JSON 对象（收到: ${got}）`))
    return { ok: false, artifactPath: resolvedPath, ageHours: null, checks, hint: buildHint(checks) }
  }
  const steps = Array.isArray(data.steps) ? data.steps : null
  const overall = data.overall && typeof data.overall === 'object' ? data.overall : null
  checks.push(
    check(
      'schema',
      Boolean(steps && overall),
      steps && overall
        ? `tool=${data.tool ?? '(missing)'} version=${data.version ?? '(missing)'} steps=${steps.length} overall.verdict=${overall.verdict ?? '(missing)'}`
        : `缺少汇总字段（steps ${Array.isArray(data.steps) ? 'ok' : '缺失'} / overall ${overall ? 'ok' : '缺失'}）`,
    ),
  )

  // ---- 3. 汇总 + 三断言 ------------------------------------------------------
  let ageHours = null
  if (steps && overall) {
    checks.push(check('overall-pass', overall.verdict === 'PASS' && overall.failed === 0, `overall=${JSON.stringify({ verdict: overall.verdict, required: overall.required, passed: overall.passed, failed: overall.failed })}`))

    const requiredSteps = steps.filter((step) => step && step.required === true)
    const requiredFailed = requiredSteps.filter((step) => !(step.status === 'PASS' || (step.pass === true && step.exitCode === 0)))
    checks.push(
      check(
        'required-steps-pass',
        requiredSteps.length > 0 && requiredFailed.length === 0,
        requiredSteps.length === 0
          ? 'artifact 中没有 required 步骤（异常结构）'
          : requiredFailed.length === 0
            ? `${requiredSteps.length}/${requiredSteps.length} required 步骤 PASS`
            : `未通过: ${requiredFailed.map((step) => `${step.id}(${step.status ?? 'no-status'})`).join(', ')}`,
      ),
    )

    // 断言 1：handoff 断言计数通过
    const handoff = findStep(steps, 'verify-handoff')
    const handoffBase = stepPassDetail(handoff)
    const handoffEvidence = handoff?.evidence ?? {}
    const handoffCountOk =
      handoffEvidence.verdict === 'PASS' &&
      handoffEvidence.failedCount === 0 &&
      typeof handoffEvidence.total === 'number' &&
      handoffEvidence.passed === handoffEvidence.total &&
      handoffEvidence.total > 0
    checks.push(
      check(
        'assert-handoff',
        handoffBase.ok && handoffCountOk,
        handoff ? `${handoffBase.detail}; evidence verdict=${handoffEvidence.verdict ?? '(missing)'} passed=${handoffEvidence.passed ?? '(missing)'}/${handoffEvidence.total ?? '(missing)'} failedCount=${handoffEvidence.failedCount ?? '(missing)'}` : handoffBase.detail,
      ),
    )

    // 断言 2：kickoff 语种 PASS
    const kickoff = findStep(steps, 'verify-kickoff-language')
    const kickoffBase = stepPassDetail(kickoff)
    const kickoffEvidence = kickoff?.evidence ?? {}
    const kickoffLangOk =
      kickoffEvidence.language !== undefined && kickoffEvidence.expect !== undefined && kickoffEvidence.language === kickoffEvidence.expect
    checks.push(
      check(
        'assert-kickoff-language',
        kickoffBase.ok && kickoffLangOk,
        kickoff ? `${kickoffBase.detail}; evidence language=${kickoffEvidence.language ?? '(missing)'} expect=${kickoffEvidence.expect ?? '(missing)'}` : kickoffBase.detail,
      ),
    )

    // 断言 3：skills 计数 PASS
    const skills = findStep(steps, 'collect-skills')
    const skillsBase = stepPassDetail(skills)
    const skillsEvidence = skills?.evidence ?? {}
    // R2 复核 P2（2026-11-13）：收紧为必须 missingSessions === 0（缺失不再视为通过，与 handoff 数值校验对齐）。
    const skillsCountOk = skillsEvidence.verdict === 'PASS' && skillsEvidence.missingSessions === 0
    checks.push(
      check(
        'assert-collect-skills',
        skillsBase.ok && skillsCountOk,
        skills ? `${skillsBase.detail}; evidence verdict=${skillsEvidence.verdict ?? '(missing)'} found=${skillsEvidence.found ?? '(missing)'}/${skillsEvidence.sessionCount ?? '(missing)'} missingSessions=${skillsEvidence.missingSessions ?? '(missing)'}` : skillsBase.detail,
      ),
    )

    // ---- 4. freshness -------------------------------------------------------
    const fileTime = parseArtifactFilenameTime(resolvedPath.split(/[\\/]/).pop())
    const internalTime = typeof data.timestamp === 'string' ? new Date(data.timestamp) : null
    const stamp = internalTime && !Number.isNaN(internalTime.getTime()) ? internalTime : fileTime
    const stampSource = internalTime && !Number.isNaN(internalTime.getTime()) ? '内部 timestamp' : fileTime ? '文件名 UTC 戳' : '无'
    if (!stamp) {
      checks.push(check('freshness', false, `无法确定 artifact 时间（timestamp=${String(data.timestamp)}，文件名无 UTC 时间戳）`))
    } else {
      ageHours = ageHoursRounded(ageNow.getTime() - stamp.getTime())
      const fresh = ageHours <= Number(maxAgeHours)
      checks.push(
        check(
          'freshness',
          fresh && ageHours >= 0,
          fresh && ageHours >= 0
            ? `age ${ageHours}h ≤ ${maxAgeHours}h（时间来源: ${stampSource} ${stamp.toISOString()}）`
            : ageHours < 0
              ? `artifact 时间在未来（${stamp.toISOString()}，距今 ${ageHours}h）——时钟/文件异常，按不新鲜处理`
              : `过期：age ${ageHours}h > maxAgeHours ${maxAgeHours}h（时间来源: ${stampSource} ${stamp.toISOString()}）`,
        ),
      )
    }
  } else {
    checks.push(check('freshness', false, 'schema 不完整，无法判定新鲜度'))
  }

  const ok = checks.every((item) => item.ok)
  return { ok, artifactPath: resolvedPath, ageHours, checks, hint: ok ? null : buildHint(checks) }
}
