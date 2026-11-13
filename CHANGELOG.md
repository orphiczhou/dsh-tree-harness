# Changelog

本文件记录本仓各包的重要变更：未发布变更归入 `Unreleased`，版本号取自各包 `package.json`，日期为北京时间。

## [Unreleased] — 2026-11-13 · D24：flow 侧受理回执（B 档）与跨仓口径同步（**无版本变更、未发布**）

### 变更

- **flow 项目组受理回执到达**（2026-11-13 16:21，flow 仓 `evidence/requirements/RECEIPT-2026-11-13-to-tree-harness.md`）：**已受理、用户裁决 B 档**——需求一采纳为 **`flow_send` 工具**（发起 `flow_run` 的父会话 → 该 run 节点会话，冷恢复 + 回读输出；**不提供**"节点结束不销毁/保持活句柄"驻留语义），需求二采纳且更正为「**不传 `maxDepth` = 完全不校验（无上限）**」，M1.2 起按 provider 能力感知传值 + fail-closed（`E_SESSION_DEPTH_EXCEEDED`）；排期 M1.2（3–5 人日，M1.1 之后）。
- **回执三处事实更正**（本仓文档已按此改写）：① 无 `startContinuable`（唯一启动 `startActivation`；续接 `subagents.sendMessage` → `coldResume`）；② `dispose()` ≠ 销毁会话（只释放驻留+槽位；可靠形态 = 保留 `sessionId` 冷恢复，前置目标子会话直接父 Agent 存活）；③ 深度配置值由工具层注入，插件直呼 `startActivation` 须自行 `resolveMaxDepth(...)` 后显式传。
- **本仓同步**：[REQ §附](docs/operations/REQ-2026-11-13-flow-node-continuable-session.md) 重写为受理跟进 + 回执摘要 + 三处更正 + 我方配合待办；[composition-playbook.md](docs/guides/composition-playbook.md) §4/§5/§6/§7/§9/§10 按回执 §3 口径改写（"非一次性"措辞作废，改为 `flow_send` 冷恢复 + 硬限制清单：父会话必须存活 / 续接轮无结构化 schema / 不写 journal / `flow_resume` 仍不续接原会话）；**未改 flow 仓代码**。
- **待办**：M1.2 落地后（a）按新口径补一次 tree→flow **续接**受控试点（调用方必须是发起 `flow_run` 的会话本身，跨会话不支持）；（b）向 flow 方取 `flow_send` 联调夹具（`evidence/m1/T-m1.2/`）。

### 验证

- 只读核查：flow 仓 `git log/status`、回执原文、`M1.2-intake-assessment-2026-11-13.md`（B 档选项/硬限制/更正）。
- 文档门禁：`check-doc-links` / `check-md-tables` / `check-version-consistency` 全绿。

## [Unreleased] — 2026-11-13 · D23：硬安全与可观测性收口（tree-engine 0.8.1 → **0.9.0**）

### 变更

- **版本**：`packages/dsh-tree-engine` `0.8.1` → **`0.9.0`**（仓内插件，非 npm 发布；`dsh-session-tree` 1.4.0 / `dsh-agent-introspect` 0.1.0 不变）。
- **flash 审计三条高危修复**（`docs/archive/flaudit-report.md` #1/#7/#19）：
  - **#1 跨进程写安全**：新增 `src/lock.js`（`tree-state.lock`，`fs.writeFile(..., {flag:'wx'})` O_EXCL 原子建锁 + 锁内容 `{pid,host,ts,nonce}` + release nonce 校验 + 陈旧锁 `rename` 抢占接管 + 接管留痕 `tree-lock-takeover.log`；超时 `E_TREE_LOCK_TIMEOUT`）；`src/store.js` 端口新增 `withLock`（fsStore=文件锁+心跳 `utimes`；memoryStore=每树 promise 链；旧实现兼容）；`src/engine.js` 拆 `withTree`（只读不加锁）/ `withTreeMut`（enqueue + withLock），18 个写命令与 `sweepTick` 全部改走持锁路径。
  - **#7 nudge 强制 prune 走状态机**：第 7 次 nudge 强制 prune 前 `assertTransition`；archived 叶子被拒（`E_STATUS_TRANSITION_INVALID`，抛错在 write 前，`nudge_count` 不持久化增加、无 drift）；`done→pruned` 白名单迁移照常并留 drift。
  - **#19 leaf:add 字段白名单**：仅接受 13 个允许键（`leaf_id/session_id/parent/path/role/added_by/relay/taskType/dependencies/brief/dod/model/channel`），白名单外键 `E_SCHEMA_INVALID`（含非法键名与允许清单）；`runtime/verification/status/events/milestones/segment_chain/drift_history/context_usage_pct/nudge_count` 等内部字段由引擎初始化、永不接受输入。
- **D22 两个次要发现修复**：
  - **`tree_log {action:"events"}` 机读化**：render 由「仅计数」改为一行一条（`[ts] leaf_id type meta=<紧凑 JSON>`），done meta 可机读；events 尾部 50 条 + 截断提示、单条 meta 800 字符截断；drift/heartbeat/communication 同步；返回结构不变。
  - **验证授权委托**：`tree_maintain` 新增 `action:"verify-delegate"`（`session_ids: string[]`，全量替换、`[]` 清空；仅树 root 会话可授予，root=null 拒绝）；被授权者**只能写 leaf.verification**（`LEAF_WRITE_MATRIX.verification.delegate=true`，其余 kind 一律 ❌；owner 自验禁令不放宽）；变更落 `drift_log`（kind=security/action=declare）；旧树缺字段惰性 `[]`。用于「现场建树 root 会话 dispose 后由受信会话补 `tree_verify`」。
