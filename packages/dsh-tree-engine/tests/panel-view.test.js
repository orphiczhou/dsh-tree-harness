/**
 * Tree 运行面板单测（只读投影路由：src/panel-view.js 纯函数 + index.js 路由 handler/注册）。
 *
 * 覆盖：
 *   A. 投影纯函数：trees 列表 / 详情 / events 三形状 + 截断上限 + 脱敏字段缺席 + treeId 正则
 *      + statusCounts 统计 + assignee 三键 + verification 投影 + events seq/since/limit/leaf。
 *   B. createPanelView：memoryStore / fsStore 读取面（mtime updatedAt、损坏树、不存在树 404 投影）。
 *   C. handler 级（fake req/res）：路由匹配（无尾斜杠前缀 + 子路径）、limit/since 钳制、
 *      404/405/403/500 分支、no-store 头、绝不回 ACAO。
 *   D. registerTreePanelRoutes：webServer 缺席降级不阻断、注册形状（prefix + 无尾斜杠 path）、
 *      幂等（重载先 dispose 旧注册再 register，不重复 register 同一路径）、effect/dispose 缝。
 *
 * 夹具一律用系统临时目录 + memoryStore（绝不改动仓库内文件）；测试结束统一清理。
 */
import { test, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, promises as nodeFsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../src/engine.js'
import { fsStore, memoryStore } from '../src/store.js'
import { VirtualClock } from '../src/clock.js'
import {
  PANEL_LIMITS, TREE_PANEL_TREE_ID_RE, clampInt, truncateChars, textPreview,
  runtimeStateOf, displayStateOf,
  statusCounts,
  treeStateOf, projectAssignee, projectVerification, projectLeaf,
  projectTreeSummary, projectTreeDetail, flattenEvents, projectEvents, createPanelView,
} from '../src/panel-view.js'
import {
  TREE_PANEL_ROUTE_PATH, TREE_PANEL_ROUTE_PREFIX,
  createPanelRequestHandler, parsePanelPath, isOriginAllowed, isHostAllowed, registerTreePanelRoutes,
} from '../index.js'

const ROOT = '11111111-1111-4111-8111-111111111111'
const WORKER = '22222222-2222-4222-8222-222222222222'
const NOW = 1_700_000_000_000

const tmpRoots = []
function tmpDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响断言 */ } }
})

/** 引擎 + store 播种一棵树（root + worker + 事件），返回 { store, engine, treeId }。 */
async function seededTree(store, treeId = 'panel', { events = true } = {}) {
  const engine = createEngine({ store, clock: new VirtualClock(NOW) })
  await engine.call('init', [treeId, { goal: '面板夹具树' }, { dod: 'checks pass' }, ROOT])
  await engine.call('leaf:add', [treeId, { leaf_id: `${treeId}-C1-worker`, session_id: WORKER, parent: `${treeId}-root`, path: 'C1', role: 'worker', added_by: ROOT, taskType: 'code-change', dependencies: [`${treeId}-root`] }], ROOT)
  if (events) {
    await engine.call('event:append', [treeId, `${treeId}-C1-worker`, 'progress', { note: 'step 1' }], WORKER)
    await engine.call('event:append', [treeId, `${treeId}-C1-worker`, 'done', { summary: '完成：'.padEnd(6, '完') + 'x'.repeat(300) }], WORKER)
    await engine.call('event:append', [treeId, `${treeId}-root`, 'progress', { note: 'root sees it' }], ROOT)
  }
  return { store, engine, treeId }
}

/** 带 verification/assignee/runtime 痕迹的富 leaf（脱敏断言载体；模拟引擎落账后的形状）。 */
function richLeafFixture() {
  return {
    leaf_id: 'panel-C1-worker', session_id: WORKER, parent: 'panel-root', path: 'C1', role: 'worker',
    added_by: ROOT, status: 'done', relay: 'off', taskType: 'code-change', dependencies: ['panel-root'],
    brief: { secretPrompt: 'DO-NOT-LEAK' }, dod: { secretDod: 'DO-NOT-LEAK' },
    created_at: '2023-11-14T00:00:00.000Z', events: [
      { type: 'progress', meta: { note: 'internal'.repeat(50) }, ts: '2023-11-14T00:01:00.000Z', attempt: 0 },
      { type: 'done', meta: { summary: '已交付面板路由（含幂等注册）' }, ts: '2023-11-14T00:02:00.000Z', attempt: 0 },
    ],
    milestones: [{ id: 'm1', audit_pass: true }], segment_chain: [], drift_history: [],
    context_usage_pct: 37, nudge_count: 0, last_event_type: 'done', last_event_ts: '2023-11-14T00:02:00.000Z',
    model: 'glm-5.3-flash', channel: 'zai',
    assignee: { provider: 'zai', model: 'glm-5.3-flash', effort: 'high', preset: 'internal-preset', mechanism: 'spawn' },
    verification: {
      ts: '2023-11-14T00:03:00.000Z', policy_id: 'code-change', pass: true,
      verdicts: [{ mode: 'artifact', pass: true, detail: 'artifact ok', durationMs: 5 }, { mode: 'command', pass: true, detail: 'exit=0 (pnpm test)', durationMs: 9 }],
      rounds: [{ pass: true, findings: [] }],
    },
    runtime: { state: 'succeeded', subagentSessionId: WORKER, dispatchedAt: NOW, lastOutputAt: NOW, attempt: 1, segmentChain: [WORKER], lastHandoffAt: NOW, handoffBrief: 'K1 内部简报-DO-NOT-LEAK', history: [] },
  }
}

// ===================== A. treeId 白名单 / 基础工具 =====================

