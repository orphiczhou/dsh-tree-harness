# dsh-tree-harness

树形任务分解执行 Harness（DSH 插件）——独立项目。

把 Proma-Easy 的树状任务执行引擎（tree-engine.cjs，29 工具）以 DSH 插件形态重建为**可被其他项目消费的任务执行基座**：任务分解 → 分层派发（子智能体嵌套 ≤3 层）→ 执行 → **分任务类型验证** → 回收。

## 文档

| 文档 | 说明 |
|---|---|
| [PLAN.md](PLAN.md) | **开发方案（工作版）**：范围、接口缝、深度语义、验证策略层（六种验证模式 + DoD 前置注入）、竹节生长（§5.5）、里程碑 S0–S2（MVP 5.5–9 人天） |
| [docs/engine-spec.md](docs/engine-spec.md) | **引擎行为规约（S0 冻结）**：33 工具权威清单（buildTreeTable）、数据模型、状态机闭集、护栏总表、并发契约、差分锚点 |
| [docs/tools-mapping.md](docs/tools-mapping.md) | **工具面整合表（S0 定稿）**：33 源工具 → 8 复合工具映射与 action 集 |
| [docs/segment-handoff.md](docs/segment-handoff.md) | **竹节生长机制设计**：触发/接力流程/竞争语义/配置键/断言（唯一真源） |
| [docs/meta-system-argument.md](docs/meta-system-argument.md) | 元系统工作法全面论证：1115 分析、六类策划、APX 决策、相位裕度、递归触发表 |
| [docs/s0-decisions.md](docs/s0-decisions.md) | S0 裁决记录（平铺模式/验证分批/竹节参数/通道降级处置） |
| [docs/frozen-parent-plan/PLAN-v1.7.md](docs/frozen-parent-plan/PLAN-v1.7.md) | 上游冻结方案（Proma-Easy→DSH 整体移植，AC 七轮审查冻结版）——**规约基线**，状态机/断言/Config 方法论以此为准 |
| [docs/frozen-parent-plan/review-report.md](docs/frozen-parent-plan/review-report.md) | 上游方案审查报告（57 条缺陷闭环明细） |
| [logs/attack-log.json](logs/attack-log.json) | 攻击全量账本（8 版指纹链） |
| [logs/dsh-host-services.txt](logs/dsh-host-services.txt) | DSH Host Service 目录实测导出 |
| [logs/ref-dsh-session-tree-README.md](logs/ref-dsh-session-tree-README.md) | 参考插件 @local/dsh-session-tree 工程范式（inject 纪律/Loader 缓存/headless 测试） |

## 项目关系

```
dsh-tree-harness（本仓，独立开发）
        ▲ 消费（工具面 + 节点规格 + 验证裁决）
南大 Nanju 项目（未来独立立项，架构在树形执行能力之上）
```

上游规划仓：`D:\Codes\proma-easy-dsh`（整体移植规划存档，已冻结）；树引擎本体仓：`D:\Codes\tree-harness`（移植源 + 差分测试基准）。

## 下一步

**S0 规约冻结**（1–1.5d）：29 工具清单提取 → 引擎行为规约 → 工具面定稿 → 验证策略 schema → storageDomain/timer/事件面验证。产出 `docs/engine-spec.md` 后进入 S1 引擎宿主包开发。
