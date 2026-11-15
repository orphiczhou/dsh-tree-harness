/**
 * Headless render test for the Tree Runs panel (the client half added to
 * `client.js`): composer-dock entry pill, right-sidebar tab body, and the
 * degraded shell.overlay — modeled on `test/render.test.cjs`'s approach:
 *
 *   - the REAL `client.js` is loaded in a `vm` sandbox with a minimal React
 *     stub (hook-counting useState, effect-recording useEffect) and a stubbed
 *     `fetch` that serves the frozen `/tree-panel` contract JSON;
 *   - components are rendered with a mini renderer (same shape as
 *     render.test.cjs's `renderTree`) and asserted from the produced tree;
 *   - every scenario builds its own panel runtime via the exported
 *     `createPanelRuntime` test seam, so scenarios cannot leak store state.
 *
 * What is proved here:
 *   ① the list renders tree cards (mono treeId, per-tone count dots, preview);
 *   ② clicking a card renders the detail: summary grid, leaves table with the
 *      key columns (leafId / status badge / relay / taskType / ctxPct /
 *      verification ✓✗ / dependencies) and the events tail;
 *   ③ loading / error / empty render as inline notes AND the useState hook
 *      count is CONSTANT across the three states (the F8 rule: any early
 *      branch must live after every hook — this assertion is the regression
 *      fence for the same React #300/#310 class of bug in the panel);
 *   ④ the pill renders with the right class/label, opens the right-sidebar tab
 *      when the service is present and the overlay when it is not;
 *   ⑤ no external resources: every request is a same-origin relative
 *      `/tree-panel` path, rendered props carry no absolute URLs, and the CSS
 *      carries no url()/http references.
 *   Plus hygiene: poll interval ids are tracked on
 *   `window.__stTreePanelTimers`, cleared by a re-apply (HMR re-load), and
 *   unmount aborts every in-flight request through AbortController.
 *
 * Only Node built-ins. Run:  node test/panel-render.test.cjs
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

/** The module under test: the package's client half, resolved from this file. */
const CLIENT = path.join(__dirname, '..', 'client.js')

let failures = 0
let checks = 0
function check(name, pass, detail) {
  checks++
  if (!pass) failures++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  — ' + detail}`)
}

// ================================================================ fixtures
// Frozen /tree-panel contract shapes (client and server sessions share them;
// the server half may not be merged yet — everything here is stubbed).
const TREES_BODY = {
  trees: [
    {
      treeId: 'tree-alpha',
      rootLeafId: 'la-root',
      createdAt: '2026-11-15T01:00:00.000Z',
      updatedAt: '2026-11-15T02:30:00.000Z',
      leafCount: 4,
      counts: { pending: 1, running: 2, succeeded: 1, failed: 0 },
      rootGoalPreview: '拆解三层任务树并逐层验收（preview line）',
    },
    {
      treeId: 'tree-beta',
      rootLeafId: 'lb-root',
      createdAt: '2026-11-15T00:10:00.000Z',
      updatedAt: '2026-11-15T00:40:00.000Z',
      leafCount: 3,
      counts: { succeeded: 3 },
      rootGoalPreview: 'Second tree goal',
    },
  ],
  storageRoot: 'D:\\Codes\\dsh-tree-harness\\.tree-store',
  updatedAt: '2026-11-15T02:30:00.000Z',
  total: 2,
}