describe('treeId 契约正则与基础工具', () => {
  test('TREE_PANEL_TREE_ID_RE：契约 ^[a-z0-9_]{3,32}$ 逐字', () => {
    assert.equal(TREE_PANEL_TREE_ID_RE.source, '^[a-z0-9_]{3,32}$')
    for (const ok of ['abc', 'a1b2', 'tree_1', 'a'.repeat(32)]) assert.ok(TREE_PANEL_TREE_ID_RE.test(ok), ok)
    for (const bad of ['ab', '', 'A'.repeat(4), 'a-b', 'a b', 'a'.repeat(33), '面板树']) assert.ok(!TREE_PANEL_TREE_ID_RE.test(bad), bad)
  })

  test('clampInt：钳制与回退', () => {
    assert.equal(clampInt(50, 1, 200, 20), 50)
    assert.equal(clampInt(999, 1, 200, 20), 200)
    assert.equal(clampInt(0, 1, 200, 20), 1)
    assert.equal(clampInt(NaN, 1, 200, 20), 20)
    assert.equal(clampInt(12.9, 1, 200, 20), 12)
  })

  test('truncateChars / textPreview：字符上限 + 省略号 + 多字节安全', () => {
    assert.equal(truncateChars('abc', 5), 'abc')
    assert.equal(truncateChars('abcdef', 5).length, 5)
    assert.ok(truncateChars('abcdef', 5).endsWith('…'))
    const cn = '完'.repeat(150)
    assert.equal(truncateChars(cn, 120).length, 120)
    assert.ok(textPreview(null) === null)
    assert.equal(textPreview(undefined), null)
    assert.equal(textPreview({ a: 1 }, 200), '{"a":1}')
    assert.equal(textPreview('短文本', 120), '短文本')
    assert.equal(textPreview('完'.repeat(200), 120).length, 120)
    const circular = {}; circular.self = circular
    assert.equal(textPreview(circular, 50), '[unserializable]')
  })

  test('parsePanelPath：三条 GET 路由 + 未知子路径 notFound', () => {
    const list = parsePanelPath('/tree-panel/trees')
    assert.equal(list.ok, true)
    assert.equal(list.route, 'list')
    assert.equal(parsePanelPath('/tree-panel/trees/').route, 'list')
    assert.deepEqual(parsePanelPath('/tree-panel/trees/panel?limit=5').route, 'detail')
    assert.equal(parsePanelPath('/tree-panel/trees/panel?limit=5').params.get('limit'), '5')
    assert.equal(parsePanelPath('/tree-panel/trees/panel/events').route, 'events')
    assert.equal(parsePanelPath('/tree-panel/trees/panel/events').treeId, 'panel')
    assert.equal(parsePanelPath('/tree-panel/trees/panel/events?since=3&leaf=panel-C1-worker').params.get('leaf'), 'panel-C1-worker')
    for (const bad of ['/tree-panel', '/tree-panel/', '/tree-panel/other', '/tree-panel/trees/x/y', '/tree-panel/trees/x/other', '/tree-panel/trees//events']) {
      const p = parsePanelPath(bad)
      assert.equal(p.ok, false, bad)
      assert.equal(p.notFound, true, bad)
    }
    // 绝对 URL 防御（Fetch 风格载体）
    assert.equal(parsePanelPath('http://127.0.0.1:55095/tree-panel/trees?limit=3').route, 'list')
  })

  test('Host/Origin 同源校验（本地白名单；空 Host/无 Origin 容忍；dsh-app 壳放行）', () => {
    assert.equal(isHostAllowed('127.0.0.1:55095').ok, true)
    assert.equal(isHostAllowed('localhost').ok, true)
    assert.equal(isHostAllowed('[::1]:8080').ok, true)
    assert.equal(isHostAllowed('').ok, true)   // 空 Host 容忍
    assert.equal(isHostAllowed('evil.example.com').ok, false)
    assert.equal(isOriginAllowed(undefined).ok, true)   // 同源 GET 无 Origin
    assert.equal(isOriginAllowed('http://127.0.0.1:55095').ok, true)
    assert.equal(isOriginAllowed('null').ok, false)
    assert.equal(isOriginAllowed('dsh-app://app').ok, true)
    assert.equal(isOriginAllowed('https://evil.example.com').ok, false)
  })
})

// ===================== A2. 状态投影（纯函数形状） =====================

