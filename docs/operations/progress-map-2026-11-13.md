# 进度地图（2026-11-13 13:30 快照）

> 给用户对齐用的一页进度图。**先对齐本图，再决定下一步推进**（用户 2026-11-13 指示：交接新会话后先沟通进度地图）。
> 权威细节：状态/决策以 [agent.md](../../agent.md) 与 [handoff-2026-11-12.md](handoff-2026-11-12.md) 为准；本文件只做「一眼看懂」的汇总。

---

## 0. 一句话

**引擎与插件全部就绪、发布物与公开镜像逐字节一致、D21 轮把「真机 E2E + 三层组合试点 + 发布测试门禁 + 会话元数据 GUI」四项欠账全部清掉**；剩余工作以「加深组合编排 / 打磨工具链」为主，没有阻塞性缺陷。

---

## 1. 组件与测试（FACT）

| 组件 | 版本 | 状态 | 测试 |
|---|---|---|---|
| `packages/dsh-tree-engine` | **v0.8.0** | 运行中（9 个 `tree_*` 工具 + 随包 2 份 Skill v2.2） | **165/165**（19 个 `.test.js`） |
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

## 3. 下一步候选（按建议优先级）

| # | 事项 | 为什么值得做 | 需要谁定 |
|---|---|---|---|
| 1 | **组合编排深挖（第二层）**：内层树由 flow 节点内 `tree_plan` 现场创建；压 maxDepth=5 边界 | D21 试点证明三层可行，但内层树是 Lead 预置的（一次性 flow 节点拿不到自身 session id 填 `added_by`）；补上后剧本 C 才算完整 | Lead 可先做技术方案；是否投入试点由用户定 |
| 2 | **flow 一次性→非一次性会话**（用户已授权方向） | 若节点需多轮/续接，当前一次性语义是硬限制；属 flow 仓变更（改 `lib/session-executor.js`，需重测 journal/锁/取消） | 用户定时机（建议 D21 之后再排） |
| 3 | **发布门禁再收紧**：把三断言 E2E 做成「发布前必跑 + artifact 归档」流程；文件锁 / nudge / leafAdd 白名单三条 flash 审计高危项 | 提升发布可重复性与引擎健壮性 | Lead 可排期 |
| 4 | **只读子会话底部 Phase 2**（chain 覆盖官方只读 composer） | 当前只读子会话元数据在标题栏 chip；用户未明确要求底部 | 仅用户要求时做 |
| 5 | **已知边界清理**：artifact 验证对象错位、`runtime.history` 预算口径、`tree_maintain gc` | 历史欠账，非阻塞 | Lead 排期 |

**需要用户拍板的三个问题**：① 第 1 项是否现在就做（预计一次受控试点，~15 分钟 + 5 个子会话）；② 第 2 项是否本周期启动（属另一个仓的改动）；③ 是否把「三层组合」写进产品能力/文档对外口径（当前只是内部试点证据）。

---

## 4. 风险与边界（FACT）

- 内层树预置是已知偏离（见 §3-1）；relay 42% 阈值在 D21 试点中未被压到（外层上下文约 4.1%）——relay 抗打断仍以 v0.8.0 E2E 为据。
- `provider-conformance` 依赖本机 `%TEMP%` rc.2 fixture：发布门禁已按「缺 fixture 记 SKIP、断言失败仍阻断」处理，但干净机器上等于未覆盖。
- 顶层记忆：真机操作类结论必须有活体读数/截图；UI 结论本轮已闭环（代码级 + 截图 + 用户确认）。
