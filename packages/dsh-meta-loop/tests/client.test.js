/**
 * 契约测试(2026-10-13 启动冲突回归):
 *   ① 客户端半:factory 必须返回 module.exports 且带 apply——此前直接 DOM 副作用返回 undefined,
 *      客户端 Loader 物化出空插件 → 启动冲突(用户被迫禁用全部第三方插件)。
 *   ② 宿主半:apply(ctx) 必须注册 meta_loop 工具 + 3 条 web 路由,不得抛错。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** 极小 DOM stub:只覆盖 client.js 用到的面(含几何/命中测试——可见性判定要用)。 */
function fakeDom() {
  const rectOf = (el) => {
    const cn = String(el.className)
    if (cn.includes('dsh-ml-btn')) {
      // 按钮几何随父胶囊(真实 DOM 语义):胶囊被摆到视口外时,按钮跟着出去
      let p = el.__parent
      while (p && !String(p.className).includes('dsh-td-switch')) p = p.__parent
      if (p) { const b = rectOf(p); return { left: b.left + 50, top: b.top + 3, width: 80, height: 28, right: b.left + 130, bottom: b.top + 31 } }
      return el.__rect ?? { left: 150, top: 15, width: 80, height: 28, right: 230, bottom: 43 }
    }
    if (el.__rect) return el.__rect
    if (cn.includes('dsh-td-switch')) return { left: 100, top: 12, width: 200, height: 34, right: 300, bottom: 46 }
    if (cn.includes('dsh-ml-switch')) return { left: 12, top: 948, width: 120, height: 34, right: 132, bottom: 982 }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
  }
  const makeEl = (tag) => {
    const el = {
      tagName: tag, children: [], attrs: {}, style: {}, dataset: {}, src: '', hidden: false, textContent: '', innerHTML: '',
      className: '', __parent: null, __rect: null,
      get isConnected() { return !!el.__parent },
      getBoundingClientRect() { return rectOf(el) },
      append(...kids) { for (const k of kids) { if (k.__parent && k.__parent !== el) k.__parent.children = k.__parent.children.filter((c) => c !== k); k.__parent = el; el.children.push(k) } },
      setAttribute(k, v) { el.attrs[k] = v },
      getAttribute(k) { return el.attrs[k] ?? null },
      addEventListener() {},
      remove() { if (el.__parent) el.__parent.children = el.__parent.children.filter((c) => c !== el); el.__parent = null },
      closest(sel) {
        const name = sel.replace(/^\./, '')
        let cur = el
        while (cur) { if (String(cur.className).split(/\s+/).includes(name)) return cur; cur = cur.__parent }
        return null
      },
      querySelector(sel) { return el.__find ? el.__find(sel) : null },
      querySelectorAll() { return [] },
      contains(other) { let cur = other; while (cur) { if (cur === el) return true; cur = cur.__parent } return false },
    }
    return el
  }
  const head = makeEl('head')
  const body = makeEl('body')
  const pill = makeEl('div')
  pill.className = 'dsh-td-switch'
  const findBtn = () => pill.children.find((c) => c.className === 'dsh-ml-btn') ?? body.children.map((p) => p.children?.find((c) => c.className === 'dsh-ml-btn')).find(Boolean) ?? null
  body.__find = (sel) => (sel === '.dsh-td-switch' ? pill : sel === '.dsh-ml-btn' ? findBtn() : null)
  return {
    document: {
      head, body,
      createElement: makeEl,
      querySelector: (sel) => (sel === '.dsh-td-switch' ? pill : sel === '.dsh-ml-btn' ? findBtn() : null),
      querySelectorAll: () => [],
      elementFromPoint: (x, y) => {
        const b = findBtn()
        if (b) { const r = rectOf(b); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b }
        return null
      },
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
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } }, innerWidth: 2555, innerHeight: 1032 }
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
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } }, innerWidth: 2555, innerHeight: 1032 }
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

test('client half:胶囊被摆到视口外(y=1032,视口高 1032) → 自动改用自立胶囊(2026-10-13 事故回归)', async () => {
  const dom = fakeDom()
  dom.pill.__rect = { left: 0, top: 1032, width: 2555, height: 28, right: 2555, bottom: 1060 }   // 实测坐标:root 底边之外
  globalThis.document = dom.document
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.setInterval = () => 0
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } }, innerWidth: 2555, innerHeight: 1032 }
  try {
    await import(`../client.js?cachebust=${Date.now()}`)
    const exports = captured.factory()
    exports.apply({})
    assert.equal(dom.pill.children.length, 0, '不可见的 thoughtdag 胶囊里不得留按钮')
    const own = dom.body.children.find((c) => c.className === 'dsh-ml-btn')
    assert.ok(own, '按钮必须直接挂 body(自立模式:脱离容器,fixed 才以视口为参照)')
    assert.equal(own.style.position, 'fixed', '内联固定定位(残留实例改不掉)')
    assert.equal(own.style.left, '12px')
    const r = own.getBoundingClientRect()
    assert.ok(r.top < 1032 && r.left < 2555, '自立位置在视口内')
  } finally {
    delete globalThis.document
    delete globalThis.window
    delete globalThis.MutationObserver
    delete globalThis.setInterval
  }
})

test('client half:胶囊贴底半藏(y=1006..1034,视口高 1032) → 就地扶正胶囊,入口留在胶囊内', async () => {
  const dom = fakeDom()
  dom.pill.__rect = { left: 0, top: 1006, width: 2555, height: 28, right: 2555, bottom: 1034 }   // 只露 26px,贴底
  globalThis.document = dom.document
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.setInterval = () => 0
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } }, innerWidth: 2555, innerHeight: 1032 }
  try {
    await import(`../client.js?cachebust=${Date.now()}`)
    const exports = captured.factory()
    exports.apply({})
    assert.equal(dom.pill.children.length, 1, '入口留在原胶囊内(用户要求:装进原胶囊,不自建替代品)')
    assert.equal(dom.pill.children[0].className, 'dsh-ml-btn')
    assert.equal(dom.pill.style.top, '48px', '胶囊不可用时就地扶正到标题栏下方(不改原插件内容)')
    assert.equal(exports.inject.length, 0)
  } finally {
    delete globalThis.document
    delete globalThis.window
    delete globalThis.MutationObserver
    delete globalThis.setInterval
  }
})

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