describe('statusCounts / assignee / verification / leaf 投影', () => {
  test('statusCounts：按派生展示态统计（v1.6.2 起 raw status 不再是口径）', () => {
    const counts = statusCounts({ a: { status: 'active' }, b: { status: 'active' }, c: { status: 'done' }, d: { status: 'segment_pending' }, e: {} })
    assert.deepEqual(counts, { running: 2, succeeded: 1, segment_pending: 1, pending: 1 })
    // 结算权威在 runtime.state / verification：raw pending_brief 但已 done+verified 的叶子计入 succeeded
    const settled = statusCounts({
      x: { status: 'pending_brief', runtime: { state: 'succeeded' }, verification: { pass: true } },
      y: { status: 'pending_brief', runtime: { state: 'succeeded' } },
      z: { status: 'pending_brief', runtime: { state: 'timeout' } },
    })
    assert.deepEqual(settled, { succeeded: 2, timeout: 1 })
    assert.deepEqual(statusCounts(null), {})
  })

  test('displayStateOf / runtimeStateOf：失败类优先 + 结算归一 + raw 别名', () => {
    assert.equal(runtimeStateOf({ runtime: { state: 'succeeded' } }), 'succeeded')
    assert.equal(runtimeStateOf({ runtime: { state: 42 } }), null)
    assert.equal(runtimeStateOf({}), null)
    assert.equal(runtimeStateOf(null), null)
    // runtime 失败类压过 verification.pass（真实数据存在 timeout + pass=true 的组合）
    assert.equal(displayStateOf({ status: 'pending_brief', runtime: { state: 'failed' } }), 'failed')
    assert.equal(displayStateOf({ status: 'active', runtime: { state: 'timeout' }, verification: { pass: true } }), 'timeout')
    assert.equal(displayStateOf({ status: 'active', runtime: { state: 'aborted' } }), 'cancelled')
    // verification.pass / runtime.succeeded 都收敛到 succeeded
    assert.equal(displayStateOf({ status: 'pending_brief', verification: { pass: true } }), 'succeeded')
    assert.equal(displayStateOf({ status: 'pending_brief', runtime: { state: 'succeeded' } }), 'succeeded')
    // raw 别名归一：done 不能再被当成未知在跑态
    assert.equal(displayStateOf({ status: 'done' }), 'succeeded')
    assert.equal(displayStateOf({ status: 'running' }), 'running')
    assert.equal(displayStateOf({ status: 'failed' }), 'failed')
    // active → running；segment_pending / pruned 保留；pending_brief / 缺失 → pending
    assert.equal(displayStateOf({ status: 'active' }), 'running')
    assert.equal(displayStateOf({ status: 'segment_pending' }), 'segment_pending')
    assert.equal(displayStateOf({ status: 'pruned' }), 'pruned')
    assert.equal(displayStateOf({ status: 'pending_brief' }), 'pending')
    assert.equal(displayStateOf({ status: 'pending' }), 'pending')
    assert.equal(displayStateOf({}), 'pending')
    // 无 runtime 的老状态文件：last_event_type=done 也算结算
    assert.equal(displayStateOf({ status: 'active', last_event_type: 'done' }), 'succeeded')
    // 未知自定义状态原样透出（面板按 grey 处理）
    assert.equal(displayStateOf({ status: 'quarantined' }), 'quarantined')
  })

  test('treeStateOf：root 容器不进「在跑」判定 + 失败优先 + 单叶回落', () => {
    // 真实成因：tree_plan 的 root leaf 是容器，永远拿不到 done 事件 →
    // raw status 恒 active。若按 counts 派生，36 棵里 29 棵画成 running。
    const root = { leaf_id: 'wave2-root', status: 'active' }
    // 键必须与 leaf_id 一致：treeStateOf 用 leaf_id 认 root（状态文件里键=id）。
    const withRoot = (extra) => Object.assign({ 'wave2-root': root }, extra)
    const done = (id) => ({ leaf_id: id, status: 'pending_brief', runtime: { state: 'succeeded' } })
    const pending = (id) => ({ leaf_id: id, status: 'pending_brief' })
    const fail = (id) => ({ leaf_id: id, status: 'active', runtime: { state: 'timeout' } })
    // 容器 root + 全部子叶结算 → 整树 succeeded（旧口径会报 running）
    assert.equal(treeStateOf(withRoot({ 'w-a': done('w-a'), 'w-b': done('w-b') }), 'wave2-root'), 'succeeded')
    // 子叶仍在跑 → running
    assert.equal(treeStateOf(withRoot({ 'w-a': done('w-a'), 'w-b': { leaf_id: 'w-b', status: 'active' } }), 'wave2-root'), 'running')
    // segment_pending 也算在跑
    assert.equal(treeStateOf(withRoot({ s: { leaf_id: 's', status: 'segment_pending' } }), 'wave2-root'), 'running')
    // 子叶全未开始 → pending（root 的 active 不算）
    assert.equal(treeStateOf(withRoot({ p: pending('p') }), 'wave2-root'), 'pending')
    // 失败类优先于一切：root 自己超时也算失败
    assert.equal(treeStateOf({ 'wave2-root': { leaf_id: 'wave2-root', runtime: { state: 'failed' } }, w: done('w') }, 'wave2-root'), 'failed')
    assert.equal(treeStateOf(withRoot({ w: fail('w'), p: pending('p') }), 'wave2-root'), 'failed')
    // 只有 root（单叶树）→ 回落 root 自身展示态（这是真在跑）
    assert.equal(treeStateOf({ r: { leaf_id: 'r', status: 'active' } }, 'r'), 'running')
    assert.equal(treeStateOf({ r: { leaf_id: 'r', status: 'pruned' } }, 'r'), 'pruned')
    // 脏数据：rootLeafId 缺失 / 不匹配 / 空 leaves → 不炸
    assert.equal(treeStateOf({ a: done('a') }, 'nope'), 'succeeded')
    assert.equal(treeStateOf({}, 'r'), 'pending')
    assert.equal(treeStateOf(null, 'r'), 'pending')
  })

  test('projectAssignee：只含 provider/model/effort 三键（preset/mechanism 剥除）', () => {
    const a = projectAssignee({ provider: 'zai', model: 'glm-5.3-flash', effort: 'high', preset: 'x', mechanism: 'spawn', secret: 'tok' })
    assert.deepEqual(a, { provider: 'zai', model: 'glm-5.3-flash', effort: 'high' })
    assert.equal(projectAssignee(null), null)
    assert.equal(projectAssignee('x'), null)
    assert.deepEqual(projectAssignee({}), null)
    assert.deepEqual(projectAssignee({ preset: 'only' }), null)
  })

  test('projectVerification：{pass,attempts,lastVerdict,policy}；detail 不透出；缺省 null', () => {
    const leaf = richLeafFixture()
    const v = projectVerification(leaf.verification)
    assert.deepEqual(v, {
      pass: true,
      attempts: 1,   // rounds 优先于 verdicts
      lastVerdict: { mode: 'command', pass: true },
      policy: 'code-change',
    })
    const raw = JSON.stringify(v)
    assert.ok(!raw.includes('pnpm test') && !raw.includes('artifact ok'), 'verdict detail 不得透出')
    assert.equal(projectVerification(undefined), null)
    const bare = projectVerification({ pass: false })
    assert.deepEqual(bare, { pass: false, attempts: 0, lastVerdict: null, policy: null })
  })

  test('projectLeaf：契约键逐字 + 脱敏（brief/dod/meta/runtime/handoffBrief 绝不出现在 JSON）', () => {
    const leaf = projectLeaf(richLeafFixture())
    assert.deepEqual(Object.keys(leaf), ['leafId', 'parent', 'path', 'role', 'status', 'state', 'rawStatus', 'runtimeState', 'sessionId', 'relay', 'taskType', 'dependencies', 'addedBy', 'assignee', 'ctxPct', 'lastEventAt', 'lastEventType', 'verification', 'doneSummaryPreview'])
    assert.equal(leaf.leafId, 'panel-C1-worker')
    assert.equal(leaf.status, 'succeeded')     // 派生展示态（fixture runtime.state=succeeded + verification.pass）
    assert.equal(leaf.state, 'succeeded')
    assert.equal(leaf.rawStatus, 'done')       // raw 原样保留
    assert.equal(leaf.runtimeState, 'succeeded')
    assert.equal(leaf.relay, 'off')
    assert.equal(leaf.taskType, 'code-change')
    assert.deepEqual(leaf.dependencies, ['panel-root'])
    assert.equal(leaf.ctxPct, 37)
    assert.equal(leaf.lastEventAt, '2023-11-14T00:02:00.000Z')
    assert.equal(leaf.lastEventType, 'done')
    assert.deepEqual(leaf.assignee, { provider: 'zai', model: 'glm-5.3-flash', effort: 'high' })
    assert.equal(leaf.verification.policy, 'code-change')
    assert.equal(leaf.doneSummaryPreview, '已交付面板路由（含幂等注册）')
    const json = JSON.stringify(leaf)
    // 注意：`runtimeState` 是 v1.6.2 的契约键（单字符串），故用 '"runtime"' 判 raw runtime 对象是否外泄。
    for (const forbidden of ['DO-NOT-LEAK', 'secretPrompt', 'handoffBrief', 'K1 ', 'internal', 'milestones', '"runtime"', 'brief', 'dod', '"meta"', 'segmentChain', 'glm-5.3-flash"channel']) {
      assert.ok(!json.includes(forbidden), `投影不得包含 ${JSON.stringify(forbidden)}`)
    }
  })

  test('doneSummaryPreview：≤200 字符截断；无 done / 无 summary → null', () => {
    const longSummary = '完'.repeat(300)
    const withDone = projectLeaf({ events: [{ type: 'done', meta: { summary: longSummary } }] })
    assert.equal(withDone.doneSummaryPreview.length, PANEL_LIMITS.summaryPreviewChars)
    assert.ok(withDone.doneSummaryPreview.endsWith('…'))
    assert.equal(projectLeaf({ events: [{ type: 'done', meta: {} }] }).doneSummaryPreview, null)
    assert.equal(projectLeaf({ events: [{ type: 'progress', meta: { summary: 'x' } }] }).doneSummaryPreview, null)
    assert.equal(projectLeaf({}).doneSummaryPreview, null)
  })
})

