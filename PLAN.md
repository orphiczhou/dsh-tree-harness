# dsh-tree-harness — 树形任务分解执行 Harness（DSH 插件）开发方案

| 项 | 值 |
|---|---|
| 版本 | v1.0（独立项目首版） |
| 日期 | 2026-10-04 |
| 状态 | 待开发（S0 规约冻结为第一步） |
| 上游规划存档 | `docs/frozen-parent-plan/`（Proma-Easy→DSH 整体移植方案 v1.7，AC v1.3 七轮对抗审查冻结版，含状态机/验收断言全量规约） |
| 下游消费者 | 南大 Nanju 双脑协作项目（未来在其之上架构，见 §2 依赖方向） |

---

## 1. 定位与拆分理由

本项目**只做一件事**：把 Proma-Easy 的树状任务分解执行引擎（`tree-engine.cjs`，~309KB 加固产物 + 29 工具 + tree-worker SKILL 54KB）以 DSH 插件形态重建为**独立的、可被其他项目消费的任务执行基座**。

拆分理由（复杂度分解）：
- 树引擎价值独立：不依赖 Nanju 即可交付（任务分解 → 分层派发 → 执行 → 验证 → 回收闭环）；
- 南大 Nanju（双脑协作：向导 Agent + 4 角色编排 + 项目/骨架/快照）**架构在本 harness 之上**，作为下游消费者后置立项；
- 本仓为唯一开发工作区（新会话以本目录为工作区）。

与上游冻结方案的关系：状态机闭集迁移表、验收断言清单、Config 总表等已规约化语义**直接继承**（本文档只列继承点与差异，全量表见 `docs/frozen-parent-plan/PLAN-v1.7.md` §4.1/§4.3/§4.7/§8——该文件经过 57 条攻击七轮闭环，是本项目的规约基线）。**冲突时以冻结版为准，本文档只做裁剪与增量。**

## 2. 架构边界与依赖方向

```
┌─────────────────────────────────────────────┐
│  南大 Nanju 项目（未来，独立立项）              │
│  向导 Agent / 角色编排 / 项目注册表 / 快照      │
└──────────────────┬──────────────────────────┘
                   │ 消费（下述接口缝）
                   ▼
┌─────────────────────────────────────────────┐
│  dsh-tree-harness（本项目）                   │
│  @local/dsh-tree-engine（宿主包）             │
│  树状态 · 派发/收割 · 验证策略层 · ≤8 工具      │
└──────────────────┬──────────────────────────┘
                   │ 复用（DSH 原生，全部实测存在）
                   ▼
   subagents(startContinuable/prompt/interrupt)
   agentTeams · timer · subprocess · storage
   approval · sessionQuery · tools.restrict/guard
```

**对 Nanju 的接口缝（本项目的公开契约，冻结在 S0）**：
1. `tree_plan / tree_node / tree_dispatch / tree_status / tree_log / tree_maintain` 工具面——Nanju 编排器以工具调用方式建树、派发、收割结果；
2. 节点规格 = `{title, taskType, assignee{provider,model,effort,preset}, verification{policy}, dependencies}` —— Nanju 的"角色棒"映射为一个节点（assignee 引用角色预设）；
3. 节点状态机（`pending → running → succeeded|failed|timeout|cancelled`，见冻结版 §4.1）与验证裁决（§5）——Nanju 的验收动作消费验证裁决而非自行判断；
4. 事件面：节点终态通知（S0 验证 sessionQuery 事件面；无事件退化为惰性收割 + status 查询）。

**禁止**：Nanju 不得绕过引擎直接操作树状态；引擎不得感知 Nanju 概念（角色/项目/骨架）。

## 3. 范围

### 3.1 MVP（本仓第一批交付）
- **S0 规约冻结**（0.5–1d）：**33 工具清单提取**（v1.7 所记 29 为 v0.20 时代计数，权威表 = 源仓 `buildTreeTable`，见 docs/engine-spec.md §1）、引擎行为规约、工具面整合定稿（docs/tools-mapping.md）、storageDomain API 验证、验证策略 schema（§5）定稿、竹节机制并入（§5.5）；
- **S1 引擎宿主包**（3–5d + 验证层 1.5–2.5d）：引擎重写（TS ESM，纯逻辑不 import DSH API）+ ≤8 复合工具 + per-tree 串行队列 + 节点状态回流 + 定时 sweep 硬截止 + 验证策略层；
- **视图**：**复用现役 `@local/dsh-session-tree` 插件作为树视图**（节点↔子会话 id 双向记录后自动可视化为嵌套子会话），本仓**不新建面板包**；专用的 `dsh-tree-panel`（展示引擎侧计划树而非会话树）列为 S2 后置项。

