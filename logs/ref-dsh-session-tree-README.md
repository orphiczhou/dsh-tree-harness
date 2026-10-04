# dsh-session-tree

在 **左侧栏** 以树形显示当前工作区的全部会话：每个会话下面挂着它的子智能体（subagent）后代，多层嵌套可逐级展开；点击任意节点即打开该会话的对话（可看多轮历史、可继续对话）。

## 为什么需要它

DSH 的数据层**已经是树**：会话首行带 `parentSession` / `origin: "subagent"` / `delegationDepth`。
但自带的左侧栏**刻意隐藏**了 `origin === 'subagent'` 的会话
（`dsh-client-ui-workspace/README.md`："The sidebar hides durable summaries with `origin: 'subagent'`."），
唯一的树形入口是**会话标题栏**里的一个下拉树（`dsh-client-ui-subagent` 的 `SubagentHeaderLineage`）。

本插件把这个树**搬到左侧栏**，并且不再隐藏子会话。

## 实现要点（都有据可查）

| 事项 | 做法 | 依据 |
|---|---|---|
| 渲染席位 | 占用 single 席位 `sidebar.workspaces` | 左侧栏唯一的常驻区域 |
| 席位抢占 | `priority: -100` | `dsh-client-ui-slots/lib/index.js:167-173`：single 席位**同优先级注册会抛错**；提示原文 "register at a different priority to shadow it (lowest renders)"。自带 `WorkspaceBrowser` 是 priority 0 |
| 数据源 | 槽位 props 的 `useSessions`（`state.byId` / `state.projectionsBySession`） | `dsh-api-session-controller/lib/types/client/sessions/service.js:491-562` |
| 血缘字段 | `parentId` + `origin:'subagent'` | 同上 `:498-512`（`parentSessionId` → `parentId`）、`:514-539`（目录子节点以 `parentId` 注入 `byId`） |
| 标题 | `displayTitle` → `title` → `projectionValues.title` → 短 id | 同上 `:500`、`:519-521` |
| 打开会话 | 顶层：`ctx.uiWorkspace.openSession(sessionId)`；子会话：`openSession({parentSessionId, childSessionId, mode})` | `manager.js:63-78`、`:92-96`（地址恰好是这三个字段，**没有 `kind`**） |
| 深层加载 | 展开时 `ctx.sessions.refreshProjections(id)`（尽力而为） | `dsh-client-ui-subagent/lib/client.js:959-961` |

**没有 Host RPC**：宿主半 `index.js` 是空 `apply()`，只为承载 bundle 行。全部数据来自槽位 props。

## 用法

- 装好后**刷新页面**（代码重建的热替换需要 `pnpm run dev:web` 这类 watcher；本机没有源码 checkout，所以刷新即可）。
- 点击 **▶** 展开/折叠；点击行打开该会话。
- 顶部的输入框按标题或 id 过滤。
- 手动折叠到 icon rail 时显示一个 `≡`，点击展开侧栏。

## tree_send：跨越"邻接限制"的通讯工具（宿主半）

自带的 `send_message` 只能发给**直接父/直接子**（`ctx.subagents.sendMessage` 强制邻接）。兄弟之间、以及树中任意两个会话之间**没有官方路径**。

本插件的宿主半注册一个 `tree_send` 工具补上这一格：

| 参数 | 说明 |
|---|---|
| `target` | 目标 **continuable 子会话** 的 session id |
| `message` | 正文 |
| `delivery` | `steer`（默认，最近的一个 step 边界）或 `queue`（下一个 turn） |
| `parent` | 可省略——省略时用 `ctx.sessionQuery.filterSessions([{kind:'id',...}])` 从会话日志里读出 `header.parentSession` |

**它为什么合法**：`ctx.subagents.sendMessage` 按"活的发送者"授权，所以只能邻接；而
`ctx.subagents.prompt(request, signal)`（`dsh-subagent/lib/index.js:3010`，即 `subagents/prompt` Remote）
按**持久化的父地址**授权，且**宿主可直接调用**。`tree_send` 走的就是后者。

**它做不到的**（诚实边界）：
- 目标必须是 **continuable** 子会话；一次性（one-shot）子会话会以 `subagent/not-resumable` 拒绝。
- 目标的**直接父会话必须在线**，否则 `subagent/parent-unavailable`（`dsh-subagent/lib/index.js:3016`）。
- 只返回"已受理"（messageId），**不等待也不返回回复**。
- 顶层会话之间（没有共同父地址）仍无路径。

**没有引入新依赖**：工具定义直接以 `defineTool()` 产出的 JSON-Schema 形状注册，因此不需要 `@deepseek-ai/dsh-tools`。

### 为什么工具在**另一个包**里（`dsh-session-tree-tools/`）

这不是为了整洁，是被 Loader 的缓存行为逼出来的：

