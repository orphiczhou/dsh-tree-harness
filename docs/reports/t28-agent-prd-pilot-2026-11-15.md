# t28 真项目试点收官报告 — 从一句话意图到完整软件工程设计（自举案例）

> 日期：2026-11-15 · 轮次：D30 · 树：`t28a` · 结论：**PASS（七 leaf 全过，三道裁判门禁全 PASS，一致性复核 0 blocker）**
> 需求源：`demo/t28-agent-prd-pilot/inputs/prd-v0.2-source.md`（SHA256 `85D89192…4BE`，39102 字节）

## 0. 一句话

把 PRD《向导Agent多智能体协同开发平台 v0.2》描述产品的「向导Agent团队开编程前流水线」映射为本仓 tree-engine 任务树并真机执行：**从一句话用户意图出发，产出该平台自身的全套开编程前软件工程文档（长期迭代型 §5.2 全量 + GWT）**——被设计对象就是 PRD 里的平台本身（自举），这是本仓 tree-engine 的首次「真实项目」全流程测试。

## 1. 输入与用户裁决（2026-11-15 21:2x）

一句话意图：**做一个桌面应用，让完全不会编程的普通人，只靠自然语言对话，就能把想法变成能运行、可迭代的软件。**

| # | 问题 | 裁决 |
|---|------|------|
| 1 | 输入对象 | 平台自身（自举） |
| 2 | 文档模式 | 长期迭代型全量（PRD §5.2 完整目录） |
| 3 | 需求多轮对话环节 | 自主模拟用户（树内子会话模拟零基础画像，零打断） |
| 4 | GWT 测试文档 | 纳入（features + test-plan 属编码前验收契约） |

## 2. 树结构与执行（tree `t28a`，validate 0 issues）

```
t28a-root（Lead = 向导总控 + 裁判）
├─ W1 提炼员        00_AGENT_ROLES.md（337 行，§4 角色表 12/12 零遗漏）      [并行]
├─ W2 需求分析师    01_PRD/（prd.md F-01..F-24 + user-stories US-23 + 模拟访谈4轮）[并行]
├─ W3 UI/UX顾问     02_UX_DESIGN/（5 设计文档 + 4 个单文件 HTML 原型）      [并行]
│   ↓ 裁判门禁1（verify W2+W3 PASS + grep 独立复核硬约束四要素）
├─ W4 测试工程师    06_TESTS/（14 feature · 89 场景 · 24/24 覆盖 + 映射总表）[依赖 W2,W3]
├─ W5 架构设计师    03_ARCHITECTURE/（6 文件 · 5 puml · M0-M9）+ 04_API_SPEC（E-01..E-30）[依赖 W2,W3]
│   ↓ 裁判门禁2（verify W4+W5 PASS + H2 三要素/puml 配对/API 四要素独立复核）
├─ W6 工程经理      05_PROJECT_PLAN/（S0–S15 全 2 周粒度 + 7 角色激活 + 六步流水线）[依赖 W5,W1]
│   ↓ 裁判门禁3（verify W6+W4 PASS + H5/H6 独立复核 + 编号域边界校验）
└─ W7 整合收口      project-root/README.md + 07_VERSIONS/changelog.md + 00_CONSISTENCY-REPORT.md [依赖 W4,W6]
```

- 派发：全 flash 档（`zai-coding-cn/glm-5.3-flash`，model_route_query 首选 monthly 渠道）；七 leaf 单会话完成，无竹节接力触发（W3 自报峰值 ~40%）。
- 裁判门禁由 Lead 亲自 `tree_verify` 执行（依赖闸契约），共落 PASS ×7（W1/W2/W3/W4/W5/W6/W7）；每道门禁另有 Lead grep/正则独立复核（不复信 worker 自检）。

## 3. 交付物清单（`demo/t28-agent-prd-pilot/`，project-root 合计 6132 行）