### 3.2 显式非目标
- Nanju 全部功能（角色序列/项目注册表/7 目录骨架/快照回滚/HTML 预览）→ 南大项目；
- remote-session HTTP 桥 → 后续独立阶段（上游冻结版 §1 裁剪声明）；
- 会话工具 11 个 / 外部 MCP 桥 → 不移植（DSH 原生覆盖）。

## 4. 运行环境事实（2026-10-04 实测，本机）

| 事实 | 证据 |
|---|---|
| 委派深度 `maxDepth: 3`、并发 `maxActiveSubagents: 20` | `C:\Users\sir_c\.dsh\profiles\desktop\cordis.patch.yml` L143–147 |
| 子会话模型白名单 13 组（deepseek/zai/opencode/xiaomi/minimax 全家族） | 同上 L112–142（`subagent-model-selection-settings`） |
| 全局缺省模型 glm-5.3-flash / effort max | 同上 L4–9（`agent-default-model`） |
| 子会话 backgroundMode: continuable | `@local/dsh-session-tree` README 记录（cordis.yml 1263/1269 行）；continuable 是收割/steer 前提，已就绪 |
| 逐次调用可定义 provider/model/reasoning_effort | `subagent` 工具原生参数（内置 `@deepseek-ai/dsh-tool-subagent`） |
| 角色预设注册表已启用 | 同上 L153–157（`agent-preset-registry`） |
| 可复用现役插件 | `@local/dsh-session-tree`（树视图）、`@local/dsh-session-tree-tools`（tree_send 跨节点消息，README 含实测证据，见 `logs/ref-dsh-session-tree-README.md`） |
| 树引擎本体仓（移植源 + 差分测试基准） | `D:\Codes\tree-harness`（tree-engine.cjs 316,687 B、tests/、01_PRD、03_ARCHITECTURE、加固 PR） |

**深度语义（关键设计约束）**：`maxDepth: 3` 约束的是**会话嵌套深度**，不是逻辑树深度。
- **嵌套派发（默认）**：根会话派 L1 → 节点子会话调 `tree_dispatch` 派 L2 → 至 L3。树结构 = 会话父子结构，session-tree 插件自动可视化。逻辑深度 >3 时引擎拒绝并降级「聚合节点」（只入引擎状态、不派会话）。
- **平铺派发（备选，S0 裁决是否保留）**：全部节点为调用会话直接子会话，树结构仅存引擎状态；无深度限制但丢嵌套可视化和子树上下文隔离。
- 引擎本身为宿主侧插件库，**不占委派深度**；`tools.guard` 可限制仅特定会话可派发。

## 5. 验证策略层（本方案相对上游冻结版的**核心增量**）

> 上游冻结版仅覆盖通用完成断言；分任务类型的验证模式、完成约束前置、验证策略配置化为本项目新增范围。

### 5.1 节点规格扩展

```jsonc
{
  "title": "实现用户服务层",
  "taskType": "code-change",        // 任务类型 → 映射默认验证策略
  "assignee": { "provider": "deepseek-official", "model": "deepseek-v4-pro",
                "effort": "high", "preset": "coder" },
  "verification": {                  // 缺省用 taskType 映射；节点级可覆盖
    "policy": "code-change",
    "override": { "commands": ["pnpm test --filter user"] }
  }
}
```

### 5.2 六种内置验证模式（注册表式，可扩展）

| 模式 | 机制 | 适用 |
|---|---|---|
| `self-report` | 自述完成即过（缺省） | 研究/问答/头脑风暴 |
| `artifact` | 产物存在性 + 形状校验（glob / 最小尺寸 / 正则 / JSON Schema） | 文档、配置产出 |
| `command` | 宿主 `subprocess.spawn` 跑命令（测试/构建/lint），退出码 + 输出模式判定 | 代码实现、重构 |
| `llm-judge` | 派**异族评审子会话**按 rubric 结构化裁决 `{pass, score, gaps[]}` | 方案/报告/文案质量 |
| `composite` | 上述模式 AND/OR 链，失败附失败链 | 复合节点 |
| `human` | `ask_user_question` 升级人工验收 | 关键决策、不可逆操作 |

约束：评审子会话 model/effort 走既有白名单逐次定义；缺省**评审者与执行者异家族**（异构验证）；`ac-verification` 命名策略直接挂 adversarial-convergence-verification SKILL（用户自有资产 → 高风险节点攻防验收）。