- 已导入的宿主模块**按包名缓存**。改一个已装载包的 `index.js`，**三种方式都拿不到新代码**（停用/启用、卸载重装、换入口文件路径）——所以要重启进程。
- 但**新的包名没有缓存模块**，于是可以通过普通的 `install_bundle` **立即生效**。

实测印证：把 `tree_send` 拆成新包 `@local/dsh-session-tree-tools` 并安装后，
工具**当场出现在工具列表里**，无需重启、无需改 profile 配置。

拆分还顺带避免了重启后 `tree_send` 被两个包**重复注册**（主包的 `index.js` 现在是空 `apply()`）。

### 端到端实测（不是只验证"注册成功"）

| 场景 | 结果 |
|---|---|
| 父 → 子，**省略 `parent`** 自动解析 | ✅ 受理；报告父会话 `session-1d637ac2-…`，与子会话日志里的 `parentSession` **逐字符一致** |
| **兄弟 → 兄弟**（由子智能体自己调用 `tree_send`） | ✅ 受理；同一个父地址，投递成功 |
| 不存在的目标 id | ✅ 干净失败：`tree_send: … is not a subagent session …`，**不投递** |

> 已知措辞瑕疵：目标**根本不存在**时，报错文案仍说"不是子会话（日志无 parentSession）"。
> 因为缓存约束，改这句需要再换一次包名，暂不为此churn；行为是安全的（失败且不投递）。


---

## 已知限制

1. **接管了整个会话浏览区**：自带的**搜索、工作区分组、归档/重命名等对话框**被遮蔽。这是选择"真·左侧栏树"的代价。
2. 单层最多渲染 **300** 个子节点（超出显示"另有 N 个未显示"），最大深度 8 层——防止一次渲染上千行。
3. 深层子会话的目录需要 `refreshProjections` 才能出现；未加载时该节点不显示展开箭头。
4. **已结束的一次性（one-shot）子会话打开后是只读的**——这是 DSH 自带的行为（`dsh-client-ui-subagent/README.md`）。只有 **continuable** 子会话能接受人继续对话；本 profile 的 `subagent` / `subagent_fork` 已配置为 `backgroundMode: continuable`（`cordis.yml:1263,1269`）。
5. 界面文案已走 Client locale（`session-tree` 命名空间），但语言切换后不会即时重渲染。

## 回退（完全可逆）

停用或卸载插件即可——自带 `WorkspaceBrowser`（priority 0）会立刻恢复渲染：

```
plugin_manager  action: set_bundle   target: @local/dsh-session-tree   enabled: false
```

或卸载：`plugin_manager  action: remove_bundle  target: @local/dsh-session-tree`

## 测试：headless 渲染（本仓库最硬的证据）

`test/render.test.cjs` 会在 Node 沙箱里**加载真实的 `client.js`**（stub 掉 `window.__ModuleLoader__` 与 React），
用**实时会话库重建的 `byId`**（1202 个会话，按 `service.js:498-529` 的形状）驱动它，再断言组件产出的行结构。

```powershell
& 'D:\DSHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe' 'dsh-session-tree\test\render.test.cjs'
```

它跑的是**插件本身**、吃的是**真实数据**——这是没有浏览器控制能力时所能拿到的最强验证（但仍不证明像素外观）。

**它当场抓出了 3 个真实缺陷**，都已修复：

| # | 缺陷 | 后果 | 修法 |
|---|---|---|---|
| B1 | 状态存的是 `collapsed` 集合，空集 = **全部展开** | 首屏不是会话列表而是上千行 | 改为 `expandedIds`，默认全折叠 |
| B2 | 兜底循环 `if (!seen.has(n.id)) walk(n, 0)` 把**所有未展开的子节点**当成根节点输出 | **默认视图 1202 行平铺**——正是要避免的失败模式 | 改为先对**完整图**做可达性计算，只把真正无法从任何根到达的节点（父子成环）补为额外根 |
| B3 | 经 `parentId` 到达的子会话拿不到目录里的 `mode` / `label` | continuable 子会话被当 `unknown` 打开（对话可能变只读），标签退化成短 id | 在目录合并阶段回填 `mode` 与 `label`（会话自身投影标题优先） |

当前 **81 项检查全绿**：默认 6 行（= 顶层会话数）、展开最宽的父会话后 6 → 306 行（300 子行 + "另有 887 个未显示"）、缩进层级 `[6, 19]`、key 唯一、自环/孤儿/互相引用/空行/异构字段均不抛异常、`wide=false` 渲染 rail 按钮、点击顶层会话以纯 id 打开、点击子会话以 `{parentSessionId, childSessionId, mode}` 打开（**无 `kind`**）、continuable 与 one-shot 分别以正确 mode 打开、展开触发 `refreshProjections`（自身 + 首批子会话）。

