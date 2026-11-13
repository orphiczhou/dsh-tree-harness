# 进度地图（2026-11-13 22:1x 快照 · D27 接续会话更新）

> 给用户对齐用的一页进度图。**先对齐本图，再决定下一步推进**（用户 2026-11-13 指示：交接新会话后先沟通进度地图）。
> 权威细节：状态/决策以 [agent.md](../../agent.md) 与 [handoff-2026-11-12.md](handoff-2026-11-12.md) 为准；本文件只做「一眼看懂」的汇总。

---

## 0. 一句话

**引擎与插件全部就绪、发布物与公开镜像逐字节一致；D21 清掉「真机 E2E + 三层组合试点 + 发布测试门禁 + 会话元数据 GUI」，D22 完成组合编排 v2 + v0.8.1 深度预算修复，D23（2026-11-13 晚）完成用户点名的 1-4 四项**：深度 6 拒绝真机回归 PASS、flash 审计三条高危修复、发布前 E2E 门禁收紧、`tree_log` 机读化 + 验证授权委托；**D24 完成 flow 回执落地 + 平台 issue 草稿 + flash 审计第二批（#8/#15/#20/#21/#22/#28/#30）**，tree-engine 升到 **v0.10.0**（225/225）；**D25 batch1 复核收口合回主干（3196f33）**；**D27（进行中）**：batch2（约 24 条）按用户指示**列入计划暂不开工**，flow 续接试点 E2E **方案已成文待用户批准**，且**发现新阻断**——宿主 18:17–21:45 升级 0.2.2-rc.1→rc.3 × flow 插件未适配 → 所有 session 节点 `E_SESSION_START_FAILED`（修复属 flow 仓，等适配）。

---

## 1. 组件与测试（FACT）

| 组件 | 版本 | 状态 | 测试 |
|---|---|---|---|
| `packages/dsh-tree-engine` | **v0.10.0** | 运行中（9 个 `tree_*` 工具 + 随包 2 份 Skill v2.3；活体 7/7 · v0.10.0） | **225/225**（26 个 `.test.js`）；发布门禁单测 14/14 |
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
| 3 | flash 审计第二批 P0/P1（#8/#15/#20/#21/#22/#28/#30，顺带 #23） | **完成 + D25 复核跟进收口（tree-engine v0.10.0）**：依赖闸**只认正向结算信号（三重闸 done ∨ verification.pass=true；自报 done 不再放行下游，主旁路闭合）**+ stale-done 判据、`set-verification` verdicts/pass 一致性 + 空 verdicts 无证据 PASS 拒绝、竹节接力会话预算预检 + 唯一性回滚 + 单账本口径、`audit_meta` 严格校验 + 消费键放宽留痕/recorded-only 键上调拒收/编排键拒收 + 阈值回退修复、`event:subagent_spawn` 仅 owner、`fsStore.read` `.tmp` 灾备 + 损坏取证副本与 call-log 留痕、`tree_maintain {action:"gc"}` + call-log 10MB 滚动；测试 **213 → 225/225**；R1 复核 PASS_WITH_RISKS 的 P1-1/P2-2/P2-3/P3-3/P3-4 已收口，D25 二次复核（deepseek-v4-pro）无新增 P1/P2；D12 活体 doctor 7/7·v0.10.0 + gc 计数/drift 留痕（明细见报告 §六） | `docs/reports/review-p2a-batch1-2026-11-13.md`、tree-engine README v0.10.0 节 |
| 4 | flow 续接受控试点任务书 | **就绪（待执行）**：前置 = flow T-1/T-6 真机 PASS + 用户时间窗；含调用方=发起 `flow_run` 的会话、relay off、深度链 ≤5、journal 双读验收 | [d24-flow-continuation-pilot-taskbook.md](taskbooks/d24-flow-continuation-pilot-taskbook.md) |

## 2.4 D27 轮进行中（2026-11-13 晚，session_handoff 接替会话 `D27-FLOW-E2E-PILOT`）

