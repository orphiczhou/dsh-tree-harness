# 三层树执行汇总报告(tree e2e3l)

## 一、调研发现(findings.md 要点)
三层树执行引擎围绕"计划 → 分层派发 → 竹节中继 → 验证"的生命周期组织,核心对象是任务树与节点:
1. **计划层(tree_plan / tree_node)**:root 携带 brief(目标、上下文、约束)与 DoD;节点 CRUD 维护 commander/worker/auditor 角色、工作路径与 taskType(research/question/doc/code-change/default),taskType 决定验证策略路由;dependencies 声明依赖且引擎做环检测。
2. **执行层(tree_dispatch / tree_report)**:dispatch 将节点从 pending 推入 running,可指定 prompt 与 assignee(provider/model);执行者上报 context 使用率与事件(progress/blocked/plan/done);上下文阈值(默认 42%)触发 bamboo-joint 自动中继——先写 brief,再打断旧会话、启动后继,长任务不断链。
3. **验证与维护层(tree_verify / tree_status / tree_maintain / tree_log)**:verify 按 self-report / artifact / command 批量核验并记录 verdict;set-status 强制闭合状态机(pending → running → done 事件先行 + 里程碑 audit_pass → succeeded);maintain 支持备份(保留 10 份)/恢复;降级模式 degraded-lazy 依赖 harvest 显式清扫;done 事件要求 owner session 调用以防越权。

## 二、评审风险(C2a 结论)
C2a 对调研结论进行评审,发现三项主要风险:
1. **单源无佐证**:调研笔记仅依据单一信息源(引擎工具描述),缺乏第二来源交叉验证,结论可信度受限;
2. **关键数值无版本来源**:文中引用的关键数值(如上下文中继阈值 42%、备份保留 10 份)未标注来源版本,引擎迭代后可能失效;
3. **缺失败路径与边界分析**:笔记只描述了正常路径(happy path),未覆盖依赖不满足、节点取消、超时硬截止、会话失联等失败路径与边界条件的行为分析。

## 三、依赖编排过程(C1b → C2a 跨分支依赖闸门)
本次执行验证了引擎对跨分支依赖 C1b→C2a 的闸门保证:
- **首次派发被拒**:在 C1b 尚未完成时尝试派发 C2a,引擎返回 `E_DEPENDENCY_NOT_MET` 错误,拒绝将 C2a 推入 running,从机制上防止下游评审在缺少上游输入的情况下空转或产出无据结论;
- **轮询等待放行**:调度方轮询 C1b 状态,待其登记 done 并转 succeeded 后,再次派发 C2a 即获放行,C2a 得以基于 C1b 的调研产物开展评审;
- **结论**:依赖闸门与状态机闭合并存(E_DEPENDENCY_NOT_MET 前置拦截 + succeeded 门槛),保证了跨分支信息流的因果顺序,是三层编排正确性的核心保证。

## 四、产出清单
- findings.md:调研笔记(结构、职责、编排要点);
- C2a 评审结论:三项风险(单源、数值无版本、缺失败路径);
- report.md:本汇总报告。