- **R1 异族红队复核（Qwen 系）发现并已修复**：① **P1** `leaf:add` 对既存 `leaf_id` 直接覆盖 → 可擦除 archived/pruned 终态、done 事件与 drift 审计痕、重置 `nudge_count`（抵销 #7）；现 re-add 直接 `E_DUPLICATE_LEAF`（节点复用走 dispatch/set-session）；② **P2** `nudge:reset` 零鉴权（可 reset+nudge 循环使第 7 次永不落账）+ 工具面不传 caller → 现按 status 写权矩阵（owner/creator/root），越权 `E_BORROWED_IDENTITY`；③ **P2** root 信任锚可被 7-strike 强制摘除 → 现 root 叶子 nudge 拒 `E_SCHEMA_INVALID`；④ **P2** `model`/`channel` 未校验形状（可传任意 JSON 经 relay assignee 流入宿主）→ 现必须是字符串；⑤ **P2** 锁心跳间隔下限 1000ms，当 `staleMs<1s` 时活持有者可被判陈旧（双临界区）→ 现 `staleMs/3`（下限 100ms）。相应回归测试 +4（213/213）。R1 报告承认的残余风险：`rename` 抢锁与 release 间极窄竞态（窗口极窄、不改变缺省装配）、`brief/dod` 保留任意 JSON（用户内容）。
- **发布门禁收紧（W2.8）**：新增 `scripts/e2e/lib/release-gate.mjs`（纯函数、永不抛异常：8 项检查——artifact-found/schema/overall-pass/required-steps-pass/三断言/freshness，缺省新鲜度 168h）+ `release-gate.test.mjs` **14 例**；`scripts/release-all.mjs` 将门禁接在**任何写操作之前**（真实模式失败 exit 1 且零写入；dry-run 同跑、FAIL 记 BLOCKED 但 exit 0），新增 `--e2e-artifact` / `--max-e2e-age-hours` / `--skip-e2e-gate`+必填 `--skip-e2e-reason`（缺 reason exit 2）；`docs/guides/publishing.md` 新增 §5.2 强制门禁章节。R2 异族复核后补修 1 条 P1（JSON `null` artifact 抛 TypeError → 顶层形状 fail-closed）与 2 条 P2（无 UTC 戳文件不得遮蔽带戳 artifact；`collect-skills` 缺失 `missingSessions` 不再视为通过）。
- **受控试点 v3（任务 1 回归）**：`tree-engine v0.8.1` 深度上限真机回归 **PASS**——depth 5 worker 的 `tree_dispatch` 被宿主拒绝：`E_PORTS_PROTOCOL: ports.dispatch failed: subagent depth 6 exceeds maxDepth 5`；无 depth-6 会话；深度链 1..5、flow `T3C7-R1` succeeded/integrity=verified、`t3c7`/`t3c8`/`t3c9` validate 0 issues。配置 [demo/t3cpilot3/](demo/t3cpilot3/)，证据 [docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md](docs/reports/composition-pilot-v3-depth-cap-2026-11-13.md)。
- **文档**：tree-engine README（v0.9.0 节）、根 README（组件表/测试口径/Skill 版本）、[agent.md](agent.md)（D23 行 + 状态快照）、[engine-spec.md](docs/architecture/engine-spec.md)、随包 tree-commander/tree-worker SKILL（验证委托 / 日志机读 / 建点白名单 / 锁语义）、[composition-playbook.md](docs/guides/composition-playbook.md)（v3 深度实证 + 验证归属）、[skills-usage.md](docs/guides/skills-usage.md)、进度地图与项目地图口径。

### 验证

- `packages/dsh-tree-engine`: `node --test tests/*.test.js` → **213/213**（172 + 新增 store-lock 8 / nudge-gate 6 / leaf-add-whitelist 8 / tree-log-render 5 / verify-delegate 14 = 213；含 R1 复核回归 4 例）。
- `node --test scripts/e2e/lib/release-gate.test.mjs` → **14/14**；`node scripts/release-all.mjs --dry-run` 实测门禁 8 项 PASS（真实 artifact age≈14.8h ≤168h）。
- 活体（受控 disable→enable 后）：`tree_doctor` 7/7 · version=0.9.0；`tree_maintain {action:"verify-delegate"}` 授予→读回→清空 + `drift_log` security 记录；`tree_log events` 读出 done meta（`probe_result` 原文）；`tree-state.lock` 操作后无残留；`t3c7/t3c8/t3c9/d23x` validate 0 issues。
- 异族交叉复核：R1（Qwen 系，审 A1 审计修复）与 R2（GLM 系，审 tree_log/发布门禁），R2 结论 PASS_WITH_RISKS 的 1 P1 + 2 P2 已修复回归；详见本轮报告。

## [Unreleased] — 2026-11-13 · 组合编排 v2 试点 + 跨仓需求单（**无版本变更、未发布**）

### 变更

- **组合编排 v2 受控试点 PASS**（`tree→flow→tree` 完整版）：flow 节点在自身一次性会话内用 `tree_plan` **现场创建**内层树（`session_id`/`added_by` 自标识），深度链 **1→2→3→4→5** 由会话 header `delegationDepth` 逐条实证；flow `T3C3-R1` succeeded/integrity=verified；两树 `validate` 0 issues。配置入仓 [demo/t3cpilot2/](demo/t3cpilot2/)，证据 [docs/reports/composition-pilot-v2-live-create-2026-11-13.md](docs/reports/composition-pilot-v2-live-create-2026-11-13.md)。
- **发现（安全，待修）**：`subagent.maxDepth=5` 仅在模型工具 `subagent` 路径生效；tree 派发与 flow 节点会话未传 `request.maxDepth` → 深度 6 子会话被成功创建（非预期）。修复候选：tree-engine `dispatch` 传 `request.maxDepth`（候选 v0.8.1，未实施）。
- **跨仓需求单**：[REQ-2026-11-13-flow-node-continuable-session.md](docs/operations/REQ-2026-11-13-flow-node-continuable-session.md)（flow 节点 continuable + 深度上限），副本递交 flow 仓 `evidence/requirements/`；按用户指示**不修改 flow 仓代码**。
- **文档修正**：[composition-playbook.md](docs/guides/composition-playbook.md) §1 R4、§3（深度算术改为纪律口径 + 实测）、§5（剧本 C 状态与自标识通道）、§6（需求单入口）、§7、§9（新增 3 条边界）；进度地图标注 D22 与用户拍板结果。
- **packages 版本**：`dsh-tree-engine` 0.8.0 → **0.8.1**（深度预算修复，见下节）；`dsh-session-tree` 1.4.0 / `dsh-agent-introspect` 0.1.0 不变；未触发发布（镜像/npm 由 Lead 发布时执行）。

### 验证

- `tree_status {action:"validate"}` → `t3c3` / `t3c4` 均 **PASS (0 issues)**；外层两叶 `tree_verify run` **PASS**（self-report）；内层两叶 verify 因 creator 已结束被 `E_BORROWED_IDENTITY` 拒（报告 §6，验收用 runtime+validate）。
- `flow_status T3C3-R1` → succeeded / integrity=verified；journal `run/ended` 14 事件；深度探针 journal `T3C3-DEPTHNEG-1` 11 事件。

## [1.3.7] — 2026-11-12 · provider-conformance rc.2 fixture 解析（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.6` → **`1.3.7`**（公开镜像仓同步发布；**运行时/客户端代码无行为变化**）。
- **W2.2**：`test/provider-conformance.cjs` 改为显式 fixture 解析（CLI 参数 → `DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`）；缺 fixture / 非 rc.2 布局时**以 exit 2 + 可操作报错退出**（此前为崩溃堆栈），正常路径 29/29；断言数量与语义未改。
- 包内 README（中/英）与 `AGENT-INSTALL.md` 版本引用同步到 `v1.3.7`（快照行、pin 示例）。

### 验证

- `node test/provider-conformance.cjs` → **29/29 PASS, exit 0**（fixture 来源与 SHA-256 见 [docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md)）；handoff **41/41**、skills **3/3**、render 全绿、style-guard 22/22、verify-bundle 0 fail。
- 发布：`release-plugin.mjs` 同步公开镜像仓（`files=19 match=19`），tag **v1.3.7 = `91c177e`**（main+tag=本地；`ls-remote` 核对通过）。