describe('trees 列表 / 详情 / events 三形状', () => {
  test('projectTreeSummary：契约键 + rootGoalPreview ≤120 + counts', () => {
    const state = {
      tree_id: 'panel', created_at: '2023-11-14T00:00:00.000Z',
      leaves: { 'panel-root': { leaf_id: 'panel-root', role: 'root', status: 'active', brief: { goal: '完'.repeat(200) } }, 'panel-C1-worker': richLeafFixture() },
    }
    const s = projectTreeSummary(state, { updatedAt: '2023-11-14T09:00:00.000Z' })
    assert.deepEqual(Object.keys(s), ['treeId', 'rootLeafId', 'createdAt', 'updatedAt', 'leafCount', 'counts', 'state', 'rootGoalPreview'])
    assert.equal(s.treeId, 'panel')
    assert.equal(s.rootLeafId, 'panel-root')
    assert.equal(s.leafCount, 2)
    assert.deepEqual(s.counts, { running: 1, succeeded: 1 })
    // v1.7.0：root 容器只参与失败判定，不当成「在跑」——worker 已结算 → succeeded
    assert.equal(s.state, 'succeeded')
    assert.equal(s.updatedAt, '2023-11-14T09:00:00.000Z')
    assert.equal(s.rootGoalPreview.length, PANEL_LIMITS.goalPreviewChars)   // {"goal":"完…" 截到 120 字符
    assert.ok(s.rootGoalPreview.endsWith('…'))
    assert.ok(!s.rootGoalPreview.includes('完'.repeat(200)), 'goal 全文必须被截断')
    // updatedAt 缺省回落 created_at；非法状态 → null（列表侧跳过）
    assert.equal(projectTreeSummary(state).updatedAt, '2023-11-14T00:00:00.000Z')
    assert.equal(projectTreeSummary({ nope: 1 }), null)
    assert.equal(projectTreeSummary(null), null)
  })

  test('projectTreeDetail：契约键 + leaves 排序 + root 缺席 → missing + stats.sessions 计数不透 id', () => {
    const state = {
      tree_id: 'panel', created_at: '2023-11-14T00:00:00.000Z',
      session_registry: { [ROOT]: { kind: 'root' } },
      verify_delegates: [WORKER],
      drift_log: [{ ts: 'x', reason: 'DO-NOT-LEAK' }],
      leaves: { 'panel-root': { leaf_id: 'panel-root', role: 'root', status: 'active', session_id: ROOT, brief: { goal: '面板夹具树' } }, 'panel-C1-worker': richLeafFixture() },
    }
    const d = projectTreeDetail(state)
    assert.deepEqual(Object.keys(d), ['treeId', 'createdAt', 'updatedAt', 'state', 'root', 'leaves', 'stats'])
    assert.equal(d.updatedAt, d.createdAt)
    assert.equal(d.state, 'succeeded')
    assert.deepEqual(d.root, { leafId: 'panel-root', status: 'running', rawStatus: 'active', runtimeState: null, goalPreview: '{"goal":"面板夹具树"}' })
    assert.deepEqual(d.leaves.map((l) => l.leafId), ['panel-C1-worker', 'panel-root'])   // leafId 升序
    assert.deepEqual(d.stats, { total: 2, byStatus: { running: 1, succeeded: 1 }, sessions: 2 })   // registry(1) ∪ runtime(2)
    const json = JSON.stringify(d)
    // sessionId/addedBy 是契约键（会话 id 允许透出）；registry 明细 / verify_delegates / drift 原因 / runtime 不允许
    for (const forbidden of ['session_registry', 'DO-NOT-LEAK', 'verify_delegates', 'drift_log', '"runtime"', '"kind"']) {
      assert.ok(!json.includes(forbidden), `详情投影不得包含 ${JSON.stringify(forbidden)}`)
    }
    // root leaf 缺席（写坏状态）→ missing 面不炸
    const broken = projectTreeDetail({ tree_id: 'panel', leaves: {} })
    assert.deepEqual(broken.root, { leafId: null, status: 'missing', rawStatus: 'missing', runtimeState: null, goalPreview: null })
    assert.deepEqual(broken.stats, { total: 0, byStatus: {}, sessions: 0 })
  })

  test('flattenEvents/projectEvents：seq 确定性 + since + limit 尾部 + leaf 过滤 + lastSeq 全局面', () => {
    const state = {
      tree_id: 'panel',
      leaves: {
        'panel-root': { leaf_id: 'panel-root', events: [{ type: 'progress', ts: '2023-11-14T00:03:00.000Z' }] },
        'panel-C1-worker': { leaf_id: 'panel-C1-worker', events: [
          { type: 'progress', ts: '2023-11-14T00:01:00.000Z' },
          { type: 'done', ts: '2023-11-14T00:02:00.000Z' },
        ] },
      },
    }
    const all = flattenEvents(state)
    assert.deepEqual(all, [
      { seq: 1, ts: '2023-11-14T00:01:00.000Z', leafId: 'panel-C1-worker', type: 'progress' },
      { seq: 2, ts: '2023-11-14T00:02:00.000Z', leafId: 'panel-C1-worker', type: 'done' },
      { seq: 3, ts: '2023-11-14T00:03:00.000Z', leafId: 'panel-root', type: 'progress' },
    ])
    const envelopeKeys = ['seq', 'ts', 'leafId', 'type']
    for (const ev of all) assert.deepEqual(Object.keys(ev), envelopeKeys)
    assert.deepEqual(projectEvents(state, { since: 1, limit: 100 }).events.map((e) => e.seq), [2, 3])
    assert.deepEqual(projectEvents(state, { since: 3 }).events, [])
    assert.deepEqual(projectEvents(state, { limit: 1 }).events.map((e) => e.seq), [3])   // 尾部截断
    assert.deepEqual(projectEvents(state, { limit: 9999 }).events.map((e) => e.seq), [1, 2, 3])   // 钳 500 内全量
    assert.deepEqual(projectEvents(state, { leaf: 'panel-root' }).events.map((e) => e.seq), [3])
    assert.equal(projectEvents(state, { leaf: 'nope' }).events.length, 0)
    const r = projectEvents(state)
    assert.equal(r.lastSeq, 3)   // lastSeq 是全树面（不受 leaf 过滤影响）
    assert.equal(projectEvents({ leaves: null }).lastSeq, 0)
    assert.equal(projectEvents(null).lastSeq, 0)
    // 追加式写入下既有 seq 稳定（新事件 ts 最大 → 排尾）
    const appended = { tree_id: 'panel', leaves: { ...state.leaves, 'panel-root': { leaf_id: 'panel-root', events: [...state.leaves['panel-root'].events, { type: 'done', ts: '2023-11-14T00:04:00.000Z' }] } } }
    assert.deepEqual(flattenEvents(appended).slice(0, 3), all)
    assert.equal(flattenEvents(appended)[3].seq, 4)
  })
})

