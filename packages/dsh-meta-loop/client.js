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
    /* 无硬依赖:cordis 上下文服务全部按需取用(inject 缺省 = 全量 ctx)。 */
    exports.inject = []
    exports.apply = () => {
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
.dsh-ml-switch{position:fixed;z-index:120;top:12px;left:60%;display:flex;align-items:center;gap:2px;transform:translateX(-50%);-webkit-app-region:no-drag;border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}
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

      const setBtns = (active) => {
        document.querySelectorAll('.dsh-ml-btn').forEach((b) => { b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)) })
      }
      function open() {
        ensureOverlay()
        if (frame && !frame.src) frame.src = frame.dataset.src
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

      // ① 优先并入 thoughtdag 胶囊;② 竞速 5s,未出现则自立独立胶囊
      const attachIntoPill = () => {
        const pill = document.querySelector(PILL_SELECTOR)
        if (!pill || pill.querySelector('.dsh-ml-btn')) return false
        pill.append(makeButton())
        return true
      }
      if (!attachIntoPill()) {
        const mo = new MutationObserver(() => { if (attachIntoPill()) mo.disconnect() })
        mo.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => {
          mo.disconnect()
          if (document.querySelector('.dsh-ml-btn')) return
          const pill = document.createElement('div')
          pill.className = 'dsh-ml-switch'
          pill.setAttribute('role', 'group')
          pill.append(makeButton())
          document.body.append(pill)
        }, 5000)
      }
    }

    return module.exports
  },
})