## [1.3.6] — 2026-11-12 · 文档归档 + 人类/Agent 安装指南（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.5` → **`1.3.6`**（公开插件仓同步发布；代码无行为变化）。
- **文档按目录归档**：`docs/` 重构为 `architecture/`（架构/规格）、`guides/`（安装/使用/发布）、`operations/`（当前交接/运维）、`reports/`（一次性报告，`<类型>-<主题>-YYYY-MM-DD.md`）、`archive/`（冻结历史）；新增 [docs/README.md](docs/README.md) 作为**单一索引 + 归档规范**；项目地图 HTML 保留在 `docs/` 根保证 GitHub Pages URL 稳定。
- **新增人类安装指南** [docs/guides/install-guide.md](docs/guides/install-guide.md)：三条安装路线（Git 镜像仓 / 本地 monorepo 全栈 / 市场）、组件矩阵、重载语义、验收与升级卸载。
- **新增 AI Agent 安装指南** `packages/dsh-session-tree/AGENT-INSTALL.md`（随包发布到镜像仓）：决策树、两条安装路线、profile 安全规则、重载语义表、7 项验收清单、升级/卸载/回滚、排障矩阵、回报模板。
- README（根 / 包内中英）补「安装路线选择」与 Agent 指南入口；`package.json.files` 纳入 `AGENT-INSTALL.md`（镜像仓文件数 18 → **19**）。
- 文档内所有相对链接随迁移重写（新增 `scripts/check-doc-links.mjs` 做常驻校验）。

### 验证

- `node scripts/check-doc-links.mjs`（LINK CHECK OK）、`node scripts/check-md-tables.mjs`（TABLE CHECK OK）。
- session-tree 测试入口保持全绿：handoff **41/41**、skills **3/3**、render 全绿、style-guard 22/22、verify-bundle 0 fail；tree-engine **84/84**。
- 发布：`release-plugin.mjs` 同步公开镜像仓（`files=19 match=19`），tag **v1.3.6 = `298298d`**（main+tag=本地）。

## [1.4.0] — 2026-11-12 · tree_send 同树收紧（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` `1.3.7` → **`1.4.0`**（安全收紧；**已发布公开镜像 tag `v1.4.0` = `0343f0c`，main+tag，21/21 SHA**）。
- **Q4 安全收紧**：`tree_send` **移除 `parent` 入参**（显式传报 `E_PARENT_REMOVED`）；target 的直接父地址只由 Host 从会话日志 `header.parentSession` 解析；caller 取 ambient `exec.agent.session.id`（绝不来自 args）；target/caller 父链各自走到根，**同根才投递**——跨树 `E_CROSS_TREE_SEND`、caller 缺失 `E_CALLER_REQUIRED`、self `E_SEND_TO_SELF`、谱系读不到 `E_LINEAGE_UNRESOLVED`（全部 fail-closed）。同树内跨层/兄弟消息保留。
- 测试：新增 `test/tree-send.test.js` **25 例**；handoff **41/41**、render 151/151 + 9/9 + 11/11、skills 3/3、style-guard 26/26、verify-bundle 0 fail。
- 活体（Lead 真机探针）：同树投递放行（queue 到 leaf）、跨树 `E_CROSS_TREE_SEND`、显式 parent `E_PARENT_REMOVED`、root 目标 `is not a subagent session`、self `E_SEND_TO_SELF`；`include:session-tree` disable→enable 后生效。
- 包内 README / AGENT-INSTALL / SKILL 同步（无 `parent`、仅同树、错误码）。
- **会话界面元数据（纯 client 半，0 host 改动；方向修正）**：**不在左侧树显示**；在会话详情页底部 `conversation.composer.dock` 追加 `SessionMetaStrip`，对**子会话**显示 **`model · effort · NN%`**（官方 ModelSelect 对所有子会话隐藏、continuable 子会话原本无 model/effort；pct 与官方 ContextMeter 同口径）；只读子会话（one-shot/未知模式/父离线）的 composer 被官方替换、无会话级底部 slot → 用 `conversation.session.header.utilities` 的 `SessionMetaChip` 兜底（标题栏右侧，平台能力边界）；root 会话两面均不渲染，保留官方 ModelSelect/ContextMeter。
- 测试：`render.test.cjs` **133 → 151**（+18：dock/chip 组件/注册/隐藏/树行无元数据）、`meta.test.cjs` **41**（metaOf 边界 + selectReadOnlyMeta 全分支）、`style-guard.cjs` **22 → 26**；handoff 41/41、tree-send 25/25、skills 3/3、verify-bundle 0 fail 全绿。
- 发布：2026-11-13 `node scripts/release-all.mjs --push` 成功——包 `@orphiczhou/dsh-session-tree@1.4.0` 同步 **21/21 SHA**；本仓发布提交 **`d8b9f7c`**（已推送）；镜像提交 + tag **`v1.4.0` = `0343f0c`**（main+tag 已推送）；两侧 `ls-remote` 核对通过。
- 人工验收（2026-11-13 01:07）：用户重启 DSH 后反馈“看到参数了”（会话元数据 UI 以用户反馈为准）；细节由新会话复核。

## [Unreleased]

### 2026-11-13 · 真机证据收口（工具链；包版本无变化）

**执行证据（无代码变更）**

- **真机三断言首次实际执行并 PASS**：`scripts/e2e/run-release-e2e.mjs` → `verify-handoff` **12/12**、`verify-kickoff-language` zh、`collect-skills` 1/1（汇总 artifact `scripts/e2e/artifacts/release-20261112T171827Z.json`）。报告：[docs/reports/e2e-release-three-assertions-2026-11-13.md](docs/reports/e2e-release-three-assertions-2026-11-13.md)。
- **tree→flow→tree 三层受控试点 PASS（受控范围）**：外层树 `t3c1` commander（`relay=off`）同步跑 flow `T3C1-R1`（integrity=verified，139.8s），flow 节点在内层树 `t3c2` 派发 commander→worker 并收口；两树 `validate` **0 issues**、深度链 max=4、总耗时约 179s、无 depth/cancel 错误。试点配置入仓 [demo/t3cpilot/](demo/t3cpilot/)；报告：[docs/reports/composition-pilot-tree-flow-tree-2026-11-13.md](docs/reports/composition-pilot-tree-flow-tree-2026-11-13.md)。

**工具链变更**

- **修复 `verify-handoff.mjs` 的英文-only 接替提示识别**（2026-11-13 真机首跑暴露：中文界面下 `handoff_prompt_present` / `handoff_prompt_names_source` 假 FAIL）。新增语言无关模块 `scripts/e2e/lib/handoff-prompt.mjs`（`HANDOFF_PROMPT_PATTERNS` zh/en + `analyzeHandoffText` / `analyzeHandoffPrompt`），`verify-handoff.mjs` 改为消费该模块并在报告/断言 actual 中附 `language`；新增 `scripts/e2e/lib/handoff-prompt.test.mjs` **6 例**单测（zh、en 不回归、zh 兜底 origin、普通消息不误判、半截措辞、600 字符截断）。**session-tree 包内容未变，不 bump 版本。**
- **`release-all.mjs` 发布测试门禁 5 → 9 条**：补入 `test/meta.test.cjs`、`test/tree-send.test.js`、`test/provider-conformance.cjs`，并新增工具链回归 `scripts/e2e/lib/handoff-prompt.test.mjs`（cwd = 仓库根）；测试条目支持 per-entry `cwd`；`provider-conformance` 标注为环境依赖——缺 rc.2 fixture 时 `exit 2` 记 `[SKIP]` 不阻断发布，`exit 1` 仍阻断。dry-run 计划行显式标注环境依赖与仓库根 cwd。

**验证**