// ===================== B. createPanelView（store 只读面） =====================

describe('createPanelView：memoryStore / fsStore 读取面', () => {
  test('memoryStore：listTrees 形状 + updatedAt 降序 + limit 钳制 + total', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel')                                                   // created_at = NOW
    const engine2 = createEngine({ store, clock: new VirtualClock(NOW + 1000) })
    await engine2.call('init', ['aaac', { goal: 'c 树' }, {}, ROOT])                    // created_at = NOW+1s
    const engine3 = createEngine({ store, clock: new VirtualClock(NOW + 2000) })
    await engine3.call('init', ['aaab', { goal: 'b 树' }, {}, ROOT])                    // created_at = NOW+2s
    const view = createPanelView({ store })   // 无 stateRoot → updatedAt 回落 created_at
    const r = await view.listTrees({ limit: 2 })
    assert.deepEqual(Object.keys(r), ['ok', 'trees', 'storageRoot', 'updatedAt', 'total'])
    assert.equal(r.ok, true)
    assert.equal(r.storageRoot, null)
    assert.equal(r.total, 3)
    assert.equal(r.trees.length, 2)
    assert.ok(new Date(r.updatedAt).getTime() > 0)
    assert.deepEqual(r.trees.map((t) => t.treeId), ['aaab', 'aaac'])   // updatedAt 降序（新树在前）
    for (const t of r.trees) {
      assert.deepEqual(Object.keys(t), ['treeId', 'rootLeafId', 'createdAt', 'updatedAt', 'leafCount', 'counts', 'state', 'rootGoalPreview'])
    }
    assert.equal((await view.listTrees({ limit: 0 })).trees.length, 1)     // 钳下限
    assert.equal((await view.listTrees({ limit: 9999 })).trees.length, 3)  // 钳 200 内全量
    assert.equal((await view.listTrees()).trees.length, 3)                 // 缺省 50 → 全量
  })

  test('fsStore：tree-state.json mtime → updatedAt；readTree 404/损坏投影；零写副作用', async () => {
    const stateRoot = tmpDir('dsh-panel-state-')
    const store = fsStore(stateRoot)
    await seededTree(store, 'panel')
    const view = createPanelView({ store, stateRoot })
    const list = await view.listTrees({ limit: 50 })
    assert.equal(list.total, 1)
    assert.equal(list.storageRoot, path.resolve(stateRoot))
    const mtime = new Date(list.trees[0].updatedAt)
    assert.ok(Number.isFinite(mtime.getTime()), 'fsStore 树 updatedAt 应取 tree-state.json mtime')
    assert.ok(mtime.getTime() >= Date.now() - 60_000, 'mtime 是宿主时钟（晚于虚拟时钟 created_at）')
    assert.notEqual(list.trees[0].updatedAt, list.trees[0].createdAt)

    const detail = await view.readTree('panel')
    assert.equal(detail.ok, true)
    assert.equal(detail.view.treeId, 'panel')
    assert.equal(detail.view.leaves.length, 2)

    const missing = await view.readTree('zzzz')
    assert.deepEqual(missing, { ok: false, code: 'E_TREE_NOT_FOUND', message: 'tree "zzzz" not found' })

    // 损坏树：写半截 JSON → readTree 结构化报错（不抛）；列表侧跳过
    await nodeFsp.mkdir(path.join(stateRoot, 'broken'), { recursive: true })
    await nodeFsp.writeFile(path.join(stateRoot, 'broken', 'tree-state.json'), '{"tree_id":"broken",', 'utf-8')
    const corrupt = await view.readTree('broken')
    assert.equal(corrupt.ok, false)
    assert.equal(corrupt.code, 'E_TREE_STATE_CORRUPT')
    const after = await view.listTrees({ limit: 50 })
    assert.equal(after.total, 1)
    assert.ok(!after.trees.some((t) => t.treeId === 'broken'))

    // 零写副作用：call-log 未被面板触碰
    assert.ok(existsSync(path.join(stateRoot, 'panel', 'call-log.jsonl')), '引擎播种留有 call-log')
    const before = readFileSync(path.join(stateRoot, 'panel', 'call-log.jsonl'), 'utf-8')
    await view.readTree('panel'); await view.readEvents('panel', {}); await view.listTrees({})
    assert.equal(readFileSync(path.join(stateRoot, 'panel', 'call-log.jsonl'), 'utf-8'), before)
  })

  test('readEvents：信封形状 + since/limit/leaf 全链路（引擎播种事件）', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel')
    const view = createPanelView({ store })
    const r = await view.readEvents('panel', {})
    assert.equal(r.ok, true)
    assert.equal(r.treeId, 'panel')
    assert.deepEqual(Object.keys(r), ['ok', 'treeId', 'events', 'lastSeq'])
    assert.equal(r.lastSeq, 3)
    for (const ev of r.events) {
      assert.deepEqual(Object.keys(ev), ['seq', 'ts', 'leafId', 'type'])
      assert.ok(!JSON.stringify(ev).includes('step 1') && !JSON.stringify(ev).includes('summary'), '事件只给信封，不给 meta')
    }
    assert.deepEqual(r.events.map((e) => [e.leafId, e.type]), [
      ['panel-C1-worker', 'progress'], ['panel-C1-worker', 'done'], ['panel-root', 'progress'],
    ])
    assert.deepEqual((await view.readEvents('panel', { since: 1 })).events.map((e) => e.seq), [2, 3])
    assert.deepEqual((await view.readEvents('panel', { limit: 1 })).events.map((e) => e.seq), [3])
    assert.deepEqual((await view.readEvents('panel', { leaf: 'panel-C1-worker' })).lastSeq, 3)
    assert.equal((await view.readEvents('nope', {})).code, 'E_TREE_NOT_FOUND')
  })

  test('readTree 详情：verification/assignee 脱敏全链路（引擎播种 + 富字段注入）', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel', { events: false })
    // 直接在 store 状态上注入引擎难以经工具面构造的字段（assignee/verification），模拟引擎落账后的形状
    const state = await store.read('panel')
    state.leaves['panel-C1-worker'] = richLeafFixture()
    await store.write('panel', state)
    const view = createPanelView({ store })
    const r = await view.readTree('panel')
    assert.equal(r.ok, true)
    const leaf = r.view.leaves.find((l) => l.leafId === 'panel-C1-worker')
    assert.equal(leaf.verification.pass, true)
    assert.equal(leaf.verification.lastVerdict.mode, 'command')
    assert.deepEqual(leaf.assignee, { provider: 'zai', model: 'glm-5.3-flash', effort: 'high' })
    const json = JSON.stringify(r.view)
    for (const forbidden of ['DO-NOT-LEAK', 'internal-preset', 'artifact ok', 'pnpm test', 'handoffBrief', 'spawn']) {
      assert.ok(!json.includes(forbidden), `详情响应不得包含 ${JSON.stringify(forbidden)}`)
    }
  })
})

