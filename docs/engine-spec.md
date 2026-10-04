# 引擎行为规约（engine-spec）— S0 冻结版

| 项 | 值 |
|---|---|
| 状态 | S0 冻结（2026-10-04） |
| 规约对象 | 源引擎 `D:\Codes\tree-harness\tree-engine.cjs`（316,687 B，2026-10-03 实测）及其 MCP 适配层 |
| 权威来源 | **`proma-dev-patches.cjs` `buildTreeTable()`（L384–541）**——工具注册表本体（name/zod schema/handler→引擎命令映射），S0 首日发现，**A 断点权威闭合**；辅以 tree_help 全文（engine 内嵌）、tree-commander/tree-worker SKILL、tests/（16 文件） |
| 消费者 | S1 重写（TS ESM）以本规约为行为基准；差分测试以源引擎实跑为金标准 |

## 1. 工具面口径澄清（重要）

上游冻结版所记"29 工具"为 **v0.20 时代计数**（29 包装 + 1 tree_help 元工具 = 30，patches.cjs:2008 日志原文）。其后增量：
- Sprint 5（2026-07-14）：`tree_register_session` + `tree_session_count`（+2，macp2 会话爆炸根治）；
- P1-2（2026-07-24）：`tree_log_communication` + `tree_communication_list`（+2，send_message 可观测性）。

**当前权威计数 = 33 工具（32 包装 + 1 元工具）**。本仓整合基准为 33，"29→≤8"表述按此修正为 **33→≤8**。

**SKILL/引擎漂移证据**：tree-commander SKILL L345 引用 `tree_leaf_autonomy_override`，但引擎 dispatchLeaf 无此子命令、buildTreeTable 无此工具——S1 重写 SKILL 时以引擎为准剔除。

## 2. 引擎数据模型（tree-state.json）

- 每 tree 一目录 `<TREES_ROOT>/<tree_id>/`：`tree-state.json`（真源）、`.lock`（文件锁）、`tree-state.json.tmp`（原子写）、`backups/`（保留最近 10 份）、`call-log.jsonl`（append-only 观测层，10MB 轮转，绝不进 tree-state）。
- **tree_id 命名规则**：`[a-z][a-z0-9_]{3,7}`（4–8 字符小写无连字符）；root leaf_id = `<tree_id>-root` 由 tree_id 派生（init 即拦，leaf_add 前后一致）。
- 顶层字段：`tree_id`（自描述，restore 跨树校验用）、`created_at`、`leaves{}`、`drift_log[]`、`session_registry{}`（旁路会话登记）、`audit_meta{}`、完整性签名（critical 状态无签名 → tamper 告警 + drift 留痕）。
- leaf 关键字段：`leaf_id`（含 path 一致性校验）、`session_id`（严格 UUID v4）、`parent`、`role`、`model`/`channel`、`added_by`、`status`、`context_usage_pct`、`segment_chain[]`、`events[]`（11 类）、`milestones[]`、`drift_history[]`、`nudge_count`/`nudge_log`、`audit_gate{verdict,...}`、`last_event_type/ts`、`last_heartbeat`、`created_at`；worker 启动首读的**5 件套**（`brief`/`dod`/`report_protocol`/`autonomy`/`self_audit`）持久化在 leaf。
- **会话 id 全树唯一**：leaf.session_id、segment_chain 所有成员、session_registry 键，跨集合不重复（validate 检查 3）。

## 3. 状态机（闭集）

```
STATUS_ENUM = [active, done, pruned, archived, segment_pending, pending_brief]
迁移（L74–78）：
  active    → [done, pruned, archived, segment_pending, pending_brief, active]
  pending_brief → [active, pending_brief, ...]（brief 阶段灵活）
  segment_pending → [active, segment_pending]（竹节接手回 active；幂等）
  done/pruned/archived = 终态
```

关键门禁：
- **done 三重闸**（cmdLeafSetStatus）：① milestones 非空且全部 `audit_pass=true`；② 先有 `type=done` event（含 self_check schema：item/pass/evidence）后 set-status（反序被拒，V10-status-event-sync）；③ done 前树结构校验通过（validate issues=0，cmdLeafArchive 同源）。
- **竹节自动触发**（set-context）：`pct ≥ audit_meta.ctx_segment_threshold`（缺省 85）且非 root 且 active → `segment_pending` + drift(action=handoff) 留痕。
- **7-strike**（nudge escalation）：nudge_count ≥3→medium、≥5→high、≥7→强制 pruned。
- 级联：父 pruned → 未 done 后代（active/pending_brief/segment_pending）级联 pruned + drift 留痕。