- 9 条测试实跑：handoff 41/41、skills 3/3、style-guard 26/26、render 151/151+9/9+11/11、meta 41/41、tree-send 25/25、provider-conformance 29/29（rc.2 fixture）、verify-bundle 0 fail、handoff-prompt 6/6 —— 全部 exit 0。
- `node scripts/release-all.mjs --dry-run --mirror-dir <镜像 checkout>` → exit 0（v1.4.0 no-op、21/21 SHA 一致、测试计划 9 条）；`node scripts/check-version-consistency.mjs` → 23 checks OK。

### 2026-11-13 · D22 深度预算修复（tree-engine v0.8.1）

**`packages/dsh-tree-engine`（`0.8.0` → `0.8.1`）**

- **新增 `max_subagent_depth` 配置**（`src/guards.js` 缺省 **5** + `src/config.js` 键校验 1–100；`TREE_ENGINE_CONFIG` 可覆盖，非法值装载期失败含键名），并随 `audit_meta` 持久化。
- **派发/竹节接力/攻击审计会话显式传 `request.maxDepth`**：`src/engine.js` 的 `dispatch:start` 与 bamboo relay 的 `ports.dispatch` spec 均带 `maxDepth`（接力不绕过上限）；`index.js` 的 `startChildSession` 改用新增纯函数 `src/compat.js#buildStartRequest` 生成宿主请求（`maxDepth` 缺省不产生该字段、非法值 fail-closed）；`runAttackSession` 走同一构造。
- **背景/证据**：D22 三层组合 v2 真机实测——深度 5 的 worker 再起子会话（应为 depth 6）**未被拒**；asar 实证宿主 `dsh-subagent` 仅在调用方显式传 `request.maxDepth` 时校验（`lib/index.js:1402/1405`；`resolveMaxDepth` 只给模型工具用）。报告：`docs/reports/composition-pilot-v2-live-create-2026-11-13.md` §5。
- **测试**：新增 `tests/depth-budget.test.js`（4 例：缺省 5 / 配置覆盖 + audit_meta / relay 同样携带 / 配置非法值拒绝）；`tests/compat.test.js` 11 → 14 例（`buildStartRequest` 三种形态）。全量 `node --test tests/*.test.js` = **172/172**（20 个 `.test.js`）。
- **文档**：包 README `v0.8.1` 节；两份 SKILL 头部版本引用；根 README 组件行与验证块、`docs/README.md` 快照、`docs/guides/skills-usage.md`、`docs/project-map-2026-11-11.html` 当前口径、`agent.md` D22 行与状态快照同步。
- **边界（不在本包修复）**：flow 节点会话的 spawn 由 flow 引擎执行器发起（同样未传 `maxDepth`），按用户指示写成跨仓需求单（`docs/operations/REQ-2026-11-13-flow-node-continuable-session.md` §9）。

### 2026-11-12 · 组合编排 P0/P1 修复（tree-engine v0.8.0）

**`packages/dsh-tree-engine`（`0.7.0` → `0.8.0`）**

- **P0-A per-leaf relay 开关**：`tree_node` 新增 `action:"set-relay"`（`relay: "auto"|"off"`，缺省 auto，持久化 `leaf.relay`）；`off` 时 `sweepTick` 只跳过竹节（不 promptHandoff/interrupt、不改 runtime.state/owner/segmentChain），超时硬截止与 done 回流语义不变；写权 creator/root（owner 不得自关），越权 `E_BORROWED_IDENTITY`。背景：S1 真机实测 v0.7.0 的 relay 会打断运行中的 flow（journal `cancelled / E_RUN_CANCELLED`）。
- **P0-B usagePct 端口修复**：新增 `src/token-meter.js`（`resolveTokenMeter` 逐路径独立 try；`extractUsagePct` 支持 `pct/contextPct/context.pct/pressure.pct/usage.pct`、0-1 归一、0-100 截断、非法 null）；修复原 `services.tokenMeter` 未 inject 即抛错导致测量恒 null 的缺陷；成功时首次打印 `tokenMeter.measure shape:`。
- **P1-C sweep 跨实例生命周期**：新增 `src/sweep.js`（`globalThis[Symbol.for('dsh-tree-engine.sweeps')]` 按 dataDir 键；新 apply 先停旧实例、stop 幂等、异常不吞）+ `index.js` 挂 `ctx.on('dispose')`；热更不再留下僵尸 sweep（实测 reload 日志 `previous sweep disposed (hot-reload zombie)`）。
- **P1-D relay parent 安全重解析**：relay dispatch 带持久 `parentSessionId`，缓存未命中经 `agents.get` 安全重解析，失败保持 `E_PORTS_PROTOCOL`。
- **版本/文档**：包 README v0.8.0 节；两份 SKILL **v2.2**（补 relay 开关用法）；测试 **112 → 165/165**（19 个 `.test.js`；新增/更新 relay 12 + token-meter 17 + usage-port 7 + validate 9 + sweep 8）。
- **独立真机 E2E**（`docs/reports/e2e-relay-switch-2026-11-12.md`）：relay:'off' 下长 flow（315.4s）穿越 ≥5 次 sweep 不被中断（PASS）；auto 回归（timer + harvest 两条路径）复现 `cancelled / E_RUN_CANCELLED`（PASS）；set-relay 权限正负例 PASS；v0.8.0 sweep 注册表每次 apply 均 `previous sweep disposed`（PASS；升级前旧僵尸需重启 DSH 清除）。
- **E2E 发现的三个缺陷收口**：F1 validate 对已接力 leaf 假阳性 `session_duplicate`（修：当前 session 在自身 chain 中合法）；F2 `tree_status validate` 被 `toError` TypeError 掩盖 issues（修：`queryResultToTool` 原样返回 + render 展示）；F3 `tokenMeter.measure()` 入参契约不匹配（修：改用活 Session + `contextPressure`/`measure` 双读面；活体 apply.log 已出现 `tokenMeter.measure shape:`）。
- **活体**：`include:tree-engine` disable→enable 后 `tree_doctor` 7/7 PASS · version=0.8.0；独立 E2E 见 `docs/reports/e2e-relay-switch-2026-11-12.md`。

### 2026-11-12 · Wave 2 收口（tree-engine v0.7.0 + 工具链/发布流程）

**`packages/dsh-tree-engine`（`0.6.0` → `0.7.0`）**

- **W2.1 会话预算计入竹节链**：`max_sessions` 计数集合补 `leaf.runtime.segmentChain`，与 `leaf.session_id` / `leaf.segment_chain` / `session_registry` 合并后按归一化会话 id 去重（`src/guards.js`）；`src/engine.js` 的 `validate` 同步纳入 `runtime.segmentChain`（跨集合重复检查）。
- **W2.3 RC2 兼容层抽离 + 单测**：`startContinuable` / `startActivation` 双形探测的纯逻辑抽到 `src/compat.js`（`index.js` 装配）；新增 `tests/compat.test.js` **11 例**，不引入宿主依赖。
- **W2.6 root/主会话会话 id 归一化**：DSH 根/主会话 id 带 `session-` 前缀、被派发子会话为裸 UUID v4；引擎**写入侧**归一化（剥前缀、小写、存裸 UUID 规范形），**比较侧** `normalizeSessionId` / `sameSession`（`src/guards.js`）接入 `added_by` / owner / caller 校验。`tree_plan` / `tree_node add` / `tree_report` 直接传 `$env:DSH_SESSION_ID` 即可。**UUID v4 严格性不放宽**（归一化后非 v4 仍 `E_INVALID_UUID_STRICT`）；历史带前缀旧值可读。活体：修复前 root 会话 `tree_plan` 带 `session-` 前缀 → `E_INVALID_UUID_STRICT`；修复后同一调用成功、root 存裸 UUID、`tree_node add` 混合形态 `added_by` 可用。
- 测试：`node --test tests/*.test.js` **84 → 112/112**（14 个 `.test.js`：62 引擎 + 4 技能打包 + 1 B1 回归 + 9 `tree_doctor` + 8 写面护栏 + 11 compat + 10 identity + 7 budget；新增 `tests/budget.test.js` 7 例、`tests/identity.test.js` 10 例）。
- 随包 SKILL 同步到 **v2.1 / 随 tree-engine v0.7.0**（9 个 `tree_*` 工具、`session-` 前缀归一化说明、`max_sessions` 计入竹节链）；`src/doctor.js` 版本提示串与 `index.js` 启动日志（v0.7.0）同步。