// ===================== C. handler 级（fake req/res） =====================

/** fake Node req/res（handler 面断言载体）。 */
function fakeReq(url, { method = 'GET', headers = {} } = {}) { return { method, url, headers } }
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v }
  res.end = (text) => { res.body = text ?? '' }
  return res
}

describe('createPanelRequestHandler（fake webServer handler 面）', () => {
  function makeHandler(store = memoryStore()) { return createPanelRequestHandler({ store, stateRoot: null, log: () => {} }) }

  test('GET /tree-panel/trees：200 契约形状 + no-store/nosniff 头 + 绝不回 ACAO', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel')
    const handle = makeHandler(store)
    const res = fakeRes()
    await handle(fakeReq('/tree-panel/trees?limit=50'), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['access-control-allow-origin'], undefined)
    const body = JSON.parse(res.body)
    assert.deepEqual(Object.keys(body), ['trees', 'storageRoot', 'updatedAt', 'total'])
    assert.equal(body.total, 1)
    assert.equal(body.trees[0].treeId, 'panel')
    assert.ok(!res.body.includes('step 1') && !res.body.includes('K1'), '列表响应不得含事件/简报内容')
  })

  test('limit 钳制（缺省 50；0→1；9999→200 内；非法→缺省）+ 无尾斜杠前缀路由匹配', async () => {
    const store = memoryStore()
    for (const id of ['aaab', 'aaac', 'aaad']) {
      const engine = createEngine({ store, clock: new VirtualClock(NOW) })
      await engine.call('init', [id, { goal: id }, {}, ROOT])
    }
    const handle = makeHandler(store)
    const call = async (url) => { const res = fakeRes(); await handle(fakeReq(url), res); return { status: res.statusCode, body: JSON.parse(res.body) } }
    assert.equal((await call('/tree-panel/trees')).body.trees.length, 3)          // 缺省 50
    assert.equal((await call('/tree-panel/trees?limit=1')).body.trees.length, 1)
    assert.equal((await call('/tree-panel/trees?limit=0')).body.trees.length, 1)  // 钳下限
    assert.equal((await call('/tree-panel/trees?limit=9999')).body.trees.length, 3)
    assert.equal((await call('/tree-panel/trees?limit=abc')).body.trees.length, 3)
    assert.equal((await call('/tree-panel/trees/')).status, 200)                  // 尾斜杠容错
    assert.equal((await call('/tree-panel/trees?limit=2')).body.total, 3)         // total 不受 limit 影响
  })

  test('GET 详情与 events：200 契约形状（逐字键集）', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel')
    const handle = makeHandler(store)
    const res = fakeRes()
    await handle(fakeReq('/tree-panel/trees/panel'), res)
    assert.equal(res.statusCode, 200)
    const detail = JSON.parse(res.body)
    assert.deepEqual(Object.keys(detail), ['treeId', 'createdAt', 'updatedAt', 'state', 'root', 'leaves', 'stats'])
    assert.equal(detail.root.leafId, 'panel-root')
    assert.equal(detail.stats.total, 2)
    assert.equal(detail.leaves.length, 2)
    for (const leaf of detail.leaves) {
      assert.deepEqual(Object.keys(leaf), ['leafId', 'parent', 'path', 'role', 'status', 'state', 'rawStatus', 'runtimeState', 'sessionId', 'relay', 'taskType', 'dependencies', 'addedBy', 'assignee', 'ctxPct', 'lastEventAt', 'lastEventType', 'verification', 'doneSummaryPreview'])
    }
    assert.ok(detail.leaves.some((l) => l.leafId === 'panel-C1-worker' && l.doneSummaryPreview?.startsWith('完成：')), 'doneSummaryPreview 来自 done 事件 meta.summary')

    const res2 = fakeRes()
    await handle(fakeReq('/tree-panel/trees/panel/events?since=1&limit=1&leaf=panel-C1-worker'), res2)
    assert.equal(res2.statusCode, 200)
    const events = JSON.parse(res2.body)
    assert.deepEqual(Object.keys(events), ['treeId', 'events', 'lastSeq'])
    assert.equal(events.treeId, 'panel')
    assert.equal(events.lastSeq, 3)
    assert.equal(events.events.length, 1)   // since=1 + leaf 过滤 + limit=1 → 尾部 1 条
    assert.equal(events.events[0].seq, 2)
    assert.equal(events.events[0].leafId, 'panel-C1-worker')
    assert.equal(events.events[0].type, 'done')
    const res3 = fakeRes()
    await handle(fakeReq('/tree-panel/trees/panel/events?limit=500'), res3)   // 钳上限内全量
    assert.equal(JSON.parse(res3.body).events.length, 3)
    const res4 = fakeRes()
    await handle(fakeReq('/tree-panel/trees/panel/events?limit=501'), res4)
    assert.equal(JSON.parse(res4.body).events.length, 3)   // 501 钳到 500 → 全量 3
  })

  test('404 分支：treeId 正则违约 / 树不存在 / 未知子路径（{error:{code,message}}）', async () => {
    const handle = makeHandler()
    const call = async (url) => { const res = fakeRes(); await handle(fakeReq(url), res); return { status: res.statusCode, body: JSON.parse(res.body) } }
    for (const url of ['/tree-panel/trees/ab', '/tree-panel/trees/ABC', '/tree-panel/trees/a-b', `/tree-panel/trees/${'a'.repeat(33)}`, '/tree-panel/trees/zzzz', '/tree-panel/trees/zzzz/events']) {
      const r = await call(url)
      assert.equal(r.status, 404, url)
      assert.deepEqual(Object.keys(r.body), ['error'])
      assert.deepEqual(Object.keys(r.body.error), ['code', 'message'])
      assert.equal(r.body.error.code, 'E_NOT_FOUND')
    }
    for (const url of ['/tree-panel', '/tree-panel/', '/tree-panel/other', '/tree-panel/trees/panel/other']) {
      const r = await call(url)
      assert.equal(r.status, 404, url)
      assert.equal(r.body.error.code, 'E_NOT_FOUND')
    }
  })

  test('方法闸 / 安全面：POST 405；坏 Host 403；跨源 Origin 403；cross-site 403；无 Origin 放行', async () => {
    const handle = makeHandler()
    const res1 = fakeRes()
    await handle(fakeReq('/tree-panel/trees', { method: 'POST' }), res1)
    assert.equal(res1.statusCode, 405)
    assert.equal(res1.headers.allow, 'GET')
    assert.equal(JSON.parse(res1.body).error.code, 'E_METHOD_NOT_ALLOWED')
    const res2 = fakeRes()
    await handle(fakeReq('/tree-panel/trees', { headers: { host: 'evil.example.com' } }), res2)
    assert.equal(res2.statusCode, 403)
    const res3 = fakeRes()
    await handle(fakeReq('/tree-panel/trees', { headers: { origin: 'https://evil.example.com' } }), res3)
    assert.equal(res3.statusCode, 403)
    const res4 = fakeRes()
    await handle(fakeReq('/tree-panel/trees', { headers: { 'sec-fetch-site': 'cross-site' } }), res4)
    assert.equal(res4.statusCode, 403)
    const res5 = fakeRes()
    await handle(fakeReq('/tree-panel/trees', { headers: { host: '127.0.0.1:55095', origin: 'http://127.0.0.1:55095', 'sec-fetch-site': 'same-origin' } }), res5)
    assert.equal(res5.statusCode, 200)
  })

  test('500 分支：store.read 抛错 → 只含 code（详情不进 body）', async () => {
    const throwing = { list: async () => ['ok1'], read: async () => { throw new Error('simulated disk failure with secrets') } }
    const handle = createPanelRequestHandler({ store: throwing, stateRoot: null, log: () => {} })
    const res = fakeRes()
    await handle(fakeReq('/tree-panel/trees/ok1'), res)
    assert.equal(res.statusCode, 500)
    const body = JSON.parse(res.body)
    assert.deepEqual(body, { error: { code: 'E_TREE_STATE_CORRUPT' } })
    assert.ok(!res.body.includes('secrets'), '500 body 不得含详情')
    // store.list 整体不可用 → 500 E_PANEL_STORE_LIST_FAILED
    const boom = { list: async () => { throw new Error('list boom') }, read: async () => null }
    const handle2 = createPanelRequestHandler({ store: boom, stateRoot: null, log: () => {} })
    const res2 = fakeRes()
    await handle2(fakeReq('/tree-panel/trees'), res2)
    assert.equal(res2.statusCode, 500)
    assert.deepEqual(JSON.parse(res2.body), { error: { code: 'E_PANEL_STORE_LIST_FAILED' } })
  })
})