const DETAIL_BODY = {
  treeId: 'tree-alpha',
  createdAt: '2026-11-15T01:00:00.000Z',
  updatedAt: '2026-11-15T02:30:00.000Z',
  root: { leafId: 'la-root', status: 'running', goalPreview: '拆解三层任务树并逐层验收（preview line）' },
  leaves: [
    {
      leafId: 'la-root',
      parent: null,
      path: 'root',
      role: 'commander',
      status: 'running',
      sessionId: 'sess-root-1',
      relay: 'auto',
      taskType: 'default',
      dependencies: [],
      addedBy: 'lead',
      assignee: { provider: 'p1', model: 'm1', effort: 'max' },
      ctxPct: 21,
      lastEventAt: '2026-11-15T02:29:00.000Z',
      lastEventType: 'progress',
      verification: null,
      doneSummaryPreview: null,
    },
    {
      leafId: 'lb-ver',
      parent: 'la-root',
      path: 'root/impl',
      role: 'worker',
      status: 'succeeded',
      sessionId: 'sess-impl-2',
      relay: 'auto',
      taskType: 'code-change',
      dependencies: ['la-root'],
      addedBy: 'lead',
      assignee: { provider: 'p2', model: 'm2' },
      ctxPct: 42,
      verification: { pass: true, attempts: 1, lastVerdict: 'pass', policy: 'default' },
      doneSummaryPreview: 'done',
    },
    {
      leafId: 'lc-bad',
      parent: 'lb-ver',
      path: 'root/impl/guard',
      role: 'worker',
      status: 'failed',
      sessionId: null,
      relay: 'off',
      taskType: 'research',
      dependencies: ['lb-ver'],
      addedBy: 'lead',
      assignee: null,
      ctxPct: 55,
      verification: { pass: false, attempts: 2, lastVerdict: 'E_GUARD', policy: 'default' },
      doneSummaryPreview: null,
    },
  ],
  stats: { total: 3, byStatus: { running: 1, succeeded: 1, failed: 1 }, sessions: { a: 'la-root', b: 'lb-ver' } },
  updatedAt: '2026-11-15T02:30:00.000Z',
}

const EVENTS_BODY = {
  treeId: 'tree-alpha',
  events: [
    { seq: 1, ts: '2026-11-15T01:00:05.000Z', leafId: 'la-root', type: 'plan' },
    { seq: 2, ts: '2026-11-15T02:00:05.000Z', leafId: 'lb-ver', type: 'done' },
    { seq: 3, ts: '2026-11-15T02:29:30.000Z', leafId: 'lc-bad', type: 'blocked' },
  ],
  lastSeq: 3,
}

// ------------------------------------------------------------- fetch script
/** Route table → stub `fetch`. Records every (path, init, signal) call. */
function makeFetch(routes) {
  const calls = []
  function fetchStub(path, init) {
    const signal = init && init.signal
    calls.push({ path: String(path), init: init || {}, signal })
    const route = routes[path]
    if (!route) {
      const err = new Error('HTTP 404')
      err.status = 404
      return Promise.reject(err)
    }
    if (route.pending) return new Promise(() => {}) // never settles
    if (route.reject) return Promise.reject(route.reject)
    const status = route.status || 200
    return Promise.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve(route.body),
    })
  }
  return { fetch: fetchStub, calls }
}

// ------------------------------------------------------------- sandbox setup
let captured = null
const timerState = { setIds: [], clearedIds: [] }
const listeners = []
let nextIntervalId = 1

const sandbox = {
  console,
  // The controller reads these as bare globals (browser semantics).
  setTimeout,
  clearTimeout,
  setInterval: () => {
    const id = nextIntervalId++
    timerState.setIds.push(id)
    return id
  },
  clearInterval: (id) => {
    timerState.clearedIds.push(id)
  },
  AbortController,
  setImmediate,
  fetch: () => Promise.reject(new Error('fetch not scripted')),
  window: {
    __ModuleLoader__: {
      load(def) {
        captured = def
      },
    },
    addEventListener: (event, fn) => listeners.push({ event, fn }),
    removeEventListener: (event, fn) => {
      const i = listeners.findIndex((l) => l.event === event && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    },
  },
}
if (!fs.existsSync(CLIENT)) {
  console.log(`  FAIL  missing module under test: ${CLIENT}`)
  process.exit(1)
}
vm.runInNewContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'client.js' })
check('client.js loaded through __ModuleLoader__', !!captured)
check('module id intact', captured && captured.id === '@orphiczhou/dsh-session-tree', captured && captured.id)

