# 工具面整合表（S0 设计目标 → 实现进度）

> ⚠️ **本表是 S0 设计目标，不是当前工具面契约。** 实际注册的 8 个 `tree_*` 工具及其 action 闭集以 `packages/dsh-tree-engine/index.js` 的 schema 为准（v0.5.0）。已实现的子集：
> - `tree_plan [create]`
> - `tree_node [add, get, list, list-all, set-status, set-session]`
> - `tree_dispatch [start, cancel]`
> - `tree_report [context, event]`
> - `tree_status [overview, validate, sessions, harvest]`
> - `tree_verify [run, dod, adversarial]`
> - `tree_log [events, drift, heartbeat, communication]`
> - `tree_maintain [backup, restore, nudge-reset, register-session]`
>
> 本表里其余 action（如 `tree_report {action:"drift"}`、`tree_node milestone-*`、`tree_maintain gc`）是设计稿未实现项，照表调用会返回 unknown action。差异由 [audit-tree-system-2026-11-11.md](audit-tree-system-2026-11-11.md) P1-09 记录。
（tools-mapping）— S0 定稿

| 项 | 值 |
|---|---|
| 状态 | S0 定稿（2026-10-04）；来源清单以 [engine-spec.md](engine-spec.md) §1 的 33 工具权威表为准 |
| 整合原则 | 按动词类别合并、`action` 判别参数细分（继承冻结版 §4.1 决策）；每工具 `output.render` 紧凑文本渲染；caller 会话 id 由 DSH 工具上下文自动注入（等价源引擎 callerSessionId 全链透传） |

## 1. 八工具 × 33 源工具映射

| DSH 工具 | action 集 | 覆盖源工具 | 语义 |
|---|---|---|---|
| `tree_plan` | create / import / configure | tree_init（含 audit_meta 全量护栏参数） | 建树（root leaf 自动创建）、导入目标任务 |
| `tree_node` | add / get / list / list-all / set-status / set-session / milestone-add / milestone-update / milestone-set-result | leaf_add, leaf_get, leaf_list_active, leaf_list_all, leaf_set_status, leaf_set_session, milestone_add, milestone_update, milestone_set_result | 节点 CRUD 与里程碑（5 件套随 add 持久化；done 三重闸/闭集状态机/级联 pruned 全量继承） |
| `tree_dispatch` | start / cancel / retry / handoff | （新增引擎动作）+ tree_segment_append（手动竹节并入 handoff） | 派发（内部转 subagents.startContinuable）、取消（interrupt，先到者生效）、重派（attempt 追加）、**竹节交接**（自动为主，手动兜底；见 segment-handoff.md） |
| `tree_report` | event / drift / heartbeat / nudge / context / last-event / communication | event_append, drift_append, heartbeat_append, nudge_append, leaf_set_context, leaf_set_last_event, communication_log | 执行者/哨兵上行汇报（11 类事件、三层纠偏、心跳 verdicts、nudge、**上下文水位自报〔竹节二级信号〕**、外部通信留痕不截内容） |
| `tree_verify` | gate / append / policy-verdict | audit_gate, audit_append（+ 本仓验证层六模式裁决） | 审计门（caller===audit_session_id 借身份拦截、数值一致性）、审计报告、验证策略 verdict 落账（PLAN §5） |
| `tree_status` | overview / subtree / node / stats / validate / sessions | tree_tree_dump, tree_session_count, tree_validate | 树概览/子树/节点详情/统计/一致性校验/会话预算预检（显式收割顺带触发） |
| `tree_log` | events / drift / heartbeat / communication | event_list, drift_list, heartbeat_tail, communication_list | 四类日志查询（leaf/type/since/n 过滤全保留） |
| `tree_maintain` | backup / restore / migrate / register-session / nudge-reset / archive / gc | tree_backup, tree_restore, tree_migrate, tree_register_session, tree_nudge_reset（+ 归档/GC 为本仓新增动作） | 备份（轮转 10）/恢复（tree_id 匹配校验）/迁移/旁路会话登记（幂等）/nudge 清零/归档与垃圾回收 |

**计数核对**：plan(1) + node(9) + dispatch(源 1：segment_append) + report(7) + verify(2) + status(3) + log(4) + maintain(5) = **32**；`tree_help` 不占工具位——13 topic 内容并入各工具 description 与 tree-worker SKILL 重写版（错误返回保留 help_topic 式引用，指向 SKILL 章节）。

## 2. 引擎内化动作（不占工具面）

源引擎的哨兵巡逻循环（list-active → status_check → heartbeat）中，DSH 形态下由引擎 sweep 定时器自动执行（收割触发①②③④）；竹节自动接力全程引擎内化（测量 → 交棒指令 → 简报回收 → interrupt → start → 落账），工具面只暴露 `tree_dispatch {action:"handoff"}` 手动兜底。

## 3. 派发提示词组装（与验证层咬合）

`tree_dispatch {start}` 与竹节接手共用同一组装器：**角色预设（assignee.preset）+ 任务描述（5 件套）+ DoD（验证策略生成）+ 约束（禁改路径/预算/接口契约）**；竹节接手额外注入**交接简报全文（K1–K5）**。执行者开工即知验收标准，验证器与约束同源（杜绝双标）。

## 4. 与 DSH 原生工具的关系

- 会话生命周期（create/fork/list）→ DSH 原生 subagents/agentTeams，**不重复**；`tree_register_session` 保留（旁路会话入树预算）。
- 跨会话消息 → DSH 原生 send_message / 现役 `tree_send`；`tree_report {communication}` 只做留痕。
- 审批/计划评审 → DSH 原生 approval；引擎不升权（冻结版 §6）。
