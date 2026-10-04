# Proma-Easy → DSH 插件移植方案（PLAN）

| 项 | 值 |
|---|---|
| 版本 | v1.7-draft |
| 日期 | 2026-10-03 |
| 状态 | 对抗审查中（AC v1.3，round 7 修复版；延续**对账矩阵修复法**（六矩阵：①§4.1 节点迁移 ②§4.3 棒迁移 ③§4.3 序列迁移 ④§4.3 项目迁移+双状态机同步表 ⑤§4.7 Config 键总表 ⑥§8 断言清单，两两对照后统一修复，禁止逐条打补丁）。前史：round 6 修复版；REPAIR_MODE_RESET 第 2 次触发改用对账矩阵修复法：①§4.1 节点迁移 ②§4.3 棒迁移 ③§4.3 序列迁移 ④§4.3 项目迁移 ⑤Config 键总表 ⑥§8 断言清单；并伴随修复 R5 Arbiter 4 条 advisory） |
| 审查记录 | `logs/attack-log.json`、`docs/review-report.md`（审查启动后生成） |
| v1.1 变更 | 统一引擎体量口径（309KB 实测）；里程碑改用 S0–S5 编号，M1–M8 保留专指 Nanju 功能编号并补映射表；树面板数据通路与 §4.6 对齐；remote-session 裁剪声明与里程碑归属补全；fork 通路命名统一并补附录 A；定义 P0–P2 优先级；补 tree_dispatch 状态回写、Nanju 角色闭环、回滚后注册表更新语义；§8 终态断言客观化、渲染脱敏与差分测试判据落地 |
| v1.2 变更 | 澄清 automation 同名不同物（§1/§4.5）；E2E 流程补验收步骤（§8）；工具名统一 `nanju_scaffold`（§4.3）；补 telemetry.ts 不移植决策（§4.3）；inject 白名单改为 session-tree 实证 5 键 + remote 可选（§4.2）；office 技能补 §2 来源行；快照冻结时机明确为 save 时、恢复在 rollback 时（§4.3/§5）；cancelled 状态补取消动作入边（§4.1）；项目注册表补非终态状态机（§4.3）；§8 补审批不升权断言 |
| v1.3 变更 | 三层同步修复（REPAIR_MODE_RESET）：§10 补「Defender 按窗口避让轮换家族」常设规则、同窗分配不变式 H1–H3、R1–R6 逐窗解析表与窗口准入断言（R3 已按规则由 glm-5.3 切换到 deepseek-flash）；§7 工作量口径唯一化为「成员区间精确求和」，MVP 由 ≈7–10 更正为 6.5–10；§4.2 面板数据通路定案为单一机制 `stateSource='host-remote'`/`refresh='pull'`（S0 单点判据，非并列选项），B1/B2/B3 由教训改写为可执行断言；§4.3 棒/序列/裁决出口三组枚举化，补齐 `skip` 推进语义与「验收棒」序列无关终止绑定（新增 `nanju_role decide`）；§8 同步补序列无关验收、跳过分支、面板拉取相等、口径核对断言；附录 A.1 补录 `sessionQuery` 实测条目并标注「节选非闭集」 |
| v1.4 变更 | 三层同步修复（round 4）：**数据模型层**补 `gradeState.timeout`（与 §4.1 节点超时对齐）、给出「落定」唯一权威定义（`running → {succeeded, failed, timeout}`，`skipped`/`frozen` 不属于落定）、补 `sequenceState`/项目状态**完整迁移表**（含 `completed → running` 重入、`completed → abandoned`、`frozen → abandoned`）、固定 `acceptanceRole` 必须 ∈ `roles` 且 = `roles` 末位（中位验收棒 = `config-error`，含 Config 校验声明）；**业务流程层**补 `running` 超时出边（失败/超时同一重试-冻结路径）、手动 `handoff` 幂等键与并发仲裁、验收「需修改」重入链与 `re-entering:{roleId}` 三条出边闭合、§4.2 回退终点登记为 §4.6 第 4 行、§1 P0/MVP 辖域映射唯一化；**验收条件层**§8 同步补超时/重入/迁移闭集/`acceptanceRole` 校验/handoff 幂等断言，落地 R8「关键信息」K1–K5 清单与 B3 退化短 id 客观判据（§4.2/§8 两处同源），审批不升权断言的读取载体明确为 `approval.overrideOf` + `sessionQuery` 事件面并列入 S0 验证项；附录 A.1 补录 `approval` 服务、附录 B 修正「唯一入边」表述并补「落定」术语 |
| v1.5 变更 | 三层同步修复（round 5）：**数据模型层**（ATK-Z-001）§4.1 收割触发改为**双轨语义（即时收割 + 定时 sweep 硬截止兜底）**四条路径，新增引擎内部定时 sweep（载体 `ctx.timer.interval`，附录 A.1 补录 `timer` 服务实测条目），超时由「后验时间戳」升格为硬截止（最坏检测延迟 = 阈值 + sweep 周期），§4.3 棒超时声明「同源同值」扩展为同一阈值且同一收割机制；**业务流程层**（ATK-F-007）§2/§3/§4.2 三处同源补 `tree-view-ipc.ts` 迁移处置声明（IPC 适配层不移植：请求/响应职责由 host-remote 通道吸收、事件订阅职责由 P2 推送通路承担）；**验收条件层**（ATK-Z-001）§7 S1 交付物补定时 sweep、§8 棒超时断言补「无外部触发的超时硬截止断言」（假时钟注入）；（ATK-L-013 澄清）§4.3 补 `awaiting-review` 等待语义设计立场（人工决策状态不设自动超时/无默认决策、不占执行资源、status 可查可回收、可选提醒 Config `reviewReminderMinutes`），§4.4 设置行同步补两项 Config 键 |
| v1.6 变更 | **对账矩阵修复法（round 6，六矩阵两两对账后统一修复）**：① 新增 **§4.7 Config 键总表**（键名/类型/缺省/校验/出处，唯一真源）并补 Config schema 装载期校验（§7 S0、§8 断言）；② **基准时刻唯一定义** = `max(dispatchedAt, lastOutputAt)`（无产出即 `dispatchedAt`），§4.1/§4.3 同源，撤销「随 S0 冻结」悬置（advisory a）；③ **跨包收割接口**（包 A `registerHarvestProvider` / 包 C 备选自持 timer，S0 裁决形态，advisory b）；④ **timer 注入不可用回退语义**（退化为纯惰性收割 + `tree_status` 显式收割 + 启动告警，advisory d）与**时钟/定时器注入缝**声明；⑤ **棒级 `cancelled` 全链路**（gradeState 闭集扩展、cancel×handoff 幂等键并发仲裁、§8 断言）与节点级 `cancel`×超时竞争语义；⑥ **双状态机同步规则**（项目 × sequenceState 闭集映射，含 `accepted → rolled-back` 时序列保持 `completed`）；⑦ 项目迁移表 `re-entering → abandoned` 补「先冻结再置 abandoned」；⑧ K3 可回溯**机判算法**（归一化/检索文本/精确包含谓词/压缩器硬约束）；⑨ §8 超时断言改「不早于阈值、不晚于阈值+sweep 周期」并把棒用例移标 S3（advisory c）；⑩ 附录 B 补「基准时刻」「cancelled（棒级）」术语 |
| v1.7 变更 | **对账矩阵修复法（round 7，五攻击全部对六矩阵对账）**：①（ATK-I-013，矩阵④）双状态机同步表补 `awaiting-review → abandoned ⇔ 序列 completed → abandoned`（验收「放弃」）行，§8 裁决出口断言同步补「放弃」分支；②（ATK-L-015，矩阵①×⑥）**lastOutputAt 观测绑定**——补「产出事件」唯一定义来源（`sessionQuery.observeSession` 事件订阅）与「收割时刷新」二级机制（任一收割路径超时判定前必经 `sessionQuery.readSession`/`listEvents` 刷新 lastOutputAt），§8 补误判保护断言；③（ATK-I-014，矩阵⑤）§4.7 头部校验规则改**两类分级**（类型/约束类 = 装载失败；可用性类 = 回退+告警不阻断，唯一例外键 `scaffoldTemplatePath`）；④（ATK-I-015，矩阵⑥）§8 补 **sweep 降级断言**（`sweepMode='degraded-lazy'` 分支，兑现 §4.1 `sweepMode` 字段承诺）；⑤（ATK-U-012）§9 R1 差分判据**逐字段分类**（实测 tree-engine.cjs：`leaf_id`/`tree_id` 为调用方必填语义 id、引擎不生成 → 必一致；`session_id` 为运行期 fork 生成的 UUID v4 → 白名单；`subagent_id` 确定性拼接 → 必一致） |

---

## 1. 背景与目标

