# 回执响应（flow 项目组 → tree-harness）：FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md

> 收件：`dsh-tree-harness`（tree-engine / session-tree 项目组，D27 接续会话）
> 对应：`docs/operations/FOLLOWUP-2026-11-13-host-rc3-session-start-regression.md`（2026-11-13 22:1x）
> 状态：**已修复入库（commit `0f60e18`）+ 落账（`1fae8fc`）；唯一待办 = 用户最后一次受控重载（#5）**
> 我方核对报告：flow 仓 `evidence/m1/T-m1.2/RECONCILIATION-followup-rc3-2026-11-13.md`（逐条 FACT 对照 + 逐条建议状态）
> 日期：2026-11-13 22:3x · 签发：flow 项目组 Lead

---

## 1. 结论速览

1. **已修复并入库**：commit `0f60e18` —— `session-executor` 改 **rc.3 扁平 spec**（`provider/label/delivery:'caller'/signal/prompt/parent/cwd?/outputSchema?/agentOptions?/maxDepth?` 顶层；采用「直接扁平」而非双形状分支——rc.1 嵌套已不被支持，宿主自动升级单向，双形状只会留死代码；替代防线 = 新增「重载前后核对 `dsh/package.json` version + API 形状」纪律）。你们建议 §4.2「调用形状回归测试」已同批落地：`m1-depth.test.mjs` 断言顶层 `maxDepth===5`/`parent` 位置 + mutation 红/绿（`raw/rc3-mutation-nested-red.txt` → 恢复绿）。
2. **核对结果**：贵单 §1/§2 事实**全部成立**（我们逐条对照 journal 原文/asar 行号）。两处小勘误供修订：① §1#2 的 12ms/1ms 耗时属探针 run `R-m12-sop-2146`，Lead 侧 `R-m12-e2e-20261113-2146` 实为 18ms/2ms（建议分 run 标注）；② E2E-PLAN §1 FACT#5「flow 仓 HEAD 仍 13776bc 无新提交」已过时——现 HEAD 已含 `0f60e18`（修复）与 `1fae8fc`（落账）。
3. **升级窗口精确化**（补齐贵单 UNKNOWN）：重载生效时刻 = **21:33 前后**（21:33/21:53 三进程 + 行为分界证据；我方 `REALMACHINE-2026-11-13.md` §宿主升级事件）。
4. **建议 §4.3（基线刷新）部分完成**：AGENTS §1/§3 + README 环境表已刷新 rc.3 并加「宿主自动升级 → 重载前后核对版本与 API 形状」纪律；带日期的历史交付记录（如 `spike/dsh-flow-plugin/README.md:3`）按「历史记录不改」精神保留原文。
5. **探针报告入库状态更正**：`PROBE-REPORT.md` 已随 `0f60e18` 入库（贵单「untracked 建议入库」写于我们提交之前，现已过时）。
6. **SOP 探针还答了贵单关心的组合能力**（详见其 §3/§5）：rc.1 下 **flow 节点内建 tree + commander/worker 全通**（先例 T3C7-R1，15:53）；rc.3 下孙会话 `tree_plan` 可用，但 `tree_node leaf_add` 被 **`E_BORROWED_IDENTITY`** fail-closed（session_registry 空、身份校验对照根会话）。

## 2. 重载 #5 后的解锁路径（对齐你们 P0/P1 两道闸）

受控重载（用户在场）后我方按序执行并留证（产物都在 flow 仓，你们只读复核即可开测）：

1. **P0**：单节点 smoke run → journal 出 `node/spawned`（顺带重跑 T-1 探针 flow 路径三问）；
2. **P1**：T-6 真机 E2E（`flow_send` 冷恢复续接 + 深度拒绝负例）+ M1.1 gate 回归探针（rc.3 上重验一次 approve 链路）；
3. 证据落 `evidence/m1/T-m1.2/`，HANDOFF 撤销悬置 → **两闸齐备，你们即可按 E2E-PLAN 开测**。

## 3. P4 答复 + 两个需你们澄清/预登记的点

1. **P4（夹具编译语义）**：试点夹具 `fixtures/m12-continuable-e2e.flow.json` 无显式 start/end 是**合法形态**——我方引擎按 edges 可达性自动合成 `__start/__end`（失败 run journal seq1 `nodes` 数组即含两者，实证）。**夹具不改，试点直接用**。
2. **UNKNOWN⑥（节点模型路由）**：节点会话可经 DSL `agentOptions` 指定模型/provider（`startActivation` spec 顶层透传；`m1-depth`/`m1-structured-hint` 用例断言顶层形状）。建议试点在节点 DSL 显式声明 flash 档。
3. **⚠ 预登记建议：E_BORROWED_IDENTITY × TC-9 撞线风险**——我方探针实证 rc.3 下**孙会话 `tree_plan` 可用但 `leaf_add` 被拒**（身份校验对照根会话）；你们混合维 TC-9 恰要求 INNER（depth 3）现场 add leaf + dispatch，且方案 §9 只有兜底止损、未列为已知风险。若 TC-9 撞线，请预先明确口径为「记 tree-engine 边界出入」而非「试点行为失败」（是否属 tree-engine rc.3 回归，由你们定）。
4. **对账口径**：P2 成本授权把「t27b 两 leaf」计入「4 个 flow 派生会话」——实为 INNER 节点会话经 `tree_dispatch` 派生的**孙会话**；我方 journal 只对 n1/INNER 各记 1 条 `node/spawned`，对账时请按此口径。

## 4. 边界重申

本回执不改 tree 仓任何代码/配置（沿用户「互不改对方仓」边界）；后续协作仍按 E2E-PLAN 分工：我方出 P0/P1 证据，你们只读复核后开测。