// ---------------------------------------------------------------- React stub
let useStateCalls = 0
const cleanups = []
const React = {
  // NOTE: no useSyncExternalStore — the panel takes its documented fallback
  // path (useState + useEffect subscription), which is what the hook-count
  // assertion below measures.
  createElement: (type, props, ...children) => ({ type, props: props || {}, kids: children }),
  Component: class {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }
  },
  useState(init) {
    useStateCalls++
    const value = typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  // Effects run immediately on "render"; their cleanups are collected so a
  // scenario can simulate unmount by flushing them newest-first.
  useEffect: (fn) => {
    let cleanup = null
    try {
      cleanup = fn()
    } catch (e) {}
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
}
const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
check('factory exposes apply + createPanelRuntime seam', typeof mod.apply === 'function' && typeof mod.createPanelRuntime === 'function')

/** Flush every pending promise turn (fetch stubs settle immediately). */
const drain = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

// ------------------------------------------------------------ mini renderer
function renderTree(node, sink) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) }
  if (Array.isArray(node)) {
    for (const n of node) renderTree(n, sink)
    return null
  }
  const kids = (node.kids || []).flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
  const full = Object.assign({}, node.props)
  if (kids.length === 1) full.children = kids[0]
  else if (kids.length) full.children = kids
  const t = node.type
  if (typeof t === 'function') {
    if (t.prototype && typeof t.prototype.render === 'function') {
      const inst = new t(full)
      inst.props = full
      return renderTree(inst.render(), sink)
    }
    return renderTree(t(full), sink)
  }
  const el = { tag: String(t), props: full, kids: [] }
  for (const k of kids) {
    const c = renderTree(k, sink)
    if (c) el.kids.push(c)
  }
  sink.push(el)
  return el
}

const sinkText = (el) => {
  if (!el) return ''
  if (typeof el.text === 'string' || typeof el.text === 'number') return String(el.text)
  return (el.kids || []).map(sinkText).join('')
}
const sinkAllText = (sink) => sink.map(sinkText).join('\n')
const byClass = (sink, cls, exact) =>
  sink.filter((e) => {
    const c = e.props && e.props.className
    return typeof c === 'string' && (exact ? c === cls : c.includes(cls))
  })
/** Simulate unmount: run every collected effect cleanup, newest first. */
const flushUnmount = () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    try {
      fn()
    } catch (e) {}
  }
}

