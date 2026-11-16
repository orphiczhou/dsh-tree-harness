/**
 * Independent check for the stylesheet SELF-HEAL guard (v1.0.4).
 *
 * v1.0.3 moved the sheet into <head> (`style[data-plugin-css="session-tree"]`),
 * but nothing watched it afterwards: whatever removes it later still wins, and
 * the failure is the silent one that broke the live sidebar before — classes
 * intact, nothing matching them. `guardStylesheet()` in client.js arms two
 * `childList` MutationObservers (head + documentElement) whose callback only
 * re-injects when a query comes up empty.
 *
 * What this suite proves, in one process, against the REAL client.js (loaded
 * the same way test/provider-conformance.cjs loads it: append an export line,
 * dynamic-import with a unique URL to defeat the module cache):
 *
 *   A. full environment (document stub + MutationObserver stub)
 *      1. apply() injects exactly one tagged sheet into <head>, and its text
 *         carries the `.st-folder{...width:13px...}` rule;
 *      2. exactly two observers got armed — head and documentElement, both
 *         `childList` only, no `subtree` — and a second apply() on the same
 *         module instance does NOT arm more (armed once per load);
 *      3. removing the sheet and firing the HEAD observer heals it;
 *      4. after the whole <head> is REPLACED, firing an observer still heals —
 *         reassert() re-queries the DOCUMENT rather than trusting the mutation
 *         target, and the re-injection lands in the NEW head (this is why the
 *         second observer watches documentElement);
 *      5. firing the observers again and again with the sheet present injects
 *         nothing further (idempotent — no self-exciting loop);
 *   B. no MutationObserver (old browser / sandbox): apply() does not throw and
 *      the sheet is still injected (the guard just never arms);
 *   C. no document at all (vm tests, SSR): apply() does not throw.
 *
 * Every scenario gets a FRESH module instance, because `stylesInHead` and
 * `stylesGuarded` are module-level flags by design (one page load = one arm).
 *
 * Only Node built-ins; a minimal document stub, no jsdom, no browser.
 * Run:  node test/style-guard.cjs
 * Exit: 0 = all green, 1 = at least one check failed.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT = path.resolve(__dirname, '..', 'client.js')
const SELECTOR = 'style[data-plugin-css="session-tree"]'

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures++
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`)
}

// ------------------------------------------------------------------ DOM stub
/**
 * The smallest document the stylesheet code talks to:
 * `document.head.appendChild`, `document.createElement`, `document.querySelector`,
 * `document.documentElement`. Every injected style is recorded, so the counts
 * below are injection events, not snapshots.
 */
function makeDocument() {
  const state = { injected: [], headChildren: [] }
  const head = {
    appendChild(child) {
      state.headChildren.push(child)
      if (child.tagName === 'style') state.injected.push(child)
    },
  }
  const makeStyleEl = () => ({
    tagName: 'style',
    attrs: {},
    textContent: '',
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    },
    remove() {
      const i = state.headChildren.indexOf(this)
      if (i >= 0) state.headChildren.splice(i, 1)
    },
  })
  const doc = {
    head,
    documentElement: { tagName: 'html' },
    createElement(tag) {
      if (tag !== 'style') throw new Error(`unexpected createElement(${tag})`)
      return makeStyleEl()
    },
    querySelector(sel) {
      if (sel !== SELECTOR) throw new Error(`unexpected selector ${sel}`)
      return state.headChildren.find(
        (el) => el.tagName === 'style' && el.attrs['data-plugin-css'] === 'session-tree',
      ) || null
    },
  }
  return { doc, state }
}

/** MutationObserver stub: records (callback, target, options), never fires on its own. */
function makeObserverClass() {
  const armed = []
  class MutationObserver {
    constructor(cb) {
      if (typeof cb !== 'function') throw new TypeError('callback must be a function')
      this.cb = cb
    }
    observe(target, options) {
      const record = { cb: this.cb, target, options }
      // Test trigger: pretend the watched node just changed.
      record.fire = () => this.cb([], this)
      armed.push(record)
    }
  }
  return { MutationObserver, armed }
}

