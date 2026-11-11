# 竹节生长（Segment Handoff）机制 — 设计备忘

| 项 | 值 |
|---|---|
| 状态 | **S0 议题已登记，待规约冻结时并入 PLAN.md**（用户 2026-10-04 裁决：暂不改方案文档） |
| 提出日期 | 2026-10-04 |
| 阈值缺省裁决 | **42**（区间 40–45 中点；Config 与节点级均可覆盖） |
| 来源 | 源引擎既有机制（非全新发明）——tree-engine.cjs 内建 bamboo-joint handoff，但**掉出了本仓继承清单**：grep 实测 PLAN.md 与冻结版 PLAN-v1.7.md 零处提及 segment/竹节/context_usage |
| 并入目标 | PLAN.md 新增一节 + §7 Config 键表 + §9 断言 + §8 S0 交付物；冻结版 §4.1 不新增状态机状态（竹节发生于 `running` 内部，符合红线） |

## 1. 需求陈述（用户原话语义）

分解后每层的子会话中，有需要长时间执行任务的：要在**上下文窗口用到 40–45% 时**总结出交接文件，由**同层级新会话接手继续执行**。该机制命名为**竹节生长**。

## 2. 源引擎既有机制（实测证据，D:\Codes\tree-harness）

| 部件 | 位置 | 语义 |
|---|---|---|
| 专用状态位 `segment_pending` | tree-engine.cjs:68（枚举）、:74–78（迁移表）、:4707（`active → segment_pending` 竹节交接中） | 竹节态是 leaf 状态的一员；`segment_pending → active` 为接手回流；`segment_pending → segment_pending` 幂等 |
| 刚性自动触发 | tree-engine.cjs:2294–2313（`leaf set-context <tree_id> <leaf_id> <pct>`） | 执行者上报 `context_usage_pct`，`≥ audit_meta.ctx_segment_threshold`（缺省 **85**）且非 root 且 active → 自动置 `segment_pending` + drift 留痕，reason 原文 `(bamboo-joint handoff)` |
| 接力登记 | tree-engine.cjs:3120–3168（`segment append <tree_id> <leaf_id> <new_session_id>`） | 新会话 id 追加 `leaf.segment_chain`，**全树会话 id 唯一性校验**（:3136–3144），drift 记 `reason:'segment_handoff'` + `to_session` |
| 竹节链 | `leaf.segment_chain` | 同一 leaf 上先后接力的会话 id 链；max_sessions 护栏对 segment 复用不多计（:1144、:1396 错误文案 "reuse sessions (segment handoff)"） |
| 工作流纪律 | skills/tree-worker/SKILL.md:50、:70、:686–688、:728 | 规则 5「超 85% 甜点主动声明 → 哨兵 Agent 竹节强制交接」；上行消息附 `context_usage` 字段；接手简报 ≤2K tokens（进度 + 关键发现 + 未完成 milestones）；`s<N>` 竹节序号命名；任务书持久化进 leaf「竹节交接不丢」 |

## 3. 与本需求的差距（四点）

1. **阈值**：源缺省 85% 是"甜点风险"被动防线（自报滞后所致）；需求 40–45% 为主动生长。宿主侧客观测量可支撑更早交棒，接手会话几乎拿全窗口。
2. **触发可靠性**：源机制为执行者自报（软信号）。DSH 侧 `tokenMeter.measure(session)` / `estimateMessage` 可做宿主侧客观估算；自报降为二级信号（继承 `set-context` 语义）。
3. **自动化程度**：源为半自动（哨兵/指挥官看到 `segment_pending` 后指令交接、调 append）。本项目 `tree_dispatch` 本为引擎内部转 `subagents.startContinuable`，竹节可做成**引擎全自动**；触发载体重用冻结版 §4.1 定时 sweep（双轨收割④）。
4. **规约缺位**：冻结版节点状态机无竹节位——**这是对的**（竹节发生于 `running` 内部，不新增状态机状态）；但机制本体、竞争语义、配置键、断言必须补入 S0 规约。

## 4. 机制设计

**原则：节点状态不变，只有关联子会话轮换。** `attempt` 不变（竹节 ≠ 重试；重试计数只属失败/超时路径）。新增节点观察字段：

```jsonc
"segment": { "chain": ["<sessionId>"], "index": 2, "lastHandoffAt": "<ISO>" }  // 面板可见「第 N 节」
```

接力流程（全自动为主；`tree_dispatch {action:"handoff"}` 保留手动触发，对应源 SKILL 的手动竹节）：

