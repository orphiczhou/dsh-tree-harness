/**
 * Client half of the session-tree bundle.
 *
 * Renders the workspace's sessions as a tree in the LEFT SIDEBAR by occupying
 * the `sidebar.workspaces` single-slot seat at priority -100.
 *
 * The tree is grouped by WORKSPACE, which is what the shipped browser does and
 * what this plugin restores. `useWorkspaces` exposes the Host's ordered
 * `WorkspaceView[]` as `state.items`; a session belongs to the workspace whose
 * `sessionIds` lists it (NOT by `cwd` — that only gates attaching a session to
 * a workspace), and sessions no workspace accounts for collect in a synthetic
 * "Ungrouped" group rendered last. See `groupByWorkspace` in
 * `dsh-client-ui-workspace/lib/client.js:420-439`. Where the shipped browser
 * hides every `origin:'subagent'` row and shows a running-child count instead
 * (`:358`), this plugin keeps the descendants nested under their parent.
 *
 * Why -100: `dsh-client-ui-slots` elects the LOWEST priority for a `single`
 * slot (`lib/index.js:168-172`), and registering at an already-taken priority
 * THROWS at load. The shipped `WorkspaceBrowser` sits at priority 0, so -100
 * shadows it; disabling/unloading the plugin restores it untouched.
 *
 * Data comes entirely from slot props — no Host RPC:
 *   useSessions(sel) -> state.byId                : one row per Session
 *                       state.projectionsBySession : live projection snapshots
 * Those rows carry the lineage (`parentId` + `origin:'subagent'`), and the
 * shipped sidebar deliberately hides `origin:'subagent'` rows — so the whole
 * nested tree is already in the store; this plugin only stops hiding it.
 * `subagentCatalog` (projection) is used as a supplement for children whose
 * row is not in `byId`.
 *
 * Both row shapes are normalised: the client store row
 * (`{id, displayTitle, parentId, projectionValues, ...}`) and the Host
 * `SessionSummary` (`{sessionId, parentSessionId, projections:{values}}`).
 *
 * Opening reuses shipped navigation:
 *   root session -> ctx.uiWorkspace.openSession(sessionId)
 *   subagent     -> ctx.uiWorkspace.openSession({parentSessionId, childSessionId, mode})
 * An opened subagent renders the ordinary Conversation, so a continuable child
 * shows its multi-turn history and accepts human follow-up prompts.
 */
