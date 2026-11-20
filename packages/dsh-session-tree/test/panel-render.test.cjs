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

// tree-beta detail: an empty tree (no leaves) exercised by the "switch
// selection" rewrite of the old back-button check (§6.3 处置 ②-2).
const DETAIL_BETA_BODY = {
  treeId: 'tree-beta',
  createdAt: '2026-11-15T00:10:00.000Z',
  updatedAt: '2026-11-15T00:40:00.000Z',
  root: { leafId: 'lb-root', status: 'succeeded', goalPreview: 'Second tree goal' },
  leaves: [],
  stats: { total: 0, byStatus: { succeeded: 3 }, sessions: {} },
  updatedAt: '2026-11-15T00:40:00.000Z',
}

const EVENTS_BETA_BODY = {
  treeId: 'tree-beta',
  events: [],
  lastSeq: 0,
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
const clipboardCalls = []
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
  // SessionCell's copy button goes through navigator.clipboard (V2-8).
  navigator: {
    clipboard: {
      writeText: (text) => {
        clipboardCalls.push(String(text))
        return Promise.resolve()
      },
    },
  },
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
// hookCalls counts BOTH useState and useRef invocations: the detail render
// must add exactly TreeGraph's zoom-state + viewport-ref pair (GRAPH_HOOKS=2,
// formula B / V2-12), which a useState-only counter cannot observe.
let hookCalls = 0
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
    hookCalls++
    const value = typeof init === 'function' ? init() : init
    return [value, () => {}]
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => {
    hookCalls++
    return { current: init }
  },
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
/** All host elements inside `el` (excluding `el` itself), document order. */
const descendants = (el, out) => {
  out = out || []
  for (const k of el.kids || []) {
    if (k && k.tag) {
      out.push(k)
      descendants(k, out)
    }
  }
  return out
}
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
    '/tree-panel/trees/tree-beta': { body: DETAIL_BETA_BODY },
    '/tree-panel/trees/tree-beta/events?limit=100': { body: EVENTS_BETA_BODY },
  })
  sandbox.fetch = fetchMain.fetch
  const rtMain = mod.createPanelRuntime(ctxMain)

  // Mount: effects run → controller.start() → list fetch (still loading).
  hookCalls = 0
  const mountSink = []
  renderTree(rtMain.Body({}), mountSink)
  const mountHookCalls = hookCalls
  check('挂载首帧为加载态（列表未就绪）', sinkAllText(mountSink).includes('Loading trees…'), sinkAllText(mountSink).slice(0, 60))
  check('挂载即在 window 上登记轮询定时器', sandbox.window.__stTreePanelTimers && sandbox.window.__stTreePanelTimers.ids.length >= 1,
    JSON.stringify(sandbox.window.__stTreePanelTimers))

  await drain()

  // Re-render with the loaded store.
  hookCalls = 0
  const listSink = []
  renderTree(rtMain.Body({}), listSink)
  const listHookCalls = hookCalls
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
  // §6.3 处置 ①-1 (rewrite): the preview moved out of the card body — it now
  // rides the button's `title` attribute ("treeId — preview").
  check('① 卡片 title 属性携带 rootGoalPreview',
    cards.some((c) => String(c.props.title || '').includes('拆解三层任务树并逐层验收（preview line）')) &&
      cards.some((c) => String(c.props.title || '').includes('Second tree goal')),
    JSON.stringify(cards.map((c) => c.props.title)))
  check('①/③ 列表渲染的 useState 数量与挂载态一致（F8：分支在全部 hook 之后）',
    listHookCalls === mountHookCalls, `mount=${mountHookCalls} list=${listHookCalls}`)

  // ② click through to the detail.
  const alphaCard = cards.find((c) => sinkText(c).includes('tree-alpha'))
  check('① 找到 tree-alpha 卡片且可点击', !!alphaCard)
  alphaCard.props.onClick()
  // selected-but-loading state (fourth state of formula A / V2-11): the
  // detail fetch is in flight, the right pane must show the loading note.
  hookCalls = 0
  const selLoadSink = []
  renderTree(rtMain.Body({}), selLoadSink)
  const selLoadCalls = hookCalls
  await drain()
  hookCalls = 0
  const detailSink = []
  renderTree(rtMain.Body({}), detailSink)
  const detailHookCalls = hookCalls
  // Captured BEFORE the beta switch below (V2-4 asserts the alpha selection).
  const selectedAtAlpha = rtMain.store.get().selectedTreeId
  const leafRows = detailSink.filter(
    (e) => e.props.className === 'st-tr-row' && e.props['data-kind'] === 'leaf',
  )
  check('② 详情渲染 3 行 leaves', leafRows.length === 3, String(leafRows.length))
  check('② leaves 行 id 与顺序（la-root → lb-ver → lc-bad）',
    JSON.stringify(leafRows.map((r) => r.props['data-leaf-id'])) === JSON.stringify(['la-root', 'lb-ver', 'lc-bad']),
    JSON.stringify(leafRows.map((r) => r.props['data-leaf-id'])))
  // v2: the split pane also renders the two list cards, so scope the badge
  // assertion to the leaf rows (v1 collected the whole sink).
  const leafBadges = leafRows.flatMap((r) => descendants(r).filter((e) => e.props.className === 'st-tr-badge'))
  check('② 状态 Badge 带四态 tone（running 蓝 / succeeded 绿 / failed 红）',
    JSON.stringify(leafBadges.map((b) => b.props['data-tone'])) === JSON.stringify(['running', 'succeeded', 'failed']),
    JSON.stringify(leafBadges.map((b) => `${b.props['data-tone']}:${sinkText(b)}`)))
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
  // §6.3 处置 ②（删除 1 + 改写 1）：Back 按钮已删（V2-15 反向守卫）；
  // 「返回回列表」改写为「点另一卡切换选中，详情随之刷新」——分栏同屏
  // 无返回概念，selectedTreeId 常驻只换目标。
  check('② V2-15 无 ← Back 按钮（删除项回归守卫）',
    !byClass(detailSink, 'st-tr-btn').some((b) => sinkText(b).includes('Back')))
  const betaCard = byClass(detailSink, 'st-tr-card', true).find((c) => sinkText(c).includes('tree-beta'))
  betaCard.props.onClick()
  await drain()
  const betaSink = []
  renderTree(rtMain.Body({}), betaSink)
  check('② 点另一卡切换选中（selectedTreeId 更新且详情随之刷新）',
    rtMain.store.get().selectedTreeId === 'tree-beta' && sinkAllText(betaSink).includes('No leaves recorded.'),
    `selected=${rtMain.store.get().selectedTreeId} betaRoutes=${JSON.stringify(fetchMain.calls.map((c) => c.path).filter((p) => p.includes('tree-beta')))}`)
  flushUnmount()

  // ============================================ ③ 三态 hook 恒定（防 F8）
  console.log('\n=== ③ 加载 / 错误 / 空树三态渲染 + hook 数量恒定 ===')
  // loading: fetch never settles.
  sandbox.fetch = makeFetch({ '/tree-panel/trees?limit=50': { pending: true } }).fetch
  const rtLoading = mod.createPanelRuntime({})
  hookCalls = 0
  const loadSink = []
  renderTree(rtLoading.Body({}), loadSink)
  const loadCalls = hookCalls
  check('③ 加载态渲染内联提示', sinkAllText(loadSink).includes('Loading trees…'))
  flushUnmount()

  // error: 500 with the contract error shape.
  const fetchErr = makeFetch({
    '/tree-panel/trees?limit=50': { status: 500, body: { error: { code: 'E_INTERNAL', message: 'boom' } } },
  })
  sandbox.fetch = fetchErr.fetch
  const rtError = mod.createPanelRuntime({})
  hookCalls = 0
  renderTree(rtError.Body({}), [])
  await drain()
  hookCalls = 0
  const errSink = []
  renderTree(rtError.Body({}), errSink)
  const errCalls = hookCalls
  check('③ 错误态渲染内联降级提示（不抛出、不拖垮席位）',
    sinkAllText(errSink).includes('Tree list unavailable: boom'), sinkAllText(errSink).slice(0, 80))
  flushUnmount()

  // empty: contract-shaped empty list.
  sandbox.fetch = makeFetch({
    '/tree-panel/trees?limit=50': { body: { trees: [], storageRoot: 'D:\\x', updatedAt: '2026-11-15T00:00:00.000Z', total: 0 } },
  }).fetch
  const rtEmpty = mod.createPanelRuntime({})
  hookCalls = 0
  renderTree(rtEmpty.Body({}), [])
  await drain()
  hookCalls = 0
  const emptySink = []
  renderTree(rtEmpty.Body({}), emptySink)
  const emptyCalls = hookCalls
  check('③ 空树态渲染空提示（带 storageRoot）', sinkAllText(emptySink).includes('No trees') && sinkAllText(emptySink).includes('D:\\x'))
  flushUnmount()

  check('③ 三态 hook 数量恒定（loading = error = empty）',
    loadCalls === errCalls && errCalls === emptyCalls,
    `loading=${loadCalls} error=${errCalls} empty=${emptyCalls}`)

  // ================================== V2 判定（DESIGN §6.1，15 条）
  console.log('\n=== V2 面板 v2 判定：分栏 / 卡片 / 图 / 第 8 列 / 缩放常量 / hook 公式 ===')
  // V2-1 分栏两区并存：.st-tr2-body 直接子区恰为 list + detail。
  const bodyEl = byClass(listSink, 'st-tr2-body', true)[0]
  const listRegion = byClass(listSink, 'st-tr2-list', true)
  const detailRegion = byClass(listSink, 'st-tr2-detail', true)
  check('V2-1 分栏同屏：list+detail 两区并存且 body 直接子区恰 2',
    listRegion.length >= 1 && detailRegion.length >= 1 &&
      !!bodyEl && bodyEl.kids.length === 2 &&
      bodyEl.kids[0].props.className === 'st-tr2-list' &&
      bodyEl.kids[1].props.className === 'st-tr2-detail',
    `list=${listRegion.length} detail=${detailRegion.length} bodyKids=${bodyEl ? bodyEl.kids.length : 'n/a'}`)
  // V2-2 卡片行 1（mono id + 四态 badge）与行 2（meta：leaves / updated）。
  const alphaCardEl = cards.find((c) => sinkText(c).includes('tree-alpha'))
  const alphaKids = alphaCardEl ? descendants(alphaCardEl) : []
  const alphaBadge = alphaKids.find((e) => e.props.className === 'st-tr-badge')
  const alphaMeta = alphaKids.find((e) => e.props.className === 'st-tr-meta')
  check('V2-2 卡片行 1 mono id+badge（tone∈四态），行 2 meta 含 4 leaves 与 updated 时间',
    !!alphaKids.find((e) => String(e.props.className || '').includes('st-tr-mono') && String(e.props.className || '').includes('st-tr-card-id')) &&
      !!alphaBadge && ['running', 'succeeded', 'failed', 'other'].includes(alphaBadge.props['data-tone']) &&
      !!alphaMeta && sinkText(alphaMeta).includes('4 leaves') && sinkText(alphaMeta).includes('updated 2026-11-15 02:30:00'),
    alphaMeta ? sinkText(alphaMeta) : '(无 meta)')
  // V2-3 treeStatusOf 直断言 + 卡片 Badge 文本。设计原文断 alpha=failed，
  // 但冻结夹具 counts={failed:0,...} 按 §2.5 规则派生为 running —— 有意
  // 偏离已记录（实现与测试都严格按 §2.5 规则）。
  check('V2-3 treeStatusOf 派生（failed 优先 / running / succeeded / pending）+ 卡片 Badge 文本',
    mod.treeStatusOf({ failed: 1, running: 2 }) === 'failed' &&
      mod.treeStatusOf({ running: 2, succeeded: 1 }) === 'running' &&
      mod.treeStatusOf({ succeeded: 3 }) === 'succeeded' &&
      mod.treeStatusOf({ pending: 1 }) === 'pending' &&
      // v1.6.2 收敛：失败类多键（timeout/cancelled/error）也算 failed；pruned 是终态不算在跑。
      mod.treeStatusOf({ timeout: 1 }) === 'failed' &&
      mod.treeStatusOf({ cancelled: 1, succeeded: 2 }) === 'failed' &&
      mod.treeStatusOf({ pruned: 2, succeeded: 1 }) === 'succeeded' &&
      mod.treeStatusOf({ pruned: 3 }) === 'pending' &&
      alphaBadge && sinkText(alphaBadge) === 'running' &&
      (() => {
        const betaEl = cards.find((c) => sinkText(c).includes('tree-beta'))
        const b = betaEl ? descendants(betaEl).find((e) => e.props.className === 'st-tr-badge') : null
        return !!b && sinkText(b) === 'succeeded'
      })(),
    `alpha=${alphaBadge ? sinkText(alphaBadge) : '(无)'} beta=${mod.treeStatusOf(TREES_BODY.trees[1].counts)}`)
  // V2-4 选中语义：data-selected 双卡对照 + 详情 3 行 leaves。
  const selCards = byClass(detailSink, 'st-tr-card', true)
  const selAlpha = selCards.find((c) => sinkText(c).includes('tree-alpha'))
  const selBeta = selCards.find((c) => sinkText(c).includes('tree-beta'))
  check('V2-4 选中卡片 data-selected=true、其余 false、详情 3 行 leaves',
    selectedAtAlpha === 'tree-alpha' &&
      selCards.length === 2 && !!selAlpha && !!selBeta &&
      selAlpha.props['data-selected'] === 'true' &&
      selBeta.props['data-selected'] === 'false' &&
      leafRows.length === 3,
    `selectedAtAlpha=${selectedAtAlpha} ` + JSON.stringify(selCards.map((c) => `${sinkText(c).slice(0, 10)}:${c.props['data-selected']}`)))
  // V2-5 两个空态文案 + st-tr2-empty 容器类。分栏同屏下空树态渲染时右区
  // 也会出现未选中空态，故按「该文案元素自身的类」断言而非计数。
  check('V2-5 未选中详情空态与列表空树态（st-tr2-empty）',
    sinkAllText(listSink).includes('Select a tree on the left to view read-only detail') &&
      byClass(listSink, 'st-tr2-empty', true).some((e) => sinkText(e).includes('Select a tree on the left')) &&
      sinkAllText(emptySink).includes('No trees (storage root: D:\\x).') &&
      byClass(emptySink, 'st-tr2-empty', true).some((e) => sinkText(e).includes('No trees (storage root: D:\\x).')),
    `empty texts=${JSON.stringify(byClass(emptySink, 'st-tr2-empty', true).map((e) => sinkText(e).slice(0, 34)))}`)
  // V2-6 图节点恰 3 且序为 la-root / lb-ver / lc-bad。
  const nodes = byClass(detailSink, 'st-tr2-node', true)
  check('V2-6 图节点恰 3 且序为 la-root/lb-ver/lc-bad',
    nodes.length === 3 && JSON.stringify(nodes.map((n) => n.props['data-leaf-id'])) === JSON.stringify(['la-root', 'lb-ver', 'lc-bad']),
    JSON.stringify(nodes.map((n) => n.props['data-leaf-id'])))
  // V2-7 依赖边恰 2、方向=依赖→后继（data-from=依赖方，锚点决策）、全 decl。
  const edges = byClass(detailSink, 'st-tr2-edge', true)
  check('V2-7 依赖边恰 2（la-root→lb-ver、lb-ver→lc-bad）且全为 decl',
    edges.length === 2 &&
      JSON.stringify(edges.map((e) => e.props['data-from'] + '→' + e.props['data-to'])) === JSON.stringify(['la-root→lb-ver', 'lb-ver→lc-bad']) &&
      edges.every((e) => e.props['data-state'] === 'decl'),
    JSON.stringify(edges.map((e) => `${e.props['data-from']}→${e.props['data-to']}(${e.props['data-state']})`)))
  // V2-8 第 8 列 Session：lb-ver 有 mono id+Copy（写剪贴板），lc-bad 为 —。
  // NOTE: SessionCell returns an ARRAY, which the mini renderer hoists to the
  // sink root (its host cells are not row.kids descendants) — and the renderer
  // pushes a host element AFTER its children, so a row's hoisted cells sit
  // between the PREVIOUS st-tr-row element and the row itself.
  const rowSlice = (row) => {
    const i = detailSink.indexOf(row)
    let p = -1
    for (let k = 0; k < i; k++) {
      if (detailSink[k].props.className === 'st-tr-row') p = k
    }
    return detailSink.slice(p + 1, i)
  }
  const headRowEl = detailSink.find((e) => e.props.className === 'st-tr-row' && e.props['data-kind'] === 'head')
  const rowLb = leafRows.find((r) => r.props['data-leaf-id'] === 'lb-ver')
  const rowLc = leafRows.find((r) => r.props['data-leaf-id'] === 'lc-bad')
  const lbSlice = rowLb ? rowSlice(rowLb) : []
  const lcSlice = rowLc ? rowSlice(rowLc) : []
  const lbText = lbSlice.map(sinkText).join('')
  const copyBtn = lbSlice.find((e) => String(e.props.className || '').includes('st-tr2-copybtn'))
  clipboardCalls.length = 0
  if (copyBtn) copyBtn.props.onClick({ currentTarget: { textContent: 'Copy' } })
  check('V2-8 第 8 列 Session：lb-ver mono id+Copy（点击写剪贴板）、lc-bad 为 — 无按钮',
    !!headRowEl && headRowEl.kids.length === 8 && sinkText(headRowEl.kids[7]) === 'Session' &&
      lbText.includes('sess-impl-2') && !!copyBtn && clipboardCalls.includes('sess-impl-2') &&
      lcSlice.map(sinkText).join('').includes('—') &&
      !lcSlice.some((e) => String(e.props.className || '').includes('st-tr2-copybtn')),
    `clipboard=${JSON.stringify(clipboardCalls)} lbText=${lbText.slice(0, 40)}`)
  // V2-9 缩放常量与 3 节点链布局尺寸。
  const chainLayout = mod.treeGraphLayout(
    [
      { leafId: 'n1', status: 'succeeded', dependencies: [] },
      { leafId: 'n2', status: 'succeeded', dependencies: ['n1'] },
      { leafId: 'n3', status: 'succeeded', dependencies: ['n2'] },
    ],
    'n1',
  )
  check('V2-9 clampZoom 0.1→0.25 / 9→2.5 / 1→1、ZOOM_STEP=1.12、3 节点链布局 752×80',
    mod.clampZoom(0.1) === 0.25 && mod.clampZoom(9) === 2.5 && mod.clampZoom(1) === 1 && mod.ZOOM_STEP === 1.12 &&
      chainLayout.graphW === 752 && chainLayout.graphH === 80,
    `clamp=[${mod.ZOOM_MIN},${mod.ZOOM_MAX}] step=${mod.ZOOM_STEP} chain=${chainLayout.graphW}×${chainLayout.graphH}`)
  // V2-10 根节点标记 data-root=true（其余 false）。
  check('V2-10 根节点 data-root=true（其余 false）',
    nodes.some((n) => n.props['data-leaf-id'] === 'la-root' && n.props['data-root'] === 'true') &&
      nodes.every((n) => (n.props['data-root'] === 'true') === (n.props['data-leaf-id'] === 'la-root')),
    JSON.stringify(nodes.map((n) => `${n.props['data-leaf-id']}=${n.props['data-root']}`)))
  // V2-13 lc-bad 节点 data-status=failed。
  const lcNode = nodes.find((n) => n.props['data-leaf-id'] === 'lc-bad')
  check('V2-13 lc-bad 节点 data-status=failed',
    !!lcNode && lcNode.props['data-status'] === 'failed',
    lcNode ? String(lcNode.props['data-status']) : '(无节点)')
  // V2-14 事件行以 #seq 开头且 type 列带 st-tr-event-type。
  const v2Events = byClass(detailSink, 'st-tr-event', true)
  check('V2-14 事件行以 #1/#2/#3 开头且 type 列带 st-tr-event-type',
    v2Events.length === 3 &&
      [0, 1, 2].every((i) => sinkText(v2Events[i]).startsWith('#' + (i + 1))) &&
      v2Events.every((r) => r.kids.some((k) => k && k.tag && String(k.props.className || '').includes('st-tr-event-type'))),
    JSON.stringify(v2Events.map((r) => sinkText(r).slice(0, 4))))
  // V2-15 已在 ② 区断言（Back 按钮删除守卫），此处补 list 态反向守卫。
  check('V2-15 列表态同样无 ← Back 按钮',
    !byClass(listSink, 'st-tr-btn').some((b) => sinkText(b).includes('Back')))
  // V2-11 公式 A：四态 hook 恒定（加载=错误=空=选中加载）。
  check('V2-11 公式 A：加载=错误=空=选中加载 四态 hook 恒定',
    loadCalls === errCalls && errCalls === emptyCalls && emptyCalls === selLoadCalls,
    `loading=${loadCalls} error=${errCalls} empty=${emptyCalls} selLoading=${selLoadCalls}`)
  // V2-12 公式 B：详情渲染 hook 数 = 基态 + GRAPH_HOOKS(2)。
  check('V2-12 公式 B：详情渲染 hook 数 = 基态 + GRAPH_HOOKS(2)',
    detailHookCalls === listHookCalls + 2, `base=${listHookCalls} detail=${detailHookCalls}`)
  // V2+ 补充护栏（设计 §3.2 环保护必须保留）：循环依赖有限轮收敛。
  check('V2+ 环保护：循环依赖布局有限轮收敛（不挂死、level 有界）', (() => {
    const cyc = [
      { leafId: 'c1', status: 'running', dependencies: ['c3'] },
      { leafId: 'c2', status: 'running', dependencies: ['c1'] },
      { leafId: 'c3', status: 'running', dependencies: ['c2'] },
    ]
    const l = mod.treeGraphLayout(cyc, 'c1')
    return l.nodes.length === 3 && l.nodes.every((n) => n.level >= 0 && n.level <= 3)
  })(), 'cycle settles within pass cap')

  // ============ ③b 分层/从属（parent 链）+ 点击节点看详情（v1.6.2, m01512）
  console.log('\n=== ③b 树链分层与从属 + 点击节点在下方看属性（v1.6.2）===')
  // The beta switch above (V2-4) left the store on tree-beta; the graph
  // snapshots above are alpha's. Re-select alpha so the selection detail
  // renders against the leaves the captured nodes belong to.
  sandbox.fetch = fetchMain.fetch // ③/empty scenarios replaced the stub; restore the main route table
  rtMain.controller.select('tree-alpha')
  await drain()
  // V2-16 从属边 = parent → child（服务端 parent 字段是权威从属关系）。
  const parentEdges = mod.treeParentEdgesOf(DETAIL_BODY.leaves)
  check('V2-16 treeParentEdgesOf 按 parent 造从属边（la-root→lb-ver、lb-ver→lc-bad）',
    JSON.stringify(parentEdges.map((e) => e.from + '→' + e.to)) ===
      JSON.stringify(['la-root→lb-ver', 'lb-ver→lc-bad']),
    JSON.stringify(parentEdges))
  // V2-17 分层改由 parent 链深度决定（la-root@0 / lb-ver@1 / lc-bad@2），
  // 无 parent 的旧投影仍回退到依赖分层（V2-9 已覆盖）。
  const hierLayout = mod.treeGraphLayout(DETAIL_BODY.leaves, 'la-root')
  check('V2-17 层级按 parent 链分层（la-root@0 / lb-ver@1 / lc-bad@2, hierarchy=true）',
    JSON.stringify(hierLayout.nodes.map((n) => n.leafId + '@' + n.level)) ===
      JSON.stringify(['la-root@0', 'lb-ver@1', 'lc-bad@2']) && hierLayout.hierarchy === true,
    JSON.stringify(hierLayout.nodes.map((n) => `${n.leafId}@${n.level}`)))
  // V2-18 重合的父子对只画一条实线（kind=parent）；依赖边仅在不重合时补虚线。
  const drawnEdges = mod.treeGraphEdgesOf(DETAIL_BODY.leaves)
  const mixedEdges = mod.treeGraphEdgesOf([
    { leafId: 'p', parent: null, status: 'running' },
    { leafId: 'a', parent: 'p', status: 'running' },
    { leafId: 'b', parent: 'p', dependencies: ['a'], status: 'pending' },
  ]).edges
  check('V2-18 重合对只画 parent 一条；纯依赖对保留 kind=dep 虚线',
    drawnEdges.edges.length === 2 && drawnEdges.edges.every((e) => e.kind === 'parent') &&
      mixedEdges.some((e) => e.kind === 'parent' && e.from === 'p' && e.to === 'a') &&
      mixedEdges.some((e) => e.kind === 'dep' && e.from === 'a' && e.to === 'b') &&
      !mixedEdges.some((e) => e.kind === 'dep' && e.from === 'p'),
    JSON.stringify(drawnEdges.edges) + ' | ' + JSON.stringify(mixedEdges))
  // V2-19 渲染侧：从属边实线（data-kind=parent 且无 strokeDasharray），依赖边虚线。
  const renderedPaths = edges
    .map((g) => g.kids.find((k) => k && k.tag === 'path'))
    .filter(Boolean)
  check('V2-19 渲染边为从属实线（data-kind=parent、无 dash、父→子）',
    edges.length === 2 && edges.every((g) => g.props['data-kind'] === 'parent') &&
      renderedPaths.length === 2 && renderedPaths.every((p) => p.props.strokeDasharray === undefined),
    JSON.stringify(edges.map((g) => g.props['data-kind'])))
  // V2-20 节点可点：全部挂 onClick（点击 → controller.selectLeaf）。
  check('V2-20 三个节点均挂 onClick 且 style.cursor=pointer',
    nodes.length === 3 && nodes.every((n) => typeof n.props.onClick === 'function') &&
      nodes.every((n) => n.props.style && n.props.style.cursor === 'pointer'))
  const lcClickNode = nodes.find((n) => n.props['data-leaf-id'] === 'lc-bad')
  lcClickNode.props.onClick({ stopPropagation: () => {} })
  check('V2-21 点击 lc-bad → store.selectedLeafId=lc-bad',
    rtMain.store.get().selectedLeafId === 'lc-bad', String(rtMain.store.get().selectedLeafId))
  hookCalls = 0
  const selSink = []
  renderTree(rtMain.Body({}), selSink)
  const selHookCalls = hookCalls
  const selText = sinkAllText(selSink)
  const selLeafGrid = selSink.filter((e) => e.props.className === 'st-tr2-fieldgrid st-tr2-leafgrid')
  const selNodes = byClass(selSink, 'st-tr2-node', true)
  const selRows = selSink.filter(
    (e) => e.props.className === 'st-tr-row' && e.props['data-kind'] === 'leaf',
  )
  const selLcNode = selNodes.find((n) => n.props['data-leaf-id'] === 'lc-bad')
  const selLcRow = selRows.find((r) => r.props['data-leaf-id'] === 'lc-bad')
  check('V2-22 选中后节点/行高亮 + 下方出现「Leaf attributes · lc-bad」全部属性',
    selText.includes('Leaf attributes · lc-bad') && selLeafGrid.length === 1 &&
      !!selLcNode && selLcNode.props['data-selected'] === 'true' &&
      !!selLcRow && selLcRow.props['data-selected'] === 'true' &&
      selNodes.filter((n) => n.props['data-selected'] === 'true').length === 1 &&
      selText.includes('Raw status') && selText.includes('Runtime') &&
      selText.includes('Verification') && selText.includes('Dependencies') &&
      selText.includes('Done summary'),
    selText.slice(0, 90))
  // V2-23 选中态不引入 hook：公式 B 仍成立。
  check('V2-23 选中态 hook 数 = 基态 + GRAPH_HOOKS(2)',
    selHookCalls === listHookCalls + 2, `base=${listHookCalls} selected=${selHookCalls}`)
  // V2-24 Clear 清空选中 → 回到可发现的提示文案。
  const clearBtn = byClass(selSink, 'st-tr2-graphbtn').find((b) => sinkText(b) === 'Clear')
  if (clearBtn) clearBtn.props.onClick()
  check('V2-24 Clear 点击后 selectedLeafId=null',
    !!clearBtn && rtMain.store.get().selectedLeafId === null)
  const clearedSink = []
  renderTree(rtMain.Body({}), clearedSink)
  check('V2-25 清空后显示「Click a node in the graph…」提示且无属性栅格',
    sinkAllText(clearedSink).includes('Click a node in the graph') &&
      clearedSink.filter((e) => e.props.className === 'st-tr2-fieldgrid st-tr2-leafgrid').length === 0)
  // V2-26 切树重置叶子选中（控制器 select 清 selectedLeafId）。
  rtMain.controller.select('tree-beta')
  await drain()
  check('V2-26 切树后 selectedLeafId 归零', rtMain.store.get().selectedLeafId === null,
    String(rtMain.store.get().selectedLeafId))
  // V2-27 脏数据：悬挂 parent / 自环 / 孤儿 / 双节点环 都能落位且不丢节点。
  const dirtyHier = mod.treeHierarchyOf(
    [
      { leafId: 'root', parent: null },
      { leafId: 'orphan', parent: 'ghost' },
      { leafId: 'self', parent: 'self' },
      { leafId: 'cyc-a', parent: 'cyc-b' },
      { leafId: 'cyc-b', parent: 'cyc-a' },
    ],
    'root',
  )
  check('V2-27 悬挂 parent/自环/孤儿/环 全部安全落位（root 深度 0、节点不丢）',
    dirtyHier.order.length === 5 && dirtyHier.order[0] === 'root' &&
      dirtyHier.level.get('root') === 0 && dirtyHier.level.get('orphan') === 0,
    JSON.stringify(dirtyHier.order))

  // ==================================================== ④ pill + overlay
  console.log('\n=== ④ 入口 pill：类名/文案/打开页签；无右栏服务时降级 overlay ===')
  const ctxPill = { sidebarRight: { openTab: (kind, opts) => openTabCalls.push({ kind, opts }) } }
  const rtPill = mod.createPanelRuntime(ctxPill)
  hookCalls = 0
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
  hookCalls = 0
  const pillDegSink = []
  renderTree(rtDeg.Entry({}), pillDegSink)
  const pillDeg = pillDegSink.find((e) => e.props.className === 'st-tr-pill')
  pillDeg.props.onClick()
  check('④ 无右栏服务时点击改为打开 overlay（store.open=true）', rtDeg.store.get().open === true)
  hookCalls = 0
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
  hookCalls = 0
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
  hookCalls = 0
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

  // ================== v1.7.0 判定：树级派生态徽标 / 版本标记 / 新鲜度
  // 用户反馈（m02442）：「为啥大多数列表中的树都是 runing 状态」「点击节点，
  // 下面的详细信息没有变化」。① 的根因是 root 容器叶永远 active（无 done 事
  // 件），旧徽标按 counts 派生 → 36 棵里 29 棵恒 running；现在徽标优先用服务
  // 端派生的 tree.state，counts 仅作回落。②/③ 的根因是渲染进程旧 bundle，
  // 故头部渲染构建版本号，与 package.json 逐字比对。
  console.log('\n=== v1.7.0 判定：树级派生态徽标 / 客户端版本标记 / 头部新鲜度 ===')
  check('V2-28 treeBadgeOf 优先 tree.state，缺失/空串时回落 treeStatusOf(counts)',
    mod.treeBadgeOf({ state: 'succeeded', counts: { running: 1 } }) === 'succeeded' &&
      mod.treeBadgeOf({ state: 'running', counts: { succeeded: 9, pruned: 1 } }) === 'running' &&
      mod.treeBadgeOf({ state: 'pending', counts: { succeeded: 5 } }) === 'pending' &&
      mod.treeBadgeOf({ state: '', counts: { running: 2, succeeded: 1 } }) === 'running' &&
      mod.treeBadgeOf({ counts: { succeeded: 3 } }) === 'succeeded' &&
      mod.treeBadgeOf({ counts: { failed: 1 } }) === 'failed' &&
      mod.treeBadgeOf({}) === 'pending' &&
      mod.treeBadgeOf(null) === 'pending' &&
      mod.treeBadgeOf('tree-alpha') === 'pending',
    `state-win=${mod.treeBadgeOf({ state: 'succeeded', counts: { running: 1 } })} ` +
      `fallback=${mod.treeBadgeOf({ counts: { running: 2 } })} empty=${mod.treeBadgeOf(null)}`)
  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const versionEls = byClass(listSink, 'st-tr2-version', true)
  check('V2-29 头部渲染客户端构建版本，且与 package.json version 逐字一致（旧 bundle 一眼可辨）',
    versionEls.length === 1 &&
      sinkText(versionEls[0]) === 'v' + pkgJson.version &&
      mod.PANEL_VERSION === pkgJson.version,
    `rendered=${versionEls.length === 1 ? sinkText(versionEls[0]) : '(无)'} pkg=v${pkgJson.version} const=v${mod.PANEL_VERSION}`)
  check('V2-30 头部新鲜度：页面级 updatedAt 缺失时取最新树戳（永不留 —）',
    mod.panelFreshnessOf({}, [{ updatedAt: '2026-11-15T02:30:00.000Z' }, { updatedAt: '2026-11-16T01:00:00.000Z' }]) === '2026-11-16T01:00:00.000Z' &&
      mod.panelFreshnessOf({}, [{ updatedAt: '2026-11-16T01:00:00.000Z' }, { updatedAt: '2026-11-15T02:30:00.000Z' }]) === '2026-11-16T01:00:00.000Z' &&
      mod.panelFreshnessOf({ updatedAt: '2026-11-14T00:00:00.000Z' }, [{ updatedAt: '2026-11-16T01:00:00.000Z' }]) === '2026-11-14T00:00:00.000Z' &&
      mod.panelFreshnessOf({ updatedAt: '' }, []) === null &&
      mod.panelFreshnessOf({}, null) === null &&
      mod.panelFreshnessOf(null, [{ updatedAt: '' }, { nope: 1 }]) === null,
    `pick=${mod.panelFreshnessOf({}, [{ updatedAt: '2026-11-15T02:30:00.000Z' }, { updatedAt: '2026-11-16T01:00:00.000Z' }])} empty=${mod.panelFreshnessOf({}, [])}`)
  // 详情字段栅格：Tree state（派生态标题）+ Leaf states（逐态计数）两行，
  // 不再有一个含义暧昧的 'Status' 行。
  const gridFields = byClass(detailSink, 'st-tr2-field', true)
  const fieldValueOf = (label) => {
    for (const field of gridFields) {
      const kids = descendants(field)
      const labelEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldlabel'))
      if (labelEl && sinkText(labelEl) === label) {
        const valueEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldvalue'))
        return valueEl ? sinkText(valueEl) : null
      }
    }
    return null
  }
  const treeStateValue = fieldValueOf('Tree state')
  const leafStatesValue = fieldValueOf('Leaf states')
  check('V2-31 详情栅格：Tree state 行（无 detail.state 时回落 counts 派生）+ Leaf states 行（逐态计数）',
    treeStateValue === 'failed' &&
      leafStatesValue === 'running=1 · succeeded=1 · failed=1' &&
      fieldValueOf('Status') === null,
    `treeState=${treeStateValue} leafStates=${leafStatesValue} bareStatus=${fieldValueOf('Status')}`)

  // V2-32: a tree_plan root is a container — it never gets a done event, so its
  // own display state may stay "running" after every worker settled. The grid
  // labels that instead of letting it contradict the derived "Tree state".
  // Patch the detail the store currently holds (the previous scenario left it on
  // tree-beta), then restore, so the shared fixtures stay untouched.
  const liveDetail = rtMain.store.get().detail
  const savedRoot = liveDetail.root
  const savedState = liveDetail.state
  liveDetail.root = { leafId: 'la-root', status: 'running', rawStatus: 'active', runtimeState: null, goalPreview: '{}' }
  liveDetail.state = 'succeeded'
  const ctrSink = []
  renderTree(rtMain.Body({}), ctrSink)
  const ctrFields = byClass(ctrSink, 'st-tr2-field', true)
  const ctrValueOf = (label) => {
    for (const field of ctrFields) {
      const kids = descendants(field)
      const labelEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldlabel'))
      if (labelEl && sinkText(labelEl) === label) {
        const valueEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldvalue'))
        return valueEl ? sinkText(valueEl) : null
      }
    }
    return null
  }
  const ctrRoot = ctrValueOf('Root status')
  const ctrTreeState = ctrValueOf('Tree state')
  check('V2-32 详情栅格：整树已结算但 root 容器无结算事件时，Root status 标注 container（不与 Tree state 打架）',
    ctrTreeState === 'succeeded' &&
      ctrRoot === 'running · container (no settle event)',
    `treeState=${ctrTreeState} rootStatus=${ctrRoot}`)
  liveDetail.root = savedRoot
  liveDetail.state = savedState

  // ================== v1.8.0 判定：树图高度可调 + 初始全图可见
  // 用户反馈（m03016）：「你给树图的部分高度太小了，一条缝，这块要保证高度，
  // 且要可以调节，最好能初始就显示全里面的树内容。」根因是详情列是 flex 容器，
  // 而 .st-tr2-viewport 是 overflow:auto → 自动最小尺寸为 0，被兄弟区块挤成一条缝。
  console.log('\n=== v1.8.0 判定：树图视口高度可调 + Fit 全图 ===')
  check('V2-33 clampGraphHeight：缺省 420 / 下限 220 / 上限 900 / 取整（非法值回落默认）',
    mod.clampGraphHeight(undefined) === 420 &&
      mod.clampGraphHeight(null) === 420 &&
      mod.clampGraphHeight(NaN) === 420 &&
      mod.clampGraphHeight('640') === 420 &&
      mod.clampGraphHeight(120) === 220 &&
      mod.clampGraphHeight(5000) === 900 &&
      mod.clampGraphHeight(333.7) === 334 &&
      mod.GRAPH_HEIGHT_DEFAULT === 420 &&
      mod.GRAPH_HEIGHT_MIN === 220 &&
      mod.GRAPH_HEIGHT_MAX === 900,
    `undef=${mod.clampGraphHeight(undefined)} low=${mod.clampGraphHeight(120)} high=${mod.clampGraphHeight(5000)} frac=${mod.clampGraphHeight(333.7)}`)
  check('V2-34 fitZoomOf：按两轴取小值装满视口，未测量 → 1×，夹在 [0.25, 2]',
    mod.fitZoomOf(700, 420, 484, 672) === 0.613 &&
      mod.fitZoomOf(700, 900, 484, 672) === 1.327 &&
      mod.fitZoomOf(0, 0, 484, 672) === 1 &&
      mod.fitZoomOf(NaN, 500, 484, 672) === 1 &&
      mod.fitZoomOf(700, 420, 0, 672) === 1 &&
      mod.fitZoomOf(100, 100, 5000, 5000) === 0.25 &&
      mod.fitZoomOf(9000, 9000, 100, 100) === 2,
    `height-limited=${mod.fitZoomOf(700, 420, 484, 672)} width-limited=${mod.fitZoomOf(700, 900, 484, 672)} unmeasured=${mod.fitZoomOf(0, 0, 484, 672)} min=${mod.fitZoomOf(100, 100, 5000, 5000)} max=${mod.fitZoomOf(9000, 9000, 100, 100)}`)
  const storeBefore = rtMain.store.get().graphHeight
  const fakeStore = new Map()
  fakeStore.setItem = (k, v) => Map.prototype.set.call(fakeStore, k, String(v))
  fakeStore.getItem = (k) => (Map.prototype.has.call(fakeStore, k) ? Map.prototype.get.call(fakeStore, k) : null)
  mod.writeStoredGraphHeight(555, fakeStore)
  const readBack = mod.readStoredGraphHeight(fakeStore)
  fakeStore.setItem(mod.GRAPH_HEIGHT_KEY, 'not-a-number')
  const badStored = mod.readStoredGraphHeight(fakeStore)
  check('V2-35 视口高度持久化：写入取整后可读回、脏值回落默认、无 localStorage 时不抛',
    storeBefore === 420 &&
      readBack === 555 &&
      badStored === 420 &&
      mod.readStoredGraphHeight(undefined) === 420 &&
      mod.writeStoredGraphHeight(5000, fakeStore) === 900 &&
      fakeStore.getItem(mod.GRAPH_HEIGHT_KEY) === '900',
    `default=${storeBefore} readBack=${readBack} dirty=${badStored}`)
  rtMain.controller.resizeGraph(100)
  const clampedLow = rtMain.store.get().graphHeight
  rtMain.controller.resizeGraph(5000)
  const clampedHigh = rtMain.store.get().graphHeight
  check('V2-36 controller.resizeGraph：写入 store 前夹到 [220, 900]（拖拽与双击复位共用）',
    clampedLow === 220 && clampedHigh === 900,
    `low=${clampedLow} high=${clampedHigh}`)
  // 渲染面：视口带显式高度（这就是那条「缝」的修法），分隔条可拖，外层成 section。
  rtMain.store.set({ graphHeight: 640, selectedTreeId: 'tree-alpha', selectedLeafId: null })
  rtMain.store.set({
    detail: {
      treeId: 'tree-alpha',
      state: 'running',
      root: { leafId: 'n1', status: 'running' },
      leaves: [
        { leafId: 'n1', status: 'succeeded', role: 'commander' },
        { leafId: 'n2', status: 'running', role: 'worker', parent: 'n1', dependencies: ['n1'] },
      ],
      stats: { total: 2, byStatus: { running: 1, succeeded: 1 } },
      events: [],
    },
  })
  const geoL = []
  renderTree(rtMain.Body({}), geoL)
  const viewports = byClass(geoL, 'st-tr2-viewport', true)
  const resizeHandles = byClass(geoL, 'st-tr2-graphresize', true)
  const graphSections = byClass(geoL, 'st-tr2-graphsection')
  check('V2-37 渲染面：视口显式高度 = graphHeight（不被 flex 挤成一条缝）+ 分隔条 + graph section',
    viewports.length === 1 &&
      !!viewports[0].props.style &&
      viewports[0].props.style.height === '640px' &&
      resizeHandles.length === 1 &&
      resizeHandles[0].props.role === 'separator' &&
      typeof resizeHandles[0].props.onMouseDown === 'function' &&
      typeof resizeHandles[0].props.onDoubleClick === 'function' &&
      graphSections.length === 1,
    `viewports=${viewports.length} height=${viewports[0] && viewports[0].props.style && viewports[0].props.style.height} handles=${resizeHandles.length} sections=${graphSections.length}`)
  rtMain.store.set({ graphHeight: 420 })
  // v1.8.1：图内节点点击失效的根因是 pointerdown 就 setPointerCapture —— 浏览器会把
  // 随后的 click 重定向到捕获元素（视口），节点自身 onClick 永不触发。改为「拖拽超过
  // 阈值才武装捕获」，节点点击回到原生路径。下面锁住阈值判定与视口的指针接线。
  check('V2-38 panMovedEnough：阈值 4px（曼哈顿）以下仍算点击，超过才算拖拽',
    mod.GRAPH_PAN_THRESHOLD === 4 &&
      mod.panMovedEnough(0, 0) === false &&
      mod.panMovedEnough(3, 1) === false &&
      mod.panMovedEnough(4, 0) === false &&
      mod.panMovedEnough(2, 3) === true &&
      mod.panMovedEnough(-5, 0) === true &&
      mod.panMovedEnough(NaN, 5) === true,
    `threshold=${mod.GRAPH_PAN_THRESHOLD} idle=${mod.panMovedEnough(0, 0)} tiny=${mod.panMovedEnough(3, 1)} edge=${mod.panMovedEnough(4, 0)} drag=${mod.panMovedEnough(2, 3)}`)
  rtMain.store.set({ selectedLeafId: null })
  const geoTap = []
  renderTree(rtMain.Body({}), geoTap)
  const tapViewport = byClass(geoTap, 'st-tr2-viewport', true)[0]
  const tapNodes = byClass(geoTap, 'st-tr2-node', true)
  const vpProps = (tapViewport && tapViewport.props) || {}
  check('V2-39 图内节点仍是点击主入口：节点带 cursor=pointer/onClick，视口接线 down/move/up/cancel',
    tapNodes.length === 2 &&
      typeof tapNodes[0].props.onClick === 'function' &&
      !!tapNodes[0].props.style &&
      tapNodes[0].props.style.cursor === 'pointer' &&
      typeof vpProps.onPointerDown === 'function' &&
      typeof vpProps.onPointerMove === 'function' &&
      typeof vpProps.onPointerUp === 'function' &&
      typeof vpProps.onPointerCancel === 'function',
    `nodes=${tapNodes.length} vp=${['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel'].filter((k) => typeof vpProps[k] === 'function').join('+')}`)
  if (tapNodes.length === 2) {
    tapNodes[1].props.onClick({ stopPropagation() {}, target: tapNodes[1] })
    check('V2-40 点击图上第二个节点 → 选中该 leaf（列表行点击只是次要入口）',
      rtMain.store.get().selectedLeafId === 'n2',
      `selected=${rtMain.store.get().selectedLeafId}`)
    rtMain.store.set({ selectedLeafId: null })
  }

  // ================== v1.8.2 判定：依赖虚线可读性 + 图外关系标识
  // 用户反馈（m03377）：「图里面的节点之间的虚线是啥意思？被挡住了看不清关系。
  // 除了图形的虚线，其他地方有这种关系的标识么？」虚线 = 声明依赖（目标等前置结算），
  // 实线 = 父子从属；虚线画在节点盒之前会被遮挡，故选中节点时只提亮它的边、其余压暗，
  // 并给每条边挂 <title>；栅格另加 Blocks（谁依赖它）与 Dependencies（它依赖谁）成对。
  console.log('\n=== v1.8.2 判定：依赖边可读性 + 关系在别处的标识 ===')
  rtMain.store.set({ graphHeight: 420, selectedTreeId: 'tree-alpha' })
  rtMain.store.set({
    detail: {
      treeId: 'tree-alpha',
      state: 'running',
      root: { leafId: 'n1', status: 'running' },
      leaves: [
        { leafId: 'n1', status: 'succeeded', role: 'commander' },
        { leafId: 'n2', status: 'running', role: 'worker', parent: 'n1' },
        { leafId: 'n3', status: 'pending', role: 'worker', parent: 'n2', dependencies: ['n1'] },
      ],
      stats: { total: 3, byStatus: { running: 1, succeeded: 1, pending: 1 } },
      events: [],
    },
  })
  // n2 选中：依赖边 n1→n3 与它无关 → 压到 0.12；两条父子边都相关 → 0.8。
  rtMain.store.set({ selectedLeafId: 'n2' })
  const dimSink = []
  renderTree(rtMain.Body({}), dimSink)
  const dimEdges = byClass(dimSink, 'st-tr2-edge', true)
  const dimDep = dimEdges.filter((g) => g.props['data-kind'] === 'dep')
  const dimParent = dimEdges.filter((g) => g.props['data-kind'] === 'parent')
  const pathOf = (g) => g.kids.find((k) => k && k.tag === 'path')
  const titleOf = (g) => g.kids.find((k) => k && k.tag === 'title')
  const dimDepPath = dimDep.length === 1 ? pathOf(dimDep[0]) : null
  check('V2-41 依赖边带 <title>「B depends on A」，选中 n2 时无关虚线压到 0.12、相关父边 0.8',
    dimEdges.length === 3 && dimDep.length === 1 && dimParent.length === 2 &&
      !!dimDepPath && !!titleOf(dimDep[0]) && sinkText(titleOf(dimDep[0])) === 'n3 depends on n1' &&
      dimDep[0].props['data-related'] === 'false' &&
      Math.abs(Number(dimDepPath.props.opacity) - 0.12) < 1e-9 &&
      dimParent.every((g) => g.props['data-related'] === 'true') &&
      dimParent.every((g) => Math.abs(Number(pathOf(g).props.opacity) - 0.8) < 1e-9),
    `edges=${dimEdges.length} dep=${dimDep.length} title=${dimDep.length === 1 ? sinkText(titleOf(dimDep[0])) : '(无)'} ` +
      `depOpacity=${dimDepPath ? dimDepPath.props.opacity : '?'}`)
  // n1 选中：依赖边变成本节点的边 → 提亮；与 n1 无关的父边（n2→n3）压暗。
  rtMain.store.set({ selectedLeafId: 'n1' })
  const relSink = []
  renderTree(rtMain.Body({}), relSink)
  const relEdges = byClass(relSink, 'st-tr2-edge', true)
  const relDep = relEdges.filter((g) => g.props['data-kind'] === 'dep')
  const relDepPath = relDep.length === 1 ? pathOf(relDep[0]) : null
  const relDimParent = relEdges.filter(
    (g) => g.props['data-kind'] === 'parent' && g.props['data-related'] === 'false',
  )
  check('V2-42 选中 n1：依赖边视为相关（opacity 1 + 加粗），无关父边 n2→n3 压到 0.12',
    relDep.length === 1 && !!relDepPath && Number(relDepPath.props.opacity) === 1 &&
      relDimParent.length === 1 && Math.abs(Number(pathOf(relDimParent[0]).props.opacity) - 0.12) < 1e-9,
    `dep=${relDep.length} depOpacity=${relDepPath ? relDepPath.props.opacity : '?'} dimParent=${relDimParent.length}`)
  // 栅格：Blocks = 谁依赖它（n1 的 Blocks 是 n3），与 Dependencies 成对出现。
  const relGridFields = byClass(relSink, 'st-tr2-field', true)
  const relValueOf = (label) => {
    for (const field of relGridFields) {
      const kids = descendants(field)
      const labelEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldlabel'))
      if (labelEl && sinkText(labelEl) === label) {
        const valueEl = kids.find((e) => String(e.props.className || '').includes('st-tr2-fieldvalue'))
        return valueEl ? sinkText(valueEl) : null
      }
    }
    return null
  }
  const blocksValue = relValueOf('Blocks')
  check('V2-43 叶属性栅格新增 Blocks（反向依赖：谁在等它），与 Dependencies 成对',
    blocksValue === 'n3' && relValueOf('Dependencies') !== undefined && sinkAllText(relSink).includes('Leaf attributes · n1'),
    `blocks=${blocksValue} deps=${relValueOf('Dependencies')}`)

  // ================== v1.8.3 判定：点亮置顶 + 依赖边弧线绕行（A 方案）
  // 用户（m03546）：「这种依赖虚线，在点亮后要放在图层前面，不要被节点挡住；
  // 虚线是否能不要是直线，作成弧形线，尽量绕开节点不被挡住？」A 方案 = 保留分层树
  // 主视图，边分 back/front 两层（点亮边在节点盒之上），依赖边改正交折线 + 圆角弧，
  // 走列间空道 / 同列右侧通道，反向依赖无法绕行时保留贝塞尔但强制进前层。
  console.log('\n=== v1.8.3 判定：点亮置顶与依赖边绕行（A 方案） ===')
  const svgOf = (sink) => sink.find((e) => e && e.tag === 'svg')
  const groupByClass = (sink, cls) => sink.filter((e) => e && String(e.props.className || '').split(' ').includes(cls))
  const edgesIn = (group) =>
    group && Array.isArray(group.kids)
      ? group.kids.filter((k) => k && String(k.props.className || '').split(' ').includes('st-tr2-edge'))
      : []
  rtMain.store.set({ graphHeight: 420, selectedTreeId: 'tree-alpha' })
  rtMain.store.set({
    detail: {
      treeId: 'tree-alpha',
      state: 'running',
      root: { leafId: 'n1', status: 'running' },
      leaves: [
        { leafId: 'n1', status: 'succeeded', role: 'commander' },
        { leafId: 'n2', status: 'running', role: 'worker', parent: 'n1' },
        { leafId: 'n3', status: 'pending', role: 'worker', parent: 'n2' },
        { leafId: 'n4', status: 'pending', role: 'worker', parent: 'n2', dependencies: ['n1'] },
      ],
      stats: { total: 4, byStatus: { running: 1, succeeded: 1, pending: 2 } },
      events: [],
    },
  })
  rtMain.store.set({ selectedLeafId: 'n2' })
  const layerSink = []
  renderTree(rtMain.Body({}), layerSink)
  const svgEl = svgOf(layerSink)
  const backGroups = groupByClass(layerSink, 'st-tr2-edges-back')
  const frontGroups = groupByClass(layerSink, 'st-tr2-edges-front')
  const backEdges = backGroups.length === 1 ? edgesIn(backGroups[0]) : []
  const frontEdges = frontGroups.length === 1 ? edgesIn(frontGroups[0]) : []
  const idxOfClass = (cls) =>
    svgEl ? svgEl.kids.findIndex((k) => k && String(k.props.className || '').split(' ').includes(cls)) : -1
  const nodeIndexes = svgEl
    ? svgEl.kids
        .map((k, i) => [k, i])
        .filter(([k]) => k && String(k.props.className || '').split(' ').includes('st-tr2-node'))
        .map(([, i]) => i)
    : []
  const backIdx = idxOfClass('st-tr2-edges-back')
  const frontIdx = idxOfClass('st-tr2-edges-front')
  const depBack = backEdges.filter((g) => g.props['data-kind'] === 'dep')
  const depPath = depBack.length === 1 ? pathOf(depBack[0]) : null
  check('V2-44 边分 back/front：SVG 顺序 未点亮边 → 节点 → 点亮边；点亮边带 halo，未点亮边不带',
    !!svgEl && backIdx >= 0 && frontIdx > 0 && backIdx < frontIdx &&
      nodeIndexes.length === 4 && nodeIndexes.every((i) => i > backIdx && i < frontIdx) &&
      backEdges.length === 1 && depBack.length === 1 &&
      frontEdges.length === 3 && frontEdges.every((g) => g.props['data-kind'] === 'parent') &&
      frontEdges.every((g) => g.kids.filter((k) => k && k.tag === 'path').length === 2) &&
      depBack[0].kids.filter((k) => k && k.tag === 'path').length === 1,
    `back=${backEdges.length} front=${frontEdges.length} backIdx=${backIdx} frontIdx=${frontIdx} nodes=${nodeIndexes.join(',')}`)
  check('V2-45 依赖边改为绕行折线 + 圆角弧（Q 控制点），箭头与 title 保留',
    !!depPath && typeof depPath.props.d === 'string' &&
      depPath.props.d.startsWith('M ') && depPath.props.d.includes(' Q ') &&
      !/NaN|Infinity/.test(depPath.props.d) &&
      sinkText(depBack[0].kids.find((k) => k && k.tag === 'title')) === 'n4 depends on n1' &&
      depPath.props.markerEnd === 'url(#st-tr2-arrow-decl)',
    `d=${depPath ? depPath.props.d : '(无)'}`)
  // 反向依赖（目标在更左的列）：无法绕行 → 贝塞尔兜底，但必须进前层。
  rtMain.store.set({
    detail: {
      treeId: 'tree-alpha',
      state: 'running',
      root: { leafId: 'r0', status: 'running' },
      leaves: [
        { leafId: 'r0', status: 'succeeded', role: 'commander' },
        { leafId: 'c1', status: 'running', role: 'worker', parent: 'r0', dependencies: ['g1'] },
        { leafId: 'g1', status: 'succeeded', role: 'worker', parent: 'c1' },
      ],
      stats: { total: 3, byStatus: { running: 1, succeeded: 2 } },
      events: [],
    },
  })
  rtMain.store.set({ selectedLeafId: null })
  const backSink = []
  renderTree(rtMain.Body({}), backSink)
  const backwardDep = byClass(backSink, 'st-tr2-edge', true).filter((g) => g.props['data-kind'] === 'dep')
  check('V2-46 反向依赖无法绕行时保留贝塞尔，但强制进前层（不再被节点盒遮挡）',
    backwardDep.length === 1 && backwardDep[0].props['data-layer'] === 'front' &&
      backwardDep[0].props['data-related'] === 'false' &&
      String(pathOf(backwardDep[0]).props.d).includes(' C ') &&
      sinkText(backwardDep[0].kids.find((k) => k && k.tag === 'title')) === 'c1 depends on g1',
    `dep=${backwardDep.length} layer=${backwardDep.length ? backwardDep[0].props['data-layer'] : '?'}`)
  // 纯函数：前向走列间空道、同列绕列右侧、反向交回贝塞尔、脏输入不抛。
  const fwd = mod.depRoutePoints({ x: 12, y: 12 }, { x: 400, y: 200 }, 0)
  const same = mod.depRoutePoints({ x: 12, y: 12 }, { x: 12, y: 200 }, 0)
  const back = mod.depRoutePoints({ x: 400, y: 12 }, { x: 12, y: 200 }, 0)
  const empty = mod.depRoutePoints(null, { x: 1, y: 2 }, 0)
  const fwdPath = mod.roundedPathOf(fwd.points, 10)
  check('V2-47 depRoutePoints / roundedPathOf：前向空道、同列右绕、反向回落、脏输入安全',
    fwd.mode === 'forward' && fwd.points.length === 4 && fwd.points[0].x === 204 && fwd.points[0].y === 40 &&
      fwd.points[1].x > 204 && fwd.points[1].x < 392 &&
      fwd.points[3].x === 392 && fwd.points[3].y === 228 &&
      same.mode === 'same' && same.points[3].x === 204 && same.points[1].x >= 218 &&
      back.mode === 'backward' && back.points.length === 0 && empty.points.length === 0 &&
      fwdPath.startsWith('M 204 40') && fwdPath.includes(' Q ') && !/NaN/.test(fwdPath) &&
      mod.roundedPathOf([], 10) === '' && mod.DEP_ROUTE_RADIUS === 10,
    `fwd=${JSON.stringify(fwd.points)} sameEnd=${same.points[3].x} back=${back.mode} path=${fwdPath.slice(0, 48)}`)

  // v1.8.4：同列依赖的绕行 lane 落在最后一列的右侧，画布若仍按 layout
  // 尺寸出图就把整层虚线裁掉（wave2 的 9 条依赖全是同列 → 虚线全消失）。
  // graphCanvasOf 把 lane 也算进画布，下面同时锁纯函数与渲染面的 svg 尺寸。
  {
    const leaves = [
      { leafId: 'p1', parent: null, path: 'A', role: 'commander', status: 'succeeded' },
      { leafId: 'p2', parent: 'p1', path: 'B', role: 'worker', status: 'succeeded' },
      { leafId: 'p3', parent: 'p1', path: 'C', role: 'worker', status: 'succeeded', dependencies: ['p2'] },
    ]
    const layout = mod.treeGraphLayout(leaves, 'p1')
    const canvas = mod.graphCanvasOf(leaves, 'p1', layout)
    check('V2-48 graphCanvasOf：同列 lane 超出 layout 右边界时画布扩宽（虚线不再被 viewBox 裁掉）',
      layout.graphW === 484 && canvas.w === 498 && canvas.w > layout.graphW &&
        mod.graphCanvasOf([], 'p1', layout).w === 484,
      `graphW=${layout.graphW} canvasW=${canvas.w}`)
    rtMain.store.set({ graphHeight: 420, selectedTreeId: 'tree-alpha', selectedLeafId: null })
    rtMain.store.set({
      detail: {
        treeId: 'tree-alpha',
        state: 'succeeded',
        root: { leafId: 'p1', status: 'succeeded', rawStatus: 'succeeded', runtimeState: 'succeeded' },
        leaves,
        stats: { total: 3, byStatus: { succeeded: 3 } },
        events: [],
      },
    })
    const geo = []
    renderTree(rtMain.Body({}), geo)
    const svg = byClass(geo, 'st-tr2-svg', true)[0]
    const viewBox = svg && svg.props ? String(svg.props.viewBox || svg.props['viewBox'] || '') : ''
    check('V2-49 渲染面：svg viewBox / width 用扩宽后的画布（498），而非 layout 的 484',
      !!svg && viewBox === '0 0 498 154' && Number(svg.props.width) === 498,
      `viewBox="${viewBox}" width=${svg && svg.props && svg.props.width}`)
  }

  // ============ v1.9.0 判定：Hierarchy | Dependency 双视图（B 方案）
  // 用户（m04606）：「好，用B方案，开干」——B = 保留现有分层树主视图，新增
  // 只画依赖边的 Dependency 视图：按最长路径分层、同源扇出、入度 ≥2 的 join
  // 徽标；视图选择持久化。两视图共用同一份服务端投影，不动 tree-state 契约。
  console.log('\n=== v1.9.0 判定：Hierarchy | Dependency 双视图（B 方案） ===')
  const depLeaves = [
    { leafId: 'd-root', status: 'running', role: 'commander' },
    { leafId: 'd-a', status: 'succeeded', role: 'worker', parent: 'd-root' },
    { leafId: 'd-b', status: 'succeeded', role: 'worker', parent: 'd-root' },
    { leafId: 'd-c', status: 'running', role: 'worker', parent: 'd-root', dependencies: ['d-a', 'd-b'] },
  ]
  const depLayout = mod.depGraphLayout(depLeaves)
  const depNodesById = new Map(depLayout.nodes.map((n) => [n.leafId, n]))
  const cycLayout = mod.depGraphLayout([
    { leafId: 'x', dependencies: ['y'] },
    { leafId: 'y', dependencies: ['x'] },
  ])
  check('V2-50 depGraphLayout：按依赖最长路径分层（d-c 在 level 2）、父子边不参与、环有界',
    depLayout.view === 'dependency' && depLayout.parentEdges.length === 0 &&
      depLayout.nodes.length === 4 && depLayout.maxLevel === 1 &&
      depNodesById.get('d-c').level === 1 && depNodesById.get('d-a').level === 0 &&
      depNodesById.get('d-a').row !== depNodesById.get('d-b').row &&
      depLayout.graphW === 484 && depLayout.graphH === 248 &&
      cycLayout.nodes.length === 2 && cycLayout.maxLevel <= 2,
    'level(c)=' + depNodesById.get('d-c').level + ' w=' + depLayout.graphW + ' h=' + depLayout.graphH + ' cyc=' + cycLayout.maxLevel)

  const fakeViewStore = new Map()
  const fakeViewStorage = {
    getItem: (k) => (fakeViewStore.has(k) ? fakeViewStore.get(k) : null),
    setItem: (k, v) => fakeViewStore.set(k, String(v)),
  }
  const noopStorage = { getItem: () => null }
  check('V2-51 视图选择持久化：默认 hierarchy、写入可读回、脏值回落、storage 异常不抛',
    mod.readStoredGraphView() === 'hierarchy' &&
      mod.graphLayoutOf(depLeaves, 'd-root', undefined).view === undefined &&
      mod.clampGraphView('weird') === 'hierarchy' &&
      mod.writeStoredGraphView('dependency', fakeViewStorage) === 'dependency' &&
      mod.readStoredGraphView(fakeViewStorage) === 'dependency' &&
      mod.writeStoredGraphView('bogus', fakeViewStorage) === 'hierarchy' &&
      mod.readStoredGraphView(fakeViewStorage) === 'hierarchy' &&
      mod.writeStoredGraphView('dependency', noopStorage) === 'dependency' &&
      mod.readStoredGraphView(noopStorage) === 'hierarchy',
    'default=' + mod.readStoredGraphView() + ' key=' + mod.GRAPH_VIEW_KEY)

  const dNodeOf = (sink, id) =>
    sink.find(
      (e) =>
        e && e.props &&
        String(e.props.className || "").split(" ").includes("st-tr2-node") &&
        e.props["data-leaf-id"] === id,
    )
  const badgeTextOf = (nodeEl) => {
    if (!nodeEl) return ""
    const t = (nodeEl.kids || []).find((k) => k && k.props && k.props.key === "jointext")
    return t ? sinkText(t) : ""
  }

  rtMain.store.set({ graphHeight: 420, selectedTreeId: 'tree-alpha', selectedLeafId: null, graphView: 'hierarchy' })
  rtMain.store.set({
    detail: {
      treeId: 'tree-alpha',
      state: 'running',
      root: { leafId: 'd-root', status: 'running' },
      leaves: depLeaves,
      stats: { total: 4, byStatus: { running: 2, succeeded: 2 } },
      events: [],
    },
  })
  const hierSink = []
  renderTree(rtMain.Body({}), hierSink)
  const hierSection = byClass(hierSink, 'st-tr2-graphsection')[0]
  const viewButtons = byClass(hierSink, 'st-tr2-viewbtn')
  const hierEdges = byClass(hierSink, 'st-tr2-edge', true)
  check('V2-52 默认仍是 Hierarchy：切换按钮两枚、无层级标签、父子实线与依赖虚线都在',
    !!hierSection && hierSection.props['data-view'] === 'hierarchy' &&
      viewButtons.length === 2 &&
      viewButtons.some((b) => b.props['data-view'] === 'hierarchy' && b.props['aria-pressed'] === 'true') &&
      viewButtons.some((b) => b.props['data-view'] === 'dependency' && b.props['aria-pressed'] === 'false') &&
      byClass(hierSink, 'st-tr2-levels').length === 0 &&
      hierEdges.some((g) => g.props['data-kind'] === 'parent') &&
      hierEdges.some((g) => g.props['data-kind'] === 'dep') &&
      sinkAllText(hierSink).includes('parent → child (solid, 从属)'),
    'view=' + (hierSection && hierSection.props['data-view']) + ' edges=' + hierEdges.length + ' btns=' + viewButtons.length)

  rtMain.store.set({ graphView: 'dependency' })
  const depSink = []
  renderTree(rtMain.Body({}), depSink)
  const depSection = byClass(depSink, 'st-tr2-graphsection')[0]
  const depSvg = byClass(depSink, 'st-tr2-svg', true)[0]
  const depDrawn = byClass(depSink, 'st-tr2-edge', true)
  const levelGroup = byClass(depSink, 'st-tr2-levels', true)[0]
  const depToggle = byClass(depSink, 'st-tr2-viewbtn').find((b) => b.props['data-view'] === 'dependency')
  const dRoot = dNodeOf(depSink, 'd-root')
  const dC = dNodeOf(depSink, 'd-c')
  check('V2-53 Dependency 视图：只画依赖边、层级标签、join 徽标（入度 2）、视图可切换',
    !!depSection && depSection.props['data-view'] === 'dependency' &&
      !!depSvg && depSvg.props['data-view'] === 'dependency' &&
      depDrawn.length === 2 && depDrawn.every((g) => g.props['data-kind'] === 'dep') &&
      !!levelGroup && levelGroup.kids.length === 2 &&
      sinkText(levelGroup.kids[0]).includes('level 1') && sinkText(levelGroup.kids[0]).includes('可立即派发') &&
      sinkText(levelGroup.kids[1]).includes('level 2') && sinkText(levelGroup.kids[1]).includes('收口') &&
      badgeTextOf(dC) === '2' && badgeTextOf(dRoot) === '' &&
      !!depToggle && depToggle.props['aria-pressed'] === 'true' &&
      sinkAllText(depSink).includes('入边 ≥ 2 时显示'),
    'edges=' + depDrawn.length + ' levels=' + (levelGroup ? levelGroup.kids.length : 0) + ' badge=' + badgeTextOf(dC) +
      ' sec=' + (depSection && depSection.props['data-view']) + ' svg=' + (depSvg && depSvg.props['data-view']) +
      ' lv0=' + (levelGroup ? sinkText(levelGroup.kids[0]) : '?') + ' toggle=' + (depToggle && depToggle.props['aria-pressed']) +
      ' joinLegend=' + sinkAllText(depSink).includes('入边 ≥ 2 时显示'))

  // 视图切换走 controller（写 store；持久化由 V2-51 的纯函数锁定）。
  rtMain.controller.setGraphView('dependency')
  const switchedToDep = rtMain.store.get().graphView
  rtMain.controller.setGraphView('nonsense')
  const switchedBack = rtMain.store.get().graphView
  check('V2-54 controller.setGraphView：写入 store、未知值回落 hierarchy',
    switchedToDep === 'dependency' && switchedBack === 'hierarchy',
    'dep=' + switchedToDep + ' bogus=' + switchedBack)

  // 双视图不新增 hook：Dependency 渲染的 hook 数仍 = 基态 + GRAPH_HOOKS(2)。
  rtMain.store.set({ graphView: 'dependency' })
  hookCalls = 0
  const hookSink = []
  renderTree(rtMain.Body({}), hookSink)
  const depHookCalls = hookCalls
  check('V2-55 Dependency 视图 hook 数 = 基态 + GRAPH_HOOKS(2)（切换不引入新 hook）',
    depHookCalls === listHookCalls + 2 && hookSink.length > 0,
    'base=' + listHookCalls + ' dep=' + depHookCalls)
  rtMain.store.set({ graphView: 'hierarchy' })

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
