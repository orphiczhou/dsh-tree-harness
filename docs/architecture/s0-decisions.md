# S0 裁决记录 — 规约冻结配套

| 项 | 值 |
|---|---|
| 日期 | 2026-10-04 |
| 输入 | PLAN.md（含 §5.5 并入）、docs/engine-spec.md、docs/tools-mapping.md、docs/segment-handoff.md |
| 效力 | S1 实现的直接依据；与冻结版 v1.7 冲突处以本记录 + 本仓 PLAN 为准（裁剪与增量授权见 PLAN §1） |

## 裁决清单

| # | 议题 | 裁决 | 理由 |
|---|---|---|---|
| 1 | 工具计数口径 | **33 = 32 包装 + 1 help（元工具不占位）**；v1.7 的"29"为 v0.20 计数（Sprint 5 +2、P1-2 +2） | buildTreeTable 权威表 + patches.cjs:2008 日志互证 |
| 2 | 平铺派发模式（meta-system D4） | **缓**：不实现；仅当真实任务出现 >3 层逻辑深度需求才立项；届时聚合节点降级仍优先 | 维持嵌套唯一形态保 Z1（状态一致性）与 session-tree 可视化；深度墙现值 3 与源引擎 commander 嵌套 ≤3 恰好同值 |
| 3 | 验证层分批边界 | 第一批：self-report / artifact / command；第二批：llm-judge / composite / human | 继承 PLAN §8；成本风险 R4 控制；第二批依赖 S1 smoke 的模型路由与 ask 通道结论 |
| 4 | 竹节参数 | thresholdPct=42（用户裁决）、maxChainLength=5、graceMinutes=5、enabled=true | segment-handoff.md；42 为用户区间 40–45 中点 |
| 5 | 竹节并发次序 | **先 interrupt 后 start**（保守串行）；并发水位 +1 ≤ 上限时允许 L1 自适应旁路 | meta-system §4.2 相位裕度：Z6 并发墙 20 是最紧裕度 |
| 6 | `verifying` 态升格（PLAN §5.4 悬置项） | **不升格**：验证态以观察字段 `verification:{status}` 表达，不进节点状态机闭集 | 冻结版红线"不新增状态机"；面板可显示"验证中"已满足可见性 |
| 7 | human 验证模式 × approval=never | 设计降级路径成立：ask 升级不可用时 verdict=frozen，转工具面手动裁决（`tree_verify {policy-verdict}`） | 本会话运行时实证审批提示禁用；S1 smoke 复测 |
| 8 | Inspect Service.listService 通道降级 | **环境缺陷登记**：provider 拒绝任意合法 object 输入；API 权威回退 `logs/dsh-host-services.txt`（2026-10-03 导出，PLAN §11 既定）；受影响验证转 S1 smoke 清单（engine-spec §8） | 连 `{}` 都拒，非载荷问题 |
| 9 | storageDomain 形状验证 | 签名在手（`open<S extends DomainSpec>(spec): Promise<Domain<S>>` 等 3 方法）；**S1 装载即验**，失败按 R6 回退插件数据目录直写 | inspect 活查通道降级，不阻塞 |
| 10 | 模型窗口元数据 | 源 = `llm-pi-ai` providers config（models[].contextWindow，已实测 glm-5.3 系 1,000,000 / MiniMax-M2.7 204,800）；deepseek-official 系不在 patch 层 → 运行时读 provider registry，不可得则 Config 映射兜底 | 竹节阈值分母唯一悬置输入 |
| 11 | SKILL/引擎漂移 | `tree_leaf_autonomy_override`（commander SKILL L345 引用）引擎已无此命令——**S1 重写 SKILL 时剔除**；SKILL 与工具面同 PR 重写（R4 对策） | 33 表为准 |
| 12 | 跨包收割接口（冻结版 §4.1 S0 项） | **本仓无包 C → 收敛为无需**；sweep 定时器宿于本包唯一宿主包，接口预留不建 | 拆分后 Nanju 后置立项 |
| 13 | tree_help 处置 | 不占 8 工具位：13 topic 内容并入各工具 description 与 SKILL 重写版；错误返回保留 help_topic 式引用 | DSH 工具描述即文档；省 1 工具位预算 |

## S0 完成核对（对照 PLAN §8 S0 交付物）

| 交付物 | 状态 |
|---|---|
| 33 工具清单 + 引擎行为规约 | ✅ docs/engine-spec.md（A 断点权威闭合） |
| 整合工具面定稿 | ✅ docs/tools-mapping.md（8 工具，计数核对 33） |
| 验证策略 schema | ✅ PLAN §5.3（jsonc 模板）+ §7 键表（含竹节 4 键） |
| 竹节机制并入 | ✅ PLAN §5.5 + segment-handoff.md |
| API 验证 | ✅ 记录于 engine-spec §8（5 项实测 + 通道降级登记 + S1 smoke 清单 5 项） |
| 裁决记录 | ✅ 本文件 |
| Config schema 装载期校验实现 | → S1 首批代码（类型/约束类=装载失败含键名；竹节键并入） |

**S0 冻结完成。下一步：S1 引擎宿主包**（`@local/dsh-tree-engine`：TS ESM 重写 + 8 工具 + per-tree 队列 + sweep + 竹节 + 验证层第一批 + 移植 tests + 差分）。