### 5.3 完成约束 = DoD 前置注入（执行者与验收者同源）

派发提示词组装 = **角色预设 + 任务描述 + DoD（验证策略生成）+ 约束（禁改路径/预算/接口契约）**。执行者开工即知验收标准；约束与验证器读同一份策略模板，杜绝双标。

```jsonc
// Config：命名策略模板（唯一真源）
"verificationPolicies": {
  "code-change": {
    "dod": ["改动后测试全绿", "不修改 {{forbiddenPaths}}", "产出变更摘要入 K3"],
    "verify": [
      { "mode": "command", "run": "pnpm test", "expect": "exit=0" },
      { "mode": "llm-judge", "model": {"family": "!executor"}, "rubric": "judge-code-change", "threshold": 0.8 }
    ],
    "onFail": "retry:1 → frozen"
  },
  "research-answer": { "dod": ["结论含出处引用"], "verify": [{"mode": "llm-judge", "rubric": "judge-citation"}] },
  "ac-verification": { "skill": "adversarial-convergence-verification", "onFail": "frozen" }
}
```

### 5.4 与状态机整合（不新增状态机）

验证发生在「子会话落定 → 回写终态」之间：pass 才落 `succeeded`；fail 按策略 `retry`（attempt+1，复用冻结版 R4 迁移表语义）或 `frozen` 等待裁决（`decide` 出口）。新增节点观察字段 `verification: {policyId, verdicts[], status}`（面板显示"验证中"）；是否升格正式 `verifying` 态由 S0 定夺。

### 5.5 竹节生长（上下文接力，S0 并入 2026-10-04）

长任务子会话在**上下文窗口达 42%（缺省）时自动换棒**：引擎 sweep 测量水位（宿主 `tokenMeter` 估算为主 ∨ 执行者自报 `tree_report {context}` 为辅，先到者生效）→ 经 `subagents.prompt` 令旧会话输出**交接简报（K1–K5 骨架）** → **先 interrupt 旧会话释放并发名额、后 `startContinuable` 新会话**（防瞬时双占用击穿 maxActiveSubagents:20）→ 新会话提示词 = 角色预设 + 任务书 + 简报全文 + 同一 DoD → `dispatchedAt/lastOutputAt` 按新会话重置 → 节点保持 `running`、`attempt` 不变、`segment.chain` 追加（全树会话 id 唯一）。竞争语义：简报宽限期内未出 → 照常接手并标注 `no-handoff-summary`；超时硬截止/cancel 先到者生效；链长上限超限 → `frozen`。完整设计唯一真源：[docs/segment-handoff.md](docs/segment-handoff.md)（含源引擎竹节证据与 DSH 化差异）。

## 6. 继承自上游冻结版的规约（不重抄，只列索引）

| 语义 | 冻结版位置 | 继承方式 |
|---|---|---|
| 节点状态机 + cancelled + 收割双轨四路径 + timer sweep 硬截止 | §4.1（v1.5/v1.6 修复后形态） | 全文继承 |
| per-tree 串行队列、崩溃幂等重建、审批不升权 | §4.1 / §6 | 全文继承 |
| 29→≤8 工具整合表（tree_plan/node/dispatch/status/log/maintain） | §4.1 工具面 | 继承，S0 定稿 |
| Config 键总表方法论（键名/类型/缺省/校验/出处唯一真源） | §4.7 | 继承并扩展 §7 键表 |
| 状态迁移闭表 + 非法迁移拒绝 + §8 逐条断言风格 | §4.3/§8 | 精神继承（Nanju 棒/序列部分不适用本项目） |
| 差分测试判据（S1 执行时冻结） | §9 R1 | 全文继承 |
| headless 渲染测试 / B1-B3 教训 | §4.2/§8 | 仅 S2 后置项适用 |

## 7. 配置面增量（§4.7 键表新增）

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `verificationPolicies` | object | 内置五模板 | 命名策略模板（§5.3） |
| `taskTypePolicyMap` | object | 内置映射 | taskType → policyId |
| `judgeModelDefaults` | object | `{family:"!executor", effort:"medium"}` | llm-judge 评审者缺省 |
| `verifyTimeoutMinutes` | number | 10 | 单节点验证阶段超时（超时=verdict fail） |
| `maxVerifyAttempts` | number | 2 | 验证重试上限（区别于执行重试 attempt） |
| `segmentHandoff.enabled` | boolean | true | 竹节总开关；taskType 映射可关（短任务无接力收益） |
| `segmentHandoff.thresholdPct` | number | 42 | 竹节触发阈值；节点级 `segment:{thresholdPct}` 可覆盖（§5.5） |
| `segmentHandoff.maxChainLength` | number | 5 | 单节点竹节链上限，超限 `frozen` |
| `segmentHandoff.graceMinutes` | number | 5 | 交接简报宽限期，超期按 `no-handoff-summary` 接手 |

