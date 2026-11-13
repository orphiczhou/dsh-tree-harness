# 进度地图（2026-11-13 19:3x 快照）

> 给用户对齐用的一页进度图。**先对齐本图，再决定下一步推进**（用户 2026-11-13 指示：交接新会话后先沟通进度地图）。
> 权威细节：状态/决策以 [agent.md](../../agent.md) 与 [handoff-2026-11-12.md](handoff-2026-11-12.md) 为准；本文件只做「一眼看懂」的汇总。

---

## 0. 一句话

**引擎与插件全部就绪、发布物与公开镜像逐字节一致；D21 清掉「真机 E2E + 三层组合试点 + 发布测试门禁 + 会话元数据 GUI」，D22 完成组合编排 v2 + v0.8.1 深度预算修复，D23（2026-11-13 晚）完成用户点名的 1-4 四项**：深度 6 拒绝真机回归 PASS、flash 审计三条高危修复、发布前 E2E 门禁收紧、`tree_log` 机读化 + 验证授权委托；tree-engine 升到 **v0.9.0**（213/213）。剩余以「组合编排继续深挖 / 历史边界清理」为主，无阻塞性缺陷。

---

## 1. 组件与测试（FACT）

| 组件 | 版本 | 状态 | 测试 |
|---|---|---|---|
| `packages/dsh-tree-engine` | **v0.9.0** | 运行中（9 个 `tree_*` 工具 + 随包 2 份 Skill v2.3；活体 7/7 · v0.9.0） | **213/213**（25 个 `.test.js`）；发布门禁单测 14/14 |
| `packages/dsh-session-tree` | **v1.4.0** | 运行中（`tree_send` 仅同树 + `session_handoff` + 会话界面元数据） | handoff 41/41、tree-send 25/25、meta 41/41、render 151/151+9+11、style-guard 26/26、skills 3/3、verify-bundle 0 fail、provider-conformance 29/29 |
| `packages/dsh-agent-introspect` | v0.1.0 | 运行中（`self_spec`） | — |
| 公开镜像 `orphiczhou/dsh-session-tree` | tag **v1.4.0 = `0343f0c`** | main + tag 已推送，21/21 SHA 一致 | — |

平台参数（2026-11-13 01:00 重启后生效）：`maxDepth=5` · tree `commander_max_depth=3` · `maxActiveSubagents=24` · `sweepMode=timer`。

---

## 2. D21 轮已完成（2026-11-13）

| 事项 | 结果 | 证据 |
|---|---|---|
| 发布前真机三断言（此前「本体未执行」欠账） | **PASS 3/3**（verify-handoff 12/12、kickoff zh、collect-skills 1/1） | `scripts/e2e/artifacts/release-20261112T171827Z.json`；报告 [e2e-release-three-assertions-2026-11-13.md](../reports/e2e-release-three-assertions-2026-11-13.md) |
| 验证器缺陷（中文界面假 FAIL） | **已修**：新增语言无关识别模块 + 6 例单测；session-tree 包内容未变（不 bump） | `scripts/e2e/lib/handoff-prompt.mjs` / `.test.mjs` |
| tree→flow→tree 三层受控试点 | **PASS（受控范围）**：flow `T3C1-R1` integrity=verified、两树 validate 0 issues、深度 max=4、约 179s | [composition-pilot-tree-flow-tree-2026-11-13.md](../reports/composition-pilot-tree-flow-tree-2026-11-13.md)、配置 [demo/t3cpilot/](../../demo/t3cpilot/) |
| 发布测试门禁 | **5 → 9 条**，9/9 实跑通过；`release-all --dry-run` exit 0（v1.4.0 no-op） | 同上报告 §4 |
| 会话元数据 GUI（model/effort/context） | **人工验收 PASS（13:28 关闭 NOT VERIFIED）**：root 保官方 UI 无重复；子会话显示底部 `model · effort · pct`；只读子会话标题栏 chip | [session-metadata-display-2026-11-12.md](../reports/session-metadata-display-2026-11-12.md) §9.8、交接 §7.10h |

