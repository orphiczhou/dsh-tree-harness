# 会话树 UI（浏览器半）设计与迭代规范

> 适用对象：继续迭代左侧栏树形界面的开发者/Agent。
> 代码位置：`packages/dsh-session-tree/client.js`（浏览器半，约 2,371 行 / 102 KB）+ `locale/*.json` + `icon.svg`。
> 本文件是 UI 迭代的**单一方案/变更记录**：先改这里，再改代码；每次改动同步更新 §5 变更记录。
> 当前版本：session-tree **v1.4.0**（2026-11-12）。

## 1. 设计原则（必须遵守）

1. **单写入口**：UI 方案只写在本文件；不要散落在报告或 Issue 里。
2. **只读优先**：UI 变更不得新增宿主写接口；树的写操作仍走 `tree-engine` 工具/`session_handoff`。
3. **客户端半边界**：只改 `client.js`/`locale`/`icon` → 刷新页面生效；改 `index.js`/patch → 必须 disable→enable（Loader 缓存宿主模块）。
4. **数据只来自公开服务**：`useSessions`/workspace/status 选择器；不要读私有 DOM 或复制引擎状态。
5. **大列表性能**：`buildRows` 是纯函数式行模型；新增功能优先在行模型层做派生，避免每行挂副作用。
6. **持久化容错**：`localStorage` 不可用时降级内存（见 `localStore()`）；键名集中在 `storageRead/Write` 附近。
7. **可访问性**：行/菜单保持键盘可达、`aria-*` 与 `role` 不被破坏；图标的 `aria-hidden`、按钮可聚焦。
8. **回归基线**：`test/render.test.cjs`、`test/style-guard.cjs` 必须全绿；行为变化补对应断言。
9. **版本纪律**：包内容变化必须 bump `package.json.version`（D6），再走发布镜像同步。

## 2. 代码地图（client.js 内部分区）

| 区域 | 关键符号（近似行） | 职责 |
|---|---|---|
| 样式注入/守卫 | `ensureStylesheet()` / `guardStylesheet()` | 注入侧栏样式；守卫外部样式覆盖（防主题/插件冲突） |
| i18n | `makeT(bound)` + `locale/en.json` / `locale/zh.json` | 所有用户可见文案；新增文案必须中英同时补 |
| 本地持久化 | `localStore()` / `storageRead/Write` / `loadWorkspaceOrder` / `loadHiddenMode` / `loadHiddenWorkspaces` | workspace 顺序、隐藏分区、视图模式的持久化；不可用降级内存 |
| 行模型 | `buildRows(byId, projections, expandedIds, query, t, statuses, opts)` | 纯函数：workspace 分组、最近活动排序、隐藏/归档过滤、检索命中、行标签/副标题/层级、每行 `meta` 派生 |
| 行内元数据 | `norm()`（透出 `modelSelection`/`agentPreset`/`tokenUsage`/`contextPressure`）、`metaOf(node)`、`metaTitleOf(meta,t)`、`rowMetaElement(row,t)`、`metaLevel(pct)` | 纯派生「model · effort · 上下文%」徽标；缺失一律 null，不猜；`meta.test.cjs` 单测纯函数边界 |
| 元数据预热 | `ensureMeta(ids)` + `MAX_META_PRELOAD=300` / `META_BATCH=6` / `META_INTERVAL_MS=60` | 仅对当前渲染的可见行、且缺 `contextPressure` 的行调 `ctx.sessions.refreshProjections`；有界、去重、失败静默 |
| 树视图 | `TreeView(props)` | 行渲染、展开/折叠、行级 `…` 菜单、视图菜单、workspace 菜单、空态/骨架 |
| 会话状态派生 | `sessionState(statuses, id, fallbackRunning)`、`activityOf` | 从宿主状态派生「运行/等待/完成」等视觉状态 |
| Inspect provider | `snapshotRenderedRows()`、`INSPECT_ID='SessionTree'` | 只读快照：行序/层级/缩进/计算样式，供 `cordis_inspect_query` 自查 UI |
| 宿主半（非 GUI） | `index.js` 的 `tree_send` / `session_handoff` | 工具与交接，不在 UI 文件内 |

## 3. 当前能力清单（UI 侧）

- 任意深度嵌套会话树（子代理行嵌套在父会话下）+ 展开/折叠；
- 按 workspace 分组与排序（按最近活动；顺序本地持久化）；
- workspace 隐藏/恢复 +「已隐藏」分区；会话归档过滤（hide/show/only）；
- 检索召回（标题/标签/ID 匹配）；固定（pinned）/归档（archived）行区分；
- 行级 `…` 菜单（打开、归档/取消归档等）；视图菜单（已归档模式、密度等，以实际代码为准）；
- 会话状态徽标（运行/等待/完成等派生）；父子层级缩进与连接线；
- **行内元数据徽标（v1.4.0）**：每行显示 `model · effort` 与上下窗口占用 `NN%`（投影就绪后），tooltip 给出 provider/预设/窗口/token；缺失不渲染、不猜；
- 只读 `SessionTree` inspect provider（`snapshot`）。

