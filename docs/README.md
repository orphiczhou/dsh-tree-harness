# 文档索引与归档规范（docs/README.md）

> 本目录是 `dsh-tree-harness`（DSH 会话树体系）的**全部开发文档**。本文件是文档的**单一索引**，并规定新增/迁移/归档规则。
> 改完文档必须跑：`node scripts/check-doc-links.mjs` 与 `node scripts/check-md-tables.mjs`。
> 当前快照：2026-11-13 · tree-engine **v0.10.0**（9 工具 / 225-225 测试）· session-tree **v1.4.0**（公开镜像 tag **v1.4.0 = `0343f0c`**，main + tag，**21/21 SHA**）。组合修复：per-leaf relay 开关 / usagePct 端口修复 / sweep 跨实例生命周期 / tree_send 同树收紧 / 会话界面元数据条（子会话补 model·effort·context%，只读子会话 header chip）；**v0.8.1 深度预算**：tree 派发/接力显式传 `request.maxDepth`（D22 真机发现插件派发路径无平台深度兜底后修复）；**v0.9.0 硬安全与可观测性**：跨进程 `.lock` 文件锁 / nudge 强制 prune 走状态机 / `leaf:add` 13 键白名单 / `tree_log` 事件 meta 机读化 / `tree_maintain {action:"verify-delegate"}` 验证授权委托；**v0.10.0 flash 审计第二批**：依赖闸「已验证失败不放行」/ `set-verification` 一致性 / 竹节预算与唯一性 / `audit_meta` 校验与留痕 / `subagent_spawn` 仅 owner / `.tmp` 灾备 / `tree_maintain {action:"gc"}` + call-log 滚动。

## 0. 不同读者的入口