1. **测量**：sweep 周期逐 `running` 节点读 usage——宿主侧 `tokenMeter` 估算 ∨ 执行者自报（二级），先到者生效；
2. **交棒指令**：≥ 阈值 → 引擎经 `subagents.prompt`（持久化父地址授权，tree_send 同款先例）令旧会话输出结构化交接简报（复用 R8 K1–K5 骨架：进度 / 关键发现 / 未完成 / 产物引用 / 继续指针）；
3. **释放名额 → 接手**（顺序约束修正：**先 interrupt 后 start**，防瞬时双占用击穿 `maxActiveSubagents: 20`）：简报到达后先 interrupt 旧会话并确认名额释放，再 `startContinuable` 新子会话；自适应旁路——引擎派发闸检查并发水位，水位 +1 ≤ 上限时可在旧会话 settle 期间提前 start（L1 自适应，缺省保守串行）。新会话提示词 = 角色预设 + 原节点任务书 + **简报全文** + DoD（同一验证策略，PLAN §5.3 前置注入不换版）+ 约束。任务书在引擎状态里，竹节天然不丢；
4. **落账**：`segment.chain.push(newSessionId)`（继承全树会话 id 唯一校验）；**`dispatchedAt`/`lastOutputAt` 按新会话重置**（否则 sweep 立即误判 timeout——与冻结版收割语义最关键的咬合点）；旧会话收割落账为节点历史（不终态、不计失败）；
5. **竞争语义**（沿用冻结版「先到者生效」范式）：简报宽限期内不出 → 照常接手、简报标注 `no-handoff-summary`（同 Nanju skip 的 no-predecessor-summary 模式）；超时硬截止先到 → `timeout` 赢、竹节中止；`cancel` 同理；
6. **防竹节风暴**：`segment.chain` 长度上限 → 超限 `frozen` 等裁决（复用既有 frozen 语义）；
7. **与宿主压缩的关系**：触发点（~42%）远低于 DSH 自动压缩触发点，竹节先于压缩发生。配套纪律 = SKILL 规则 5 的哲学：**进度落盘、会话可弃**——阈值越早，简报越从容，隐性上下文损失越小。

## 5. Config 键增量（并入 PLAN §7 时使用）

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `segmentHandoff.enabled` | boolean | true | 总开关；taskType 映射可关（研究类短任务无竹节收益） |
| `segmentHandoff.thresholdPct` | number | **42** | 触发阈值；节点级 `segment:{thresholdPct}` 可覆盖 |
| `segmentHandoff.maxChainLength` | number | 5 | 单节点竹节链上限，超限 `frozen` |
| `segmentHandoff.graceMinutes` | number | 5 | 简报宽限期，超期按 no-handoff-summary 接手 |

节点规格扩展（接口缝 §2.2 同源）：`node.segment = { enabled?, thresholdPct?, policy?: 'auto' | 'manual' | 'off' }`。

## 6. 断言增量（并入 PLAN §9 时使用）

- 达阈值 → 自动接力：节点保持 `running`、`attempt` 不变、`segment.index` +1；
- 交接简报全文出现在接手会话提示词中（字符串断言，同 DoD 注入断言风格）；
- 接力后 `dispatchedAt` 重置：sweep 不将新会话误判 `timeout`；
- 旧会话已 interrupt：`maxActiveSubagents` 名额释放；**竹节接力瞬时占用 ≤1**（并发水位闸断言：串行模式下接力全程引擎并发计数不 +1）；
- 简报缺失降级：`no-handoff-summary` 标注下照常接手，节点不 `failed`；
- 链长超限 → `frozen`，等待裁决；
- `cancel` × 竹节竞争：先到者生效，不叠加；
- 手动 `tree_dispatch {action:"handoff"}`：非 `running` 节点拒绝。

## 7. S0 验证项（并入 PLAN §8/S0 交付物时使用）

1. `tokenMeter.measure` / `TokenMeasurement` 实际形状；能否按 sessionId 估当前上下文填充；
2. 各模型上下文窗口元数据来源（cordis.patch.yml subagent-model-selection-settings 是否携带；否则 Config 映射 model→window）；
3. `ContinuableStartSpec` 形状：审批策略传递、按会话关闭宿主自动压缩的开关是否存在；宿主压缩触发点实测；
4. `subagents.interrupt` 的 `SubagentInterruptAuthority` 形状（引擎侧代表父会话中断的合法授权方式）；
5. 旧会话简报等待的实测通路：`subagents.prompt` 发交棒指令后，简报作为最终回复经哪条收割路径（①②③）回收。

## 8. 并入计划（S0 冻结时执行）

1. PLAN.md：§5 后新增「§5.5 竹节生长（上下文接力）」；§7 增上表 4 键；§9 增第 6 节断言；§8 S0 交付物增本文件第 7 节验证项；
2. README.md 文档表增本文件行；
3. `docs/engine-spec.md` 起草时按本文件口径包含 segment 语义（29→8 工具整合表中 `segment append` / `set-context` 归入 `tree_dispatch` / `tree_status` 的 action）；
4. 冻结版 §4.1 不改动（竹节为引擎内 `running` 子机制，节点状态机闭集不变）。
