# RELOAD5-EVIDENCE-2026-11-15 from flow-engine · 两闸（P0/P1）齐备通报

> 来源：flow 引擎项目组 Lead · 2026-11-15 14:3x · 本仓 HEAD `7ec50cb`
> 对象：`E2E-PLAN-2026-11-13-flow-continuation-pilot.md` §3 P0/P1 两执行闸（P2 已批准、P3/P4 以贵仓当日复跑为准）。
> 结论：**P0 ✅ / P1 ✅——贵仓续接试点（含混合维）开测前提已由我方满足。**

## P0 · flow 插件适配宿主 rc.3（受控装载 + 单节点 smoke PASS）

- 适配：`0f60e18`（2026-11-13，扁平 `startActivation` spec；`evidence/m1/T-m1.2/T-2b-RC3-ADAPTER.md`）。
- 装载：原「受控 disable→enable 重载」由**宿主隔夜自然重启**替代完成（rc.3 适配代码已装载并运行：2026-11-15 fork 会话 28 个真机 run 全正常 + 我方阶段 1 批 4 run 全正常；版本与 API 形状按 AGENTS §6 复核无漂移）。
- smoke：`E2E2-M12-T6-20261115`（m12 夹具，n1→n2）——**succeeded / integrity=verified / 双 `node/spawned`**；另有 `E2E2-T1TREE-20261115`（子会话发起，孙会话节点正常）。
- 附加强证据：2026-11-15 并发专项 10/10 PASS（28 run，`evidence/m1/multi-run/FORK-CONCURRENCY-TEST-REPORT-2026-11-15.md`）。

## P1 · flow 仓 T-6 真机 E2E PASS

- 证据：`evidence/m1/T-m1.2/realmachine/REALMACHINE-2026-11-15.md`（我仓，含 raw/）。
- 要点：① `flow_send` 续接 E2E：n2 干净 `stopReason=completed` + `messageId` + output 回读（节点会话 completion 双重印证）；n1 为口径出入登记样本（消息送达+冷恢复+输出正确，子会话误调工具超默认 60s 窗口 → 工具超时返回；**超时 ≠ 续接失败**，贵仓 TC 用例若遇同现象请按此判读，可显式 `waitMs` ≤300s）。② journal 零写入双读（两次续接前后三读全等）。③ 深度拒绝负例：`E_SESSION_DEPTH_EXCEEDED`，消息含 `attemptedDepth=6, maxDepth=5`。
- M1.1 gate 回归（rc.3 重验）：15/15 ALL CHECKS PASS（与本试点无直接依赖，一并通报）。

## 对贵仓试点执行的两点提示（不改变贵仓方案）

1. **续接指令建议纯文本**（避免「输出 JSON」诱发子会话误调结构化工具，n1 样本即此）；`flow_send` 的 `waitMs` 建议显式 180000。
2. `flow_send` 工具的**错误返回当前渲染为 `?` 占位符**（成功渲染器误用，我方台账 §8.6 #7 已登记 P lane 待修）——试点中若见 `[flow_send] run=? node=? …` 形状，请按错误处理并以 journal/会话事实为准判读，勿当作「形状未知的新行为」。

## TC-9 撞线提醒（沿用 11-13 回执）

贵仓混合维 TC-9/TC-10 与我方已知事实 `E_BORROWED_IDENTITY`（孙会话 tree 写面）存在撞线风险：我方 2026-11-15 忠实重测（`E2E2-T1TREE-20261115`：`tree_plan ✅ / tree_node add ❌ E_BORROWED_IDENTITY / validate ✅`）确认 rc.3 上该边界**仍在**。贵仓 TC-10 若依赖 INNER 会话对内层树做写面操作，请先行评估该风险（此前已提请预登记）。
