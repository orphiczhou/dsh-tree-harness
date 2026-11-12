# 开发会话索引（拆分向导准备）— 2026-11-12

> 只读审计：枚举本机 DSH 会话存储（`%USERPROFILE%\.dsh\sessions` + `storages\session_projcache`），按项目/插件分组登记**索引**（session id、日期、≤30 字摘要、为什么关键、对应文档）。
> 本文**不复制对话正文**，不写入 `.dsh`，公开仓只放索引。统计口径与复核脚本见附录 A。

---

## 0. 结论（先看这 8 行）

1. 本机 DSH 会话存储共 **3,429 个会话、约 613.8 MB**；时间跨度 **2026-10-01 16:56 → 2026-11-12 17:10**。每个会话=一个 `session.v4.jsonl.zstd`（多帧 zstd JSONL，追加式）、一份 `session_projcache` 元数据（标题/首条用户消息/turn 数，**推荐用作只读索引源**）。
2. **「开发会话」与「会话产物」必须分开数**：`dsh-tree-harness`、`nanju-dsh`、`flow` 三仓大量会话是**树/流程插件的 subagent 执行会话**（分别 182/101/96 个）；`RSI-dsh-harness-rsi` 的 492 个会话几乎全是 **RSI 自改进运行产物**（374 个零轮 + 118 个单轮测试任务），不是开发对话。
3. 真人与 Lead 的**关键开发会话集中在每仓 5–9 个顶层会话**，且几乎都能由该仓 `HANDOFF*.md` 反查（下文「会话 → 文档」表）。
4. **meta-adapter（元系统适配器）的开发会话不在 `D:\Codes\dsh-meta-adapter`，而在 `D:\桌面\元方法论`**（1,173 个会话、21 个顶层，10-19～11-12）；`D:\Codes\dsh-meta-adapter` 只是插件快照仓，无独立开发会话。该组属**私有仓 + 方法论私有内容，公开仓只登记 id/数量，勿摘录**。
5. RSI 的开发会话在 `D:\Codes\RSI`（35 个，5 个顶层关键）；`D:\Codes\RSI\dsh-harness-rsi` 目录只是运行沙盒。RSI 起点可追溯到 default-workspace 的 `session-7568248f`（RSI 文章调研，被 `dsh-harness-rsi/HANDOFF.md` 引用）。
6. 旧 `D:\Codes\tree-harness`（Proma 版树引擎）**在 DSH 会话库中 0 条**——其交接文档（2026-06/07）早于 DSH 会话库起点，标 UNKNOWN（不是丢档，是不在同一系统）。
7. default-workspace 的 1,269 个会话里**主体是探针/模型评测**（eval 提示、单轮问答），真正的插件开发对话约 20 个（turn≥3），已挑出关键 10 个。
8. 敏感性：至少 3 组会话涉及代理/服务器配置/凭据类内容（见 §5），仅登记 id 不摘录；`%USERPROFILE%\.dsh\.credentials.yaml` 存在，审计时勿把它或含密钥片段复制进任何仓库。

---

## 1. 存储布局与只读打开方式

| 项 | 路径 / 说明 |
|---|---|
| 会话日志 | `C:\Users\sir_c\.dsh\sessions\<cwd-mangled>\<session-uuid>\session.v4.jsonl.zstd`（目录可能带 `session-` 前缀，如归档会话 `session-9593cdc9-…`） |
| 会话元数据（推荐索引源） | `C:\Users\sir_c\.dsh\storages\session_projcache\sessions\<session-id>.json`：`identity.cwd/createdAt`、`rows.title`、`rows.titleInput.first.text`（首条用户消息）、`rows.sessionStats.turns`、`rows.subagent.identity.label` |
| 工作区映射 | `C:\Users\sir_c\.dsh\storages\workspace.json`（path ↔ title ↔ 顶层 sessionIds；**不含全部会话**，subagent 会话只落 sessions 目录） |
| 解码 | Node 24：`zlib.zstdDecompressSync`；日志为**多帧拼接**，需按 zstd magic（`28 b5 2f fd`）分段循环解压（单次 `zstdDecompressSync` 只解第一帧）。只读，勿写回 |
| 打开 | ① DSH 桌面 GUI：按 `workspace.json` 的工作区（标题）进侧栏会话列表；② 直接按上表路径取文件、用 §附录 A 脚本解压读 header；③ 只想要标题/首句时优先读 projcache（免解压、无正文） |

