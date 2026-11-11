/**
 * tree_doctor 后端（v0.6.0，第 9 个工具的唯一逻辑层）。
 *
 * 背景：用户反馈「工具 / Skill 没出现」时只能靠猜（未安装、未重载、旧会话、缺 skill
 * provider、版本漂移、树数据异常）。tree_doctor 把这条排查链固化成一次只读调用。
 *
 * 设计铁律：
 *   1. **零写副作用**：只做文件读取 + store.read / store.list；树不变式校验经
 *      `engine.table.validate`（引擎内部同一实现）直调，绕开 `engine.call()` 的 call-log
 *      落盘——doctor 自身不得写任何东西。
 *   2. **FAIL 不 throw**：doctor 是诊断器不是门禁，问题以 `{id, status:'PASS'|'WARN'|'FAIL',
 *      detail, hint?}` 呈现；只有非法 `action` 抛错（调用方参数错误）。
 *   3. **可注入**：pkgDir / toolNames / engine / store / stateRoot / sweepMode / envInfo
 *      全部可由宿主或单测注入；缺省值按包位置与 process.env 自探，便于离线单测。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TREE_ID_RE } from './state.js'

/** 期望注册的工具（注册顺序；8 个既有工具 + 第 9 个 tree_doctor）。 */
export const EXPECTED_TOOL_NAMES = Object.freeze([
  'tree_plan',
  'tree_node',
  'tree_dispatch',
  'tree_report',
  'tree_status',
  'tree_verify',
  'tree_log',
  'tree_maintain',
  'tree_doctor',
])
export const EXPECTED_TOOL_COUNT = EXPECTED_TOOL_NAMES.length
export const EXPECTED_PACKAGE_NAME = '@local/dsh-tree-engine'
/** 检查项 id（顺序即返回顺序，a–g）。 */
export const DOCTOR_CHECK_IDS = Object.freeze(['package', 'tool-count', 'skills', 'tree-data', 'stale', 'sweep', 'env'])

const PASS = 'PASS'
const WARN = 'WARN'
const FAIL = 'FAIL'

const check = (id, status, detail, hint) => ({ id, status, detail, ...(hint ? { hint } : {}) })

/** 包根目录（本文件位于 <pkg>/src/doctor.js）。 */
function defaultPkgDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function readPackageJson(pkgDir) {
  try {
    return { pkg: JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) }
  } catch (e) {
    return { error: e }
  }
}

/** SKILL.md frontmatter 的 `key: value` 行解析（与 tests/skills.test.js 同口径，不引第三方 YAML）。 */
function frontmatterFields(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const fields = {}
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return fields
}

