/**
 * Pure-function tests for the row metadata badge derivation (`metaOf`).
 *
 * The real `client.js` is loaded the same way `style-guard.cjs` loads it: the
 * browser bundle is executed in the current realm with a minimal
 * `window.__ModuleLoader__` fixture, then its module object is taken from the
 * appended `export default` line. No React render and no DSH package is
 * involved — `metaOf` is a pure projection → view-model function.
 *
 * What is pinned here (report `session-metadata-display-2026-11-12.md` §5.1):
 *   - `modelSelection.lastUsed` wins over `next`; a missing effort stays null;
 *   - the context percentage uses the shipped `ContextMeter` formula:
 *     `used = projectedTokens ?? pressureTokens`,
 *     `pct = min(100, round(used / window * 100))`, clamped to 0–100;
 *   - missing window / missing tokens / zero or negative window → no pct;
 *   - every absent fact stays null (never a guessed 0 or empty string);
 *   - nothing displayable (no model, no effort, no pct) → `null`, so the row
 *     renders no badge at all.
 *
 * Run:  node test/meta.test.cjs
 * Exit: 0 = all green, 1 = at least one check failed.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT = path.resolve(__dirname, '..', 'client.js')

let checks = 0
let failures = 0
const check = (name, ok, detail) => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  — ' + detail}`)
}

/**
 * The plugin only destructures React at factory time and `metaOf` never
 * renders, so a shape-complete stub is enough.
 */
const REACT_STUB = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, kids: children }),
  Component: class {
    constructor(props) {
      this.props = props || {}
    }
  },
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
}

let loadSeq = 0
function loadClient() {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const tmp = path.join(os.tmpdir(), `session-tree-meta-${process.pid}-${loadSeq++}.mjs`)
  fs.writeFileSync(tmp, `${src}\nexport default globalThis.__CAPTURED_SESSION_TREE__\n`)
  return import(pathToFileURL(tmp).href + `?n=${loadSeq}`).then((m) => {
    fs.unlinkSync(tmp)
    return m.default
  })
}

/** Install the module-loader fixture the client bundle expects. */
function installSandbox() {
  globalThis.window = globalThis
  globalThis.window.__ModuleLoader__ = {
    load({ factory }) {
      globalThis.__CAPTURED_SESSION_TREE__ = factory((name) => {
        if (name === 'react') return REACT_STUB
        throw new Error(`unexpected require: ${name}`)
      })
    },
  }
  globalThis.__CAPTURED_SESSION_TREE__ = null
}

/** One normalized node shape (`norm()` output) carrying raw projections. */
function node(projections) {
  return Object.assign(
    {
      modelSelection: null,
      agentPreset: null,
      tokenUsage: null,
      contextPressure: null,
    },
    projections,
  )
}