**工具链 / 脚本**

- **W2.2** `packages/dsh-session-tree/test/provider-conformance.cjs`：显式 fixture 解析（`DSH_RC2_FIXTURE_DIR` → `%TEMP%\dsh-asar-inspect\out-rc2-compat` → `out`），缺 fixture 时 **exit 2 + 可操作报错**；得到 **29/29**（session-tree 包本体 v1.3.6 不变）。
- **W2.4** 新增 `scripts/check-version-consistency.mjs`（只读）：**23 checks**（package.json / `TOOLS` 导出与工具名 / 3 份 SKILL frontmatter / 根 README、`agent.md`、`docs/README.md`、`docs/guides/skills-usage.md` 的版本、工具数与测试数、包 README、CHANGELOG、项目地图）；支持 `--json` / `--run-tests` / `--root`；故障注入可 FAIL 自证。
- **W2.5** 新增 `scripts/e2e/run-release-e2e.mjs`：发布前三条真机断言（`verify-handoff` / `verify-kickoff-language` / `collect-skills`）统一编排、PASS/FAIL 汇总、artifacts 落盘（`scripts/e2e/artifacts/release-<ts>/`），支持 `--replay` 离线复核既有 artifact（**不替代真机断言**）。
- **W2.7** 新增 `scripts/release-all.mjs`：预检 → `release-plugin` 同步/SHA 对账 → 本仓 commit → 镜像 commit/tag → `ls-remote` 核对；**默认 dry-run**，`--apply` / `--skip-push` 走本地全链路，`--push` 才联网写远端；失败即停并给回滚提示。

**文档 / 报告**

- 新增报告：[docs/reports/conformance-rc2-2026-11-12.md](docs/reports/conformance-rc2-2026-11-12.md)、[docs/reports/e2e-release-runner-2026-11-12.md](docs/reports/e2e-release-runner-2026-11-12.md)、[docs/reports/release-automation-2026-11-12.md](docs/reports/release-automation-2026-11-12.md)；收口报告 `docs/reports/wave2-closeout-2026-11-12.md`。
- 文档口径统一到 tree-engine **v0.7.0 / 9 工具 / 112-112**：`agent.md`（D17 / §2 快照 / §3 R13–R14 / §4.2 任务板 / §7）、`docs/README.md`（快照 + engine-spec 修订说明 + reports/archive 索引）、`docs/guides/skills-usage.md`（版本、预算与 id 口径）、`docs/operations/wave2-plan-2026-11-12.md`（执行状态表）、`docs/architecture/engine-spec.md`（§5 后**追加** v0.7.0 修订段，不重写冻结正文）。
- W2.8 GUI 迭代规范 [docs/architecture/session-tree-ui.md](docs/architecture/session-tree-ui.md)（已在 `e09f39b` 建立）7 步流程现行；新交接 `docs/operations/handoff-2026-11-12.md`，旧 `handoff-2026-11-11.md` 归档。

**未发布说明**

- `packages/dsh-session-tree` **1.3.6 → 1.3.7**（W2.2 测试适配；公开镜像 tag `v1.3.7` = `91c177e`，19/19 SHA）；运行时行为不变，包内测试入口全绿（handoff 41/41、skills 3/3、render 133+9+11、style-guard 22/22、verify-bundle 0 fail、provider-conformance 29/29）。
- **本轮无 npm 动作**（D3 冻结）；**已执行**：本仓 `master` 推送（Wave-2 三笔提交 + 本发布记录提交）+ 公开镜像 **v1.3.7** 发布（`release-plugin` 19/19 SHA、tag `91c177e`、`ls-remote` 远端=本地）。`release-all.mjs` 本轮以 dry-run/沙箱演练验证（真推走既有手工流程）；`run-release-e2e.mjs` 的真机三断言本体待发布前人工触发。

### 变更

- **移除已废止的 meta-loop 插件及其资料（与本项目无关）**：删除 `packages/dsh-meta-loop/`、`demo/metalp/`、`docs/meta-loop-design.md`、`docs/meta-system-argument.md`；并从 `README.md`、`agent.md`、`docs/guides/publishing.md`、项目地图等当前材料中清除该插件信息。本项目组件口径 = `dsh-tree-engine` + `dsh-session-tree` + `dsh-agent-introspect` 三个包。
- 项目全景地图（`docs/project-map-2026-11-11.html`）提升为 GitHub 项目介绍入口：README 标题区新增入口段，`agent.md` 开工顺序新增同一链接。
- **tree-engine `0.5.1` → `0.6.0`：新增只读自检工具 `tree_doctor`（第 9 个工具）**。`src/doctor.js` 纯逻辑 + `index.js` 注册；7 项检查（`package` / `tool-count` / `skills` / `tree-data` / `stale` / `sweep` / `env`），每项 `{id, status: PASS|WARN|FAIL, detail, hint?}`；返回 `summary{pass,warn,fail}` + 一行 `hint`，传 `tree_id` 时额外校验树并统计停滞节点。**只读零写副作用**（不写树状态/日志），**FAIL 不 throw**（诊断器不是门禁；只有非法 `action` 抛错）。治「工具或 Skill 为什么没出现」只能靠猜。`tests/doctor.test.js` 9 例。
- **leaf 写面护栏统一（P1-05）**：`src/guards.js` 新增 `LEAF_WRITE_MATRIX` + `assertLeafWriter(caller, leaf, kind)`，并接入 `set-context` / `set-verification` / 非 done `event` / `dispatch:cancel` / `status` / `set-session` 六类写操作；非授权统一 `E_BORROWED_IDENTITY`（未知 kind fail-closed；缺失 caller 不再放行）。矩阵：context=owner/root、verification=creator/root、event(done)=owner only、event(其它)=owner/creator、cancel=owner/creator/root、status=owner/creator/root、set-session=creator only。`tests/write-guards.test.js` 8 例负例/回归；`index.js` 同步补 `tree_verify` 落账的真实 caller 接线。
- **口径刷新（文档与项目地图）**：根 `README.md`、`agent.md`、`docs/guides/skills-usage.md`、本 CHANGELOG 与 `docs/project-map-2026-11-11.html` 统一到 **tree-engine v0.6.0 / 9 个 `tree_*` 工具 / 84-84 测试**；HTML 的工具面图新增 `tree_doctor` 卡片、写面护栏由「缺口」改为「已实现」、§9 把 doctor 与护栏标记为 **Wave 1 已完成**，并保持单文件离线（0 `<script>` / 0 `<link>` / 无 http 资源）。

