/**
 * 面板渲染烟测(2026-10-13 事故回归):
 *   ① "trig is not defined" —— 模板引用了未声明变量,浏览器里整页显示「加载失败」;
 *   ② esc() 恒等映射 —— 转义表被工具写坏成 '&':'&',数据里的 < 直接注入 HTML。
 * 做法:抽出 index.html 内联脚本,在 node:vm + DOM/fetch stub 里真跑一遍 load()。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const PANEL = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..', 'panel', 'index.html')

const FIXTURE = {
  loops: [{
    tree_id: 'mle2e', objective: '验证方法轮治理闭环', current_round: 2,
    stable: { declared: false, green_streak: 0, since_round: 0 },
    rounds: [
      {
        round: 1, opened_at: '2026-10-13T08:09:31.647Z', closed_at: '2026-10-13T08:15:07.096Z', verdict: 'recurse', stage: 'feedback',
        trigger_signals: [{ source: 'M4', note: '新外部反馈' }],
        stages: {
          feedback: { entries: [{ event: 'W1 执行完成', reaction: 'succeeded', evidence: '<session-config-declared> 块已落账', source: 'internal' }], gate: { status: 'pass', checks: [] } },
          analysis: { breakpoints: [{ id: 'bp1', desc: '一致性缝', open: true }], five_questions: { q4: '只读聚合', q5: '验证聚合' } },
          planning: { actions: [{ type: '固本', target_breakpoint: 'bp1', point: '独立状态文件' }] },
          decision: { rulings: [{ candidate: '只读聚合', verdict: 'adopt' }], margins: [{ object: 'so1', estimate: 'ample', signal_key: 'k', reading: '0' }] },
          implementation: { checklist: [{ id: 'c1', text: '对照聚合', checked: true, evidence: 'tree-state' }] },
          retro: { results: '全通', residuals: [], trigger_evaluation: [{ trigger: 'T1-new-fail', fires: false, note: '无新增失败' }], gate: { status: 'pass', checks: [] } },
        },
      },
      { round: 2, opened_at: '2026-10-13T08:15:07.096Z', closed_at: null, stage: 'feedback', trigger_signals: [{ source: 'method', note: '递归' }], stages: { feedback: { entries: [] } } },
    ],
    _agg: { leaves: 2, runtime_succeeded: 1, runtime_failed: 0, runtime_timeout: 0, runtime_frozen: 0, verify_fail: 0, drift_high_severity: 0, active_ratio: 0.5 },
  }],
}

test('panel:内联脚本可渲染真实 fixture(无 ReferenceError),且转义生效', async () => {
  const html = await fsp.readFile(PANEL, 'utf-8')
  const m = /<script>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(m, 'panel 含内联 <script>')
  const code = m[1]

  const els = new Map()
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, { innerHTML: '', addEventListener() {} })
    return els.get(sel)
  }
  const sandbox = {
    document: { querySelector: el, querySelectorAll: () => [] },
    fetch: async () => ({ json: async () => FIXTURE }),
    setInterval: () => 0,
    console,
    Math, JSON, Date, String, Number,
  }
  vm.runInNewContext(code, sandbox, { filename: 'panel-inline.js' })
  await new Promise((r) => setTimeout(r, 20))   // load() 是 async

  const out = el('#app').innerHTML
  assert.ok(!out.includes('加载失败'), `渲染不得报错,实际: ${out.slice(0, 200)}`)
  assert.ok(out.includes('mle2e'), '渲染出树名')
  assert.ok(out.includes('六阶段'), '渲染出六阶段卡片')
  assert.ok(out.includes('只读聚合'), '渲染出 APX 裁决')
  assert.ok(out.includes('T1-new-fail'), '渲染出 M4 触发判定')
  // 转义:证据里的 <session-config-declared> 必须被转义,不得原样注入标签
  assert.ok(out.includes('&lt;session-config-declared&gt;'), 'esc() 必须转义 < >')
  assert.ok(!out.includes('<session-config-declared>'), '不得原样注入未转义标签')
})