window.__ModuleLoader__.load({
  id: '@orphiczhou/dsh-session-tree',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useMemo, useCallback, useRef, useEffect } = React

    const MAX_CHILDREN = 300
    const MAX_DEPTH = 8
    const EMPTY = {}
    const EMPTY_ARR = []

    const CSS = `
.st-root{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px;color:var(--dsw-alias-label-primary)}
.st-head{display:flex;align-items:center;gap:6px;padding:8px 10px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;flex:none}
.st-head-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-count{flex:none;opacity:.7}
/* Workspace group row: the level the shipped browser groups sessions under. */
.st-group{font-weight:600;color:var(--dsw-alias-label-secondary);cursor:pointer}
.st-group:hover{color:var(--dsw-alias-label-primary)}
.st-folder{flex:none;width:13px;height:13px;opacity:.8}
.st-group-path{flex:none;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55;font-weight:400;font-size:11px}
.st-group-ungrouped{font-style:italic;font-weight:500}
/* Workspace ordering / hiding (v1.1.0). The hidden section sits at the end of
   the tree; its workspace headers carry the same "hidden" tag as the row. */
.st-group-section{color:var(--dsw-alias-label-tertiary)}
.st-group[data-hidden='true'] .st-label{opacity:.85}
.st-search{margin:0 8px 6px;flex:none}
.st-search input{width:100%;box-sizing:border-box;padding:4px 8px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;outline:none}
.st-scroll{overflow:auto;min-height:0;flex:1;padding:0 6px 12px}
.st-row{display:flex;align-items:center;gap:5px;border-radius:var(--dsw-radius-sm);padding:3px 6px;min-height:24px;cursor:pointer;user-select:none;position:relative}
.st-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.st-twist{flex:none;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);background:none;border:0;padding:0;cursor:pointer;transition:transform .12s;font-size:9px;line-height:1}
.st-twist.st-open{transform:rotate(90deg)}
.st-twist.st-empty{visibility:hidden}
.st-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.st-dot[data-state='idle']{background:var(--dsw-alias-state-idle-primary)}
.st-dot[data-state='ongoing']{background:var(--dsw-static-blue-500,#3b82f6);animation:st-pulse 1.6s ease-in-out infinite}
.st-dot[data-state='done']{background:var(--dsw-alias-state-success-primary)}
.st-dot[data-state='warning']{background:var(--dsw-alias-state-warn-primary)}
.st-dot[data-state='error']{background:var(--dsw-alias-state-error-primary)}
@keyframes st-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@media (prefers-reduced-motion: reduce){.st-dot[data-state='ongoing']{animation:none}}
.st-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-label-fallback{opacity:.6}
.st-tag{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary);opacity:.85;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:0 4px;line-height:15px}
/* Session metadata in the CONVERSATION UI (v1.4.0). The sidebar tree stays a
   pure session tree; the metadata lives where the user asked for it - under the
   conversation. st-meta-strip is the composer-dock row for addressed child
   sessions (the shipped ModelSelect/ContextMeter are unavailable there);
   st-meta-chip is the header-utilities fallback for read-only children whose
   composer is replaced. Theme tokens keep light/dark consistent. */
.st-meta-strip{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-width:0;overflow:hidden;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}
.st-meta-item{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-meta-item:first-child{max-width:24ch}
.st-meta-pct{flex:none;color:var(--dsw-alias-label-tertiary)}
.st-meta-pct[data-level='warn']{color:var(--dsw-alias-state-warn-primary)}
.st-meta-pct[data-level='error']{color:var(--dsw-alias-state-error-primary)}
.st-meta-chip{font-size:11px;line-height:15px;gap:6px;opacity:.9}
.st-meta-chip .st-meta-item:first-child{max-width:20ch}
.st-note{padding:3px 6px 3px 31px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.st-err{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.st-rail{display:flex;align-items:center;justify-content:center;height:100%;cursor:pointer;color:var(--dsw-alias-label-tertiary);background:none;border:0;width:100%}
.st-new{flex:none;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;line-height:1;padding:0}
.st-new:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.st-aside{flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;line-height:1;padding:0;opacity:.35}
.st-row:hover .st-aside{opacity:1}
.st-aside:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.st-head{position:relative}
.st-menu-backdrop{position:fixed;inset:0;z-index:40}
.st-menu{position:absolute;top:100%;right:6px;z-index:41;min-width:170px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px}
.st-menu-title{padding:5px 8px 2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.st-menu-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:none;border:0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 8px;cursor:pointer}
.st-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.st-menu-check{width:12px;flex:none;color:var(--dsw-alias-brand-primary)}
.st-more{flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:1;padding:0;opacity:0}
.st-row:hover .st-more,.st-more[aria-expanded='true']{opacity:1}
.st-more:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.st-rowmenu{position:absolute;right:4px;top:100%;z-index:41;min-width:150px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px}
.st-rename{flex:1;min-width:0;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:1px 4px;outline:none}
/* Tree Runs panel (composer-dock pill + right-sidebar tab + degraded
   shell.overlay). Same theme tokens as the rest of this sheet; the running
   blue keeps the .st-dot[data-state='ongoing'] literal-fallback precedent. */
.st-tr-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:600 12px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}
.st-tr-pill:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.st-tr-pill[data-open='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.st-tr-pill-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.st-tr-root{display:flex;flex-direction:column;min-height:0;height:100%;font-size:12px;color:var(--dsw-alias-label-primary)}
.st-tr-top{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.st-tr-top-title{flex:none;font-weight:600;font-size:12px}
.st-tr-top-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}
.st-tr-top-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.st-tr-btn{height:24px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:500 12px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}
.st-tr-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.st-tr-card{display:block;width:100%;box-sizing:border-box;text-align:left;background:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);padding:8px 10px;cursor:pointer;color:inherit;font:inherit}
.st-tr-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.st-tr-card-top{display:flex;align-items:center;gap:8px;min-width:0}
.st-tr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-tr-card-id{flex:1;min-width:0;font-weight:600}
.st-tr-dots{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:10px;font-variant-numeric:tabular-nums}
.st-tr-dot{display:inline-block;width:7px;height:7px;border-radius:50%;vertical-align:middle}
.st-tr-dot[data-tone='running']{background:var(--dsw-static-blue-500,#3b82f6)}
.st-tr-dot[data-tone='succeeded']{background:var(--dsw-alias-state-success-primary)}
.st-tr-dot[data-tone='failed']{background:var(--dsw-alias-state-error-primary)}
.st-tr-dot[data-tone='other']{background:var(--dsw-alias-state-idle-primary)}
.st-tr-meta{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-tr-preview{margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.st-tr-note{padding:10px 2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.st-tr-note[data-kind='error']{color:var(--dsw-alias-state-error-primary)}
.st-tr-head{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.st-tr-section{padding:8px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;flex:none}
.st-tr-tablewrap{padding:0 10px 4px;overflow-x:auto;flex:none}
.st-tr-row{display:grid;grid-template-columns:minmax(110px,1.3fr) minmax(74px,.9fr) 52px minmax(64px,.8fr) 44px 48px minmax(60px,.8fr);gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:520px}
.st-tr-row[data-kind='head']{color:var(--dsw-alias-label-tertiary);font-size:10px;border-bottom-color:var(--dsw-alias-border-l2)}
.st-tr-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.st-tr-badge{display:inline-block;max-width:100%;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-state-idle-primary);color:var(--dsw-alias-state-idle-primary);font-size:10px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-tr-badge[data-tone='running']{border-color:var(--dsw-static-blue-500,#3b82f6);color:var(--dsw-static-blue-500,#3b82f6)}
.st-tr-badge[data-tone='succeeded']{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.st-tr-badge[data-tone='failed']{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.st-tr-verif[data-pass='true']{color:var(--dsw-alias-state-success-primary)}
.st-tr-verif[data-pass='false']{color:var(--dsw-alias-state-error-primary)}
.st-tr-events{padding:0 10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.st-tr-event{display:flex;gap:8px;min-width:0}
.st-tr-event .st-tr-mono{flex:none}
.st-tr-event-type{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-brand-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.st-tr-overlay{position:fixed;inset:0;z-index:60;background:var(--dsw-alias-bg-overlay);display:flex;flex-direction:column;padding:12px;box-sizing:border-box}
.st-tr-overlay-head{display:flex;align-items:center;gap:8px;padding:0 0 8px;flex:none}
.st-tr-overlay-title{flex:1;min-width:0;font-weight:600;font-size:13px}
/* Tree Runs panel v2: split-pane read-only projection (list left / detail
   right, no Back). st-tr2-* namespace per panel-v2 design §4; colors only
   through --dsw-alias-* tokens. */
.st-tr2-top{display:flex;align-items:center;gap:8px;padding:8px 10px;flex:0 0 auto;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.st-tr2-title{flex:none;font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)}
.st-tr2-dim{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}
.st-tr2-version{flex:none;padding:0 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font:500 10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:15px}
.st-tr2-body{flex:1 1 auto;display:flex;flex-direction:row;align-items:stretch;min-height:0}
.st-tr2-list{flex:0 0 36%;min-width:150px;max-width:320px;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;border-right:1px solid var(--dsw-alias-border-l1)}
.st-tr2-detail{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.st-tr2-empty{padding:12px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px}
.st-tr2-fieldgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 16px}
.st-tr2-field{display:flex;gap:8px;align-items:baseline;min-width:0}
.st-tr2-fieldlabel{flex:0 0 auto;min-width:84px;color:var(--dsw-alias-label-secondary);font-size:11px}
.st-tr2-fieldvalue{min-width:0;word-break:break-all;color:var(--dsw-alias-label-primary);font-size:12px}
.st-tr2-fieldvalue.st-tr-mono{font-size:11px}
.st-tr2-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px}
.st-tr2-section-title{font-weight:600;font-size:12px;margin-bottom:6px;color:var(--dsw-alias-label-primary)}
.st-tr2-graphbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.st-tr2-graphbtn{padding:2px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:18px}
.st-tr2-graphsection{flex:0 0 auto}
.st-tr2-viewport{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-height:120px;max-height:900px;overflow:auto;touch-action:none;cursor:grab}
.st-tr2-graphresize{height:10px;margin:2px 0;display:flex;align-items:center;justify-content:center;cursor:ns-resize;border-radius:6px}
.st-tr2-graphresize::before{content:'';width:46px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l1)}
.st-tr2-graphresize:hover::before{background:var(--dsw-alias-brand-primary)}
.st-tr2-hint{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}
.st-tr2-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.st-tr2-event-seq{flex:none;color:var(--dsw-alias-label-secondary)}
.st-tr2-sessid{user-select:text}
.st-tr2-copybtn{height:20px;padding:0 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-brand-primary);font:500 11px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}
.st-tr2-svg{display:block}
.st-tr2-node text{user-select:none}
.st-tr2-node{cursor:pointer}
.st-tr2-node:hover rect:first-of-type{filter:brightness(1.06)}
.st-tr-row[data-kind='leaf']{cursor:pointer}
.st-tr-row[data-kind='leaf']:hover{background:var(--dsw-alias-bg-layer-1)}
.st-tr-row[data-kind='leaf'][data-selected='true']{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.st-tr2-leafdetail-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.st-tr2-leafgrid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.st-tr2-edge{pointer-events:none}
.st-tr-card[data-selected='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
`

    /**
     * Composer-dock pill, copied value-for-value from the Flow Runs entry that
     * ships next to us (`@local/dsh-flow-engine` spike client, `styles.pill` /
     * `styles.pillActive` / `styles.dot`): inline style objects, no stylesheet
     * dependency. Inline wins over any host rule that targets dock buttons, so
     * the pill looks identical to Flow Runs even when our `<style>` sheet is
     * absent — and it is the reason flow never shows this class of bug.
     */
    const DOCK_PILL = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '26px',
      padding: '0 10px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: '600 12px system-ui, -apple-system, "Segoe UI", sans-serif',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const DOCK_PILL_OPEN = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '26px',
      padding: '0 10px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-brand-primary)',
      background: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-bg-base)',
      font: '600 12px system-ui, -apple-system, "Segoe UI", sans-serif',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const DOCK_PILL_DOT = {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: 'var(--dsw-alias-brand-primary)',
      display: 'inline-block',
    }

    /**
     * Stylesheet identity, following the convention the shipped client packages
     * use (`document.querySelector('style[data-plugin-css="…"]')`): the sheet
     * lives in <head>, injected once, and is not part of the render output.
     *
     * History: this module used to render `h('style', null, CSS)` as a React child
     * of the root div. That is a live DOM node owned by React reconciliation, and
     * it went MISSING in a running page while the component tree itself stayed
     * mounted — observed live: the markup and every `st-*` class were present, the
     * `<body>` contained no `<style>` at all, and the unstyled inline folder SVG
     * blew up to 262x262, breaking the whole tree layout. A stylesheet the shell
     * renders must not depend on React keeping one child alive.
     *
     * Ownership (v1.6.1): the browser-half module loader
     * (@deepseek-ai/dsh-client-modules) treats `<style>` nodes without a
     * `data-plugin` attribute as unowned: `untaggedStyles()` /
     * `claimStyles(ownerId, before)` re-tags every sheet that appears during a
     * module's materialize window to that module, and `removeOwnedStyles(id)`
     * deletes all sheets tagged `data-plugin=id` whenever that module is
     * replaced, pruned, or fails to materialize. An untagged sheet injected
     * during someone else's window is therefore legally stolen and later
     * dropped — the live Tree Runs panel rendered as bare text on 2026-11-16
     * through exactly this path. Every shipped package self-tags its sheets at
     * creation (e.g. dsh-client-ui-theme: `tag.dataset.plugin =
     * '@deepseek-ai/dsh-client-ui-theme'`); we do the same with the id this
     * module registers under (`window.__ModuleLoader__.load({ id: MODULE_ID,
     * … })` → ownerId after the loader strips a `/client` suffix). Claiming
     * skips tagged sheets, and only our own lifecycle can retire ours — the
     * next generation re-injects before the panel repaints.
     */
    const MODULE_ID = '@orphiczhou/dsh-session-tree'
    const STYLE_TAG = 'session-tree'
    const STYLE_SELECTOR = 'style[data-plugin-css="' + STYLE_TAG + '"]'
    /** True once the sheet is in <head>; the React child is only a fallback. */
    let stylesInHead = false

    /**
     * Put the stylesheet in <head> once. Idempotent, and safe to call before the
     * first render, so the tree never paints unstyled.
     * @returns whether the sheet is in the head (false → caller should fall back).
     */
    function ensureStylesheet() {
      try {
        if (typeof document === 'undefined' || !document.head) return false
        const existing = document.querySelector(STYLE_SELECTOR)
        if (existing !== null) {
          // Migration: a pre-v1.6.1 page can still hold an UNTAGGED sheet —
          // a hot module swap keeps the old sheet (it matches this selector,
          // so the early return would otherwise keep it unowned forever, and
          // the 2026-11-16 bare-text regression starts exactly there). Re-tag
          // it in place unless another module already claimed it (it then
          // carries that module's `data-plugin`, which we must not overwrite).
          if (!existing.getAttribute('data-plugin')) existing.setAttribute('data-plugin', MODULE_ID)
          // Refresh a STALE sheet: a page that predates this bundle keeps the
          // old <style> alive across hot swaps (it matches STYLE_SELECTOR), and
          // the early return below would then pin the OLD css for the rest of
          // the page life. Measured live 2026-11-16: head held 6966 chars of
          // the v1.5 sheet while this bundle carries 15754 → every v2 class
          // (st-tr2-*, the pill's data-open state) silently unstyled. Replacing
          // the text is idempotent and cheap (one string compare).
          if (existing.textContent !== CSS) existing.textContent = CSS
          return true
        }
        const el = document.createElement('style')
        el.setAttribute('data-plugin-css', STYLE_TAG)
        // Style-ownership contract of the client-module loader: a sheet must
        // carry `data-plugin=<registered module id>` or it is "unowned" and
        // can be re-tagged into another module's ownership by claimStyles()
        // and removed by that module's replace/prune (see block comment on
        // STYLE_TAG). Keep this attribute identical to the load() id.
        el.setAttribute('data-plugin', MODULE_ID)
        el.textContent = CSS
        document.head.appendChild(el)
        return true
      } catch (e) {
        return false
      }
    }

    /**
     * Self-heal for the stylesheet itself. v1.0.3 took the sheet out of React's
     * hands, but a long-lived page can still lose it some other way (a hot
     * client-module swap, some other code's cleanup sweeping <head>) — and the
     * failure mode is exactly the silent one measured in the live sidebar:
     * every `st-*` class present, nothing matching them. So once the sheet is
     * genuinely in <head>, watch for its removal and put it straight back.
     *
     * Two narrow `childList` observers (never `subtree`) cover both ways the
     * sheet can vanish:
     *   - `document.head`            → someone removed our <style> child;
     *   - `document.documentElement` → the entire <head> got replaced.
     * The callback does exactly one thing: re-query and re-inject when absent.
     * That is self-limiting (the re-injection fires the observer once more, the
     * query now hits, nothing further happens) and cheap (no <body> watch).
     *
     * Armed at most once per module load (`stylesGuarded`), and only after a
     * real injection (`stylesInHead`) — `ensureStylesheet` stays a pure
     * inject-once query-or-append, so re-running it can never double-arm the
     * guard. Where the platform cannot support it (no `document`, no
     * `MutationObserver`: the vm test sandbox, old browsers) the guard silently
     * does nothing and rendering keeps the inline-<style> fallback.
     */
    let stylesGuarded = false
    function guardStylesheet() {
      if (stylesGuarded) return
      // v1.6.1: probe the sheet BEFORE burning the once-per-load flag. The old
      // order set `stylesGuarded = true` first, so a call that arrived before a
      // successful injection (no `document` yet, or the inject fallback path)
      // armed nothing and disarmed the guard for the rest of the page life —
      // exactly the silent, unhealed loss this guard exists to prevent.
      if (!stylesInHead) return
      stylesGuarded = true
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
      const reassert = () => {
        if (document.querySelector(STYLE_SELECTOR) === null) ensureStylesheet()
      }
      try {
        if (document.head) new MutationObserver(reassert).observe(document.head, { childList: true })
        if (document.documentElement) {
          new MutationObserver(reassert).observe(document.documentElement, { childList: true })
        }
      } catch (e) {}
    }

    const DICT = {
      en: {
        title: 'Sessions',
        search: 'Filter sessions…',
        empty: 'No sessions in this workspace',
        none: 'No matches',
        noChildren: 'No subagents',
        ungrouped: 'Ungrouped',
        subagent: 'sub',
        more: '{n} more omitted',
        expand: 'Expand sidebar',
        newSession: 'New session',
        openAside: 'Open in right sidebar',
        stOngoing: 'Running',
        stDone: 'Completed — not viewed yet',
        stIdle: 'Completed and viewed',
        stWarning: 'Waiting for your answer',
        viewOptions: 'View options',
        orderBy: 'Order by',
        orderUpdated: 'Last updated',
        orderTitle: 'Title',
        archivedBy: 'Archived sessions',
        archHide: 'Hide archived',
        archShow: 'Show archived',
        archOnly: 'Archived only',
        expandAll: 'Expand all',
        collapseAll: 'Collapse all',
        reloadTitles: 'Reload titles',
        workspaceOrderBy: 'Workspace order',
        wsOrderRecent: 'Most recent activity',
        wsOrderHost: 'Host order',
        hiddenWsBy: 'Hidden workspaces',
        hiddenWsHide: 'Hide',
        hiddenWsSection: 'Show as section',
        hiddenWsOnly: 'Only hidden',
        hiddenSection: 'Hidden workspaces ({n})',
        hiddenTag: 'hidden',
        hideWorkspace: 'Hide this workspace',
        restoreWorkspace: 'Restore this workspace',
        rowMenu: 'Row actions',
        pin: 'Pin',
        unpin: 'Unpin',
        rename: 'Rename',
        fork: 'Fork session',
        archive: 'Archive',
        unarchive: 'Unarchive',
        titlePending: 'Title not loaded yet — showing a delegation label or folder name instead',
        model: 'Model',
        effort: 'Reasoning effort',
        effortDefault: 'default',
        contextUsage: 'Context {pct}% ({used} of {window} tokens)',
      },
      zh: {
        title: '会话树',
        search: '筛选会话…',
        empty: '此工作区暂无会话',
        none: '无匹配项',
        noChildren: '无子会话',
        ungrouped: '未分组',
        subagent: '子',
        more: '另有 {n} 个未显示',
        expand: '展开侧栏',
        newSession: '新建会话',
        openAside: '在右侧栏打开',
        stOngoing: '进行中',
        stDone: '已完成（还未看过）',
        stIdle: '已完成且已看过',
        stWarning: '正在等你回应',
        viewOptions: '视图选项',
        orderBy: '排序方式',
        orderUpdated: '最近更新',
        orderTitle: '按名称',
        archivedBy: '已归档会话',
        archHide: '隐藏已归档',
        archShow: '全部对话（显示已归档）',
        archOnly: '仅显示已归档',
        expandAll: '展开全部',
        collapseAll: '全部折叠',
        reloadTitles: '重新加载标题',
        workspaceOrderBy: '工作区排序',
        wsOrderRecent: '最近活动',
        wsOrderHost: 'Host 顺序',
        hiddenWsBy: '已隐藏工作区',
        hiddenWsHide: '隐藏',
        hiddenWsSection: '显示为分区',
        hiddenWsOnly: '仅显示已隐藏',
        hiddenSection: '已隐藏工作区 ({n})',
        hiddenTag: '已隐藏',
        hideWorkspace: '隐藏此工作区',
        restoreWorkspace: '恢复显示',
        rowMenu: '会话操作',
        pin: '置顶',
        unpin: '取消置顶',
        rename: '重命名',
        fork: 'Fork 分支会话',
        archive: '归档',
        unarchive: '取消归档',
        titlePending: '标题尚未加载——这里显示的是委派标签或目录名',
        model: '模型',
        effort: '思考强度',
        effortDefault: '默认',
        contextUsage: '上下文占用 {pct}%（{used}/{window} tokens）',
      },
    }

    function makeT(bound) {
      return function t(key, vars) {
        let s
        try {
          s = bound ? bound(key) : undefined
        } catch (e) {
          s = undefined
        }
        if (typeof s !== 'string' || s === key) s = DICT.zh[key] !== undefined ? DICT.zh[key] : key
        if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]))
        return s
      }
    }

    const shortId = (id) => String(id == null ? '' : id).replace(/^session-/, '').slice(0, 8)
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)

    /**
     * When a session was last active, as far as the client store can tell:
     * `updatedAt` first, `createdAt` as the documented fallback. Used only to
     * order WORKSPACES by their most recent member (v1.1.0); a session row that
     * carries neither sorts oldest, which keeps the order stable rather than
     * inventing an activity time.
     */
    const activityOf = (n) => {
      if (!n) return 0
      const updated = num(n.updatedAt)
      if (updated > 0) return updated
      // Some row shapes expose the last-event time instead of `updatedAt`.
      // Only NUMBERS are accepted, so an ISO string can never poison the order.
      const lastEvent = num(n.lastEventAt) || num(n.raw && n.raw.lastEventAt)
      if (lastEvent > 0) return lastEvent
      return num(n.createdAt)
    }

    /**
     * Client-side workspace view state (feature spec 2026-11-11 §B.3).
     *
     * The Host has no workspace archive/hide API (`workspaceController` only
     * offers create/rename/delete/insert/archiveSession/unarchiveSession/pin…),
     * so ordering, hiding and the hidden-section mode live in this plugin and
     * are mirrored into `localStorage`. Every access is best-effort: private
     * mode, an embedding page, or a test sandbox without storage simply keeps
     * the state in memory instead of throwing.
     */
    const LS_HIDDEN_WORKSPACES = 'session-tree:hiddenWorkspaces'
    const LS_WORKSPACE_ORDER = 'session-tree:workspaceOrder'
    const LS_HIDDEN_MODE = 'session-tree:hiddenWorkspacesMode'
    /** Group key of the synthetic "Hidden workspaces" section at the very end. */
    const HIDDEN_SECTION_KEY = '#hidden-workspaces'
    const WORKSPACE_ORDERS = ['recent', 'host']
    const HIDDEN_MODES = ['hide', 'section', 'only']

    /** The page's localStorage, or null where it is absent or access-throwing. */
    function localStore() {
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) return window.localStorage
      } catch (e) {}
      try {
        if (typeof localStorage !== 'undefined' && localStorage) return localStorage
      } catch (e) {}
      return null
    }

    /** Non-throwing read; a missing or corrupt value degrades to null. */
    function storageRead(key) {
      try {
        const s = localStore()
        if (!s || typeof s.getItem !== 'function') return null
        const v = s.getItem(key)
        return typeof v === 'string' ? v : null
      } catch (e) {
        return null
      }
    }

    /** Best-effort write; returns whether it was mirrored. Never throws. */
    function storageWrite(key, value) {
      try {
        const s = localStore()
        if (!s || typeof s.setItem !== 'function') return false
        s.setItem(key, value)
        return true
      } catch (e) {
        return false
      }
    }

    /** Persisted workspace order: 'recent' (default) or 'host'. */
    function loadWorkspaceOrder() {
      const v = storageRead(LS_WORKSPACE_ORDER)
      return WORKSPACE_ORDERS.indexOf(v) >= 0 ? v : 'recent'
    }

    /** Persisted hidden-section mode: 'hide' (default), 'section' or 'only'. */
    function loadHiddenMode() {
      const v = storageRead(LS_HIDDEN_MODE)
      return HIDDEN_MODES.indexOf(v) >= 0 ? v : 'hide'
    }

    /** Persisted hidden workspace ids; deduped, and never a hard failure. */
    function loadHiddenWorkspaces() {
      const raw = storageRead(LS_HIDDEN_WORKSPACES)
      if (!raw) return EMPTY_ARR
      try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return EMPTY_ARR
        const out = []
        for (const v of parsed) {
          if (typeof v === 'string' && v && out.indexOf(v) < 0) out.push(v)
        }
        return out
      } catch (e) {
        return EMPTY_ARR
      }
    }

    /** Mirror the hidden set into localStorage (memory is still the truth). */
    function saveHiddenWorkspaces(ids) {
      const list = []
      try {
        for (const v of ids) if (typeof v === 'string' && v) list.push(v)
      } catch (e) {}
      return storageWrite(LS_HIDDEN_WORKSPACES, JSON.stringify(list))
    }

    /**
     * Display label for one `WorkspaceView`: its stored title, else the basename
     * of its path — the same fallback the shipped browser uses
     * (`dsh-client-ui-workspace/lib/client.js:268-272` `workspaceLabel`).
     */
    function workspaceLabel(w, fallback) {
      const title = w && typeof w.title === 'string' ? w.title.trim() : ''
      if (title) return title
      const p = w && typeof w.path === 'string' ? w.path : ''
      const parts = p.split(/[\\/]+/).filter(Boolean)
      if (parts.length) return parts[parts.length - 1]
      return fallback
    }

    /** Client store row OR Host SessionSummary -> the fields the tree needs. */
    function norm(key, raw) {
      const r = raw || EMPTY
      const vals = r.projectionValues || (r.projections && r.projections.values) || null
      // The DURABLE title is what the opened conversation shows. `displayTitle`
      // is a display-only projection (api-session-controller service.js:45-52:
      // durable title -> **project cwd basename** -> raw id), and for catalog
      // children it degrades to the **delegation label**
      // (service.js:521 `title ?? child.label ?? childId`). Rendering
      // `displayTitle` as if it were the title is exactly why the tree text did
      // not match the opened session.
      const durable =
        (typeof r.title === 'string' && r.title.trim() && r.title) ||
        (vals && typeof vals.title === 'string' && vals.title.trim() && vals.title) ||
        null
      const display =
        (typeof r.displayTitle === 'string' && r.displayTitle.trim() && r.displayTitle) || null
      // A subagent's DISPLAYED identity is its descriptor label, not its session
      // title: the main-window header crumb renders the parent catalog's
      // `entry.label` (SubagentHeaderLineage), and the right-sidebar tab renders
      // `byId[child].projectionValues.subagent.label` (sidebar-chat). Both agree
      // because both are this same creation label.
      const subagentLabel =
        (vals &&
          vals.subagent &&
          typeof vals.subagent.label === 'string' &&
          vals.subagent.label.trim() &&
          vals.subagent.label) ||
        null
      return {
        id: r.id || r.sessionId || key,
        parentId: r.parentId || r.parentSessionId || null,
        origin: r.origin || null,
        title: durable,
        fallbackTitle: display,
        subagentLabel,
        catalogLabel: null,
        running: r.running === true,
        updatedAt: num(r.updatedAt),
        // Only ever consulted as the fallback for a workspace's "most recent
        // member" ordering (see activityOf).
        createdAt: num(r.createdAt),
        // Preserve a numeric last-event time when the row carries one; only
        // consulted by activityOf (workspace "recent" ordering).
        lastEventAt: num(r.lastEventAt),
        catalog: Array.isArray(vals && vals.subagentCatalog) ? vals.subagentCatalog : null,
        raw: r,
      }
    }

    /** A finite number from a projection, or null (never a guessed 0). */
    function projectionNumber(value) {
      return typeof value === 'number' && isFinite(value) ? value : null
    }

    /** The selection the session is currently using: `lastUsed`, else `next`. */
    function selectionOf(modelSelection) {
      if (!modelSelection || typeof modelSelection !== 'object') return null
      const lastUsed =
        modelSelection.lastUsed && typeof modelSelection.lastUsed === 'object'
          ? modelSelection.lastUsed
          : null
      if (lastUsed) return lastUsed
      return modelSelection.next && typeof modelSelection.next === 'object' ? modelSelection.next : null
    }

    /** Trimmed non-empty string from a projection, else null. */
    function projectionText(value) {
      return typeof value === 'string' && value.trim() ? value.trim() : null
    }

    /**
     * Derive the session metadata shown in the CONVERSATION UI.
     *
     * Contract (report `session-metadata-display-2026-11-12.md` §9.4):
     *   - `model`/`provider`/`effort` come from `modelSelection.lastUsed`, with
     *     `next` as the documented fallback. A missing `reasoningEffort` stays
     *     null (the renderer shows the localized "default"), never a guess.
     *   - `pct` uses the same formula as the shipped `ContextMeter`
     *     (`dsh-client-ui-conversation/lib/client.js:21520-21534`):
     *     `used = projectedTokens ?? pressureTokens`,
     *     `pct = min(100, round(used / contextWindow * 100))` clamped to 0–100;
     *     no window / no token count → no percentage at all.
     *   - Everything absent stays null. If nothing displayable is left (no model,
     *     no effort, no percentage) the whole meta is null — no fake badge.
     *
     * Exported on the module object as a pure test seam (`test/meta.test.cjs`);
     * it touches no DOM and no service.
     */
    function metaOf(modelSelection, contextPressure) {
      const selection = selectionOf(modelSelection)
      const model = selection ? projectionText(selection.model) : null
      const provider = selection ? projectionText(selection.provider) : null
      const effort = selection ? projectionText(selection.reasoningEffort) : null
      const pressure =
        contextPressure && typeof contextPressure === 'object' ? contextPressure : null
      const window = pressure ? projectionNumber(pressure.contextWindow) : null
      const contextWindow = window !== null && window > 0 ? window : null
      const projected = pressure ? projectionNumber(pressure.projectedTokens) : null
      const forced = pressure ? projectionNumber(pressure.pressureTokens) : null
      let usedTokens = projected !== null ? projected : forced
      // Negative token counts are malformed facts, not "0 used": drop them.
      if (usedTokens !== null && usedTokens < 0) usedTokens = null
      const pct =
        contextWindow !== null && usedTokens !== null
          ? Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)))
          : null
      // Nothing displayable → render nothing at all (blank sessions stay blank).
      if (!model && !effort && pct === null) return null
      return { model, provider, effort, pct, usedTokens, contextWindow }
    }

    /**
     * Localized one-line description of one metadata fact set, used as the
     * strip/chip `title` and `aria-label`: provider/model, reasoning effort (or
     * the honest "default") and the context usage with its token facts.
     */
    function metaTitleOf(meta, t) {
      if (!meta) return ''
      const parts = []
      if (meta.model) {
        parts.push(t('model') + ': ' + (meta.provider ? meta.provider + '/' : '') + meta.model)
      }
      parts.push(t('effort') + ': ' + (meta.effort || t('effortDefault')))
      if (meta.pct !== null) {
        parts.push(
          t('contextUsage', {
            pct: meta.pct,
            used: meta.usedTokens !== null ? meta.usedTokens : '—',
            window: meta.contextWindow,
          }),
        )
      }
      return parts.join(' · ')
    }

    /**
     * The shared body of both conversation-UI surfaces: `model · effort · pct`.
     * Returns a node carrying the display text plus title/aria details, or null
     * when there is nothing honest to show.
     */
    function sessionMetaNode(meta, sessionId, t, options) {
      if (!meta) return null
      const kind = options && options.kind === 'chip' ? 'chip' : 'strip'
      const className = kind === 'chip' ? 'st-meta-strip st-meta-chip' : 'st-meta-strip'
      const title = metaTitleOf(meta, t)
      const kids = []
      if (meta.model) {
        kids.push(h('span', { className: 'st-meta-item', key: 'model' }, meta.model))
        kids.push(h('span', { className: 'st-meta-item', key: 'effort' }, meta.effort || t('effortDefault')))
      }
      if (meta.pct !== null) {
        kids.push(
          h(
            'span',
            { className: 'st-meta-item st-meta-pct', key: 'pct', 'data-level': metaLevel(meta.pct) },
            meta.pct + '%',
          ),
        )
      }
      if (kids.length === 0) return null
      return h(
        kind === 'chip' ? 'span' : 'div',
        {
          className,
          title,
          'aria-label': title,
          ...(sessionId ? { 'data-session-meta': sessionId } : {}),
        },
        kids,
      )
    }

    /**
     * Mirror of the shipped `selectReadOnlySubagent`
     * (`dsh-client-ui-subagent/lib/client.js:1221-1230`): the read-only composer
     * replaces the whole composer (and with it every composer slot) exactly for
     * these three cases. The header chip uses the same predicate so it renders
     * only where the dock strip cannot.
     *
     * @param sub - `useSession((s) => s.subagent)` snapshot value.
     * @param running - whether that addressed child is currently running.
     * @returns `{reason}` when the composer is read-only, else null.
     */
    function selectReadOnlyMeta(sub, running) {
      if (!sub || typeof sub !== 'object') return null
      const address = sub.address && typeof sub.address === 'object' ? sub.address : null
      const mode = address && typeof address.mode === 'string' ? address.mode : null
      if (mode === 'unknown') return { reason: 'unknown' }
      if (mode === 'one-shot') return { reason: 'one-shot' }
      if (sub.parentAvailable !== false) return null
      return running === true ? null : { reason: 'parent-unavailable' }
    }

    /** Unconditional fallbacks so the slot hook props can never break a render. */
    const noProjection = () => undefined
    const noSession = (sel) => (typeof sel === 'function' ? sel(EMPTY) : EMPTY)
    const noSessions = (sel) => (typeof sel === 'function' ? sel({ byId: EMPTY }) : EMPTY)

    /**
     * Conversation metadata strip — MAIN surface.
     *
     * Registered on `conversation.composer.dock` (list, session scope), so it
     * sits in the ambient row below the composer card, beside the shipped
     * ActivityPill/UsagePill. The shipped `ModelSelect` returns null for every
     * ADDRESSED child session (`dsh-client-ui-model-selection:2074,1297`), which
     * is exactly the "call 出来的会话有些不显示" the user reported, so this strip
     * fills the model/effort/context gap for child sessions. Root sessions keep
     * the shipped ModelSelect + ContextMeter untouched (no duplicate).
     *
     * A child whose composer is replaced (one-shot / unknown / parent offline)
     * never renders the dock at all; `SessionMetaChip` covers that case.
     */
    function SessionMetaStrip(props) {
      const t = props && props.t ? props.t : (key) => key
      const sessionId = props && props.sessionId
      const useProjection =
        props && typeof props.useProjection === 'function' ? props.useProjection : noProjection
      const useSessions = props && typeof props.useSessions === 'function' ? props.useSessions : noSessions
      const useSession = props && typeof props.useSession === 'function' ? props.useSession : noSession
      const selection = useProjection('modelSelection')
      const pressure = useProjection('contextPressure')
      const parentId = useSessions((state) => {
        const row = state && state.byId && sessionId ? state.byId[sessionId] : undefined
        return row ? row.parentId || row.parentSessionId || null : null
      })
      const subagent = useSession((state) => (state && state.subagent) || null)
      if (!sessionId || (!parentId && !subagent)) return null
      return sessionMetaNode(metaOf(selection, pressure), sessionId, t, { kind: 'strip' })
    }

    /**
     * Conversation metadata chip — FALLBACK for read-only child sessions.
     *
     * Registered on `conversation.session.header.utilities` (list, session
     * scope). It renders ONLY where the shipped read-only composer replaced the
     * composer (one-shot / unknown mode / parent offline and not running),
     * because that is the only case where the dock strip cannot appear; every
     * normal session returns null so nothing is duplicated.
     */
    function SessionMetaChip(props) {
      const t = props && props.t ? props.t : (key) => key
      const sessionId = props && props.sessionId
      const useProjection =
        props && typeof props.useProjection === 'function' ? props.useProjection : noProjection
      const useSession = props && typeof props.useSession === 'function' ? props.useSession : noSession
      const selection = useProjection('modelSelection')
      const pressure = useProjection('contextPressure')
      const subagent = useSession((state) => (state && state.subagent) || null)
      const running = useSession((state) => !!(state && state.running))
      if (!sessionId || !selectReadOnlyMeta(subagent, running)) return null
      return sessionMetaNode(metaOf(selection, pressure), sessionId, t, { kind: 'chip' })
    }

    /**
     * Visual level of a context percentage, for the `.st-meta-pct[data-level]`
     * CSS. Same intent as the shipped meter's warning colour: near-full windows
     * stand out; anything else stays tertiary.
     */
    function metaLevel(pct) {
      if (pct === null || pct === undefined) return 'normal'
      if (pct >= 90) return 'error'
      if (pct >= 75) return 'warn'
      return 'normal'
    }

    /**
     * Map one session to the Harness status vocabulary, in the shipped priority
     * order (dsh-client-ui-workspace/lib/client.js:1386-1434 `sessionStatuses`):
     * pending interaction -> running -> completion-unread -> idle.
     *
     *  warning = waiting on a human (approval / plan review / question)  → orange
     *  ongoing = running                                                 → blue
     *  done    = finished but not viewed yet                             → green
     *  idle    = finished and already viewed                             → gray
     *
     * `statuses` is the `useSessionStatus` snapshot: a Map keyed by session id
     * whose values carry `running`, `completionUnread` and `pendingInteraction`.
     */
    function sessionState(statuses, id, fallbackRunning) {
      const status = statuses && typeof statuses.get === 'function' ? statuses.get(id) : undefined
      if (!status) return fallbackRunning === true ? 'ongoing' : 'idle'
      const kind = status.pendingInteraction && status.pendingInteraction.kind
      if (kind === 'approval' || kind === 'plan-review' || kind === 'question') return 'warning'
      if (status.running === true) return 'ongoing'
      if (status.completionUnread === true) return 'done'
      return 'idle'
    }

    const STATE_LABEL_KEY = {
      ongoing: 'stOngoing',
      done: 'stDone',
      idle: 'stIdle',
      warning: 'stWarning',
    }

    const fallbackSessions = (sel) => sel({ byId: EMPTY, projectionsBySession: EMPTY })
    const fallbackStatus = (sel) => sel(EMPTY)
    const fallbackWorkspaces = (sel) => sel(EMPTY)

    /**
     * Canonical Sidebar resource address for one subagent conversation.
     * Copied from the shipped owner of that resource
     * (dsh-client-ui-subagent/lib/client.js:698-704) — the query key names and
     * the allowed `mode` values are validated when the resource is resolved.
     */
    function subagentChatAddress(parentSessionId, childSessionId, mode) {
      const m = mode === 'one-shot' || mode === 'continuable' ? mode : 'unknown'
      // Built without URLSearchParams so the module has no dependency on a
      // global beyond `window`; session ids are UUIDs, so the encodings agree.
      return (
        'dsh-resource://subagentchat/session/' +
        encodeURIComponent(String(childSessionId)) +
        '?parent=' +
        encodeURIComponent(String(parentSessionId)) +
        '&mode=' +
        m
      )
    }

    // ===================================================================
    // Tree Runs panel — read-only window onto the dsh-tree-engine stores.
    //
    // Three seats (modeled on the flow-engine spike panel, spike/
    // dsh-flow-plugin/client.js:2797-2872, verified line-by-line):
    //   1. composer-dock pill  (id 'tree-runs', order 6 — right after flow's 5);
    //   2. right-sidebar tab   (sidebarRightTabs.register kind 'tree-runs' +
    //      keyed seats 'sidebar.right.pane.tab' / '.title');
    //   3. degraded shell.overlay when the sidebarRight services are absent,
    //      with a late `ctx.inject([...])` re-try once they arrive.
    // Data is same-origin fetch against the /tree-panel routes served by
    // dsh-tree-engine; every failure degrades to an inline note inside the
    // panel and never breaks the seat. All styling lives in the shared
    // `st-tr-*` rules of the sheet above — no inline style objects, no
    // React-subtree <style>.
    // ===================================================================

    const PANEL_ROUTE = '/tree-panel'
    const PANEL_POLL_MS = 1500
    const PANEL_TREE_LIMIT = 50
    const PANEL_EVENT_FETCH_LIMIT = 100
    const PANEL_EVENT_TAIL = 50
    /** HMR hygiene: interval ids live on window so a module re-load can clear them. */
    const PANEL_TIMERS_KEY = '__stTreePanelTimers'
    /** Tab registry id (process-wide unique) and the kind the pill opens. */
    const PANEL_TAB_ID = '@orphiczhou/dsh-session-tree'
    const PANEL_TAB_KIND = 'tree-runs'
    /**
     * Build marker rendered in the panel header (v1.7.0). A renderer that kept
     * an older bundle from a previous apply shows its own number here, which is
     * how a stale client is told apart from a data problem (test asserts this
     * equals package.json's version).
     */
    const PANEL_VERSION = '1.8.0'

    /** Optional-service lookup that never throws (flow spike :2737-2752). */
    function panelServiceOf(ctx, key) {
      try {
        if (ctx && ctx[key] !== undefined && ctx[key] !== null) return ctx[key]
      } catch (e) {}
      try {
        if (ctx && typeof ctx.get === 'function') {
          const viaGet = ctx.get(key)
          if (viaGet !== undefined && viaGet !== null) return viaGet
        }
      } catch (e) {}
      return null
    }

    /** Hand-written store (flow spike :81-106); components subscribe via usePanelStore. */
    function createPanelStore(initial) {
      let state = initial
      const listeners = []
      return {
        get() {
          return state
        },
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : patch
          state = Object.assign({}, state, next)
          for (const fn of listeners) {
            try {
              fn()
            } catch (e) {}
          }
        },
        subscribe(fn) {
          listeners.push(fn)
          return () => {
            const i = listeners.indexOf(fn)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
      }
    }

    /** Same-origin GET with the flow panel's fetch hygiene (:110-136). */
    function panelJsonGet(path, signal) {
      return fetch(path, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      }).then((response) => {
        if (!response.ok) {
          return response
            .json()
            .catch(() => null)
            .then((body) => {
              const err =
                body && body.error && typeof body.error.message === 'string'
                  ? new Error(body.error.message)
                  : new Error('HTTP ' + response.status)
              err.status = response.status
              throw err
            })
        }
        return response.json()
      })
    }

    /** Clear timers left behind by an earlier module load (flow spike :297-314). */
    function panelResetGlobalTimers() {
      try {
        const previous = window[PANEL_TIMERS_KEY]
        if (previous && previous.ids) {
          for (const id of previous.ids) {
            try {
              clearInterval(id)
              clearTimeout(id)
            } catch (e) {}
          }
        }
        window[PANEL_TIMERS_KEY] = { ids: [] }
      } catch (e) {}
    }

    /** Record an interval id on window so a re-load can clear it. */
    function panelTrackTimer(id) {
      try {
        let slot = window[PANEL_TIMERS_KEY]
        // Defensive: apply() normally seeds the slot (panelResetGlobalTimers);
        // if a mount somehow races ahead of it, seed here so the id is not lost.
        if (!slot || !slot.ids) {
          slot = { ids: [] }
          window[PANEL_TIMERS_KEY] = slot
        }
        slot.ids.push(id)
      } catch (e) {}
      return id
    }

    /**
     * Four-state colour semantics shared with the sidebar dots: running blue,
     * succeeded green, failed red, everything else idle gray. Pure mapping.
     */
    function panelToneOf(status) {
      if (status === 'running' || status === 'suspended' || status === 'dispatched') return 'running'
      if (status === 'succeeded' || status === 'done') return 'succeeded'
      if (status === 'failed' || status === 'cancelled' || status === 'timeout' || status === 'error') return 'failed'
      if (status === 'active' || status === 'segment_pending') return 'running'
      return 'other'
    }

    /** UTC-ish timestamp display; numbers and ISO strings both accepted. */
    function panelTimeOf(v) {
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        try {
          return new Date(v).toISOString().replace('T', ' ').slice(0, 19)
        } catch (e) {}
      }
      if (typeof v === 'string' && v) return v.length > 19 ? v.slice(0, 19).replace('T', ' ') : v
      return '—'
    }

    /** Shortened first line of a goal preview; malformed input degrades to ''. */
    function panelPreviewOf(v) {
      if (typeof v !== 'string') return ''
      const s = v.replace(/\s+/g, ' ').trim()
      return s.length > 160 ? s.slice(0, 159) + '…' : s
    }

    /**
     * panel-v2 pure helpers. All exported at the module seam for tests; none
     * of them touch React or the store.
     */

    /**
     * Tree-level status derived from leaf counts (design §2.5 + §6.1 V2-3):
     * any failed/timeout/cancelled leaf paints the whole tree failed; any
     * ACTIVE non-terminal leaf keeps it running (`pending` is NOT active — an
     * all-pending tree stays pending, per the frozen V2-3 contract; `pruned`
     * is terminal too and never counts as active); otherwise at least one
     * succeeded leaf means succeeded; anything else is pending.
     */
    function treeStatusOf(counts) {
      const c = counts && typeof counts === 'object' ? counts : {}
      const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0)
      if (num(c.failed) > 0 || num(c.timeout) > 0 || num(c.cancelled) > 0 || num(c.error) > 0) return 'failed'
      let hasActive = false
      for (const key of Object.keys(c)) {
        if (key === 'succeeded' || key === 'pending' || key === 'pruned') continue
        if (num(c[key]) > 0) hasActive = true
      }
      if (hasActive) return 'running'
      if (num(c.succeeded) > 0) return 'succeeded'
      return 'pending'
    }

    /**
     * Whole-tree badge (v1.7.0): the server-derived `tree.state` wins when it
     * is present, counts are only the fallback (older engines / fixtures).
     *
     * Why: `tree_plan`'s root leaf is a container — it never receives a done
     * event, so its raw status stays `active` forever and a counts-based badge
     * paints every finished tree as running (live tally before the fix: 29 of
     * 36 trees). `projectTreeSummary`/`projectTreeDetail` derive the tree state
     * with the root excluded from the running test (engine `treeStateOf`).
     */
    function treeBadgeOf(tree) {
      const t = tree && typeof tree === 'object' ? tree : {}
      const state = typeof t.state === 'string' && t.state !== '' ? t.state : null
      if (state) return state
      const counts = t.counts && typeof t.counts === 'object' && !Array.isArray(t.counts) ? t.counts : {}
      return treeStatusOf(counts)
    }

    /**
     * Client-side dependency edges (design §3.2): for every leaf, one edge
     * per declared dependency, direction dep → leaf (`data-from` = the
     * dependency, `data-to` = the dependent), deduped, both endpoints must
     * exist. Server data is never trusted to be acyclic.
     */
    function treeEdgesOf(leaves) {
      const ids = []
      const seen = new Set()
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        if (!leaf || typeof leaf !== 'object') continue
        const id = String(leaf.leafId)
        if (!id || seen.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
      const present = new Set(ids)
      const edges = []
      const edgeKeys = new Set()
      for (const leaf of Array.isArray(leaves) ? leaves : []) {
        if (!leaf || typeof leaf !== 'object') continue
        const to = String(leaf.leafId)
        if (!present.has(to)) continue
        const deps = Array.isArray(leaf.dependencies) ? leaf.dependencies : []
        for (const dep of deps) {
          const from = String(dep)
          if (!present.has(from)) continue
          const key = from + '\u0000' + to
          if (edgeKeys.has(key)) continue
          edgeKeys.add(key)
          edges.push({ from, to })
        }
      }
      return edges
    }

    /**
     * Longest-path layering (design §3.2): level[dep] + 1 pushes every
     * dependent one column right; the relaxation is bounded (≤ nodes.length
     * + 2 passes with a level ceiling of nodes.length) so a cyclic
     * dependency graph can never loop forever.
     */
    function treeLevelsOf(leaves, edges) {
      const level = new Map()
      const list = Array.isArray(leaves) ? leaves : []
      for (const leaf of list) {
        if (leaf && typeof leaf === 'object' && leaf.leafId !== undefined) level.set(String(leaf.leafId), 0)
      }
      const maxLevel = Math.max(0, list.length)
      const passes = list.length + 2
      const edgeList = Array.isArray(edges) ? edges : []
      for (let pass = 0; pass < passes; pass += 1) {
        let moved = false
        for (const edge of edgeList) {
          const from = level.get(edge.from)
          const to = level.get(edge.to)
          if (from === undefined || to === undefined) continue
          if (from + 1 > to && to + 1 <= maxLevel) {
            level.set(edge.to, to + 1)
            moved = true
          }
        }
        if (!moved) break
      }
      return level
    }

    /**
     * Client-side hierarchy edges (v1.6.2, user ask m01512): one edge per
     * leaf whose `parent` names another leaf present in the projection,
     * direction parent → child (`data-from` = the commander, `data-to` = the
     * leaf it spawned). The server's `parent` field is the authoritative
     * 从属 relation; a dangling parent (parent not in `leaves`) is skipped,
     * self-loops are dropped, and a duplicate child id is emitted once.
     */
    function treeParentEdgesOf(leaves) {
      const list = Array.isArray(leaves) ? leaves : []
      const present = new Set()
      for (const leaf of list) {
        if (!leaf || typeof leaf !== 'object' || leaf.leafId === undefined) continue
        present.add(String(leaf.leafId))
      }
      const edges = []
      const edgeKeys = new Set()
      for (const leaf of list) {
        if (!leaf || typeof leaf !== 'object' || leaf.leafId === undefined) continue
        const to = String(leaf.leafId)
        const parentRaw = leaf.parent
        if (parentRaw === undefined || parentRaw === null || parentRaw === '') continue
        const from = String(parentRaw)
        if (from === to || !present.has(from)) continue
        const key = from + '\u0000' + to
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edges.push({ from, to })
      }
      return edges
    }

    /**
     * Hierarchy ordering + depth (v1.6.2, design §3.2 extended): depth 0 is
     * the root (explicit `rootLeafId`, else every leaf without a present
     * parent), children sit one column right of their parent, and the
     * preorder walk fixes the within-column row order so siblings stay
     * adjacent. Cycle-safe: a visited set stops a parent cycle from looping
     * forever, and leaves unreachable from any root (orphans of a cycle) are
     * appended at depth 0 in path order.
     */
    function treeHierarchyOf(leaves, rootLeafId) {
      const list = Array.isArray(leaves) ? leaves : []
      const byId = new Map()
      const order0 = []
      for (const leaf of list) {
        if (!leaf || typeof leaf !== 'object' || leaf.leafId === undefined) continue
        const id = String(leaf.leafId)
        if (byId.has(id)) continue
        byId.set(id, leaf)
        order0.push(id)
      }
      const sortKey = (id) => {
        const leaf = byId.get(id) || {}
        const path = leaf.path === undefined || leaf.path === null ? '' : String(leaf.path)
        return path + '\u0000' + id
      }
      const children = new Map()
      const roots = []
      for (const id of order0) {
        const leaf = byId.get(id) || {}
        const parentRaw = leaf.parent
        const parent = parentRaw === undefined || parentRaw === null ? '' : String(parentRaw)
        if (parent && parent !== id && byId.has(parent)) {
          if (!children.has(parent)) children.set(parent, [])
          children.get(parent).push(id)
        } else {
          roots.push(id)
        }
      }
      const byPath = (a, b) => {
        const ka = sortKey(a)
        const kb = sortKey(b)
        return ka < kb ? -1 : ka > kb ? 1 : 0
      }
      for (const ids of children.values()) ids.sort(byPath)
      const root = rootLeafId !== undefined && rootLeafId !== null ? String(rootLeafId) : ''
      const starts = root && byId.has(root) ? [root] : roots.slice().sort(byPath)
      const order = []
      const level = new Map()
      const seen = new Set()
      const walk = (id, depth) => {
        if (seen.has(id)) return
        seen.add(id)
        order.push(id)
        level.set(id, depth)
        for (const child of children.get(id) || []) walk(child, depth + 1)
      }
      for (const id of starts) walk(id, 0)
      for (const id of order0.slice().sort(byPath)) walk(id, 0)
      return { order, level, roots: starts }
    }

    /**
     * The drawn edge model (v1.6.2): one line per related pair, and a
     * `parent` link wins over a declared dependency on the same pair, so the
     * solid hierarchy line never overdraws a dashed dependency line. `kind`
     * tells the renderer which style to use.
     */
    function treeGraphEdgesOf(leaves) {
      const parentEdges = treeParentEdgesOf(leaves)
      const depEdges = treeEdgesOf(leaves)
      const parentPairs = new Set()
      const edges = []
      for (const edge of parentEdges) {
        parentPairs.add(edge.from + '\u0000' + edge.to)
        edges.push({ from: edge.from, to: edge.to, kind: 'parent' })
      }
      for (const edge of depEdges) {
        if (parentPairs.has(edge.from + '\u0000' + edge.to)) continue
        edges.push({ from: edge.from, to: edge.to, kind: 'dep' })
      }
      return { edges, parentEdges, depEdges }
    }

    const GRAPH_PAD = 12
    const GRAPH_BOX_W = 192
    const GRAPH_BOX_H = 56
    const GRAPH_COL_GAP = 76
    const GRAPH_ROW_GAP = 18

    /**
     * Layout for the read-only graph (design §3.2, extended v1.6.2): columns
     * are hierarchy depth when the projection carries `parent` links, so a
     * commander sits one column left of the leaves it spawned; a projection
     * without any parent link keeps the previous dependency-layering
     * fallback. Rows pack per column in preorder, so a chain stays one row
     * and siblings remain adjacent. `edges` are the declared dependencies
     * (dashed), `parentEdges` the hierarchy (solid).
     */
    function treeGraphLayout(leaves, rootLeafId) {
      const list = Array.isArray(leaves) ? leaves : []
      const root = rootLeafId !== undefined && rootLeafId !== null ? String(rootLeafId) : ''
      const edges = treeEdgesOf(list)
      const parentEdges = treeParentEdgesOf(list)
      const hierarchy = treeHierarchyOf(list, root)
      const useHierarchy = parentEdges.length > 0
      const level = useHierarchy ? hierarchy.level : treeLevelsOf(list, edges)
      const byId = new Map()
      for (const leaf of list) {
        if (!leaf || typeof leaf !== 'object' || leaf.leafId === undefined) continue
        const id = String(leaf.leafId)
        if (!byId.has(id)) byId.set(id, leaf)
      }
      const sequence = useHierarchy ? hierarchy.order : Array.from(byId.keys())
      const rowCounter = new Map()
      const nodes = []
      for (const id of sequence) {
        const leaf = byId.get(id)
        if (!leaf) continue
        const col = level.get(id) || 0
        const row = rowCounter.get(col) || 0
        rowCounter.set(col, row + 1)
        nodes.push({
          leafId: id,
          leaf,
          level: col,
          row,
          x: GRAPH_PAD + col * (GRAPH_BOX_W + GRAPH_COL_GAP),
          y: GRAPH_PAD + row * (GRAPH_BOX_H + GRAPH_ROW_GAP),
        })
      }
      let maxLevel = 0
      let maxRows = 0
      for (const node of nodes) {
        if (node.level > maxLevel) maxLevel = node.level
        if (node.row + 1 > maxRows) maxRows = node.row + 1
      }
      const graphW = 2 * GRAPH_PAD + (maxLevel + 1) * GRAPH_BOX_W + maxLevel * GRAPH_COL_GAP
      const graphH = 2 * GRAPH_PAD + maxRows * GRAPH_BOX_H + (maxRows - 1) * GRAPH_ROW_GAP
      return { nodes, edges, parentEdges, graphW, graphH, maxLevel, maxRows, root, hierarchy: useHierarchy }
    }

    const ZOOM_MIN = 0.25
    const ZOOM_MAX = 2.5
    const ZOOM_STEP = 1.12

    /** Clamp the graph zoom into the fixed 0.25×–2.5× window (design §3.6). */
    function clampZoom(v) {
      const n = typeof v === 'number' && isFinite(v) ? v : 1
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n))
    }

    /**
     * Graph viewport height (v1.8.0, user ask m03016: "树图的部分高度太小了，
     * 一条缝"). The detail column is a flex container, and `.st-tr2-viewport`
     * is `overflow:auto` — which makes its automatic minimum size 0, so the
     * viewport was being squeezed down to a slit by the sibling sections.
     * The viewport therefore always renders with an explicit height that the
     * user can drag, clamped into a legible band.
     */
    const GRAPH_HEIGHT_DEFAULT = 420
    const GRAPH_HEIGHT_MIN = 220
    const GRAPH_HEIGHT_MAX = 900
    const GRAPH_HEIGHT_KEY = 'dsh.session-tree.graph-height'

    /** Clamp a viewport height: non-finite falls back to the default, then [MIN, MAX], integer px. */
    function clampGraphHeight(value) {
      const n = typeof value === 'number' && isFinite(value) ? Math.round(value) : GRAPH_HEIGHT_DEFAULT
      return Math.min(GRAPH_HEIGHT_MAX, Math.max(GRAPH_HEIGHT_MIN, n))
    }

    /**
     * Read the remembered viewport height. `storage` is injectable (tests pass
     * a fake; the renderer passes localStorage) and every access is guarded —
     * localStorage throws in sandboxed/opaque origins.
     */
    function readStoredGraphHeight(storage) {
      try {
        const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
        if (!s || typeof s.getItem !== 'function') return GRAPH_HEIGHT_DEFAULT
        const raw = s.getItem(GRAPH_HEIGHT_KEY)
        if (raw === null || raw === undefined || raw === '') return GRAPH_HEIGHT_DEFAULT
        return clampGraphHeight(Number(raw))
      } catch (e) {
        return GRAPH_HEIGHT_DEFAULT
      }
    }

    /** Persist the viewport height; failures (quota/private mode) stay silent. */
    function writeStoredGraphHeight(height, storage) {
      const clamped = clampGraphHeight(height)
      try {
        const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
        if (s && typeof s.setItem === 'function') s.setItem(GRAPH_HEIGHT_KEY, String(clamped))
      } catch (e) {}
      return clamped
    }

    /**
     * Zoom that makes the whole laid-out graph fit the viewport (the "initial
     * view shows the entire tree" ask). Padding 8px; unmeasurable viewport
     * (0 / NaN, which is what a headless test sees) falls back to 1×. Fit only
     * shrinks-to-fit up to 2×, never blows small trees past the zoom ceiling.
     */
    function fitZoomOf(viewW, viewH, graphW, graphH) {
      const vw = typeof viewW === 'number' && isFinite(viewW) ? viewW : 0
      const vh = typeof viewH === 'number' && isFinite(viewH) ? viewH : 0
      const gw = typeof graphW === 'number' && isFinite(graphW) && graphW > 0 ? graphW : 0
      const gh = typeof graphH === 'number' && isFinite(graphH) && graphH > 0 ? graphH : 0
      if (!(vw > 0) || !(vh > 0) || !(gw > 0) || !(gh > 0)) return 1
      const zoom = Math.min((vw - 8) / gw, (vh - 8) / gh)
      if (!isFinite(zoom) || zoom <= 0) return ZOOM_MIN
      return Math.min(2, Math.max(ZOOM_MIN, Math.round(zoom * 1000) / 1000))
    }

    /**
     * Edge state per flow parity (design §3.4): an edge is "satisfied" when
     * its source leaf already succeeded, otherwise it stays the declared
     * baseline. The P0 panel renders every edge in the declared state; the
     * mapping exists so the P1 upgrade is a one-line swap.
     */
    function edgeStateOf(fromLeaf) {
      const status = fromLeaf && typeof fromLeaf === 'object' ? fromLeaf.status : null
      return status === 'succeeded' ? 'sat' : 'decl'
    }

    /**
     * Session-id count for the detail field grid (design §7): the server
     * sends `stats.sessions` as a number, older fixtures as an object keyed
     * by session id; both shapes collapse to a count string, '—' if absent.
     */
    function statsSessionsOf(stats) {
      const s = stats && typeof stats === 'object' ? stats.sessions : null
      if (typeof s === 'number' && isFinite(s)) return String(s)
      if (s && typeof s === 'object') return String(Object.keys(s).length)
      return '—'
    }

    /**
     * The panel's polling controller. One instance per panel runtime; the
     * sidebar body / overlay start it on mount and stop it on unmount.
     * Trees refresh every tick (1.5s), detail + events every 2nd tick or on
     * explicit force — the flow panel's cadence (:635-654). Every request runs
     * through an AbortController that `stop()` aborts wholesale (:338-374,
     * :668-678); failures land in store error fields, never thrown.
     */
    function createPanelController(store) {
      let pollTimer = null
      let ticks = 0
      let inflight = false
      const aborters = []

      function abortAll() {
        for (const a of aborters) {
          try {
            a.abort()
          } catch (e) {}
        }
        aborters.length = 0
      }

      function withAbort(factory) {
        if (typeof AbortController === 'undefined') return factory(undefined)
        const ac = new AbortController()
        aborters.push(ac)
        let promise
        try {
          promise = factory(ac.signal)
        } catch (e) {
          const i = aborters.indexOf(ac)
          if (i >= 0) aborters.splice(i, 1)
          return Promise.reject(e)
        }
        const release = () => {
          const i = aborters.indexOf(ac)
          if (i >= 0) aborters.splice(i, 1)
        }
        return promise.then(
          (v) => {
            release()
            return v
          },
          (e) => {
            release()
            throw e
          },
        )
      }

      /** Abort noise (unmount / re-select) is hygiene, not a panel error. */
      function reportError(field, error) {
        if (error && error.name === 'AbortError') return
        const patch = {}
        patch[field] = error && error.message ? error.message : String(error)
        store.set(patch)
      }

      function refreshTrees(force) {
        // Forced refresh (start / manual) may flip the loading note on, but
        // only while the list is still empty — periodic ticks never flicker it.
        if (force === true && store.get().trees.length === 0) {
          store.set({ treesLoading: true })
        }
        return withAbort((signal) =>
          panelJsonGet(PANEL_ROUTE + '/trees?limit=' + PANEL_TREE_LIMIT, signal),
        ).then(
          (body) => {
            store.set({
              trees: Array.isArray(body && body.trees) ? body.trees : [],
              storageRoot: body && typeof body.storageRoot === 'string' ? body.storageRoot : null,
              total: body && typeof body.total === 'number' ? body.total : (body && Array.isArray(body.trees) ? body.trees.length : 0),
              treesError: null,
              treesLoading: false,
            })
          },
          (error) => {
            reportError('treesError', error)
            store.set({ treesLoading: false })
          },
        )
      }

      function refreshDetail(force) {
        const treeId = store.get().selectedTreeId
        if (!treeId) return Promise.resolve(null)
        if (force === true) store.set({ detailLoading: true })
        return withAbort((signal) =>
          panelJsonGet(
            PANEL_ROUTE + '/trees/' + encodeURIComponent(String(treeId)),
            signal,
          ),
        ).then(
          (body) => {
            // Ignore a stale response for a tree the user already left.
            if (store.get().selectedTreeId !== treeId) return null
            const next = body && typeof body === 'object' ? body : null
            const patch = {
              detail: next,
              detailError: null,
              detailLoading: false,
            }
            // Drop a selection whose leaf vanished from the refreshed tree
            // (pruned / re-projected leaf) instead of pinning a ghost detail.
            const selectedLeafId = store.get().selectedLeafId
            if (selectedLeafId) {
              const leaves = next && Array.isArray(next.leaves) ? next.leaves : []
              const stillThere = leaves.some(
                (leaf) => leaf && String(leaf.leafId) === String(selectedLeafId),
              )
              if (!stillThere) patch.selectedLeafId = null
            }
            store.set(patch)
          },
          (error) => {
            if (store.get().selectedTreeId !== treeId) return null
            reportError('detailError', error)
            store.set({ detailLoading: false })
          },
        )
      }

      function refreshEvents() {
        const treeId = store.get().selectedTreeId
        if (!treeId) return Promise.resolve(null)
        return withAbort((signal) =>
          panelJsonGet(
            PANEL_ROUTE +
              '/trees/' +
              encodeURIComponent(String(treeId)) +
              '/events?limit=' +
              PANEL_EVENT_FETCH_LIMIT,
            signal,
          ),
        ).then(
          (body) => {
            if (store.get().selectedTreeId !== treeId) return null
            const all = Array.isArray(body && body.events) ? body.events : []
            store.set({
              events: all.slice(-PANEL_EVENT_TAIL),
              lastSeq: body && typeof body.lastSeq === 'number' ? body.lastSeq : 0,
              eventsError: null,
            })
          },
          (error) => {
            if (store.get().selectedTreeId !== treeId) return null
            reportError('eventsError', error)
          },
        )
      }

      function refreshAll(force) {
        if (inflight && force !== true) return Promise.resolve(null)
        inflight = true
        ticks += 1
        const detailDue = ticks % 2 === 0 || force === true
        return refreshTrees(force === true)
          .then(() => {
            if (store.get().selectedTreeId && detailDue) {
              return Promise.all([refreshDetail(force === true), refreshEvents()])
            }
            return null
          })
          .catch(() => {})
          .then(() => {
            inflight = false
          })
      }

      function select(treeId) {
        store.set({
          selectedTreeId: treeId,
          selectedLeafId: null,
          detail: null,
          detailLoading: true,
          detailError: null,
          events: [],
          eventsError: null,
          lastSeq: 0,
        })
        abortAll()
        refreshDetail(true)
        refreshEvents()
      }

      /**
       * Leaf selection for the detail pane (v1.6.2, user ask m01512): the
       * graph node click and the leaf-table row click both land here. Passing
       * null/'' clears the selection; no fetch — the detail is already loaded.
       */
      function selectLeaf(leafId) {
        const next = leafId === undefined || leafId === null || leafId === '' ? null : String(leafId)
        store.set({ selectedLeafId: next })
      }

      /**
       * Graph viewport height (v1.8.0, user ask m03016). Clamped, remembered in
       * localStorage, and kept in the store so the drag handle, the auto-fit and
       * the next panel mount all agree.
       */
      function resizeGraph(height) {
        const next = writeStoredGraphHeight(height)
        store.set({ graphHeight: next })
      }

      function back() {
        abortAll()
        store.set({
          selectedTreeId: null,
          selectedLeafId: null,
          detail: null,
          detailLoading: false,
          detailError: null,
          events: [],
          eventsError: null,
        })
      }

      function start() {
        if (pollTimer !== null) return
        pollTimer = panelTrackTimer(
          setInterval(() => {
            refreshAll(false)
          }, PANEL_POLL_MS),
        )
        refreshAll(true)
      }

      function stop() {
        if (pollTimer !== null) {
          try {
            clearInterval(pollTimer)
          } catch (e) {}
          pollTimer = null
        }
        abortAll()
      }

      return {
        start,
        stop,
        select,
        selectLeaf,
        resizeGraph,
        back,
        refreshAll,
        getTimerId: () => pollTimer,
      }
    }

    /** Store subscription hook; old React falls back to useState+useEffect (:1367-1378). */
    function usePanelStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.get, store.get)
      }
      const pair = useState(store.get)
      useEffect(() => store.subscribe(() => pair[1](store.get())), [])
      return pair[0]
    }

    /** Colored status badge (flow spike Badge :1399-1414, as st-tr-* classes). */
    function PanelBadge(props) {
      const status = props && typeof props.status === 'string' && props.status ? props.status : 'unknown'
      return h('span', { className: 'st-tr-badge', 'data-tone': panelToneOf(status) }, status)
    }

    /** One tree card in the list: id + whole-tree badge + meta row (§2.5). */
    function PanelTreeCard(props) {
      const tree = props.tree || {}
      const treeId = typeof tree.treeId === 'string' ? tree.treeId : String(tree.treeId)
      const counts =
        tree.counts && typeof tree.counts === 'object' && !Array.isArray(tree.counts)
          ? tree.counts
          : {}
      const byTone = { running: 0, succeeded: 0, failed: 0, other: 0 }
      for (const key of Object.keys(counts)) {
        const n = typeof counts[key] === 'number' && isFinite(counts[key]) ? counts[key] : 0
        if (n > 0) byTone[panelToneOf(key)] += n
      }
      const dots = []
      for (const tone of ['running', 'succeeded', 'failed', 'other']) {
        if (byTone[tone] > 0) {
          dots.push(
            h(
              'span',
              { key: tone, className: 'st-tr-dots' },
              h('span', { className: 'st-tr-dot', 'data-tone': tone }),
              String(byTone[tone]),
            ),
          )
        }
      }
      const treeStatus = treeBadgeOf(tree)
      // Row 1: tree id (mono, full id in title) + whole-tree status badge.
      const top = h(
        'span',
        { className: 'st-tr-card-top' },
        h('span', { className: 'st-tr-mono st-tr-card-id', title: treeId }, treeId),
        h('span', { className: 'st-tr-badge', 'data-tone': panelToneOf(treeStatus) }, treeStatus),
      )
      // Row 2: "<N> leaves · <tone dots> · updated <UTC>"; dots moved here
      // from row 1 (design §2.5), same st-tr-dots markup as before.
      const metaKids = []
      const metaPush = (kid) => {
        if (metaKids.length > 0) metaKids.push(' · ')
        metaKids.push(kid)
      }
      if (typeof tree.leafCount === 'number') metaPush(String(tree.leafCount) + ' leaves')
      if (dots.length > 0) metaPush(h('span', { key: 'dots', className: 'st-tr-dots' }, dots))
      if (tree.updatedAt !== undefined) metaPush('updated ' + panelTimeOf(tree.updatedAt))
      const preview = panelPreviewOf(tree.rootGoalPreview)
      return h(
        'button',
        {
          type: 'button',
          className: 'st-tr-card',
          'data-tree-id': treeId,
          'data-selected': props.selected === true ? 'true' : 'false',
          title: preview ? treeId + ' — ' + preview : treeId,
          onClick: props.onOpen,
        },
        top,
        metaKids.length > 0 ? h('div', { className: 'st-tr-meta' }, metaKids) : null,
      )
    }

    /** One leaf row of the detail table (plus the head row variant). */
    function PanelLeafRow(props) {
      const leaf = props.leaf || {}
      const leafId = typeof leaf.leafId === 'string' ? leaf.leafId : String(leaf.leafId)
      const verif = leaf.verification && typeof leaf.verification === 'object' ? leaf.verification : null
      let verifNode = h('span', { className: 'st-tr-cell' }, '—')
      if (verif && typeof verif.pass === 'boolean') {
        const attempts = typeof verif.attempts === 'number' ? verif.attempts : ''
        verifNode = h(
          'span',
          { className: 'st-tr-cell st-tr-verif', 'data-pass': String(verif.pass) },
          (verif.pass ? '✓' : '✗') + (attempts === '' ? '' : ' ' + attempts),
        )
      }
      const deps = Array.isArray(leaf.dependencies)
        ? leaf.dependencies.map(String).join(', ')
        : ''
      const cells = [
        h('span', { className: 'st-tr-cell st-tr-mono', key: 'id', title: leaf.path || leafId }, leafId),
        h(PanelBadge, { key: 'status', status: leaf.status }),
        h('span', { className: 'st-tr-cell', key: 'relay' }, leaf.relay === undefined || leaf.relay === null ? '—' : String(leaf.relay)),
        h('span', { className: 'st-tr-cell', key: 'task' }, leaf.taskType || '—'),
        h('span', { className: 'st-tr-cell', key: 'ctx' }, typeof leaf.ctxPct === 'number' ? leaf.ctxPct + '%' : '—'),
        verifNode,
        h('span', { className: 'st-tr-cell', key: 'deps', title: deps }, deps || '—'),
        h(SessionCell, { key: 'session', sessionId: leaf.sessionId }),
      ]
      return h(
        'div',
        {
          className: 'st-tr-row',
          'data-kind': 'leaf',
          'data-leaf-id': leafId,
          'data-selected': props.selected === true ? 'true' : 'false',
          onClick: typeof props.onSelect === 'function' ? () => props.onSelect(leafId) : undefined,
          style: typeof props.onSelect === 'function' ? { cursor: 'pointer' } : undefined,
        },
        cells,
      )
    }

    /**
     * Session-id cell + copy button for the leaf table's 8th column (design
     * §2/#19). The feedback text is written straight to the button DOM node;
     * the 1500ms revert timer never enters the panel timer ledger (no state,
     * no leak surface).
     */
    function SessionCell(props) {
      const sessionId =
        props && props.sessionId !== undefined && props.sessionId !== null
          ? String(props.sessionId)
          : ''
      if (!sessionId) {
        return [h('span', { className: 'st-tr-cell', key: 'sess-none' }, '—')]
      }
      const onCopy = (event) => {
        // The row itself is clickable (v1.6.2 leaf selection): copying a
        // session id must not also select the row.
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        if (
          typeof navigator === 'undefined' ||
          !navigator.clipboard ||
          typeof navigator.clipboard.writeText !== 'function'
        ) {
          return
        }
        const node = event && event.currentTarget ? event.currentTarget : null
        const show = (text) => {
          try {
            if (node && typeof node.textContent === 'string') node.textContent = text
          } catch (e) {}
        }
        try {
          Promise.resolve(navigator.clipboard.writeText(sessionId)).then(
            () => {
              show('Copied')
              setTimeout(() => show('Copy'), 1500)
            },
            () => show('Copy failed'),
          )
        } catch (e) {}
      }
      return [
        h('span', {
          className: 'st-tr-cell st-tr-mono st-tr2-sessid',
          key: 'sess-id',
          title: sessionId,
        }, sessionId),
        h('button', { type: 'button', className: 'st-tr2-copybtn', key: 'sess-copy', onClick: onCopy }, 'Copy'),
      ]
    }

    /** Field of the detail summary grid: one flex row per field (§4.3). */
    function PanelField(props) {
      const value =
        props.value === undefined || props.value === null || props.value === '' ? '—' : props.value
      return h(
        'div',
        { className: 'st-tr2-field' },
        h('span', { className: 'st-tr2-fieldlabel' }, props.label),
        h('span', { className: 'st-tr2-fieldvalue' + (props.mono ? ' st-tr-mono' : '') }, value),
      )
    }

    /**
     * Inner error boundary around the graph only (design §3.7): a crash in
     * layout/SVG rendering degrades to the note fallback instead of taking
     * down the whole detail pane.
     */
    class GraphBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err: err && err.message ? err.message : String(err) }
      }
      render() {
        if (this.state.err !== null) {
          return h('div', { className: 'st-tr-note', 'data-kind': 'error' }, 'Graph unavailable')
        }
        return this.props.children
      }
    }

    /** Root id of the drawn graph: the detail's root leaf, else the first leaf. */
    function graphRootIdOf(props, leaves) {
      const rootObj = props && props.root && typeof props.root === 'object' ? props.root : {}
      if (rootObj.leafId !== undefined && rootObj.leafId !== null && String(rootObj.leafId) !== '') {
        return String(rootObj.leafId)
      }
      return String(leaves[0] && leaves[0].leafId)
    }

    /**
     * Read-only dependency graph (design §3). F8 DISCIPLINE: every hook runs
     * unconditionally first; the empty-graph early return happens after them,
     * so the graph keeps a constant hook count across loading / empty /
     * selected states. The test stub counts useState+useRef only (two, V2-12);
     * the auto-fit effect below is a third, also unconditional.
     *
     * Zoom stays graph-local (pan/scroll are written straight to the DOM),
     * and the viewport height comes from the store so it survives re-renders,
     * tree switches and panel remounts.
     */
    function TreeGraph(props) {
      // [HOOKS] zoom is graph-local; pan/scroll stay in the DOM.
      const zoomPair = useState(1)
      const zoom = zoomPair[0]
      const setZoom = zoomPair[1]
      const viewportRef = useRef(null)

      const leaves = Array.isArray(props.leaves) ? props.leaves : []
      const graphHeight = clampGraphHeight(props.graphHeight)
      const resizeTo = typeof props.onResizeGraph === 'function' ? props.onResizeGraph : null
      const layout = leaves.length === 0 ? null : treeGraphLayout(leaves, graphRootIdOf(props, leaves))

      /**
       * v1.8.0: open a tree with the whole graph visible. Sizes are only
       * measurable after commit, so the fit runs in an effect; the viewport
       * element doubles as the "already fitted for this tree/layout/height"
       * memo, which keeps a manual zoom from being reset on every poll tick.
       */
      useEffect(() => {
        const el = viewportRef.current
        if (!el || typeof el.clientWidth !== 'number' || !(el.clientWidth > 0) || !layout) return
        const key = String(props.treeId || '') + '|' + layout.graphW + 'x' + layout.graphH + '@' + graphHeight
        if (el.__stTreeFitKey === key) return
        el.__stTreeFitKey = key
        setZoom(fitZoomOf(el.clientWidth, el.clientHeight, layout.graphW, layout.graphH))
        el.scrollLeft = 0
        el.scrollTop = 0
      }, [layout ? layout.graphW : 0, layout ? layout.graphH : 0, graphHeight, props.treeId])

      if (leaves.length === 0) return null // empty graph = the section disappears (§3.7)

      const rootId = graphRootIdOf(props, leaves)
      const scaleComp = 1 / Math.max(zoom, ZOOM_MIN)
      const showLabels = zoom >= 0.5
      const showDetail = zoom >= 0.85
      const fontFamily = 'system-ui,-apple-system,"Segoe UI",sans-serif'
      const monoFamily = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
      const selectedId =
        props.selectedLeafId !== undefined && props.selectedLeafId !== null ? String(props.selectedLeafId) : ''
      const selectLeaf = typeof props.onSelectLeaf === 'function' ? props.onSelectLeaf : null
      const statusFill = (status) => {
        const tone = panelToneOf(status)
        if (tone === 'running') return 'var(--dsw-static-blue-500,#3b82f6)'
        if (tone === 'succeeded') return 'var(--dsw-alias-state-success-primary)'
        if (tone === 'failed') return 'var(--dsw-alias-state-error-primary)'
        return 'var(--dsw-alias-state-idle-primary)'
      }

      const nodeById = new Map()
      for (const node of layout.nodes) nodeById.set(node.leafId, node)
      const drawn = treeGraphEdgesOf(leaves).edges
      const bySource = new Map()
      for (const edge of drawn) {
        if (!bySource.has(edge.from)) bySource.set(edge.from, [])
        bySource.get(edge.from).push(edge)
      }
      const edgeEls = drawn.map((edge) => {
        const from = nodeById.get(edge.from)
        const to = nodeById.get(edge.to)
        if (!from || !to) return null
        const isParent = edge.kind === 'parent'
        const sx = from.x + GRAPH_BOX_W
        const sy = from.y + GRAPH_BOX_H / 2
        const ex = to.x - 8
        const ey = to.y + GRAPH_BOX_H / 2
        let c1x
        let c2x
        if (to.x > from.x + 8) {
          const off = Math.max(36, Math.min((to.x - from.x) * 0.5, 160))
          c1x = from.x + off
          c2x = to.x - off
        } else {
          c1x = from.x - 70
          c2x = to.x + 70
        }
        const siblings = bySource.get(edge.from) || []
        const bend = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 14
        const c1y = sy + bend
        const c2y = sy + bend / 4
        return h(
          'g',
          {
            key: edge.kind + '\u0000' + edge.from + '\u0000' + edge.to,
            className: 'st-tr2-edge',
            'data-from': edge.from,
            'data-to': edge.to,
            'data-kind': edge.kind,
            'data-state': 'decl',
          },
          h('path', {
            d:
              'M ' + sx + ' ' + sy +
              ' C ' + c1x + ' ' + c1y +
              ', ' + c2x + ' ' + c2y +
              ', ' + ex + ' ' + ey,
            fill: 'none',
            // Hierarchy = solid (authoritative 从属), dependency = dashed.
            stroke: isParent ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
            strokeWidth: (isParent ? 1.6 : 1.3) * scaleComp,
            strokeDasharray: isParent ? undefined : 7 * scaleComp + ' ' + 5 * scaleComp,
            opacity: isParent ? 0.55 : 0.85,
            markerEnd: isParent ? 'url(#st-tr2-arrow-parent)' : 'url(#st-tr2-arrow-decl)',
          }),
        )
      })

      const nodeEls = layout.nodes.map((node) => {
        const leaf = node.leaf || {}
        const status = leaf.status !== undefined && leaf.status !== null ? String(leaf.status) : ''
        const role = leaf.role !== undefined && leaf.role !== null ? String(leaf.role) : ''
        const isRoot = node.leafId === rootId
        const isSelected = selectedId !== '' && node.leafId === selectedId
        const failed = status === 'failed'
        const stroke = failed
          ? 'var(--dsw-alias-state-error-primary)'
          : isRoot
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-border-l1)'
        const strokeWidth = (failed ? 2 : isRoot ? 1.6 : 1.2) * scaleComp
        const roleFill =
          role === 'commander'
            ? 'var(--dsw-alias-brand-primary)'
            : role === 'auditor'
              ? 'var(--dsw-alias-state-success-primary)'
              : 'var(--dsw-alias-label-secondary)'
        const displayId = node.leafId.length > 22 ? node.leafId.slice(0, 21) + '…' : node.leafId
        const kids = [
          h('title', { key: 'tip' }, node.leafId),
          h('rect', {
            key: 'box',
            x: node.x,
            y: node.y,
            width: GRAPH_BOX_W,
            height: GRAPH_BOX_H,
            rx: 9,
            style: { fill: 'var(--dsw-alias-bg-layer-2)', stroke, strokeWidth: String(strokeWidth) },
          }),
          h('rect', {
            key: 'stripe',
            x: node.x + 6,
            y: node.y + 1,
            width: 5,
            height: GRAPH_BOX_H - 2,
            opacity: 0.9,
            style: { fill: roleFill },
          }),
          h('text', {
            key: 'id',
            x: node.x + 19,
            y: node.y + 21,
            style: {
              fill: isRoot ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
              fontFamily: monoFamily,
              fontSize: 12 * scaleComp,
              fontWeight: 700,
            },
          }, displayId),
        ]
        if (showLabels) {
          kids.push(h('text', {
            key: 'role',
            x: node.x + 19,
            y: node.y + 38,
            style: { fill: roleFill, fontFamily, fontSize: 11 * scaleComp, fontWeight: 600 },
          }, role))
          kids.push(h('text', {
            key: 'status',
            x: node.x + 19 + 4 + role.length * 11,
            y: node.y + 38,
            style: { fill: statusFill(status), fontFamily, fontSize: 11 * scaleComp, fontWeight: 600 },
          }, ' · ' + status))
        }
        if (showDetail) {
          const ctxParts = ['ctx ' + (typeof leaf.ctxPct === 'number' ? leaf.ctxPct : '—') + '%']
          if (leaf.relay !== undefined && leaf.relay !== null && leaf.relay !== 'auto') {
            ctxParts.push('relay ' + String(leaf.relay))
          }
          kids.push(h('text', {
            key: 'ctx',
            x: node.x + 19,
            y: node.y + 50,
            style: { fill: 'var(--dsw-alias-label-secondary)', fontFamily, fontSize: 10 * scaleComp },
          }, ctxParts.join(' · ')))
        }
        if (failed) {
          kids.push(h('circle', {
            key: 'mark',
            cx: node.x + GRAPH_BOX_W - 12,
            cy: node.y + 13,
            r: 6 * scaleComp,
            style: { fill: 'var(--dsw-alias-state-error-primary)' },
          }))
          kids.push(h('text', {
            key: 'marktext',
            x: node.x + GRAPH_BOX_W - 12,
            y: node.y + 16,
            textAnchor: 'middle',
            style: {
              fill: 'var(--dsw-alias-bg-layer-1)',
              fontFamily,
              fontSize: 9 * scaleComp,
              fontWeight: 700,
            },
          }, '!'))
        }
        if (isSelected) {
          kids.push(h('rect', {
            key: 'ring',
            x: node.x - 3,
            y: node.y - 3,
            width: GRAPH_BOX_W + 6,
            height: GRAPH_BOX_H + 6,
            rx: 12,
            fill: 'none',
            style: { stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: String(2 * scaleComp) },
          }))
        }
        return h(
          'g',
          {
            key: node.leafId,
            className: 'st-tr2-node',
            'data-leaf-id': node.leafId,
            'data-status': status,
            'data-tone': panelToneOf(status),
            'data-root': isRoot ? 'true' : 'false',
            'data-selected': isSelected ? 'true' : 'false',
            style: selectLeaf ? { cursor: 'pointer' } : undefined,
            onClick: selectLeaf
              ? (event) => {
                  if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                  selectLeaf(node.leafId)
                }
              : undefined,
          },
          kids,
        )
      })

      const onWheel = (event) => {
        if (!event || !(event.ctrlKey || event.metaKey)) return // plain scroll stays native
        if (typeof event.preventDefault === 'function') event.preventDefault()
        const el = viewportRef.current
        if (!el) return
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0 }
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        const next = clampZoom(event.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP)
        if (next === zoom) return
        // Anchor the document point under the pointer, then swap the zoom.
        const anchorX = (px + el.scrollLeft) / zoom
        const anchorY = (py + el.scrollTop) / zoom
        el.scrollLeft = anchorX * next - px
        el.scrollTop = anchorY * next - py
        setZoom(next)
      }
      const onPointerDown = (event) => {
        const el = viewportRef.current
        if (!el || !event || event.button !== 0) return
        el.__stTreeGraphPan = { x: event.clientX, y: event.clientY, sl: el.scrollLeft, st: el.scrollTop }
        try {
          if (typeof el.setPointerCapture === 'function') el.setPointerCapture(event.pointerId)
        } catch (e) {}
      }
      const onPointerMove = (event) => {
        const el = viewportRef.current
        const pan = el ? el.__stTreeGraphPan : null
        if (!el || !pan || !event) return
        el.scrollLeft = pan.sl - (event.clientX - pan.x)
        el.scrollTop = pan.st - (event.clientY - pan.y)
      }
      const onPointerUp = () => {
        const el = viewportRef.current
        if (el) el.__stTreeGraphPan = null
      }

      const stepZoom = (factor) => setZoom((current) => clampZoom(current * factor))
      const zoomTo = (target) => {
        const el = viewportRef.current
        if (el) {
          el.scrollLeft = 0
          el.scrollTop = 0
        }
        setZoom(clampZoom(target))
      }
      /** Whole-graph fit against the *measured* viewport (both axes, v1.8.0). */
      const fitNow = () => {
        const el = viewportRef.current
        const width = el && typeof el.clientWidth === 'number' ? el.clientWidth : 0
        const height = el && typeof el.clientHeight === 'number' ? el.clientHeight : 0
        zoomTo(fitZoomOf(width, height, layout.graphW, layout.graphH))
      }

      /**
       * Drag the split handle under the graph to resize the viewport (v1.8.0).
       * Listeners live on the document for the duration of the drag so the
       * pointer can leave the 10px handle; text selection is suppressed.
       */
      const onResizeStart = (event) => {
        if (!resizeTo || !event) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        const startY = typeof event.clientY === 'number' ? event.clientY : 0
        const startH = graphHeight
        const doc = typeof document !== 'undefined' ? document : null
        if (!doc || typeof doc.addEventListener !== 'function') return
        const move = (moveEvent) => {
          const y = moveEvent && typeof moveEvent.clientY === 'number' ? moveEvent.clientY : startY
          resizeTo(clampGraphHeight(startH + (y - startY)))
        }
        const stop = () => {
          try {
            doc.removeEventListener('mousemove', move)
            doc.removeEventListener('mouseup', stop)
          } catch (e) {}
          try {
            if (doc.body && doc.body.style) doc.body.style.userSelect = ''
          } catch (e) {}
        }
        doc.addEventListener('mousemove', move)
        doc.addEventListener('mouseup', stop)
        try {
          if (doc.body && doc.body.style) doc.body.style.userSelect = 'none'
        } catch (e) {}
      }

      return h(
        'div',
        { className: 'st-tr2-section st-tr2-graphsection', key: 'graph', 'data-kind': 'graph-section' },
        h(
          'div',
          { className: 'st-tr2-graphbar', key: 'bar' },
          h('button', { type: 'button', className: 'st-tr2-graphbtn', onClick: () => stepZoom(1 / 1.2), title: 'Zoom out' }, '−'),
          h('button', { type: 'button', className: 'st-tr2-graphbtn', onClick: () => stepZoom(1.2), title: 'Zoom in' }, '＋'),
          h('button', { type: 'button', className: 'st-tr2-graphbtn', onClick: fitNow, title: 'Fit the whole graph into the viewport' }, 'Fit'),
          h('button', { type: 'button', className: 'st-tr2-graphbtn', onClick: () => zoomTo(1), title: 'Reset zoom' }, '100%'),
          h('span', { className: 'st-tr2-hint' }, 'Ctrl/⌘+wheel zoom · drag to pan · click a node to inspect · solid = parent → child'),
        ),
        h(
          'div',
          {
            className: 'st-tr2-viewport',
            key: 'viewport',
            'data-kind': 'graph-viewport',
            // Explicit height (v1.8.0): without it a flex child that scrolls
            // collapses to zero and the graph reads as a thin slit.
            style: { height: graphHeight + 'px' },
            ref: viewportRef,
            onWheel,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
          },
          h(
            'div',
            { key: 'canvas', style: { width: layout.graphW * zoom + 'px', height: layout.graphH * zoom + 'px' } },
            h(
              'svg',
              {
                className: 'st-tr2-svg',
                viewBox: '0 0 ' + layout.graphW + ' ' + layout.graphH,
                width: layout.graphW * zoom,
                height: layout.graphH * zoom,
              },
              h(
                'defs',
                { key: 'defs' },
                h(
                  'marker',
                  {
                    key: 'decl',
                    id: 'st-tr2-arrow-decl',
                    viewBox: '0 0 9 9',
                    refX: 7,
                    refY: 3.5,
                    markerWidth: 9,
                    markerHeight: 9,
                    orient: 'auto',
                  },
                  h('path', {
                    d: 'M0.5,0.5 L6.5,3.5 L0.5,6.5 z',
                    style: { fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.2 },
                  }),
                ),
                h(
                  'marker',
                  {
                    key: 'parent',
                    id: 'st-tr2-arrow-parent',
                    viewBox: '0 0 8 8',
                    refX: 6,
                    refY: 3,
                    markerWidth: 8,
                    markerHeight: 8,
                    orient: 'auto',
                  },
                  h('path', { d: 'M0,0 L6,3 L0,6 z', style: { fill: 'var(--dsw-alias-brand-primary)', opacity: 0.7 } }),
                ),
                h(
                  'marker',
                  {
                    key: 'sat',
                    id: 'st-tr2-arrow-sat',
                    viewBox: '0 0 8 8',
                    refX: 6,
                    refY: 3,
                    markerWidth: 8,
                    markerHeight: 8,
                    orient: 'auto',
                  },
                  h('path', { d: 'M0,0 L6,3 L0,6 z', style: { fill: 'var(--dsw-alias-brand-primary)' } }),
                ),
              ),
              edgeEls,
              nodeEls,
            ),
          ),
        ),
        h('div', {
          key: 'resize',
          className: 'st-tr2-graphresize',
          'data-kind': 'graph-resize',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': 'Resize graph area',
          title: 'Drag to resize the graph · double-click to reset',
          onMouseDown: onResizeStart,
          onDoubleClick: resizeTo ? () => resizeTo(GRAPH_HEIGHT_DEFAULT) : undefined,
        }),
        h(
          'div',
          { className: 'st-tr2-legend', key: 'legend' },
          ['succeeded', 'failed', 'running', 'other'].map((tone) =>
            h('span', { key: tone }, h('span', { className: 'st-tr-dot', 'data-tone': tone }), ' ' + tone),
          ),
          h('span', { key: 'decl' }, '─── parent → child (solid)'),
          h('span', { key: 'dep' }, '--- declared dependency (dashed)'),
        ),
      )
    }

    /** Fixed header row of the v2 shell (design §2): title / root / count / stamp / refresh. */
    /**
     * Header freshness stamp (v1.7.0): the page-level `updatedAt` comes from
     * the older list envelope and is absent on the current payload, so fall
     * back to the newest per-tree stamp instead of rendering a permanent dash.
     * Pure, exported for tests.
     */
    function panelFreshnessOf(state, trees) {
      const st = state && typeof state === 'object' ? state : {}
      if (typeof st.updatedAt === 'string' && st.updatedAt !== '') return st.updatedAt
      let newest = null
      const list = Array.isArray(trees) ? trees : []
      for (const tree of list) {
        const stamp = tree && typeof tree === 'object' ? tree.updatedAt : null
        if (typeof stamp === 'string' && stamp !== '' && (newest === null || stamp > newest)) newest = stamp
      }
      return newest
    }

    function PanelHeader(props) {
      const state = props.state
      const controller = props.controller
      const trees = props.trees
      const updatedAt = panelFreshnessOf(state, trees)
      return h(
        'div',
        { className: 'st-tr2-top' },
        h('span', { className: 'st-tr2-title' }, 'Tree Runs · read-only'),
        h('span', { className: 'st-tr2-version', 'data-kind': 'version', title: 'session-tree client build' }, 'v' + PANEL_VERSION),
        h('span', { className: 'st-tr-top-path', title: state.storageRoot || '' }, state.storageRoot || ''),
        h('span', { className: 'st-tr-top-count' }, String(trees.length) + (state.total > trees.length ? ' / ' + state.total : '')),
        h('span', { className: 'st-tr2-dim' }, '更新 ' + panelTimeOf(updatedAt)),
        h('button', { type: 'button', className: 'st-tr-btn', onClick: () => controller.refreshAll(true) }, 'Refresh'),
      )
    }

    /**
     * Left column: loading / error / empty / cards (design §2.1, §2.7).
     * Zero hooks — the shell owns the store subscription and passes state.
     */
    function PanelList(props) {
      const state = props.state
      const controller = props.controller
      const trees = props.trees
      let inner
      if (state.treesLoading && trees.length === 0) {
        inner = h('div', { className: 'st-tr-note' }, 'Loading trees…')
      } else if (state.treesError !== null && state.treesError !== undefined) {
        inner = h('div', { className: 'st-tr-note', 'data-kind': 'error' }, 'Tree list unavailable: ' + state.treesError)
      } else if (trees.length === 0) {
        inner = h(
          'div',
          { className: 'st-tr2-empty' },
          'No trees' + (state.storageRoot ? ' (storage root: ' + state.storageRoot + ')' : '') + '.',
        )
      } else {
        inner = trees.map((tree) =>
          h(PanelTreeCard, {
            key: tree && tree.treeId,
            tree,
            selected: !!(tree && tree.treeId === state.selectedTreeId),
            onOpen: () => controller.select(tree && tree.treeId),
          }),
        )
      }
      return h('div', { className: 'st-tr2-list' }, inner)
    }

    /** Read-only summary grid of the selected tree (design §2/#10). */
    function PanelFieldGrid(props) {
      const detail = props.detail || {}
      const root = detail.root && typeof detail.root === 'object' ? detail.root : {}
      const stats = detail.stats && typeof detail.stats === 'object' ? detail.stats : {}
      const leaves = Array.isArray(detail.leaves) ? detail.leaves : []
      const byStatus = stats.byStatus && typeof stats.byStatus === 'object' ? stats.byStatus : null
      let statusText = '—'
      if (byStatus) {
        const parts = []
        for (const key of Object.keys(byStatus)) {
          const n = typeof byStatus[key] === 'number' && isFinite(byStatus[key]) ? byStatus[key] : 0
          parts.push(key + '=' + n)
        }
        if (parts.length > 0) statusText = parts.join(' · ')
      }
      const treeBadge = treeBadgeOf({ state: detail.state, counts: byStatus })
      const rootIsContainer =
        root.rawStatus === 'active' &&
        (root.runtimeState === null || root.runtimeState === undefined || root.runtimeState === '') &&
        (treeBadge === 'succeeded' || treeBadge === 'failed')
      const rootStatusText = root.status
        ? String(root.status) + (rootIsContainer ? ' · container (no settle event)' : '')
        : ''
      return h(
        'div',
        { className: 'st-tr2-fieldgrid' },
        h(PanelField, { label: 'Tree', value: detail.treeId, mono: true }),
        h(PanelField, { label: 'Root goal', value: root.goalPreview ? panelPreviewOf(root.goalPreview) : '' }),
        // v1.7.0: the headline state is the server-derived tree state (root
        // container excluded from the running test); the per-leaf tally moves
        // to its own row so the two can never be read as the same fact.
        h(PanelField, {
          label: 'Tree state',
          value: treeBadge,
        }),
        h(PanelField, { label: 'Leaf states', value: statusText }),
        // The root leaf of a `tree_plan` tree is a container: it never receives
        // a done event, so its own display state can stay `running` after every
        // worker settled. Label it instead of contradicting "Tree state".
        h(PanelField, { label: 'Root status', value: rootStatusText }),
        h(PanelField, { label: 'Created', value: panelTimeOf(detail.createdAt) }),
        h(PanelField, { label: 'Updated', value: panelTimeOf(detail.updatedAt) }),
        h(PanelField, { label: 'Leaves', value: typeof stats.total === 'number' ? String(stats.total) : String(leaves.length) }),
        h(PanelField, { label: 'Sessions', value: statsSessionsOf(stats) }),
      )
    }

    /** Leaf table with the 8 read-only columns incl. the session cell (§2/#8). */
    function PanelLeafTable(props) {
      const leaves = props.leaves
      const selectedLeafId =
        props.selectedLeafId === undefined || props.selectedLeafId === null ? null : String(props.selectedLeafId)
      const onSelectLeaf = props.onSelectLeaf
      const headRow = h(
        'div',
        { className: 'st-tr-row', 'data-kind': 'head' },
        h('span', { className: 'st-tr-cell' }, 'Leaf'),
        h('span', { className: 'st-tr-cell' }, 'Status'),
        h('span', { className: 'st-tr-cell' }, 'Relay'),
        h('span', { className: 'st-tr-cell' }, 'Task'),
        h('span', { className: 'st-tr-cell' }, 'Ctx'),
        h('span', { className: 'st-tr-cell' }, 'Verif'),
        h('span', { className: 'st-tr-cell' }, 'Deps'),
        h('span', { className: 'st-tr-cell' }, 'Session'),
      )
      return h(
        'div',
        { className: 'st-tr2-section' },
        h('div', { className: 'st-tr2-section-title' }, 'Leaves'),
        leaves.length > 0
          ? h(
              'div',
              { className: 'st-tr-tablewrap' },
              headRow,
              leaves.map((leaf) =>
                h(PanelLeafRow, {
                  key: leaf && leaf.leafId,
                  leaf,
                  selected: !!(leaf && selectedLeafId !== null && String(leaf.leafId) === selectedLeafId),
                  onSelect: onSelectLeaf,
                }),
              ),
            )
          : h('div', { className: 'st-tr-note' }, 'No leaves recorded.'),
      )
    }

    /**
     * Selected-leaf inspector (v1.6.2, user ask m01512): every projected leaf
     * attribute in one read-only field grid, fed by the already-loaded tree
     * detail (no extra fetch, no hooks). Nothing selected renders the hint so
     * the affordance is discoverable.
     */
    function PanelLeafDetail(props) {
      const leaf = props.leaf
      const onClear = typeof props.onClear === 'function' ? props.onClear : null
      if (!leaf || typeof leaf !== 'object') {
        return h(
          'div',
          { className: 'st-tr2-section st-tr2-leafdetail' },
          h('div', { className: 'st-tr2-section-title' }, 'Leaf attributes'),
          h(
            'div',
            { className: 'st-tr-note', 'data-kind': 'hint' },
            'Click a node in the graph (or a leaf row below) to inspect its attributes.',
          ),
        )
      }
      const leafId = leaf.leafId === undefined || leaf.leafId === null ? '' : String(leaf.leafId)
      const verif = leaf.verification && typeof leaf.verification === 'object' ? leaf.verification : null
      let verifText = ''
      if (verif) {
        const parts = [verif.pass === true ? 'pass' : verif.pass === false ? 'fail' : '—']
        if (typeof verif.attempts === 'number') parts.push('attempts ' + verif.attempts)
        if (verif.lastVerdict) parts.push(String(verif.lastVerdict))
        if (verif.policy) parts.push('policy ' + String(verif.policy))
        verifText = parts.join(' · ')
      }
      const assignee = leaf.assignee && typeof leaf.assignee === 'object' ? leaf.assignee : null
      const assigneeText = assignee
        ? [assignee.provider, assignee.model].filter((v) => v !== undefined && v !== null && v !== '').join(' / ')
        : ''
      const deps = Array.isArray(leaf.dependencies) ? leaf.dependencies.map(String).join(', ') : ''
      const lastEvent =
        (leaf.lastEventType ? String(leaf.lastEventType) : '') +
        (leaf.lastEventAt ? ' · ' + panelTimeOf(leaf.lastEventAt) : '')
      return h(
        'div',
        { className: 'st-tr2-section st-tr2-leafdetail' },
        h(
          'div',
          { className: 'st-tr2-section-title st-tr2-leafdetail-head' },
          'Leaf attributes · ' + leafId,
          onClear
            ? h('button', { type: 'button', className: 'st-tr2-graphbtn', onClick: onClear, title: 'Clear selection' }, 'Clear')
            : null,
        ),
        h(
          'div',
          { className: 'st-tr2-fieldgrid st-tr2-leafgrid' },
          h(PanelField, { label: 'Leaf', value: leafId, mono: true }),
          h(PanelField, { label: 'Path', value: leaf.path === undefined || leaf.path === null ? '' : String(leaf.path), mono: true }),
          h(PanelField, { label: 'Role', value: leaf.role ? String(leaf.role) : '' }),
          h(PanelField, { label: 'Parent', value: leaf.parent ? String(leaf.parent) : '', mono: true }),
          h(PanelField, { label: 'Status', value: h(PanelBadge, { status: leaf.status }) }),
          h(PanelField, { label: 'Raw status', value: leaf.rawStatus ? String(leaf.rawStatus) : '' }),
          h(PanelField, { label: 'Runtime', value: leaf.runtimeState ? String(leaf.runtimeState) : '' }),
          h(PanelField, { label: 'Task', value: leaf.taskType ? String(leaf.taskType) : '' }),
          h(PanelField, { label: 'Relay', value: leaf.relay === undefined || leaf.relay === null ? '' : String(leaf.relay) }),
          h(PanelField, { label: 'Ctx', value: typeof leaf.ctxPct === 'number' ? leaf.ctxPct + '%' : '' }),
          h(PanelField, { label: 'Added by', value: leaf.addedBy ? String(leaf.addedBy) : '', mono: true }),
          h(PanelField, { label: 'Assignee', value: assigneeText }),
          h(PanelField, { label: 'Verification', value: verifText }),
          h(PanelField, { label: 'Dependencies', value: deps, mono: true }),
          h(PanelField, { label: 'Last event', value: lastEvent }),
          h(PanelField, { label: 'Session', value: h(SessionCell, { sessionId: leaf.sessionId }) }),
          h(PanelField, { label: 'Done summary', value: leaf.doneSummaryPreview ? panelPreviewOf(leaf.doneSummaryPreview) : '' }),
        ),
      )
    }

    /** Event tail rows: "#seq · ts · leafId · type" (design §2/#27). */
    function PanelEventTail(props) {
      const events = props.events
      const eventsError = props.eventsError
      const rows = events.map((ev, i) => {
        const seq = ev && ev.seq !== undefined && ev.seq !== null ? String(ev.seq) : '?'
        return h(
          'div',
          { className: 'st-tr-event', key: (ev && ev.seq) !== undefined ? String(ev.seq) : String(i) },
          h('span', { className: 'st-tr2-event-seq st-tr-mono' }, '#' + seq),
          h('span', { className: 'st-tr-mono' }, panelTimeOf(ev && ev.ts)),
          h('span', { className: 'st-tr-mono' }, (ev && ev.leafId) || '—'),
          h('span', { className: 'st-tr-event-type' }, (ev && ev.type) || '—'),
        )
      })
      return h(
        'div',
        { className: 'st-tr2-section' },
        h('div', { className: 'st-tr2-section-title' }, 'Events (last ' + PANEL_EVENT_TAIL + ')'),
        rows.length > 0
          ? h('div', { className: 'st-tr-events' }, rows)
          : eventsError
            ? h('div', { className: 'st-tr-note', 'data-kind': 'error' }, 'Events unavailable: ' + eventsError)
            : h('div', { className: 'st-tr-note' }, 'No events yet.'),
      )
    }

    /**
     * Right column: empty / loading / error / no-detail notes, else the full
     * read-only detail (field grid + graph + leaf table + event tail).
     * Zero hooks; all state arrives via props.
     */
    function PanelDetail(props) {
      const state = props.state
      const controller = props.controller
      const selected = state.selectedTreeId
      const detail = state.detail && typeof state.detail === 'object' ? state.detail : null
      const leaves = detail && Array.isArray(detail.leaves) ? detail.leaves : []
      const events = Array.isArray(state.events) ? state.events : []
      let inner
      if (!selected) {
        inner = h(
          'div',
          { className: 'st-tr2-empty' },
          'Select a tree on the left to view read-only detail (graph / fields / leaves / events).',
        )
      } else if (state.detailLoading && !detail) {
        inner = h('div', { className: 'st-tr-note' }, 'Loading tree…')
      } else if (state.detailError !== null && state.detailError !== undefined) {
        inner = h('div', { className: 'st-tr-note', 'data-kind': 'error' }, 'Detail unavailable: ' + state.detailError)
      } else if (!detail) {
        inner = h('div', { className: 'st-tr-note' }, 'No detail for this tree yet.')
      } else {
        const selectedLeafId =
          state.selectedLeafId === undefined || state.selectedLeafId === null ? null : String(state.selectedLeafId)
        const selectedLeaf =
          selectedLeafId === null
            ? null
            : leaves.find((leaf) => leaf && String(leaf.leafId) === selectedLeafId) || null
        const onSelectLeaf = (leafId) => controller.selectLeaf(leafId)
        inner = [
          h(PanelFieldGrid, { key: 'fields', detail }),
          h(GraphBoundary, { key: 'graph' }, h(TreeGraph, {
            leaves,
            root: detail.root,
            treeId: detail.treeId,
            selectedLeafId,
            onSelectLeaf,
            graphHeight: state.graphHeight,
            onResizeGraph: (height) => controller.resizeGraph(height),
          })),
          h(PanelLeafDetail, {
            key: 'leafdetail',
            leaf: selectedLeaf,
            onClear: () => controller.selectLeaf(null),
          }),
          h(PanelLeafTable, {
            key: 'leaves',
            leaves,
            selectedLeafId,
            onSelectLeaf,
          }),
          h(PanelEventTail, { key: 'events', events, eventsError: state.eventsError }),
        ]
      }
      return h('div', { className: 'st-tr2-detail' }, inner)
    }

    /**
     * The panel body itself (v2 split-pane shell). F8 DISCIPLINE: the
     * shell's own hooks (store subscription + poll lifecycle) run
     * unconditionally; every three-state branch lives inside the zero-hook
     * column components, so the Body hook count is constant across loading /
     * error / empty / selected-but-loading states (formula A, V2-11) and the
     * detail render adds exactly the graph's two hooks (formula B, V2-12).
     * There is no Back button — both columns are always on screen.
     */
    function PanelShell(props) {
      const store = props.store
      const controller = props.controller
      const state = usePanelStore(store)

      // Poll lifecycle: start on mount, stop + abort on unmount.
      useEffect(() => {
        controller.start()
        return () => controller.stop()
      }, [])

      const trees = Array.isArray(state.trees) ? state.trees : []
      return h(
        'div',
        { className: 'st-tr-root' },
        h(PanelHeader, { state, trees, controller }),
        h(
          'div',
          { className: 'st-tr2-body' },
          h(PanelList, { state, trees, controller }),
          h(PanelDetail, { state, controller }),
        ),
      )
    }

    /** The degraded full-screen overlay (flow spike :2853-2872 seat body). */
    function PanelOverlay(props) {
      const store = props.store
      const controller = props.controller
      const state = usePanelStore(store)

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event && event.key === 'Escape' && store.get().open) store.set({ open: false })
        }
        try {
          window.addEventListener('keydown', onKeyDown)
          return () => {
            try {
              window.removeEventListener('keydown', onKeyDown)
            } catch (e) {}
          }
        } catch (e) {
          return undefined
        }
      }, [])

      if (!state.open) return null
      return h(
        'div',
        { className: 'st-tr-overlay', role: 'dialog', 'aria-label': 'Tree Runs' },
        h(
          'div',
          { className: 'st-tr-overlay-head' },
          h('span', { className: 'st-tr-overlay-title' }, 'Tree Runs'),
          h(
            'button',
            { type: 'button', className: 'st-tr-btn', onClick: () => store.set({ open: false }) },
            'Close',
          ),
        ),
        h(PanelShell, { store, controller }),
      )
    }

    /**
     * Composer-dock entry pill. Prefers the right-sidebar tab; without the
     * sidebarRight services it opens the degraded overlay instead (visible
     * fallback, never a dead click).
     */
    function PanelEntry(props) {
      const store = props.store
      const state = usePanelStore(store)
      return h(
        'button',
        {
          type: 'button',
          className: 'st-tr-pill',
          style: state.open ? DOCK_PILL_OPEN : DOCK_PILL,
          'data-open': state.open ? 'true' : 'false',
          'aria-pressed': state.open ? 'true' : 'false',
          title: 'Tree Runs (read-only task-tree panel)',
          onClick: () => props.openPanel(),
        },
        h('span', { className: 'st-tr-pill-dot', style: DOCK_PILL_DOT }),
        'Tree Runs',
      )
    }

    /** Right-sidebar tab title seat. */
    function PanelTabTitle() {
      return h('span', null, 'Tree Runs')
    }

    /**
     * One panel runtime per apply(): shared store + controller + the
     * boundary-wrapped seat components. Exported as a test seam
     * (test/panel-render.test.cjs builds its own instances with a stubbed
     * fetch; the mounted plugin builds exactly one).
     */
    function createPanelRuntime(ctx) {
      const store = createPanelStore({
        open: false,
        trees: [],
        treesLoading: true,
        treesError: null,
        storageRoot: null,
        total: 0,
        selectedTreeId: null,
        // v1.6.2: selected leaf for the detail pane (node / row click).
        selectedLeafId: null,
        // v1.8.0: resizable graph viewport height (remembered across mounts).
        graphHeight: readStoredGraphHeight(),
        detail: null,
        detailLoading: false,
        detailError: null,
        events: [],
        eventsError: null,
        lastSeq: 0,
      })
      const controller = createPanelController(store)

      function openPanel() {
        const sidebarRight = panelServiceOf(ctx, 'sidebarRight')
        if (sidebarRight && typeof sidebarRight.openTab === 'function') {
          try {
            sidebarRight.openTab(PANEL_TAB_KIND, {})
            return
          } catch (e) {
            try {
              console.warn('[session-tree] sidebarRight.openTab failed', e)
            } catch (_) {}
          }
        }
        store.set({ open: true })
      }

      const wrap = (label, Component) => (props) => h(Boundary, null, h(Component, Object.assign({}, props, { store, controller, openPanel })))

      return {
        store,
        controller,
        openPanel,
        Entry: wrap('entry', PanelEntry),
        Overlay: wrap('overlay', PanelOverlay),
        Body: wrap('sidebar-body', PanelShell),
        TabTitle: (props) => h(Boundary, null, h(PanelTabTitle, props)),
      }
    }

    /**
     * Seat registration for one apply() (flow spike :2797-2872, adapted to the
     * two-argument slots.inject of this repo). Registers the pill always; the
     * right-sidebar tab when sidebarRightTabs + sidebarRight are present, or
     * the shell.overlay fallback plus a late re-try otherwise.
     */
    function registerPanelSeats(ctx) {
      const slots = ctx && ctx.slots
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
      panelResetGlobalTimers()
      const runtime = createPanelRuntime(ctx)
      const disposers = []
      let sidebarRegistered = false
      let disposed = false

      function registerSeat(ownerKey, options, Component) {
        try {
          const dispose = slots.inject(ownerKey, () => slots.register(options, Component))
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch (e) {
          try {
            console.warn('[session-tree] panel seat registration failed: ' + ownerKey, e)
          } catch (_) {}
        }
      }

      function tryRegisterSidebar() {
        if (sidebarRegistered) return true
        const tabs = panelServiceOf(ctx, 'sidebarRightTabs')
        const sidebarRight = panelServiceOf(ctx, 'sidebarRight')
        if (
          !tabs ||
          typeof tabs.register !== 'function' ||
          !sidebarRight ||
          typeof sidebarRight.openTab !== 'function'
        ) {
          return false
        }
        try {
          const registerType = () =>
            tabs.register({
              id: PANEL_TAB_ID,
              kind: PANEL_TAB_KIND,
              priority: 'extension',
              title: () => 'Tree Runs',
            })
          const disposeType =
            typeof ctx.effect === 'function'
              ? ctx.effect(registerType, 'session-tree: rightbar tab type')
              : registerType()
          if (typeof disposeType === 'function') disposers.push(disposeType)
        } catch (e) {
          try {
            console.warn('[session-tree] rightbar tab type registration failed', e)
          } catch (_) {}
          return false
        }
        registerSeat('sidebar.right.pane.tab', { name: 'sidebar.right.pane.tab', key: PANEL_TAB_ID }, runtime.Body)
        registerSeat('sidebar.right.pane.tab.title', { name: 'sidebar.right.pane.tab.title', key: PANEL_TAB_ID }, runtime.TabTitle)
        sidebarRegistered = true
        return true
      }

      registerSeat(
        'conversation.composer.dock',
        { name: 'conversation.composer.dock', id: PANEL_TAB_KIND, order: 6, label: () => 'Tree Runs' },
        runtime.Entry,
      )
      if (!tryRegisterSidebar()) {
        registerSeat(
          'shell.overlay',
          { name: 'shell.overlay', id: 'tree-runs-panel', order: 50, label: () => 'Tree Runs' },
          runtime.Overlay,
        )
        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['sidebarRightTabs', 'sidebarRight'], () => {
              if (disposed) return
              try {
                tryRegisterSidebar()
              } catch (e) {
                try {
                  console.warn('[session-tree] deferred panel sidebar registration failed', e)
                } catch (_) {}
              }
            })
          } catch (e) {}
        }
      }
      return function disposePanelSeats() {
        disposed = true
        runtime.controller.stop()
        for (const dispose of disposers) {
          try {
            dispose()
          } catch (e) {}
        }
        disposers.length = 0
      }
    }

    /** Build the flat row list the renderer walks. Pure; tolerant of malformed data. */
    function buildRows(byId, projectionsBySession, expandedIds, query, t, statuses, opts) {
      const out = []
      const keys = Object.keys(byId || EMPTY)
      if (keys.length === 0) return out

      const node = new Map()
      for (const k of keys) node.set(k, norm(k, byId[k]))

      // Children by durable lineage, plus catalog children with no row of their own.
      const kids = new Map()
      const addKid = (pid, child) => {
        const arr = kids.get(pid)
        if (arr) {
          if (!arr.some((x) => x.id === child.id)) arr.push(child)
        } else {
          kids.set(pid, [child])
        }
      }
      const roots = []
      for (const n of node.values()) {
        if (n.parentId && n.parentId !== n.id && node.has(n.parentId)) addKid(n.parentId, n)
        else roots.push(n)
      }
      const catalogOnly = new Map()
      for (const n of node.values()) {
        const cat = n.catalog || (projectionsBySession[n.id] && projectionsBySession[n.id].values && projectionsBySession[n.id].values.subagentCatalog)
        if (!Array.isArray(cat)) continue
        for (const e of cat) {
          if (!e || !e.id) continue
          if (node.has(e.id)) {
            // The child already reached us through `parentId`; take its mode from
            // the catalog, because `mode` decides whether the opened conversation
            // is continuable (human can keep prompting) or read-only one-shot.
            const arr = kids.get(n.id)
            const c = arr && arr.find((x) => x.id === e.id)
            if (c && !c.mode) c.mode = e.mode || 'unknown'
            // The catalog label is the identity the app displays for a subagent.
            if (c && !c.catalogLabel && e.label && String(e.label).trim()) {
              c.catalogLabel = String(e.label)
            }
            continue
          }
          if (childByIdHas(kids, n.id, e.id)) continue
          addKid(n.id, {
            id: e.id,
            parentId: n.id,
            origin: 'subagent',
            title: null,
            fallbackTitle: null,
            subagentLabel: null,
            catalogLabel: (e.label && String(e.label).trim()) || null,
            running: e.activity === 'running',
            updatedAt: num(e.createdAt),
            catalog: null,
            mode: e.mode || 'unknown',
            raw: null,
          })
          catalogOnly.set(e.id, true)
        }
      }
      // View options mirror the shipped browser's dropdown: pinned rows lead,      // then the chosen order; the archived filter comes from the workspace
      // snapshot's registry-global archive set.
      const pinned = (opts && opts.pinned) || null
      const archived = (opts && opts.archived) || null
      const archivedMode = (opts && opts.archivedMode) || 'hide'
      const byOrder = (a, b) => {
        if (pinned) {
          const pa = pinned.has(a.id) ? 0 : 1
          const pb = pinned.has(b.id) ? 0 : 1
          if (pa !== pb) return pa - pb
        }
        if (opts && opts.order === 'title') {
          return String(a.title || a.id).localeCompare(String(b.title || b.id))
        }
        return b.updatedAt - a.updatedAt
      }
      const keep = (id) => {
        if (!archived) return true
        const isArchived = archived.has(id)
        if (archivedMode === 'only') return isArchived
        if (archivedMode === 'hide') return !isArchived
        return true
      }
      roots.sort(byOrder)
      for (const arr of kids.values()) arr.sort(byOrder)

      // What the app displays decides the row text:
      //   subagent row -> descriptor label (main window + right sidebar agree on it)
      //   normal row   -> the durable title (Host's current value beats the store's)
      // The session title stays available as secondary text for subagent rows.
      const titles =
        opts && opts.titles && typeof opts.titles.get === 'function' ? opts.titles : null
      const hostTitle = (n) => (titles && titles.get(n.id)) || null
      const labelFor = (n) =>
        n.origin === 'subagent'
          ? n.subagentLabel || n.catalogLabel || hostTitle(n) || n.title || shortId(n.id)
          : hostTitle(n) || n.title || n.fallbackTitle || shortId(n.id)
      const secondaryFor = (n) => {
        if (n.origin !== 'subagent') return null
        const t = hostTitle(n) || n.title
        return t && t !== labelFor(n) ? t : null
      }
      // "Fallback" means: we are NOT showing the string the app itself shows for
      // this session — a subagent's descriptor label, or a normal session's title.
      const isFallbackFor = (n) =>
        n.origin === 'subagent' ? !(n.subagentLabel || n.catalogLabel) : !(hostTitle(n) || n.title)

      const q = String(query || '').trim().toLowerCase()
      const matches = (label, id) => q === '' || String(label).toLowerCase().includes(q) || String(id).toLowerCase().includes(q)

      /**
       * Workspace level, restored from the shipped browser.
       *
       * `useWorkspaces` exposes the Host's `WorkspaceView` list as `items`. The
       * shipped browser groups sessions by **`workspace.sessionIds` membership**
       * — not by `cwd`, which only gates attaching a session to a workspace —
       * and appends a synthetic Ungrouped bucket last for sessions no workspace
       * accounts for (`dsh-client-ui-workspace/lib/client.js:420-439`
       * `groupByWorkspace`; the bucket's label is `t("group.ungrouped")` at
       * `:1272`).
       *
       * This plugin keeps its own nested subagent descendants underneath, which
       * the shipped browser deliberately hides (`:358`). With no workspace list
       * — Host baseline not ready, or a composition that does not provide the
       * hook — the tree degrades to the previous flat layout rather than
       * inventing a group.
       */
      const wsList = (opts && Array.isArray(opts.workspaces) ? opts.workspaces : EMPTY_ARR).filter(
        (w) => w && w.workspaceId,
      )
      if (wsList.length > 0) {
        const collapsed = (opts && opts.collapsedGroups) || null
        // A session that has a parent IN THIS MAP is a descendant: it renders
        // under that parent, never as a group root. The shipped browser never
        // faces this because it hides every `origin:'subagent'` row (`:358`);
        // this plugin shows them, and treating an unlisted child as a root is
        // exactly what produced a 1000-row flat list before.
        const isChild = (n) => !!(n.parentId && n.parentId !== n.id && node.has(n.parentId))
        const groups = []
        const accounted = new Set()
        for (const w of wsList) {
          const ids = Array.isArray(w.sessionIds) ? w.sessionIds : EMPTY_ARR
          const members = []
          // Newest activity across EVERY session the workspace accounts for
          // (descendants included): that is what "recent" order sorts by.
          let latest = 0
          for (const id of ids) {
            const n = node.get(id)
            if (!n) continue
            // Accounted even when it is hidden by the archived filter or is a
            // descendant, so it never reappears in Ungrouped.
            accounted.add(id)
            const at = activityOf(n)
            if (at > latest) latest = at
            if (isChild(n)) continue
            if (keep(id)) members.push(n)
          }
          groups.push({
            key: w.workspaceId,
            label: workspaceLabel(w, t('ungrouped')),
            path: typeof w.path === 'string' ? w.path : null,
            members,
            ungrouped: false,
            latest,
          })
        }
        const ungroupedMembers = []
        for (const n of node.values()) {
          if (!isChild(n) && !accounted.has(n.id) && keep(n.id)) ungroupedMembers.push(n)
        }
        // Reachability over the FULL graph, ignoring expansion and the archived
        // filter — the same guard the flat layout uses. Marking only the members
        // that survived the filter would promote every filtered-out session into
        // a bogus Ungrouped root; marking from every top-level node leaves only
        // real parent cycles.
        const reachable = new Set()
        const markReach = (id) => {
          if (reachable.has(id)) return
          reachable.add(id)
          for (const c of kids.get(id) || EMPTY_ARR) markReach(c.id)
        }
        for (const n of node.values()) if (!isChild(n)) markReach(n.id)
        for (const n of node.values()) {
          if (reachable.has(n.id)) continue
          ungroupedMembers.push(n)
          markReach(n.id)
        }
        if (ungroupedMembers.length > 0) {
          groups.push({
            key: '',
            label: t('ungrouped'),
            path: null,
            members: ungroupedMembers,
            ungrouped: true,
            // Synthetic; always rendered last and never ordered.
            latest: -1,
          })
        }

        // ---------------------------------------------- v1.1.0 workspace view state
        // Hiding a workspace is plugin-layer state (the Host has no workspace
        // archive API), so the split between the ordinary groups and the hidden
        // section is decided here, purely from the opts.
        // Duck-typed rather than `instanceof Set`: the seeded value can come from
        // another realm (the vm test sandbox, a micro-frontend), where a Set is
        // structurally identical but fails the instance check.
        const hiddenSet =
          opts && opts.hiddenWorkspaces && typeof opts.hiddenWorkspaces.has === 'function'
            ? opts.hiddenWorkspaces
            : null
        const hiddenMode =
          opts && (opts.hiddenMode === 'section' || opts.hiddenMode === 'only')
            ? opts.hiddenMode
            : 'hide'
        const wsOrder = opts && opts.workspaceOrder === 'host' ? 'host' : 'recent'
        const isHiddenGroup = (g) => !g.ungrouped && !!hiddenSet && hiddenSet.has(g.key)
        let visibleGroups = groups.filter((g) => !isHiddenGroup(g))
        let hiddenGroups = EMPTY_ARR
        if (hiddenMode === 'only') {
          visibleGroups = EMPTY_ARR
          hiddenGroups = groups.filter(isHiddenGroup)
        } else if (hiddenMode === 'section') {
          hiddenGroups = groups.filter(isHiddenGroup)
        }
        // "Archived only" drops a workspace that would render empty; other modes
        // keep the bare header, exactly as the shipped browser does. Applied to
        // the ordinary groups only — the hidden section keeps every hidden
        // workspace so its "restore" action never becomes unreachable.
        if (archivedMode === 'only') {
          visibleGroups = visibleGroups.filter((g) => g.ungrouped || g.members.length > 0)
        }
        // recent = newest member activity first; Ungrouped is pinned to the end.
        const byRecent = (a, b) => {
          if (a.ungrouped) return 1
          if (b.ungrouped) return -1
          return b.latest - a.latest
        }
        if (wsOrder === 'recent') {
          visibleGroups = visibleGroups.slice().sort(byRecent)
          hiddenGroups = hiddenGroups.slice().sort(byRecent)
        }

        const out2 = []
        const seenG = new Set()
        const walkG = (n, depth, gkey, sink) => {
          if (!n || seenG.has(n.id) || depth > MAX_DEPTH + 1) return
          seenG.add(n.id)
          if (!keep(n.id)) return
          // Every descendant of a group root belongs to that root's group, even
          // when some other workspace also lists it: a node renders once.
          const children = kids.get(n.id) || EMPTY_ARR
          const expanded = expandedIds.has(n.id)
          sink.push({
            key: 'ws:' + gkey + '/' + n.id,
            kind: n.origin === 'subagent' ? 'subagent' : 'session',
            depth,
            id: n.id,
            parentId: n.parentId,
            mode: n.mode,
            label: labelFor(n),
            labelIsFallback: isFallbackFor(n),
            secondary: secondaryFor(n),
            running: n.running,
            state: sessionState(statuses, n.id, n.running),
            tag: n.origin === 'subagent' ? t('subagent') : null,
            expandable: children.length > 0,
            expanded,
            childCount: children.length,
          })
          if (!expanded) return
          if (children.length === 0) {
            if (catalogOnly.has(n.id) || n.catalog === null) return
            sink.push({
              key: 'ws:' + gkey + '/' + n.id + ':none',
              kind: 'note',
              depth: depth + 1,
              id: n.id + ':none',
              label: t('noChildren'),
            })
            return
          }
          let shown = 0
          for (const c of children) {
            if (shown >= MAX_CHILDREN) {
              sink.push({
                key: 'ws:' + gkey + '/' + n.id + ':more',
                kind: 'note',
                depth: depth + 1,
                id: n.id + ':more',
                label: t('more', { n: children.length - shown }),
              })
              break
            }
            shown++
            walkG(c, depth + 1, gkey, sink)
          }
        }

        /**
         * Emit one workspace group (header + members) at `depth`. The key
         * namespace differs for the hidden section (`hidden:`) so the same
         * workspace can never collide with an ordinary group, and the archived
         * filter has already been applied when `members` was built.
         */
        const emitGroup = (g, depth, hiddenGroup) => {
          const gkey = (hiddenGroup ? 'hidden:' : '') + g.key
          const isCollapsed = !!(collapsed && collapsed.has(g.key))
          out2.push({
            key: 'ws:' + gkey,
            kind: 'workspace',
            depth,
            id: g.key,
            label: g.label,
            path: g.path,
            ungrouped: g.ungrouped,
            hidden: !!hiddenGroup,
            expanded: !isCollapsed,
            expandable: true,
            childCount: g.members.length,
          })
          if (isCollapsed) return
          if (g.members.length === 0) {
            out2.push({
              key: 'ws:' + gkey + ':empty',
              kind: 'note',
              depth: depth + 1,
              id: 'ws:' + gkey + ':empty',
              label: t('empty'),
            })
            return
          }
          // Search stays shallow and grouped: matching member rows only.
          if (q !== '') {
            for (const m of g.members) {
              const label = labelFor(m)
              if (!matches(label, m.id)) continue
              out2.push({
                key: 'ws:' + gkey + '/' + m.id,
                kind: m.origin === 'subagent' ? 'subagent' : 'session',
                depth: depth + 1,
                id: m.id,
                parentId: m.parentId,
                mode: m.mode,
                label,
                labelIsFallback: isFallbackFor(m),
                secondary: secondaryFor(m),
                running: m.running,
                state: sessionState(statuses, m.id, m.running),
                tag: m.origin === 'subagent' ? t('subagent') : null,
                expandable: false,
                expanded: false,
              })
            }
            return
          }
          // Members are already top-level by construction (see `isChild`), so
          // each one is a root row of that group.
          g.members.sort(byOrder)
          for (const r of g.members) walkG(r, depth + 1, gkey, out2)
        }

        for (const g of visibleGroups) emitGroup(g, 0, false)

        // The hidden section is rendered at the very END of the tree, with its
        // own expand state. While searching in 'section' mode, a hit on a hidden
        // workspace's NAME reveals it (carrying the "hidden" tag) instead of
        // leaving it invisible; a hit on one of its sessions reveals it too.
        if ((hiddenMode === 'section' || hiddenMode === 'only') && hiddenGroups.length > 0) {
          let shownHidden = hiddenGroups
          if (q !== '') {
            shownHidden = hiddenGroups.filter((g) => {
              if (matches(g.label, g.key)) return true
              for (const m of g.members) if (matches(labelFor(m), m.id)) return true
              return false
            })
          }
          if (shownHidden.length > 0) {
            const sectionCollapsed = !!(collapsed && collapsed.has(HIDDEN_SECTION_KEY))
            out2.push({
              key: 'ws:' + HIDDEN_SECTION_KEY,
              kind: 'hidden-section',
              depth: 0,
              id: HIDDEN_SECTION_KEY,
              label: t('hiddenSection', { n: shownHidden.length }),
              expanded: !sectionCollapsed,
              expandable: true,
              childCount: shownHidden.length,
            })
            if (!sectionCollapsed) {
              for (const g of shownHidden) emitGroup(g, 1, true)
            }
          }
        }
        return out2
      }

      // Filter mode: flat and predictable — no expansion, no deep loading.
      if (q !== '') {
        for (const n of roots) {
          if (!keep(n.id)) continue
          const label = labelFor(n)
          if (matches(label, n.id)) out.push({ key: n.id, kind: 'session', depth: 0, id: n.id, label, labelIsFallback: isFallbackFor(n), secondary: secondaryFor(n), expandable: false, expanded: false, state: sessionState(statuses, n.id, n.running) })
        }
        for (const n of node.values()) {
          for (const c of kids.get(n.id) || EMPTY_ARR) {
            if (!keep(c.id)) continue
            const label = labelFor(c)
            if (matches(label, c.id)) {
              out.push({ key: n.id + '/' + c.id, kind: 'subagent', depth: 1, id: c.id, parentId: n.id, mode: c.mode, label, labelIsFallback: isFallbackFor(c), secondary: secondaryFor(c), expandable: false, expanded: false, running: c.running, state: sessionState(statuses, c.id, c.running) })
            }
          }
        }
        return out
      }

      const seen = new Set()
      const walk = (n, depth) => {
        if (!n || seen.has(n.id) || depth > MAX_DEPTH) return
        seen.add(n.id)
        if (!keep(n.id)) return
        const children = kids.get(n.id) || EMPTY_ARR
        const expanded = expandedIds.has(n.id)
        out.push({
          key: n.id,
          kind: n.origin === 'subagent' ? 'subagent' : 'session',
          depth,
          id: n.id,
          parentId: n.parentId,
          mode: n.mode,
          label: labelFor(n),
          labelIsFallback: isFallbackFor(n),
          secondary: secondaryFor(n),
          running: n.running,
          state: sessionState(statuses, n.id, n.running),
          tag: n.origin === 'subagent' ? t('subagent') : null,
          expandable: children.length > 0,
          expanded,
          childCount: children.length,
        })
        if (!expanded) return
        if (children.length === 0) {
          if (catalogOnly.has(n.id) || n.catalog === null) return
          out.push({ key: n.id + ':none', kind: 'note', depth: depth + 1, id: n.id + ':none', label: t('noChildren') })
          return
        }
        let shown = 0
        for (const c of children) {
          if (shown >= MAX_CHILDREN) {
            out.push({ key: n.id + ':more', kind: 'note', depth: depth + 1, id: n.id + ':more', label: t('more', { n: children.length - shown }) })
            break
          }
          shown++
          walk(c, depth + 1)
        }
      }

      // Reachability over the FULL graph, ignoring expansion. It exists only to
      // find nodes no root can reach (a parent cycle), which are then shown as
      // extra roots. Walking every unseen node instead — the obvious shortcut —
      // wrongly promotes every unexpanded child to a depth-0 row, which turns
      // the default view into a thousands-row flat list.
      const reachable = new Set()
      const mark = (id) => {
        if (reachable.has(id)) return
        reachable.add(id)
        for (const c of kids.get(id) || EMPTY_ARR) mark(c.id)
      }
      for (const r of roots) mark(r.id)
      const extraRoots = []
      for (const n of node.values()) {
        if (!reachable.has(n.id)) {
          extraRoots.push(n)
          mark(n.id)
        }
      }

      for (const r of roots) walk(r, 0)
      for (const r of extraRoots) walk(r, 0)
      return out
    }

    // Local helper kept tiny: does this parent already list that child id?
    function childByIdHas(kids, pid, cid) {
      const arr = kids.get(pid)
      return !!arr && arr.some((x) => x.id === cid)
    }

    function TreeView(props) {
      const ctx = props.ctx
      const t = props.t
      const useS = typeof props.useSessions === 'function' ? props.useSessions : fallbackSessions
      const useSt = typeof props.useSessionStatus === 'function' ? props.useSessionStatus : fallbackStatus
      const useW = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : fallbackWorkspaces

      const byId = useS((s) => (s && s.byId) || EMPTY) || EMPTY
      const projectionsBySession = useS((s) => (s && s.projectionsBySession) || EMPTY) || EMPTY
      const statuses = useSt((v) => v)
      // Registry-global archive/pin sets, exactly as the shipped browser reads
      // them: useWorkspaces((state) => state.archivedSessionIds) — see
      // dsh-client-ui-workspace/lib/client.js:2808-2809.
      const archivedIds = useW((s) => (s && s.archivedSessionIds) || EMPTY_ARR) || EMPTY_ARR
      const pinnedIds = useW((s) => (s && s.pinnedSessionIds) || EMPTY_ARR) || EMPTY_ARR
      // The Host's Workspace list — the ordered `WorkspaceView` array the shipped
      // browser groups sessions by. Absent it (baseline not ready), the tree
      // stays flat rather than inventing a group.
      const workspaceItems = useW((s) => (s && s.items) || EMPTY_ARR) || EMPTY_ARR

      const [order, setOrder] = useState('updated')
      const [archivedMode, setArchivedMode] = useState('hide')
      // Workspace groups start EXPANDED. Unlike the shipped browser — which
      // collapses every group and only auto-expands the current one — the
      // workspace level here is an added distinction, not a gate the operator
      // must open before seeing any session.
      const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
      const [menuOpen, setMenuOpen] = useState(false)
      const [rowMenu, setRowMenu] = useState(null)
      const [renameId, setRenameId] = useState(null)
      const [renameText, setRenameText] = useState('')

      /**
       * Authoritative current titles, straight from the Host.
       *
       * A session's title is REPLACED over its life (a `session/title` event with
       * source `fallback` = truncated first message, later replaced by `provider`
       * or `user`). The client store's `byId[id].title` can be a stale snapshot:
       * `refreshProjections` loads "a complete projection baseline ONCE PER
       * CONNECTION" and is a no-op afterwards
       * (api-session-controller manager.js:254-264), so catalog children can keep
       * the early `fallback` title forever.
       *
       * `remote.session.list({})` is a FRESH host read of every session
       * (`lib/index.js:1883-1906` "Read every visible attached and persisted
       * Session") and carries each session's current `projections.values.title`.
       * That is the same value the conversation header shows.
       */
      const [titleMap, setTitleMap] = useState(() => null)

      const loadTitles = useCallback(() => {
        try {
          const remote =
            (ctx && typeof ctx.get === 'function' && ctx.get('remote')) || (ctx && ctx.remote)
          const svc = remote && remote.session
          if (!svc || typeof svc.list !== 'function') {
            console.error('[session-tree] remote.session.list unavailable')
            return
          }
          Promise.resolve(svc.list({}))
            .then((res) => {
              const items = res && res.ok && res.value && res.value.items
              if (!Array.isArray(items)) return
              const m = new Map()
              for (const it of items) {
                if (!it || !it.sessionId) continue
                const t = it.projections && it.projections.values && it.projections.values.title
                if (typeof t === 'string' && t.trim()) m.set(it.sessionId, t)
              }
              setTitleMap(m)
            })
            .catch((e) => console.error('[session-tree] title load failed', e))
        } catch (e) {
          try {
            console.error('[session-tree] title load failed', e)
          } catch (_) {}
        }
      }, [ctx])

      useEffect(() => {
        loadTitles()
      }, [loadTitles])

      // Default-collapsed on purpose: the first paint is the ordinary session
      // list, each expandable node showing its child count, and the 1187-row
      // subtree is built only when the operator asks for it.
      const [expandedIds, setExpandedIds] = useState(() => new Set())
      const [query, setQuery] = useState('')
      // v1.1.0 workspace view state: order, hidden set, hidden-section mode.
      // All three are mirrored into localStorage; when storage is unavailable
      // they simply degrade to in-memory state (feature spec B.3 / risk D3).
      const [workspaceOrder, setWorkspaceOrder] = useState(() => loadWorkspaceOrder())
      const [hiddenWorkspaces, setHiddenWorkspaces] = useState(() => new Set(loadHiddenWorkspaces()))
      const [hiddenMode, setHiddenMode] = useState(() => loadHiddenMode())
      const requested = useRef(new Set())

      const ensureLoaded = useCallback(
        (id) => {
          if (!id || requested.current.has(id)) return
          requested.current.add(id)
          try {
            const svc = ctx && ctx.sessions
            if (svc && typeof svc.refreshProjections === 'function') {
              const p = svc.refreshProjections(id)
              if (p && typeof p.catch === 'function') p.catch(() => {})
            }
          } catch (e) {
            /* best effort: lineage usually needs no extra load at all */
          }
        },
        [ctx],
      )

      /**
       * A child's durable title lives in its OWN projection store, which exists
       * only once the session has been observed (manager.js:529-531 returns
       * undefined otherwise). Without it the store row degrades to the
       * delegation label. Requesting the projection is what makes the tree text
       * equal the title the opened conversation shows. Bounded on purpose:
       * at most MAX_CHILDREN children per expansion (matching what can actually
       * be rendered), six per tick, deduped for the component's lifetime — so a
       * full workspace costs about one request per session, once.
       */
      const ensureChildTitles = useCallback(
        (parentId) => {
          const svc = ctx && ctx.sessions
          if (!parentId || !svc || typeof svc.refreshProjections !== 'function') return
          const ids = []
          for (const k of Object.keys(byId)) {
            const row = byId[k] || EMPTY
            if (row.parentId === parentId && !requested.current.has(k)) ids.push(k)
          }
          const pending = ids.slice(0, MAX_CHILDREN)
          if (pending.length === 0) return
          const step = () => {
            const batch = pending.splice(0, 6)
            if (batch.length === 0) return
            for (const id of batch) {
              requested.current.add(id)
              try {
                const p = svc.refreshProjections(id)
                if (p && typeof p.catch === 'function') p.catch(() => {})
              } catch (e) {}
            }
            try {
              setTimeout(step, 60)
            } catch (e) {}
          }
          step()
        },
        [ctx, byId],
      )

      const toggle = useCallback(
        (id) => {
          const willExpand = !expandedIds.has(id)
          setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
          ensureLoaded(id)
          if (willExpand) ensureChildTitles(id)
        },
        [expandedIds, ensureLoaded, ensureChildTitles],
      )

      /** Fold/unfold one workspace group. Groups are keyed by workspaceId. */
      const toggleGroup = useCallback((key) => {
        setCollapsedGroups((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }, [])

      /** Pick the workspace order ('recent' | 'host'); persisted best-effort. */
      const pickWorkspaceOrder = useCallback((value) => {
        const next = WORKSPACE_ORDERS.indexOf(value) >= 0 ? value : 'recent'
        setWorkspaceOrder(next)
        storageWrite(LS_WORKSPACE_ORDER, next)
      }, [])

      /** Pick the hidden-workspace view mode ('hide' | 'section' | 'only'). */
      const pickHiddenMode = useCallback((value) => {
        const next = HIDDEN_MODES.indexOf(value) >= 0 ? value : 'hide'
        setHiddenMode(next)
        storageWrite(LS_HIDDEN_MODE, next)
      }, [])

      /**
       * Hide or restore one workspace. There is no Host API for workspace
       * archiving, so this Set is the single source of truth; localStorage is
       * only a mirror (a write failure never loses the in-memory state).
       */
      const setWorkspaceHidden = useCallback(
        (key, hidden) => {
          if (!key) return
          const next = new Set(hiddenWorkspaces)
          if (hidden) next.add(key)
          else next.delete(key)
          saveHiddenWorkspaces(next)
          setHiddenWorkspaces(next)
        },
        [hiddenWorkspaces],
      )

      const openNode = useCallback(
        (row) => {
          try {
            const svc = ctx && ctx.uiWorkspace
            if (!svc || typeof svc.openSession !== 'function') {
              // Never fail silently again: a missing service here is exactly what
              // made every click a no-op before `inject` was declared.
              console.error('[session-tree] uiWorkspace.openSession unavailable', {
                hasCtx: !!ctx,
                hasUiWorkspace: !!(ctx && ctx.uiWorkspace),
              })
              return
            }
            if (row.kind === 'subagent' && row.parentId) {
              svc.openSession({
                parentSessionId: row.parentId,
                childSessionId: row.id,
                mode: row.mode === 'continuable' || row.mode === 'one-shot' ? row.mode : 'unknown',
              })
            } else {
              svc.openSession(row.id)
            }
          } catch (e) {
            try {
              console.error('[session-tree] open failed', e)
            } catch (_) {}
          }
        },
        [ctx],
      )

      /** Open one subagent conversation in the right Sidebar as a separate pane. */
      const openAside = useCallback(
        (row) => {
          try {
            const svc = ctx && ctx.sidebarRight
            if (!row.parentId || !svc || typeof svc.openResource !== 'function') {
              console.error('[session-tree] sidebarRight.openResource unavailable', {
                hasParentId: !!row.parentId,
                hasSidebarRight: !!(ctx && ctx.sidebarRight),
              })
              return
            }
            svc.openResource(subagentChatAddress(row.parentId, row.id, row.mode), {
              kind: 'subagentchat',
              preferNewPane: true,
            })
          } catch (e) {
            try {
              console.error('[session-tree] openResource failed', e)
            } catch (_) {}
          }
        },
        [ctx],
      )

      /**
       * Row actions, matching the shipped implementations:
       *   pin/unpin   -> ctx.remote.workspace.pinSession({sessionId})   (WorkspacePinSessionRequest)
       *   archive     -> ctx.uiWorkspace.archiveSession(id)
       *   unarchive   -> ctx.uiWorkspace.unarchiveSession(id)
       *   fork        -> ctx.uiWorkspace.forkSession(id, onCreated)
       *   rename      -> ctx.sessions.using(id, {source}, ref => ref.binding.session.rename(title))
       * Pin lives only on the Remote namespace (the uiWorkspace client service has no pin).
       */
      /**
       * `remote` is read optionally (`ctx.get`) rather than injected: a wrong
       * entry in the hard inject list would stop the whole plugin from loading
       * and silently revert the sidebar, while a missing namespace here only
       * disables pin/unpin. Two shipped packages do inject "remote"
       * (dsh-client-ui-workspace:4113), so this is belt-and-braces.
       */
      const remoteWorkspace = () => {
        try {
          if (ctx && typeof ctx.get === 'function') {
            const r = ctx.get('remote')
            if (r && r.workspace) return r.workspace
          }
        } catch (e) {}
        return (ctx && ctx.remote && ctx.remote.workspace) || null
      }

      const rowAction = useCallback(
        (row, action) => {
          setRowMenu(null)
          try {
            const ui = ctx && ctx.uiWorkspace
            if (action === 'pin' || action === 'unpin') {
              const ws = remoteWorkspace()
              const fn = ws && ws[action === 'pin' ? 'pinSession' : 'unpinSession']
              if (typeof fn !== 'function') {
                console.error('[session-tree] remote.workspace.' + action + 'Session unavailable')
                return
              }
              Promise.resolve(fn.call(ws, { sessionId: row.id })).catch((e) =>
                console.error('[session-tree] ' + action + ' failed', e),
              )
              return
            }
            if (action === 'archive' || action === 'unarchive') {
              const fn = ui && ui[action === 'archive' ? 'archiveSession' : 'unarchiveSession']
              if (typeof fn !== 'function') {
                console.error('[session-tree] uiWorkspace.' + action + 'Session unavailable')
                return
              }
              Promise.resolve(fn.call(ui, row.id)).catch((e) =>
                console.error('[session-tree] ' + action + ' failed', e),
              )
              return
            }
            if (action === 'fork') {
              if (!ui || typeof ui.forkSession !== 'function') {
                console.error('[session-tree] uiWorkspace.forkSession unavailable')
                return
              }
              Promise.resolve(ui.forkSession(row.id)).catch((e) =>
                console.error('[session-tree] fork failed', e),
              )
              return
            }
            if (action === 'rename') {
              setRenameId(row.id)
              setRenameText(row.label)
            }
          } catch (e) {
            try {
              console.error('[session-tree] row action failed', e)
            } catch (_) {}
          }
        },
        [ctx],
      )

      /** Commit an inline rename through the session's own binding. */
      const commitRename = useCallback(
        (row) => {
          const next = String(renameText || '').trim()
          setRenameId(null)
          if (!next || next === row.label) return
          try {
            const svc = ctx && ctx.sessions
            if (!svc || typeof svc.using !== 'function') {
              console.error('[session-tree] sessions.using unavailable; cannot rename')
              return
            }
            Promise.resolve(
              svc.using(row.id, { source: 'workspaceOperation' }, (reference) =>
                reference.binding.session.rename(next),
              ),
            ).catch((e) => console.error('[session-tree] rename failed', e))
          } catch (e) {
            try {
              console.error('[session-tree] rename failed', e)
            } catch (_) {}
          }
        },
        [ctx, renameText],
      )

      const archives = useMemo(() => new Set(archivedIds), [archivedIds])
      const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds])
      const rows = useMemo(
        () => buildRows(byId, projectionsBySession, expandedIds, query, t, statuses, {
          order,
          archived: archives,
          archivedMode,
          pinned,
          titles: titleMap,
          workspaces: workspaceItems,
          collapsedGroups,
          workspaceOrder,
          hiddenWorkspaces,
          hiddenMode,
        }),
        [byId, projectionsBySession, expandedIds, query, t, statuses, order, archives, archivedMode, pinned, titleMap, workspaceItems, collapsedGroups, workspaceOrder, hiddenWorkspaces, hiddenMode],
      )

      /** Every parent id in the current map — the bound for "expand all". */
      const idsWithChildren = useMemo(() => {
        const s = new Set()
        for (const k of Object.keys(byId)) {
          const p = (byId[k] || EMPTY).parentId
          if (p) s.add(p)
        }
        return s
      }, [byId])

      /**
       * v1.4.1（F8/R300 修复）：rail（侧栏收起）渲染决策**延迟到全部 hook 之后**。
       * 旧实现在此处早退 `return h('button', …)`——而 TreeView 的最后一个 hook
       * （`workspaceAction` useCallback）在更后面（≈L1724），收起态渲染会比展开态
       * 少执行 1 个 hook → React「Rendered fewer hooks than expected」（minified
       * #300）；再展开时同一 fiber 又多回 1 个 → #310，两态交替即反复崩溃
       * （2026-11-14 真机实证：rc.3 环境冷启动/收起态触发，Boundary 捕获后树死）。
       * 修复 = 只记录 railMode 标记，rail 按钮的渲染移到最终 return 前（全部
       * hook 已跑完），两种模式的 hook 数量恒定。
       */
      const railMode = props.wide === false

      /** One view-options row; picking it applies the value and closes the menu. */
      const menuItem = (label, active, onPick) =>
        h(
          'button',
          {
            className: 'st-menu-item',
            key: label,
            role: 'menuitemradio',
            'aria-checked': active ? 'true' : 'false',
            onClick: () => {
              onPick()
              setMenuOpen(false)
            },
          },
          h('span', { className: 'st-menu-check' }, active ? '\u2713' : ''),
          h('span', null, label),
        )

      /** One action row inside a session's "…" menu. */
      const rowMenuItem = (label, onPick) =>
        h(
          'button',
          {
            className: 'st-menu-item',
            key: label,
            role: 'menuitem',
            onClick: (ev) => {
              try {
                ev.stopPropagation()
              } catch (e) {}
              onPick()
            },
          },
          h('span', { className: 'st-menu-check' }, ''),
          h('span', null, label),
        )

      const rowMenuPanel = (row) =>
        h(
          'div',
          {
            className: 'st-rowmenu',
            role: 'menu',
            onClick: (ev) => {
              try {
                ev.stopPropagation()
              } catch (e) {}
            },
          },
          rowMenuItem(pinned.has(row.id) ? t('unpin') : t('pin'), () =>
            rowAction(row, pinned.has(row.id) ? 'unpin' : 'pin'),
          ),
          rowMenuItem(t('rename'), () => rowAction(row, 'rename')),
          row.kind !== 'subagent' ? rowMenuItem(t('fork'), () => rowAction(row, 'fork')) : null,
          rowMenuItem(archives.has(row.id) ? t('unarchive') : t('archive'), () =>
            rowAction(row, archives.has(row.id) ? 'unarchive' : 'archive'),
          ),
        )

      /** One workspace action from the group row's "…" menu (hide / restore). */
      const workspaceAction = useCallback(
        (row, action) => {
          setRowMenu(null)
          if (!row || !row.id) return
          setWorkspaceHidden(row.id, action === 'hide')
        },
        [setWorkspaceHidden],
      )

      const workspaceMenuPanel = (row) =>
        h(
          'div',
          {
            className: 'st-rowmenu',
            role: 'menu',
            onClick: (ev) => {
              try {
                ev.stopPropagation()
              } catch (e) {}
            },
          },
          rowMenuItem(row.hidden ? t('restoreWorkspace') : t('hideWorkspace'), () =>
            workspaceAction(row, row.hidden ? 'restore' : 'hide'),
          ),
        )

      const body =
        rows.length === 0
          ? h('div', { className: 'st-note', style: { paddingLeft: 10 } }, query ? t('none') : t('empty'))
          : rows.map((row) => {
              if (row.kind === 'note') return h('div', { className: 'st-note', key: row.key }, row.label)
              if (row.kind === 'hidden-section') {
                return h(
                  'div',
                  {
                    className: 'st-row st-group st-group-section',
                    key: row.key,
                    role: 'treeitem',
                    'aria-expanded': row.expanded ? 'true' : 'false',
                    'data-key': row.key,
                    'data-kind': 'hidden-section',
                    'data-depth': String(row.depth),
                    style: { paddingLeft: 6 + row.depth * 13 },
                    title: row.label,
                    onClick: () => toggleGroup(row.id),
                  },
                  h('span', { className: 'st-twist' + (row.expanded ? ' st-open' : '') }, '\u25B6'),
                  h('span', { className: 'st-label' }, row.label),
                  !row.expanded ? h('span', { className: 'st-count' }, String(row.childCount)) : null,
                )
              }
              if (row.kind === 'workspace') {
                return h(
                  'div',
                  {
                    className: 'st-row st-group' + (row.ungrouped ? ' st-group-ungrouped' : ''),
                    key: row.key,
                    role: 'treeitem',
                    'aria-expanded': row.expanded ? 'true' : 'false',
                    // Render identity, readable from the live DOM: `data-key` is the
                    // exact React key of this row and `data-kind`/`data-depth` say
                    // what it is and how deep it sits. The SessionTree inspect
                    // provider answers from these attributes, so a geometry change
                    // can never silently disagree with what was rendered.
                    'data-key': row.key,
                    'data-kind': 'workspace',
                    'data-depth': String(row.depth),
                    // A hidden workspace keeps its own marker so the live DOM (and
                    // the inspect provider) can tell the hidden section apart.
                    ...(row.hidden ? { 'data-hidden': 'true' } : {}),
                    style: { paddingLeft: 6 + row.depth * 13 },
                    title: row.path || row.label,
                    onClick: () => toggleGroup(row.id),
                  },
                  h('span', { className: 'st-twist' + (row.expanded ? ' st-open' : '') }, '\u25B6'),
                  // Inline folder glyph: the shipped header uses a primitives icon,
                  // and client plugins are forbidden to import those. Drawing the
                  // same shape keeps the theme in charge via `currentColor`.
                  h(
                    'svg',
                    { className: 'st-folder', width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
                    h('path', { d: 'M1.5 3.2h4.2l1.5 1.9h7.3v7.7h-13z', fill: 'currentColor' }),
                  ),
                  h('span', { className: 'st-label' }, row.label),
                  row.hidden ? h('span', { className: 'st-tag' }, t('hiddenTag')) : null,
                  row.path && !row.ungrouped
                    ? h('span', { className: 'st-group-path' }, row.path)
                    : null,
                  !row.expanded ? h('span', { className: 'st-count' }, String(row.childCount)) : null,
                  // Hover-only workspace menu (Ungrouped is synthetic and can
                  // never be hidden): hide, or restore from inside the section.
                  row.ungrouped
                    ? null
                    : h(
                        'button',
                        {
                          className: 'st-more',
                          title: row.hidden ? t('restoreWorkspace') : t('hideWorkspace'),
                          'aria-label': row.hidden ? t('restoreWorkspace') : t('hideWorkspace'),
                          'aria-expanded': rowMenu === 'ws:' + row.id ? 'true' : 'false',
                          onClick: (ev) => {
                            try {
                              ev.stopPropagation()
                            } catch (e) {}
                            setRowMenu(rowMenu === 'ws:' + row.id ? null : 'ws:' + row.id)
                          },
                        },
                        '\u22EF',
                      ),
                  rowMenu === 'ws:' + row.id ? workspaceMenuPanel(row) : null,
                )
              }
              return h(
                'div',
                {
                  className: 'st-row',
                  key: row.key,
                  role: 'treeitem',
                  // See the group row: identity and depth must be readable straight
                  // off the DOM, because the SessionTree inspect provider reports
                  // what actually rendered instead of recomputing it from state.
                  'data-key': row.key,
                  'data-kind': row.kind,
                  'data-depth': String(row.depth),
                  style: { paddingLeft: 6 + row.depth * 13 },
                  title: [row.label, row.secondary, row.labelIsFallback ? t('titlePending') : null]
                    .filter(Boolean)
                    .join(' — '),
                  onClick: () => openNode(row),
                },
                h(
                  'span',
                  {
                    className: 'st-twist' + (row.expanded ? ' st-open' : '') + (row.expandable ? '' : ' st-empty'),
                    onClick: (ev) => {
                      try {
                        ev.stopPropagation()
                      } catch (e) {}
                      if (row.expandable) toggle(row.id)
                    },
                  },
                  '\u25B6',
                ),
                h('span', {
                  className: 'st-dot',
                  'data-state': row.state || 'idle',
                  title: t(STATE_LABEL_KEY[row.state] || 'stIdle'),
                }),
                renameId === row.id
                  ? h('input', {
                      className: 'st-rename',
                      value: renameText,
                      autoFocus: true,
                      'aria-label': t('rename'),
                      onClick: (ev) => {
                        try {
                          ev.stopPropagation()
                        } catch (e) {}
                      },
                      onChange: (ev) => setRenameText(ev.target.value),
                      onKeyDown: (ev) => {
                        if (ev.key === 'Enter') commitRename(row)
                        else if (ev.key === 'Escape') setRenameId(null)
                      },
                      onBlur: () => commitRename(row),
                    })
                  : h(
                      'span',
                      { className: 'st-label' + (row.labelIsFallback ? ' st-label-fallback' : '') },
                      row.label,
                    ),
                row.tag ? h('span', { className: 'st-tag' }, row.tag) : null,
                row.expandable && !row.expanded ? h('span', { className: 'st-count' }, String(row.childCount)) : null,
                row.kind === 'subagent'
                  ? h(
                      'button',
                      {
                        className: 'st-aside',
                        title: t('openAside'),
                        'aria-label': t('openAside'),
                        onClick: (ev) => {
                          try {
                            ev.stopPropagation()
                          } catch (e) {}
                          openAside(row)
                        },
                      },
                      '\u2197',
                    )
                  : null,
                h(
                  'button',
                  {
                    className: 'st-more',
                    title: t('rowMenu'),
                    'aria-label': t('rowMenu'),
                    'aria-expanded': rowMenu === row.id ? 'true' : 'false',
                    onClick: (ev) => {
                      try {
                        ev.stopPropagation()
                      } catch (e) {}
                      setRowMenu(rowMenu === row.id ? null : row.id)
                    },
                  },
                  '\u22EF',
                ),
                rowMenu === row.id ? rowMenuPanel(row) : null,
              )
            })

      // v1.4.1（F8/R300）：rail 渲染分支——此处全部 hook 已执行完毕，
      // railMode 与展开两种模式的 hook 数量恒定（不再触发 React #300/#310）。
      if (railMode) {
        return h(
          'button',
          {
            className: 'st-rail',
            title: t('expand'),
            'aria-label': t('expand'),
            onClick: () => {
              try {
                if (typeof props.expandSidebar === 'function') props.expandSidebar()
              } catch (e) {}
            },
          },
          h('span', { style: { fontSize: 16, lineHeight: 1 } }, '\u2261'),
        )
      }

      return h(
        'div',
        { className: 'st-root' },
        // Fallback only: with a real document the sheet is already in <head>
        // (see ensureStylesheet). Keeping this as a React child was the bug.
        stylesInHead ? null : h('style', null, CSS),
        h(
          'div',
          { className: 'st-head' },
          h('span', { className: 'st-head-label' }, t('title')),
          h(
            'button',
            {
              className: 'st-new',
              title: t('newSession'),
              'aria-label': t('newSession'),
              onClick: () => {
                try {
                  const svc = ctx && ctx.uiWorkspace
                  if (svc && typeof svc.startSession === 'function') svc.startSession()
                  else console.error('[session-tree] uiWorkspace.startSession unavailable')
                } catch (e) {
                  try {
                    console.error('[session-tree] startSession failed', e)
                  } catch (_) {}
                }
              },
            },
            '+',
          ),
          h(
            'button',
            {
              className: 'st-new',
              title: t('viewOptions'),
              'aria-label': t('viewOptions'),
              'aria-expanded': menuOpen ? 'true' : 'false',
              onClick: () => setMenuOpen((o) => !o),
            },
            '\u22EF',
          ),
          menuOpen
            ? h(
                'div',
                { className: 'st-menu', role: 'menu' },
                h('div', { className: 'st-menu-title' }, t('orderBy')),
                menuItem(t('orderUpdated'), order === 'updated', () => setOrder('updated')),
                menuItem(t('orderTitle'), order === 'title', () => setOrder('title')),
                h('div', { className: 'st-menu-title' }, t('workspaceOrderBy')),
                menuItem(t('wsOrderRecent'), workspaceOrder === 'recent', () =>
                  pickWorkspaceOrder('recent'),
                ),
                menuItem(t('wsOrderHost'), workspaceOrder === 'host', () =>
                  pickWorkspaceOrder('host'),
                ),
                h('div', { className: 'st-menu-title' }, t('archivedBy')),
                menuItem(t('archHide'), archivedMode === 'hide', () => setArchivedMode('hide')),
                menuItem(t('archShow'), archivedMode === 'show', () => setArchivedMode('show')),
                menuItem(t('archOnly'), archivedMode === 'only', () => setArchivedMode('only')),
                h('div', { className: 'st-menu-title' }, t('hiddenWsBy')),
                menuItem(t('hiddenWsHide'), hiddenMode === 'hide', () => pickHiddenMode('hide')),
                menuItem(t('hiddenWsSection'), hiddenMode === 'section', () =>
                  pickHiddenMode('section'),
                ),
                menuItem(t('hiddenWsOnly'), hiddenMode === 'only', () =>
                  pickHiddenMode('only'),
                ),
                menuItem(t('expandAll'), false, () => {
                  setExpandedIds(new Set(idsWithChildren))
                  setCollapsedGroups(new Set())
                }),
                menuItem(t('collapseAll'), false, () => {
                  setExpandedIds(new Set())
                  setCollapsedGroups(
                    new Set(
                      workspaceItems
                        .map((w) => w && w.workspaceId)
                        .filter(Boolean)
                        .concat([HIDDEN_SECTION_KEY]),
                    ),
                  )
                }),
                menuItem(t('reloadTitles'), false, () => loadTitles()),
              )
            : null,
          menuOpen ? h('div', { className: 'st-menu-backdrop', onClick: () => setMenuOpen(false) }) : null,
        ),
        h(
          'div',
          { className: 'st-search' },
          h('input', {
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: (ev) => setQuery(ev.target.value),
          }),
        ),
        h('div', { className: 'st-scroll', role: 'tree' }, body),
        rowMenu !== null
          ? h('div', { className: 'st-menu-backdrop', onClick: () => setRowMenu(null) })
          : null,
      )
    }

    class Boundary extends React.Component {
      constructor(p) {
        super(p)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err }
      }
      componentDidCatch(err) {
        try {
          console.error('[session-tree] render failed', err)
        } catch (e) {}
      }
      render() {
        if (this.state.err) {
          const msg = (this.state.err && this.state.err.message) || String(this.state.err)
          return h('div', { className: 'st-err' }, 'session-tree: ' + msg)
        }
        return this.props.children
      }
    }

    /**
     * Provider id of this plugin's read-only Cordis Inspect surface.
     * Registration is process-wide unique, so it must never be registered twice
     * (a second `register()` of the same id throws in the client registry).
     */
    const INSPECT_ID = 'SessionTree'
    const INSPECT_METHOD = 'snapshot'
    /** Measured class geometry, mirrored from the CSS above: base padding, 13px step. */
    const ROW_BASE_PAD = 6
    const ROW_DEPTH_STEP = 13

    /** Text that the app actually shows for one value; non-strings degrade to ''. */
    function inspectText(value) {
      if (typeof value === 'string') return value
      if (value === null || value === undefined) return ''
      return String(value)
    }

    /** Attribute read that never throws on a missing or exotic node. */
    function inspectAttr(el, name) {
      if (!el || typeof el.getAttribute !== 'function') return ''
      return inspectText(el.getAttribute(name))
    }

    /**
     * Depth of one rendered row, read from `data-depth` and falling back to the
     * padding the renderer applied. `-1` means "not determinable"; the schema
     * admits it because `depth` is `number`, not `integer`, and an honest -1 beats
     * inventing a level.
     */
    function inspectDepth(el, cs) {
      const declared = inspectAttr(el, 'data-depth')
      if (declared !== '') {
        const n = Number(declared)
        if (isFinite(n) && n >= 0) return Math.round(n)
      }
      const pad = parseFloat(cs && cs.paddingLeft)
      if (!isFinite(pad)) return -1
      return Math.round((pad - ROW_BASE_PAD) / ROW_DEPTH_STEP)
    }

    /** What the sidebar actually rendered, read back from the live DOM. */
    function snapshotRenderedRows() {
      const doc = typeof document === 'undefined' ? null : document
      if (!doc || typeof doc.querySelectorAll !== 'function') return { rows: [], groupCount: 0, rowCount: 0 }
      const rows = []
      // `.st-row` is the class every rendered ROW shares (workspace group and
      // session); `.st-note` (empty / "no subagents" / "N more omitted" hint) is
      // not a tree row and carries no row identity, so it is not a row here.
      const nodes = doc.querySelectorAll('.st-row')
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i]
        const cs = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        const label = el.querySelector('.st-label')
        const dot = el.querySelector('.st-dot')
        rows.push({
          key: inspectAttr(el, 'data-key'),
          kind: inspectAttr(el, 'data-kind') || 'session',
          depth: inspectDepth(el, cs),
          paddingLeft: inspectText(cs.paddingLeft),
          label: label ? inspectText(label.textContent).trim() : '',
          secondary: label ? inspectAttr(label, 'title') : '',
          state: dot ? inspectAttr(dot, 'data-state') : '',
          expanded: el.getAttribute('aria-expanded') === 'true',
          color: inspectText(cs.color),
          background: inspectText(cs.backgroundColor),
          fontWeight: inspectText(cs.fontWeight),
          top: Math.round(box.top),
          height: Math.round(box.height),
          visible: box.width > 0 && box.height > 0,
        })
      }
      let groupCount = 0
      for (const row of rows) if (row.kind === 'workspace') groupCount += 1
      return { rows, groupCount, rowCount: rows.length }
    }

    /**
     * Publish the rendered tree as a read-only Cordis Inspect provider, so an
     * agent can read what the sidebar ACTUALLY rendered (row order, level,
     * indentation, geometry, computed styles) inside the real running app — the
     * failure class that 107 green assertions never caught.
     *
     * `cordisInspect` is provided by the client runner, which is not part of
     * every composition, so it is requested with an OPTIONAL injection:
     * `ctx.inject([...], cb)` simply never calls `cb` while the service is
     * absent. It must never join the plugin's hard `inject` array — one missing
     * service there stops the WHOLE plugin from loading, and the left sidebar
     * silently falls back to the shipped browser.
     */
    function registerInspectProvider(ctx) {
      if (!ctx || typeof ctx.inject !== 'function') return
      try {
        ctx.inject(['cordisInspect'], (scoped) => {
          const inspect =
            (scoped && scoped.cordisInspect) ||
            (typeof ctx.get === 'function' ? ctx.get('cordisInspect') : undefined)
          if (!inspect || typeof inspect.register !== 'function') return
          return inspect.register({
            manifest: {
              id: INSPECT_ID,
              description: 'What the session-tree sidebar actually rendered, read from the live DOM.',
              methods: [
                {
                  name: INSPECT_METHOD,
                  description:
                    'Rendered rows in document order with level, indentation, geometry and computed styles.',
                  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                  // The Host enforces this schema strictly in BOTH directions: a
                  // keyword outside the enforced subset is refused when the manifest
                  // is published, and an answer is rejected when it carries a field
                  // outside `properties`, omits a `required` field, or has the wrong
                  // scalar type. Every field below is therefore declared AND always
                  // present in the returned row.
                  outputSchema: {
                    type: 'object',
                    properties: {
                      rows: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            key: { type: 'string' },
                            kind: { type: 'string' },
                            depth: { type: 'number' },
                            paddingLeft: { type: 'string' },
                            label: { type: 'string' },
                            secondary: { type: 'string' },
                            state: { type: 'string' },
                            expanded: { type: 'boolean' },
                            color: { type: 'string' },
                            background: { type: 'string' },
                            fontWeight: { type: 'string' },
                            top: { type: 'number' },
                            height: { type: 'number' },
                            visible: { type: 'boolean' },
                          },
                          required: [
                            'key',
                            'kind',
                            'depth',
                            'paddingLeft',
                            'label',
                            'secondary',
                            'state',
                            'expanded',
                            'color',
                            'background',
                            'fontWeight',
                            'top',
                            'height',
                            'visible',
                          ],
                          additionalProperties: false,
                        },
                      },
                      groupCount: { type: 'number' },
                      rowCount: { type: 'number' },
                    },
                    required: ['rows', 'groupCount', 'rowCount'],
                    additionalProperties: false,
                  },
                },
              ],
            },
            query(method) {
              if (method !== INSPECT_METHOD) throw new Error(`unknown ${INSPECT_ID} inspect method "${method}"`)
              return snapshotRenderedRows()
            },
          })
          // The disposer IS the callback's return value, so Cordis ties the
          // registration to this plugin's fiber: unloading the plugin retires the
          // provider with it.
        })
      } catch (e) {
        // Only reachable when the callback itself threw — an absent service never
        // calls it. The sidebar keeps rendering either way, so this is loud, not fatal.
        try {
          console.error('[session-tree] SessionTree inspect provider registration failed', e)
        } catch (_) {}
      }
    }

    return {
      // These MUST be declared. `apply`'s ctx only carries services that `inject`
      // resolves, so with `['slots']` alone `ctx.uiWorkspace` is undefined and
      // every click silently did nothing. The shipped client plugins declare the
      // same set (dsh-client-ui-subagent/lib/client.js:921-927).
      inject: ['slots', 'sessions', 'uiWorkspace', 'sidebarRight', 'locale'],
      apply(ctx) {
        // Before anything renders: get the stylesheet into <head>, so the first
        // paint of the tree is already styled. When there is no document (tests,
        // SSR) this is false and the render falls back to an inline <style>.
        stylesInHead = ensureStylesheet()
        // From here on the sheet must survive whatever else the page does to
        // <head>: arm the removal guard (a silent no-op where it cannot attach).
        guardStylesheet()
        let bound = null
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function' && typeof ctx.locale.bind === 'function') {
            ctx.locale.register('session-tree', DICT)
            bound = ctx.locale.bind('session-tree')
          }
        } catch (e) {
          try {
            console.warn('[session-tree] locale registration failed; using built-in dictionary', e)
          } catch (_) {}
        }
        const t = makeT(bound)
        const Component = (props) => h(Boundary, null, h(TreeView, Object.assign({}, props, { ctx, t })))

        ctx.slots.inject('sidebar.workspaces', () =>
          ctx.slots.register({ name: 'sidebar.workspaces', priority: -100 }, Component),
        )

        /**
         * Conversation-UI metadata (v1.4.0). Both entries are additive `list`
         * slots owned by shipped conversation packages, so they only render
         * where the owner mounts — no shipped UI is shadowed.
         *
         *   - MAIN: `conversation.composer.dock` — the ambient row below the
         *     composer card; this is the user's "会话的界面下面". It renders a
         *     strip for ADDRESSED child sessions, because the shipped
         *     `ModelSelect` is disabled for every child and the ContextMeter
         *     lives in the same composer block.
         *   - FALLBACK: `conversation.session.header.utilities` — permanent
         *     right-side utilities. The chip renders ONLY for read-only children
         *     (one-shot / unknown mode / parent offline), whose composer — and
         *     therefore the dock — is replaced by the shipped read-only composer.
         */
        const withLocale = (render) => (props) => render(Object.assign({}, props, { t }))
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'session-meta', order: 100 },
            withLocale((props) => h(SessionMetaStrip, props)),
          ),
        )
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            { name: 'conversation.session.header.utilities', id: 'session-meta-chip', order: 60 },
            withLocale((props) => h(SessionMetaChip, props)),
          ),
        )

        /**
         * Tree Runs panel (read-only dsh-tree-engine view): composer-dock pill
         * (id 'tree-runs', order 6) + right-sidebar tab, with the shell.overlay
         * fallback while the sidebarRight services are absent. Registered AFTER
         * the session-meta dock entry so the pre-existing seat keeps its slot
         * order (and any "first entry with this name" reader keeps finding it).
         */
        try {
          registerPanelSeats(ctx)
        } catch (e) {
          try {
            console.error('[session-tree] Tree Runs panel registration failed', e)
          } catch (_) {}
        }

        registerInspectProvider(ctx)
      },
      // Pure derivation/selector/components exposed as test seams
      // (`test/meta.test.cjs`, `test/render.test.cjs`). The module loader only
      // consumes `inject`/`apply`, so these add no runtime surface to the
      // mounted plugin.
      metaOf,
      selectReadOnlyMeta,
      SessionMetaStrip,
      SessionMetaChip,
      // Tree Runs panel seams (test/panel-render.test.cjs): the runtime factory
      // builds a store/controller/components trio against any `fetch`, and the
      // pure helpers are asserted directly.
      createPanelRuntime,
      createPanelController,
      createPanelStore,
      PANEL_VERSION,
      panelToneOf,
      panelTimeOf,
      panelPreviewOf,
      // panel-v2 pure helpers (design §5.5): tree status derivation, graph
      // layout, zoom constants, edge-state mapping and session counting.
      // v1.6.2 adds the hierarchy helpers (parent edges + depth/order) that
      // back the "分层与从属关系" graph rewrite (user ask m01512).
      treeStatusOf,
      treeBadgeOf,
      panelFreshnessOf,
      treeEdgesOf,
      treeLevelsOf,
      treeParentEdgesOf,
      treeHierarchyOf,
      treeGraphEdgesOf,
      treeGraphLayout,
      clampZoom,
      ZOOM_MIN,
      ZOOM_MAX,
      ZOOM_STEP,
      clampGraphHeight,
      fitZoomOf,
      readStoredGraphHeight,
      writeStoredGraphHeight,
      GRAPH_HEIGHT_DEFAULT,
      GRAPH_HEIGHT_MIN,
      GRAPH_HEIGHT_MAX,
      GRAPH_HEIGHT_KEY,
      edgeStateOf,
      statsSessionsOf,
    }
  },
})