## 4. 角色与工作流（SKILL 规约侧）

- 角色：`root`（信任锚，唯一，仅 tree_init 创建；可自审）、`commander`（嵌套 ≤3 层）、`worker`（不能有子节点）、`auditor`（独立审计，P0a 引入；不能自审，resolveAuditorIndep 拦截）。
- worker 生命周期：leaf_add（5 件套持久化）→ **brief_echo**（首条 event，用自己的话复述 brief + milestones 预览）→ 执行（milestone 逐个 add → set-result(audit_pass, 独立 audit_session_id)）→ done event（self_check）→ audit_gate（他人或 root 背书）→ set-status done。
- 事件 11 类：done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check/review_round/subagent_spawn/progress。ts 单调（≥created_at、≤now+60s、≥上一条）。
- 哨兵巡逻（heartbeat）：commander 周期 list-active → status_check → heartbeat_append(verdicts)；context_usage 由 worker 心跳后 set-context 上报。
- 三层纠偏（drift）：kind ∈ production/direction/rhythm × severity low/mid/high × action nudge/limit/prune/self_correct/declare/handoff。
- TAO 审计门：audit_gate verdict ∈ required/pass/pass_with_minor/fail/skip；pass 需先有 done event；auditor 必须独立（caller===audit_session_id，V10-self-audit-forbidden-v2，借身份 → E_BORROWED_IDENTITY）；audit_append report 数值一致性（total=passed+failed、results.length=total、severity ∈ red|yellow|green）。
- 外部通信可观测：send_message 后 log_communication（不截内容，自动更新 target last_event 防心跳误判冻结）。

## 5. 护栏总表（Z6 稳定对象，全部 S1 继承）

| 护栏 | 缺省 | 覆盖 | 语义 |
|---|---|---|---|
| node_budget | 20 | audit_meta | active leaf 数上限（leaf_add 拦） |
| max_subagent_spawn_per_leaf | 15 | audit_meta | 单 leaf subagent_spawn 事件上限（=5 reviewer×3 轮） |
| max_sessions | 50 | audit_meta | 树总会话（leaf.session + segment_chain + registry 去重计数）；register_session 幂等去重不多计 |
| UUID v4 严格校验 | — | — | 拒全 0/全 f/非 v4/空（V10-uuid-format-strict）；session 真实性 verifier 注入（setSessionVerifier，未注入 bypass 兼容 CLI/测试） |
| caller 透传 | — | — | run→dispatch→leaf add/set-status/set-session、event append、audit gate 全链 callerSessionId 校验（防借身份五处） |
| 完整性签名 | — | — | critical 状态（done/pass）无签名 → tamper 告警；writeState 自动签 |
| commander 嵌套深度 | ≤3 | — | leaf_add 拦（与 DSH maxDepth:3 恰好同值——嵌套语义天然对齐） |
| backup 轮转 | 10 | — | doBackup 保留最近 10 份；restore 前自动 before-restore 备份 + tree_id 匹配校验 |

## 6. 并发与入口契约

- **入口 `run(cmd, args, treesRoot?)`：永不 throw**；成功 `{ok:true,...}`，失败 `{ok:false, error:{code,message,help_topic?}}`——MCP handler 与测试共用唯一 choke point；per-call treesRoot try/finally 防跨请求污染。
- **临界区铁律**：所有 cmd 的 readState→改→writeState 临界区**纯同步不得 yield**（withLock fn 均同步箭头函数）；文件锁 `.lock` + tmp 原子 rename。
- 观测层铁律：call_log（每调用成功+失败均记）双层 try 吞错，绝不影响业务；`PROMA_CALL_LOG=0` 测试金标准开关。
- 错误码体系：E_*（≥30 个）全部挂 help_topic 映射。

## 7. 竹节（segment）语义

源语义 + 本仓 DSH 化设计见 **[docs/segment-handoff.md](segment-handoff.md)**（唯一真源；阈值 42、先 interrupt 后 start、链长上限 5、K1–K5 简报）。源侧要点：set-context 自动触发（85→42 纠偏）、segment append 全树唯一校验、segment_pending 状态位、SKILL 简报规约（≤2K tokens：进度+关键发现+未完成 milestones）。

