# tree → flow → tree 受控试点 v2（t3cpilot2，2026-11-13）

本目录是 **2026-11-13 真机受控试点 v2** 的可复现配置（剧本见 [composition-playbook.md](../../docs/guides/composition-playbook.md) §5，证据报告见 [composition-pilot-v2-live-create-2026-11-13.md](../../docs/reports/composition-pilot-v2-live-create-2026-11-13.md)）。

**相对 v1（`demo/t3cpilot/`）的关键变化**：内层树**不再由 Lead 预置**，而是由 flow 节点 `INNER` 在自身一次性会话内用 `tree_plan` **现场创建**（`session_id` / `added_by` 用自标识）；并把深度链压到 **5**（平台配置 `maxDepth=5` 的边界）。

**结论**：主体验证 **PASS**（flow 节点现场建树、深度 1..5、flow `succeeded/integrity=verified`、两树 `validate` 0 issues）；**发现**：深度 6 探针**未被平台拒绝**（`subagent.maxDepth` 只在模型工具 `subagent` 路径生效，tree/flow 编程派发路径未传 `request.maxDepth`），详见报告 §5。

## 文件

| 文件 | 作用 |
|---|---|
| `flow.json` | 内联 flow DSL（1 个 session 节点 `INNER`；`extract:"text"`） |
| `inner-node.prompt.md` | flow 节点任务书：自标识（`self_spec` + `$env:DSH_SESSION_ID` 双通道）→ `tree_plan` 现场建 `t3c4` → 派发 → 轮询收口 → 输出 `INNER_RESULT` |
| `commander1.prompt.md` | 外层树 `t3c3` commander（派发跑 flow 的 worker、等待收口、自写 done） |
| `worker1.prompt.md` | 外层树 worker（depth 2，同步跑 `flow_run T3C3-R1`，结算） |
| `commander2.prompt.md` | 内层树 `t3c4` commander（depth 4，派发 worker、等待收口） |
| `worker2.prompt.md` | 内层树 worker（depth 5，最深）：一次深度 6 负向探针 + 平方和 + done |

## 复现（要点）

1. 建外层树：`tree_plan create t3c3`（`session_id=<root 会话 id>`）→ add `t3c3-C1-commander`（parent=root, path=C1）→ add `t3c3-C1a1-worker`（parent=C1, path=C1a1, `relay:"off"`）→ `tree_node get` 读回 relay。
2. `tree_dispatch start t3c3/t3c3-C1-commander`，prompt 指向 `commander1.prompt.md`。
3. 外层 commander 派发 worker；worker 跑 `flow_run {runId:"T3C3-R1", flowPath:"<repo>/demo/t3cpilot2/flow.json", cwd:"<repo>"}`。
4. flow 节点 `INNER` 按 `inner-node.prompt.md` 现场建 `t3c4`（root owner=flow 节点会话）、建 C2/C2a1（C2a1 `relay:"off"`）、派发 C2。
5. 内层 commander 派发 worker；worker（depth 5）按 `worker2.prompt.md` 发一次 `flow_run T3C3-DEPTHNEG-1`（预期被深度限制拒绝，**实测未被拒绝**），然后算平方和并 done。
6. 验收：`tree_status validate` 两树 0 issues；`flow_status T3C3-R1` succeeded/integrity=verified；`~/.dsh/sessions/--D-Codes-dsh-tree-harness--/<id>/session.v4.jsonl.zstd` 首行 `delegationDepth` 核对 1..6；tree-state 核对 `t3c4-root.session_id=flow 节点会话`、`segmentChain=[]`、`drift_history=[]`。
7. 完成：外层 leaf `relay=auto` 恢复（内层 leaf 因 creator=flow 节点会话已结束，保持 `off`）。

## 已知边界（v2 实测）

- 深度 6 未被平台拒绝（`maxDepth` 非全局硬上限）——报告 §5；修复待排期。
- 内层叶事后无法补 `tree_verify`（creator/root=已结束的 flow 节点会话）——验收用 `runtime=succeeded + validate 0 issues`（报告 §6）。
- `tree_log {action:"events"}` 只回计数，done meta 不可机读（报告 §6）。
