/**
 * 活体面板检查(手动):拉取正在运行的 /metaloop/ 面板 HTML 与 /metaloop/api/loops 真实数据,
 * 在 node:vm 里用真实数据执行面板内联脚本,断言渲染无错、关键区块在场、转义生效。
 * 用法: node scripts/live-panel-check.mjs [baseUrl]   (默认 http://127.0.0.1:19387)
 */
import vm from 'node:vm'

const base = process.argv[2] ?? 'http://127.0.0.1:19387'
const panelUrl = `${base}/metaloop/`
const apiUrl = `${base}/metaloop/api/loops`

const html = await (await fetch(panelUrl)).text()
const api = await (await fetch(apiUrl)).json()
const code = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
if (!code) { console.error('FAIL: 面板 HTML 未含内联脚本'); process.exit(1) }

const els = new Map()
const el = (sel) => { if (!els.has(sel)) els.set(sel, { innerHTML: '', addEventListener() {} }); return els.get(sel) }
const sandbox = {
  document: { querySelector: el, querySelectorAll: () => [] },
  fetch: async () => ({ json: async () => api }),
  setInterval: () => 0,
  console,
  Math, JSON, Date, String, Number,
}
vm.runInNewContext(code, sandbox, { filename: 'panel-inline.js' })
await new Promise((r) => setTimeout(r, 30))

const out = el('#app').innerHTML
const text = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const checks = [
  ['api 有轮次数据', Array.isArray(api.loops) && api.loops.length > 0],
  ['渲染无「加载失败」', !out.includes('加载失败') && !text.includes('加载失败')],
  ['含树名', api.loops.every((l) => out.includes(l.tree_id))],
  ['含六阶段管道', out.includes('六阶段')],
  ['含反馈账本', out.includes('反馈账本')],
  ['含 1115 断点', out.includes('1115')],
  ['含策划六类', out.includes('策划（六类覆盖）')],
  ['含 APX 决策', out.includes('APX 裁决')],
  ['含实施清单', out.includes('实施清单')],
  ['含 M4 触发判定', out.includes('M4 触发判定')],
  ['含树执行聚合', out.includes('树执行聚合')],
  ['无未转义标签注入', !out.includes('<session-config-declared>')],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++ }
console.log(`\n面板正文前 300 字:\n${text.slice(0, 300)}`)
console.log(`\n轮次: ${api.loops.map((l) => `${l.tree_id} R${l.current_round}/${l.rounds?.at(-1)?.stage}`).join(', ')}`)
console.log(bad === 0 ? '\nALL GREEN' : `\n${bad} 项 FAIL`)
process.exit(bad === 0 ? 0 : 1)
