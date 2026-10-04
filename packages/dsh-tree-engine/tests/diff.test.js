/**
 * 差分金标准（S1；冻结版 §9 R1 判据 / engine-spec §9）：
 * 同输入序列喂源引擎（D:\Codes\tree-harness\tree-engine.cjs，自包含 CJS）与本引擎，
 * 投影后逐字段深度相等；白名单外差异 = 失败（记录最小复现）。
 *
 * 源 run() 签名实测：run(cmd, args, treesRoot?, callerSessionId?)（第三参是 treesRoot、第四参才是 caller）。
 *
 * 投影规则（engine-spec §9）：
 *   必一致：leaf_id / parent / role / status / path / model / channel / session_id / added_by /
 *           context_usage_pct / segment_chain / milestone.id / events(type+meta) / nudge_count / drifts(kind/severity/action/reason)
 *   白名单：ISO 时间戳类（created_at/ts/last_event_ts/…）、运行期生成 id（备份名）、内部自增序号
 *
 * 已冻结偏差（tests/diff.DEVIATIONS.md 登记）：
 *   D-v1 错误对象字段名 message（源 msg）——封套层差异，不进状态投影；
 *   D-v2 E_CALLER_REQUIRED 生产闸（源）vs caller 校验仅在身份类操作（本引擎）——待移植清单；
 *   D-v3 path 精确规则已随差分对齐（path ≡ leaf_id 的 path 段，如 'C1'）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const SOURCE_ENGINE_PATH = 'D:/Codes/tree-harness/tree-engine.cjs'   // 差分基准仓（engine-spec §9 锚定）

const ROOT = '11111111-1111-4111-8111-111111111111'
const W1 = '22222222-2222-4222-8222-222222222222'
const W2 = '33333333-3333-4333-8333-333333333333'
const SEG = '44444444-4444-4444-8444-444444444444'

async function tmpdir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

/** 状态投影（白名单时间戳类整体剔除）。 */
function project(state) {
  const leaves = {}
  for (const [id, l] of Object.entries(state.leaves ?? {})) {
    leaves[id] = {
      leaf_id: l.leaf_id,
      parent: l.parent ?? null,
      role: l.role,
      status: l.status,
      path: l.path ?? '',
      model: l.model ?? null,
      channel: l.channel ?? null,
      session_id: l.session_id ?? null,
      added_by: l.added_by ?? null,
      context_usage_pct: l.context_usage_pct ?? 0,
      segment_chain: l.segment_chain ?? [],
      milestones: (l.milestones ?? []).map((m) => ({ id: m.id })),
      events: (l.events ?? []).map((e) => ({ type: e.type, meta: e.meta })),
      nudge_count: l.nudge_count ?? 0,
      drifts: (l.drift_history ?? []).map((d) => ({ kind: d.kind, severity: d.severity, action: d.action, reason: d.reason })),
    }
  }
  return { tree_id: state.tree_id, leaves }
}

async function makeEngines(prefix) {
  const srcDir = await tmpdir(`${prefix}-src-`)
  const dstDir = await tmpdir(`${prefix}-dst-`)
  const src = require(SOURCE_ENGINE_PATH)
  const { createEngine } = await import('../src/engine.js')
  const { fsStore } = await import('../src/store.js')
  const { systemClock } = await import('../src/clock.js')
  const dst = createEngine({ store: fsStore(dstDir), clock: systemClock() })
  return { src, dst, srcDir, dstDir }
}

