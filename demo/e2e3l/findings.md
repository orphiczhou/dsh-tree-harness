# 三层树执行引擎调研笔记

## 一、总体结构
三层树执行引擎围绕"计划 → 分层派发 → 竹节中继 → 验证"的生命周期组织,核心对象是任务树(tree)与节点(leaf)。树由 `tree_plan` 创建,根节点 `<tree_id>-root` 自动生成;子节点通过 `tree_node add` 挂接,形成 commander / worker / auditor 等角色的层级。节点间用 `dependencies` 声明依赖,引擎做环检测,派发前要求全部依赖完成。

## 二、各层职责
1. **计划层(tree_plan / tree_node)**:root 携带 brief(目标、上下文、约束)与 DoD(完成定义);节点 CRUD 维护角色、路径、taskType(research/question/doc/code-change/default)等元数据,taskType 决定后续验证策略路由。
2. **执行层(tree_dispatch / tree_report)**:dispatch 将节点从 pending 推入 running,可指定 prompt、assignee(provider/model)与 dod;执行者通过 report 上报 context 使用率与事件(progress/blocked/plan/done)。上下文阈值(默认 42%)触发 bamboo-joint 自动中继:先写 brief,再打断旧会话、启动后继,保证长任务不断链。
3. **验证与维护层(tree_verify / tree_status / tree_maintain / tree_log)**:verify 按 self-report / artifact / command 三类批量策略核验,verdict 记入节点,通过后才允许 succeeded;set-status 强制闭合并要求 done 事件先行、里程碑全部 audit_pass;status 提供 overview/validate/sessions/harvest(收割显式清扫);maintain 负责备份(保留 10 份)/恢复/注册会话;log 可查事件、漂移史、心跳与通信记录。

## 三、编排要点
- 命名规范:`<prefix>-<Role><seq>-<name>`;tree_id 为 4–8 位小写字母数字下划线,不含连字符。
- 状态机:pending → running → (done 事件 + 里程碑 audit_pass) → succeeded,首达即定的取消与超时硬截止并存。
- 上下文治理:executor 自报 context_usage_pct 是主信号,42% 阈值自动接力。
- 降级模式:degraded-lazy 依赖 harvest 显式清扫收集结果。
- done 事件要求 owner session 作为调用者,防越权登记。

## 四、变更摘要
新建本文件 findings.md,记录三层树执行引擎的结构、职责与编排要点调研笔记(中文,≥300 字符)。
