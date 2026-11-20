/**
 * 工具面 render / 派发文本单测（v0.13.1 洁净室修复的机检契约）。
 *
 * 背景（2026-11-20 洁净室实测 + 三路审计交叉校验）：工具返回对象是对的，但**文本渲染**让指挥
 * 官看不到内容 —— status overview 只剩 `ok (sweepMode=…)`、node list 只回数量、dod 恒显示
 * `FAIL ()`、verify run 不显示 verdict detail；同时派发尾部对 commander 也追加「除此之外不得
 * 操作树」，与「被派发指挥官在自己 leaf 下加子节点」的 SKILL 契约互斥。
 *
 * 本文件只测纯渲染与纯文本生成（不装配宿主、不写 IO）：
 *   A. settleTextFor 按 role 分支（commander/auditor 可管理本树；worker 保持最小权限）
 *   B. tree_node list/list-all 一行一叶（12 行上限 + 截断提示）；单叶渲染保持旧形状
 *   C. tree_status overview 显示叶子状态分布 / harvest 无运行叶时明确 all settled / sessions
 *   D. tree_verify dod 预览不再假 FAIL、run 渲染 verdict detail、run 缺 leaf_id 显式报错
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, settleTextFor } from '../index.js'

const toolOf = (name) => {
  const t = TOOLS.find((x) => x.name === name)
  assert.ok(t, `TOOLS 中必须有 ${name}`)
  return t
}
const render = (tool, value) => tool.output.render(undefined, value).map((x) => x.text).join('\n')

test('settleTextFor：commander/auditor 可管理本树；worker 与缺省角色保持最小权限', () => {
  const cmd = settleTextFor('commander', 'demo', 'demo-C1-commander')
  assert.match(cmd, /demo\/demo-C1-commander/)
  assert.match(cmd, /role=commander/)
  assert.match(cmd, /你可以在本树内使用 tree_node \/ tree_dispatch \/ tree_verify \/ tree_status \/ tree_log/)
  assert.ok(!cmd.includes('除此之外不得操作树'), 'commander 不得再被禁止操作树')

  const audit = settleTextFor('auditor', 'demo', 'demo-C1a1-auditor')
  assert.match(audit, /你可以在本树内使用 tree_node/)

  for (const role of ['worker', undefined, 'root']) {
    const text = settleTextFor(role, 'demo', 'demo-C1a1-worker')
    assert.match(text, /除此之外不得操作树/, `role=${role} 必须保持最小权限`)
    assert.ok(!text.includes('你可以使用 tree_node'), `role=${role} 不得获得树管理权限`)
  }
})

test('tree_node render：list/list-all 一行一叶（状态/runtime/role/parent/ctx），12 行封顶', () => {
  const treeNode = toolOf('tree_node')
  const leaves = Array.from({ length: 14 }, (_, i) => ({
    leaf_id: `demo-C${i + 1}-worker`,
    status: 'active',
    runtime: i % 2 === 0 ? { state: 'succeeded' } : undefined,
    role: 'worker',
    parent: 'demo-root',
    context_usage_pct: i * 5,
  }))
  const text = render(treeNode, { leaves })
  const lines = text.split('\n')
  assert.equal(lines[0], 'tree_node: 14 leaves')
  assert.equal(lines[1], 'demo-C1-worker status=active rt=succeeded role=worker parent=demo-root ctx=0%')
  assert.equal(lines[2], 'demo-C2-worker status=active rt=- role=worker parent=demo-root ctx=5%')
  assert.equal(lines.length, 1 + 12 + 1, '计数行 + 12 行叶 + 1 行截断提示')
  assert.equal(lines[13], '…(+2 more; tree_node get <leaf_id> for one line of detail)')

  assert.equal(render(treeNode, { leaves: [] }), 'tree_node: 0 leaves')

  const single = render(treeNode, {
    leaf: { leaf_id: 'demo-C1-worker', status: 'active', runtime: { state: 'running', attempt: 1, segmentChain: [] }, milestones: [], relay: 'auto', context_usage_pct: 12 },
  })
  assert.match(single, /^tree_node: demo-C1-worker status=active · runtime\[state=running attempt=1 chain=0 sess=\] relay=auto ctx=12%$/)
})

test('tree_status render：overview 显示叶子 runtime 分布；harvest 无运行叶时 all settled', () => {
  const treeStatus = toolOf('tree_status')
  const overview = render(treeStatus, {
    tree: {
      tree_id: 'demo',
      root_leaf_id: 'demo-root',
      leaves: {
        'demo-root': { leaf_id: 'demo-root', status: 'active', runtime: { state: 'running' } },
        'demo-C1-worker': { leaf_id: 'demo-C1-worker', status: 'active', runtime: { state: 'succeeded' } },
        'demo-C2-worker': { leaf_id: 'demo-C2-worker', status: 'active' },
      },
    },
    sweepMode: 'timer',
  })
  assert.equal(overview, 'tree_status: overview demo leaves=3 [active=1 running=1 succeeded=1] root=demo-root (sweepMode=timer)')

  // live projection uses camelCase rootLeafId (panel-view projectTreeSummary)
  const camel = render(treeStatus, {
    tree: {
      treeId: 'wave2',
      rootLeafId: 'wave2-root',
      leaves: { 'wave2-root': { leaf_id: 'wave2-root', status: 'active' } },
    },
    sweepMode: 'timer',
  })
  assert.match(camel, /root=wave2-root \(sweepMode=timer\)/)

  // real tree-state.json has no root id: derive from the parentless root leaf
  const derived = render(treeStatus, {
    tree: {
      tree_id: 'skc2',
      leaves: {
        'skc2-root': { leaf_id: 'skc2-root', status: 'active', parent: null, runtime: { state: 'running' } },
        'skc2-C1a1-worker': { leaf_id: 'skc2-C1a1-worker', status: 'pending_brief', parent: 'skc2-root', runtime: { state: 'succeeded' } },
      },
    },
    sweepMode: 'timer',
  })
  assert.match(derived, /root=skc2-root \(sweepMode=timer\)/)

  assert.equal(
    render(treeStatus, { swept: [{ tree_id: 'demo', events: [] }], sweepMode: 'timer' }),
    'tree_status: harvest all settled (no running leaves; sweepMode=timer)',
  )
  assert.equal(
    render(treeStatus, { swept: [{ tree_id: 'demo', events: [{ event: 'timeout' }, { event: 'nudge', relay: 'started' }] }], sweepMode: 'timer' }),
    'tree_status: harvest demo:timeout,nudge(started) (sweepMode=timer)',
  )
  assert.equal(render(treeStatus, { issues: [], ok: true }), 'tree_status: validate PASS (0 issues)')
  assert.equal(render(treeStatus, { count: 7, max: 50, reached: false }), 'tree_status: sessions 7/50')
})

test('tree_verify render：dod 是预览不是 FAIL；run 显示 verdict detail；缺 leaf_id 显式报错', async () => {
  const treeVerify = toolOf('tree_verify')

  const dod = render(treeVerify, { dod: '[DoD] 交付物存在\n 且 ≥200 字符', resolved_policy_id: 'doc' })
  assert.equal(dod, 'tree_verify: DoD preview (doc) [DoD] 交付物存在 且 ≥200 字符')
  assert.ok(!dod.includes('FAIL'), 'dod 预览不得渲染成 FAIL')

  const long = render(treeVerify, { dod: 'x'.repeat(300), resolved_policy_id: 'default' })
  assert.match(long, /x{160}…$/)
  assert.ok(long.length < 220, `dod 预览应截断（实际 ${long.length}）`)

  const run = render(treeVerify, {
    result: {
      pass: false,
      verdicts: [{ mode: 'artifact', pass: false, detail: 'no artifact matching **/*.md under C:/tmp/empty' }],
    },
  })
  assert.equal(run, 'tree_verify: FAIL (artifact:FAIL detail="no artifact matching **/*.md under C:/tmp/empty")')

  assert.equal(
    render(treeVerify, { result: { pass: true, verdicts: [{ mode: 'self-report', pass: true, detail: 'self-report: 执行者自述完成即过（缺省模式）' }] } }),
    'tree_verify: PASS (self-report:PASS detail="self-report: 执行者自述完成即过（缺省模式）")',
  )

  await assert.rejects(
    () => treeVerify.execute({ action: 'run', tree_id: 'demo' }, undefined),
    /tree_verify run requires leaf_id/,
  )
})