Git：`83c0502`（证据+修复）、`6c1a0ee`、`65feef0`，均已推送 `master`；另有本轮「关闭 NOT VERIFIED + 进度地图」提交。

---

## 2.1 D22 轮已完成（2026-11-13 下午，用户拍板「组合编排深挖现在做」后）

| 事项 | 结果 | 证据 |
|---|---|---|
| 组合编排 v2：flow 节点内 `tree_plan` **现场建树**（补 v1 偏离 D1） | **PASS**：`t3c4-root.session_id` = flow 节点会话 `263d4c4e`；自标识 `self_spec` 与 `$env:DSH_SESSION_ID` 双通道一致 | [v2 报告 §2/§4](../reports/composition-pilot-v2-live-create-2026-11-13.md)、[demo/t3cpilot2](../../demo/t3cpilot2) |
| 深度链压到 5（`maxDepth=5`） | **PASS**：depth 1→2→3→4→5，由 6 个会话 header `delegationDepth` 逐条实证 | 同报告 §2；`~/.dsh/sessions/…/session.v4.jsonl.zstd` |
| flow 收口 + 完整性 | **PASS**：`T3C3-R1` succeeded/integrity=verified（339.3s）；两树 validate 0 issues；无 drift/chain | 同报告 §4 |
| **发现：`maxDepth` 在插件派发路径不生效** | 深度 6 探针**未被拒绝**（子会话创建成功，`delegationDepth=6`）——`subagent.maxDepth=5` 只是模型工具 `subagent` 的策略；tree 派发与 flow 执行器都未传 `request.maxDepth` | 同报告 §5（含 asar 代码行） |
| **修复：tree-engine v0.8.1 深度预算**（用户 2026-11-13 拍板「现在就修」） | **已完成**：`DEFAULT_GUARDS.max_subagent_depth=5`（`TREE_ENGINE_CONFIG` 可覆盖）、dispatch/竹节接力/攻击审计会话显式传 `request.maxDepth`、新增 `buildStartRequest` 纯函数；测试 **172/172**（+4 depth-cap、+3 compat）；活体 reload 后 `tree_doctor` version=0.8.1 | [CHANGELOG](../../CHANGELOG.md) v0.8.1 节、[包 README](../../packages/dsh-tree-engine/README.md) |
| **发现：现场建树的验证归属缺口** | 内层叶 creator=flow 会话、结束即 dispose → Lead 事后 `tree_verify` 被 `E_BORROWED_IDENTITY` 拒；验收口径暂用 runtime+validate | 同报告 §6 |
| 跨仓需求单（用户指示：只写单不代改 flow 仓） | **已写并递交**：flow 节点 continuable + 深度上限两需求 → [REQ](REQ-2026-11-13-flow-node-continuable-session.md)；副本在 flow 仓 `evidence/requirements/` | 本文 §3 末尾问题 ② |

**用户 2026-11-13 对三个问题的拍板**：① 组合编排深挖 **现在就做 → 已完成（v2 PASS）**；② flow 一次性→非一次性 **不改代码**，写需求单交 flow 项目组响应 → **已成单递交**；③ 三层组合**暂不对外**。

## 2.2 D23 轮已完成（2026-11-13 晚，用户点名 1-4 全做 + 异族多模型）