## 8. 里程碑与工作量（更新）

| 阶段 | 内容 | 工作量 |
|---|---|---|
| S0 规约冻结 | **33 工具清单**（buildTreeTable 权威表）+ 引擎行为规约 + 工具面定稿 + storageDomain/timer/sessionQuery 事件面验证 + **验证策略 schema** + **竹节并入** | 1–1.5 d |
| S1 引擎宿主包 | 引擎重写 + ≤8 工具 + 并发队列 + 回流/sweep + **验证策略层**（先 self-report/artifact/command，llm-judge/composite/human 第二批）+ 单测（移植 tree-harness tests + 差分） | 4.5–7.5 d |
| S2 树面板（后置） | 专用计划树面板（会话树之外的引擎侧视图） | 2–3 d |
| **MVP 合计** | **S0 + S1（含验证层第一批）** | **5.5–9 人天** |

## 9. 测试与验收（增量部分）

继承冻结版 §8 全部引擎断言（终态客观化、超时硬截止假时钟断言、误判保护断言、迁移闭集断言、渲染脱敏断言、差分测试），新增验证层断言：
- 每个 policy 模板：DoD 生成 → 派发提示词包含 DoD（字符串断言）；
- `artifact` 模式：产物缺失/schema 不符 → verdict fail 且节点不入 succeeded；
- `command` 模式：退出码非 0 → fail；超时（verifyTimeout）→ fail；
- `llm-judge`：评审子会话模型 ≠ 执行者家族（异构断言）；裁决 JSON schema 校验；
- `composite`：AND 链短路语义；`onFail: retry→frozen` 路径与冻结版迁移表一致；
- 配置：策略模板非法（未知 mode/缺 rubric）→ 装载失败报错含键名。
- **竹节断言（§5.5）**：达阈值自动接力且节点保持 `running`、`attempt` 不变、`segment.index`+1；简报全文入接手提示词（字符串断言）；接力后 `dispatchedAt` 重置、sweep 不误判 `timeout`；旧会话名额释放且**竹节接力瞬时占用 ≤1**（并发水位闸）；缺简报降级 `no-handoff-summary` 照常接手；链长超限 → `frozen`；`cancel`×竹节先到者生效；手动 `handoff` 对非 `running` 节点拒绝。

## 10. 风险与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | 引擎行为保真 | 高 | S0 规约冻结 + 移植原 tests + 差分测试（判据继承冻结版 §9） |
| R2 | 验证策略被绕过（执行者自评分） | 中 | llm-judge 强制异家族；command 模式宿主侧执行不经执行者 |
| R3 | 嵌套派发深度不足（>3 层任务） | 中 | 聚合节点降级 + S0 裁决是否保留平铺模式 |
| R4 | 评审子会话成本放大（每节点 +1 次调用） | 中 | taskType 映射缺省仅高危类型启用 llm-judge；self-report 兜底 |
| R5 | Loader 宿主模块缓存 | 中 | 独立包（新包名即装即生效）；hmr.root 可选 |
| R6 | storageDomain API 形状不符 | 低 | S0 首项验证；回退插件数据目录直写 |

## 11. 新会话工作指引（本目录为工作区时读我）

1. 先读 `docs/frozen-parent-plan/PLAN-v1.7.md` 的 §4.1（引擎语义）、§4.7（Config 方法论）、§8（断言清单）、§9（差分判据）——本方案的全部基线语义在那里，经 57 条攻击七轮闭环；
2. S0 第一步：从 `D:\Codes\tree-harness` 提取工具清单——**权威源 = `proma-dev-patches.cjs` buildTreeTable（L384–541），33 工具含 zod schema 与命令映射**（已完成 → `docs/engine-spec.md`；v1.7 所记 29 为 v0.20 计数，Sprint 5/P1-2 增 4）；
3. 插件工程范式照抄 `logs/ref-dsh-session-tree-README.md`（inject 纪律/Loader 缓存/headless 测试）；
4. 宿主服务 API 以 `logs/dsh-host-services.txt` 实测导出为准，勿凭记忆；
5. 完成定义：MVP = 本方案 §8 全部断言绿 + 实机（用户刷新页面）确认。
