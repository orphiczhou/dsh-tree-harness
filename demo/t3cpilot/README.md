# tree → flow → tree 三层组合受控试点（t3cpilot）

本目录是 **2026-11-13 真机受控试点**的可复现配置（剧本见 [composition-playbook.md](../../docs/guides/composition-playbook.md) §5，证据报告见 [composition-pilot-tree-flow-tree-2026-11-13.md](../../docs/reports/composition-pilot-tree-flow-tree-2026-11-13.md)）。

结论：**PASS（受控范围内）** —— 外层树 `t3c1` 的 commander 在 `relay=off` 下同步跑完 flow `T3C1-R1`（`integrity=verified`），flow 节点在内层树 `t3c2` 中派发 commander → worker 并等待收口；两树 `validate` 0 issues；深度链 max=4（≤ maxDepth 5）。

## 文件

| 文件 | 作用 |
|---|---|
| `flow.json` | 内联 flow DSL（1 个 session 节点 `INNER`；`flowPath` 传给 `flow_run`） |
| `inner-node.prompt.md` | flow 节点 `INNER` 的任务书（派发内层 commander、轮询、输出 `INNER_RESULT`） |
| `commander.prompt.md` | 内层树 commander 的任务书（派发 worker、等 done、`tree_report done` 自收口） |
| `worker.prompt.md` | 内层树 worker 的任务书（纯计算平方表 + `tree_report done`） |

## 复现（要点）

1. 建外层树 `t3c1` + commander 叶子 `t3c1-C1-commander`，**先 `set-relay off`**；
2. 建内层树 `t3c2` + `t3c2-C2-commander`（parent=root）+ `t3c2-C2a1-worker`（parent=commander）；
3. `tree_dispatch start t3c1/t3c1-C1-commander`，prompt 指定 `flow_run {runId:"T3C1-R1", flowPath:"<repo>/demo/t3cpilot/flow.json", cwd:"<repo>"}`；
4. 轮询 `tree_status harvest` / `tree_node get` 到 C1 `runtime.state=succeeded`；
5. 验收：两树 `tree_status validate` 0 issues、`flow_status T3C1-R1` succeeded/integrity=verified、journal `run/ended`；完成后 `set-relay auto`。

详细步骤与实测时间线见报告 §3 / §7。

## 已知偏离（相对剧本 C）

- 内层树由 **Lead 预置**（flow 节点是一次性会话，无法可靠获知自身 session id 填 `added_by`）；flow 节点只做派发/等待。
- 深度链到 **4**（外层 commander 直接跑 flow，未加外层 worker 层）；`relay=off` 的 42% 抗打断未在本试点触发（外层上下文约 4.1%）。