| # | 事项 | 结果 | 证据 |
|---|---|---|---|
| 任务 1 | v0.8.1 深度上限**真机回归**（depth 6 应被拒） | **PASS**：depth 5 worker 的 tree 派发被拒 `E_PORTS_PROTOCOL / subagent depth 6 exceeds maxDepth 5`，无 depth-6 会话；深度链 1..5、flow `T3C7-R1` succeeded/integrity=verified、三树 validate 0 issues | [v3 报告](../reports/composition-pilot-v3-depth-cap-2026-11-13.md)、[demo/t3cpilot3/](../../demo/t3cpilot3/) |
| 任务 2 | flash 审计三条高危（#1/#7/#19）+ 发布门禁收紧 | **DONE**：`.lock` 跨进程写互斥（O_EXCL/nonce/陈旧接管/心跳；`withTree`/`withTreeMut` 读写分层）、nudge 强制 prune 走状态机、`leaf:add` 13 键白名单；发布前真机 E2E 门禁接入 `release-all.mjs`（8 项检查、写前阻断、豁免需 reason、publishing.md §5.2，14/14 单测） | tree-engine README v0.9.0 节、CHANGELOG D23 节 |
| 任务 3 | 跟进 flow 项目组对需求单响应（只读，不改 flow 仓） | **已受理（B 档，M1.2 进行中）**：flow 回执 2026-11-13 16:21——需求一采纳为 `flow_send` 冷恢复续接（不提供驻留语义）、需求二采纳并更正为「完全不校验（无上限）」+ M1.2 能力感知封口；三处事实更正已同步本仓文档 | [REQ](REQ-2026-11-13-flow-node-continuable-session.md) §附；flow 仓 `evidence/requirements/RECEIPT-2026-11-13-to-tree-harness.md` |
| 任务 4 | 现场建树验证归属 + `tree_log events` 机读 | **两项均落地**：`tree_log` render 一行一条（done meta 可读）+ `tree_maintain {action:"verify-delegate"}` 验证授权委托（仅 root 授予、被授权者只写 verification、security drift 留痕） | 同上；活体验证：授予/清空/审计可见 |
| 复核 | 异族交叉复核（防单模型认知锯齿） | R1=Qwen 审审计修复 **PASS_WITH_RISKS**（P1 既存 id 覆盖擦除终态 + 3 P2 已全部修复，+4 回归）；R2=GLM 审 tree_log+门禁 **PASS_WITH_RISKS**（1 P1 JSON null 抛异常 + 2 P2 已修复，14/14） | 报告与任务书 [taskbooks/](taskbooks/) |

**D23 新发现（平台侧，非阻塞）**：① 宿主 HMR 重载竞态——并行改 `packages/**` 触发反复重装，重载窗口内旧实例 dispose 会反注册新实例工具，调用方偶发 `unknown tool`（受控 disable→enable 可恢复；建议宿主侧串行化）；② tree 派发 `assignee` 跨模型时宿主按**调用方会话**的 `maxTokens`（384000）下发，目标模型上限 131072 的供应商（zai/glm、xiaomi/mimo）首请求即 400（当前用 deepseek-official / opencode-go 通道绕行；建议宿主按目标模型 clamp）。→ **D24 已升级为两份平台 issue 草稿**（未对外提交）：[ISSUE-draft-hmr-reload-race.md](ISSUE-draft-hmr-reload-race.md)、[ISSUE-draft-max-tokens-inheritance.md](ISSUE-draft-max-tokens-inheritance.md)。

## 2.3 D24 轮已完成（2026-11-13 晚，接续会话 `D24-FLOW-M12-PILOT`）