// ---------------------------------------------------------------- run client
let loadSeq = 0
function loadClient() {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const tmp = path.join(os.tmpdir(), `session-tree-style-guard-${process.pid}-${loadSeq++}.mjs`)
  fs.writeFileSync(tmp, `${src}\nexport default globalThis.__CAPTURED_SESSION_TREE__\n`)
  return import(pathToFileURL(tmp).href + `?n=${loadSeq}`).then((m) => {
    fs.unlinkSync(tmp)
    return m.default
  })
}

/**
 * The plugin only destructures React at factory time and `apply` never renders
 * here (the slot callback is captured, not invoked into React), so the same
 * shape-complete stub provider-conformance.cjs uses is enough.
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

function makeCtx() {
  let slots = 0
  return {
    ctx: {
      slots: {
        inject(key, cb) {
          void key
          cb()
        },
        register() {
          slots++
          return () => {}
        },
      },
      // `cordisInspect` is an OPTIONAL injection that never calls back here;
      // the stylesheet guard has nothing to do with it.
      inject(keys, cb) {
        void keys
        void cb
      },
    },
    slotCount: () => slots,
  }
}

/** Install one scenario's globals; returns an undo function. */
function withGlobals({ doc, Observer }) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const hadDoc = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const hadObserver = Object.prototype.hasOwnProperty.call(globalThis, 'MutationObserver')
  const prevWindow = globalThis.window
  const prevDoc = globalThis.document
  const prevObserver = globalThis.MutationObserver
  globalThis.window = globalThis
  globalThis.window.__ModuleLoader__ = {
    load({ factory }) {
      globalThis.__CAPTURED_SESSION_TREE__ = factory((name) => {
        if (name === 'react') return REACT_STUB
        throw new Error(`unexpected require: ${name}`)
      })
    },
  }
  if (doc) globalThis.document = doc
  else delete globalThis.document
  if (Observer) globalThis.MutationObserver = Observer
  else delete globalThis.MutationObserver
  return () => {
    if (hadWindow) globalThis.window = prevWindow
    else delete globalThis.window
    if (hadDoc) globalThis.document = prevDoc
    else delete globalThis.document
    if (hadObserver) globalThis.MutationObserver = prevObserver
    else delete globalThis.MutationObserver
  }
}

const sheetText = (state) => {
  const el = state.injected[state.injected.length - 1]
  return el ? el.textContent : ''
}

