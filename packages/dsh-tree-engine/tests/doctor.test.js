/**
 * tree_doctor 单测（v0.6.0，第 9 个工具）。
 *
 * 覆盖：①正常树 7 项全 PASS 且零写副作用 ②缺 SKILL.md → FAIL ③patch 缺 provider → FAIL
 * ④非法/不存在 tree_id → FAIL 且不 throw（非法 action 才 throw）⑤无 tree_id 只做静态检查
 * ⑥工具数 8/缺名/重复/未注入 → FAIL ⑦stale 超时 running + segment_pending → WARN
 * ⑧env/sweep 探测不到 → WARN 不 FAIL ⑨index.js TOOLS 导出 9 项 + 真实包自检。
 *
 * 夹具一律用系统临时目录（绝不改动仓库内文件）；测试结束统一清理。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../src/engine.js'
import { memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import { runDoctor, EXPECTED_TOOL_NAMES, EXPECTED_TOOL_COUNT, DOCTOR_CHECK_IDS } from '../src/doctor.js'
import { TOOLS } from '../index.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const WORKER = '22222222-2222-4222-8222-222222222222'
const NOW = 1_700_000_000_000
const NODE_TIMEOUT_MS = 30 * 60_000

const tmpRoots = []
function tmpDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响断言 */ } }
})

const PATCH = `# Patch layer contributed by this bundle (doctor test fixture)
- insert:
    - id: tree-engine
      name: '@local/dsh-tree-engine'
    - id: tree-engine-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: tree-engine
        includeDefaultRoots: false
        bundledSkillDir: !!js process.getBuiltinModule('node:path').join('skills')
`

function writeSkill(pkgDir, id, name = id) {
  mkdirSync(path.join(pkgDir, 'skills', id), { recursive: true })
  writeFileSync(
    path.join(pkgDir, 'skills', id, 'SKILL.md'),
    `---\nname: ${name}\ndescription: 'doctor unit-test fixture skill'\nwhenToUse: 'unit tests only'\n---\n\n# ${id}\n`,
    'utf8',
  )
}

/** 最小包夹具（package.json / README 版本节 / skills / cordis.patch.yml 均可覆盖）。 */
function makePkg(over = {}) {
  const dir = tmpDir('dsh-doctor-pkg-')
  const version = over.version ?? '0.6.0'
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: over.name ?? '@local/dsh-tree-engine', version }, null, 2), 'utf8')
  writeFileSync(path.join(dir, 'README.md'), over.readme ?? `# @local/dsh-tree-engine\n\n## v${version} 增量：测试夹具\n`, 'utf8')
  for (const id of over.skills ?? ['tree-commander', 'tree-worker']) writeSkill(dir, id, over.skillNames?.[id] ?? id)
  writeFileSync(path.join(dir, 'cordis.patch.yml'), over.patch ?? PATCH, 'utf8')
  return dir
}

/** 引擎 + 内存 store 的正常树（tree_id=doct，root + 1 worker）。 */
async function seededTree() {
  const store = memoryStore()
  const clock = new VirtualClock(NOW)
  const engine = createEngine({ store, clock })
  await engine.call('init', ['doct', { goal: 'doctor self-check' }, { dod: 'checks pass' }, ROOT])
  await engine.call('leaf:add', ['doct', { leaf_id: 'doct-C1-worker', session_id: WORKER, parent: 'doct-root', path: 'C1', role: 'worker', added_by: ROOT }], ROOT)
  return { store, engine }
}

/** 全 PASS 的基线 opts（env 用注入值，避免依赖本机探测）。 */
function baseOpts(over = {}) {
  return {
    pkgDir: makePkg(),
    toolNames: EXPECTED_TOOL_NAMES,
    stateRoot: tmpDir('dsh-doctor-state-'),
    sweepMode: 'timer',
    sweepIntervalMs: 60_000,
    nodeTimeoutMs: NODE_TIMEOUT_MS,
    now: NOW,
    envInfo: { bundledNodePath: process.execPath, dshVersion: '9.9.9-test' },
    ...over,
  }
}

const byId = (result, id) => result.checks.find((c) => c.id === id)

test('正常树：7 项全 PASS，且自检零写副作用（状态 / call-log 均未变）', async () => {
  const { store, engine } = await seededTree()
  const beforeState = JSON.stringify(await store.read('doct'))
  const beforeLog = store._callLog('doct').length

  const r = await runDoctor(baseOpts({ engine, store, treeId: 'doct' }))

  assert.equal(r.ok, true)
  assert.equal(r.action, 'run')
  assert.equal(r.version, '0.6.0')
  assert.equal(r.package_name, '@local/dsh-tree-engine')
  assert.equal(r.tool_count, EXPECTED_TOOL_COUNT)
  assert.deepEqual(r.checks.map((c) => c.id), [...DOCTOR_CHECK_IDS])
  assert.deepEqual(r.summary, { pass: 7, warn: 0, fail: 0 }, JSON.stringify(r.checks.filter((c) => c.status !== 'PASS'), null, 2))
  for (const c of r.checks) assert.equal(c.status, 'PASS', `${c.id}: ${c.detail}`)
  assert.match(r.hint, /未发现异常/)
  assert.match(byId(r, 'tree-data').detail, /trees=1 nodes=2/)
  assert.match(byId(r, 'tree-data').detail, /validate PASS/)

  // 零写副作用：树状态逐字不变、call-log 不增长（validate 走 engine.table，不落 call-log）
  assert.equal(JSON.stringify(await store.read('doct')), beforeState)
  assert.equal(store._callLog('doct').length, beforeLog)
})