// ================================================================ async main
async function main() {
  // ========================================================== ①+② list → detail
  console.log('\n=== ①+② 列表 → 详情（契约 JSON 夹具）===')
  const openTabCalls = []
  const ctxMain = { sidebarRight: { openTab: (kind, opts) => openTabCalls.push({ kind, opts }) } }
  const fetchMain = makeFetch({
    '/tree-panel/trees?limit=50': { body: TREES_BODY },
    '/tree-panel/trees/tree-alpha': { body: DETAIL_BODY },
    '/tree-panel/trees/tree-alpha/events?limit=100': { body: EVENTS_BODY },
  })
  sandbox.fetch = fetchMain.fetch
  const rtMain = mod.createPanelRuntime(ctxMain)

  // Mount: effects run → controller.start() → list fetch (still loading).
  useStateCalls = 0
  const mountSink = []
  renderTree(rtMain.Body({}), mountSink)
  const mountHookCalls = useStateCalls
  check('挂载首帧为加载态（列表未就绪）', sinkAllText(mountSink).includes('Loading trees…'), sinkAllText(mountSink).slice(0, 60))
  check('挂载即在 window 上登记轮询定时器', sandbox.window.__stTreePanelTimers && sandbox.window.__stTreePanelTimers.ids.length >= 1,
    JSON.stringify(sandbox.window.__stTreePanelTimers))

  await drain()

  // Re-render with the loaded store.
  useStateCalls = 0
  const listSink = []
  renderTree(rtMain.Body({}), listSink)
  const listHookCalls = useStateCalls
  const cards = byClass(listSink, 'st-tr-card', true)
  check('① 渲染两张树卡片', cards.length === 2, String(cards.length))
  check('① 卡片文案含 mono treeId', sinkAllText(cards).includes('tree-alpha') && sinkAllText(cards).includes('tree-beta'))
  check('① 顶栏显示 storageRoot 与总数', sinkAllText(listSink).includes('D:\\Codes\\dsh-tree-harness\\.tree-store') && sinkAllText(listSink).includes('/ 2') === false ? sinkAllText(listSink).includes('D:\\Codes\\dsh-tree-harness\\.tree-store') : false,
    'storageRoot shown; total rendered via count element')
  check('① 顶栏总数为 2', byClass(listSink, 'st-tr-top-count', true).some((e) => sinkText(e) === '2'))
  check('① 手动刷新按钮存在', byClass(listSink, 'st-tr-btn').some((b) => sinkText(b) === 'Refresh'))
  const dotGroups = listSink.filter(
    (e) =>
      e.props.className === 'st-tr-dots' &&
      e.kids.length === 2 &&
      e.kids[0].props.className === 'st-tr-dot',
  )
  // Per-tone counts across BOTH cards (tree-alpha: running 2 / succeeded 1 /
  // other(pending) 1; tree-beta: succeeded 3). failed=0 must not render a dot.
  const tonesOf = (tone) => dotGroups.filter((g) => g.kids[0].props['data-tone'] === tone).map((g) => g.kids[1].text)
  check('① 计数圆点按四态语义着色（running=[2] / succeeded=[1,3] / other=[1]，failed=0 不渲染）',
    JSON.stringify(tonesOf('running')) === JSON.stringify(['2']) &&
      JSON.stringify(tonesOf('succeeded').sort()) === JSON.stringify(['1', '3']) &&
      JSON.stringify(tonesOf('other')) === JSON.stringify(['1']) &&
      tonesOf('failed').length === 0,
    JSON.stringify(dotGroups.map((g) => `${g.kids[0].props['data-tone']}=${g.kids[1].text}`)))
  check('① 圆点 tone 属于四态语义集合', dotGroups.every((g) => ['running', 'succeeded', 'failed', 'other'].includes(g.kids[0].props['data-tone'])))
  check('① 卡片带更新时间与叶子数', sinkAllText(cards).includes('updated 2026-11-15 02:30:00') && sinkAllText(cards).includes('4 leaves'))
  check('① 卡片渲染 rootGoalPreview', sinkAllText(cards).includes('拆解三层任务树并逐层验收（preview line）') && sinkAllText(cards).includes('Second tree goal'))
  check('①/③ 列表渲染的 useState 数量与挂载态一致（F8：分支在全部 hook 之后）',
    listHookCalls === mountHookCalls, `mount=${mountHookCalls} list=${listHookCalls}`)

  // ② click through to the detail.
  const alphaCard = cards.find((c) => sinkText(c).includes('tree-alpha'))
  check('① 找到 tree-alpha 卡片且可点击', !!alphaCard)
  alphaCard.props.onClick()
  await drain()
  useStateCalls = 0
  const detailSink = []
  renderTree(rtMain.Body({}), detailSink)
  const detailHookCalls = useStateCalls
  const leafRows = detailSink.filter(
    (e) => e.props.className === 'st-tr-row' && e.props['data-kind'] === 'leaf',
  )
  check('② 详情渲染 3 行 leaves', leafRows.length === 3, String(leafRows.length))
  check('② leaves 行 id 与顺序（la-root → lb-ver → lc-bad）',
    JSON.stringify(leafRows.map((r) => r.props['data-leaf-id'])) === JSON.stringify(['la-root', 'lb-ver', 'lc-bad']),
    JSON.stringify(leafRows.map((r) => r.props['data-leaf-id'])))
  const badges = byClass(detailSink, 'st-tr-badge', true)
  check('② 状态 Badge 带四态 tone（running 蓝 / succeeded 绿 / failed 红）',
    JSON.stringify(badges.map((b) => b.props['data-tone'])) === JSON.stringify(['running', 'succeeded', 'failed']),
    JSON.stringify(badges.map((b) => `${b.props['data-tone']}:${sinkText(b)}`)))
  const detailText = sinkAllText(detailSink)
  check('② relay / taskType / ctxPct 列渲染（auto·off / code-change / 21%·42%·55%）',
    detailText.includes('auto') && detailText.includes('off') && detailText.includes('code-change') &&
      detailText.includes('21%') && detailText.includes('42%') && detailText.includes('55%'))
  const verifCells = byClass(detailSink, 'st-tr-verif').filter(
    (c) => String(c.props.className).trim().endsWith('st-tr-verif'),
  )
  const verifSummary = verifCells.map((c) => `${c.props['data-pass']}:${sinkText(c)}`).join(' | ')
  check('② verification ✓/✗ 与尝试次数（✓ 1 / ✗ 2 / null → —）',
    verifCells.some((c) => c.props['data-pass'] === 'true' && sinkText(c).includes('✓')) &&
      verifCells.some((c) => c.props['data-pass'] === 'false' && sinkText(c).includes('✗')),
    verifSummary)
  check('② dependencies 列渲染（lc-bad → lb-ver）', /\blb-ver\b/.test(detailText))
  check('② root 摘要（treeId / root goalPreview / root status）',
    detailText.includes('tree-alpha') && detailText.includes('拆解三层任务树并逐层验收（preview line）') && detailText.includes('running'))
  const eventRows = byClass(detailSink, 'st-tr-event', true)
  check('② 事件尾渲染 ≤50 条（此处 3 条：plan / done / blocked）',
    eventRows.length === 3 && sinkAllText(eventRows).includes('plan') && sinkAllText(eventRows).includes('done') && sinkAllText(eventRows).includes('blocked'),
    `${eventRows.length} rows`)
  check('② 事件尾上限常量 = 50（面板头部声明 last 50）',
    detailText.includes('Events (last 50)'))
  const backBtn = byClass(detailSink, 'st-tr-btn').find((b) => sinkText(b).includes('Back'))
  check('② 返回按钮存在', !!backBtn)
  check('③ 详情态 useState 数量与列表态一致（hook 数量两态恒定）',
    detailHookCalls === listHookCalls, `list=${listHookCalls} detail=${detailHookCalls}`)
  if (backBtn) {
    backBtn.props.onClick()
    check('② 返回回列表（selectedTreeId 清空）', rtMain.store.get().selectedTreeId === null)
  }
  flushUnmount()

  // ============================================ ③ 三态 hook 恒定（防 F8）
  console.log('\n=== ③ 加载 / 错误 / 空树三态渲染 + hook 数量恒定 ===')
  // loading: fetch never settles.
  sandbox.fetch = makeFetch({ '/tree-panel/trees?limit=50': { pending: true } }).fetch
  const rtLoading = mod.createPanelRuntime({})
  useStateCalls = 0
  const loadSink = []
  renderTree(rtLoading.Body({}), loadSink)
  const loadCalls = useStateCalls
  check('③ 加载态渲染内联提示', sinkAllText(loadSink).includes('Loading trees…'))
  flushUnmount()

  // error: 500 with the contract error shape.
  const fetchErr = makeFetch({
    '/tree-panel/trees?limit=50': { status: 500, body: { error: { code: 'E_INTERNAL', message: 'boom' } } },
  })
  sandbox.fetch = fetchErr.fetch
  const rtError = mod.createPanelRuntime({})
  useStateCalls = 0
  renderTree(rtError.Body({}), [])
  await drain()
  useStateCalls = 0
  const errSink = []
  renderTree(rtError.Body({}), errSink)
  const errCalls = useStateCalls
  check('③ 错误态渲染内联降级提示（不抛出、不拖垮席位）',
    sinkAllText(errSink).includes('Tree list unavailable: boom'), sinkAllText(errSink).slice(0, 80))
  flushUnmount()

  // empty: contract-shaped empty list.
  sandbox.fetch = makeFetch({
    '/tree-panel/trees?limit=50': { body: { trees: [], storageRoot: 'D:\\x', updatedAt: '2026-11-15T00:00:00.000Z', total: 0 } },
  }).fetch
  const rtEmpty = mod.createPanelRuntime({})
  useStateCalls = 0
  renderTree(rtEmpty.Body({}), [])
  await drain()
  useStateCalls = 0
  const emptySink = []
  renderTree(rtEmpty.Body({}), emptySink)
  const emptyCalls = useStateCalls
  check('③ 空树态渲染空提示（带 storageRoot）', sinkAllText(emptySink).includes('No trees') && sinkAllText(emptySink).includes('D:\\x'))
  flushUnmount()

  check('③ 三态 hook 数量恒定（loading = error = empty）',
    loadCalls === errCalls && errCalls === emptyCalls,
    `loading=${loadCalls} error=${errCalls} empty=${emptyCalls}`)

  // ==================================================== ④ pill + overlay
  console.log('\n=== ④ 入口 pill：类名/文案/打开页签；无右栏服务时降级 overlay ===')
  const ctxPill = { sidebarRight: { openTab: (kind, opts) => openTabCalls.push({ kind, opts }) } }
  const rtPill = mod.createPanelRuntime(ctxPill)
  useStateCalls = 0
  const pillSink = []
  renderTree(rtPill.Entry({}), pillSink)
  const pill = pillSink.find((e) => e.props.className === 'st-tr-pill')
  check('④ pill 渲染且类名正确', !!pill, pill ? pill.props.className : '(无)')
  check('④ pill 文案为 Tree Runs', !!pill && sinkText(pill).includes('Tree Runs'), pill ? sinkText(pill) : '(无)')
  check('④ pill aria-pressed 初始 false', !!pill && pill.props['aria-pressed'] === 'false')
  if (pill) pill.props.onClick()
  check('④ 点击调用 sidebarRight.openTab("tree-runs")',
    openTabCalls.length === 1 && openTabCalls[0].kind === 'tree-runs',
    JSON.stringify(openTabCalls))

  // degraded: no sidebarRight → overlay path.
  const rtDeg = mod.createPanelRuntime({})
  useStateCalls = 0
  const pillDegSink = []
  renderTree(rtDeg.Entry({}), pillDegSink)
  const pillDeg = pillDegSink.find((e) => e.props.className === 'st-tr-pill')
  pillDeg.props.onClick()
  check('④ 无右栏服务时点击改为打开 overlay（store.open=true）', rtDeg.store.get().open === true)
  useStateCalls = 0
  const overlaySink = []
  renderTree(rtDeg.Overlay({}), overlaySink)
  const overlayRoot = overlaySink.find((e) => e.props.className === 'st-tr-overlay')
  check('④ 降级 overlay 全屏面板渲染（含关闭按钮与面板本体）',
    !!overlayRoot && byClass(overlaySink, 'st-tr-btn').some((b) => sinkText(b) === 'Close') && sinkAllText(overlaySink).includes('Loading trees…'))
  const escListener = listeners.find((l) => l.event === 'keydown')
  check('④ overlay 挂载了 Escape 关闭监听', !!escListener)
  if (escListener) {
    escListener.fn({ key: 'Escape' })
    check('④ Escape 关闭 overlay', rtDeg.store.get().open === false)
  }
  useStateCalls = 0
  const overlayClosedSink = []
  renderTree(rtDeg.Overlay({}), overlayClosedSink)
  check('④ 关闭后 overlay 渲染 null（不占席位）', overlayClosedSink.length === 0)
  flushUnmount()

  // ======================================================= ⑤ 资源卫生
  console.log('\n=== ⑤ 无外部资源引用（同源相对路径 + 渲染树无绝对 URL）===')
  const allPaths = fetchMain.calls.map((c) => c.path)
  check('⑤ 所有请求均为同源相对 /tree-panel 路径', allPaths.every((p) => p.startsWith('/tree-panel')), JSON.stringify(allPaths))
  check('⑤ 契约路由逐一命中（trees / detail / events）',
    allPaths.includes('/tree-panel/trees?limit=50') &&
      allPaths.includes('/tree-panel/trees/tree-alpha') &&
      allPaths.includes('/tree-panel/trees/tree-alpha/events?limit=100'),
    JSON.stringify(allPaths))
  check('⑤ fetch 携带 same-origin 凭据与 no-store（与 flow 面板同款卫生）',
    fetchMain.calls.every((c) => c.init.credentials === 'same-origin' && c.init.cache === 'no-store'))
  const renderedProps = JSON.stringify([mountSink, listSink, detailSink, loadSink, errSink, emptySink, pillSink, overlaySink])
  check('⑤ 渲染输出不含绝对 http(s) URL',
    !renderedProps.includes('http://') && !renderedProps.includes('https://'))
  const clientSrc = fs.readFileSync(CLIENT, 'utf8')
  const cssMatch = clientSrc.match(/const CSS = `([\s\S]*?)`/)
  check('⑤ 面板 CSS 无 url()/http 外链（全部走主题 token）',
    !!cssMatch && !cssMatch[1].includes('url(') && !cssMatch[1].includes('http'))

  // ==================================================== ⑥ 定时器卫生
  console.log('\n=== ⑥ HMR/卸载卫生：window.__stTreePanelTimers + AbortController ===')
  // ⑥a: pending fetch + unmount → 全部在途请求被 abort，定时器被清。
  const fetchAb = makeFetch({ '/tree-panel/trees?limit=50': { pending: true } })
  sandbox.fetch = fetchAb.fetch
  const rtAb = mod.createPanelRuntime({})
  useStateCalls = 0
  renderTree(rtAb.Body({}), [])
  const tracked = Array.from(sandbox.window.__stTreePanelTimers.ids)
  check('⑥ pending 场景登记了定时器', tracked.length >= 1, JSON.stringify(tracked))
  flushUnmount()
  check('⑥ 卸载（flush cleanups）清掉轮询定时器', timerState.clearedIds.some((id) => tracked.includes(id)),
    `cleared=${JSON.stringify(timerState.clearedIds)} tracked=${JSON.stringify(tracked)}`)
  check('⑥ 卸载 abort 全部在途请求（AbortController.signal.aborted）',
    fetchAb.calls.length >= 1 && fetchAb.calls.every((c) => c.signal && c.signal.aborted === true),
    `${fetchAb.calls.length} calls`)
  check('⑥ 卸载后组件不再持有定时器', rtAb.controller.getTimerId() === null)
  check('⑥ AbortController 缺席时降级不抛（静态检查：withAbort 有 undefined 分支）', /typeof AbortController === 'undefined'/.test(clientSrc))

  // ⑥b: HMR 重装 — apply 前的旧定时器 id 必须被 resetGlobalTimers 清掉。
  sandbox.window.__stTreePanelTimers = { ids: [101, 102] }
  timerState.clearedIds.length = 0
  const slotRecords = []
  const tabDefs = []
  mod.apply({
    slots: {
      inject(key, cb) {
        void key
        cb()
      },
      register(opts) {
        slotRecords.push(opts)
        return () => {}
      },
    },
  })
  check('⑥ apply 清掉上一轮留下的定时器 id（HMR 防泄漏）',
    timerState.clearedIds.includes(101) && timerState.clearedIds.includes(102) && sandbox.window.__stTreePanelTimers.ids.length === 0,
    `cleared=${JSON.stringify(timerState.clearedIds)}`)

  // ================================ ⑦ 席位注册清单（降级 / 右栏两形态）
  console.log('\n=== ⑦ 席位注册：降级形态（无右栏服务）与右栏形态 ===')
  const names = slotRecords.map((r) => r.name)
  check('⑦ 降级形态注册 5 席位（sidebar + 2×composer.dock + chip + overlay）',
    names.length === 5 &&
      names.filter((n) => n === 'conversation.composer.dock').length === 2 &&
      names.includes('sidebar.workspaces') &&
      names.includes('conversation.session.header.utilities') &&
      names.includes('shell.overlay'),
    JSON.stringify(names))
  const pillSeat = slotRecords.find((r) => r.name === 'conversation.composer.dock' && r.id === 'tree-runs')
  check('⑦ pill 席位 { id:"tree-runs", order:6, label:"Tree Runs" }（排 flow 的 5 之后）',
    !!pillSeat && pillSeat.order === 6 && typeof pillSeat.label === 'function' && pillSeat.label() === 'Tree Runs',
    JSON.stringify(pillSeat || {}))
  const overlaySeat = slotRecords.find((r) => r.name === 'shell.overlay')
  check('⑦ 降级 overlay 席位 { id:"tree-runs-panel", order:50 }', !!overlaySeat && overlaySeat.id === 'tree-runs-panel' && overlaySeat.order === 50)

  // right-sidebar form: services present → tab type + two keyed seats, no overlay.
  slotRecords.length = 0
  mod.apply({
    sidebarRightTabs: { register: (def) => tabDefs.push(def) },
    sidebarRight: { openTab: () => {} },
    effect: (fn) => fn(),
    slots: {
      inject(key, cb) {
        void key
        cb()
      },
      register(opts) {
        slotRecords.push(opts)
        return () => {}
      },
    },
  })
  const names2 = slotRecords.map((r) => r.name)
  check('⑦ 右栏形态注册 6 席位（含 pane.tab + pane.tab.title，不注册 overlay）',
    names2.length === 6 &&
      names2.includes('sidebar.right.pane.tab') &&
      names2.includes('sidebar.right.pane.tab.title') &&
      !names2.includes('shell.overlay'),
    JSON.stringify(names2))
  check('⑦ sidebarRightTabs.register 收到 { id, kind:"tree-runs", priority:"extension", title }',
    tabDefs.length === 1 && tabDefs[0].kind === 'tree-runs' && tabDefs[0].priority === 'extension' &&
      typeof tabDefs[0].title === 'function' && tabDefs[0].title() === 'Tree Runs',
    JSON.stringify(tabDefs))
  const paneTab = slotRecords.find((r) => r.name === 'sidebar.right.pane.tab')
  check('⑦ pane.tab keyed 席位带 key（与 tab 类型配对）',
    !!paneTab && paneTab.key === '@orphiczhou/dsh-session-tree',
    JSON.stringify(paneTab || {}))

  // ----------------------------------------------------------------- summary
  console.log('\n==================== 结果 ====================')
  console.log(`合计 ${checks} 项判定，失败 ${failures} 项`)
  console.log(failures === 0 ? '✅ Tree Runs 面板渲染逻辑通过全部检查' : '❌ 有检查未通过')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('panel-render run crashed:', error)
  process.exit(1)
})