Mangled 目录名规则：盘符/路径中的 `\`、`:` 等替换为 `-`，非 ASCII 转 `~XXXX~`（UTF-16 码元十六进制），如 `D:\Codes\DSH动态流程引擎插件` → `--D-Codes-DSH~52A8~6001~6D41~7A0B~5F15~64CE~63D2~4EF6--`。

---

## 2. 全局统计（按项目/插件）

| # | 项目 | workspace 目录（cwd） | 会话数 | 顶层 | subagent | 有轮次 | 时间范围（+08） |
|---|---|---|---|---|---|---|---|
| 1 | default-workspace | `C:\Users\sir_c\Documents\deepseek-harness\default-workspace` | 1,269 | 1,225 | 44 | 1,265 | 2026-10-01 16:46 → 11-11 10:48 |
| 2 | meta-adapter（元方法论） | `D:\桌面\元方法论` | 1,173 | 21 | 1,152 | 1,171 | 2026-10-19 14:04 → 11-12 13:10 |
| 3 | RSI-dsh-harness-rsi（运行沙盒） | `D:\Codes\RSI\dsh-harness-rsi`（另有小写 `D:\codes\…` 117 个） | 492 | 492 | 0 | 118（均≤1 turn） | 2026-10-20 13:07 → 10-23 14:36 |
| 4 | dsh-tree-harness | `D:\Codes\dsh-tree-harness` | 190 | **8** | 182 | 189 | 2026-10-04 11:49 → 11-12 17:03 |
| 5 | nanju-dsh | `D:\Codes\nanju-dsh` | 109 | **8** | 101 | 106 | 2026-10-16 17:22 → 11-06 18:10 |
| 6 | flow（动态流程引擎插件） | `D:\Codes\DSH动态流程引擎插件` | 105 | **9** | 96 | 104 | 2026-11-09 01:49 → 11-11 21:36 |
| 7 | RSI（开发根） | `D:\Codes\RSI` | 35 | **5** | 30 | 35 | 2026-10-20 12:52 → 10-23 14:48 |
| 8 | dsh_orb（杂项/外部 TUI 实验） | `C:\Users\sir_c\.dsh\dsh_orb\…` | 12 | 12 | 0 | 10 | 2026-10-30 19:21 → 11-11 22:25 |
| 9 | desktop profile | `C:\Users\sir_c\.dsh\profiles\desktop` | 7 | 6 | 1 | 7 | 2026-10-20 20:52 → 10-21 09:38 |
| 10 | 无 cwd / recon | `(none)` | 10 | 10 | 0 | 0 | 2026-10-20 13:11 → 13:33 |
| — | **旧 tree-harness** | `D:\Codes\tree-harness` | **0** | 0 | 0 | 0 | **UNKNOWN（无 DSH 会话）** |
| — | **meta-adapter 插件快照仓** | `D:\Codes\dsh-meta-adapter` | **0** | 0 | 0 | 0 | **UNKNOWN（无 DSH 会话；开发在 #2）** |
| — | 其他杂项 | giteeLogAys 7、南钢 4、咖啡机 MES 14、xiaomi 1、`C:\Users\sir_c` 1 | 27 | 8 | 19 | 24 | 2026-10-02 → 11-11 |

> 口径：会话数=projcache 记录数（与 sessions 目录 3,429 个日志一一对应）；「顶层」=无 `subagent` 身份（`rows.subagent.identity.label` 为空），是真人可直接续聊的会话；「有轮次」=`sessionStats.turns>0`。

---

## 3. 各项目关键开发会话（每项精选）

### 3.1 dsh-tree-harness（190：8 顶层 + 182 树执行会话；2026-10-04 → 11-12）

| session id（目录可能带 `session-` 前缀） | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `9593cdc9-60bf-494d-8164-f40bc2d1e2f1` | 10-04 11:49 | 读取并确认工作区计划 | 仓库开工首会话（22 turns） |
| `67b40ee5-b758-4993-bfc5-f72c860fca03` | 10-04 12:21 | 依赖 enforcement 与 taskType 验证开发 | 引擎依赖编排/验证路由成型（24 turns） |
| `05d1f920-9aaa-4ea1-91ae-cf2844d426ac` | 10-08 21:45 | 恢复 dsh-tree-harness 会话状态 | 10-14 handoff 恢复会话；`HANDOFF-05d1f920…` 关联 |
| `ae2d557b-209c-480d-ae29-bbe857abfc60` | 11-11 13:34 | 会话交接定位与修复 | session_handoff 主线修复起点（17 turns） |
| `b9d5bacc-9922-4c19-bb43-facfa1c835b3` | 11-11 13:48 | E2E 验证 session_handoff 兄弟接替 | 姊妹接替 E2E；`HANDOFF-b9d5bacc…` |
| `8fb77300-3559-453a-9596-b02f4d693b28` | 11-11 15:35 | c3demo 中间层指挥官 | 三层树 demo 收口（子会话） |
| `ae8a7881-1155-479d-8cb6-08724125af26` | 11-12 00:29 | 接替会话读交接继续 | Wave-2 收口会话；`docs/operations/handoff-2026-11-12.md` 快照 |
| `bff3c54c-a11e-4efe-bf4f-d254af6075cc` | 11-12 13:14 | 读交接文件继续推进 | Wave-2 后续接替（7 turns，最新之一） |

补充：`887b8cd1-0f0d-4e1f-9462-8cda27db9581`、`55543cfc-a255-443c-8184-743658384c53`（11-11 各 1 turn，handoff 续聊）；`c9de8873-9334-4cb4-b9f9-fb8c593b9f0a`（11-11 qa-verifier，公开前密钥/隐私独立验证——**敏感审计会话**）。

### 3.2 flow 动态流程引擎插件（105：9 顶层 + 96 子会话；2026-11-09 → 11-11）

| session id | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `006b07da-54a3-47b0-91f0-7e203266fa32` | 11-09 01:49 | DSH 插件流程编排可行性论证 | 项目起点：想法→可行性（首个会话） |
| `127514b6-9138-40a2-8d87-0e07ad884c4c` | 11-09 11:49 | 恢复流程引擎会话状态 | 读 `HANDOFF.md` 恢复；MVP→需求/PRD 阶段 |
| `d4d2fa96-b03b-4014-9728-f7594df12ae1` | 11-09 18:56 | 恢复状态并制定项目规则 | M1-2 交接；建立团队/规则 |
| `9e16623b-8f6c-4ace-bc12-d240ff894ec6` | 11-09 15:43 | 恢复状态并继续推进 | 架构设计 v2.0 前后接替 |
| `089efdfa-936f-40b0-9aea-8e96b022f853` | 11-11 12:09 | 读取交接文件继续推进 | M1 实施主会话（17 turns）；`HANDOFF-089efdfa` 两份 |
| `ba19d8b0-cc21-4223-9b4e-3dc9c0a7d40b` | 11-11 13:20 | R-m1-05 真机审批验收执行 | 真机审批门禁验收 |
| `76961080-428a-48a3-8bc0-00316f8ee108` | 11-11 15:50 | Continue DSH workflow engine plugin | 089efdfa 的接替会话 |
| `5e66b298-9286-47a5-a099-d7d063323b16` | 11-11 17:46 | 继续 DSH 动态流程引擎交接 | 深夜批收口（E2E+项目地图报告） |

补充子会话（按 lane 取代表）：`545e1c0e`（architect v2.0，ADR/需求评审）、`a955db3d`（纯引擎 MVP）、`d0a0edc1`（集成 MVP+bundle）、`0615006c`（独立 QA 复核）、`276ce426`（T12 只读面板）、`ae43fe1c`（T13 QA Phase1）。

### 3.3 nanju-dsh（109：8 顶层 + 101 子会话；2026-10-16 → 11-06）

| session id | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `11f22b1b-de6c-4c28-8b9e-b2be1b7a53a4` | 10-16 17:22 | N0 契约对齐与树编译规则评审 | 仓库开工（17 turns）；`HANDOFF.md` 总纲 |
| `385b4c37-2a31-48ce-bb9b-8eb9ad166454` | 10-17 21:38 | 验收 /nanju 与推进交接 | live 验收；`docs/handoff-2026-10-17c.md` |
| `394e0aba-a57c-4425-8ff0-701162971893` | 10-17 22:41 | Nanju UI 入口与向导实现 | UI 入口+向导；`-17d/-18b`、`live-e2e-report.md` |
| `d454c374-d310-46a9-a445-d8fd66f3d9e7` | 10-18 20:05 | Nanju-dsh 视觉验收与架构推进 | 视觉验收；`docs/handoff-2026-10-18c.md` |
| `d680b416-377e-4bab-915f-1b38a44b24d0` | 10-19 08:58 | 设计向导 Agent 最小可用调整 | 向导 Agent 主线 |
| `473c0b27-ab21-4834-9b89-ce22c44406d8` | 11-06 13:33 | 引导协议纯域+宿主 guide 服务 | guide-protocol 实现；647/647 收口批次 |
| `41d06c45-c925-4ede-870c-f84541d851c6` | 11-06 13:33 | 面板向导对话视图+接线 | 真实模型向导对话视图实现 |

### 3.4 meta-adapter / 元方法论（1,173：21 顶层 + 1,152 子会话；2026-10-19 → 11-12）
> ⚠️ 私有项目（双私仓 `meta-adapter-src` / `meta-adapter` + 方法论私有材料）。**公开仓只登记 id 与中性描述，不摘录标题原文以外的内容。**

| session id | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `1f008838-4602-442a-aa1f-3fc08ed99374` | 10-19 14:04 | 校准口语并规划适配器方案 | 适配器开工前规划 |
| `c09d4cd9-58e3-474f-a0f6-185f08292860` | 10-20 11:45 | DSH 元系统适配器插件开发指挥 | 总指挥会话（109 turns，全库最长之一） |
| `a6035e49-9712-408f-b229-651a8685a193` / `fd1ffe2f-ea4a-474c-bfe7-6444dfd00410` | 10-20 12:03 / 12:19 | 适配器开发指挥续 | 总指挥并线/接替（2/6 turns） |
| `70ac6ec6`（+`7cfc4e6e`/`f5e1ccdc`/`7eefa2e7`/`710ff42a`/`d07178aa`/`fa198b49`） | 10-20 11:57 | 七领域子指挥官（F1–F3/F4–F7/F8–F10/面板/测试/PRD） | 插件七域并行开发骨架（各 11–26 turns） |
| `51ef2e4a-d871-408b-bcd7-cca70134503f` | 10-20 12:25 | 元系统认知能力平衡猜想论证 | 方法论认知边界的论证 |
| `441d9a33-5693-4ec1-b542-c925884f6fa6` | 10-22 11:48 | 适配器面板白条问题交接 | 面板缺陷修复交接 |
| `16648e55-66f1-478d-9aa7-b807f477cff3` | 10-22 17:18 | 接任 Lead（指挥官/架构） | 二任 Lead 接棒（32 turns） |
| `ef20a217-319b-47a7-858c-9e55594d5a21` | 10-22 18:11 | 评估 DSH 插件完整度与改进计划 | 完整度评估→改进计划 |
| `8cabbb1d-f696-46ee-8c62-66ed834af5f6` | 10-23 17:11 | 读取交接文件与方案确认结果 | 方案确认轮 |
| `6235e031-cc96-41be-8145-c2d9f53e7643` / `0a0e2b6d-11f2-48ea-91cc-8fe78f541bd6` / `f1318ae5` / `7a90c28f` / `a1871fd2` / `600bda59` | 10-23 → 11-08 | 读交接提示词继续（多轮接替链） | 53/53/31/42/21/41 turns，适配器长跑主线 |
| `6564c2e6-540b-48a4-a103-815f8a26e85b` / `54ba0b84-cb27-458c-ab23-b60b5b3f096d` | 11-09 / 11-10 | 继续交接文档 / 数学成立分析 | 收尾设计轮 |

补充：`946bb4d4`（E2E v12 指挥官，95 turns）、`a53abeb4`（E2E v13 校准波，58 turns）、`a5e083e7`（E2E2 对照，28）、`1ba1c996`（E2E3 加测，29）——评测验证主线；`工程日志/round11/e2e_*` 中有派单日志可反查。

### 3.5 default-workspace（1,269：1,225 顶层；主体是探针/评测，dev 类约 20）

| session id | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `10004d81-26b0-4762-b168-232e22a6ac43` | 10-01 16:46 | 自我进化插件与多会话能力探讨 | 最早的插件/多会话构想（15 turns） |
| `1d637ac2-01f0-453e-a3d4-6384fe4e8964` | 10-01 20:39 | 树形会话菜单修改 | session-tree UI 起源（12 turns） |
| `5d481e2d-1573-4ec3-957d-4e0f3e445fd8` / `0d580e4e-a0af-4837-ba6b-458af5b0c847` | 10-01 22:57 | 自我进化/树形菜单（fork） | 多会话能力实验线（15/8 turns） |
| `103af57f-79cf-4e4e-a265-358cbbc9fede` | 10-02 18:06 | 读取交接实现通道 C | 插件通道 C 实现 |
| `732500a0-adc2-4248-93df-d0908099ab3b` | 10-03 02:02 | Proma-Easy 移植 DSH 可行性评估 | 后续树/南钢移植的源头评估 |
| `e7b87f3e-8f6c-409f-aa7d-e71d4cf22560` | 10-03 21:11 | 解析 dsh-thoughtdag 插件 | 早期插件解剖（方法论引入） |
| `7568248f-5a0a-4bfe-8231-9bd4ca18f97e` | 10-19 14:03 | 分析 RSI 文章及插件集成评估 | RSI 项目起点，被 RSI HANDOFF 引用 |
| `f4dbb2dd-3e40-4c41-8ece-983313caca26` | 10-12 19:51 | Gemini 网页版套餐转 MCP 调研 | gemini-web MCP 链起点 |
| `887c9df0-f510-4ce5-a6f8-6bdaf12c9e90` | 10-11 12:18 | Archify 项目可用性评估 | 技能/工具选型参考 |
| `d8b00b26-7b22-407e-9f79-133db0c5e1fa` | 10-20 12:52 | 配置 Clash 代理连接 | **敏感**（服务器/代理配置） |

> 其余约 1,200 条为 2026-10-01 起的大批模型探针/能力评测单轮会话（示例标题「只输出一个整数」「Reply with exactly…」），属评测素材，不建议作为拆分向导证据引用。

### 3.6 RSI（`D:\Codes\RSI` 35：5 顶层 + 30 子；2026-10-20 → 10-23）

| session id | 日期 | 摘要（≤30 字） | 为什么关键 |
|---|---|---|---|
| `dbea485e-f245-42f1-ae0d-fcad68fe7c2e` | 10-20 12:52 | 推进 dsh-harness-rsi POC 验证 | R1 启动会话；`docs/00-runlog.md` 记载 |
| `2004ca1a-3e7e-4906-8bb4-bf6675f40f4c` | 10-20 20:41 | 本会话 G0 安装与验证执行者 | 插件安装/基线验证 |
| `e8e0aa20-3f50-45c8-b728-046815a18ed4` | 10-22 17:18 | RSI harness 现状评估与决策 | 元系统 Run 决策（9 turns） |
| `5a1ec01c-b5f2-40e0-8f20-be8904733740` | 10-22 18:45 | RSI harness 现状评估与决策 (1) | 同题接替/并线 |
| `07e710b1-46ce-4ffa-94dd-5f7c6949d375` | 10-23 14:28 | 读取归档恢复会话讨论推进 | 收尾接替（`loop/HANDOFF-PROMPT.md`） |

`D:\Codes\RSI\dsh-harness-rsi`（492）说明：374 个零轮空会话 + 118 个单轮测试任务（如「对账汇总 CSV 金额」「统计 budget-exceeded 的 run 数量」），是 RSI 插件自己跑 benchmark/自改进产生的**运行产物会话**，非开发对话；其中 `turns=1` 者通常由 `rsi_improve`/A-B 测试派发。若要追 RSI 后续开发，需另查 default-workspace（`7568248f`）与 dsh_orb 杂项。

### 3.7 旧 tree-harness（`D:\Codes\tree-harness`）— UNKNOWN
- DSH 会话库中 **0 条**（cwd 无 `tree-harness` 分组）。
- 该仓 `.context/` 有 2026-06～07 的 handoff（如 `.context/active/session-2026-06-25-ef3bb7f0-recap.md`、`audtest-test-materials-2026-07-09/`），提到 `ef3bb7f0`、`e954cf56`、`67b8a9a2`、`b1f6efb8` 等 session 片段，但**均不在本机 DSH 会话库**（早于 DSH 会话起点 2026-10-01）。结论：旧仓开发会话由更早的 harness 承载，标记 UNKNOWN，需旧工具链才能追溯。

---

## 4. 会话 → 文档对照（关键入口）

| 项目 | 文档入口 | 关联 session（可反查） |
|---|---|---|
| dsh-tree-harness | `docs/operations/handoff-2026-11-12.md`（Wave-2 快照，239 行） | `ae8a7881`、`bff3c54c` |
| dsh-tree-harness | `HANDOFF-<id>-<ts>.md`（根目录 11 份，文件名即 session id） | `05d1f920`、`5500503a`、`897e7f93`、`8fb77300`、`9cb372fb`、`9f4ec95e`、`ad490613`、`ae2d557b`、`ae8a7881`、`b9d5bacc`、`d93a8927` |
| dsh-tree-harness | `docs/reports/e2e-handoff-2026-11-11.md` | `05d1f920`、`55543cfc`、`887b8cd1`、`b9d5bacc`、`897e7f93`、`ad490613` |
| dsh-tree-harness | `docs/reports/skill-e2e-2026-11-11.md`、`demo/c3layer/*` | `8ca5308b`、`00a0b6f1`、`8fb77300`、`63530e9d`、`7dd52e8b`、`dacf6e74`、`1fcc8dae` |
| dsh-tree-harness | `docs/reports/wave2-closeout-2026-11-12.md`、`audit-tree-system-2026-11-11.md` | `ae8a7881`/`bff3c54c`；`00a0b6f1` |
| flow | `HANDOFF.md`（11-09 快照）、`HANDOFF-M1.md`（M1 进度，283 行）、`docs/README.md`（文档唯一入口） | `127514b6`、`d4d2fa96`、`089efdfa`、`76961080`、`5e66b298` |
| flow | `HANDOFF-089efdfa-*.md`（2 份）、`NEXT-SESSION-PROMPT-M1-3.md` | `089efdfa` → 接替 `76961080` |
| flow | `reports/project-map-2026-11-11.*`、`reports/PROJECT-MAP-METHOD.md`、`docs/07-独立复核报告.md` | `2537580b`、`2a22c91f`、`d0a0edc1`、`0615006c` |
| nanju-dsh | `HANDOFF.md`（跨项目总纲）、`docs/handoff-2026-10-17c.md`、`-17d`、`-18b`、`-18c`、`-11-06.md` | `11f22b1b`；`385b4c37`；`394e0aba`（×4）；`d454c374`；`d680b416` |
| RSI | `dsh-harness-rsi/docs/00-runlog.md`（R1 起 1025 行事实流水）、`HANDOFF.md`、`loop/HANDOFF-PROMPT.md` | `dbea485e`、`7568248f`（default-workspace）、`07e710b1` |
| meta-adapter | `元方法论/REPO-LINKS.md`（双私仓导航）、`AGENTS.md`、`工程日志/round11/e2e_*/meta/派单日志*`、`评测/reports/2026-10-20_S0-design-audit/*`、`讲解资料/03_链条会话在哪_…` | `c09d4cd9` 及七领域子指挥官；E2E 指挥官 `a5e083e7`/`946bb4d4`/`a53abeb4`；S0 审计子会话 `8eb3655e` 等；`6c9995c3`、`0e8ac82c`、`73e44fb5` |
| 旧 tree-harness | `.context/active/handoff-*.md`、`.context/v10/*`、`audtest-test-materials-2026-07-09/` | 无 DSH session（UNKNOWN） |

> 自动反查结果：在 7 个仓的 4,368 个 md 中扫到 **96 个能被会话库命中的 session id**（其余是旧 harness id、预置样例 id 或截断引用）。已落盘映射（scratch，不入库）。

---

## 5. 敏感 / 隐私标注（只标不摘录）

| 级别 | 对象 | 处置 |
|---|---|---|
| 高 | default-workspace `d8b00b26-…`（Clash 代理配置，含公网服务器信息）、`8af34cbe-a24e-4c8b-a8d9-ba28d659a8c1`（海外代理搭建，33 turns） | 只登记 id/日期；**勿复制正文到公开仓** |
| 高 | dsh_orb 目录名含「用本机已有的 opencode-go 凭证…」等任务会话（约 10 个） | 同上；涉及第三方凭证使用 |
| 高 | dsh-tree-harness `c9de8873-…`（公开前密钥/隐私/测试独立验证 qa-verifier） | 只登记为「敏感审计会话」 |
| 中 | meta-adapter/元方法论全部会话（私有双仓 + 方法论私有材料 + 业务材料） | 公开仓仅 id + 中性标签；引用文档需脱敏 |
| 中 | default-workspace 大量评测会话（模型输出可能含用户粘贴材料） | 作为评测素材，不作公开引用 |
| 低 | flow/nanju/tree/RSI 其余会话 | 公开仓可登记 id/摘要；引用前仍按各仓发布策略复核 |

另：`%USERPROFILE%\.dsh\.credentials.yaml`、`storages/workspace.json`（含本机绝对路径/工作区标题）本身即敏感，勿整文件入库。

---

## 6. 复核方式（只读）

**A. 一条命令看全量分布（PowerShell，只读目录）**

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Directory | ForEach-Object {
  $dirs = Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue
  $files = $dirs | ForEach-Object { Join-Path $_.FullName 'session.v4.jsonl.zstd' } |
           Where-Object { Test-Path $_ } | Get-Item
  "{0}`t{1}`t{2} ~ {3}" -f $_.Name, $dirs.Count,
    (($files | Measure-Object LastWriteTime -Minimum).Minimum),
    (($files | Measure-Object LastWriteTime -Maximum).Maximum)
}
```

**B. 逐会话读 header/标题（Node 24，多帧 zstd 解压）**

```js
// 只读；日志=多帧 zstd 拼接，按 magic 28 b5 2f fd 分段解压
import { readFileSync, readdirSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
const f = process.argv[2];
const buf = readFileSync(f);
const offs = [];
for (let i = 0; i + 4 <= buf.length; i++)
  if (buf[i]===0x28&&buf[i+1]===0xb5&&buf[i+2]===0x2f&&buf[i+3]===0xfd) offs.push(i);
let text = '';
for (const o of offs) { try { const t = zstdDecompressSync(buf.subarray(o)).toString('utf8'); if (t.trimStart().startsWith('{')) text += t; } catch {} }
const lines = text.split('\n').filter(Boolean);
const head = JSON.parse(lines[0]);            // {id,cwd,createdAt,origin,parentSession,agentPreset}
const title = lines.map(l => JSON.parse(l)).find(o => o.type === 'session/title');
console.log(head.id, head.cwd, new Date(head.createdAt).toISOString(), title?.data?.title);
```

**C. 更省的无正文方式**：直接读 `storages\session_projcache\sessions\<id>.json` 的 `rows.title` / `rows.titleInput.first.text` / `rows.sessionStats.turns`（本报告统计即以此为主，辅以目录计数交叉校验）。

---

## 7. UNKNOWN / 缺口

1. **旧 tree-harness**：DSH 会话库 0 条（见 §3.7），其 2026-06/07 会话需旧 harness 导出，标 UNKNOWN。
2. **meta-adapter 真源码仓** `meta-adapter-src`（私有 GitHub，195 commits）未在本机发现 DSH 会话 cwd；其开发过程是否全在 `D:\桌面\元方法论` 完成，需用户确认（本报告按「元方法论=适配器开发工作区」登记）。
3. **RSI 后续开发**：`dsh-harness-rsi` 目录下无 turn≥2 的开发对话；2026-10-23 之后的 RSI 迭代可能分散在 default-workspace/dsh_orb 或未存档，标 UNKNOWN。
4. **会话正文未逐条核读**（只做 header/projcache 元数据与关键词扫描）；「为什么关键」基于标题/首句+文档交叉，非全文审阅。
5. **归档会话**：`workspace.json` 的 archivedSessionIds 与 `session-` 前缀目录表示 UI 侧归档，索引仍有效，但 GUI 默认列表可能不显示。
6. 统计存在 1–2 条边界差异（如 `D:\Codes\RSI` 大小写盘符两种 cwd 写法），合并时以 project 分组为准。

---

## 附录 A：统计口径与产物位置

- 数据源：`C:\Users\sir_c\.dsh\sessions`（3,429 个 `session.v4.jsonl.zstd`，613.8 MB，2026-10-01 16:56 最早）＋ `C:\Users\sir_c\.dsh\storages\session_projcache\sessions`（3,429 份 JSON）＋ `workspace.json`。
- 分组：以 projcache `identity.cwd` 精确路径归类（非目录名猜测）；RSI 两个工作区按路径区分；元方法论=meta-adapter。
- 只读脚本（scratch，**不入库**）：`D:\Codes\_composition-research\session-scout\{scan,analyze,analyze2,final-stats}.mjs`，产物 `summary.json` / `final-stats.json` / `doc-session-map.json` / `analysis2.txt`。本仓仅保留本报告。
- 复核建议：先用附录 A-B 脚本对 1 个会话解包确认格式，再按需只读 projcache；**任何情况下不写 `.dsh`**。