test('缺 skills/tree-worker/SKILL.md → skills FAIL（临时夹具，不动仓库文件）', async () => {
  const pkgDir = makePkg({ skills: ['tree-commander'] })
  const r = await runDoctor(baseOpts({ pkgDir }))
  const skills = byId(r, 'skills')
  assert.equal(r.ok, true)
  assert.equal(skills.status, 'FAIL')
  assert.match(skills.detail, /缺 skills\/tree-worker\/SKILL\.md/)
  assert.ok(skills.hint, 'FAIL 必须带修复提示')
  assert.equal(r.summary.fail, 1)
  assert.match(r.hint, /^\[skills\]/)
})

test('cordis.patch.yml 缺 providerName / 缺 skill provider 包 → skills FAIL', async () => {
  const noProvider = PATCH.replace('        providerName: tree-engine\n', '')
  const r1 = await runDoctor(baseOpts({ pkgDir: makePkg({ patch: noProvider }) }))
  assert.equal(byId(r1, 'skills').status, 'FAIL')
  assert.match(byId(r1, 'skills').detail, /providerName: tree-engine/)

  const noMount = PATCH.replace('@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-skill-missing')
  const r2 = await runDoctor(baseOpts({ pkgDir: makePkg({ patch: noMount }) }))
  assert.equal(byId(r2, 'skills').status, 'FAIL')
  assert.match(byId(r2, 'skills').detail, /dsh-skill-filesystem/)

  // frontmatter name 与目录名不一致同样 FAIL（Skill 目录按 name 发现）
  const wrongName = makePkg()
  writeSkill(wrongName, 'tree-worker', 'tree-worker-copy')
  const r3 = await runDoctor(baseOpts({ pkgDir: wrongName }))
  assert.equal(byId(r3, 'skills').status, 'FAIL')
  assert.match(byId(r3, 'skills').detail, /name="tree-worker-copy"/)
})

test('非法 / 不存在 tree_id → tree-data FAIL 且不 throw；只有非法 action 才 throw', async () => {
  const { store, engine } = await seededTree()

  const bad = await runDoctor(baseOpts({ engine, store, treeId: 'bad-id' }))
  assert.equal(bad.ok, true, 'doctor 的 FAIL 不得 throw')
  assert.equal(byId(bad, 'tree-data').status, 'FAIL')
  assert.match(byId(bad, 'tree-data').detail, /格式非法/)
  await assert.doesNotReject(() => runDoctor(baseOpts({ engine, store, treeId: 'bad-id' })))

  const missing = await runDoctor(baseOpts({ engine, store, treeId: 'zzzz' }))
  assert.equal(missing.ok, true)
  assert.equal(byId(missing, 'tree-data').status, 'FAIL')
  assert.match(byId(missing, 'tree-data').detail, /不存在/)
  assert.equal(byId(missing, 'stale').status, 'WARN', '树不存在时 stale 降级 WARN，不二次 FAIL')

  await assert.rejects(() => runDoctor({ action: 'delete' }), /unknown action/)
})

test('无 tree_id：只做静态检查（stale 跳过、树计数与不变式路径不触发）', async () => {
  const { store, engine } = await seededTree()
  const r = await runDoctor(baseOpts({ engine, store }))
  assert.equal(r.tree_id, null)
  assert.equal(r.summary.fail, 0)
  assert.equal(byId(r, 'stale').status, 'PASS')
  assert.match(byId(r, 'stale').detail, /跳过/)
  const td = byId(r, 'tree-data')
  assert.equal(td.status, 'PASS')
  assert.match(td.detail, /未指定 tree_id/)
  assert.match(td.detail, /trees=1 nodes=2/)
  assert.doesNotMatch(td.detail, /validate/)
})