/** a. package：package.json 的 version/name 与 README 最新版本节（`## vX.Y.Z …`）一致性。 */
function checkPackage(pkgDir, pkgInfo) {
  const { pkg, error } = pkgInfo
  if (error) {
    return check('package', FAIL, `package.json 不可读/不可解析：${error?.code ?? error?.message}`, '确认安装目录含 packages/dsh-tree-engine/package.json（files 白名单已含 index.js/src/skills）')
  }
  const version = typeof pkg?.version === 'string' ? pkg.version : null
  const name = typeof pkg?.name === 'string' ? pkg.name : null
  if (!version) {
    return check('package', FAIL, `package.json 缺 version 字段（name=${name ?? '?'}）`, 'package.json 应含 name/version；缺字段说明安装包不完整')
  }
  let readme
  try {
    readme = readFileSync(path.join(pkgDir, 'README.md'), 'utf-8')
  } catch (e) {
    return check('package', FAIL, `${name ?? '?'}@${version} · README.md 不可读（${e?.code ?? e?.message}）`, '包内 README.md 应随包发布（package.json files 含 README.md）')
  }
  const versions = [...readme.matchAll(/^#{1,6}\s+v(\d+\.\d+\.\d+)/gm)].map((m) => m[1])
  const readmeVersion = versions[0] ?? null
  const nameNote = name === EXPECTED_PACKAGE_NAME ? '' : ` · 包名 ${name ?? '?'} ≠ ${EXPECTED_PACKAGE_NAME}（cordis.patch.yml 引用可能失配）`
  if (!readmeVersion) {
    return check('package', WARN, `${name ?? '?'}@${version} · README 无 vX.Y.Z 版本节，无法核对一致性${nameNote}`, `在 README 顶部补一节 \`## v${version} 增量\`，让安装版本可对账`)
  }
  if (readmeVersion !== version) {
    return check('package', FAIL, `${name ?? '?'}@${version} · README 最新版本节 v${readmeVersion} 不一致${nameNote}`, `版本漂移：把 README 版本节更新为 v${version}，或确认加载的是最新安装（旧缓存会保留旧文件）`)
  }
  if (nameNote) {
    return check('package', WARN, `${name ?? '?'}@${version} · README v${readmeVersion} 一致${nameNote}`, `核对 cordis.patch.yml 的 name 与安装包名（期望 ${EXPECTED_PACKAGE_NAME}）`)
  }
  return check('package', PASS, `${name}@${version} · README 版本节 v${readmeVersion} 一致`)
}

/** b. tool-count：注册工具应为 9 个（8 既有 + tree_doctor），与 index.js 的 TOOLS 导出一致。 */
function checkToolCount(toolNames) {
  if (!Array.isArray(toolNames)) {
    return check('tool-count', FAIL, `未注入注册工具清单（期望 ${EXPECTED_TOOL_COUNT} 个：${EXPECTED_TOOL_NAMES.join(', ')}）`, '宿主适配层应传 index.js 的 TOOLS 导出名——这本身是装配异常（doctor 无法核对工具面）')
  }
  const names = toolNames.filter((n) => typeof n === 'string' && n.length > 0)
  const missing = EXPECTED_TOOL_NAMES.filter((n) => !names.includes(n))
  const extra = names.filter((n) => !EXPECTED_TOOL_NAMES.includes(n))
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
  const detail = `注册 ${names.length} 个（期望 ${EXPECTED_TOOL_COUNT} = 8 既有 + tree_doctor）`
  if (names.length === EXPECTED_TOOL_COUNT && !missing.length && !extra.length && !dup.length) {
    return check('tool-count', PASS, `${detail}：${names.join(', ')}`)
  }
  const problems = [
    missing.length ? `缺 ${missing.join('/')}` : '',
    extra.length ? `多 ${extra.join('/')}` : '',
    dup.length ? `重复 ${dup.join('/')}` : '',
  ].filter(Boolean).join('；')
  return check('tool-count', FAIL, `${detail}${problems ? `：${problems}` : ''}`, 'v0.5.x 只有 8 个工具：确认包为 v0.6.0，并对 include:tree-engine 做 disable→enable（Loader 按包名缓存宿主模块）')
}

/** c. skills：两份 SKILL.md 存在且 frontmatter name 对应；patch 挂载 skill provider。 */
function checkSkills(pkgDir) {
  const problems = []
  const ok = []
  for (const id of ['tree-commander', 'tree-worker']) {
    const rel = `skills/${id}/SKILL.md`
    const file = path.join(pkgDir, 'skills', id, 'SKILL.md')
    if (!existsSync(file)) { problems.push(`缺 ${rel}`); continue }
    let text
    try { text = readFileSync(file, 'utf-8') } catch (e) { problems.push(`${rel} 不可读：${e?.code ?? e?.message}`); continue }
    const fields = frontmatterFields(text)
    if (!fields) { problems.push(`${rel} 无 YAML frontmatter 块`); continue }
    if (fields.name !== id) { problems.push(`${rel} frontmatter name="${fields.name ?? ''}" ≠ "${id}"`); continue }
    ok.push(`${id} ✓`)
  }
  const patchPath = path.join(pkgDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    problems.push('缺 cordis.patch.yml（Skill provider 未挂载）')
  } else {
    let patch = null
    try { patch = readFileSync(patchPath, 'utf-8') } catch (e) { problems.push(`cordis.patch.yml 不可读：${e?.code ?? e?.message}`) }
    if (patch != null) {
      if (!patch.includes('@deepseek-ai/dsh-skill-filesystem')) problems.push('cordis.patch.yml 未挂载 @deepseek-ai/dsh-skill-filesystem')
      if (!/providerName:\s*tree-engine\b/.test(patch)) problems.push('cordis.patch.yml 缺 providerName: tree-engine')
      if (problems.length === 0) ok.push('patch: @deepseek-ai/dsh-skill-filesystem (providerName=tree-engine) ✓')
    }
  }
  if (problems.length) {
    return check('skills', FAIL, problems.join('；'), 'Skill 目录随包发布：缺文件/缺 provider 时重装 @local/dsh-tree-engine（v0.6.0）并 disable→enable include:tree-engine；Skill 只在**新会话**装载，旧会话看不到属预期')
  }
  return check('skills', PASS, `${ok.join(' · ')}（Skill 由新会话装载：旧会话里看不到新 Skill 不是故障）`)
}

/** 引擎直调（只读）：validate 复用引擎实现，但绕过 call() 的 call-log 写入。 */
async function validateTreeState(engine, treeId) {
  if (!engine) return { unavailable: true }
  try {
    if (typeof engine.table?.validate === 'function') {
      const r = await engine.table.validate([treeId])
      return { issues: Array.isArray(r?.issues) ? r.issues : [] }
    }
    if (typeof engine.call === 'function') {
      const r = await engine.call('validate', [treeId])
      if (r?.error) return { error: r.error }
      return { issues: Array.isArray(r?.issues) ? r.issues : [] }
    }
    return { unavailable: true }
  } catch (e) {
    return { error: { code: e?.code ?? 'E_INTERNAL', message: e?.message ?? String(e) } }
  }
}

async function readTreeState(store, treeId) {
  if (!store || typeof store.read !== 'function') return { unavailable: true }
  try {
    return { state: await store.read(treeId) }
  } catch (e) {
    return { error: { code: e?.code ?? 'E_INTERNAL', message: e?.message ?? String(e) } }
  }
}

/** 树 dump 兜底（无 store 注入时）：同样避开 call() 的 call-log。 */
async function dumpTreeState(engine, treeId) {
  if (!engine) return null
  try {
    if (typeof engine.table?.treeDump === 'function') {
      const r = await engine.table.treeDump([treeId])
      return r?.tree ?? null
    }
    if (typeof engine.call === 'function') {
      const r = await engine.call('treeDump', [treeId])
      return r?.ok ? (r.tree ?? null) : null
    }
  } catch { /* 读不到就按未知处理 */ }
  return null
}

/** d. tree-data：state 根目录可读 + 树数/节点数/异常 + 可选 tree_id 的存在性/格式/不变式。 */
async function checkTreeData({ treeId, engine, store, stateRoot }) {
  const parts = []
  const hints = []
  let status = PASS
  const raise = (s) => { if (s === FAIL) status = FAIL; else if (s === WARN && status !== FAIL) status = WARN }

  // 1) state 根目录（<DSH_PROFILE_DIR>/tree-engine-data）
  if (!stateRoot) {
    raise(WARN)
    parts.push('未注入 stateRoot（跳过目录可读性）')
    hints.push('宿主适配层应传 tree-engine-data 目录')
  } else {
    try {
      readdirSync(stateRoot)
      parts.push(`state 根目录可读（${stateRoot}）`)
    } catch (e) {
      if (e?.code === 'ENOENT') {
        raise(WARN)
        parts.push(`state 根目录尚不存在（${stateRoot}）`)
        hints.push('首次 tree_plan 后自动创建；已有树却缺失请检查 DSH_PROFILE_DIR 指向')
      } else {
        raise(FAIL)
        parts.push(`state 根目录不可读：${e?.code ?? e?.message}（${stateRoot}）`)
        hints.push('检查目录权限与 DSH_PROFILE_DIR；只读自检不做修复')
      }
    }
  }

  // 2) 树数 / 节点数 / 异常（非树目录如 attack/ 存在属正常，不计异常）
  if (store && typeof store.list === 'function' && typeof store.read === 'function') {
    let dirs = []
    try { dirs = await store.list() } catch (e) {
      raise(WARN)
      parts.push(`树清单不可读：${e?.code ?? 'E_INTERNAL'}`)
      hints.push('磁盘/权限异常；修复前先 tree_maintain backup')
    }
    let nodes = 0
    const trees = []
    const broken = []
    for (const t of dirs) {
      try {
        const s = await store.read(t)
        if (s && s.leaves && typeof s.leaves === 'object') { trees.push(t); nodes += Object.keys(s.leaves).length }
      } catch (e) {
        broken.push(`${t}(${e?.code ?? 'E_INTERNAL'})`)
      }
    }
    parts.push(`trees=${trees.length} nodes=${nodes}`)
    const skipped = dirs.length - trees.length - broken.length
    if (skipped > 0) parts.push(`非树目录=${skipped}（跳过）`)
    if (broken.length) {
      raise(WARN)
      parts.push(`异常树文件=${broken.length}（${broken.slice(0, 3).join(',')}${broken.length > 3 ? '…' : ''}）`)
      hints.push('损坏的 tree-state.json 先隔离备份，再人工修复；出错状态下继续派发只会放大损失')
    }
  } else {
    raise(WARN)
    parts.push('store 未注入（跳过树计数）')
    hints.push('宿主适配层应传 fsStore(tree-engine-data)')
  }

  // 3) tree_id：格式（复用 state.js 的 TREE_ID_RE）→ 存在性 → 不变式（复用引擎 validate）
  if (!treeId) {
    parts.push('未指定 tree_id（仅静态检查）')
  } else if (!TREE_ID_RE.test(treeId)) {
    raise(FAIL)
    parts.push(`tree_id "${treeId}" 格式非法（须匹配 ${String(TREE_ID_RE)}）`)
    hints.push('形如 wave1 / macp2：4-8 位、首字符小写字母、仅 a-z0-9_')
  } else {
    let state = null
    let exists = true
    if (store && typeof store.read === 'function') {
      const r = await readTreeState(store, treeId)
      if (r.error) {
        raise(FAIL)
        parts.push(`目标树状态不可读：${r.error.code}`)
        hints.push('tree-state.json 可能损坏：先备份再修复')
        exists = false
      } else if (r.state === null) {
        raise(FAIL)
        parts.push(`树 "${treeId}" 不存在`)
        hints.push('tree_id 拼写或尚未建树；tree_status {action:"overview"} 列出已有树')
        exists = false
      } else if (r.state) {
        state = r.state
      }
    }
    if (exists && engine) {
      const v = await validateTreeState(engine, treeId)
      if (v.unavailable) {
        raise(WARN)
        parts.push('engine 未装配（跳过不变式校验）')
      } else if (v.error) {
        raise(FAIL)
        parts.push(`validate 失败：${v.error.code}: ${v.error.message}`)
        hints.push('运行 tree_status {action:"validate"} 取原始错误；只读自检不修复')
      } else if (v.issues.length > 0) {
        raise(FAIL)
        const sample = v.issues.slice(0, 3).map((i) => `${i.type ?? '?'}@${i.leaf_id ?? '?'}`).join(',')
        parts.push(`validate 发现 ${v.issues.length} 个不变式问题：${sample}${v.issues.length > 3 ? '…' : ''}`)
        hints.push('先 tree_maintain {action:"backup"}，再用 tree_log {action:"events"} 对账；必要时人工修正状态文件')
      } else {
        const n = state ? Object.keys(state.leaves ?? {}).length : null
        parts.push(`validate PASS（"${treeId}" 0 issues${n == null ? '' : `, nodes=${n}`}）`)
      }
    } else if (exists && !engine) {
      raise(WARN)
      parts.push('engine 未注入（跳过不变式校验）')
      hints.push('tree_doctor 需在插件 apply 之后调用才能复用引擎 validate')
    }
  }

  return check('tree-data', status, parts.join(' · '), hints[0])
}

/** e. stale：给定树时统计超时 running 节点与 segment_pending（只读）。 */
async function checkStale({ treeId, engine, store, nodeTimeoutMs, now }) {
  if (!treeId) return check('stale', PASS, '未指定 tree_id：跳过 stale 统计（静态检查不受影响）')
  let state = null
  let unknownReason = null
  if (store && typeof store.read === 'function') {
    const r = await readTreeState(store, treeId)
    if (r.state) state = r.state
    else if (r.error) unknownReason = `目标树不可读（${r.error.code}）`
    else if (r.state === null) unknownReason = `树 "${treeId}" 不存在`
    else unknownReason = 'store 不可用'
  } else {
    state = await dumpTreeState(engine, treeId)
    if (!state) unknownReason = '无 store/engine 可读树状态'
  }
  if (!state) return check('stale', WARN, `${unknownReason ?? '树状态不可读'}，跳过 stale 统计`)
  const stale = []
  let segmentPending = 0
  for (const leaf of Object.values(state.leaves ?? {})) {
    if (leaf.status === 'segment_pending') segmentPending += 1
    const rt = leaf.runtime
    if (rt?.state !== 'running') continue
    const baseline = Math.max(Number(rt.dispatchedAt) || 0, Number(rt.lastOutputAt) || 0)
    const age = now - baseline
    if (age >= nodeTimeoutMs) stale.push(`${leaf.leaf_id}(${Math.max(1, Math.round(age / 60_000))}min)`)
  }
  if (stale.length > 0 || segmentPending > 0) {
    return check(
      'stale',
      WARN,
      `stale running=${stale.length}${stale.length ? `（${stale.slice(0, 3).join(',')}${stale.length > 3 ? '…' : ''}）` : ''} · segment_pending=${segmentPending} · nodeTimeoutMs=${nodeTimeoutMs}`,
      `tree_status {action:"harvest", tree_id:"${treeId}"} 可立即强制一轮 sweep（硬截止置 timeout、segment_pending 走竹节接力），不必等定时周期`,
    )
  }
  return check('stale', PASS, `无超时 running 节点、无 segment_pending（tree="${treeId}", nodeTimeoutMs=${nodeTimeoutMs}）`)
}

/** f. sweep：sweepMode 与「harvest 可立即强制一轮」提示。 */
function checkSweep({ sweepMode, sweepIntervalMs }) {
  const interval = Number.isFinite(sweepIntervalMs) && sweepIntervalMs > 0 ? sweepIntervalMs : 60_000
  const hint = '树停滞或刚接手时用 tree_status {action:"harvest", tree_id:"<id>"} 立即强制一轮收割，不必等 60s 定时周期'
  if (!sweepMode) {
    return check('sweep', WARN, `sweepMode 不可探测（引擎未装配或旧版本；期望 timer/${interval}ms）`, hint)
  }
  if (sweepMode !== 'timer') {
    return check('sweep', WARN, `sweepMode=${sweepMode}：无周期收割（定时器降级态），只能显式 harvest`, hint)
  }
  return check('sweep', PASS, `sweepMode=timer · 周期=${interval}ms（未跑 harvest ≠ 后台没 sweep）`, hint)
}

/** env 自探（可注入覆盖）：bundled 测试 node 路径、DSH 版本、profile 目录。 */
export function probeEnvInfo(env = process.env) {
  const home = env.USERPROFILE ?? env.HOME ?? ''
  const bundledNodePath = home
    ? path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    : ''
  let dshVersion = env.DSH_VERSION ?? env.DSH_HARNESS_VERSION ?? null
  let runtimeJsonPath = null
  if (home) {
    const p = path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'runtime.json')
    try {
      const j = JSON.parse(readFileSync(p, 'utf-8'))
      runtimeJsonPath = p
      if (!dshVersion && typeof j?.desktopVersion === 'string') dshVersion = j.desktopVersion
    } catch { /* 探测不到 → env 检查降 WARN，不 FAIL */ }
  }
  return { bundledNodePath, dshVersion, runtimeJsonPath, profileDir: env.DSH_PROFILE_DIR ?? env.DSH_HOME ?? null }
}

/** g. env：可探测项报告；探测不到只 WARN，永不 FAIL。 */
function checkEnv({ info }) {
  const nodePath = info?.bundledNodePath ?? ''
  const nodeExists = !!nodePath && existsSync(nodePath)
  const dshVersion = info?.dshVersion ?? null
  const parts = [
    `bundled-node=${nodePath || '(未探测)'}${nodeExists ? ' ✓' : ' ✗'}`,
    `DSH=${dshVersion ?? '不可探测'}`,
  ]
  if (info?.runtimeJsonPath) parts.push(`probe=${info.runtimeJsonPath}`)
  parts.push(`node=${process.version}`)
  if (nodeExists && dshVersion) return check('env', PASS, parts.join(' · '))
  const missing = [!nodeExists ? 'bundled 测试 node 路径' : '', !dshVersion ? 'DSH 版本' : ''].filter(Boolean)
  return check('env', WARN, `${parts.join(' · ')}（未探测到：${missing.join('、')}）`, '该项只报告可探测性、不阻断工具可用性；DSH 桌面安装环境通常可探测，纯 node/CI 环境 WARN 属预期')
}

/**
 * tree_doctor 主入口（只读）。
 *
 * @param {object} [opts]
 * @param {'run'} [opts.action='run']            非法 action → throw（唯一抛错路径）
 * @param {string} [opts.treeId]                 可选：校验该树并统计停滞节点
 * @param {string} [opts.pkgDir]                 包根目录（缺省 = 本文件上一级）
 * @param {string[]} [opts.toolNames]            已注册工具名（宿主传 index.js 的 TOOLS 名；缺失 → FAIL）
 * @param {object|null} [opts.engine]            引擎实例（只用 table.validate/treeDump 只读面）
 * @param {object|null} [opts.store]             树存储（只读 read/list）
 * @param {string|null} [opts.stateRoot]         state 根目录（tree-engine-data）
 * @param {string|null} [opts.sweepMode]         'timer' | 'degraded-lazy' | 'idle' | null
 * @param {number} [opts.sweepIntervalMs=60000]
 * @param {number} [opts.nodeTimeoutMs=1800000]
 * @param {number} [opts.now=Date.now()]
 * @param {object} [opts.env=process.env]
 * @param {object} [opts.envInfo]                覆盖 probeEnvInfo 的探测结果（单测/诊断用）
 * @returns {Promise<{ok:true, action:'run', version:string|null, package_name:string|null,
 *   tool_count:number, tree_id:string|null, checks:object[], summary:{pass:number,warn:number,fail:number}, hint:string}>}
 */
export async function runDoctor(opts = {}) {
  const action = opts.action ?? 'run'
  if (action !== 'run') {
    const err = new Error(`tree_doctor: unknown action "${String(action)}" (only "run")`)
    err.name = 'TreeStateError'
    err.code = 'E_SCHEMA_INVALID'
    throw err
  }
  const pkgDir = path.resolve(opts.pkgDir ?? defaultPkgDir())
  const pkgInfo = readPackageJson(pkgDir)
  const toolNames = opts.toolNames
  const treeId = opts.treeId ?? null
  const nodeTimeoutMs = Number.isFinite(opts.nodeTimeoutMs) && opts.nodeTimeoutMs > 0 ? opts.nodeTimeoutMs : 30 * 60_000
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const treeCtx = { treeId, engine: opts.engine ?? null, store: opts.store ?? null, stateRoot: opts.stateRoot ?? null, nodeTimeoutMs, now }

  const checks = [
    checkPackage(pkgDir, pkgInfo),                                   // a
    checkToolCount(toolNames),                                       // b
    checkSkills(pkgDir),                                             // c
    await checkTreeData(treeCtx),                                    // d
    await checkStale(treeCtx),                                       // e
    checkSweep({ sweepMode: opts.sweepMode ?? null, sweepIntervalMs: opts.sweepIntervalMs }), // f
    checkEnv({ info: { ...probeEnvInfo(opts.env ?? process.env), ...(opts.envInfo ?? {}) } }), // g
  ]

  const summary = { pass: 0, warn: 0, fail: 0 }
  for (const c of checks) summary[c.status === PASS ? 'pass' : c.status === WARN ? 'warn' : 'fail'] += 1

  const firstFail = checks.find((c) => c.status === FAIL && c.hint)
  const firstWarn = checks.find((c) => c.status === WARN && c.hint)
  const hint = firstFail ? `[${firstFail.id}] ${firstFail.hint}`
    : firstWarn ? `[${firstWarn.id}] ${firstWarn.hint}`
      : '未发现异常：工具面、Skill 挂载、树数据与运行环境自检通过'

  return {
    ok: true,
    action: 'run',
    version: typeof pkgInfo.pkg?.version === 'string' ? pkgInfo.pkg.version : null,
    package_name: typeof pkgInfo.pkg?.name === 'string' ? pkgInfo.pkg.name : null,
    tool_count: Array.isArray(toolNames) ? toolNames.filter((n) => typeof n === 'string' && n.length > 0).length : 0,
    tree_id: treeId,
    checks,
    summary,
    hint,
  }
}
