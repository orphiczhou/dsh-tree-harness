/**
 * 契约测试(2026-10-13 启动冲突回归):
 *   ① 客户端半:factory 必须返回 module.exports 且带 apply——此前直接 DOM 副作用返回 undefined,
 *      客户端 Loader 物化出空插件 → 启动冲突(用户被迫禁用全部第三方插件)。
 *   ② 宿主半:apply(ctx) 必须注册 meta_loop 工具 + 3 条 web 路由,不得抛错。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** 极小 DOM stub:只覆盖 client.js 用到的面。 */
function fakeDom() {
  const makeEl = (tag) => {
    const el = {
      tagName: tag, children: [], attrs: {}, style: {}, dataset: {}, src: '', hidden: false, textContent: '', innerHTML: '',
      className: '', __parent: null,
      append(...kids) { for (const k of kids) { k.__parent = el } el.children.push(...kids) },
      setAttribute(k, v) { el.attrs[k] = v },
      getAttribute(k) { return el.attrs[k] ?? null },
      addEventListener() {},
      remove() { if (el.__parent) el.__parent.children = el.__parent.children.filter((c) => c !== el) },
      closest(sel) {
        const name = sel.replace(/^\./, '')
        let cur = el
        while (cur) { if (String(cur.className).split(/\s+/).includes(name)) return cur; cur = cur.__parent }
        return null
      },
      querySelector(sel) { return el.__find ? el.__find(sel) : null },
      querySelectorAll() { return [] },
    }
    return el
  }
  const head = makeEl('head')
  const body = makeEl('body')
  const pill = makeEl('div')
  pill.className = 'dsh-td-switch'
  const findBtn = () => pill.children.find((c) => c.className === 'dsh-ml-btn') ?? null
  body.__find = (sel) => (sel === '.dsh-td-switch' ? pill : sel === '.dsh-ml-btn' ? findBtn() : null)
  return {
    document: {
      head, body,
      createElement: makeEl,
      querySelector: (sel) => (sel === '.dsh-td-switch' ? pill : sel === '.dsh-ml-btn' ? findBtn() : null),
      querySelectorAll: () => [],
    },
    pill,
    body,
  }
}

test('client half:factory 返回 module.exports + apply;apply 把「元方法」按钮并入胶囊', async () => {
  const dom = fakeDom()
  globalThis.document = dom.document
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.setInterval = () => 0            // 看门狗定时器:测试里 stub,否则进程不退出
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } } }
  try {
    await import(`../client.js?cachebust=${Date.now()}`)
    assert.ok(captured, 'factory registered via window.__ModuleLoader__.load')
    assert.equal(captured.id, '@local/dsh-meta-loop')
    const exports = captured.factory()
    assert.equal(typeof exports, 'object', 'factory MUST return module.exports (此前返回 undefined → 启动冲突)')
    assert.equal(typeof exports.apply, 'function', 'exports.apply must exist (cordis 插件入口)')
    assert.ok(Array.isArray(exports.inject), 'exports.inject must be an array (cordis 契约)')
    exports.apply({})
    assert.equal(dom.pill.children.length, 1, '按钮并入 thoughtdag 胶囊(.dsh-td-switch)')
    const btn = dom.pill.children[0]
    assert.equal(btn.className, 'dsh-ml-btn')
    assert.ok(String(btn.innerHTML).includes('元方法'))
    assert.equal(dom.body.__find, body_findUnchanged(dom.body), 'body 未被覆盖')
  } finally {
    delete globalThis.document
    delete globalThis.window
    delete globalThis.MutationObserver
    delete globalThis.setInterval
  }
})

test('client half:cordisInspect 在场时注册 meta-loop-ui provider 且 query 返回全字段', async () => {
  const dom = fakeDom()
  globalThis.document = dom.document
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.setInterval = () => 0
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } } }
  try {
    await import(`../client.js?cachebust=${Date.now()}`)
    const exports = captured.factory()
    let provider = null
    const ctx = { inject: (services, cb) => { cb({ cordisInspect: { register: (p) => { provider = p; return () => {} } } }) }, get: () => undefined }
    exports.apply(ctx)
    assert.ok(provider, 'cordisInspect 在场时必须注册 provider')
    assert.equal(provider.manifest.id, 'meta-loop-ui')
    assert.equal(provider.manifest.methods[0].name, 'panel')
    const out = provider.query('panel')
    for (const k of provider.manifest.methods[0].outputSchema.required) {
      assert.ok(k in out, `query 返回必须含字段 ${k}`)
      assert.notEqual(out[k], undefined, `字段 ${k} 不得为 undefined(宿主通道拒收)`)
    }
    assert.equal(out.pillAttached, true, '按钮已在 thoughtdag 胶囊内')
    assert.equal(out.standalonePill, false)
    assert.throws(() => provider.query('nope'), /unknown meta-loop-ui inspect method/)
  } finally {
    delete globalThis.document
    delete globalThis.window
    delete globalThis.MutationObserver
    delete globalThis.setInterval
  }
})

const body_findUnchanged = (b) => b.__find

test('host half:apply(ctx) 注册 meta_loop 工具 + 3 条 web 路由,且不抛错', async () => {
  const tools = []
  const routes = []
  const effects = []
  const fakeCtx = {
    inject(services, cb) { cb({ tools: { register: (t) => tools.push(t) }, webServer: { register: (r) => { routes.push(r); return () => {} } } }) ; return () => {} },
    effect(fn) { effects.push(fn); fn() },
    get() { return undefined },
  }
  const mod = await import('../index.js')
  assert.equal(typeof mod.apply, 'function')
  mod.apply(fakeCtx)
  await new Promise((r) => setTimeout(r, 50))   // mountWebPanel 异步
  assert.equal(tools.length, 1, 'meta_loop 工具注册')
  assert.equal(tools[0].name, 'meta_loop')
  assert.equal(routes.length, 3, '3 条 web 路由(redirect/api/static)')
  const kinds = routes.map((r) => `${r.kind}:${r.path}`).sort()
  assert.deepEqual(kinds, ['exact:/metaloop', 'prefix:/metaloop', 'prefix:/metaloop/api'])
})
