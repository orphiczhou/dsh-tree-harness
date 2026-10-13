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
    const CLIENT_REV = '2026-10-13c'   // 客户端半版本:CSS/自愈/看门狗变更时递增,便于经 inspect 判定活体版本
    /* 无硬依赖:cordis 上下文服务全部按需取用(inject 缺省 = 全量 ctx)。 */
    exports.inject = []
    exports.apply = (ctx) => {
      if (typeof document === 'undefined' || !document.head || !document.body) return
      let overlay = null
      let frame = null

      const css = document.createElement('style')
      css.setAttribute('data-plugin-css', 'meta-loop')
      css.textContent = `
.dsh-ml-btn{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.dsh-ml-btn:hover{background:#f3f4f6;color:#111827}
.dsh-ml-btn.active{background:#111827;color:#fff}
.dsh-ml-mark{display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;margin:0 6px 0 9px;flex:none}
.dsh-ml-switch{position:fixed;z-index:120;top:12px;left:calc(60% + 150px);display:flex;align-items:center;gap:2px;transform:translateX(-50%);-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}
.dsh-ml-overlay{position:fixed;z-index:100;inset:var(--dsh-frame-top-clearance,0px) 0 0 0;background:#faf9f7}
.dsh-ml-overlay[hidden]{display:none}
.dsh-ml-overlay iframe{display:block;width:100%;height:100%;border:0}
`
      document.head.append(css)

      function ensureOverlay() {
        if (overlay) return
        overlay = document.createElement('section')
        overlay.className = 'dsh-ml-overlay'
        overlay.hidden = true
        overlay.innerHTML = '<iframe title="Meta Loop" data-src="/metaloop/"></iframe>'
        document.body.append(overlay)
        frame = overlay.querySelector('iframe')
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
      function open() {
        ensureOverlay()
        loadPanel()
        overlay.hidden = false
        setBtns(true)
      }
      function close() { if (overlay) overlay.hidden = true; setBtns(false) }
      function toggle() { if (overlay && !overlay.hidden) close(); else open() }

      function makeButton() {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsh-ml-btn'
        b.setAttribute('aria-pressed', 'false')
        b.innerHTML = '<i class="dsh-ml-mark"></i>' + LABEL
        b.addEventListener('click', toggle)
        return b
      }

      // ① 优先并入 thoughtdag 胶囊;② 观察期 60s(其客户端惰性加载,可能晚到):晚到的胶囊出现即迁移并入并销毁自立胶囊;
      //    ③ 观察期结束仍未出现 → 兜底自立独立胶囊(位置右移,避免与迟到的 thoughtdag 胶囊同点重叠)
      let ownPill = null
      const attachIntoPill = () => {
        const pill = document.querySelector(PILL_SELECTOR)
        if (!pill || pill.querySelector('.dsh-ml-btn')) return false
        const btn = document.querySelector('.dsh-ml-btn') ?? makeButton()
        pill.append(btn)                       // 迁移:已存在的按钮直接搬进真胶囊
        if (ownPill) { ownPill.remove(); ownPill = null }
        return true
      }
      if (!attachIntoPill()) {
        const btn = makeButton()
        const mo = new MutationObserver(() => { if (attachIntoPill()) mo.disconnect() })
        mo.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => {
          mo.disconnect()
          if (document.querySelector(PILL_SELECTOR)) { attachIntoPill(); return }   // 最后一搏
          if (document.querySelector('.dsh-ml-btn')) return
          ownPill = document.createElement('div')
          ownPill.className = 'dsh-ml-switch'
          ownPill.setAttribute('role', 'group')
          ownPill.append(btn)
          document.body.append(ownPill)
        }, 60_000)
      }

      registerInspect(ctx)

      /* 面板自愈看门狗:同源 iframe 里的旧文档若停在「加载失败」,每 15s 最多重载一次(带 cache-bust),
         让已上线的修复自动生效,不必等人手动刷新 iframe。 */
      let lastHeal = 0
      setInterval(() => {
        try {
          if (!frame || !overlay || overlay.hidden) return
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
                    checkedAt: { type: 'string' },
                  },
                  required: ['clientRev', 'pillAttached', 'standalonePill', 'overlayOpen', 'iframeSrc', 'panelLoaded', 'panelError', 'loopCards', 'panelText', 'checkedAt'],
                  additionalProperties: false,
                },
              }],
            },
            query(method) {
              if (method !== 'panel') throw new Error(`unknown meta-loop-ui inspect method "${method}"`)
              const out = {
                clientRev: CLIENT_REV,
                pillAttached: false, standalonePill: false, overlayOpen: false, iframeSrc: '',
                panelLoaded: false, panelError: '', loopCards: 0, panelText: '', checkedAt: new Date().toISOString(),
              }
              try {
                const btn = document.querySelector('.dsh-ml-btn')
                out.pillAttached = !!(btn && btn.closest('.dsh-td-switch'))
                out.standalonePill = !!(btn && btn.closest('.dsh-ml-switch'))
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