async function main() {
  console.log('=== session-tree metaOf: pure row-metadata derivation ===')
  installSandbox()
  const plugin = await loadClient()
  check('模块对象暴露 metaOf（纯函数测试缝）', !!plugin && typeof plugin.metaOf === 'function')
  if (!plugin || typeof plugin.metaOf !== 'function') {
    console.log('\n==================== FAILED (cannot continue) ====================')
    process.exit(1)
  }
  const metaOf = plugin.metaOf

  const selection = (lastUsed, next) => ({ lastUsed: lastUsed || null, next: next || null })
  const windowOf = (contextWindow, tokens) => ({ contextWindow, ...tokens })

  // ---------------------------------------------------------------- null input
  console.log('\n=== A. 没有可展示事实 → null（绝不渲染空徽标）===')
  check('metaOf(null) === null', metaOf(null) === null)
  check('metaOf(undefined) === null', metaOf(undefined) === null)
  check('空节点 → null', metaOf(node({})) === null)
  check(
    '只有 tokenUsage（不可展示）→ null',
    metaOf(node({ tokenUsage: { inputTokens: 10, outputTokens: 2 } })) === null,
  )
  check(
    '只有 agentPreset（只能进 tooltip）→ null',
    metaOf(node({ agentPreset: 'standard' })) === null,
  )
  check(
    '非法形状（modelSelection 不是对象 / contextPressure 不是对象）→ null',
    metaOf(node({ modelSelection: 'nope', contextPressure: 42 })) === null,
  )

  // ------------------------------------------------------- model / effort facts
  console.log('\n=== B. model / provider / effort：lastUsed 优先、next 兜底、缺省不猜 ===')
  const lastUsed = { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' }
  const next = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' }

  const both = metaOf(node({ modelSelection: selection(lastUsed, next) }))
  check('lastUsed 优先于 next', !!both && both.model === 'deepseek-v4.1-flash' && both.provider === 'opencode-go', JSON.stringify(both))
  check('effort 原样取 id（max）', !!both && both.effort === 'max')
  check('modelLabel 与 model 一致（展示名不猜）', !!both && both.modelLabel === both.model)
  check('preset 透传', !!both && both.preset === null, JSON.stringify(both && both.preset))

  const nextOnly = metaOf(node({ modelSelection: selection(null, next) }))
  check('只有 next 时用 next', !!nextOnly && nextOnly.model === 'deepseek-chat' && nextOnly.provider === 'deepseek')
  check('next 的 effort 同样可用', !!nextOnly && nextOnly.effort === 'low')

  const noEffort = metaOf(node({ modelSelection: selection({ provider: 'p', model: 'm' }, null) }))
  check('缺 reasoningEffort → effort === null（渲染层才显示「默认」）', !!noEffort && noEffort.effort === null)
  check('缺 effort 也不影响 model 展示', !!noEffort && noEffort.model === 'm')

  const padded = metaOf(
    node({ modelSelection: selection({ provider: '  p  ', model: '  m  ', reasoningEffort: '  high  ' }, null) }),
  )
  check(
    '字符串字段 trim（provider/model/effort）',
    !!padded && padded.provider === 'p' && padded.model === 'm' && padded.effort === 'high',
    JSON.stringify(padded),
  )

  const weird = metaOf(
    node({ modelSelection: selection({ provider: 7, model: '', reasoningEffort: {} }, null) }),
  )
  check('非字符串 / 空字符串的字段 → null，不是字符串化', !!weird === false, JSON.stringify(weird))

  // ---------------------------------------------------------- context pressure
  console.log('\n=== C. 上下文占用：与官方 ContextMeter 同公式 ===')
  const projected = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(200000, { pressureTokens: 50000, projectedTokens: 76000 }),
    }),
  )
  check('projectedTokens 优先于 pressureTokens', !!projected && projected.usedTokens === 76000, JSON.stringify(projected && projected.usedTokens))
  check('pct = round(76000/200000×100) = 38', !!projected && projected.pct === 38, JSON.stringify(projected && projected.pct))
  check('contextWindow 原样保留', !!projected && projected.contextWindow === 200000)

  const forced = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(100000, { pressureTokens: 25000 }),
    }),
  )
  check('缺 projectedTokens 时退回 pressureTokens（25%）', !!forced && forced.usedTokens === 25000 && forced.pct === 25, JSON.stringify(forced && forced.pct))

  const zero = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(100000, { projectedTokens: 0 }),
    }),
  )
  check('0 token 是真实值：usedTokens=0、pct=0（不是 null）', !!zero && zero.usedTokens === 0 && zero.pct === 0, JSON.stringify(zero && zero.pct))

  const clamped = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(100000, { projectedTokens: 250000 }),
    }),
  )
  check('超过窗口 clamp 到 100', !!clamped && clamped.pct === 100, String(clamped && clamped.pct))

  const rounded = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(3, { projectedTokens: 1 }),
    }),
  )
  check('四舍五入：1/3 → 33', !!rounded && rounded.pct === 33, String(rounded && rounded.pct))

  console.log('\n=== D. 缺失窗口 / 非法窗口 → 不渲染百分比（诚实缺失）===')
  const noWindow = metaOf(
    node({ modelSelection: selection({ model: 'm' }, null), contextPressure: { pressureTokens: 123 } }),
  )
  check('contextPressure 无 contextWindow → pct === null', !!noWindow && noWindow.pct === null)
  check('window 缺失时 usedTokens 仍如实保留', !!noWindow && noWindow.usedTokens === 123)
  check('window 缺失时 contextWindow === null', !!noWindow && noWindow.contextWindow === null)

  const zeroWindow = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(0, { pressureTokens: 10 }),
    }),
  )
  check('window = 0 → pct === null（不做除零）', !!zeroWindow && zeroWindow.pct === null)
  check('window = 0 → contextWindow === null（非法值不展示）', !!zeroWindow && zeroWindow.contextWindow === null)

  const negativeWindow = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(-100, { pressureTokens: 10 }),
    }),
  )
  check('window 为负 → pct === null', !!negativeWindow && negativeWindow.pct === null)

  const noTokens = metaOf(
    node({ modelSelection: selection({ model: 'm' }, null), contextPressure: windowOf(100000, {}) }),
  )
  check('有 window 无 token → pct === null', !!noTokens && noTokens.pct === null && noTokens.usedTokens === null)

  const negativeTokens = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: windowOf(100000, { projectedTokens: -5 }),
    }),
  )
  check('负数 token 是畸形事实 → usedTokens/pct 均为 null', !!negativeTokens && negativeTokens.usedTokens === null && negativeTokens.pct === null)

  const badWindowType = metaOf(
    node({
      modelSelection: selection({ model: 'm' }, null),
      contextPressure: { contextWindow: '100000', pressureTokens: 10 },
    }),
  )
  check('非数字 window → pct === null', !!badWindowType && badWindowType.pct === null)

  // --------------------------------------------------------- pct-only / preset
  console.log('\n=== E. 只有百分比 / 只有 model：可展示字段各自成立 ===')
  const pctOnly = metaOf(
    node({ contextPressure: windowOf(100000, { pressureTokens: 42000 }) }),
  )
  check('没有 model 但有 pct → 返回对象（渲染只显示百分比）', !!pctOnly && pctOnly.model === null && pctOnly.pct === 42, JSON.stringify(pctOnly))

  const modelOnly = metaOf(node({ modelSelection: selection({ provider: 'p', model: 'm', reasoningEffort: 'x' }, null), agentPreset: 'cordis' }))
  check('只有 model/effort → pct === null', !!modelOnly && modelOnly.pct === null)
  check('preset 在 model 存在时一并带出', !!modelOnly && modelOnly.preset === 'cordis')

  const usage = { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 }
  const withUsage = metaOf(node({ modelSelection: selection({ model: 'm' }, null), tokenUsage: usage }))
  check('tokenUsage 原样透传（tooltip 的累计用量）', !!withUsage && withUsage.tokenUsage === usage)

  const verdict =
    failures === 0 ? `ALL CHECKS PASSED (${checks}/${checks})` : `${failures} CHECK(S) FAILED (${checks - failures}/${checks})`
  console.log(`\n==================== ${verdict} ====================`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('meta test crashed:', error)
  process.exit(1)
})