**标题一致性**（第五轮补测）：真标题优先于 `displayTitle`；无真标题时退化并带 `st-label-fallback` 弱化样式与说明性 tooltip；目录标签只进回退槽位，绝不冒充标题。

**回归护栏**（针对用户实测暴露的那个 bug 类）：断言 `inject` 必含 `slots/sessions/uiWorkspace/sidebarRight/locale/remote`；断言 `↗` 的 URL 是规范形式；断言四种状态的 `data-state` 与四个 token 都在 CSS 里；断言置顶/Fork/归档/重命名分别调用到正确的服务与参数。

**多层嵌套**（本轮补测）：合成 `root → mid → leaf → deep` 四级链，逐级展开分别得到 2 / 3 / 4 行，缩进 `[6,19]` → `[6,19,32]` → `[6,19,32,45]`，最深层 `6 + 3×13 = 45`。
——本工作区的真实数据只有 2 层（1 个主根 + 1187 个叶子），所以"多层"是用合成链证明的，不是用真实数据证明的。

**新建会话**（本轮补）：接管 `sidebar.workspaces` 会遮蔽自带的"新建会话"入口，因此标题栏加了一个 `+`，调用 `ctx.uiWorkspace.startSession()`（已测）。


## 用户实测反馈后的修复（第二轮）

真机试用的反馈是决定性的——**点击会话打不开**。根因不是渲染，是 `apply(ctx)` 的 ctx 只携带 `inject` 解析出的服务：

```
return { inject: ['slots'], apply(ctx) {...} }     ← ctx.uiWorkspace 是 undefined
const svc = ctx && ctx.uiWorkspace
if (!svc || typeof svc.openSession !== 'function') return   ← 静默返回，点了没反应
```

自带客户端插件都显式声明（`dsh-client-ui-subagent/lib/client.js:921-927` 是 `["sessions","uiWorkspace","slots","locale","sidebarRight"]`）。
现已改为同样的集合，并且**失败不再静默**——服务缺失会 `console.error`。测试里加了 `inject` 声明与 `openResource` 的回归护栏。

| 反馈 | 处理 |
|---|---|
| 点击会话无法打开 | ✅ 修 `inject`（根因）；测试断言 `inject` 必含 5 个服务 |
| 点击标题主体也不显示 | ✅ 同一个根因 |
| 缺少"在右边栏打开"的符号 | ✅ 子会话行加 `↗`，走 `ctx.sidebarRight.openResource('dsh-resource://subagentchat/session/<child>?parent=&mode=', {kind:'subagentchat', preferNewPane:true})`，与自带调用逐字一致 |
| 会话栏显示设置下拉菜单没了 | ✅ 重做"视图选项 ⋯"：排序（最近更新/按名称）、归档（隐藏/全部显示/仅已归档）、展开全部/全部折叠 |
| 圆点按状态上色 | ✅ 四态，沿用自带优先级 `待回应 > 进行中 > 已完成未看 > 已完成已看` |
| **树里的文字与打开的会话标题对不上** | ✅ 根因是 `displayTitle` **不是标题**（它是"真标题 → **目录名** → 原始 id"的展示投影；目录子节点还会退化成**委派标签**）。改为**真标题优先**、展开时**有上限地加载子会话标题投影**、无标题时用弱化样式明确标注"标题尚未加载"。详见 `PR.md` §5.1 |

**配色**（全部取自官方 token 列表，随明暗主题走）：

| 状态 | 判定 | token | 色 |
|---|---|---|---|
| 进行中 | `running` | `--dsw-static-blue-500`（#3b82f6，带字面回退） | 蓝（带呼吸动画） |
| 待你回应 | `pendingInteraction.kind ∈ {approval, plan-review, question}` | `--dsw-alias-state-warn-primary` | 橙 #f59e0b |
| 已完成未看 | `completionUnread === true` | `--dsw-alias-state-success-primary` | 绿 #22c55e |
| 已完成已看 | 以上皆非 | `--dsw-alias-state-idle-primary` | 灰（亮色主题 #d4d4d4 / 暗色主题 #545557） |

> **蓝色的坑（第四轮才发现）**：最初用 `--dsw-alias-brand-primary` 当蓝色，查证后它其实是
> `var(--dsw-static-neutral-bluish-1000)`——**与 `--dsw-alias-label-primary` 同一个值，也就是文字色（近黑/近白）**，
> 根本不是蓝色。主题的 alias 层**没有蓝色状态色**，只有静态调色板里有 `--dsw-static-blue-400/450/500/600`。
> 现改用 `var(--dsw-static-blue-500,#3b82f6)`：token 优先，并带字面回退，保证任何情况下都是蓝的。
> 另外三个状态用的是 alias，**它们本身是随明暗主题切换的**（已核实 idle 在暗色下变 #545557）。

