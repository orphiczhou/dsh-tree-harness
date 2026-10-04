# v0.3.9 E2E 关键链路记录（e2ev39）

## 概述
本次 v0.3.9 端到端（E2E）验证围绕任务树（tree）的三大核心机制展开：竹节接力、依赖闸与验证路由。整条链路从 tree_plan 创建树开始，经 tree_node 添加分层节点、tree_dispatch 派发执行、tree_report 上报，最终由 tree_verify 按策略裁决并通过 set-status 关闭节点。

## 竹节接力（Bamboo-Joint Relay）
竹节接力是上下文续传机制：当执行节点自报 context_usage_pct 达到阈值（42%）时，引擎自动触发 relay——先为新上下文启动后继节点（successor），再中断旧节点，任务说明与关键状态随之转移，避免单会话上下文耗尽导致任务中断。本次 E2E 验证了 context 自报作为主信号触发 relay 的完整流程，后继节点无缝接续前置工作，未丢失中间产出。

## 依赖闸（Dependency Gate）
tree_node 添加节点时声明 dependencies（必须指向已存在的 leaf_id），引擎做环检测（cycle-check）；tree_dispatch 派发前检查全部依赖节点是否已 done，未满足则拒绝派发。这保证了分层执行顺序：上游节点关闭前，下游节点不会提前运行。本次 E2E 构造了带依赖链的多层节点，确认依赖未完成时派发被闸住，完成后放行。

## 验证路由（Verification Routing）
tree_verify 依据 taskType（research/question/doc/code-change/default）解析验证策略，也可用 policyId 显式覆盖；裁决结果记入 leaf.verification，通过（pass）是节点 succeeded 的前置门槛。set-status 的状态机强制"done 事件先于关闭 + 全部里程碑 audit_pass"。本次 E2E 覆盖了 self-report、artifact、command 三类 batch-1 模式的路由与裁决。

## 结论
三条链路协同：依赖闸控制"何时可执行"，竹节接力保障"执行不因上下文中断"，验证路由决定"何时算完成"。v0.3.9 E2E 全链路通过，符合 DoD 验收标准：产物文件存在且形状合规，变更摘要已产出。