> 文案与具体菜单项以 `locale/*.json` 与 `client.js` 为准；本清单只作导航。

## 4. 改哪里的速查

| 需求 | 先改 |
|---|---|
| 新行行为/按键/菜单项 | `TreeView` 内的行/菜单渲染 + `buildRows` 派生字段 |
| 新排序/分组规则 | `buildRows`（保持纯函数、可单测） |
| 新持久化偏好 | `storageRead/Write` + `load*/save*`，键名集中；补 localStorage 缺失降级 |
| 新文案/语言 | `locale/en.json`、`locale/zh.json`、`makeT` 调用处 |
| 新视觉状态 | `sessionState`/`activityOf` + CSS 类 + `style-guard` 断言 |
| 行内元数据/新徽标 | `norm()` 透出投影字段 → `metaOf()` 派生 → 行对象 `meta` → `rowMetaElement()` 渲染；纯函数补 `test/meta.test.cjs`，样式补 `style-guard` |
| 行高/缩进/几何 | 样式段 + `snapshotRenderedRows`（inspect 可验证）+ render 测试 |
| 宿主工具/交接行为 | `index.js`（不是 UI；走 disable→enable） |

## 5. 迭代流程（每次 UI 改动按序执行）

1. **STEP 0 方案**：在本文件 §6 变更记录写清：目标、交互变化、状态/边界、持久化影响、可访问性、回滚方式；
2. **STEP 1 实现**：`client.js` + `locale`（必要时 `icon.svg`）；**不要**顺手改宿主半；
3. **STEP 2 测试**：`node test/render.test.cjs`、`node test/style-guard.cjs`、`node test/meta.test.cjs`（行内元数据纯函数）、`node test/skills.test.cjs`；新增行为补夹具/断言；
4. **STEP 3 自检**：刷新页面看真实 UI；可用 `cordis_inspect_query` 的 `SessionTree` provider 核对行序/几何；截图存档（不入库，或按需放 `docs/assets/`）；
5. **STEP 4 版本**：包内容变化 → bump `packages/dsh-session-tree/package.json`（patch/minor 按影响），同步 README「当前版本」；
6. **STEP 5 发布**：`node scripts/release-plugin.mjs --target <mirror clone> --prune` → commit/tag/push → `ls-remote` 核对；monorepo 先提交；
7. **STEP 6 记录**：更新本文件 §6、根 README（如用户可见功能变化）、`docs/README.md`（若新增文档）。

> 宿主半改动（`index.js`/`cordis.patch.yml`）额外一步：**先 disable bundle**，改完 disable→enable；避免 HMR 读到半写文件导致宿主崩溃。

## 6. UI 变更记录

| 日期 | 版本 | 变更 | 证据/测试 |
|---|---|---|---|
| 2026-11-12 | v1.4.0 | **行内元数据徽标**：每个会话/子会话行显示 `model · effort`，上下文投影就绪后追加 `NN%`；tooltip/aria 给出 provider/预设/窗口/token；冷会话按可见行做有界预热（6 个/60ms、上限 300、失败静默）；缺失一律不渲染（诚实 `—`，不显示 0/假值）。数据全来自 `useSessions` 行投影，纯 client 半、0 host 改动（研究报告 `docs/reports/session-metadata-display-2026-11-12.md`）。 | render **157/157**（+24：徽标 12 项、预热 12 项）+ 夹具 9/9 + 实时 11/11；`meta.test.cjs` **37/37**；style-guard **25/25**；handoff 41/41、tree-send 25/25、skills 3/3、verify-bundle 0 fail |
| 2026-11-12 | v1.3.6 | 建立本规范文档（无代码变化）；确认后续 GUI 迭代按 §5 流程 | 文档链接检查通过 |

## 7. 关联文档

- 功能规格（§B 工作区归档/隐藏/检索）：[features-2026-11-11-spec.md](features-2026-11-11-spec.md)
- 合并记录（client module 契约）：[merge-session-tree-2026-11-11.md](merge-session-tree-2026-11-11.md)
- 用户使用说明：`packages/dsh-session-tree/README.md`（Features / View options / Workspace order / Per-row actions）
- 包测试：`packages/dsh-session-tree/test/render.test.cjs`、`test/style-guard.cjs`、`test/meta.test.cjs`
- 行内元数据研究报告：[../reports/session-metadata-display-2026-11-12.md](../reports/session-metadata-display-2026-11-12.md)
- 发布流程：[../guides/publishing.md](../guides/publishing.md)