| # | 事项 | 结果 | 证据 |
|---|---|---|---|
| 1 | flow M1.2 只读复查（不改 flow 仓） | **离线交付已提交**：flow 仓 HEAD `13776bc`（`main`），代码 `2918fba`（T-2 深度封口 / T-3 sessionMode / T-4 `flow_send`）+ 文档 `13776bc`；**kernel 287/287 · plugin 175/175 · qa-gate PASS**（floor 287/175）；18:52 的 `m1-judge:140` 计数残留已修。**T-1 探针 / T-6 真机仍未执行**（需用户在场+重载）→ 本仓续接试点**等真机 PASS + 用户时间窗**，不抢跑 | [REQ §附/§附 F](REQ-2026-11-13-flow-node-continuable-session.md) |
| 2 | 平台 issue 草稿（P1-B） | **两份完成（只拟稿、未对外提交）**：① HMR 重载与工具准入（含 18 次错误原文/apply.log 35 次重载统计/宿主 `dsh-tools` 代码定位）；② 跨模型 `maxTokens` 继承（2 条 400 原文/子会话与父会话证据/`child-agent.js:74-92` 不对称逻辑） | [ISSUE-draft-hmr-reload-race.md](ISSUE-draft-hmr-reload-race.md)、[ISSUE-draft-max-tokens-inheritance.md](ISSUE-draft-max-tokens-inheritance.md) |

## 3. 下一步候选（按建议优先级）

| # | 事项 | 为什么值得做 | 需要谁定 |
|---|---|---|---|
| 0 | ~~tree-engine 深度预算修复 + depth 6 真机回归~~ | **D22 修复（v0.8.1）+ D23 真机回归 PASS（v0.9.0，213/213）** | — |
| 1 | ~~组合编排深挖（内层树现场创建 + maxDepth 边界）~~ | **D22 已完成** | — |
| 2 | **flow 节点续接（`flow_send` 冷恢复）+ flow 侧深度封口** | **flow 侧 M1.2 离线交付已提交（`2918fba`/`13776bc`，kernel 287 · plugin 175）**；**T-1 探针 / T-6 真机待收口**（需用户在场+重载）→ 本仓续接试点等真机 PASS + 用户时间窗 | flow 项目组真机收口；本仓试点待信号 |
| 3 | ~~发布门禁再收紧 + flash 审计三条高危~~ | **D23 已完成（v0.9.0）**：真机 E2E 门禁写前强制 + 12 项检查实现（artifact 8 项 + CLI）；三条审计修复 + R1/R2 复核修复 | — |
| 4 | 只读子会话底部 Phase 2（chain 覆盖官方只读 composer） | 当前只读子会话元数据在标题栏 chip；用户未明确要求底部 | 仅用户要求时做 |
| 5 | 已知边界清理：artifact 验证对象错位、`runtime.history` 预算口径、`tree_maintain gc`；D22 新增两项（`tree_log events` 可机读、现场建树验证归属）**D23 已完成** | 历史欠账，非阻塞 | Lead 排期 |

**三个问题当前状态**：① 已做（v2 PASS + v3 深度回归 PASS）；② 需求单**已受理（B 档）**，flow 项目组 M1.2 进行中（回执 2026-11-13 16:21；深度项首批、`flow_send` 随后）；③ 暂不对外（用户 2026-11-13 拍板）。

---

## 4. 风险与边界（FACT）

- 内层树预置是已知偏离（见 §3-1）；relay 42% 阈值在 D21 试点中未被压到（外层上下文约 4.1%）——relay 抗打断仍以 v0.8.0 E2E 为据。
- `provider-conformance` 依赖本机 `%TEMP%` rc.2 fixture：发布门禁已按「缺 fixture 记 SKIP、断言失败仍阻断」处理，但干净机器上等于未覆盖。
- 顶层记忆：真机操作类结论必须有活体读数/截图；UI 结论本轮已闭环（代码级 + 截图 + 用户确认）。
- D23 平台侧边界（非本仓可修）：HMR 重载竞态导致工具面瞬态 `unknown tool`；tree 派发跨模型 `maxTokens` 继承调用方（小上限供应商 400，当前绕行）。两者均已在 v3 报告 §6 记录，并升级为平台 issue 草稿（[①](ISSUE-draft-hmr-reload-race.md)、[②](ISSUE-draft-max-tokens-inheritance.md)，未对外提交）。
- flow 侧 M1.2 **真机未收口**前，不得引用 `flow_send` 为「可依赖」；本仓试点亦不得抢跑（详见 REQ §附 F）。
