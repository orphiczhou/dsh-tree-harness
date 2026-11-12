# 组合式会话编排体系 · 专家取证报告集（2026-11-12）

> **性质**：一次性证据报告。是 2026-11-12「会话树基础层 × tree-engine × 自由流程引擎 组合/拆分」评估的原始取证材料，**不是决策**；结论以 [composable-orchestration.md](../../architecture/composable-orchestration.md)（v0.1，经本集 R5 红队证伪修订）与 `agent.md` 决策日志为准。
> 方法：4 位独立研究专家 + 1 位红队专家，全部只读取证；基线 `D:\Codes\dsh-tree-harness` @ `1b1f610`、DSH `0.2.2-rc.1`、profile `desktop`。
> 证据标记：各报告内 `FACT` = 直接读到（附 file:line 或 asar 路径）；`INFERENCE` = 由事实推导；`UNKNOWN` = 未取证。

## 文件

| 文件 | 角色 | 内容 | 规模 |
|---|---|---|---|
| [E1-coupling.md](E1-coupling.md) | E1 仓库耦合审计师 | 三包（session-tree / tree-engine / agent-introspect）的真实依赖矩阵、六类跨包引用、拆分影响面与工作量粗估 | 651 行 |
| [E2-dsh-capabilities.md](E2-dsh-capabilities.md) | E2 DSH 平台能力边界研究员 | 直读 `app.asar` 的平台原语 12 项、四段契约（派发/账本/观测/视图）、平台缺口 G1–G12、审批/权限/深度/元数据机制 | 1028 行 |
| [E3-freeflow.md](E3-freeflow.md) | E3 自由流程引擎分析员 | 自由流程 M1 架构、节点=一次性会话模型、嵌套现状、组合缺口清单、项目内既有 tree×flow 四方案论证（A/A+/B/C） | 504 行 |
| [E4-sota.md](E4-sota.md) | E4 SOTA 组合架构研究员 | 10 个组合模式目录、Agent 框架/持久化工作流引擎对比、Kernel+Contract+Engines+Projection 目标架构、编排 ABI、递归边界、5 条反模式（59 URL） | 1295 行 |
| [R5-redteam-review.md](R5-redteam-review.md) | R5 红队证伪评审 | 对评估 v0 的证伪：S1–S6 严重缺陷、M1–M9 遗漏、N1–N7 内部不一致、与项目决策冲突、5 步最小可行路线 | 314 行 |

## 阅读提示

1. **不要按版本号判断能力**：DSH API 已发生 `startContinuable` → `startActivation` 的漂移；报告结论中 DSH 行号仅对 `0.2.2-rc.1` 有效，升级后需重取。
2. **R5 评审对象是评估 v0**（当时文件名带日期 `composable-orchestration-2026-11-12.md`）；v0.1 已按 S1–S6/M1–M9/N1–N7 修订（处置对照见评估文档附录 B）。阅读时请以 v0.1 为准、以 R5 为反证清单。
3. **原报告是"当时证据"**：不随代码修改回写；后续新结论应写新报告。
4. 仓外原始报告在 `D:\Codes\_composition-research\`（不入库）；本目录为入库副本（内容一致，仅重命名 R5）。
5. 报告中的本机路径/用户名披露沿用既有项目口径（D2 公开、已由 `verification-2026-11-11.md` 显式接受），未新增凭据类内容。