async function main() {
  console.log('=== session-tree stylesheet self-heal guard: independent check on the REAL client.js ===')

  // ------------------------------------------------------------ A. full env
  console.log('\n=== A. full environment: heal + idempotence + once-only arming ===')
  {
    const { doc, state } = makeDocument()
    const { MutationObserver, armed } = makeObserverClass()
    const undo = withGlobals({ doc, Observer: MutationObserver })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      const plugin = await loadClient()
      const { ctx, slotCount } = makeCtx()
      let threw = null
      try {
        plugin.apply(ctx)
      } catch (e) {
        threw = e
      }
      check('A0 apply() does not throw', threw === null, threw && threw.message)
      check('A1 exactly one tagged sheet injected into <head>', state.injected.length === 1, String(state.injected.length))
      check('A1b the sheet is reachable via the documented selector', doc.querySelector(SELECTOR) !== null)
      // v1.6.1 style-ownership contract: the client-module loader treats any
      // <style> without `data-plugin` as unowned — claimStyles() re-tags it
      // into whichever module materializes next, and that module's replace /
      // prune then deletes it (the 2026-11-16 bare-text panel regression).
      // The sheet must self-tag with exactly the registered module id, the
      // same way the shipped packages do (dsh-client-ui-theme et al.).
      check(
        'A1g the sheet self-tags data-plugin=@orphiczhou/dsh-session-tree (loader ownership contract)',
        state.injected.length > 0 &&
          state.injected.every((el) => el.attrs['data-plugin'] === '@orphiczhou/dsh-session-tree'),
        JSON.stringify(state.injected.map((el) => el.attrs['data-plugin'] || null)),
      )
      // v1.4.0 conversation-UI metadata (composer dock strip + read-only header
      // chip). The sidebar tree itself must NOT carry the row badge any more.
      const sheet = sheetText(state)
      check(
        'A1c the sheet carries the conversation metadata rules (.st-meta-strip / .st-meta-pct)',
        /\.st-meta-strip\{/.test(sheet) && /\.st-meta-pct\{/.test(sheet),
        `strip=${/\.st-meta-strip\{/.test(sheet)} pct=${/\.st-meta-pct\{/.test(sheet)}`,
      )
      check(
        'A1d context% levels use theme state tokens (warn / error)',
        /\.st-meta-pct\[data-level='warn'\]\{color:var\(--dsw-alias-state-warn-primary\)\}/.test(sheet) &&
          /\.st-meta-pct\[data-level='error'\]\{color:var\(--dsw-alias-state-error-primary\)\}/.test(sheet),
      )
      check(
        'A1e the sidebar row badge is gone (no bare .st-meta / .st-ctx rules)',
        !/\.st-meta\{/.test(sheet) && !/\.st-ctx\{/.test(sheet),
      )
      check(
        'A1f the shared sidebar row rule keeps its 24px minimum height',
        /\.st-row\{[^}]*min-height:24px/.test(sheet),
        /\.st-row\{[^}]*min-height:24px/.exec(sheet) ? 'present' : 'missing',
      )
      check(
        'A2 sheet text carries the .st-folder 13px rule',
        /\.st-folder\{[^}]*width:13px/.test(sheetText(state)),
        `${sheetText(state).length} chars`,
      )

      check(
        'A3 exactly two observers armed (head + documentElement)',
        armed.length === 2,
        JSON.stringify(armed.map((a) => ({ target: a.target.tagName, options: a.options }))),
      )
      check(
        'A3b they watch exactly <head> and <html>',
        armed.some((a) => a.target === doc.head) && armed.some((a) => a.target === doc.documentElement),
      )
      check(
        'A3c both are childList-only (no subtree observation)',
        armed.every((a) => a.options && a.options.childList === true && !a.options.subtree),
      )

      plugin.apply(ctx)
      check('A4 a second apply() arms no further observers', armed.length === 2, String(armed.length))
      check('A4b and injects no duplicate sheet', state.injected.length === 1, String(state.injected.length))

      // Path 1: the plain "someone removed our <style> child" case, healed via
      // the head observer.
      doc.querySelector(SELECTOR).remove()
      check('A5 sheet is really gone from <head>', doc.querySelector(SELECTOR) === null)
      armed.find((a) => a.target === doc.head).fire()
      check('A5b head observer heals the removal', doc.querySelector(SELECTOR) !== null)
      check('A5c exactly one re-injection happened', state.injected.length === 2, String(state.injected.length))

      // Path 2: the ENTIRE <head> gets replaced (the case the second observer,
      // on documentElement, exists for). The callback does not trust the
      // mutation target: it re-queries the document and re-injects into whatever
      // `document.head` is NOW — so even the stale observer heals, into the new
      // head.
      doc.querySelector(SELECTOR).remove()
      const staleHeadObserver = armed.find((a) => a.target === doc.head)
      const docElObserver = armed.find((a) => a.target === doc.documentElement)
      // A brand-new head, same contract as the original one (appendChild records
      // into the shared `state`), and none of the old head's children survive.
      doc.head = {
        appendChild(child) {
          state.headChildren.push(child)
          if (child.tagName === 'style') state.injected.push(child)
        },
      }
      state.headChildren.length = 0
      check('A6 sheet gone with the replaced <head>', doc.querySelector(SELECTOR) === null)
      staleHeadObserver.fire()
      check('A6b observer heals after the head was replaced', doc.querySelector(SELECTOR) !== null)
      check('A6c the healed sheet went into the NEW head', state.injected.length === 3, String(state.injected.length))

      doc.querySelector(SELECTOR).remove()
      docElObserver.fire()
      check('A6d documentElement observer heals as well', doc.querySelector(SELECTOR) !== null)
      check('A6e re-injection count advanced by one', state.injected.length === 4, String(state.injected.length))

      // Idempotence: with the sheet present, observer storms must inject nothing.
      for (let i = 0; i < 5; i++) {
        for (const a of armed) a.fire()
      }
      check('A7 repeated observer fires with the sheet present inject nothing', state.injected.length === 4, String(state.injected.length))
      // v1.4.x + Tree Runs panel: 5 slot entries per apply in THIS ctx (no
      // sidebarRightTabs service → the panel takes its degraded path):
      //   sidebar.workspaces, composer.dock(session-meta), header.utilities
      //   (session-meta-chip), composer.dock('tree-runs' pill), shell.overlay
      //   ('tree-runs-panel' fallback). Two applies ran (A0 + A4) → 10.
      // When sidebarRightTabs IS present the overlay is replaced by the two
      // `sidebar.right.pane.tab[.title]` keyed seats — same total per apply.
      check('A8 all five slot entries still register once per apply (10 across A0+A4)', slotCount() === 10, String(slotCount()))
      check(
        'A8b the sheet carries the Tree Runs panel rules (.st-tr-pill / .st-tr-card / .st-tr-badge)',
        /\.st-tr-pill\{/.test(sheet) && /\.st-tr-card\{/.test(sheet) && /\.st-tr-badge\{/.test(sheet),
        `pill=${/\.st-tr-pill\{/.test(sheet)} card=${/\.st-tr-card\{/.test(sheet)} badge=${/\.st-tr-badge\{/.test(sheet)}`,
      )
      check(
        'A8c Tree Runs four-state tones keep the theme tokens (running blue keeps the literal fallback)',
        /\.st-tr-dot\[data-tone='running'\]\{background:var\(--dsw-static-blue-500,#3b82f6\)\}/.test(sheet) &&
          /\.st-tr-dot\[data-tone='succeeded'\]\{background:var\(--dsw-alias-state-success-primary\)\}/.test(sheet) &&
          /\.st-tr-dot\[data-tone='failed'\]\{background:var\(--dsw-alias-state-error-primary\)\}/.test(sheet) &&
          /\.st-tr-dot\[data-tone='other'\]\{background:var\(--dsw-alias-state-idle-primary\)\}/.test(sheet),
      )
      check(
        'A8d the Tree Runs overlay + table rules exist (.st-tr-overlay / .st-tr-row / .st-tr-badge tones)',
        /\.st-tr-overlay\{/.test(sheet) &&
          /\.st-tr-row\[data-kind='head'\]\{/.test(sheet) &&
          /\.st-tr-badge\[data-tone='succeeded'\]\{/.test(sheet),
      )
      // v2 spot checks (DESIGN §4.6): the st-tr2-* split-pane rules must
      // carry the frozen layout values. A8 stays at 10 — no new seats.
      check(
        'A8e the v2 list column keeps the 36% split clamp (min-width:150px / max-width:320px)',
        /\.st-tr2-list\{[^}]*min-width:150px/.test(sheet) && /\.st-tr2-list\{[^}]*max-width:320px/.test(sheet),
      )
      check(
        'A8f the v2 graph viewport keeps the scroll/pan contract (max-height:520px + touch-action:none)',
        /\.st-tr2-viewport\{[^}]*max-height:520px/.test(sheet) && /\.st-tr2-viewport\{[^}]*touch-action:none/.test(sheet),
      )
      check(
        'A8g the v2 field grid keeps the auto-fill track (minmax(260px,1fr))',
        /\.st-tr2-fieldgrid\{[^}]*minmax\(260px,1fr\)/.test(sheet),
      )
      check(
        'A8h the entry pill keeps the 26px capsule spec',
        /\.st-tr-pill\{[^}]*height:26px/.test(sheet),
      )
      check(
        'A8i the v2 empty states keep the dashed outline',
        /\.st-tr2-empty\{[^}]*dashed/.test(sheet),
      )
    } finally {
      undo()
    }
  }

  // ------------------------------------------------- B. no MutationObserver
  console.log('\n=== B. no MutationObserver: inject anyway, never throw ===')
  {
    const { doc, state } = makeDocument()
    const undo = withGlobals({ doc, Observer: null })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      const plugin = await loadClient()
      const { ctx } = makeCtx()
      let threw = null
      try {
        plugin.apply(ctx)
      } catch (e) {
        threw = e
      }
      check('B1 apply() does not throw without MutationObserver', threw === null, threw && threw.message)
      check('B2 the sheet is still injected', state.injected.length === 1 && doc.querySelector(SELECTOR) !== null, String(state.injected.length))
    } finally {
      undo()
    }
  }

  // ------------------------------------------------------- C. no document
  console.log('\n=== C. no document at all (vm tests / SSR): never throw ===')
  {
    const undo = withGlobals({ doc: null, Observer: null })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      const plugin = await loadClient()
      const { ctx } = makeCtx()
      let threw = null
      try {
        plugin.apply(ctx)
      } catch (e) {
        threw = e
      }
      check('C1 apply() does not throw without document', threw === null, threw && threw.message)
    } finally {
      undo()
    }
  }

  // ------------------------------------- D. guard must not burn its once-flag
  console.log('\n=== D. a no-document apply must NOT burn the guard\'s once-per-load flag ===')
  {
    const undo0 = withGlobals({ doc: null, Observer: null })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      const plugin = await loadClient()
      const { ctx } = makeCtx()
      // First apply with no document: inject fails, and (before v1.6.1) this
      // burned `stylesGuarded` before checking `stylesInHead`, disarming the
      // guard for the whole page life even though the sheet only arrives later.
      plugin.apply(ctx)
      const { doc, state } = makeDocument()
      const { MutationObserver, armed } = makeObserverClass()
      const undo1 = withGlobals({ doc, Observer: MutationObserver })
      try {
        plugin.apply(ctx) // the document arrives only now
        check('D2 the late document gets the sheet', state.injected.length === 1 && doc.querySelector(SELECTOR) !== null, String(state.injected.length))
        check('D3 the guard arms on the second apply (flag was not burned by the first)', armed.length === 2, String(armed.length))
        doc.querySelector(SELECTOR).remove()
        armed[0].fire()
        check('D4 the healed sheet is back in <head>', doc.querySelector(SELECTOR) !== null)
        check('D5 exactly one re-injection', state.injected.length === 2, String(state.injected.length))
      } finally {
        undo1()
      }
    } finally {
      undo0()
    }
  }

  // --------------------------------- E. migration of a legacy untagged sheet
  console.log('\n=== E. a pre-v1.6.1 UNTAGGED sheet already in <head> gets re-tagged in place ===')
  {
    const { doc, state } = makeDocument()
    const { MutationObserver, armed } = makeObserverClass()
    const undo = withGlobals({ doc, Observer: MutationObserver })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      // Pre-seed the head with a legacy sheet: correct data-plugin-css, but
      // no data-plugin — exactly what a hot-swapped long-lived page holds
      // after upgrading from v1.6.0.
      const legacy = doc.createElement('style')
      legacy.setAttribute('data-plugin-css', 'session-tree')
      legacy.textContent = '/* legacy untagged sheet */'
      doc.head.appendChild(legacy)
      const plugin = await loadClient()
      const { ctx } = makeCtx()
      plugin.apply(ctx)
      check('E1 no duplicate injection — the legacy sheet is reused', state.injected.length === 1, String(state.injected.length))
      check('E2 the legacy sheet is reachable via the documented selector', doc.querySelector(SELECTOR) === legacy)
      check(
        'E3 the legacy sheet now carries data-plugin=@orphiczhou/dsh-session-tree',
        legacy.attrs['data-plugin'] === '@orphiczhou/dsh-session-tree',
        String(legacy.attrs['data-plugin'] || null),
      )
      check('E4 the guard still arms (sheet counts as in-head)', armed.length === 2, String(armed.length))
      // A sheet already claimed by ANOTHER module must be left alone.
      const { doc: doc2, state: state2 } = makeDocument()
      const undo2 = withGlobals({ doc: doc2, Observer: makeObserverClass().MutationObserver })
      try {
        globalThis.__CAPTURED_SESSION_TREE__ = null
        const plugin2 = await loadClient()
        const claimed = doc2.createElement('style')
        claimed.setAttribute('data-plugin-css', 'session-tree')
        claimed.setAttribute('data-plugin', '@deepseek-ai/dsh-client-ui-workspace')
        claimed.textContent = '/* claimed by another module */'
        doc2.head.appendChild(claimed)
        plugin2.apply(ctx)
        check(
          'E5 a sheet claimed by another module is not re-tagged',
          claimed.attrs['data-plugin'] === '@deepseek-ai/dsh-client-ui-workspace',
          String(claimed.attrs['data-plugin']),
        )
        check('E6 and no duplicate sheet is injected for it', state2.injected.length === 1, String(state2.injected.length))
      } finally {
        undo2()
      }
    } finally {
      undo()
    }
  }

  // ------------------------------- F. a STALE sheet is refreshed in place
  console.log('\n=== F. a tagged-but-STALE sheet is refreshed to this bundle\'s CSS ===')
  {
    const { doc, state } = makeDocument()
    const { MutationObserver, armed } = makeObserverClass()
    const undo = withGlobals({ doc, Observer: MutationObserver })
    try {
      globalThis.__CAPTURED_SESSION_TREE__ = null
      // Measured live 2026-11-16: a long-lived page that had been hot-swapped
      // from v1.5 still held the OLD 6.9 KB sheet. The early return kept it, so
      // every v2 class (`.st-tr2-*`) stayed unstyled while the panel kept
      // rendering — the "bare text" regression. The sheet must be re-texted.
      const stale = doc.createElement('style')
      stale.setAttribute('data-plugin-css', 'session-tree')
      stale.setAttribute('data-plugin', '@orphiczhou/dsh-session-tree')
      stale.textContent = '/* v1.5 sheet: 6966 chars, no st-tr2-* rules */'
      doc.head.appendChild(stale)
      const plugin = await loadClient()
      const { ctx } = makeCtx()
      plugin.apply(ctx)
      check(
        'F1 the stale sheet is reused, not duplicated',
        state.injected.length === 1 && doc.querySelector(SELECTOR) === stale,
        String(state.injected.length),
      )
      check(
        'F2 its content is refreshed to this bundle\'s CSS (st-tr2 rules present)',
        stale.textContent.length > 5000 && /\.st-tr2-list\{/.test(stale.textContent),
        String(stale.textContent.length),
      )
      check(
        'F3 and the refresh keeps our module ownership',
        stale.attrs['data-plugin'] === '@orphiczhou/dsh-session-tree',
        String(stale.attrs['data-plugin'] || null),
      )
      check('F4 the guard still arms on the refreshed sheet', armed.length === 2, String(armed.length))
    } finally {
      undo()
    }
  }

  console.log(`\n==================== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ====================`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('style-guard run crashed:', error)
  process.exit(1)
})