**源项目**：[Proma-Easy](https://github.com/orphiczhou/Proma-Easy)（v0.16.44，AGPL-3.0）——Proma（Electron 本地优先 Agent 桌面端）的增强 fork，增量为两块自有原创功能：

1. **树状任务分解引擎**（Tree）：`mcp__tree__*` 29 个工具 + `tree-engine.cjs` 引擎（~309KB；316,687 B，2026-10-03 实测 `D:\Codes\tree-harness` 工作副本；加固前历史快照约 ~156KB，见 `.bak-*` 链）+ 树视图面板 + tree-worker SKILL（54KB 工作流说明）。
2. **南大 Nanju 向导**（上游功能编号 M1–M8，见 §4.3 映射表）：向导 Agent + 编码 Agent、模式选择、左对话右 HTML 预览、4 角色编排、项目列表、7 目录文档骨架、fork 快照回滚、E2E 测试。

**编号约定**：本文档**里程碑**使用 S0–S5（§7）；**M1–M8 专指 Nanju 上游功能编号**（§4.3 映射表），两套编号互不混用。

**优先级定义**（全文适用；**S 段–P 级映射为唯一判定口径**）：
- **P0**：MVP 必做，并进入 S0–S5 里程碑基线。**辖域映射**：P0 = ① MVP 口径成员（= §7 的 S0+S1+S3 阶段全部交付物）∪ ② 其他阶段中被**显式标注 P0** 的行（如 §4.4 M1「免 UI」决策）。两类的并集即 P0，**故 P0 ⊋ MVP**——S2/S4/S5 的交付物可以是 P0（进入 S0–S5 基线），但不计入 §7 的 MVP 工作量口径；判定任一行优先级：先取该表行标注，无标注时按本映射落位（属 S0/S1/S3 → P0，属 S2/S4/S5 → P1）；
- **P1**：应做，若剪裁需在 §4.6 记录理由与触发条件（S2/S4/S5 中**未标注 P0/P2** 的交付物默认 P1）；
- **P2**：可选/延后，须依赖验证或明确裁决后才升级为 P1/P0（当前显式 P2：remote-session HTTP 桥、树面板事件推送，见 §1 裁剪声明与 §4.6）。

**开发主仓**：`D:\Codes\tree-harness`（树引擎源码、PRD、架构文档、加固 PR、补丁套件）——移植以该仓为准（比 Proma-Easy 快照更新），版权归属用户，可自由移植。

**目标**：把上述功能以 **DSH 插件** 形态落地，**机制层复用 DSH 原生能力**（Agent Teams / Subagents / Presets / Goals / Slots），只移植工作流与领域层。

**不移植**（DSH 原生已覆盖，见 §3 映射表）：
- `mcp__session__*` 11 个工具（→ `agentTeams` + `subagents`）
- 外部 stdio MCP 桥（→ DSH 原生 MCP 资源服务器配置）
- Proma 上游功能（chat、飞书/钉钉桥、planning、automation、voice 等；此处 automation 指 Proma **应用内自动化编排功能**，与 `default-skills` 中的同名技能包不是同一物，后者处理见 §4.5）

**裁剪声明（P2 可选，不纳入 S0–S5 里程碑基线）**：上游"远程会话控制"（remote-session HTTP 桥 12 工具）为 P2 可选——§3 映射到 `webServer.register` + `subagents.prompt`，§4.6 待定项裁决（S0 后）。若 S0 裁决为"做"，则以独立后续阶段（S6+）单列工作量与产出，不挤占 S0–S5；若裁决为"不做"，仅保留 §6 的安全条款作为未来约束。

## 2. 源侧增量清单（实测）

| 模块 | 源文件 | 体量 | 备注 |
|---|---|---|---|
| 树引擎 | `tree-engine.cjs`（tree-harness 本体 + 多个 hardening PR） | ~309KB 打包 CJS（316,687 B 实测；加固前 ~156KB） | 自包含、JSON 状态、无平台依赖 |
| 树工具适配 | `tree-mcp-tools.ts` + `proma-mcp-server.cjs` | 15.6KB + 8.1KB | Pi MCP 适配层，重写为 DSH tools |
| 树视图 UI | `TreeViewPanel.tsx` + `tree-view-ipc.ts` | 14KB + 6.4KB | React，重写为 DSH client 插件；`tree-view-ipc.ts`（Electron 跨进程 IPC 适配层）**不移植**，职责吸收声明见 §4.2 |
| 树工作流 | `default-skills/tree-worker/SKILL.md` | 54KB | 工具名需随整合调整 |
| Nanju 主进程 | `nanju-orchestrator/ipc/project/snapshot/preview-watcher/telemetry.ts` | ~19KB | 编排核心仅 ~120 行 |
| Nanju 角色配置 | `nanju-roles/*.json`（含 roles.json 序列） | 数 KB | 纯配置 |
| Nanju UI | `ModeSelectView / NanjuWorkspaceView / ProjectListView.tsx` | ~14KB | |
| Nanju E2E | `m8-integration-test.ts` | 4.6KB | 改造为 DSH 验收脚本 |
| 协作工具 | `agent-collaboration-tools.ts` + SKILL | 41KB + 12.7KB | 评估后决定（§4.6） |
| 办公技能 | `default-skills/office-*`（docx/xlsx/pptx/pdf，Anthropic 出品，随上游 vendored） | 各数 KB–数十 KB | 非自有原创增量；随包 E 原样直装或按需剔除（§4.5，保留独立 LICENSE） |

## 3. 目标侧能力映射（已实测验证）

以下 DSH 能力均经 `cordis_inspect_query` 实测确认（2026-10-03，本机运行实例）：

| Proma-Easy 机制 | DSH 原生等价物 | 移植决策 |
|---|---|---|
| Pi MCP 工具注册 | `ctx.tools.register`（JSON-Schema 形状，无需 `@deepseek-ai/dsh-tools`） | 重写适配层 |
| session 工具 11 个 | `agentTeams`（spawnTeammate/sendMessage/任务板/interrupt）+ `subagents`（continuable 子会话、prompt、sendMessage） | **不移植** |
| 远程会话控制 | `webServer.register`（路由/升级）+ `subagents.prompt`（按持久化父地址授权） | P2 可选（见 §1 裁剪声明） |
| fork 快照回滚 | 会话 fork 双通路：**client** 侧 `ctx.uiWorkspace.forkSession(id)`（session-tree README 实测验证）；**host** 侧编排经 `sessionController` 的 `@Remote('fork')`（Host Service 目录实测）+ 工作区副本 | 适配 |
| 角色编排（headless） | `agentPresets.register/mount` + `subagents.startContinuable` | 配置化重写 |
| MCP 外部桥 | DSH 原生 MCP 配置（本机已挂 tavily/zai_* 等） | **不移植** |
| JSON/JSONL 本地持久化 | `storage`/`storageDomain`（`storageDomain.open(spec)`） | 适配 |
| HTML 预览分屏 | client Slot `sidebar.right.tab.*`（keyed）+ `workspaceFiles.changes`（Remote 流式 watch） | 重写 |
| 项目列表/设置 | Slot `main`（keyed 主面板）+ `settings.section` + Config provider | 重写 |
| 技能包 | `skills.register/registerProvider` | 直装 |
| 命令入口 | `commands.register` | 新增（原版为 UI 入口） |
| 树状态可视化 | Slot `sidebar.panellist`（全局面板图标）+ `main`（keyed） | 重写（原 `tree-view-ipc.ts` IPC 适配层不移植，处置见 §4.2） |

**UI 工程范式**：直接沿用 `@local/dsh-session-tree` 已验证的模式（本机安装实例）：
- 席位注册与 `priority` 语义（single 席位同优先级抛错，lowest renders）
- `inject` 纪律（写错一个键整个插件不加载；已验证集合才进硬 inject，其余 `ctx.get()` 可选读取）
- Loader 按包名缓存宿主模块（改已装载包需重启；**新包名可即装即生效**）→ 决定了 §4 的拆包策略
- headless 渲染测试（stub `window.__ModuleLoader__` + React，真实数据驱动断言）
- Client locale 命名空间、官方 token 配色（alias 层无蓝色状态色，用 `--dsw-static-blue-500` + 字面回退）

## 4. 插件拓扑与模块设计

### 4.0 拆包总则

遵循两条已实证的约束：
1. **宿主半按包名缓存** → 引擎、工具、Nanju 核心各自独立包，迭代互不阻塞重启；
2. **client bundle 刷新即热替换** → UI 独立包可快速迭代。

```
D:\Codes\proma-easy-dsh\
├─ packages\
│  ├─ dsh-tree-engine\      # A：宿主半。引擎移植 + 工具注册（无 UI）
│  ├─ dsh-tree-panel\       # B：客户端半。树状态可视化面板
│  ├─ dsh-nanju-core\       # C：宿主半。角色预设 + 编排 + 项目/快照工具
│  ├─ dsh-nanju-ui\         # D：客户端半。模式选择/项目列表/HTML 预览
│  └─ dsh-easy-skills\      # E：技能包（tree-worker 重写版 + nanju SKILL + 通用技能）
├─ docs\                    # 方案、规约、审查产物
├─ logs\                    # Attack Log、审查报告
└─ tests\                   # 跨包 E2E（引擎一致性、headless 渲染、验收脚本）
```

命名空间用 `@local/` 前缀（与现役插件一致），发布时可整体切换 scope。

### 4.1 包 A：`@local/dsh-tree-engine`（宿主半）

**职责**：树引擎本体 + 对 Agent 暴露的工具面 + 状态管理。

**引擎移植策略**（用户已确认）：
- 以 `D:\Codes\tree-harness\tree-engine.cjs` 为源，**先反推规约再重写**：
  - S0 阶段从 `tree-mcp-tools.ts` + `proma-mcp-server.cjs` 提取 29 工具完整清单（名称/参数 schema/语义）；
  - 结合 `tree-worker/SKILL.md`（54KB 工作流规约）与 tree-harness 的 `01_PRD`、`03_ARCHITECTURE`、加固 PR 记录，产出《引擎行为规约》（docs/engine-spec.md）；
  - 重写为 TypeScript ESM（宿主半为 ESM），保留纯逻辑可测试性（引擎核心不 import DSH API）。

**工具面整合**（关键设计决策）：
- 29 个独立工具在 DSH 每轮都占 system prompt 预算，**整合为 ≤8 个复合工具**，按动词类别合并、以 `action` 判别参数细分：

| DSH 工具 | 覆盖原工具类别（示意，S0 规约冻结后定稿） |
|---|---|
| `tree_plan` | 创建/初始化计划树、导入目标 |
| `tree_node` | 节点 CRUD：add/update/move/expand/prune |
| `tree_dispatch` | 派发节点执行（内部转 `subagents.startContinuable`） |
| `tree_status` | 查询：树概览/子树/节点详情/统计 |
| `tree_log` | 执行日志/产物读取 |
| `tree_maintain` | 归档/重置/迁移/垃圾回收 |
| （按 S0 清单增补） | …… |

- 原 `mcp__tree__` 前缀取消，命名走 DSH 惯例（snake_case）。
- 每个工具的 `output.render` 提供紧凑文本渲染（对齐 `tree_send` 先例）。

**状态管理**：
- 树状态从 `~/.proma` 迁到插件自有存储：优先 `ctx.storage`/`storageDomain.open(spec)`（S0 验证 API 形状；不可用则回退到 profile 下插件数据目录）。
- **并发控制**：Proma 单应用假设不成立，DSH 多会话可能并发调用工具 → 引擎入口加**每树串行化队列**（per-tree mutex），S1 内置并测试。

**与原生协同**：
- `tree_dispatch` 执行节点时用 `subagents`（continuable），节点↔子会话 id 双向记录，使树节点能在 dsh-session-tree 插件中可见可点击（两条树天然对齐）。
- **节点状态回流（闭环语义）**：
  - 节点状态机：`pending → running → succeeded | failed | timeout | cancelled`（闭集；`cancelled` 由显式取消触发：`tree_dispatch {action:"cancel"}` 对 `running` 节点发起取消，内部转 `subagents.interrupt`（continuable 子会话）/ `agentTeams.interrupt`（teammate），收割路径收到中断终态后置 `cancelled`）。**cancel × 超时/sweep 竞争语义（对账矩阵 ①×④ 补全）**：取消请求已发出但子会话尚未落定的节点，不被 sweep 提前置为 `timeout`——中断终态与超时硬截止**先到者生效**（中断先到 → `cancelled`；硬截止先到 → `timeout`），落定即终态、二者不叠加；
  - `tree_dispatch` 派发即置 `running` 并记录 `{subagentSessionId, dispatchedAt}`；
  - 子会话落定（最终回复到达 / 报错 / 超时阈值默认 30 分钟，Config 可调；超时判定的检测保证见下「收割触发」④ 硬截止）后，由引擎侧收割逻辑把结果摘要、产物引用与终态回写节点：成功取子会话最终产出摘要入节点 `result`；失败记录错误文本，节点可经 `tree_dispatch {retry}` 重派（新子会话 id 追加进历史，不覆盖）；
  - **收割触发（双轨语义：即时收割 + 定时 sweep 硬截止兜底；四条路径，任一都不依赖面板）**：
    ① 引擎收到树相关工具调用时顺带收割；② 订阅会话结束通知（S0 验证 `sessionController`/`sessionQuery` 可用的事件面——两服务均见附录 A.1 实测条目，`sessionQuery` 另有注册侧用法实证；事件不可用/未启用时本路径缺席，由 ③④ 兜底）；③ `tree_status` 显式收割；④ **引擎内部定时 sweep（硬截止保证，正确性兜底）**：包 A 激活时经 **`ctx.timer.interval`**（Host `timer` 服务——"Disposable timer helpers mixed into Cordis contexts"，方法 `timeout`/`interval`/`throttle`/`debounce`，见附录 A.1）注册周期性收割，sweep 周期 = min(Config `sweepIntervalSeconds`，缺省 60 秒，`gradeTimeoutMinutes` 的½)，逐树扫描全部 `running` 节点，并经下述**跨包收割接口**遍历包 C 注册的全部 `running` 棒，对 `基准时刻 + 超时阈值 ≤ now` 者（**基准时刻（唯一定义，§4.1/§4.3 同源）= `max(dispatchedAt, lastOutputAt)`**；`lastOutputAt` = 该节点/棒关联子会话最近一次可观测产出（工具产物落盘 / 最终回复片段）到达引擎的时刻，由收割路径与产出事件回写（「产出事件」的唯一定义来源与回写机制见下「lastOutputAt 观测绑定」，不再是无载体的悬空引用）；无产出记录时 `lastOutputAt = dispatchedAt`，即基准时刻退化为 `dispatchedAt`。本定义统一 v1.5 中节点侧 `dispatchedAt` 与棒侧「最近产出」的双语义（R5 advisory a），并撤销「若引擎规约提取发现『最近产出时间』语义则随 S0 engine-spec 冻结」的悬置）执行与 ①②③ 完全相同的收割回写，走同一 per-tree（per-sequence）串行队列，幂等；
    - **硬截止保证（本条的规范承诺）**：在无任何树工具调用、事件订阅未启用或失败、用户不查询 `tree_status` 的未列场景下，超时节点/棒**最迟在 `超时阈值 + sweep 周期` 内被收割落定**（缺省 30min + 60s）——超时是**硬截止**而非仅在收割点后验标注的时间戳；①②③ 是降低检测延迟的优化路径，④ 是与外部触发无关的正确性兜底，二者执行同一收割回写逻辑；
    - **跨包收割接口（棒侧 sweep 载体，R5 advisory b；S0 裁决具体形态）**：sweep 定时器宿于包 A，棒状态宿于包 C，跨包经显式接口衔接。**规范形态（倾向）**：包 A 暴露 host 半注册面 `treeSweep.registerHarvestProvider(provider: {id: string, scan(now: number): Promise<void>})`（去注册 `unregister(id)`），包 C 激活时注册、停用时注销；包 A 的 sweep 每周期先扫自身 `running` 节点，再按注册序遍历全部 providers；`provider.scan` 必须幂等、走包 C 自己的 per-sequence 串行队列，与包 A 队列互不嵌套（两段各自串行）。**备选形态**：若 S0 验证包间服务可见性不成立，包 C 自持 `ctx.timer.interval` 独立 sweep（同一基准时刻/阈值/幂等语义，仅定时器宿主不同）；两形态的对外承诺（硬截止窗口）不变。形态裁决列入 §7 S0 交付物；
    - **时钟/定时器注入缝（可测试性设计，§8 假时钟断言的载体）**：引擎核心不 import DSH API（既定决策）；sweep 的时钟与周期回调以**构造注入**提供（`{now(): number; scheduleInterval(cb, ms): () => void}`），生产装配层用 `Date.now` + `ctx.timer.interval` 适配，S1/S3 单测注入虚拟时钟（可控时刻 + 手动 tick）——「屏蔽全部外部触发」与「保留 sweep 周期性」不冲突：外部触发 ①②③ 依赖外部输入（工具调用/事件订阅/status 查询），测试环境天然缺席；④ 的周期性来自被注入的定时器被手动 tick；
    - **lastOutputAt 观测绑定（round 7 补全，闭合「产出事件无入边」）**：`lastOutputAt` 有且仅有两个来源——**(a) 事件面订阅**：对每个 `running` 节点/棒关联的子会话经 **`sessionQuery.observeSession(sessionId)`** 建立观测（附录 A.1 实测方法；事件形状与「中间产出」判据 S0 验证冻结），任一中间产出事件（流式输出片段 / 工具产物落盘记录）到达即回写 `lastOutputAt`（走同一 per-tree/per-sequence 串行队列，幂等）；**(b) 收割时刷新**：任何收割路径（①③④，**含定时 sweep**）在**超时判定之前**必须先经 `sessionQuery.readSession` / `listEvents` 读取该子会话日志尾部的最新产出时间戳刷新 `lastOutputAt`，再计算基准时刻——硬截止判定的输入是**刷新后的** `lastOutputAt`，不是引擎内存旧值；由此保证「持续产出但不结束」的子会话不会被 sweep 误判 `timeout`（基准时刻随刷新顺延）。事件面不可用（收割路径 ② 缺席）时仅剩 (b)，**硬截止正确性不依赖事件订阅启用**；(a)(b) 均失败（会话日志不可读）时按 `lastOutputAt = dispatchedAt` 保守判定并 `console.error` 显式告警，不静默。§8 对应「误判保护断言」见超时硬截止断言补充项；
    - **timer 注入不可用的回退语义（R5 advisory d）**：若 S0 验证 `ctx.timer` 不可注入/不可用，路径 ④ 退化为**纯惰性收割**（仅 ①②③）+ `tree_status` 显式收割；此时硬截止承诺降级为「最迟在下次外部触发（任意树/Nanju 工具调用或 status 查询）时收割落定」，插件启动日志显式告警（`sweep:degraded:no-timer`），`tree_status` 输出携带 `sweepMode: 'timer' | 'degraded-lazy'` 字段供 §8 断言区分；该降级同步登记 §4.6；
  - 回写与树状态同一 per-tree 队列串行落盘，断线/崩溃后 `tree_status` 依会话日志重建终态（幂等）。

### 4.2 包 B：`@local/dsh-tree-panel`（客户端半）

**职责**：树状态可视化（原 TreeViewPanel 的 DSH 化）。

- **源侧 `tree-view-ipc.ts` 迁移处置声明（§2/§3 与本节三处同源，本节为唯一真源）**：该文件是 Electron 主/渲染进程间的 IPC 适配层，**本身不移植、无对应交付物**。其承载的两类职责由目标侧机制吸收——① **请求/响应**（面板向引擎查询树状态）→ 由本节定案的 host-remote 通道吸收：包 A `@Remote` 暴露只读查询、包 B 经 `ctx.remote.<tree 命名空间>` 调用（§4.2 数据通路）；② **事件订阅**（树变更通知）→ 对应本方案 `refresh = 'push'` 升级项的 Host Event → Client Event 通路（P2，§4.6 第 3 行；未启用前面板用拉取 + 手动刷新，不依赖事件）。Electron 专有传输（ipcMain/ipcRenderer 桥接、消息序列化）随源侧架构一并废弃，不进入任何 S0–S5 交付物清单。

- **席位选择**：**不抢占** `sidebar.workspaces`（session-tree 教训：遮蔽自带搜索/分组/归档）。改用：
  - `sidebar.panellist` 注册全局面板图标 → 点击在 `main`（keyed）打开树面板主视图；
  - 面板内复用 session-tree 已验证的交互模式（展开/折叠、状态色 token、`refreshProjections` 深层加载）。
- **数据通路**（与 §4.6 待定项一致，分两步走；通路字段为闭集枚举：`stateSource = 'host-remote'`、`refresh = 'pull' | 'push'`）：
  - **S2 初版（基线，定案）**：**`stateSource = 'host-remote'`（唯一取值，不再是"或"）**——树状态真源在宿主半（包 A），包 A 以 `@Remote` 暴露只读查询方法，包 B 经 **`ctx.remote.<tree 命名空间>`** 调用后读取快照；包 B 不注册独立 client `Service`、不复制状态。刷新语义 `refresh = 'pull'`：**拉取 + 手动刷新**（打开面板、点击刷新、切换树时拉取）——不承诺实时性；
  - **S0 单点判据（可失败，非并列选项）**：S0 必须实测「插件自定义 host 半 `@Remote` 命名空间是否出现在 client `ctx.remote` 下」（同型实证：`sessionController → ctx.remote.session`，附录 A.1）。通过 → 按定案实现；不通过 → 仅回退为包 B 经 `ctx.get('remote')` 的等价只读面（若有），否则**在 §4.6 登记为待定项（§4.6 第 4 行「树面板 host-remote 通路的等价只读面」）并在 S2 记录偏差**。两种调用形态的 `stateSource`/`refresh` 取值不变，**不存在两条并列可选架构**；
  - **事件推送（P2 升级项）**：`refresh` 由 `'pull'` 升为 `'push'` 仅在 Host Event → client Event 通路于 §4.6 验证通过后启用；未验证前 `refresh` 恒为 `'pull'`，§4.2 不假设推送存在。
- **inject 白名单**（硬 inject 仅用已验证键，与 dsh-session-tree 实证 active 集合完全一致）：`slots`、`sessions`、`uiWorkspace`、`locale`、`sidebarRight`；`remote` **不进硬 inject**，经 `ctx.get('remote')` 可选读取（实证依据：硬 inject 写错一个键整包不加载，session-tree README 第二轮修复记录）；其余服务缺失时降级为只读并 console.error，不静默。包 D 采用同一白名单——其 fork 入口依赖 `ctx.uiWorkspace.forkSession`（附录 A.6），`uiWorkspace` 必须在硬 inject 内；
- **回归护栏**（沿用 session-tree 测试断言风格）：行数/缩进层级/key 唯一/状态四态 `data-state`/打开会话调用形状。其中 B1/B2/B3 三条为参考实现 headless 测试**当场抓出的真实缺陷**（定义与出处：`logs/ref-dsh-session-tree-README.md`「测试：headless 渲染」节），本方案**逐条改写为可执行断言**（编号沿用 B1/B2/B3，定义如下；§8 行为层复用同一编号）：

  | 编号 | 缺陷语义（参考实现实测） | 本方案对应断言（S2 单测） |
  |---|---|---|
  | B1 | 折叠状态存 `collapsed` 集合，空集被解释为"全部展开"→ 首屏上千行 | 折叠字段名为 `expandedIds`，空集语义 = 全折叠；断言默认渲染行数 = 顶层节点数（空 `expandedIds` 不展开任何父节点） |
  | B2 | 兜底循环 `if (!seen.has(n.id)) walk(n,0)` 把所有未展开子节点当根输出 → 默认视图 1202 行平铺 | 先对完整图做可达性计算，仅把无法从任何根到达的节点（父子成环）补为额外根；断言存在层级时默认行数 ≠ 全节点数，且孤儿/自环/互相引用输入不抛异常 |
  | B3 | 经 `parentId` 到达的子会话拿不到目录里的 `mode`/`label` → continuable 被当 `unknown` 打开（可能只读）、标签退化成短 id | 目录合并阶段回填 `mode` 与 `label`（会话自身投影标题优先）；断言每条子会话行 `mode ∈ {continuable, one-shot}` 且 ≠ `unknown`，且 `label` **非退化短 id**（判据见下） |

  **B3「退化短 id」客观判据（可机判；§4.2 与 §8 共用同一判据，判据本体即唯一真源）**：记行的 `label`、会话 `sessionId`、该会话目录条目标题 `dirTitle`；归一化 `norm(x)` = 去除 `-`/`_`/空格。退化谓词 `degenerate(label, sessionId, dirTitle)` = 下列任一为真：
  (a) `label === sessionId`；
  (b) `label` 非空，且 `norm(sessionId).startsWith(norm(label))`、`norm(label) !== norm(sessionId)`、`norm(label).length ≥ 6`（= id 的缩短前缀）；
  (c) `norm(label)` 匹配 `^(session)?[0-9a-f]{6,}$`（纯 id 形状）**且** `dirTitle` 非空（= 目录有可用标题却被 id 顶替）。
  **断言**：每条子会话行 `label` 非空且 `degenerate(label, sessionId, dirTitle) === false`；若 `dirTitle` 与会话自身投影标题**均**缺失，则 `label` 必须为 `untitled:<sessionId 前 8 位>`（显式前缀使 (c) 不命中，视为非退化）。出处：参考实现 B3 缺陷的退化链「`displayTitle` → 目录名 → 原始 id」与「目录标签只进回退槽位，绝不冒充标题」（`logs/ref-dsh-session-tree-README.md`「实现要点/标题」「B3」「标题一致性」三处）。

### 4.3 包 C：`@local/dsh-nanju-core`（宿主半）

**职责**：Nanju 工作流的领域层。对应原 nanju-* 六个文件（~19KB）+ 角色配置。其中 `telemetry.ts`（轻量使用埋点）**不移植**：其用途（会话/操作计量）由 DSH 原生会话日志与 `tokenMeter` 覆盖，无独立埋点需求；若 S0 规约提取发现运行时依赖，再列入 §4.6 裁决。其余五个文件按下表映射。

**Nanju 上游功能编号 M1–M8 → 交付物映射**（M 编号专指上游功能，与里程碑 S0–S5 区分）：

| 上游功能 | 内容 | 交付位置 | 里程碑 |
|---|---|---|---|
| M1 | 模式选择（quick/iterative） | 命令流 + `ask_user_question`（§4.4） | S3（命令）/S4（如需 UI 增强） |
| M2 | 左对话右 HTML 预览 | 包 D `sidebar.right.tab` + iframe（§4.4） | S4 |
| M3 | 预览自动刷新 | `workspaceFiles.changes` 流（§4.4）；host 不起 watcher | S4 |
| M4 | 4 角色系统 | 包 C `agentPresets` 4 预设 + 角色序列 Config | S3 |
| M5 | 项目列表/注册表 | 包 C `storageDomain` 注册表 + 包 D `main` 面板 | S3（core）/S4（UI） |
| M6 | 7 目录文档骨架 | 包 C `nanju_scaffold` | S3 |
| M7 | fork 快照回滚 | 包 C `nanju_snapshot` + 会话 fork 双通路（§3） | S3 |
| M8 | E2E 集成测试 | tests/（改造 m8-integration-test，§8） | S5 |

**角色系统（M4）**：
- 4 角色（requirement-analyst / ux-advisor / architect / engineering-manager）→ `agentPresets.register` 注册为 4 个 YAML 预设（system_prompt 来自角色 JSON）；
- 角色序列（quick: 分析师→UX；iterative: 分析师→UX→架构师→工程经理）→ 插件 Config（可配置，不硬编码），提供 `roles.json` 默认值。

**编排器（对应 nanju-orchestrator，~120 行逻辑）**：
- `nanju_start(mode, requirement)`：创建向导会话（preset 挂载）→ 产出需求摘要；
- `nanju_handoff(roleId, contextSummary)`：`subagents.startContinuable` 起编码会话、注入 system_prompt + 上下文交接（保持原「上一棒产出摘要」协议）；
- 交接摘要由上一棒的最终产出自动压缩生成（复用 `compaction`/`tokenMeter` 或直接截取，S3 定稿）；上一棒为 `skipped` 时取最近一个 `succeeded` 棒的摘要（无则空摘要并标注 `no-predecessor-summary`，见下）；
- 双脑语义：向导 Agent = Lead 侧轻会话（引导需求），编码 Agent = continuable 子会话（实现方案），共享任务板记录里程碑（`agentTeams.createTask`）。
- **角色序列闭环（终止与交接触发）**（数据模型：序列配置 schema = `{roles: roleId[], acceptanceRole?: roleId}`；**约束（配置校验声明）**：`roles` 非空且无重复 id；`acceptanceRole` 若给出必须 ∈ `roles` **且必须等于 `roles` 末位**——**中位验收棒被明确禁止**（否则与「末位棒落定即序列推进走完」互斥，会产生无法判定「其后各棒是否执行」的语义），违约即 `config-error:acceptance-role-not-terminal`（`acceptanceRole` ∉ `roles` 记 `config-error:acceptance-role-unknown`），由 Config schema 装载期校验 + `nanju_start` 前复校，`nanju_role status` 报错且序列不启动；缺省 = `roles` 末位；三组枚举见下，闭集之外取值视为配置错误并由 `nanju_role status` 报错）：
  - **枚举（数据模型层）**：棒状态 `gradeState ∈ {pending, running, succeeded, failed, timeout, skipped, frozen, cancelled}`（`timeout` 与 §4.1 节点终态 `timeout` 对齐；`cancelled` 见迁移表与「棒级 cancel 语义」）；序列状态 `sequenceState ∈ {running, frozen, completed, abandoned}`；裁决出口 `decision ∈ {retry, skip, terminate}`；
  - **「落定」（settled）唯一定义（数据模型层，§4.3 与附录 B 全篇按此使用）**：一棒**落定** ⟺ `gradeState` 由 `running` 进入 `{succeeded, failed, timeout}` 之一（= 最终产出到达 / 报错 / 超时）。**`skipped` 由裁决产生，不属于落定**；**`frozen` 是等待裁决的中间态，也不属于落定**。**`cancelled`（显式取消，见迁移表）同样不属于落定**——它与 `skipped` 同属「由后续裁决显式推进」的终态。故「落定」既不涵盖 `skipped` 与 `cancelled`，也不等同于「到达终态」；
  - **状态迁移表（数据模型层，闭集；未列出者非法，S3 单测逐条覆盖）**：
    - 棒（`gradeState`）：`pending → running`（`nanju_handoff` 或自动推进）｜`running → succeeded | failed | timeout`（**落定**；`timeout` = 编码子会话无产出超过 Config `gradeTimeoutMinutes`，缺省 30，与 §4.1 节点超时同源同值——**同一阈值（Config `gradeTimeoutMinutes`）且同一收割机制（§4.1 收割触发④ 定时 sweep，经 §4.1 跨包收割接口触达包 C）、同一基准时刻定义（= `max(dispatchedAt, lastOutputAt)`，§4.1 唯一定义）**，含硬截止兜底（无外部触发时最迟 `阈值 + sweep 周期` 内落定））｜`failed | timeout → running`（`decide(retry)`，追加 `attempt`，不改写棒历史）｜`failed | timeout → frozen`（重试耗尽，等待裁决）｜`frozen → running`（`decide(retry)`）｜`frozen → skipped`（`decide(skip)`）｜`running → cancelled`（**棒级 cancel 语义**：`nanju_role {action:"cancel", gradeId}` 或宿主侧会话级中断被收割路径观测到中断终态；**cancel 不消耗重试次数、不自动重试**——棒置 `cancelled` 的同时序列同步 `running → frozen` 进入裁决等待，向导会话收到取消通知与裁决请求；cancel 与超时硬截止的竞争语义同 §4.1：先到者生效、不叠加）｜`cancelled → running`（`decide(retry)`，新 `attempt`，新棒推进不复活旧记录）｜`cancelled → skipped`（`decide(skip)`）｜其余一律非法（`succeeded` 无出边；`skipped` 不改写既有记录、仅可被再次裁决逐次追加；**重入不复活旧棒**，以新棒记录表达，见序列迁移 `completed → running`）；
    - 序列（`sequenceState`）：`running → frozen`（当前棒 `failed | timeout` 且重试耗尽）｜`frozen → running`（`decide(retry)`；或 `decide(skip)` 后继续推进下一棒）｜`running → completed`（**验收棒（= `roles` 末位）落定 `succeeded`**，或**验收棒被 `skip` 且序列推进走完**——两条 `awaiting-review` 入边**均**置 `sequenceState = completed`）｜`completed → running`（**重入**：验收「需修改」后从指定角色重跑，序列追加 `reentry` 序号）｜`frozen → abandoned` / `completed → abandoned`（`decide(terminate)` / 验收「放弃」）｜任意非终态 `→ abandoned`（`decide(terminate)`；若当时存在 `running` 棒，先执行 `running → frozen` 再 `frozen → abandoned`，保证无 `running` 棒残留）｜`abandoned` 为唯一无出边的序列终态；**`completed` 的出边仅 `→ running`（重入）与 `→ abandoned`，不返回 `frozen`**；
  - **交接触发（业务流程层）**：每棒编码会话**落定**（定义见上：`succeeded` / `failed` / `timeout`；**`skipped` 不属于落定**，其推进由裁决分支显式执行）即触发编排器推进——由引擎侧收割逻辑（同 §4.1 节点回流，**含与 §4.1 同源的超时判定与定时 sweep 硬截止兜底（§4.1 收割触发④）**）驱动，自动 `nanju_handoff` 下一棒并携带上一棒摘要；上一棒 `failed` **或 `timeout`**（同一路径，仅 `gradeState` 取值不同，用于可观测性与 §8 断言区分）时先重试一次（Config `autoRetryEnabled` 可关，重试不改写棒历史，仅追加 `attempt` 序号），仍失败则序列置 `frozen`、当前棒置 `frozen`，向向导会话报告等待裁决（`ask_user_question`：重派 / 跳过 / 终止）；`cancelled` 棒不触发自动重试，直接入裁决等待（见迁移表「棒级 cancel 语义」）；
  - **手动 `handoff` 的触发边界与幂等仲裁（业务流程层）**：工具面 `nanju_role {action:"handoff"}` 是**恢复出口，不是与自动推进并行的第二推进入口**——仅当序列为非终态且**当前无 `running` 棒**时允许，合法情形有二：① 崩溃/重启后 `nanju_role status` 显示存在 `pending` 棒（重建序列时补推进）；② 刚完成 `decide(retry)` / `decide(skip)` 需立即推进。**幂等键 = `(sequenceEpoch, barIndex)`**：对同一键重复 `handoff` 为 no-op（返回既有 `gradeId`，不新建编码子会话、不追加棒记录）；同一序列的自动推进与手动 `handoff` 由 §4.1 的 per-tree（此处为 per-sequence）串行队列串行化，先到者生效、后到者按同一幂等键合并。任何情形下 `handoff` 都不产生重复棒记录（唯一例外是 `decide(skip)` 按定义逐次追加的 `skipped` 记录）；对已处 `running`/`succeeded` 的同一棒调用 `handoff` 直接拒绝并返回既有 `gradeId` 与拒绝原因。**handoff 幂等键 × cancel 并发交互（对账矩阵 ②×⑥ 补全；同一 per-sequence 队列串行仲裁，先到者生效）**：`cancel` 先到且子会话尚未创建 → 棒 `pending → cancelled`，幂等键标记已取消，同键后续 `handoff` 返回错误 `handoff:bar-cancelled`（附既有 `gradeId`，不新建棒记录、不创建子会话）；`handoff` 先到（子会话已创建）→ `cancel` 转为对该子会话 `subagents.interrupt`，收割路径收到中断终态后棒置 `cancelled`（与超时硬截止先到者生效，同 §4.1 竞争语义）；两种序的恢复出口均为 `decide(retry)`（新棒推进、`attempt` 续接）；
  - **裁决出口语义（三分支均有确定终点；由 `nanju_role {action:"decide", gradeId, decision, reason?}` 落账，向导会话经 `ask_user_question` 收集后调用）**：
    - `retry`：当前棒回 `running`（新 `attempt`），序列由 `frozen` 回 `running`，原序列继续；
    - `skip`：当前棒记 `skipped{at, reason, decidedBy:'user'}`，**序列不停止**，直接推进到下一棒；跳过后交接摘要取**最近一个 `succeeded` 棒的摘要**（无则取空摘要并在交接记录标注 `no-predecessor-summary`）；`skip` 不计入重试次数，同一棒可重复裁决并逐次追加 `skipped` 记录；
    - `terminate`：序列置 `abandoned`，项目状态同步置 `abandoned`，不再推进、不再交接；
  - **终止条件（序列无关，不硬编码任何角色 id）**：当**验收棒**（= 序列配置的 `acceptanceRole`，由 schema 约束保证 = `roles` 末位；未显式指定时 = `roles` 末位）**落定**（定义见上，`succeeded`）**或**被 `decide(skip)` 跳过、且序列推进走完时，执行迁移 `in-progress → awaiting-review`。故 quick（分析师→UX）的验收棒为 **UX 棒**、iterative 的验收棒为 **工程经理棒**、任意增删角色的自定义序列以其 `roles` 末位（= 显式 `acceptanceRole`）为验收棒——**`awaiting-review` 的入边只有两条**：① 验收棒**落定且 `gradeState = succeeded`**；② 验收棒被 `skip` 且序列推进走完（`sequenceState = completed`）。**两条入边均置 `sequenceState = completed`**（因验收棒恒为末位棒）；入边与角色身份无关，任何序列路径均可达验收；中位验收棒已由 schema 禁止，故不存在「落定即入 `awaiting-review`」与「其后仍有棒需推进」并存的第三种情形；
  - **验收动作（业务流程层）**：到达 `awaiting-review` 后，编排器自动回到**向导会话**做验收确认（`ask_user_question`：通过 / 需修改（指明角色重入）/ 放弃）；三出口均有确定终点：
    - **通过** → 项目状态置 `accepted` 并落 `07_VERSIONS` 首条记录（序列含 `skipped` 棒时，记录中显式列出被跳过的棒与原因）；`sequenceState` 保持 `completed`（终态化，无出边）；
    - **需修改（指定 `roleId`）** → **重入迁移**：`sequenceState: completed → running`（追加 `reentry` 序号），项目状态 `awaiting-review → re-entering:{roleId}`，从 `roleId` 起重跑至验收棒（携带累计上下文）；重入棒为**新 `gradeId` 记录**、`attempt` 重置为 1，历史棒只读保留（与「重试不改写棒历史」同一原则）；重入路径推进走完后回到 `awaiting-review`（项目状态 `re-entering:{roleId} → awaiting-review`，`sequenceState → completed`），可再次验收（重入次数不设上限，逐次记 `reentry` 序号）；
    - **放弃** → 项目状态置 `abandoned`、`sequenceState: completed → abandoned`；
  - **`awaiting-review` 等待语义（设计立场：人工决策状态不设自动超时、无默认决策）**：验收是用户对成果的**人工裁决**，自动超时或默认决策（如超时自动通过/自动放弃）等于替用户做验收判断，与验收语义冲突，故明确不设超时出边——这是设计立场而非遗漏。该等待**不占用执行资源**：验收棒已落定、`sequenceState = completed`、无 `running` 棒、无存活编码子会话，等待成本仅为注册表中一条持久化状态记录（区别于 §4.3 棒级 `timeout`：后者针对**机器执行**的无产出，前者针对**人的响应**，人不设截止）。**可见性与回收路径（状态恒可查、恒可回收）**：`nanju_project {action:"status"}` / `nanju_role {action:"status"}` 可随时列出全部 `awaiting-review` 项目（含进入时间戳）；三条出边（通过/需修改/放弃）可由用户**任意时刻**经向导会话（`ask_user_question`）或直接经工具面手动触发；**崩溃/重启不丢失该状态**——注册表持久化，重启后凭 `status` 恢复上下文，不依赖向导会话存活（向导会话不可用时工具面手动裁决仍可达）。可选长周期提醒：Config `reviewReminderMinutes`（缺省关闭），到期经向导会话发一次提醒，仅提示、不代替决策、不改变状态、不重复发送；
  - **`re-entering:{roleId}` 的出边闭合（业务流程层，三条互斥且构成完整闭集）**：① `re-entering:{roleId} → awaiting-review`（重入路径推进走完，见上）；② `re-entering:{roleId} → in-progress`（重入路径中任一棒 `failed | timeout` 且重试耗尽 → 项目回 `in-progress`、序列 `running → frozen`，等待裁决；`decide(retry)` 后序列 `frozen → running`、项目 `in-progress`，继续重入路径；`decide(skip)` 时**序列不停止**，按既定语义推进至验收棒，项目状态不变直至走完）；③ `re-entering:{roleId} → abandoned`（重入期间 `decide(terminate)`，先冻结再置 `abandoned`）。重入棒被 `skip` 不产生第四条出边——`skip` 只作用于棒与序列推进，项目状态仍由上述三条之一决定；
  - `nanju_role {action:"status"}` 可随时查询当前棒/已完成棒/被跳过棒/等待裁决点与 `sequenceState`，向导与用户均可凭它恢复中断的序列（崩溃后由会话日志重建，幂等）。

**项目管理（M5/M6/M7）**：
- 项目注册表：`storageDomain` 持久化（项目 id、模式、状态、目录、关联会话树）。状态机含非终态与终态，**迁移表为闭集**：创建置 `in-progress`；序列执行中（含 `frozen` 等待裁决）保持 `in-progress`；**验收棒**（定义见上，= `acceptanceRole`/`roles` 末位，不绑定具体角色身份）**落定成功后**置 `awaiting-review`；验收「需修改」置 `re-entering:{roleId}`，该角色重入完成后回到 `awaiting-review`；序列 `terminate` 裁决或验收「放弃」置 `abandoned`；终态 `accepted` / `abandoned` / `rolled-back:{label}`（由已验收状态经 `nanju_snapshot rollback` 进入）。**显式迁移表**：`in-progress → awaiting-review`（两条入边，见上）｜`in-progress → abandoned`（`decide(terminate)`，序列处 `frozen`；有 `running` 棒时先冻结再置 `abandoned`）｜`awaiting-review → re-entering:{roleId}` / `→ accepted` / `→ abandoned`｜`re-entering:{roleId} → awaiting-review` / `→ in-progress`（重入棒 `failed|timeout` 重试耗尽）/ `→ abandoned`（`decide(terminate)`，**先冻结再置 `abandoned`**——存在 `running` 棒时先 `running → frozen` 再 `frozen → abandoned`，与本节 `re-entering` 出边③ 同一语义，终态无 `running` 棒残留）｜`accepted → rolled-back:{label}`｜`abandoned` 与 `rolled-back:*` 为终态、无出边；
- **双状态机同步规则（项目状态 × `sequenceState`，闭集；对账矩阵 ③×④ 产物，未列组合非法）**：`in-progress → awaiting-review` ⇔ 序列 `→ completed`｜`in-progress → abandoned` ⇔ 序列 `→ abandoned`（经 `running → frozen → abandoned`）｜`awaiting-review → accepted` ⇔ 序列**保持 `completed`**（终态化不变）｜`awaiting-review → re-entering:{roleId}` ⇔ 序列 `completed → running`｜`awaiting-review → abandoned` ⇔ 序列 `completed → abandoned`（验收「放弃」；对齐本节验收动作三出口与项目迁移表 `awaiting-review → abandoned` 行——`awaiting-review` 期序列恒处 `completed`，放弃时项目与序列**同步**落 `abandoned`，无 `running` 棒需冻结）｜`re-entering:{roleId} → awaiting-review` ⇔ 序列 `→ completed`｜`re-entering:{roleId} → in-progress` ⇔ 序列 `running → frozen`｜`re-entering:{roleId} → abandoned` ⇔ 序列 `→ abandoned`（先冻结）｜**`accepted → rolled-back:{label}` ⇔ 序列保持 `completed` 不变**——回滚只改写项目状态、关联会话树指针与工作区，**不迁移、不复活序列状态**；`completed` 是序列终态，与项目侧 `rolled-back:{label}` 并存不冲突，棒历史随记录只读保留（回滚后 `nanju_role status` 仍可查 `sequenceState = completed`，§8 断言）；
- 文档骨架（7 目录 01_PRD ~ 07_VERSIONS）：工具 `nanju_scaffold` 经 `fs` 写入工作区；
- 快照（M7）：`nanju_snapshot {action:"save"}` 时记录 `{sessionId, workspaceDir, label}` 三元组，**并在 save 时**将 `workspaceDir` 内容冻结副本写入插件存储（快照本体 = 会话引用 + 工作区冻结副本，见 §5）；回滚（**rollback 时执行**）= 会话 fork（host 编排经 `sessionController` `@Remote('fork')`；client 入口 `ctx.uiWorkspace.forkSession`，见 §3 与附录 A）+ 从冻结副本恢复工作区（复用 Proma 的 fork-workspace-copy 思路，重写适配 DSH `fs`）；
- **回滚后状态回流（闭环语义）**：回滚完成后注册表原子更新——`状态 = rolled-back:{label}`、`关联会话树 = fork 出的新会话 id`（原会话保留只读，记录在快照历史）；工作区恢复（自冻结副本写回）失败则注册表不动并报错（不出现"注册表指向新会话但目录未回滚"的中间态）；`nanju_project {action:"status"}` 必须能读出上述三态；
- 预览监听（M3）：host 侧不另起 watcher，UI 侧走 `workspaceFiles.changes` 流（§4.4）。

**入口**：
- 命令 `/nanju`（`commands.register`）：向导模式选择 → 引导流程；
- 工具面（≤5 个）：`nanju_project`（list/create/switch/status）、`nanju_scaffold`、`nanju_snapshot`（save/list/rollback）、`nanju_role`（sequence/status/handoff/decide，`decide` 用于落账重派/跳过/终止裁决）；
- `systemPrompt.section` 在 Nanju 项目会话注入工作流提示（轻量，大头走 SKILL）。

### 4.4 包 D：`@local/dsh-nanju-ui`（客户端半）

| 功能（上游编号） | 席位/通路 | 说明 |
|---|---|---|
| 模式选择（M1） | 命令流 + `ask_user_question`（免 UI） | P0 不做独立页面 |
| 项目列表（M5） | `main` keyed 面板 | 卡片视图 + 状态筛选，数据走插件 Remote |
| HTML 预览（M2/M3） | `sidebar.right.tab`（keyed）+ iframe | 内容经 `workspaceFiles.read`；自动刷新走 `workspaceFiles.changes` 流（客户端 watch，无需 host watcher）；`tool.call.toolview` 为写 HTML 的工具调用卡加「在右侧打开」按钮 |
| 工具卡渲染 | `tool.call.toolview`（keyed by wire name） | nanju 工具结果紧凑渲染 |
| 设置 | `settings.section` | 全部 Config 键的设置面；键名/类型/缺省/校验以 **§4.7 Config 键总表为唯一真源**（`defaultMode`/`roleSequences`/`scaffoldTemplatePath`/`sweepIntervalSeconds`/`reviewReminderMinutes` 等），本行不重复定义 |

### 4.5 包 E：`@local/dsh-easy-skills`

- `tree-worker/SKILL.md` 重写版（54KB）：工具名替换为整合后 DSH 工具、流程语义保留；
- 新增 `nanju-wizard/SKILL.md`：双脑协作工作流（角色序列、交接协议、骨架规约）；
- 通用技能（adversarial-convergence-verification、agent-collaboration、automation 等）：原样直装 `skills.register`（此处 automation 等为 `default-skills` 内的**技能包**，与 §1 不移植清单中 Proma 应用内自动化编排功能同名不同物，互不影响对方决策）；
- office 类（docx/xlsx/pptx/pdf）：含独立 LICENSE（Anthropic 出品），保留其许可文件一并分发或按需剔除。

### 4.6 待定项（P2，S0 后裁决）

| 项 | 倾向 | 依赖 |
|---|---|---|
| remote-session HTTP 桥 12 工具 | 做（`webServer` 路由 + token 鉴权） | S0 验证 `connection.authenticatedUrl` 组合方式；裁决为"做"则单列后续阶段（见 §1 裁剪声明） |
| `agent-collaboration-tools`（41KB） | 先评估与原生 Teams 重叠度，>70% 重叠则只吸收 SKILL | S0 对照分析 |
| 树面板实时推送 | 先拉取+手动刷新（S2 基线，§4.2），事件推送 P2 | Host Event → Client Event 通路验证 |
| 树面板 host-remote 通路的等价只读面 | 先回退包 B 经 `ctx.get('remote')` 的等价只读面（若有）；不可用则 P2 待定 | S0 验证插件自定义 host 半 `@Remote` 命名空间是否出现在 client `ctx.remote` 下（§4.2 单点判据）；**本行即 §4.2 失败分支的登记目标**，S0 判据不通过时在此登记并记入 S2 偏差 |
| timer 注入不可用的 sweep 降级 | 回退纯惰性收割（①②③）+ `tree_status` 显式收割，硬截止降级为「外部触发时收割」（§4.1 回退语义） | S0 验证 `ctx.timer` 注入面；降级成立时按 §4.1 告警与 `sweepMode` 字段落实 |

### 4.7 Config 键总表（唯一真源；对账矩阵 ⑤）

本表为全部插件 Config 键的**唯一真源**（正文各处只引用不重复定义）；装载期统一经 **Config schema 校验**，校验按**两类分级处置（头部显式声明，行内逐键标注类别，无未声明的第三种处置）**：**类型/约束类**（类型不符、枚举越界、约束违约——本表除下述例外键外的全部键）失败 = **插件装载失败并显式报错（含键名），不静默回退缺省**；**可用性类**（外部资源可达性）失败 = **回退包内默认并显式告警、不阻断装载**——本表唯一可用性类例外键为 `scaffoldTemplatePath`（路径可读性属运行环境状态而非配置语义错误，用户可经告警自行修正；行内已标注「可用性类例外」）。校验实现列入 §7 S0 交付物，断言见 §8。

| 键 | 类型 | 缺省 | 校验/约束 | 出处 |
|---|---|---|---|---|
| `gradeTimeoutMinutes` | number | 30 | 正整数；节点（§4.1）与棒（§4.3）同源同值、同一基准时刻定义 | §4.1/§4.3 |
| `sweepIntervalSeconds` | number | 60 | 正整数；实际 sweep 周期 = `min(本值秒, gradeTimeoutMinutes×60/2)` | §4.1 |
| `reviewReminderMinutes` | number \| null | null（关闭） | 正整数或 null；非 null 时到期仅提醒一次、不代决策、不改状态 | §4.3 |
| `handoffSummaryMaxChars` | number | 2000 | 正整数；交接摘要超限二次压缩仍超限即失败，禁止静默截断 | §4.3/§8/R8 |
| `autoRetryEnabled` | boolean | true | false 时 `failed/timeout` 不自动重试、直接 `frozen` 等裁决（`cancelled` 恒不自动重试） | §4.3 |
| `defaultMode` | 'quick' \| 'iterative' | 'quick' | 枚举闭集 | §4.4 |
| `scaffoldTemplatePath` | string | 包内默认模板 | **可用性类例外**（处置分级见本表头部）：装载期检查可读；不可读回退包内默认并告警（不阻断装载）；类型非 string 仍属类型/约束类 = 装载失败 | §4.4 |
| `roleSequences` | object[] | `roles.json` | 每项 `{roles: roleId[] 非空且无重复, acceptanceRole?}`；`acceptanceRole` 给出时必须 ∈ `roles` 且 = 末位，违约即 `config-error:acceptance-role-not-terminal` / `config-error:acceptance-role-unknown`；装载期 Config schema 校验 + `nanju_start` 前复校 | §4.3/§5 |


## 5. 数据与状态

| 数据 | 位置 | 格式 |
|---|---|---|
| 树状态 | 插件存储（storageDomain；S0 定案） | JSON，per-tree 文件 + 索引 |
| Nanju 项目注册表 | 同上 | JSON |
| 文档骨架/产物 | 会话工作区目录 | 目录树（用户可见可编辑） |
| 角色/序列/模板 | 插件包内默认 + Config 覆盖 | JSON/YAML（序列 schema：`{roles[], acceptanceRole?}`；约束见 §4.3 与 §4.7 总表 `roleSequences` 行） |
| Nanju 棒/序列/项目状态 | 插件存储（随项目注册表落盘） | 三组枚举 + **迁移表（闭集）**：棒 `gradeState`（含 `cancelled`）、序列 `sequenceState`、项目状态（定义与出边见 §4.3 数据模型层；含 `timeout`、`completed → running` 重入、`re-entering:{roleId}` 三条出边、**双状态机同步规则**与 `rolled-back` 时序列保持 `completed`） |
| 面板状态视图 | 仅客户端内存（不持久化、不复制真源） | `{stateSource:'host-remote', refresh:'pull'\|'push', snapshot}`（枚举见 §4.2；S2 阶段 `refresh='pull'`） |
| 快照索引 | 插件存储 | JSON（快照本体 = **save 时冻结**的工作区副本 + 会话引用三元组；fork 与工作区恢复动作发生在 rollback 时，见 §4.3 M7） |

## 6. 安全与权限

- 所有文件写入经 DSH `fs` 服务的沙箱策略（workspace-write 语义继承），不绕过；
- 树/Nanju 工具默认继承会话审批策略；`tree_dispatch` 派发子会话时显式传递审批策略不升权；
- P2 HTTP 桥：默认只绑定本机回环、强制 token（`connection.authenticatedUrl`）、路由级白名单方法；
- 工具 `output.render` 不回显敏感环境变量（键名黑名单 + 值模式两道过滤，测试判据见 §8）。

## 7. 里程碑与工作量

（里程碑编号 S0–S5；Nanju 上游功能编号 M1–M8 见 §4.3 映射表）

| 阶段 | 内容 | 产出 | 工作量 |
|---|---|---|---|
| S0 规约冻结 | 29 工具清单提取、引擎行为规约、整合工具面定稿、storageDomain API 验证、`approval` 服务读取面验证（`overrideOf`，§8 审批断言载体）、`timer` 服务注入面验证（`ctx.timer.interval`，§4.1 定时 sweep 载体；不可用时按 §4.1 回退语义登记 §4.6）、**棒侧 sweep 跨包载体裁决**（§4.1 跨包收割接口形态）、**Config schema 装载期校验实现**（§4.7 总表）、序列 schema 校验实现（`acceptanceRole` 末位约束）、协作工具重叠度分析、remote-session/事件推送裁决 | docs/engine-spec.md、tools-mapping.md、裁决记录 | 0.5–1 d |
| S1 引擎宿主包 | 引擎重写 + ≤8 工具 + 并发队列 + 节点状态回流 + **定时 sweep（`ctx.timer.interval` 硬截止兜底，§4.1 收割触发④）** + 单测（移植 tree-harness tests） | @local/dsh-tree-engine | 3–5 d |
| S2 树面板 | client 包 + 面板（拉取+手动刷新基线）+ headless 渲染测试 | @local/dsh-tree-panel | 2–3 d |
| S3 Nanju 核心 | 预设/编排（含角色闭环、棒级超时/收割/`cancelled` 语义、跨包收割接口消费方）/项目/骨架/快照（含回滚回流）+ 工具 + 命令 | @local/dsh-nanju-core | 3–4 d |
| S4 Nanju UI | 项目面板 + HTML 预览 tab + 工具卡 | @local/dsh-nanju-ui | 3–4 d |
| S5 技能与验收 | skills 包 + E2E + 文档 + 实机验证 | @local/dsh-easy-skills + 验收报告 | 1–2 d |
| **合计** | | | **12.5–19 人天**（精确求和；MVP = S0+S1+S3 = **6.5–10 天**，同为精确求和，口径见下） |

排序理由：引擎价值独立（不依赖 Nanju）；Nanju 核心先行于 UI（命令流先可用）；UI 最后集中打磨。remote-session HTTP 桥为 P2，不在本表（见 §1 裁剪声明）。

**工作量口径（全文唯一，§8 静态核对项）**：表中任何汇总区间 = 其成员阶段区间的**精确求和**（下界加下界、上界加上界），**不做取整、不做抬升**；单位人天，最小粒度 0.5 天。据此：合计 `12.5–19` = `0.5+3+2+3+3+1` ～ `1+5+3+4+4+2`；MVP `6.5–10` = `0.5+3+3` ～ `1+5+4`。（v1.2 的「≈ 7–10」是把下界 6.5 抬升到 7 却未声明取整规则，v1.3 更正。）

## 8. 测试与验收

沿用 session-tree 已验证的三层证据链：
1. **静态**：`node --check`、manifest JSON/YAML 解析、`inject` 白名单断言、**文档口径核对**（§7 合计与 MVP 行必须等于成员区间精确求和，脚本按表中数字逐格复核，非 0 退出即失败）；
2. **装载**：`plugin_manager install_bundle` → `applied`；`cordis_inspect_query`（Slots.listSubTree / Tool.listTools）实测占用与注册；Config schema 经 `Config.listConfigs` 核对；
3. **行为**：
   - 引擎一致性：移植 tree-harness `tests/` + 新增并发用例（双会话同时派发）；
   - headless 渲染：stub `__ModuleLoader__` + React，真实/合成数据驱动，**逐条固化 §4.2 的 B1/B2/B3 断言**（B1 空 `expandedIds` 默认行数 = 顶层节点数；B2 存在层级时默认行数 ≠ 全节点数且孤儿/成环输入不抛异常；B3 每条子会话行 `mode ∈ {continuable, one-shot}`、`label` 满足 §4.2 的 `degenerate(label, sessionId, dirTitle) === false` 判据——**判据本体在 §4.2，本节只引用不重述**），并保留通用护栏（行数/缩进层级/key 唯一/状态四态/打开会话调用形状）；
   - **面板数据通路断言（§4.2 基线，`refresh='pull'`）**：断言面板首屏与「点击刷新/切换树」后渲染所依据的快照与宿主半只读查询返回值**字段级相等**；断言 S2 阶段**不订阅、不依赖任何推送事件**（无推送到达时渲染仍正确）。P2 启用推送后改为断言「推送帧到达后 ≤ Config 阈值内完成刷新」，两阶段断言由 `refresh` 字段切换、互斥生效；
   - **渲染脱敏断言**：对每个注册工具，用含敏感形状（`process.env` 快照、token/密钥键名黑名单、`*_KEY/_TOKEN/_SECRET` 值模式）的合成工具结果喂给 `output.render`，断言输出不含黑名单键名与命中的值（命中处显示 `[redacted]`）——纳入 S1 单测，S5 E2E 复测；
   - E2E 验收脚本（改造 m8-integration-test）：脚本化会话驱动 `tree_plan → dispatch → status` 与 `nanju_start → handoff(按角色序列逐棒) → 验收通过(落 `accepted` 与 `07_VERSIONS` 首条) → scaffold → snapshot(save) → rollback`，**断言客观终态**：
     - **序列无关验收断言**：对 `quick` 与 `iterative` **两条序列各跑一次**，断言两者均到达 `awaiting-review` 并最终 `accepted`（quick 的验收棒 = UX、iterative 的验收棒 = 工程经理），且 `nanju_role status` 报告的验收棒 == 该序列配置的 `acceptanceRole`/`roles` 末位；断言到达 `awaiting-review` 时 `sequenceState = completed`（两条入边同值，见 §4.3）；断言不存在「仅含工程经理的序列才能验收」的路径（自定义序列可另跑一条最小合成序列验证）；
     - **`acceptanceRole` 配置校验断言（数据模型层）**：装载三份 Config——① 中位 `acceptanceRole`（非 `roles` 末位）；② `acceptanceRole ∉ roles`；③ 缺省 `acceptanceRole`——断言 ①② 报 `config-error:acceptance-role-not-terminal` / `config-error:acceptance-role-unknown` 且**序列不启动**（无 `nanju_handoff`、无编码会话创建、`nanju_role status` 返回错误码），③ 的验收棒解析为 `roles` 末位；
      - **Config schema 装载期校验断言（§4.7 总表）**：对总表逐键构造非法值（`sweepIntervalSeconds = 0`、`gradeTimeoutMinutes` 非正数、`defaultMode` 非法枚举、`roleSequences` 空 `roles`/重复 id）→ 断言装载期校验失败且错误信息含键名（不静默回退缺省）；合法缺省装载 → 断言各键生效值 = 总表缺省值；
     - **状态迁移闭集断言（数据模型层）**：对 `failed`、`timeout`、`skip`、重入、终止六类路径各构造一例，断言实际迁移恰好落在 §4.3 迁移表闭集内（`cancel` 路径含棒 `cancelled`、序列 `frozen` 同步，详见「棒级 cancel 断言」）；并构造非法迁移尝试（`succeeded` 棒再 `handoff`、`completed` 序列再裁决 `retry` 使其回 `frozen`），断言被拒绝且状态不变（保持 `completed`）；
     - **棒超时断言（数据模型层，与 §4.1 对齐）**：令编码子会话静默超过 Config `gradeTimeoutMinutes`（测试注入 1 分钟）→ 断言该棒落定为 `gradeState = timeout`、触发一次重试（`attempt` 序号 +1）、重试仍超时后该棒与序列均 `frozen` 并向向导会话发出裁决请求；`decide(retry)` 后回 `running`；断言超时路径**不产生**非法迁移（不出现 `running → frozen` 直跳）；**超时硬截止断言（§4.1/§4.3 共用机制，无外部触发）**：另构造一例屏蔽全部外部触发（不调用任何树/Nanju 工具、禁用事件订阅、不查询 `tree_status`），注入假时钟推进至 `超时阈值 + sweep 周期` → 断言 `running` 节点与 `running` 棒均**按时**落定为 `timeout`（**落定判定窗口：不早于超时阈值、不晚于 `阈值 + sweep 周期`**——前者排除提前误收割，后者即硬截止；取消两可期的 `cancelled`/`timeout` 先到者生效见 §4.1 竞争语义）——验证 §4.1 收割触发④ 定时 sweep 的硬截止保证；**节点用例（S1 单测，包 A）与棒用例（S3 单测，包 C——棒状态机属包 C，与 §7 排期对齐）各跑一例**，均以注入的假时钟驱动（时钟/定时器注入缝见 §4.1：引擎核心不 import DSH API，sweep 时钟与周期回调为构造注入，生产适配 `ctx.timer.interval`，测试注入虚拟时钟手动 tick）；S5 E2E 复测；**误判保护断言（lastOutputAt 刷新，round 7 补）**：构造一例子会话持续产出（会话日志中产出事件时间戳不断顺延）但始终不结束、静默总时长超过 Config `gradeTimeoutMinutes` 的 `running` 节点/棒 → 断言 sweep 收割时因「收割时刷新」（§4.1 lastOutputAt 观测绑定 (b)）刷新了 `lastOutputAt` 而**不**将其置 `timeout`（节点/棒保持 `running`、基准时刻随刷新顺延）——事件订阅禁用态下本断言仍须通过（正确性不依赖事件面）；
      - **sweep 降级断言（degraded-lazy 分支，round 7 补，兑现 §4.1 `sweepMode` 字段承诺）**：注入 timer 不可用环境使插件进入降级模式 → 断言启动日志含 `sweep:degraded:no-timer` 且 `tree_status` 输出 `sweepMode = 'degraded-lazy'`；随后构造超期 `running` 节点，屏蔽全部树/Nanju 工具调用与 `tree_status` 查询、假时钟推进超过 `超时阈值 + sweep 周期`（不手动 tick 任何周期回调）→ 断言节点**仍为 `running`**（证明确无 timer 周期收割、处于 degraded 模式）；再触发一次任意树工具调用 → 断言该超期节点在此次外部触发时被收割落定为 `timeout`（降级语义 = 「下次外部触发时收割」），`tree_status` 复查 `sweepMode = 'degraded-lazy'` 不变；
     - **重入闭包断言（业务流程层）**：验收「需修改」后断言 `sequenceState: completed → running`、项目状态 `awaiting-review → re-entering:{roleId}`、重入棒为**新 `gradeId`** 且旧棒记录只读；重入推进走完后断言回到 `awaiting-review` 且 `sequenceState = completed`；再分别构造重入棒 `failed`（断言项目回 `in-progress` 且序列 `frozen`）与重入期间 `decide(terminate)`（断言两条路径分别落 `re-entering:{roleId} → in-progress` / `→ abandoned`，且 terminate 例若存在 `running` 棒则先观察到 `frozen` 中间态再 `abandoned`、终态无 `running` 棒残留——覆盖项目迁移表「先冻结再置 abandoned」声明），以此覆盖该状态**三条出边全部**；
      - **棒级 cancel 与 handoff×cancel 并发断言（数据模型层）**：① `running` 棒执行 `nanju_role {action:"cancel"}` → 断言棒置 `cancelled`（不属于落定）、序列同步 `frozen`、向导会话收到取消通知与裁决请求，`decide(retry)` 后棒回 `running`（新 `attempt`）且可推进；② 在途 `handoff` 与 `cancel` 并发两序各一例——`cancel` 先到：棒 `pending → cancelled`、同键后续 `handoff` 返回 `handoff:bar-cancelled` 且不创建子会话、不追加棒记录；`handoff` 先到：`cancel` 转为子会话 `interrupt`、收割后棒置 `cancelled`——两序均断言棒记录数 = 1、无重复子会话；③ 回滚后断言 `nanju_role status` 显示 `sequenceState = completed` 不变（双状态机同步规则，§4.3）；
     - **handoff 幂等与并发仲裁断言（业务流程层）**：对同一 `(sequenceEpoch, barIndex)` 连续调用 `nanju_role {action:"handoff"}` 3 次 → 断言棒记录数 = 1、编码子会话创建数 = 1、返回值 `gradeId` 逐次相同；并发两次 `handoff`（自动推进与手动同时触发）→ 断言串行化后仍为 1；对已 `succeeded` 的同一棒再 `handoff` → 断言拒绝且不追加记录；
     - **裁决出口断言**：构造「首棒 `failed`（重试耗尽后入 `frozen`）→ `decide(skip)`」与「验收棒 `failed`（同上经 `frozen`）→ `decide(skip)`」两例，断言被跳过棒在 `nanju_role status` 中为 `skipped` 且带 `reason`/`decidedBy`、序列**未被终止**并推进到下一棒；当被跳过者为**验收棒**时，`sequenceState = completed` 且项目**仍进入 `awaiting-review`**、最终可 `accepted`（`07_VERSIONS` 记录列出被跳过棒）；另断言 `terminate` 分支：项目置 `abandoned`、`sequenceState = abandoned`、其后无任何交接发生；再断言 `awaiting-review` 期验收「放弃」分支：项目 `awaiting-review → abandoned` 且 `sequenceState: completed → abandoned` **同步落账**（双状态机同步表对应行，§4.3），无 `running` 棒残留；
     - 树链路终态：树中无 `pending/running` 节点，全部节点 ∈ {succeeded, failed, timeout, cancelled}；每个 succeeded 节点的 `result` 非空且 `subagentSessionId` 可在会话日志中查到对应会话；产物文件实际存在于工作区；
     - Nanju 链路终态：注册表条目终态 `状态 = rolled-back:{label}`（流程含验收后回滚；验收记录保留于 `07_VERSIONS`，回滚不抹除验收历史）；7 目录骨架文件清单逐项存在；快照索引含本次快照且 `关联会话树` 指向 fork 后新会话 id；角色序列记录显示**验收棒已 `succeeded`（若该棒为 `skipped` 则显式记录跳过态）**且验收动作已落账（验收在 rollback 之前完成并留痕）；
     - **审批不升权断言（读取载体已明确）**：`tree_dispatch` 派发前后读取父/子会话审批策略——载体为 `approval.overrideOf(parentSession)` 与 `approval.overrideOf(childSession)`（返回值含 `undefined`，`undefined` 语义 = 无会话级覆盖、继承上层，须**成对比较**而非单边判空），并以 `sessionQuery.listEvents`/`readSession` 读取派发前后的 ask/outcome 对，断言子会话未出现父会话策略之外的 ask 类型；两级证据（策略对象 + 审计事件）均为必要，缺一即断言失败（对应 §6 安全不变式；服务出处见附录 A.1 `approval`，读取面可用性为 §7 S0 验证项；纳入 S1 单测，S5 E2E 复测）；
     - **R8 交接摘要「关键信息」清单与判定法（清单即判定输入，本清单为唯一真源，S3 单测 + S5 E2E 共用）**：每条交接摘要必须含 5 个固定小节且各节非空——**K1 决策/结论**（本棒产出与判定）、**K2 未决项与阻塞**（无则显式写「无」）、**K3 产物引用**（文件路径/工具名，无产物则显式写「无产物」）、**K4 契约/接口变更**（无则显式写「无」）、**K5 下一棒交接指针**（下一棒所需输入）。**判定**：E2E 脚本断言 5 个小节标题齐备且各节非空；**K3 可回溯判定算法（机判，唯一定义）**：K3 每条引用独占一行（`- ` 前缀），客体仅两类——文件路径或工具引用（`tool:<name>@<序号>`）。归一化 `p(x)`：路径 → 统一正斜杠、去 `./` 前缀、剥离会话工作区根前缀为相对路径、Windows 下大小写不敏感；工具引用保持字面。检索文本 T = 上一棒最终产出全文 ∪ 该棒全部工具调用记录（args 与结果的字符串化），整体经同一 `p()` 归一化。谓词 `traceable(ref)` = `p(ref)` 在 `p(T)` 中**归一化后精确包含**（无模糊阈值、无相似度）；任一条 `traceable === false` 即失败。**压缩器硬约束**：交接摘要的自动压缩对 K3 小节必须**逐行原样保留引用行**（禁止改写/截短路径），该约束写入压缩提示词并设 S3 负例（改写路径即失败）；摘要长度 ≤ Config `handoffSummaryMaxChars`（缺省 2000，§4.7），超限触发二次压缩，二次压缩后仍超限即失败（**禁止静默截断**）。**判定者 = E2E 脚本（机器判定，非人工评审）；丢什么算失败 = K1–K5 任一缺失、K3 存在不可回溯引用、或发生静默截断**；S3 单测跑正/负例（负例：缺 K3、含不可回溯引用、超限截断）；
     - 任一断言失败即 E2E 失败，退出码非 0；
4. **实机**：用户刷新页面确认视觉（无浏览器控制能力时如实声明，不伪造截图）。

## 9. 风险与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | 引擎行为保真（309KB 加固产物，规约提取遗漏） | 高 | S0 规约冻结 + 移植原 tests + 差分测试（判据见下） |
| R2 | Loader 宿主模块缓存导致迭代重启 | 中 | 每模块独立包（新包名即装即生效）；开发期把包目录加入 `hmr.root`（需用户确认配置变更） |
| R3 | `inject` 键错误整包不加载 | 中 | 硬 inject 仅用本机已验证 active 的键；其余 `ctx.get()` 可选 + 失败显式日志 |
| R4 | 29→8 工具整合后 SKILL 与工具面失配 | 中 | SKILL 与工具在同一 PR 内重写；E2E 按 SKILL 场景走查 |
| R5 | 多会话并发写树状态 | 中 | per-tree 串行队列 + 并发单测 |
| R6 | 席位冲突/遮蔽自带 UI | 低 | 不抢占 single 席位；用 panellist/main keyed；装载后 inspect 占用核验 |
| R7 | storageDomain API 形状与假设不符 | 低 | S0 首项验证；回退方案（插件数据目录直写）已备 |
| R8 | 交接摘要质量影响 Nanju 编排效果 | 中 | 摘要模板（含 K1–K5 固定小节，清单见 §8）+ 长度上限（Config `handoffSummaryMaxChars`，缺省 2000，§4.7；超限二次压缩，仍超限即失败，禁止静默截断）+ E2E 断言关键信息保留（K1–K5 齐备、K3 逐条可回溯——**机判算法见 §8**：归一化 + 检索文本 T + 精确包含谓词 + 压缩器逐行保留硬约束）；后续可接 compaction 服务 |

**R1 差分测试判据（S1 执行时冻结）**：
- **输入集**：tree-harness `tests/` 全量用例输入 + tree-worker SKILL 场景抽样的 ≥50 组调用序列（含 29 工具两两组合的代表性路径）；
- **必一致字段（逐字段命名，round 7 实测定分类）**：树状态 JSON 的结构投影——节点集的**语义 id**（`leaf_id`、`tree_id`：实测 tree-engine.cjs `cmdLeafAdd` L1175 必填字段含 `leaf_id`，由调用方给定、引擎**从不生成**，故差分必一致可达）、父子关系（`parent`）、状态、内容字段（`path`/`role`/`model`/`channel`）、`milestone.id`、`subagent_id`（形如 `sub:<leafId>:<序号>`，确定性拼接，L5407）、边、统计字段；
- **允许差异白名单（逐字段命名，仅下列三类，无「其他」兜底）**：① 时间戳类（`created_at`/`ts`/`registered_at` 等全部 ISO 时间戳字段）；② **运行期生成的会话标识 `session_id`**（UUID v4、由 fork 会话在运行期生成、逐次不同——引擎仅做严格 v4 格式校验、不生成，L1199-1201；**白名单不含 `leaf_id`/`tree_id`**）；③ 内部自增序号（`attempt`/`reentry`/事件追加序号）；
- **判定**：投影后逐字段深度相等为通过；任一非白名单字段差异即失败并记录最小复现输入；差分脚本退出码纳入 CI 语义（非 0 = 阻断合入）。

## 10. 对抗审查计划（AC v1.3，方案 v1 定稿后启动）

按 `adversarial-convergence-verification` SKILL v1.3 执行，适配说明：

- **角色与模型**（三家族异构，满足规则 2 硬要求）：
  - **模型家族枚举**：`deepseek-official`(D) / `zai-coding-cn`(Z) / `minimax-cn`(M)；
  - **同窗分配不变式（硬）**：H1 Defender 家族 ≠ 当轮 Attacker 家族；H2 Arbiter-A 家族 ≠ Arbiter-B 家族；H3 {Attacker, Defender, Arbiter-A} 三家族两两互异；软约束 S1：在满足 H1–H3 前提下尽量让 Prober 与 Attacker/Defender 异模型（非阻断）；
  - **Defender 按窗口避让轮换家族（常设规则）**：默认 Defender = `zai-coding-cn/glm-5.3`。**每个 2 轮窗口开始时，Executor 先解析当轮 Attacker 家族；若与默认 Defender 家族相同，Defender 临时切换为与当轮 Attacker 异族、且与当轮 Arbiter-A 异族的模型**（优先序 `deepseek-official/deepseek-flash` → `deepseek-official/deepseek-v4-pro`）；窗口结束后回到默认。同窗内 Arbiter 组合按 H2/H3 一并复核（三家族不足以同时满足 S1 时，允许 Arbiter-B 与 Attacker 同族，但须在该轮记录显式登记例外）；
  - **R1–R6 逐窗解析表**（周期 6 轮，R7+ 按同一规则回到 R1–2 分配；R3/R4 实际取值按此表生效）：

    | 窗口 | Attacker | Defender | Arbiter-A | Arbiter-B | Prober |
    |---|---|---|---|---|---|
    | R1–2 | D `deepseek-v4-pro` | Z `glm-5.3`（默认） | M `MiniMax-M3` | D `deepseek-flash` | D `deepseek-flash` |
    | R3–4 | Z `glm-5.3` | **D `deepseek-flash`（H1 避让切换；R3、R4 均已实际执行）** | M `MiniMax-M3` | D `deepseek-v4-pro`（与 Defender 异模型） | D `deepseek-flash` |
    | R5–6 | M `MiniMax-M3` | Z `glm-5.3`（默认，≠M） | **D `deepseek-flash`**（原 A 位 M 与当轮 Attacker 同族，按 H3 置换） | Z `glm-5.3-flash`（与 A 异族、与 Defender 异模型） | D `deepseek-flash` |
  - **窗口准入断言（规则 2 机检口径，G0 前置闸）**：每个窗口开始前由 Executor 对解析表求值并断言 `H1 ∧ H2 ∧ H3`，任一为假则**阻断该窗口、重新分配后方可启动**；断言结果与逐窗分配表写入每轮攻击 Prompt 首部与 `logs/attack-log.json` 的 `models` 字段（R3/R4 轮记录：`defender: deepseek-official/deepseek-flash`，`defender_switch_reason: H1 避让（当轮 Attacker 家族 Z == 默认 Defender 家族 Z）`）；
  - Executor：本会话（不担任任何 Agent 角色，产出仅做编排与统计）；
  - Attacker 轮换：R1–2 `deepseek-official/deepseek-v4-pro` → R3–4 `zai-coding-cn/glm-5.3` → R5–6 `minimax-cn/MiniMax-M3`（硬轮换，每 2 轮）；
  - Prober：`deepseek-official/deepseek-flash`（G3/回归扫描；不参与 H1–H3 家族判定）。
- **Defender 独立信息源（α>0）**：DSH Service 目录实测导出（`logs/dsh-host-services.txt`，含 `sessionQuery` 条目）、`dsh-session-tree` README（已验证插件范式）、本机安装实例 `@local/dsh-session-tree-tools/index.js`（host 工具注册实例：`ctx.inject(['tools','subagents','sessionQuery'])` 与 `sessionQuery.filterSessions` 实测用法，`:101,:144`）、tree-harness 仓 PRD/架构/tests——Attacker 不获得这些文件。
- **文档指纹**：每版 PLAN 计算 SHA-256 + `{version, filename, mtime}` 三元组，所有 Agent Prompt 内联，首轮回显 `doc_sha256_echo` 核验。
- **上下文重置**：各角色均为一次性 subagent 运行（天然满足规则 5），只传 Attack Log + 当前文档 + 独立信息源说明。
- **停止协议**：DUAL-GATE 四闸（G1 争议清空 / G2 发现收敛 / G3 Prober 确认 / G4 Arbiter 一致率 ≥70%）+ GATE 4b（累计发现 ≥5、轮次 ≥MIN_ROUNDS=2、MAX_ROUNDS=10）+ early_stop 判据（E1–E4）。
- **产物**：`logs/attack-log.json`（累积账本，含 refuted 条目）、每版 `docs/PLAN-vX.Y.md`、终版 `docs/review-report.md`（按 SKILL §3.7 模板）。
- **收敛后**：PLAN 定稿为 v1.0，缺陷修复记录进 CHANGELOG。

---

## 附录 A：已验证的 DSH 事实清单（本方案引用依据；**以下为节选、非闭集**——未列出的条目不等于未实测，正文引用而此处未列的以同源目录文件为准）

1. Host Service 目录（节选；源 `logs/dsh-host-services.txt`，2026-10-03 `cordis_inspect_query` host/Service.listService）：`tools.register`、`subagents.{startContinuable,prompt,sendMessage}`、`agentTeams.{spawnTeammate,sendMessage,createTask}`、`agentPresets.register/mount`、`commands.register`、`skills.register`、`systemPrompt.section`、`storage`/`storageDomain.open`、`webServer.register`、`fs.*`、`workspaceRegistry`、`sessionController` 含 `@Remote('fork')`（host 侧会话 fork）与 `@Remote('prompt')`，以及 **`sessionQuery`**（目录 key = `sessionQuery`，描述 "Unified live-preferred session query service"；实测方法含 `observeSession`/`filterSessions`/`readSession`/`listSessions`/`listEvents`/`readSurface`/`traceSession` —— §4.1 收割触发所引用的事件面即取自此）。`sessionQuery` 的注册侧实测用法：`@local/dsh-session-tree-tools/index.js:101,144`（`ctx.inject(['tools','subagents','sessionQuery'])` 后 `services.sessionQuery.filterSessions([{kind:'id',values:[target]}], signal)`）。另：`sessionController`/`credentialsController`/`directoryPickerController`/`jobController` 在目录中均被描述为 "Host service backing the generated `ctx.remote.<命名空间>` namespace"——§4.2 的 `ctx.remote.<tree 命名空间>` 取此同型机制。同源实测另含 **`approval`** 服务（目录 key = `approval`；描述 "Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session"；方法 `setPolicy(agent, policy: ApprovalPolicy): void` / `request(req): Promise<ApprovalOutcome>` / `overrideOf(session: Session): ApprovalPolicy | undefined`；出处 `logs/dsh-host-services.txt:171-183`）——§8 审批不升权断言的读取载体即 `overrideOf`（会话级策略，`undefined` = 无覆盖）加描述所述的 ask/outcome 审计面（经 `sessionQuery` 读取），其可用性列入 §7 S0 验证项。同源实测另含 **`timer`** 服务（目录 key = `timer`；描述 "Disposable timer helpers mixed into Cordis contexts"；方法 `timeout(callback, delay): () => void` / `timeout(delay): Promise<void>` / `interval(callback, delay): () => void` / `interval(delay): AsyncIterableIterator<void>` / `throttle` / `debounce`；出处 `logs/dsh-host-services.txt:1737-1758`）——§4.1 收割触发④ 的引擎内部定时 sweep 即以 `ctx.timer.interval` 为载体（Cordis ctx 混入，宿主半插件可直接使用；其精确注入形态列入 S0 验证项）。
2. Client Slot 树（节选）：`sidebar.panellist`、`main`（keyed，已占用键 `conversation`）、`sidebar.right.tab.*`（keyed）、`tool.call.toolview`（keyed）、`conversation.view`、`settings.section`（client/Slots.listSubTree）。
3. 可用子会话模型路由：`deepseek-official/{deepseek-v4-pro,deepseek-flash}`、`zai-coding-cn/{glm-5.3,glm-5.3-flash}`、`minimax-cn/{MiniMax-M3,M2.7-highspeed}`（list_subagent_models）。
4. 插件工程范式：`@local/dsh-session-tree`（client 席位/优先级/inject/locale/headless 测试）与 `@local/dsh-session-tree-tools`（host 工具注册、`ctx.inject` 用法、`subagents.prompt` 授权语义）——本机安装实例，README 含实测证据。
5. 源侧体量：§2 表（GitHub API 实测文件大小 + 本地 tree-harness 仓；引擎 316,687 B 为 2026-10-03 本地实测）。
6. 客户端会话操作服务：`ctx.uiWorkspace.forkSession(id)`（client 侧 fork，dsh-session-tree README 实测引用：自带实现 `client.js:4234-4242`）、`openSession`/`archiveSession` 同族——host 侧等价物为附录 A.1 的 `sessionController` fork/prompt。

## 附录 B：术语

- **continuable 子会话**：DSH 中可多轮续话的子智能体会话（区别于 one-shot）。
- **席位（Slot seat）**：DSH client 插件的 UI 挂载点；single/keyed/list/chain 四类，优先级决定占用。
- **硬轮换**：AC 规则 8 的跨模型家族 Attacker 轮换。
- **避让轮换（Defender）**：§10 常设规则——当轮攻击者家族与默认 Defender 家族相同时，Defender 临时切换为与当轮攻击者异族（且与当轮 Arbiter-A 异族）的模型；Arbiter 组合同步按 H2/H3 复核。
- **验收棒（acceptanceRole）**：角色序列配置中标志序列**末端**的棒（schema 约束：必须 ∈ `roles` 且必须 = `roles` 末位，中位或未知取值即 `config-error`，见 §4.3），缺省 = `roles` 末位；序列无关，不绑定任何具体角色 id。其**落定（`gradeState = succeeded`）**与「被 `skip` 且序列推进走完」是 `in-progress → awaiting-review` 的**两条且仅两条**入边，两条入边均置 `sequenceState = completed`（§4.3）。
- **落定（settled）**：一棒 `gradeState` 由 `running` 进入 `{succeeded, failed, timeout}` 之一（产出到达 / 报错 / 超时）。**`skipped`（裁决出口）与 `frozen`（等待裁决）均不属于落定**——故「验收棒落定」不涵盖「验收棒被跳过」，二者是并列的两条入边（§4.3 数据模型层唯一定义）。
- **基准时刻（超时判定）**：`max(dispatchedAt, lastOutputAt)`；无产出记录时 = `dispatchedAt`（§4.1 唯一定义，节点与棒同源；R5 advisory a 统一双语义）。**lastOutputAt 观测绑定** = 其两个且仅两个来源：`sessionQuery.observeSession` 事件订阅回写 + 收割路径超时判定前经 `readSession`/`listEvents` 刷新（§4.1，round 7 补全）。
- **校验分级（Config 装载期）**：类型/约束类失败 = 插件装载失败并显式报错；可用性类（外部资源可达性，唯一例外键 `scaffoldTemplatePath`）失败 = 回退包内默认并告警、不阻断装载（§4.7 头部，round 7 补全）。
- **cancelled（棒级）**：显式取消（`nanju_role {action:"cancel"}` 或会话级中断）产生的棒终态，不属于落定、不消耗重试次数、不自动重试——置 `cancelled` 的同时序列同步 `frozen` 进入裁决等待，`decide(retry)` / `decide(skip)` 为其仅有的两条推进出边（§4.3）。
- **skipped（跳过）**：裁决出口之一，标记某棒被跳过而不终止序列；验收棒被跳过时序列置 `completed`，但仍进入 `awaiting-review` 且可 `accepted`。
- **编号约定**：里程碑 = S0–S5（§7）；M1–M8 = Nanju 上游功能编号（§4.3 映射表）。二者不得混用。
- **优先级 P0/P1/P2**：见 §1 定义（P0 = MVP 口径成员 ∪ 显式标 P0 的其他阶段交付物，**故 P0 ⊋ MVP**；S2/S4/S5 中未标注 P0/P2 的交付物默认 P1；P2 为显式可选延后）。