| 目录/文件 | 规模 | 内容 |
|---|---|---|
| `00_AGENT_ROLES.md` | 337 行 | PRD §4/§9/§11 全角色职责提炼 + 角色→任务树映射 |
| `00_CONSISTENCY-REPORT.md` | 209 行 | 裁判软约束四维复核（见 §5） |
| `project-root/01_PRD/` | 855 行/3 文件 | 正式 PRD（F-01..F-24，P0×12/P1×9/P2×3，GWT 要点句验收标准）+ INVEST 用户故事 23 条 + 模拟访谈纪要 4 轮 |
| `project-root/02_UX_DESIGN/` | 1711 行/9 文件 | sitemap / user-flows（5 旅程）/ design-system（安心绿 #2E9E6B + C1-C16 组件 + 禁用词表）/ interaction-spec（§7.5 五条心理防御文案逐字落位）/ 4 个可交互 HTML 原型（0 外链，双击可开） |
| `project-root/03_ARCHITECTURE/` | 1306 行/7 文件 | architecture.md（Electron ADR + M0–M9 + 依赖图 + F 全覆盖映射 + ADR×7）/ class-diagram.puml（36 类 + 9 枚举）/ 时序图 ×4 / data-model.md（13 实体，零数据库文件体系） |
| `project-root/04_API_SPEC/` | 529 行 | api-spec.md：IPC+本地 REST 混合（ADR-03），E-01..E-30 每端点 Method/Path/Request/Response Schema |
| `project-root/05_PROJECT_PLAN/` | 754 行/3 文件 | sprint-plan（S0–S15 = 32 周，4 里程碑 v0.0.1→v1.0.0）/ team-config（激活 7 角色，全栈不激活 4 条理由）/ workflow（六步流水线 + 异常自愈 R1-R6） |
| `project-root/06_TESTS/` | 902 行/15 文件 | GWT features ×14（89 场景：正常 37/边界 26/异常 26，F-01..F-24 全覆盖，F-24 @deferred 有据）+ test-plan（24 行覆盖映射总表） |
| `project-root/07_VERSIONS/` | 189 行 | changelog：v0.0.0「文档体系就绪」+ 16 个规划态条目 |
| `project-root/README.md` | 169 行 | 项目总览：文档地图 + 六张编号锚点速查表 + 双读者路径 + 状态声明（编码未开始） |

## 4. 裁判门禁记录（PRD §9.2 口径）

| 门禁 | 对象 | 硬约束结论 | 独立复核证据 |
|---|---|---|---|
| 1 | W2 PRD + W3 UX | H1 四要素（项目名称/目标用户/核心功能列表/验收标准）✅ | 行级 grep（prd.md :13/:36/:111/:144）+ 交付物 15 文件齐备 + 原型 0 外链 |
| 2 | W4 GWT + W5 架构 | H2（选型/模块/依赖）+ H3（puml 有效）+ H4（API 四要素）✅ | 5 puml @startuml/@enduml 全配对；API 四要素 94 处命中；89 场景 24/24 覆盖 |
| 3 | W6 计划 | H5（Sprint ≤2 周）+ H6（激活角色/职责边界/交付物）✅ | 16×2 周逐卡片；三要素逐角色；F≤24、E≤30 编号域边界校验 |
| 收口 | W7 整合 | 软约束四维（见 §5） | 五方对账 40 点 0 冲突；编号域机器校验 9/9 |

## 5. 一致性复核（W7，`00_CONSISTENCY-REPORT.md`）

- 编号域全量机器校验 **9/9**（F 24/24、E 30/30、M 10/10、S 16/16、US 23/23、NFR 5/5、GWT 89 场景 24 族连续、Sprint 端点引用在域内、优先级分布）；
- 五方抽样链路 8 条 × 5 方 = **40 对账点，0 逻辑冲突**；
- **矛盾/缺口 13 条，全部 minor、0 blocker**，只登记未代改：同根因聚类为 api-spec §5 表行合并粒度歧义（G-02/04/11/12）、架构 §6 端点补登（G-01/06/08/09）、F-07/F-10/F-18 端点口径显式化（G-05/07/10——其中 **F-10 是 24 项中唯一在 API 表无端点行的功能**）、类图无 M9·b/M9·c 独立类（G-13）；F-24 无端点为三处口径一致的已声明豁免。

## 6. 真机活体证据