| # | 事项 | 结果 | 证据 |
|---|---|---|---|
| 1 | batch2 登记开工门（用户 21:48 指示：列入计划、暂不开工、等指令） | **已登记**：agent.md 路线图 R15 + 本图 §3-6；清单 = [review-p2a-batch1 §三/§六](../reports/review-p2a-batch1-2026-11-13.md)（P2-1/P3-1/P3-2/P3-5/UNKNOWN-1/4 + 二次复核 P3-7~P3-13，其中 P3-12 已当场消解、P3-13 设计内可接受）+ P3-9 语义取舍 | agent.md §3 R15 行 |
| 2 | flow 续接/混合 E2E 测试方案（先方案后测试；用户 22:0x 指示补充混合维） | **✅ v1.1 已获用户批准（22:1x，P2 闸通过：方案定稿 + 时间窗开启 + 双维成本授权）**：五道执行闸 P2 已过，剩 P0（插件适配 rc.3 smoke）+ P1（T-6 真机）+ P4（夹具语义确认）；**双维矩阵——续接维 TC-1..8 + 混合维 TC-9..11**（tree→flow→tree 整链 rc.3 回归复用 v3 配置换树号 t27a/t27b/t27c + 续接×内层树 + depth-6 负例）/验收 A1–A12/flash 档模型纪律/止损 | [E2E-PLAN-2026-11-13-flow-continuation-pilot.md](E2E-PLAN-2026-11-13-flow-continuation-pilot.md) |
| 3 | **新发现：宿主升级回归阻断试点**（FACT） | 宿主 18:17–21:45 升级 **0.2.2-rc.1→rc.3** × flow 插件 `session-executor.js` 仍按 rc.1 形状调 `startActivation` → 所有 session 节点 1ms `E_SESSION_START_FAILED`；两次真机失败 run（21:46 `R-m12-e2e-20261113-2146` + 探针 `R-m12-sop-2146`）；失败面仅插件旧形状路径，宿主 spawn 与本仓 `tree_*` 不受影响（doctor 7/7·v0.10.0 复验）。修复属 **flow 仓责任域**，本仓不改 flow 代码 | flow 仓 `probe-sop/PROBE-REPORT.md` §2、[REQ §附 A 复查 #4](REQ-2026-11-13-flow-node-continuable-session.md) |
| 4 | rc.3 回归跨仓跟进单（用户批准转交） | **成文**：现象/根因源码行号/影响面收敛/修复建议五条（spec 形状适配、调用形状回归测试、基线刷新、受控重载、验收三步）/时间线/证据索引；E2E 方案 P0 闸以 flow 侧 smoke PASS 为解除信号 | [FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md](FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md) |

## 3. 下一步候选（按建议优先级）

| # | 事项 | 为什么值得做 | 需要谁定 |
|---|---|---|---|
| 0 | ~~tree-engine 深度预算修复 + depth 6 真机回归~~ | **D22 修复（v0.8.1）+ D23 真机回归 PASS（v0.9.0，213/213 → 现 v0.10.0 225/225）** | — |
| 1 | ~~组合编排深挖（内层树现场创建 + maxDepth 边界）~~ | **D22 已完成** | — |
| 2 | **flow 节点续接（`flow_send` 冷恢复）+ flow×tree 混合回归 + flow 侧深度封口** | flow 侧 M1.2 离线交付已提交（`2918fba`/`13776bc`，kernel 287 · plugin 175）；T-1 探针 flow 路径 **BLOCKED**（rc.3 回归，见 §2.4-3）；T-6 真机未执行。**E2E 方案 v1.1（续接维 + 混合维）已获用户批准（P2 过）**，剩执行闸 P0（插件适配 rc.3 smoke PASS）+ P1（T-6）+ P4（夹具语义） | flow 项目组适配 rc.3（跟进单已交用户转交）+ T-6 收口；届时 D27 会话组队开测（flash 档） |
| 3 | ~~发布门禁再收紧 + flash 审计三条高危~~ | **D23 已完成（v0.9.0）**：真机 E2E 门禁写前强制 + 12 项检查实现（artifact 8 项 + CLI）；三条审计修复 + R1/R2 复核修复 | — |
| 4 | 只读子会话底部 Phase 2（chain 覆盖官方只读 composer） | 当前只读子会话元数据在标题栏 chip；用户未明确要求底部 | 仅用户要求时做 |
| 5 | 已知边界清理：artifact 验证对象错位、`runtime.history` 预算口径；D22 两项（`tree_log events` 可机读、现场建树验证归属）**D23 已完成**；**`tree_maintain gc` D24-2 已完成（archived 账本截断 + call-log 10MB 滚动）** | 历史欠账，非阻塞 | Lead 排期 |
| 6 | **batch2（约 24 条审计项）——已计划、暂不开工（用户 21:48 指示，等指令）** | 清单 = review-p2a-batch1 §三/§六 + P3-9；开工顺序建议 = P2-1 stale-done 窄窗 → P3-1 relay 自链重复 → P3-2/P3-5 gc 与滚动 → UNKNOWN-1/4 裁决 → P3-7~P3-11/P3-13 | 仅用户指令开工 |

**三个问题当前状态**：① 已做（v2 PASS + v3 深度回归 PASS）；② 需求单**已受理（B 档）**，M1.2 **离线交付已提交**（kernel 287 · plugin 175），T-1 探针 flow 路径被 rc.3 回归阻断、T-6 真机未执行——插件适配 rc.3 属 flow 仓下一修复项；③ 暂不对外（用户 2026-11-13 拍板）。

---

## 4. 风险与边界（FACT）

- 内层树预置是已知偏离（见 §3-1）；relay 42% 阈值在 D21 试点中未被压到（外层上下文约 4.1%）——relay 抗打断仍以 v0.8.0 E2E 为据。
- `provider-conformance` 依赖本机 `%TEMP%` rc.2 fixture：发布门禁已按「缺 fixture 记 SKIP、断言失败仍阻断」处理，但干净机器上等于未覆盖。
- 顶层记忆：真机操作类结论必须有活体读数/截图；UI 结论本轮已闭环（代码级 + 截图 + 用户确认）。
- D23 平台侧边界（非本仓可修）：HMR 重载竞态导致工具面瞬态 `unknown tool`；tree 派发跨模型 `maxTokens` 继承调用方（小上限供应商 400，当前绕行）。两者均已在 v3 报告 §6 记录，并升级为平台 issue 草稿（[①](ISSUE-draft-hmr-reload-race.md)、[②](ISSUE-draft-max-tokens-inheritance.md)，未对外提交）。
- flow 侧 M1.2 **真机未收口**前，不得引用 `flow_send` 为「可依赖」；本仓试点亦不得抢跑（详见 REQ §附 F）。
- **D27 新增（2026-11-13 21:5x）**：宿主 0.2.2-rc.1→rc.3 升级 × flow 插件未适配 → 所有 flow session 节点 `E_SESSION_START_FAILED`；在 flow 插件适配 rc.3 并重载 smoke PASS 前，**任何 flow run 的 session 节点都无法启动**，试点/联调一律不可行（证据：[REQ §附 A 复查 #4](REQ-2026-11-13-flow-node-continuable-session.md)、flow 仓 probe-sop/PROBE-REPORT.md）。另注：rc.3 上宿主自身 spawn 与本仓 `tree_*` 工具正常（doctor 7/7·v0.10.0）。