### 验证

- `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **84/84**（62 引擎 + 4 技能打包 + 1 B1 回归 + 9 `tree_doctor` + 8 写面护栏）。
- `packages/dsh-session-tree`：handoff **41/41**、skills **3/3**、render 全绿（133/133 + 9/9 + 11/11）、style-guard **22/22**、verify-bundle **0 fail**。
- 文档表格门禁：`node scripts/check-md-tables.mjs README.md agent.md CHANGELOG.md docs/guides/skills-usage.md docs/operations/handoff-2026-11-11.md docs/project-map-2026-11-11.html` → Tables OK。
- 版本与测试数字为 2026-11-11 工作树实测；本次改动**未提交 git**。

## [1.3.5] — 2026-11-11 · 第三轮洁净室收尾（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.4` → **`1.3.5`**（公开插件仓同步发布；代码无行为变化）。
- `session-handoff` SKILL §0 补充例外说明：低于 50% 会被阈值闸拒，**但 `spawn:false` 干跑不被拦**（5 分钟内重复仍受防重复闸）。
- README（英文）修正 root→grandchild 表述：拒绝原因是「调用者不是目标的直接父会话」，不再写成「D 不是那个父会话自己的孩子」。

### 验证

- handoff **41/41**、skills **3/3**；其余测试无改动。
- 洁净室第三轮：**PASS**（N1–N7 全部确认修复、G1–G12 无回归、5 分钟路径 5/5），见 [docs/reports/skill-cleanroom-2026-11-11.md](docs/reports/skill-cleanroom-2026-11-11.md)。

## [1.3.4] — 2026-11-11 · 洁净室最终文档清扫（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.3` → **`1.3.4`**（公开插件仓同步发布；代码无行为变化，内容 = README/SKILL 文案与语言验收表述修正）。
- **R1-B / R2-B 文档债清扫**：
  - README（中英）语言验收表述修正：`status`/`handoff` 的 `lang=` 与 `interface_language` 可直接断言；独立 `verify-kickoff-language.mjs` 会**解码接替会话首条消息**（此前误写为「无需解码」）。
  - `session-handoff` SKILL：`set-session` 重绑主体改为「leaf 的 creator/上级（通常是父 commander）」——交接者无权重绑自己的 leaf。
  - `docs/guides/skills-usage.md`：新增 profile 修改备份警示；`tree_plan` 样例补 `session_id` 并对齐 `root_dod` 字段；worker 验收改为「commander 跑 verify」；竹节等待原因改为「链满 frozen / 简报回收失败 / 已非 running owner」；补版本差异速查（1.3.0→1.3.3）；`collect-skills.mjs` 自检命令补 `--expect`；patch YAML 改为真实行并注明「无需手抄」。
  - `tree-commander` / `tree-worker` SKILL：补英文触发词；版本头 `v0.5.1`；旧 `sweep:degraded:no-timer` 日志串改为中性描述。
  - 根 README / `docs/operations/handoff-2026-11-11.md` / `docs/guides/publishing.md` / `docs/architecture/session-handoff-2026-11-11.md` / `agent.md`：版本矩阵清扫到 v1.3.4/cce2975 链、测试入口 6 个、历史 `v1.0.4`/`3 份 cjs` 残留修正。
- `packages/dsh-tree-engine` 仍为 **0.5.1**（SKILL 勘误，含英文触发词；代码无变化）。

### 验证

- handoff **41/41**、skills **3/3**、render/style-guard/verify-bundle 全绿；tree-engine **67/67**。
- 洁净室第三轮独立复核见 [docs/reports/skill-cleanroom-2026-11-11.md](docs/reports/skill-cleanroom-2026-11-11.md)。

## [1.3.3] — 2026-11-11 · `spawn:false` 干跑不被阈值闸拦 + 洁净室二轮修订（session-tree）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.2` → **`1.3.3`**（公开插件仓同步发布）。
- **行为修正**：`session_handoff {action:"handoff", spawn:false}` 现在**不受 below-threshold 阈值闸拦截**——它是只写交接文件的干跑，低于 50% 也应能产出预览 recap；防重复闸（5 分钟）仍生效。此前阈值闸先于 `spawn:false` 分支，导致新会话按文档单发 `spawn:false` 会被误拒（洁净室二轮 N1，中等严重度）。`force:true` 语义不变（既绕阈值闸，也会真正启动接替会话）。
- 测试：handoff 由 40 → **41** 用例（新增「spawn=false 在阈值以下也能只写文件」）。
- **洁净室二轮其余修订**（N2–N7）：README 中英例题改为中性路径（不再出现 monorepo `packages/`/`docs/`）、去掉与「无插件市场」自相矛盾的 marketplace 问题；SKILL 的 status/handoff 渲染样例补 `lang=zh` 段、去掉过期测试数字；`package.json.files` 补 `README.zh.md`（npm 分发时中文版不丢失）；tree_send 示例路径中性化。

### 验证

- `test/handoff.test.js` **41/41**；skills 3/3、render/style-guard/verify-bundle 全绿。
- 洁净室二轮（v1.3.2 基线）：公开插件仓 12/12 项修复 ✅、无新增死链；本版修掉其 N1–N7 后进入第三轮独立复核。