test('工具数检查：8 个 / 缺 tree_doctor / 重复 / 未注入 → FAIL；9 个正确 → PASS', async () => {
  const eight = [...EXPECTED_TOOL_NAMES.slice(0, 8)]
  const r8 = await runDoctor(baseOpts({ toolNames: eight }))
  const c8 = byId(r8, 'tool-count')
  assert.equal(c8.status, 'FAIL')
  assert.match(c8.detail, /注册 8 个/)
  assert.match(c8.detail, /期望 9/)
  assert.match(c8.detail, /缺 tree_doctor/)

  const rDup = await runDoctor(baseOpts({ toolNames: [...EXPECTED_TOOL_NAMES, 'tree_plan'] }))
  assert.equal(byId(rDup, 'tool-count').status, 'FAIL')
  assert.match(byId(rDup, 'tool-count').detail, /重复 tree_plan/)

  const rExtra = await runDoctor(baseOpts({ toolNames: [...EXPECTED_TOOL_NAMES.slice(0, 8), 'tree_doctor_v2'] }))
  assert.equal(byId(rExtra, 'tool-count').status, 'FAIL')
  assert.match(byId(rExtra, 'tool-count').detail, /缺 tree_doctor/)
  assert.match(byId(rExtra, 'tool-count').detail, /多 tree_doctor_v2/)

  const rNone = await runDoctor({ ...baseOpts(), toolNames: undefined })
  assert.equal(byId(rNone, 'tool-count').status, 'FAIL')
  assert.match(byId(rNone, 'tool-count').detail, /未注入注册工具清单/)

  const rOk = await runDoctor(baseOpts())
  assert.equal(byId(rOk, 'tool-count').status, 'PASS')
  assert.equal(rOk.tool_count, 9)
})

test('stale：超时 running + segment_pending → WARN 且提示 harvest（tree-data 仍 PASS）', async () => {
  const { store, engine } = await seededTree()
  const state = await store.read('doct')
  const leaf = state.leaves['doct-C1-worker']
  leaf.status = 'segment_pending'
  leaf.runtime = { state: 'running', subagentSessionId: WORKER, dispatchedAt: 1_000_000, lastOutputAt: 1_000_000, attempt: 1, segmentChain: [], history: [] }
  await store.write('doct', state)

  const r = await runDoctor(baseOpts({ engine, store, treeId: 'doct', now: NOW, nodeTimeoutMs: NODE_TIMEOUT_MS }))
  const stale = byId(r, 'stale')
  assert.equal(stale.status, 'WARN')
  assert.match(stale.detail, /stale running=1/)
  assert.match(stale.detail, /segment_pending=1/)
  assert.match(stale.hint, /harvest/)
  assert.equal(byId(r, 'tree-data').status, 'PASS')
  assert.equal(r.summary.fail, 0)
})

test('env 探测不到 / sweepMode 非 timer → WARN，绝不 FAIL', async () => {
  const r = await runDoctor(baseOpts({
    sweepMode: 'degraded-lazy',
    envInfo: { bundledNodePath: path.join(os.tmpdir(), 'definitely-missing-doctor-node.exe'), dshVersion: null },
  }))
  const env = byId(r, 'env')
  const sweep = byId(r, 'sweep')
  assert.equal(env.status, 'WARN')
  assert.equal(sweep.status, 'WARN')
  assert.notEqual(env.status, 'FAIL')
  assert.equal(r.summary.fail, 0)
  assert.match(sweep.detail, /degraded-lazy/)
  assert.match(sweep.hint, /harvest/)
})

test('index.js 导出 9 个工具（8 既有 schema 不变 + tree_doctor），真实包自检通过', async () => {
  assert.equal(TOOLS.length, EXPECTED_TOOL_COUNT)
  assert.deepEqual(TOOLS.map((t) => t.name), [...EXPECTED_TOOL_NAMES])
  for (const tool of TOOLS.slice(0, 8)) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} execute`)
    assert.equal(typeof tool.parameters?.properties, 'object', `${tool.name} parameters`)
    assert.ok(tool.output?.schema, `${tool.name} output schema`)
  }
  const doctor = TOOLS[8]
  assert.equal(doctor.name, 'tree_doctor')
  assert.deepEqual(doctor.parameters.properties.action.enum, ['run'])
  assert.equal(doctor.parameters.properties.tree_id.type, 'string')
  assert.equal(doctor.parameters.required, undefined, 'action 缺省 run：doctor 不强制传参')

  // 真实包（本仓库）自检：package 版本一致性 / tool-count / skills / tree-data 必须 PASS
  const r = await runDoctor({
    toolNames: TOOLS.map((t) => t.name),
    store: memoryStore(),
    stateRoot: tmpDir('dsh-doctor-state-'),
    sweepMode: 'timer',
    sweepIntervalMs: 60_000,
    envInfo: { bundledNodePath: process.execPath, dshVersion: 'test' },
  })
  const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  assert.equal(r.version, pkgVersion)
  assert.equal(byId(r, 'package').status, 'PASS', byId(r, 'package').detail)
  assert.equal(byId(r, 'tool-count').status, 'PASS', byId(r, 'tool-count').detail)
  assert.equal(byId(r, 'skills').status, 'PASS', byId(r, 'skills').detail)
  assert.equal(byId(r, 'tree-data').status, 'PASS', byId(r, 'tree-data').detail)
  assert.deepEqual(r.summary, { pass: 7, warn: 0, fail: 0 }, JSON.stringify(r.checks.filter((c) => c.status !== 'PASS'), null, 2))
})