| 你是谁 | 先看什么 | 再看什么 |
|---|---|---|
| 第一次接触（人） | [项目全景地图](project-map-2026-11-11.html)（[在线版](https://orphiczhou.github.io/dsh-tree-harness/project-map-2026-11-11.html)） | [安装指南](guides/install-guide.md) → [Skill 使用指南](guides/skills-usage.md) |
| 第一次接触（Agent） | 公开镜像仓 [AGENT-INSTALL.md](https://github.com/orphiczhou/dsh-session-tree/blob/main/AGENT-INSTALL.md) | [Skill 使用指南](guides/skills-usage.md) → 对应 Skill 正文 |
| 接手开发 | [agent.md](../agent.md)（决策/路线/约定） | [当前交接](operations/handoff-2026-11-12.md) → [架构](#1-架构与规格architecture) |
| 要发版 | [发布流程](guides/publishing.md) | [当前交接 §发布](operations/handoff-2026-11-12.md) |
| 查历史结论 | [reports/](#3-一次性报告reports) | [archive/](#4-归档archive) |

## 1. 架构与规格（architecture/）

**现行、按主题维护，不带日期后缀；改动需同步 agent.md 决策日志。**

| 文档 | 内容 | 状态 |
|---|---|---|
| [engine-spec.md](architecture/engine-spec.md) | tree-engine 行为规约（S0 冻结版）：树语义、状态机、收敛判据；**v0.7.0 修订：会话预算含 `runtime.segmentChain`；会话 id 归一化（可选 `session-` 前缀）**；**v0.8.0 修订：per-leaf relay 开关（`set-relay`）、usagePct 端口修复、sweep 跨实例生命周期、relay parent 重解析**（§5 表后追加段） | 现行·权威 |
| [tools-mapping.md](architecture/tools-mapping.md) | 上游工具 → 复合工具映射表（S0 设计稿）；**实际注册以 `packages/dsh-tree-engine/index.js` 的 schema 为准** | 设计稿（部分未实现） |
| [segment-handoff.md](architecture/segment-handoff.md) | 竹节生长机制设计（pct≥42 同一 leaf 换会话、owner 重绑、链长 5） | 现行 |
| [features-2026-11-11-spec.md](architecture/features-2026-11-11-spec.md) | 功能规格：会话自交接（A 节）+ 会话树 UI 工作区归档/隐藏/检索（B 节） | 已实现（UI 部分持续迭代） |
| [session-handoff-2026-11-11.md](architecture/session-handoff-2026-11-11.md) | 会话自交接设计与交付记录（v0.1.0 → v1.2.0 并入 → v1.3.5） | 现行·详细 |
| [session-tree-ui.md](architecture/session-tree-ui.md) | **会话树 UI 设计与迭代规范**：client.js 代码地图、改哪里的速查、GUI 迭代 7 步流程、UI 变更记录 | 现行（GUI 迭代单一方案） |
| [composable-orchestration.md](architecture/composable-orchestration.md) | **组合式会话编排体系评估与设计（v0.1）**：会话树基础层 / tree-engine / 自由流程引擎的解耦、组合、递归嵌套与拆分策略；含平台约束、RACI、安全面、红队证伪修订与 5 步最小路线 | 候选·待用户决策（不是已批准决策） |
| [composition-playbook.md](guides/composition-playbook.md) | **组合编排剧本（2026-11-12 正式版；2026-11-13 v2 实证修正）**：relay 开关硬规则（R1–R8）、tree→flow / flow→tree / tree→flow→tree 三套剧本、深度算术（**纪律口径：`maxDepth` 仅对模型工具 `subagent` 生效**）、预算与并发、验证清单、一次性→非一次性会话说明（含跨仓需求单入口）、已知边界 9 条 | 现行·执行剧本 |
| [session-tree-v1.4.0-release-2026-11-13.md](reports/session-tree-v1.4.0-release-2026-11-13.md) | **session-tree v1.4.0 发布记录**：21/21 SHA、镜像 tag `v1.4.0` = `0343f0c`、本仓发布提交 `d8b9f7c`、`ls-remote` 核对；含发布物内容、**GUI 可视化已验证（2026-11-13 13:28 关闭 NOT VERIFIED）**与注意事项 | 发布记录 |
| [session-metadata-display-2026-11-12.md](reports/session-metadata-display-2026-11-12.md) | **所有会话显示 model / reasoning effort / context 占用**：投影数据源（`modelSelection`/`contextPressure`/`agentPreset`/`tokenUsage`）、5 类会话覆盖矩阵、**§9 修正：改到会话界面底部（composer.dock 子会话条 + 只读子会话 header chip）**、测试/GUI 验证、UNKNOWN；**GUI 可视化已验证（用户 2026-11-13 13:28 确认子会话数据可见，NOT VERIFIED 关闭）** | 研究报告 + 实现依据 |
| [composition-layers-explainer.md](architecture/composition-layers-explainer.md) · [composition-layers.html](architecture/composition-layers.html) | **组合式编排分层问答解说（归档，2026-11-12）**：层数 vs 会话深度、管理者=父会话、root/commander/worker 角色、拆树与审计路径；含可交互 HTML 图解（6 个标签页：单层 tree / 单层 flow / 两层 tree→flow / 两层 flow→tree / 三层 / 多画一层对照） | 解说材料（基于 tree-engine v0.8.0 / 组合评估 v0.1） |
| [merge-session-tree-2026-11-11.md](architecture/merge-session-tree-2026-11-11.md) | 双包 → 单包合并记录（方案 B⁺）、host/client 契约 | 历史性架构记录 |
| [s0-decisions.md](architecture/s0-decisions.md) | S0 规范冻结的裁决记录 | 历史性架构记录 |

## 2. 指南与运维（guides/ · operations/）

| 文档 | 内容 | 维护规则 |
|---|---|---|
| [guides/install-guide.md](guides/install-guide.md) | **人类安装指南**：三种安装路线（Git 镜像仓 / 本地 monorepo / 市场）、组件矩阵、验证、升级卸载 | 随安装方式变化更新 |
| [guides/skills-usage.md](guides/skills-usage.md) | 三个随包 Skill 完整使用指南（tree-commander / tree-worker / session-handoff）：发现、触发、参数、验收、42% vs 50%、升级、排障 | 随 Skill 改动更新 |
| [guides/publishing.md](guides/publishing.md) | 发布流程与规则：唯一源码事实源、镜像仓同步、`release-plugin.mjs`、版本纪律 D6、市场/npm 现状 | 每次发版追加记录 |
| [guides/split-preparation.md](guides/split-preparation.md) | **拆分准备指南（向导，不表示已决定拆分）**：12 插件源码目录地图 / 开发会话索引 / 决策前置（D1 反转、hmr.root、门禁）/ 8 步拆分工作流 / 单包清单 / DoD 与回滚 / 触发器 | 拆分决策变化或目录漂移时更新 |
| [operations/handoff-2026-11-12.md](operations/handoff-2026-11-12.md) | **当前交接/运维手册**：架构、关键路径、测试与验活命令、发布现状、已知边界、下一轮议程 | 每轮收口刷新；旧版进 archive |
| [operations/progress-map-2026-11-13.md](operations/progress-map-2026-11-13.md) | **进度地图（2026-11-13 快照）**：组件/版本/测试矩阵、D21 四项欠账、**§2.1 D22 组合编排 v2 已完成（flow 现场建树 + 深度链 1..5 + `maxDepth` 失效发现）**、下一步候选（#0 深度预算修复优先）与三个问题的用户拍板结果 | 给用户对齐用；每轮收口刷新 |
| [operations/RECEIPT-2026-11-13-from-flow-engine.md](operations/RECEIPT-2026-11-13-from-flow-engine.md) | **flow 项目组受理回执（2026-11-13 16:21，SHA256 与 flow 仓副本一致）**：两项需求已受理（用户裁决 B 档，M1.2 进行中）——`flow_send` 冷恢复续接（不提供驻留语义）+ 深度封口（`E_SESSION_DEPTH_EXCEEDED`）；含对来函三处事实更正与硬限制清单 | 受理结论已同步 REQ §附与 playbook §6；M1.2 落地后补续接试点 |
| [operations/REQ-2026-11-13-flow-node-continuable-session.md](operations/REQ-2026-11-13-flow-node-continuable-session.md) | **跨仓需求单（tree-harness → flow 项目组）**：flow 节点会话 continuable（`sessionMode`，缺省兼容）+ 深度上限（flow 执行器未传 `request.maxDepth` 的同源问题）；含现状代码行、场景、非目标、建议验收标准与受理方式；**§附「受理跟进与回执摘要」：2026-11-13 16:21 flow 方回执——已受理（用户裁决 B 档），M1.2 进行中（`flow_send` 冷恢复续接 + 深度封口）** | 待 flow 项目组响应；改动由用户裁决 |
| [operations/ISSUE-draft-hmr-reload-race.md](operations/ISSUE-draft-hmr-reload-race.md) | **平台 issue 草稿①（HMR 热重载与工具准入）**：0.2.2-rc.1 热重载替换工具注册对象 → 跨重载模型步对已注册工具报 `UNKNOWN_TOOL`（含会话日志原文/apply.log 统计/宿主代码定位/建议修复/证据路径）；**未对外提交** | 待用户批准后提交宿主；本仓仅留草稿 |
| [operations/ISSUE-draft-max-tokens-inheritance.md](operations/ISSUE-draft-max-tokens-inheritance.md) | **平台 issue 草稿②（跨模型 `maxTokens` 继承）**：子会话换路由时无条件继承父 `maxTokens`（384000）→ 上限 131072 的供应商首请求 400（两条原始错误/复现/宿主代码定位/建议修复）；**未对外提交** | 待用户批准后提交宿主；本仓仅留草稿 |
| [operations/E2E-PLAN-2026-11-13-flow-continuation-pilot.md](operations/E2E-PLAN-2026-11-13-flow-continuation-pilot.md) | **flow 续接 + flow×tree 混合流程试点 E2E 测试方案（D27，v1.1，待用户批准）**：范围与目标、五道执行闸（**P0 = flow 插件适配宿主 0.2.2-rc.3 `startActivation` spec 形状并重载 smoke PASS**——2026-11-13 21:46 两次真机失败 run 证实当前阻断；P1 = flow T-6 真机；P2 = 用户批准/时间窗/成本授权；P3 = 本仓门禁；P4 = 夹具编译语义）、双维矩阵（**续接维 TC-1..8**：`flow_send` 冷恢复正例 / journal 不写双读 / 跨会话代发负例 / 深度链核对 / sessionMode / 无 schema 续接轮 / 父会话存活 / `flow_resume` 边界；**混合维 TC-9..11（用户 22:0x 指示新增）**：tree→flow→tree 整链 rc.3 回归（复用 v3 配置换树号 t27a/t27b/t27c）/ 续接×内层树 / 深度+depth-6 负例）、验收 A1–A12、flash 档模型纪律、止损 | 批准前不得执行任何 `flow_run`/`flow_send` 活体调用；执行单 = 试点任务书（续接维）+ v3 配置副本（混合维） |
| [operations/FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md](operations/FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md) | **跨仓跟进单（D27，用户批准转交）**：宿主 18:17–21:45 升级 rc.1→rc.3 × flow 插件 `session-executor.js` 未适配 → 所有 session 节点 1ms `E_SESSION_START_FAILED`（两次真机失败 run + 源码行号取证）；含修复建议（适配 spec 形状/调用形状回归测试/基线刷新/受控重载/验收三步）与 E2E 方案 P0 闸衔接；**未改 flow 仓代码** | 由用户转交 flow 项目组；修复后以 smoke PASS 解除 E2E 方案 P0 闸 |
| [operations/taskbooks/](operations/taskbooks/) | **派发任务书集**：D23 轮（A1 审计修复 / A2 tree_log 机读 / A3 发布门禁 / A4 验证委托 / D1 文档 / R1·R2 异族复核）+ **D24 flow 续接受控试点任务书**（[d24-flow-continuation-pilot-taskbook.md](operations/taskbooks/d24-flow-continuation-pilot-taskbook.md)，**待执行**：前置 = E2E 方案 P0~P4 五闸全过（见上）；含调用方=发起 `flow_run` 会话、relay off、深度链≤5、journal 双读验收） | 一次性执行记录，随轮次归档 |
| [operations/wave2-plan-2026-11-12.md](operations/wave2-plan-2026-11-12.md) | **Wave 2 开发计划**：项目地图 §9 建议与波次 + Wave-1 剩余项 + 新发现（root id 兼容、GUI 规范），含 DoD/风险/执行方式；**✅ 已执行（W2.1–W2.8），证据见 [reports/wave2-closeout-2026-11-12.md](reports/wave2-closeout-2026-11-12.md)** | 计划为历史事实；完成情况见文首「执行状态」 |

## 3. 一次性报告（reports/）

**命名：`<类型>-<主题>-YYYY-MM-DD.md`；报告是当时证据，结论不随代码修改回写（新结论 -> 新报告）。**

| 文档 | 内容 |
|---|---|
| [audit-tree-system-2026-11-11.md](reports/audit-tree-system-2026-11-11.md) | tree 体系一致性审计（代码 → SKILL → 文档），含 B1–B4/P1 发现与修复 |
| [skill-e2e-2026-11-11.md](reports/skill-e2e-2026-11-11.md) | 极简提示词驱动的分层执行与 50% 交接 E2E（A/B/C 组） |
| [e2e-handoff-2026-11-11.md](reports/e2e-handoff-2026-11-11.md) | `session_handoff` 真机 E2E 取证（root/sibling、继承、工作区归属） |
| [e2e-kickoff-language-2026-11-11.md](reports/e2e-kickoff-language-2026-11-11.md) | 接替提示语跟随 DSH 界面语言：实现 + 真机 E2E（en 基线 → zh PASS） |
| [skill-cleanroom-2026-11-11.md](reports/skill-cleanroom-2026-11-11.md) | Skill 文档「洁净室」三轮独立评审与修订记录 |
| [verification-2026-11-11.md](reports/verification-2026-11-11.md) | 公开前独立验证报告（T3 / D2） |
| [bug-report-dsh-pnpm-exclude.md](reports/bug-report-dsh-pnpm-exclude.md) | DSH / pnpm `minimumReleaseAgeExclude` 锁文件校验路径 bug 报告 |
| [defect-2026-10-17-subagents-rc2-api-drift.md](reports/defect-2026-10-17-subagents-rc2-api-drift.md) | DSH 0.2.1-rc.2 `subagents` API 漂移导致真机派发即死的缺陷报告 |
| [conformance-rc2-2026-11-12.md](reports/conformance-rc2-2026-11-12.md) | W2.2 provider-conformance rc.2 fixture 取证：29/29 复验、fixture 来源与 SHA-256、缺 fixture 报错与版本漂移 |
| [e2e-release-runner-2026-11-12.md](reports/e2e-release-runner-2026-11-12.md) | W2.5 发布前真机 E2E 统一 runner：三条断言的编排/汇总/artifacts 布局、离线故障注入、replay 边界与真机触发方式 |
| [release-automation-2026-11-12.md](reports/release-automation-2026-11-12.md) | W2.7 发布自动化：一条命令（预检 → 同步/SHA → 本仓 commit → 镜像 commit/tag → `ls-remote`）、失败即停与回滚提示、凭据纪律、隔离沙箱演练 |
| [wave2-closeout-2026-11-12.md](reports/wave2-closeout-2026-11-12.md) | **Wave 2 收口报告**：W2.1–W2.8 逐项结论与证据（测试数 84→112、29/29、版本一致性 23 checks、runner/发布脚本演练边界）、未执行项（真机三断言 / 真推）与下一轮候选 |
| [e2e-release-three-assertions-2026-11-13.md](reports/e2e-release-three-assertions-2026-11-13.md) | **发布前三断言真机 E2E（D21）**：首次实际执行 PASS（verify-handoff 12/12、kickoff zh、skills 1/1）；首跑暴露并修复验证器**英文-only 假 FAIL**（语言无关识别 + 6 例单测）；release-all 测试门禁 5→9 条 |
| [composition-pilot-tree-flow-tree-2026-11-13.md](reports/composition-pilot-tree-flow-tree-2026-11-13.md) | **三层组合受控试点（tree→flow→tree，D21）**：flow `T3C1-R1` integrity=verified、两树 validate 0 issues、深度 max=4、约 179s；偏离（内层树预置 / relay 42% 未触发）与复现步骤；配置见 [demo/t3cpilot/](../demo/t3cpilot/README.md) |
| [composition-pilot-v2-live-create-2026-11-13.md](reports/composition-pilot-v2-live-create-2026-11-13.md) | **三层组合 v2（D22）**：flow 节点内 `tree_plan` **现场建树**（自标识双通道）、深度链 **1..5** 会话 header 实证、flow `T3C3-R1` succeeded/integrity=verified；**发现 `subagent.maxDepth` 在插件编程派发路径不生效**（depth 6 未被拒，含 asar 代码行根因）、现场建树验证归属缺口、`tree_log events` 不可机读；配置见 [demo/t3cpilot2/](../demo/t3cpilot2/README.md) |
| [composition-pilot-v3-depth-cap-2026-11-13.md](reports/composition-pilot-v3-depth-cap-2026-11-13.md) | **三层组合 v3 / 任务 1 深度上限真机回归（D23）**：depth 5 worker 的 `tree_dispatch` → `E_PORTS_PROTOCOL / subagent depth 6 exceeds maxDepth 5`（无 depth-6 会话）、深度链 1..5、flow `T3C7-R1` succeeded/integrity=verified、三树 validate 0 issues；含「tree 派发已封口 / flow 执行器仍未封口」边界与两个平台新发现；配置见 [demo/t3cpilot3/](../demo/t3cpilot3/README.md) |
| [d23-d24-interactive-status-2026-11-13.html](reports/d23-d24-interactive-status-2026-11-13.html) | **D23/D24 互动状态汇报（单文件离线 HTML）**：一页看懂 + flow 受理回执（A 受理结论 / B 三处事实更正 / C 可依赖·不可依赖 / D M1.2 进度 WIP / E 本仓同步）+ 其余问题清单（P1/P2/P3 逐条展开）+ 需用户拍板 4 项 + 证据索引；深浅色/折叠/复制路径，零外链 | 一次性汇报产物（2026-11-13）；后续变化以 agent.md 为准 |
| [composition-research-2026-11-12/](reports/composition-research-2026-11-12/README.md) | **组合式会话编排体系 · 专家取证报告集**：E1 仓库耦合 / E2 DSH 平台 asar 能力边界 / E3 自由流程引擎 / E4 SOTA 组合模式 / R5 红队证伪评审（2026-11-12 评估的原始证据；结论见 [architecture/composable-orchestration.md](architecture/composable-orchestration.md)） |
| [e2e-composition-relay-2026-11-12.md](reports/e2e-composition-relay-2026-11-12.md) | **S1 真机 E2E**：竹节 relay 是否打断运行中的 flow（实测 `cancelled / E_RUN_CANCELLED`）、宿主 `usagePct` 恒 null（inject 缺陷）、timer 自主路径受 reload 残影影响、per-leaf relay 开关建议 |
| [e2e-relay-switch-2026-11-12.md](reports/e2e-relay-switch-2026-11-12.md) | **v0.8.0 独立真机 E2E**：relay:'off' 长 flow 跑满 PASS / auto 回归复现暂停 / set-relay 权限正负例 / usagePct 服务获取已修但 measure 契约待收口 / v0.8.0 sweep 注册表 PASS + 旧僵尸已知边界；含 F1–F6 finding |

## 4. 归档（archive/）

**冻结：不再维护、不再引用为"现行"；保留历史证据，只允许补一行"已归档，见 XXX"。**

| 文档 | 原用途 |
|---|---|
| [handoff-2026-10-04.md](archive/handoff-2026-10-04.md) · [handoff-2026-10-14.md](archive/handoff-2026-10-14.md) | 历史交接文件（已被 operations/handoff-2026-11-11.md 取代） |
| [progress-2026-10-04.md](archive/progress-2026-10-04.md) · [e2e-report-2026-10-04.md](archive/e2e-report-2026-10-04.md) · [e2e3l-audit-2026-10-04.md](archive/e2e3l-audit-2026-10-04.md) | 2026-10-04 的进度/E2E/审计快照 |
| [agspec-report.md](archive/agspec-report.md) · [flaudit-report.md](archive/flaudit-report.md) | 子会话可观测性（A/B）与引擎设计审计（历史） |
| [proposals-from-agent-notes.md](archive/proposals-from-agent-notes.md) | 2026-10-04 的候选提案 |
| [project-restart-brief-2026-11-11.html](archive/project-restart-brief-2026-11-11.html) | 项目重启简报（依赖矩阵/重启清单，已被新文档取代） |
| [frozen-parent-plan/](archive/frozen-parent-plan/) | 冻结的上游父计划（PLAN-v1.7 + 评审报告） |
| [handoff-2026-11-11.md](archive/handoff-2026-11-11.md) | Wave-1 交接/运维手册（已被 [operations/handoff-2026-11-12.md](operations/handoff-2026-11-12.md) 取代） |

## 5. 归档与命名规则（强制）

1. **目录职责**
   - `architecture/`：现行架构/规格/设计。**按主题命名，不带日期**；改内容 = 改文件，版本/日期写在文内。
   - `guides/`：面向人/Agent 的操作指南（安装、使用、发布）。
   - `operations/`：唯一「当前交接/运维手册」放这里；被刷新取代的旧版进 `archive/`。
   - `reports/`：**一次性证据**，命名 `<类型>-<主题>-YYYY-MM-DD.md`（类型：audit / e2e / verification / cleanroom / defect / bug / progress）。
   - `archive/`：冻结历史；新增内容只允许「已归档」标注；**不删除历史证据**（删除需在 CHANGELOG 说明）。
   - `docs/project-map-*.html`：保留在 `docs/` 根，保证 GitHub Pages / 外部链接 URL 稳定。
2. **新增文档必须**：① 放进对应目录；② 更新本索引 §1–§4；③ 更新根 `README.md` 的文档索引（如有面向用户）；④ 跑链接/表格检查。
3. **跨仓引用**：公开镜像仓（`orphiczhou/dsh-session-tree`）里引用本仓文档**必须用绝对 URL**（`https://github.com/orphiczhou/dsh-tree-harness/blob/master/docs/...`），且只引用已发布/稳定路径。
4. **版本口径**：文档中的版本号、测试数、SHA 必须与包 `package.json` / `git log` 一致；发版后同步 `guides/publishing.md`、`operations/handoff-2026-11-12.md`、`agent.md`。
5. **状态词**：现行 / 设计稿（部分未实现）/ 已实现 / 历史性 / 已归档。禁止在现行文档里写「待填」。

## 6. 维护检查清单（每次提交文档前后）

```powershell
node scripts/check-doc-links.mjs     # 相对链接全部可达
node scripts/check-md-tables.mjs     # Markdown 表格列数一致
git grep -n "docs/old-path"          # 无旧路径残留（迁移后）
```