## [1.3.2] — 2026-11-11 · Skill 使用文档补全（session-tree，洁净室评审修订）

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.1` → **`1.3.2`**（公开插件仓同步发布；代码无行为变化，内容 = README/SKILL 文档与打包回归）；`packages/dsh-tree-engine` **0.5.0 → 0.5.1**（SKILL 勘误，代码无变化，未单独发布）。
- **洁净室第二轮前修订（tree-engine SKILL 勘误，v0.5.1）**：`tree-commander` §3.1 与 `tree-worker` §1/§4.3 的竹节 owner 说法统一为「v0.5.0 起自动重绑给接手会话」（与实现及 §1.3/§3.3 一致）；交接样例路径通用化（不再引用 monorepo 内部路径）；`session-handoff` SKILL 的跨包引用标注归属。
- **根 README / handoff 文档勘误**：`已知边界` 的 sweep 降级说法改为「进程内 60s 兜底、sweepMode=timer」；`docs/operations/handoff-2026-11-11.md` 的版本/测试数/热更口径刷新到 v1.3.2 + 67/67，补第四/五轮摘要；`docs/guides/skills-usage.md` 补 tree-engine 可复制安装命令（clone + hmr.root + link + pnpm + reload）。
- **公开插件仓 README（中英）补全「使用随包 Skill」要素**（洁净室第一轮评审缺口 G1–G12）：
  - 新增 handoff **调用样例 + 参数表**（`summary` 必填；`next_steps` / `files` / `open_questions` / `note` / `kind` / `spawn` / `threshold_pct` / `force`）与一行预期返回；
  - 新增**冒烟测试**说明（新会话 `below-threshold`、`force` / `spawn:false`、5 分钟 `recent-handoff` 都是预期而非故障）；
  - 明确 `@deepseek-ai/dsh-skill-filesystem` **随桌面版内置**、Skill 目录在**会话启动时注入**（需新开会话）；
  - 从 <1.2.0 升级：先停用独立 `@local/dsh-session-handoff` bundle，避免同名工具/Skill 遮蔽；
  - 指向源码仓的脚本改为**绝对链接**（`collect-skills.mjs`、`verify-kickoff-language.mjs`、`docs/guides/skills-usage.md`），不再声称脚本在本插件仓内；
  - 顶部加版本与特性时间线（v1.3.0 Skill / v1.3.1 语言 / v1.3.2 文档）；功能表 `lang=zh\|en` 管道转义修复；SKILL.md 改为直链；Dev 文件树补 `test/skills.test.cjs`；疑难排查补充「Skill 在目录但不用它」「升级后行为仍旧」两条。
- **`session-handoff` SKILL.md**：frontmatter 补英文触发词（continue / running out of context / hand off to a fresh session / around 50 percent / handoff）；§3 样例路径改为通用示例（不再引用 monorepo 内部路径）；§8 注明 `tree-commander` / `tree-worker` 由 `@local/dsh-tree-engine` 提供、不在本包。
- **`docs/guides/skills-usage.md`**：适用版本升到 1.3.2；新增「§3.1 五分钟冒烟」；修正 `dsh-session-tree` 名称与升级建议。

### 验证

- `packages/dsh-session-tree/test/handoff.test.js` **40/40**、`test/skills.test.cjs` **3/3**、render/style-guard/verify-bundle 全绿（文档变更后复跑）。
- 洁净室评审：两个独立子会话（无本会话上下文）分别评审公开插件仓与本仓文档；本版按第一轮缺口修订，第二轮由**新的**独立子会话复核（结果见发布记录与 `docs/reports/skill-cleanroom-2026-11-11.md`）。

## [1.3.1] — 2026-11-11 · 交接提示语跟随 DSH 界面语言（session-tree）

### 新增

- **接替提示语本地化**：`session-handoff` 生成的接替会话首条消息不再固定英文，改为读取 DSH 界面语言（Settings → General → Language，即 profile 中 `locale` 条目的 `locale.preference`）。
  - 来源优先级：① 活体 Loader 的 `locale` 条目（`options.config.preference`；volatile 引用经 `get()` 展开；按包名 `@deepseek-ai/dsh-client-locale` 兜底查嵌套条目）→ ② profile `cordis.patch.yml` / `cordis.yml`（`DSH_PROFILE_DIR` 优先，否则用宿主进程 cwd——实测宿主 cwd 即 profile 目录）→ ③ 英文回退。
  - 语言归一化：`zh*` → 中文提示语；`en*` → 英文；其它已存语言与无偏好 → 英文（与 DSH 自身 fallback 一致）。
- `status` / `handoff` 返回对象新增 `interface_language`，渲染行尾新增 `lang=zh|en`；交接文件 `## Successor instructions` 块与提示语同语言（正文其余章节保持英文规范格式）。
- 新增验收脚本 `scripts/e2e/verify-kickoff-language.mjs`：解码接替会话日志首条 `user/message`，判定语种并断言（`--expect zh|en`）。
- 新增真机证据报告 [docs/reports/e2e-kickoff-language-2026-11-11.md](docs/reports/e2e-kickoff-language-2026-11-11.md)（修复前 `lang=en` 基线 → 修复后 `lang=zh` + 接替首条中文 PASS）。
- 新增用户向完整指南 [docs/guides/skills-usage.md](docs/guides/skills-usage.md)：三个随包 Skill 的安装、发现、最小提示词、三层任务树、50% 交接、语言与排障。

### 变更

- 版本：`packages/dsh-session-tree` 由 `1.3.0` → **`1.3.1`**（公开插件仓同步发布）。
- 测试：`packages/dsh-session-tree/test/handoff.test.js` 由 34 → **40** 用例（新增：Loader 偏好 zh-CN、volatile 引用、ja 回退、无偏好英文、`DSH_PROFILE_DIR` profile 文件、`process.cwd()` profile 文件）；测试在模块加载时清除并恢复 `DSH_PROFILE_DIR`，避免开发者本机 profile 污染「无偏好」用例。
- 文档：两包 README 增补「接替提示语语言」与随包 Skill 使用步骤；`skills/session-handoff/SKILL.md` 增补首条消息语言说明与验收口径；`docs/architecture/session-handoff-2026-11-11.md` §5.1 增补 `interface_language`/语言解析说明。

### 验证（真机）

- 修复前（旧实现，2026-11-11 17:36）：验证子会话 `9cb372fb…` 的 status/handoff 渲染行均 `lang=en`；接替 `f5aa22f7…` 首条消息英文 → `verify-kickoff-language --expect zh` **FAIL**（基线）。
- 修复后（17:38 起）：同一流程 status/handoff 均 `lang=zh`；接替 `ca7e834f…` 首条消息中文（含交接文件绝对路径）→ `verify-kickoff-language --expect zh` **PASS**；交接文件 `## Successor instructions` 为合法 UTF-8 中文。
- 离线：handoff **40/40**；真机独立复核（由接替会话 `f5aa22f7…` 自行读取日志复算）确认两轮结论与上述一致。

### 已知边界

- 仅提供 `zh` / `en` 两套提示语文案；DSH 内置的 ja/es/fr/de/ru/pt 已存语言回退英文。
- 中文提示语之后仍可能跟一段英文的框架后缀（`Your parent agent id is …`，由 `@deepseek-ai/dsh-subagent` 的 continuable 子会话装饰生成，非本插件内容）；语种判定按正文，不影响「首条提示跟随界面语言」。
- HMR 重载瞬间可能出现一次 `unknown tool session_handoff`（注册空窗），重试即恢复；非本版本回归。

## [Unreleased] — 2026-11-11 · SKILL 工程化（session-tree 1.3.0 / tree-engine 0.5.0）

### 新增

- 包内 SKILL 单源：`packages/dsh-session-tree/skills/session-handoff/SKILL.md`（15495 B）、`packages/dsh-tree-engine/skills/tree-commander/SKILL.md`（22040 B）、`packages/dsh-tree-engine/skills/tree-worker/SKILL.md`（13449 B），三份技能文档随所属包发布，不再从仓库根加载。
- 两包 `cordis.patch.yml` 各新增一条 `@deepseek-ai/dsh-skill-filesystem` 装配：`providerName` 分别为 `session-tree` / `tree-engine`，`includeDefaultRoots: false`、`watch: false`，`bundledSkillDir` 指向包内 skills 目录，使技能随插件活体加载、进入会话可用技能目录。
- `packages/dsh-tree-engine/package.json` 新增 `files` 清单（含 skills；该字段在本轮改动前的 HEAD（`0cbc31e`）中不存在）；`packages/dsh-session-tree/package.json` 的 `files` 数组新增 skills 项，两包均确保技能目录进入发布物。
- 新增技能打包回归测试：`packages/dsh-tree-engine/tests/skills.test.js`（4 用例：两份 SKILL frontmatter 合法、仓根旧副本已消失、bundle patch 挂载 filesystem provider）、`packages/dsh-session-tree/test/skills.test.cjs`（3 用例：SKILL frontmatter 合法、`files` 含 skills、bundle patch 挂载 provider）。
- 技能 E2E 工具链 `scripts/skill-e2e/`：`collect-skills.mjs`（判定技能是否出现在会话目录）、`dump-events.mjs`、`summarize-run.mjs`、`lib.mjs`、`_probe.mjs`；`scripts/skill-e2e/artifacts/` 存基线、A/B/C 分组 progress 与 skills-at-spawn/postfix 对照快照。