// ===================== D. 注册（webServer 可选注入 + 幂等） =====================

/** fake ctx：inject 列表按需回调；effect/on 捕获；webServer 可选。 */
function fakeCtx({ webServer, withEffect = true } = {}) {
  const calls = { inject: [], effects: [], disposals: [] }
  const ctx = {
    calls,
    inject(names, cb) {
      calls.inject.push([...names])
      const scoped = {}
      for (const name of names) if (name === 'webServer' && webServer !== undefined) scoped.webServer = webServer
      if (withEffect) scoped.effect = (fn, label) => { calls.effects.push(label ?? '?'); return fn() }
      cb(scoped)
    },
    effect(fn, label) { calls.effects.push(label ?? '?'); return fn() },
    on(event, fn) { if (event === 'dispose') calls.disposals.push(fn) },
  }
  return ctx
}

describe('registerTreePanelRoutes（webServer 可选注入 / 幂等 / 降级）', () => {
  const makeDeps = (over = {}) => ({ store: memoryStore(), stateRoot: tmpDir('dsh-panel-reg-'), log: () => {}, holder: {}, ...over })

  test('headless（webServer 缺席）：跳过注册不阻断，route 形状仍导出', () => {
    const ctx = fakeCtx({ webServer: undefined })
    const out = registerTreePanelRoutes(ctx, makeDeps())
    assert.equal(out.isRegistered(), false)
    assert.equal(out.route.kind, 'prefix')
    assert.equal(out.route.path, '/tree-panel')
    assert.equal(TREE_PANEL_ROUTE_PATH, '/tree-panel')
    assert.equal(TREE_PANEL_ROUTE_PREFIX, '/tree-panel/')
    assert.equal(typeof out.route.handler, 'function')
    assert.deepEqual(ctx.calls.inject[0], ['webServer'])   // 独立可选注入，不碰 ['tools','subagents','sessionQuery']
  })

  test('webServer 注入：注册形状 prefix + 无尾斜杠 path + handler 可服务（端到端 200）', async () => {
    const store = memoryStore()
    await seededTree(store, 'panel')
    const registrations = []
    const webServer = { register: (route) => { registrations.push(route); return () => {} } }
    const ctx = fakeCtx({ webServer })
    const out = registerTreePanelRoutes(ctx, makeDeps({ store }))
    assert.equal(out.isRegistered(), true)
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].path, '/tree-panel')
    assert.ok(!registrations[0].path.endsWith('/'), '注册 path 不得带尾斜杠（宿主前缀匹配契约）')
    assert.equal(registrations[0].kind, 'prefix')
    const res = fakeRes()
    await registrations[0].handler(fakeReq('/tree-panel/trees'), res)
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body).total, 1)
  })

  test('幂等：同 holder/stateRoot 二次注册先 dispose 旧路由（宿主重复 path 不抛错）', () => {
    const disposals = []
    const registrations = []
    const webServer = { register: (route) => { registrations.push(route); return () => disposals.push(route.path) } }
    const deps = makeDeps()
    registerTreePanelRoutes(fakeCtx({ webServer }), deps)   // 第一次（模拟首次 apply）
    registerTreePanelRoutes(fakeCtx({ webServer }), deps)   // 第二次（模拟热更重载）
    assert.equal(registrations.length, 2)
    assert.deepEqual(disposals, ['/tree-panel'])            // 第二次 register 前先撤销第一次
    assert.ok(disposals.length < registrations.length + 1)  // 不存在未撤销的重叠注册
  })

  test('effect / dispose 缝：scoped.effect 持有注册；ctx dispose 撤销路由', () => {
    const registrations = []
    const webServer = { register: (route) => { registrations.push(route); return () => { registrations.length = 0 } } }
    const ctx = fakeCtx({ webServer })
    registerTreePanelRoutes(ctx, makeDeps())
    assert.deepEqual(ctx.calls.effects, ['tree-engine: panel routes'])
    assert.equal(registrations.length, 1)
    assert.equal(ctx.calls.disposals.length, 1)
    ctx.calls.disposals[0]()                                 // 宿主 dispose → 路由撤销
    assert.equal(registrations.length, 0)
  })

  test('webServer 形状不符（无 register）→ 降级日志不抛；register 抛错 → E_PANEL_ROUTE_FAILED 不出 apply', () => {
    const logs = []
    const deps = makeDeps({ log: (m) => logs.push(m) })
    const out1 = registerTreePanelRoutes(fakeCtx({ webServer: {} }), deps)
    assert.equal(out1.isRegistered(), false)
    const boom = { register: () => { throw new Error('duplicate path') } }
    const out2 = registerTreePanelRoutes(fakeCtx({ webServer: boom }), makeDeps())
    assert.equal(out2.isRegistered(), false)
    assert.ok(logs.some((m) => m.includes('降级')), '无 register 服务 → 降级日志')
    // ctx.inject 自身抛错也不出函数（apply 级防御的最后一条线）
    const evilCtx = { inject: () => { throw new Error('inject boom') } }
    assert.doesNotThrow(() => registerTreePanelRoutes(evilCtx, makeDeps()))
  })

  test('apply() 冒烟（子进程，DSH_PROFILE_DIR 隔离到临时目录）：9 工具注册 + 面板降级互不影响', async () => {
    const { execFileSync } = await import('node:child_process')
    const profile = tmpDir('dsh-panel-profile-')
    const testsDir = import.meta.dirname
    const script = [
      "import { apply } from '../index.js'",
      'const disposals = []',
      'const registered = []',
      'const ctx = {',
      '  inject(names, cb) {',
      "    if (names.includes('tools')) { cb({ tools: { register: (t) => registered.push(t.name) }, subagents: {}, sessionQuery: {} }); return }",
      "    if (names[0] === 'webServer') cb({})   // webServer 缺席 → 面板降级路径",
      '  },',
      "  on(event, fn) { if (event === 'dispose') disposals.push(fn) },",
      '}',
      'apply(ctx)',
      'for (const d of disposals) { try { d() } catch {} }   // 收尾：停 sweep / 撤路由，不留悬挂 interval',
      "console.log('RESULT:' + JSON.stringify({ tools: registered }))",
    ].join('\n')
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: testsDir,
      env: { ...process.env, DSH_PROFILE_DIR: profile },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],   // 子进程 stderr（apply 诊断）不回灌测试输出
      timeoutMs: 30_000,
    })
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT:'))
    assert.ok(line, `子进程应输出 RESULT 行（stdout: ${stdout.slice(-400)}）`)
    const result = JSON.parse(line.slice('RESULT:'.length))
    assert.deepEqual(result.tools, ['tree_plan', 'tree_node', 'tree_dispatch', 'tree_report', 'tree_status', 'tree_verify', 'tree_log', 'tree_maintain', 'tree_doctor'])
    // 隔离证据：面板数据根在临时 profile，真实 profile 未被测试触碰
    assert.ok(existsSync(path.join(profile, 'tree-engine-data', 'apply.log')), 'apply 留痕落在隔离 profile')
  })
})