- 面板路由：`GET /tree-panel/trees?limit=10` → **200**（返回 t28a/wave2 真实数据）；`GET /tree-panel/trees/t28a` → **200**（8 leaves 全 verify=True）；
- `tree_doctor` 7/7 · **v0.11.0**（升级后活体读数，与本探针同时段）；
- 两包为 **link: 安装**（`source: link:D:\Codes\dsh-tree-harness\packages\...`）——仓库改动**无受控重载即生效**（D28「受控 disable→enable」纪律在本形态下非必需；但 client 半仍需用户刷新页面加载新 client.js）；**口径校准**：根 README :174 记载 2026-11-11 实测「index.js 改动保存不重新求值」与本日观测相反——本日宿主曾于 21:20 重启（GUI 端口 53961→55095）且引擎模块或按 profile context 重新物化，今日结论仅记录为本次观测，disable→enable 仍视为可靠兜底路径；
- 面板 UI 活体（Tree Runs pill + 右栏页签真人目视）：待用户刷新页面确认后回填本节。
- 已知观测口径：面板/依赖闸视角的 leaf `status` 字段停留 `pending_brief`（runtime.succeeded + verification.pass 均为真）——状态字段迁移依赖未暴露的 milestone 命令，见 §7-E2。

## 7. 暴露清单（本仓 harness 改进候选，已登记为后续 backlog）

| # | 暴露 | 证据 | 归属 |
|---|---|---|---|
| E1 | **done 事件 ≠ 结算**：依赖闸要求每个**被依赖 leaf** 逐一 `tree_verify` PASS，漏一个即 `E_DEPENDENCY_NOT_MET` 卡住下游（W1 未过 verify 卡住 W6 派发） | 本轮 W6 派发错误原文 | F6（依赖闸契约模板化）真实案例：模板应为「派下游前对所有 deps 逐 verify」 |
| E2 | leaf `status` 字段在 done 事件 + verify PASS 后仍停留 `pending_brief`（milestone set-status 命令不在工具面）→ 面板 byStatus 计数与依赖闸语义不可视 | 探针 detail `byStatus:{active:1,pending_brief:7}` vs 7 leaf 全 done | F7（leaf 观测缺口）补充案例 |
| E3 | `tree_dispatch` 瞬态 `unknown tool` ×3 连续（~90s 自愈），同窗口 `tree_status`/`tree_doctor` 正常 | 21:5x 三次调用失败记录 | D23 已知 HMR 重载竞态边界再现，平台侧 |
| E4 | `tree_plan create` 缺省不绑 root owner session → `verify-delegate` 永久不可用（root session null）；本次靠 creator 身份 verify 绕开 | engine.js :374 报错路径 + 建树时未传 session_id | engine 改进候选：create 缺省绑定调用者会话 |
| E5 | `leaf:add` 的 `dependencies: []`（空数组）被拒，必须省略字段 | E_SCHEMA_INVALID 报错 | DX 小刺 |
| E6 | `leaf:add` 的 path 校验要求逐字等于 leaf_id 解析段（`T28A/W1`/`T28A/W1-Extract` 均被拒），需试错摸到 `W1` | E_SCHEMA_INVALID ×14 | 报错清晰但可考虑接受 `prefix/segment` 形态或文档示例 |

## 8. 范围边界与未竟事项

- **只做开编程前文档**：产品代码一行未写（wireframes HTML 属文档体系样例）；GWT 未运行（无产品可测），收口判据在真实开发阶段由测试Agent执行；
- 模拟访谈/原型反馈均为**自主模拟**（用户裁决 3），非真人输入；
- 同日并行完成：**Tree Runs 面板**（tree-engine v0.11.0 `/tree-panel` 只读路由 256/256 + session-tree v1.5.0 面板客户端，commit `4d658fc`）——面板本身即用 t28a 真实数据完成真机活体；
- 遗留小项：`packages/dsh-session-tree/README.zh.md`/`AGENT-INSTALL.md` 仍引 v1.4.1；skills-usage §9 Skill 正文 v2.2 与 SKILL 头部 v2.3 口径差；项目地图冻结历史区 8 条 warn-only——均不阻断，列入下轮文档小扫尾；
- batch2（约 24 条）+ F5–F7 + 本报告 E1–E6：等用户指令一起弄。

## 9. 结论

**t28 真项目试点 PASS**：一句话意图 → 七 leaf 三门禁 → §5.2 全量开编程前文档体系（42/42 完整性核对通过、编号域五方对账 0 冲突、13 minor 缺口已登记），全 flash 档零人工干预（除四项初始裁决与门禁执行），同时意外收获面板功能的真机活体验证。**PRD 流水线在 tree-engine 上的可编排性得到实证。**