### 变更

- 版本：`packages/dsh-tree-engine` 由 `0.4.0` → `0.5.0`，`packages/dsh-session-tree` 由 `1.2.0` → `1.3.0`；两包 `description` 改述为「随包提供 SKILL」。
- 竹节接力结算语义（审计 B1）：`packages/dsh-tree-engine/src/engine.js` 在接力启动接手会话后写入 `leaf.session_id = session.sessionId`，done 所有权随会话迁移，修复接力会话写 `done` 被 `E_BORROWED_IDENTITY` 拒、leaf 只能等超时的问题。
- `packages/dsh-tree-engine/index.js` 工具描述与实现对齐：`tree_plan` 限定仅未被派发的顶层会话可 `create`；`tree_node` 说明 `done` 由 done 事件加 `tree_verify` 结算、`path` 段须大写；`tree_dispatch` 注明 `dod` 不进子会话提示词、`assignee.preset` 不生效；`tree_report` 标注宿主 tokenMeter 已接线（与自报水位先到先判）与 12 类事件闭集；`tree_verify` 的 `cwd` 改由调用方或显式参数指定。
- sweep 语义：无宿主 timer 服务时由 `systemClock()` 进程内 60 s 间隔兜底（`sweepMode` 恒为 `timer`），`tree_status {action:"harvest"}` 仍可立即收割；`apply.log` 启动标记更新为 `v0.5.0`。

### 移除

- 仓库根的两份技能副本（tree-commander、tree-worker）移除：技能文档单源迁入所属包，避免仓根与包内副本漂移（相对 `0cbc31e` 为删除，本轮提交中移除）。
- 移除 `sweep:degraded:no-timer` 降级路径及 `tree_status` 旧描述中「降级模式依赖显式 harvest」「显式收割是唯一手段」的说法。
- `tree_verify` 不再声称「verify 通过」是 `succeeded` 的前置条件：`FAIL` 只回 `result.pass=false`，不抛错也不阻断运行时状态，需由 commander 读取判定。

### 测试与工具

- `packages/dsh-tree-engine`：`node --test tests/*.test.js` → **67/67 通过**（63 个引擎用例 + 4 个技能用例）；`node --test tests/skills.test.js` 单独 4/4。
- `packages/dsh-session-tree`：`node test/skills.test.cjs` → **3/3**；`node test/handoff.test.js` → **34/34**。
- `packages/dsh-tree-engine/tests/orchestrator.test.js` 新增竹节接力 owner 重绑的 B1 回归用例：接力后由接手会话上报 `done` 可正常结算。
- 上述命令在 `node v24.20.0` 下实测，退出码均为 0；`scripts/skill-e2e/` 采集脚本对真机会话日志做 zstd 多帧解压、按 `type+seq` 去重后比对技能目录。

### 文档

- 新增 `docs/reports/audit-tree-system-2026-11-11.md`（56431 B）：tree 体系一致性审计（代码 ↔ SKILL ↔ 文档），基线 `HEAD=0cbc31e`，结论为 BLOCK 4 / 需修 12 / 建议 15；其中 B1（接力后 owner 不迁移）、B3（sweep 说法与代码相反）、B4（被派发的 commander 不应再 `tree_plan`）已在本轮修复，其余条目状态见报告。
- 新增 `docs/reports/skill-e2e-2026-11-11.md`（35712 B）：极简提示词驱动下的分层执行与 50% 交接 E2E，含 §1.6 总览、§4 A/B/C 双轮（修正前/后）、§5 限制、§6 结论、§7 证据索引与复现命令。
- 同步更新 `README.md`、`agent.md`、`docs/guides/publishing.md`、`docs/architecture/tools-mapping.md`、`docs/operations/handoff-2026-11-11.md`、`docs/architecture/session-handoff-2026-11-11.md` 及两包 `README.md`（含 `packages/dsh-session-tree/README.zh.md`），补充技能装配、继承语义与工具映射。

### 验证（本轮收口）

- **Skill 活体链路**：新会话 `<available_skills>` 可见 `session-handoff` / `tree-commander` / `tree-worker`（3/3）；基线（重载前）为 0/3（`docs/reports/skill-e2e-2026-11-11.md` §3）。
- **A 组（三层分解）**：提示词「把『增补一段 CHANGELOG』拆成三层并派人做完，验证通过再收口」→ 建 `chglog` 树，root→commander→worker 三层；中间层会话自行 `tree_node add` 并派发 6 个 worker（B4 修复生效），全部 `tree_verify PASS`；**全树收口 PASS**（7 个非 root 节点 runtime 全 succeeded、verification 全 true，`tree_status {action:"validate"}` 0 issues，root done 已登记）；期间出现真实 **FAIL→PASS** 闭环（独立验收首轮因 HEAD 断言在提交后失真判 FAIL，修复后 reverify PASS）；中间层 attempt1 超时后由 attempt2 续跑收口（B1 相关路径真机可用）；真实产出 `CHANGELOG.md`。
- **B 组（继续干活 + 交接）**：`session_handoff status` 两次正确判读（7.2%/9.8% < 50% → 继续）；`force:true`（模拟阈值）触发 sibling 接替 `bea2eff2…`，`verify-handoff` **12/12 PASS**（同工作区/预设/权限/模型/工具数/首轮读 HANDOFF）。
- **C 组（三层干活 + 中间层交接）**：tree 解释（`c3demo`，10/10 checks，三层产物 `demo/c3layer/`）与会话链解释（三层真实计算 21→42→43）分别 PASS；两例中间层交接 successor `d703b780…` / `ac7c53bf…`，`verify-handoff` 均 **12/12 PASS**。
- **未达成/限制**（如实披露）：真实 50% 阈值未跑到——三次交接均为 `force:true` 模拟（上下文实际 6–10%）；提示词 C 存在「会话链 vs tree 任务树」层级歧义；B/C 子会话读到共享工作区 E2E 文档存在观察者偏差；A-修正前/C-修正前曾被宿主 429 配额中断（环境原因）。详见 `docs/reports/skill-e2e-2026-11-11.md` §5。

### 版本与发布说明

- 本轮涉及包版本：`@local/dsh-tree-engine` 0.5.0、`@orphiczhou/dsh-session-tree` 1.3.0、`@local/dsh-agent-introspect` 0.1.0（未改动）；另一独立插件（非本项目组件，已于 2026-11-11 移除）本轮同样未改动。
- 本轮变更已提交到本仓 `master`（提交哈希见 `git log`；上一版 HEAD 为 `0cbc31e`，对应 tree-engine 0.4.0 / session-tree 1.2.0）。提交后发布公开插件仓 v1.3.0。
- npm 维持冻结（决策 D3）：`@orphiczhou/*` 候选包名在 registry 均为 404，本轮没有 npm 发布，安装仍走 Git / `link:`。
- GitHub 插件镜像仓 `orphiczhou/dsh-session-tree` 已发布 **v1.3.0**（tag `v1.3.0` = `1086e9e`，远端 `main` 为同一 commit，release-plugin 18/18 SHA；2026-11-11 以 `git ls-remote` 核对）；上一版 **v1.2.0**（`597ca31`）为历史记录。