test('差分：init → leaf add → event → set-context → segment append 全链投影一致', async () => {
  const { src, dst, srcDir, dstDir } = await makeEngines('diff1')
  const TREE = 'dtest'
  const leafW = { leaf_id: 'dtest-C1-worker', session_id: W1, parent: 'dtest-root', path: 'C1', role: 'worker', added_by: ROOT, model: 'glm-5.3', channel: 'main' }

  let s, d
  s = await src.run('init', [TREE, '--root-brief', '{"g":"x"}', '--root-dod', '{"d":"y"}', '--session-id', ROOT], srcDir, ROOT)
  d = await dst.call('init', [TREE, { g: 'x' }, { d: 'y' }, ROOT])
  assert.ok(s.ok, `src init: ${JSON.stringify(s.error)}`)
  assert.ok(d.ok, `dst init: ${JSON.stringify(d.error)}`)

  s = await src.run('leaf', ['add', TREE, '--json', JSON.stringify(leafW)], srcDir, ROOT)
  d = await dst.call('leaf:add', [TREE, leafW], ROOT)
  assert.ok(s.ok, `src leaf add: ${JSON.stringify(s.error)}`)
  assert.ok(d.ok, `dst leaf add: ${JSON.stringify(d.error)}`)

  s = await src.run('event', ['append', TREE, 'dtest-C1-worker', '--type', 'brief_echo', '--json', '{"my_understanding":"u"}'], srcDir, W1)
  d = await dst.call('event:append', [TREE, 'dtest-C1-worker', 'brief_echo', { my_understanding: 'u' }], W1)
  assert.ok(s.ok, `src event: ${JSON.stringify(s.error)}`)
  assert.ok(d.ok, `dst event: ${JSON.stringify(d.error)}`)

  s = await src.run('leaf', ['set-context', TREE, 'dtest-C1-worker', '30'], srcDir, W1)
  d = await dst.call('leaf:set-context', [TREE, 'dtest-C1-worker', 30], W1)
  assert.ok(s.ok && d.ok, `set-context: ${JSON.stringify([s, d])}`)

  s = await src.run('segment', ['append', TREE, 'dtest-C1-worker', SEG], srcDir, W1)
  d = await dst.call('segment:append', [TREE, 'dtest-C1-worker', SEG])
  assert.ok(s.ok, `src segment: ${JSON.stringify(s.error)}`)
  assert.ok(d.ok, `dst segment: ${JSON.stringify(d.error)}`)

  const srcState = JSON.parse(await fsp.readFile(path.join(srcDir, TREE, 'tree-state.json'), 'utf-8'))
  const dstState = JSON.parse(await fsp.readFile(path.join(dstDir, TREE, 'tree-state.json'), 'utf-8'))
  const p1 = project(srcState)
  const p2 = project(dstState)
  try {
    assert.deepEqual(p2, p1)
  } catch (e) {
    const diffLeaves = []
    for (const id of new Set([...Object.keys(p1.leaves), ...Object.keys(p2.leaves)])) {
      try { assert.deepEqual(p2.leaves[id], p1.leaves[id]) } catch { diffLeaves.push(id) }
    }
    assert.fail(`差分失败，差异 leaf: ${diffLeaves.join(', ')}\n${e.message.slice(0, 2500)}`)
  }
})

test('差分：非法输入行为一致（重复 init / 借身份 leaf add / 重复 segment id）', async () => {
  const { src, dst, srcDir } = await makeEngines('diff2')
  await src.run('init', ['dtwo', '--root-brief', '{}', '--root-dod', '{}', '--session-id', ROOT], srcDir, ROOT)
  await dst.call('init', ['dtwo', {}, {}, ROOT])

  const leafW = { leaf_id: 'dtwo-C1-worker', session_id: W1, parent: 'dtwo-root', path: 'C1', role: 'worker', added_by: ROOT }
  await src.run('leaf', ['add', 'dtwo', '--json', JSON.stringify(leafW)], srcDir, ROOT)
  await dst.call('leaf:add', ['dtwo', leafW], ROOT)

  const s1 = await src.run('init', ['dtwo', '--root-brief', '{}', '--root-dod', '{}'], srcDir, ROOT)
  const d1 = await dst.call('init', ['dtwo', {}, {}])
  assert.equal(s1.ok, false); assert.equal(d1.ok, false)

  const badLeaf = { leaf_id: 'dtwo-C2-worker', session_id: W2, parent: 'dtwo-root', path: 'C2', role: 'worker', added_by: ROOT }
  const s2 = await src.run('leaf', ['add', 'dtwo', '--json', JSON.stringify(badLeaf)], srcDir, W2)
  const d2 = await dst.call('leaf:add', ['dtwo', badLeaf], W2)
  assert.equal(s2.ok, false, 'src 应拒借身份')
  assert.equal(d2.ok, false, 'dst 应拒借身份')

  await src.run('segment', ['append', 'dtwo', 'dtwo-C1-worker', SEG], srcDir, W1)
  await dst.call('segment:append', ['dtwo', 'dtwo-C1-worker', SEG])
  const s3 = await src.run('segment', ['append', 'dtwo', 'dtwo-C1-worker', SEG], srcDir, W1)
  const d3 = await dst.call('segment:append', ['dtwo', 'dtwo-C1-worker', SEG])
  assert.equal(s3.ok, false); assert.equal(d3.ok, false)
})
