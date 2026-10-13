/**
 * @local/dsh-meta-loop client half — 胶囊入口 + 全屏面板覆盖层。
 * 架构参照 dsh-thoughtdag(浮动胶囊切换 + same-origin iframe;面板由宿主半挂载于 /metaloop/)。
 * 胶囊策略:thoughtdag 的「对话|思维图」胶囊(.dsh-td-switch)存在 → 追加「元方法」按钮进同一胶囊
 * (td-tweak 缩排样式自动生效);5 秒内未出现(未装/未开)→ 自立一枚独立胶囊,不阻塞任何东西。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-meta-loop',
  factory: () => {
    const PILL_SELECTOR = '.dsh-td-switch'
    const BTN = '元方法'
    let overlay = null
    let frame = null
    let myPill = null

    const css = document.createElement('style')
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

    function open() {
      ensureOverlay()
      if (frame && !frame.src) frame.src = frame.dataset.src
      overlay.hidden = false
      setBtns(true)
    }
    function close() { if (overlay) overlay.hidden = true; setBtns(false) }
    function toggle() { (overlay && !overlay.hidden) ? close() : open() }
    function setBtns(active) {
      document.querySelectorAll('.dsh-ml-btn').forEach((b) => { b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)) })
    }

    function makeButton() {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'dsh-ml-btn'
      b.setAttribute('aria-pressed', 'false')
      b.innerHTML = '<i class="dsh-ml-mark"></i>' + BTN
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
        if (!document.querySelector('.dsh-ml-btn')) {
          myPill = document.createElement('div')
          myPill.className = 'dsh-ml-switch'
          myPill.setAttribute('role', 'group')
          myPill.innerHTML = '<i class="dsh-ml-mark" style="margin:0 6px 0 9px"></i>'
          myPill.append(makeButton())
          document.body.append(myPill)
        }
      }, 5000)
    }
  },
})
