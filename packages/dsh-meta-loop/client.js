/**
 * @local/dsh-meta-loop client half — 胶囊入口 + 全屏面板覆盖层。
 * 架构参照 dsh-thoughtdag / dsh-session-tree(浮动胶囊切换 + same-origin iframe;
 * 面板由宿主半挂载于 /metaloop/)。模块契约与两者一致:factory 必须返回 module.exports,
 * 插件体经 exports.apply(ctx) 生效(全部 DOM 副作用在 apply 内,不在物化期)。
 * 胶囊策略:thoughtdag 的「对话|思维图」胶囊(.dsh-td-switch)存在 → 追加「元方法」按钮进同一胶囊
 * (td-tweak 缩排样式自动生效);5 秒内未出现(未装/未启用)→ 自立一枚独立胶囊,不阻塞任何东西。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-meta-loop',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports

    const PILL_SELECTOR = '.dsh-td-switch'
    const LABEL = '元方法'
    const CLIENT_REV = '2026-10-13x'   // 面板与开关归 meta-loop;入口按钮归胶囊插件(td-tweak),检测到即不自建
    /** 单实例仲裁:客户端半热更会残留上一实例的定时器(旧策略会把按钮抢回贴边胶囊)——
     *  以加载时刻为 rev,只有最新实例可以操作入口;旧实例的 reconcile/看门狗自动退场。 */
    const INSTANCE_TOKEN = `${CLIENT_REV}#${Date.now()}`
    const ctlOf = () => (typeof window !== 'undefined' ? window.__metaLoopCtl ?? null : null)
    function claimOwnership() {
      try {
        if (typeof window === 'undefined') return
        const cur = window.__metaLoopCtl
        if (!cur || String(cur.token) < INSTANCE_TOKEN) window.__metaLoopCtl = { token: INSTANCE_TOKEN, rev: CLIENT_REV }
      } catch (_) {}
    }
    const isOwner = () => { const c = ctlOf(); return !c || c.token === INSTANCE_TOKEN }

    /** 单例 UI 注册表(跨热更实例复用同一批 DOM):
     *  2026-10-13 实证——每个新实例都自建按钮/自立胶囊,13 次热更后 DOM 里躺了 13 个胶囊且新旧实例互抢,
     *  按钮在「贴边胶囊 ↔ 自立胶囊」间来回跳。注册表 + 清理历史遗留,保证全局只有一套入口。 */
    function uiRegistry() {
      if (typeof window === 'undefined') return null
      if (!window.__metaLoopUi) window.__metaLoopUi = { btn: null, ownPill: null, overlay: null, frame: null }
      return window.__metaLoopUi
    }

    /** 窗体菜单矩形(td-tweak 量的也是它):[role=menubar];退化到顶栏首个按钮容器。 */
    function menuRect() {
      try {
        for (const sel of ['[role="menubar"]', '[role="menubar"] > *', 'header [role="menubar"]']) {
          const el = document.querySelector(sel)
          if (!el) continue
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return r
        }
      } catch (_) {}
      return null
    }

    /** 真可见性(effect 与 inspect 共用;此前误放在 apply 内 → provider 读到 undefined,2026-10-13f 修):
     *  必须在视口内且 elementFromPoint 命中自己(未被别的层盖住)。 */
    function actuallyVisible(el) {
      try {
        const r = el.getBoundingClientRect()
        const vw = (typeof window !== 'undefined' && (window.innerWidth || document.documentElement.clientWidth)) || 0
        const vh = (typeof window !== 'undefined' && (window.innerHeight || document.documentElement.clientHeight)) || 0
        if (r.width < 8 || r.height < 8) return false
        if (r.right < 4 || r.bottom < 4 || r.left > vw - 4 || r.top > vh - 4) return false
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1)
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1)
        const hit = document.elementFromPoint(cx, cy)
        return !!(hit && (hit === el || el.contains(hit) || hit.contains(el)))
      } catch (_) { return false }
    }
    /** 「舒适可见」:整体留在视口内并留 8px 边距——贴边/半藏(实测 y=1009/视口 1032)不算,宁可用自立胶囊。 */
    function comfortablyVisible(el) {
      try {
        const r = el.getBoundingClientRect()
        const vw = (typeof window !== 'undefined' && (window.innerWidth || document.documentElement.clientWidth)) || 0
        const vh = (typeof window !== 'undefined' && (window.innerHeight || document.documentElement.clientHeight)) || 0
        return r.width >= 8 && r.height >= 8 && r.left >= 8 && r.top >= 8 && r.right <= vw - 8 && r.bottom <= vh - 8
      } catch (_) { return false }
    }
    /* 无硬依赖:cordis 上下文服务全部按需取用(inject 缺省 = 全量 ctx)。 */
    exports.inject = []
    exports.apply = (ctx) => {
      if (typeof document === 'undefined' || !document.head || !document.body) return
      const ui = uiRegistry()
      /* 样式表:已在 head 就不重复插(历史实例可能已插) */
      if (!document.querySelector('style[data-plugin-css="meta-loop"]')) {
        const css = document.createElement('style')
        css.setAttribute('data-plugin-css', 'meta-loop')
        css.textContent = `
.dsh-ml-btn{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.dsh-ml-btn:hover{background:#f3f4f6;color:#111827}
.dsh-ml-btn.active{background:#111827;color:#fff}
.dsh-ml-mark{display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;margin:0 6px 0 9px;flex:none}
.dsh-ml-switch{position:fixed;z-index:120;left:12px;bottom:56px;display:flex;align-items:center;gap:2px;-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px);box-shadow:0 2px 8px rgba(0,0,0,.10)}
/* 自立模式:按钮自带固定位——无论被哪个容器(含热更残留实例的旧胶囊)append,DOM 挪动都不改变视觉位置 */
.dsh-ml-btn.dsh-ml-btn--fixed{position:fixed;z-index:130;left:12px;bottom:56px;height:28px;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 2px 8px rgba(0,0,0,.10);-webkit-app-region:no-drag}
.dsh-ml-overlay{position:fixed;z-index:100;inset:var(--dsh-frame-top-clearance,0px) 0 0 0;background:#faf9f7}
.dsh-ml-overlay[hidden]{display:none}
.dsh-ml-overlay iframe{display:block;width:100%;height:100%;border:0}
`
        document.head.append(css)
      }

      /* 复用注册表中的既有 DOM(跨热更实例单例);入口只装在原胶囊里,不再自建容器 */
      let overlay = ui.overlay ?? document.querySelector('.dsh-ml-overlay')
      let frame = overlay ? overlay.querySelector('iframe') : null
      let btn = ui.btn ?? document.querySelector('.dsh-ml-btn') ?? null
      ui.overlay = overlay; ui.frame = frame; ui.btn = btn
      /** 历史版本遗留的自立容器(.dsh-ml-switch 是我自己的类)。旧实例的定时器会持续把按钮 append 进它们的容器,
       *  删容器只会触发「删了又建」的循环——改为就地扶正:把这些容器锚到可见位,并清掉 backdrop-filter
       *  (它会成为 fixed 子元素的包含块,导致按钮坐标错乱)。这样无论按钮被谁搬来搬去,视觉上都在可见处。 */
      const STRAY_STYLE = {
        position: 'fixed', left: '12px', bottom: '56px', top: 'auto', right: 'auto', transform: 'none', zIndex: '129',
        display: 'flex', alignItems: 'center',
        border: '1px solid #d1d5db', borderRadius: '999px', background: 'rgba(255,255,255,.96)', padding: '3px',
        backdropFilter: 'none', WebkitBackdropFilter: 'none',
      }
      const cleanupLegacyContainers = () => {
        const strays = Array.from(document.querySelectorAll('.dsh-ml-switch'))
        strays.forEach((el, i) => {
          if (i === 0) { for (const [k, v] of Object.entries(STRAY_STYLE)) { try { el.style[k] = v } catch (_) {} } ; return }
          try { if (btn && el.contains(btn)) document.body.append(btn); el.remove() } catch (_) {}
        })
      }

      function ensureOverlay() {
        if (overlay && overlay.isConnected) return
        overlay = document.createElement('section')
        overlay.className = 'dsh-ml-overlay'
        overlay.hidden = true
        overlay.innerHTML = '<iframe title="Meta Loop" data-src="/metaloop/"></iframe>'
        document.body.append(overlay)
        frame = overlay.querySelector('iframe')
        ui.overlay = overlay; ui.frame = frame
      }

      /* 每次打开都带 cache-bust 重载:面板是纯读视图(无本地状态),重载保证拿到最新代码/数据,
         避免「修复已上线但 iframe 还跑旧文档」(2026-10-13 实证:trig 修复后 iframe 仍是旧报错页)。 */
      function loadPanel() {
        if (!frame) return
        try { frame.src = `${frame.dataset.src}?v=${Date.now()}` } catch (_) {}
      }

      const setBtns = (active) => {
        document.querySelectorAll('.dsh-ml-btn').forEach((b) => { b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)) })
      }
      /** 开合状态广播:胶囊里的按钮(td-tweak 持有)据此同步 active 样式。 */
      function announce(openState) {
        try { window.dispatchEvent(new CustomEvent('meta-loop:state', { detail: { open: !!openState } })) } catch (_) {}
      }
      function open() {
        ensureOverlay()
        loadPanel()
        overlay.hidden = false
        setBtns(true)
        announce(true)
      }
      function close() { if (overlay) overlay.hidden = true; setBtns(false); announce(false) }
      function toggle() { if (overlay && !overlay.hidden) close(); else open() }

      /* 对外开关 API:胶囊插件(td-tweak)用 window.__metaLoopUi.toggle() 打开面板——
         入口按钮归胶囊插件所有,本插件只提供面板与开关(职责分离,彼此可独立禁用)。 */
      ui.open = open; ui.close = close; ui.toggle = toggle
      ui.isOpen = () => !!(overlay && !overlay.hidden)
      try { if (typeof window !== 'undefined') window.__metaLoopUi = ui } catch (_) {}
      try { window.addEventListener('meta-loop:toggle', () => toggle()) } catch (_) {}

      function makeButton() {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsh-ml-btn'
        b.setAttribute('aria-pressed', 'false')
        b.innerHTML = '<i class="dsh-ml-mark"></i>' + LABEL
        b.addEventListener('click', toggle)
        return b
      }

      /* 入口落位策略(2026-10-13 实证:thoughtdag 胶囊被 td-tweak 锚到视口底边 y≈1009~1032,只露 23px):
         仅当胶囊「舒适可见」(整体在视口内留边距)才并入;否则用自立胶囊(左侧栏底部上方,必可见)。
         每 3s 复检,布局/视图切换后自动迁移。 */
      /* 入口按钮:若胶囊里已有 td-tweak 提供的「元方法」按钮(.dsh-td-meta),本插件不再自建按钮,
         只负责面板;只有胶囊插件缺席时才用自带按钮兜底。 */
      const externalEntry = () => document.querySelector('.dsh-td-meta')
      const ensureButton = () => {
        if (externalEntry()) { if (btn) { try { btn.remove() } catch (_) {} ; btn = null; ui.btn = null } ; return null }
        if (!btn || !btn.isConnected) { btn = document.querySelector('.dsh-ml-btn') ?? makeButton(); ui.btn = btn }
        return btn
      }
      /* 菜单行定位:水平用 td-tweak 量出的菜单右缘(--td-tweak-left,实测 724px),垂直取顶栏菜单行高度。
         用户要求:入口与窗体菜单同一行、位于菜单右侧。 */
      const MENU_ROW_TOP = 7
      const menuRowLeft = () => {
        try {
          const v = parseFloat((window.getComputedStyle ? window.getComputedStyle(document.documentElement) : {}).getPropertyValue?.('--td-tweak-left') ?? '')
          if (isFinite(v) && v > 0) return Math.round(v)
        } catch (_) {}
        const m = menuRect()
        return m ? Math.round(m.right + 12) : 110
      }
      const menuRowStyle = () => ({
        position: 'fixed', top: `${MENU_ROW_TOP}px`, left: `${menuRowLeft()}px`, right: 'auto', transform: 'none', zIndex: '900',
        height: '28px', border: '1px solid #d1d5db', borderRadius: '999px', background: 'rgba(255,255,255,.96)',
        boxShadow: '0 2px 8px rgba(0,0,0,.10)', padding: '0 10px',
      })
      const FIXED_STYLE = menuRowStyle()
      const applyFixed = (el) => { try { for (const [k, v] of Object.entries(menuRowStyle())) el.style[k] = v } catch (_) {} }
      const clearFixed = (el) => { try { for (const k of Object.keys(FIXED_STYLE)) el.style[k] = '' } catch (_) {} }
      /** 是否已在菜单行右侧(用户要的位置):元素竖直中心落在顶栏菜单行带内、水平贴近菜单右缘。 */
      const atMenuRow = (el) => {
        try {
          const r = el.getBoundingClientRect()
          if (r.height <= 0) return false
          const wantLeft = menuRowLeft()
          const bandCenter = MENU_ROW_TOP + 14          // 顶栏菜单行带中心(≈21px)
          const center = r.top + r.height / 2
          return Math.abs(center - bandCenter) <= 16 && r.left >= wantLeft - 24 && r.left <= wantLeft + 260
        } catch (_) { return false }
      }

      /* 入口装进原胶囊(用户 2026-10-13 要求:不要自建替代品、别动原插件的东西)。
         但实测原胶囊被摆在左下角 y≈1009,压在侧栏页脚底下——连它自己的「对话/思维图」都不可见。
         td-tweak 的设计意图是「贴菜单左侧、top:7px」,故这里只做一件最小的事:
         胶囊整体不可见时,用内联样式把它扶回设计位置(fixed; top:7px; left:110px),让三个按钮一起可见。
         不删除、不替换原插件任何节点;若胶囊已在舒适位置则完全不动它。 */
      /* 扶正候选位:首选「与窗体菜单同一行、菜单右侧」(用户 2026-10-13 要求),其余为兜底;
         逐个做「几何+命中」测试,选第一个真正可用者——各层遮挡关系随窗口尺寸变化,与其猜,不如让代码自己试。 */
      const alignCandidates = (pill) => {
        const list = [{ top: `${MENU_ROW_TOP}px`, left: `${menuRowLeft()}px` }]
        const m = menuRect()
        const h = (pill && pill.getBoundingClientRect().height) || 28
        if (m) list.push({ top: `${Math.round(m.top + Math.max(0, (m.height - h) / 2))}px`, left: `${Math.round(m.right + 12)}px` })
        list.push(
          { top: '8px', left: '180px' },
          { top: '48px', left: `${menuRowLeft()}px` },
          { top: '104px', left: '110px' },
          { top: 'auto', bottom: '120px', left: '12px' },
        )
        return list.map((c) => ({ position: 'fixed', right: 'auto', transform: 'none', zIndex: '900', ...c }))
      }
      const rescuePill = (pill) => {
        if (!pill) return false
        const cands = alignCandidates(pill)
        if (comfortablyVisible(pill) && actuallyVisible(pill) && atMenuRow(pill)) return true
        for (const cand of cands) {
          try { for (const [k, v] of Object.entries(cand)) pill.style[k] = v } catch (_) {}
          if (comfortablyVisible(pill) && actuallyVisible(pill)) return true
        }
        try { for (const [k, v] of Object.entries(cands[0])) pill.style[k] = v } catch (_) {}
        return false
      }
      /** 无胶囊环境(未装/未启用 thoughtdag 与 td-tweak)才用的兜底:按钮直接挂 body + 菜单行固定位。 */
      const toBodyFallback = () => {
        if (!ensureButton()) return          // td-tweak 已提供入口 → 本插件不插手位置
        applyFixed(btn)
        if (btn.parentNode !== document.body) { try { document.body.append(btn) } catch (_) {} }
      }
      /** 兜底按钮装进胶囊(仅在 td-tweak 缺席时发生):装进去点不到就把胶囊扶到菜单行,再不行留在菜单行兜底位。 */
      const toPill = () => {
        const pill = document.querySelector(PILL_SELECTOR)
        if (!pill) return false
        if (!ensureButton()) return false    // 入口归 td-tweak
        clearFixed(btn)
        if (!pill.contains(btn)) pill.append(btn)
        if (comfortablyVisible(pill) && actuallyVisible(btn) && atMenuRow(pill)) return true
        rescuePill(pill)
        return comfortablyVisible(pill) && actuallyVisible(btn) && atMenuRow(pill)
      }
      const reconcile = () => {
        try {
          if (!isOwner()) return
          cleanupLegacyContainers()
          if (externalEntry()) return         // 胶囊插件已承载入口 → 本插件只管面板,不碰胶囊
          const pill = document.querySelector(PILL_SELECTOR)
          if (!pill) { toBodyFallback(); return }
          if (toPill()) { if (!atMenuRow(btn)) toBodyFallback(); return }
          toBodyFallback()
        } catch (e) { try { console.error('[meta-loop] reconcile failed', e) } catch (_) {} }
      }
      claimOwnership()
      ensureButton()
      reconcile()
      setInterval(reconcile, 3_000)

      registerInspect(ctx)

      /* 面板自愈看门狗:同源 iframe 里的旧文档若停在「加载失败」,每 15s 最多重载一次(带 cache-bust)。
         不依赖面板是否打开——滞留的隐藏 iframe 也要修好,这样下次点开即见正确内容。 */
      let lastHeal = 0
      setInterval(() => {
        try {
          if (!isOwner() || !frame) return
          const doc = frame.contentDocument
          if (!doc) return
          const app = doc.querySelector('#app')
          const text = String(app ? app.textContent ?? '' : '').trim()
          if (text.startsWith('加载失败') && Date.now() - lastHeal > 15_000) { lastHeal = Date.now(); loadPanel() }
        } catch (_) { /* 跨域/未就绪:忽略 */ }
      }, 10_000)
    }

    /** 客户端 Inspect Provider(session-tree 同款纪律):可选注入 cordisInspect——缺席静默跳过,
     *  绝不进硬 inject 数组(一个缺服务会整插件不加载)。查询返回面板/胶囊的活体 DOM 事实。 */
    function registerInspect(ctx) {
      try {
        if (!ctx || typeof ctx.inject !== 'function') return
        ctx.inject(['cordisInspect'], (scoped) => {
          const inspect = (scoped && scoped.cordisInspect) || (typeof ctx.get === 'function' ? ctx.get('cordisInspect') : undefined)
          if (!inspect || typeof inspect.register !== 'function') return
          return inspect.register({
            manifest: {
              id: 'meta-loop-ui',
              description: 'What the meta-loop pill entry and its /metaloop/ panel actually rendered, read from the live DOM.',
              methods: [{
                name: 'panel',
                description: 'Pill attachment, overlay state, iframe src, and the panel body text (first 400 chars) with its error/loop counts.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                outputSchema: {
                  type: 'object',
                  properties: {
                    clientRev: { type: 'string' },
                    pillAttached: { type: 'boolean' },
                    standalonePill: { type: 'boolean' },
                    overlayOpen: { type: 'boolean' },
                    iframeSrc: { type: 'string' },
                    panelLoaded: { type: 'boolean' },
                    panelError: { type: 'string' },
                    loopCards: { type: 'number' },
                    panelText: { type: 'string' },
                    entryMode: { type: 'string' },
                    entryOwner: { type: 'string' },
                    apiExposed: { type: 'boolean' },
                    buttonVisible: { type: 'boolean' },
                    buttonX: { type: 'number' },
                    buttonY: { type: 'number' },
                    pillHeight: { type: 'number' },
                    pillBottom: { type: 'number' },
                    pillComfortable: { type: 'boolean' },
                    pillVisible: { type: 'boolean' },
                    pillTop: { type: 'number' },
                    pillLeft: { type: 'number' },
                    menuTop: { type: 'number' },
                    menuRight: { type: 'number' },
                    menuHeight: { type: 'number' },
                    tweakLeftVar: { type: 'string' },
                    styleTagPresent: { type: 'boolean' },
                    ownCount: { type: 'number' },
                    ownPosition: { type: 'string' },
                    ownX: { type: 'number' },
                    ownY: { type: 'number' },
                    btnPosition: { type: 'string' },
                    btnInlineLeft: { type: 'string' },
                    viewportWidth: { type: 'number' },
                    viewportHeight: { type: 'number' },
                    checkedAt: { type: 'string' },
                  },
                  required: ['clientRev', 'pillAttached', 'standalonePill', 'overlayOpen', 'iframeSrc', 'panelLoaded', 'panelError', 'loopCards', 'panelText', 'entryMode', 'entryOwner', 'apiExposed', 'buttonVisible', 'buttonX', 'buttonY', 'pillHeight', 'pillBottom', 'pillComfortable', 'pillVisible', 'pillTop', 'pillLeft', 'menuTop', 'menuRight', 'menuHeight', 'tweakLeftVar', 'styleTagPresent', 'ownCount', 'ownPosition', 'ownX', 'ownY', 'btnPosition', 'btnInlineLeft', 'viewportWidth', 'viewportHeight', 'checkedAt'],
                  additionalProperties: false,
                },
              }],
            },
            query(method) {
              if (method !== 'panel') throw new Error(`unknown meta-loop-ui inspect method "${method}"`)
              const out = {
                clientRev: CLIENT_REV,
                pillAttached: false, standalonePill: false, overlayOpen: false, iframeSrc: '',
                panelLoaded: false, panelError: '', loopCards: 0, panelText: '',
                entryMode: '', entryOwner: '', apiExposed: false, buttonVisible: false, buttonX: 0, buttonY: 0,
                pillHeight: 0, pillBottom: 0, pillComfortable: false, pillVisible: false,
                pillTop: 0, pillLeft: 0, menuTop: 0, menuRight: 0, menuHeight: 0, tweakLeftVar: '',
                styleTagPresent: false, ownCount: 0, ownPosition: '', ownX: 0, ownY: 0, btnPosition: '', btnInlineLeft: '',
                viewportWidth: 0, viewportHeight: 0,
                checkedAt: new Date().toISOString(),
              }
              try {
                const external = document.querySelector('.dsh-td-meta')      // td-tweak 承载的入口
                const own = document.querySelector('.dsh-ml-btn')            // 本插件兜底入口
                const b = external ?? own
                out.entryOwner = external ? 'td-tweak' : own ? 'meta-loop' : 'none'
                try { out.apiExposed = !!(window.__metaLoopUi && typeof window.__metaLoopUi.toggle === 'function') } catch (_) { out.apiExposed = false }
                out.pillAttached = !!(b && b.closest('.dsh-td-switch'))
                out.standalonePill = !!(b && b.closest('.dsh-ml-switch'))
                out.entryMode = out.pillAttached ? (external ? 'pill(td-tweak)' : 'pill(meta-loop)') : out.standalonePill ? 'standalone' : (b ? 'floating' : 'missing')
                out.viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
                out.viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
                if (b) {
                  const r = b.getBoundingClientRect()
                  out.buttonX = Math.round(r.left); out.buttonY = Math.round(r.top); out.buttonVisible = actuallyVisible(b)
                  try { out.btnPosition = String((window.getComputedStyle ? window.getComputedStyle(b) : {}).position ?? '') } catch (_) { out.btnPosition = '?' }
                  out.btnInlineLeft = String(b.style?.left ?? '')
                }
                const pillEl = document.querySelector(PILL_SELECTOR)
                if (pillEl) {
                  const pr = pillEl.getBoundingClientRect()
                  out.pillHeight = Math.round(pr.height); out.pillBottom = Math.round(pr.bottom)
                  out.pillTop = Math.round(pr.top); out.pillLeft = Math.round(pr.left)
                  out.pillComfortable = comfortablyVisible(pillEl); out.pillVisible = actuallyVisible(pillEl)
                }
                const menu = menuRect()
                if (menu) { out.menuTop = Math.round(menu.top); out.menuRight = Math.round(menu.right); out.menuHeight = Math.round(menu.height) }
                try { out.tweakLeftVar = String((window.getComputedStyle ? window.getComputedStyle(document.documentElement) : {}).getPropertyValue?.('--td-tweak-left') ?? '') } catch (_) { out.tweakLeftVar = '?' }
                out.styleTagPresent = !!document.querySelector('style[data-plugin-css="meta-loop"]')
                const owns = document.querySelectorAll('.dsh-ml-switch')
                out.ownCount = owns.length
                const own0 = owns[0] ?? null
                if (own0) {
                  const or = own0.getBoundingClientRect()
                  out.ownX = Math.round(or.left); out.ownY = Math.round(or.top)
                  try { out.ownPosition = String((window.getComputedStyle ? window.getComputedStyle(own0) : {}).position ?? '') } catch (_) { out.ownPosition = '?' }
                }
                const ov = document.querySelector('.dsh-ml-overlay')
                out.overlayOpen = !!(ov && !ov.hidden)
                const frame = document.querySelector('.dsh-ml-overlay iframe')
                out.iframeSrc = frame ? String(frame.getAttribute('src') ?? frame.src ?? '') : ''
                // 同源 iframe:直接读面板活体 DOM
                const doc = frame && frame.contentDocument
                if (doc) {
                  const app = doc.querySelector('#app')
                  const text = String(app ? app.textContent ?? '' : '').replace(/\s+/g, ' ').trim()
                  out.panelLoaded = !!(app && text.length > 0)
                  out.panelError = text.startsWith('加载失败') ? text.slice(0, 200) : ''
                  out.loopCards = doc.querySelectorAll('details.loop').length
                  out.panelText = text.slice(0, 400)
                }
              } catch (e) {
                out.panelError = `inspect read failed: ${e && e.message ? e.message : String(e)}`
              }
              return out
            },
          })
        })
      } catch (e) {
        try { console.error('[meta-loop] inspect provider registration failed', e) } catch (_) {}
      }
    }

    return module.exports
  },
})