> 两处**有意偏离**自带实现：自带把"进行中"画成**灰色转圈**（`--dsw-alias-label-tertiary`），且"已完成已看"**完全不画点**；按你的要求改成蓝色圆点与灰色圆点。

**每行 `…` 菜单（置顶 / 重命名 / Fork / 归档）—— 已自行重建。**

不能复用自带组件：`renderSlot` 只允许渲染**自己 children 表里声明过的**子槽位（`dsh-client-ui-renderer/lib/client.js:331-332` 抛 `SlotOwnershipError`），而那些子槽位已由 `client-ui-workspace` 声明，重复声明会抛错并使插件加载失败。所以改用**等价服务调用**自己实现，逐条对齐自带的写法：

| 动作 | 调用 | 依据 |
|---|---|---|
| 置顶 / 取消置顶 | `ctx.remote.workspace.pinSession({sessionId})` / `unpinSession` | `WorkspacePinSessionRequest = {sessionId}`；pin **只在 Remote 上**，`uiWorkspace` 客户端服务没有 |
| 重命名 | `ctx.sessions.using(id,{source},ref => ref.binding.session.rename(title))` | 与自带 `renameSession` 逐字一致（`client.js:4176-4179`） |
| Fork | `ctx.uiWorkspace.forkSession(id)` | `client.js:4234-4242` |
| 归档 / 取消归档 | `ctx.uiWorkspace.archiveSession(id)` / `unarchiveSession(id)` | `client.js:4196-4219` |

重命名是**行内编辑**（回车提交、Esc 取消、失焦提交），不弹对话框。

`remote` **没有**放进硬 `inject`，而是用 `ctx.get('remote')` 可选读取。原因：硬 `inject` 里写错一个键会让**整个插件不加载**、左栏静默退回自带浏览器；而这里缺了只会让置顶/取消置顶失效并打日志。自带 `dsh-client-ui-workspace:4113` 确实注入 `"remote"`，所以这只是保险。因此 `inject` 仍然只有 5 项——**与已在运行页面里实测为 active 的那一组完全一致**，本轮没有引入新的加载风险。


## 验证状态

已验证（客观证据）：
- `node --check` 通过；4 个 JSON/YAML 清单以 UTF-8 解析通过
- `plugin_manager install_bundle` → `application: "applied"`，`exitCode: 0`，`warnings: []`
- `cordis_inspect_query` (client `Slots.listSubTree`, root `sidebar.workspaces`) 实测 occupant 列表：
  ```
  { registrant: "mf", priority: -100, active: true  }   ← 本插件
  { registrant: "mf", priority:  0,   active: false }   ← 被遮蔽的自带浏览器
  ```
  这证明 client 半**真的在页面里被求值并且注册成功**（优先级没撞车）。
- `test/render.test.cjs` 在真实 1202 会话数据上 23/23 通过（见上一节）。

**尚未验证**：渲染结果的外观。本会话没有浏览器控制能力，官方 `references/verification.md` 明确要求此时
"limit verification to JavaScript syntax, manifest validation, and the live Client slot, then report that visual verification remains unavailable"，
并禁止伪造截图。**视觉确认需要你刷新页面后自行查看。**

> ⚠️ **页面必须刷新一次**：上面的 B1/B2/B3 修复只改了 `client.js` 的文件内容。
> 客户端代码的代码级热替换需要 bundle watcher（`pnpm run dev:web`）在跑，本机没有源码 checkout，
> 因此**运行中的页面仍是修复前的旧代码**，刷新即可取到新 bundle（revision 由 mtime/size 派生）。

### ⚠️ 宿主半的 `tree_send` 需要重启应用才生效

实测结论（三次尝试，均为阴性）：

| 尝试 | 结果 |
|---|---|
| 改完 `index.js` → `set_bundle enabled:false` 再 `true` | `tree_send` **未注册** |
| 整个 bundle `remove_bundle` → `install_bundle` | `tree_send` **未注册** |
| 把宿主代码换成新文件路径并把 `exports["."]` 指过去 → 重装 | `tree_send` **仍未注册** |

三种方式都拿不到新代码，说明 Loader 的模块缓存**按包名**持有已导入的模块代际，
与官方文档一致（"Package replacements require restarting the process to load a fresh JavaScript module generation"）。
**客户端半不受影响**（刷新页面即可热替换）。所以：

- **树的 UI**：装好即生效（已实测占位 active）。
- **`tree_send` 工具**：**下一次重启 DSH 后**出现在工具列表里。

想省掉以后每次重启，可以把插件目录加进 `hmr` 的 `root`（官方文档给的宿主热更方式），
该行 Config 的真实 schema 是 `{base?, root?: string[], ignored?: string[], debounce?: number}`。
本次**没有**替你改 profile 配置，因为那是一次持久化的环境改动，应由你决定。