## 8. S0 API 实测记录（2026-10-04；下午补源码级验证）

**验证通道**：① 本机导出（dsh-host-services.txt）；② profile 配置直读（cordis.patch.yml）；③ **app.asar 实现源直读**（`scripts/asar-tool.cjs` 解析 D:\DSHarness\resources\app.asar 头并按偏移抽取——实现源即权威）。

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 工具注册表权威源 | ✅ **闭合** | buildTreeTable（patches.cjs:384–541）+ 计数日志 :2008 |
| 2 | 模型窗口元数据来源 | ✅ 可得 | `llm-pi-ai` providers config：models[].contextWindow（glm-5.3 系 1M / MiniMax-M2.7 204.8K / mimo 1,048,576）；deepseek-official 系在 bundle 层 → 运行时读 provider registry，缺则 Config 映射兜底 |
| 3 | 子会话白名单/深度/并发 | ✅ 复证 | cordis.patch.yml L111–146：13 模型组、maxDepth:3、maxActiveSubagents:20 |
| 4 | host 服务签名 | ✅ **源码级**（asar 直读） | 目录 + asar 实现源（见下五项） |
| 5 | Inspect Service.listService 活查 | ❌ **通道降级** | provider 拒绝任意合法 object（含空对象）——环境缺陷登记；权威已由 ③ 补齐 |
| 6 | approval=never 运行时 | ✅ 观察 | 本会话审批提示禁用；human 验证模式降级路径（frozen + 工具面手动裁决）成立 |

**asar 源码级五项形状**（dsh-subagent/lib/typert.host.js、cordis-plugin-timer/lib/index.js、dsh-tools/lib/index.js、dsh-token-meter/lib/index.js）：

1. **ContinuableStartSpec**（✅ 已按此修正宿主 dispatch 端口）：
   `interface ContinuableStartSpec { provider: string; label: string; childId?: SessionId; request: Omit<SubagentStartRequest,'label'|'signal'|'outputSchema'>; signal: AbortSignal }`
   `→ ContinuableStart { childId: SessionId; messageId: MessageId }`（注意返回是 **childId**）；
   `SubagentStartRequest { label?; prompt: ContentBlock[]; parent: Agent; signal; agentOptions?; outputSchema?; maxDepth?; toolFilter?; persona? }`；
2. **timer 注入面**：`ctx.mixin("timer", [...])`（cordis-plugin-timer/index.js:7）——**ctx.timer 直接混入全部 Cordis 上下文**，无需 inject/get（宿主已按此修正，保留 ctx.get 兜底）；
3. **tokenMeter**：`measure(session, requestHeader)` = "Measure current request pressure"（上下文压力测量——竹节 usagePct 的宿主信号源；需 Session 对象，经 sessionQuery.readSession 取）；返回 "detached deeply immutable pressure and surface measurement"（具体字段 smoke 装载时打印冻结）；
4. **工具 exec 上下文 caller**：`exec.agent.session`（Session 对象，dsh-tools 实证）——callerOf 已修正为 `exec.agent?.session?.id ?? .header?.sessionId`；
5. **interrupt**：`interrupt(targetSessionId, authority)` + `interruptByParent(parent, child, 'continuable')` 双入口（竹节中断走 interrupt + authority 对象，形状 smoke 冻结）。

**转 S1 装载 smoke 清单**（收窄后）：startContinuable 的 request.parent 解析（宿主插件无 Agent 引用时服务侧行为）；tokenMeter.measure 返回字段；interrupt authority 对象形状；observeSession 事件形状与「中间产出」判据；简报全文回收（readSession 提取 K1–K5）。

## 9. 差分测试锚点（S1 执行时冻结，判据继承冻结版 §9 R1）

必一致：语义 id（leaf_id/tree_id 调用方给定）、parent、状态、path/role/model/channel、milestone.id、`sub:<leafId>:<序号>` 确定性拼接、边、统计。白名单：ISO 时间戳类、运行期 UUID `session_id`、自增序号（attempt/reentry/事件序号）。输入集 = tree-harness tests/ 全量 + SKILL 场景 ≥50 组调用序列。
