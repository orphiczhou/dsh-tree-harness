# W3 插件设计 — 「元系统工作法方法轮」harness 插件实现级方案

> 设计师：W3（metalp 树 metalp-W3-design 叶）· 2026-10-13
> 输入：W1《方法轮本体分析》（六阶段门禁表、术语表、稳定判据）、W2《引擎映射分析》（原语映射、三处张力、M1-M4/O1-O5）、docs/meta-system-argument.md（§4.2 裕度结构）、docs/proposals-from-agent-notes.md（P3 retro 提案）、packages/dsh-tree-engine/src/ 现状。
> 性质：实现级设计文档，不是实现。所有 schema 给 JSON Schema Draft-07 形状。

---

## 0. 设计总纲（一句话）

**插件 = 循环记账员 + 阶段门禁判官**：为「反馈→分析→策划→决策→实施→检视」递归循环维护强类型状态（轮次/阶段/工件/门禁/裕度快照），提供 1 个复合工具 `meta_loop` 读写该状态；**不建 leaf、不派发、不复检 done 条件**——那是 tree-engine 的主权。插件读 tree-state（只读）以聚合反馈，写只写自己的状态文件。

---

## 1. 状态模型

### 1.1 状态树总览

插件自有单文件状态（存储位置见 §5），顶层：

```jsonc
// meta-loop-state.json — 插件唯一状态文件
{
  "schema_version": 1,          // 强类型；迁移用
  "loop": { ... },              // 方法轮实例（1.2）
  "cycles": [ ... ],            // 第 1..n 轮递归（1.3）
  "margins": [ ... ]            // 相位裕度快照时序（1.5）
}
```

### 1.2 loop —— 方法轮实例（强类型骨架）

```json
{
  "$id": "Loop",
  "type": "object",
  "required": ["loop_id", "created_at", "scope", "current_cycle", "status"],
  "properties": {
    "loop_id":       { "type": "string", "description": "实例标识，建议绑定 tree_id" },
    "created_at":    { "type": "string", "format": "date-time" },
    "scope":         { "type": "string", "enum": ["tree", "workspace"],
                       "description": "tree=单树一轮治理；workspace=跨树（O 阶段后再说）" },
    "current_cycle": { "type": "integer", "minimum": 1 },
    "status":        { "type": "string", "enum": ["active", "stable_declared", "halted"] },
    "stable_declared_at": { "type": "string", "format": "date-time",
                       "description": "status=stable_declared 时必填；可撤销——新反馈到达即回 active" },
    "objective":     { "type": "string", "maxLength": 500,
                       "description": "本轮方法轮治理的总目标（自由文本，LLM/人填）" }
  }
}
```

### 1.3 cycle —— 第 n 轮递归

```json
{
  "$id": "Cycle",
  "type": "object",
  "required": ["cycle_id", "round", "trigger_signals", "stages"],
  "properties": {
    "cycle_id":  { "type": "string" },
    "round":     { "type": "integer", "minimum": 1 },
    "trigger_signals": {
      "type": "array", "minItems": 1,
      "items": { "$ref": "#/$defs/TriggerSignal" },
      "description": "本轮为何开——上一轮触发表产物或外部反馈；W1 §1 第⑥行：无记录不开轮"
    },
    "stages": {
      "type": "array", "minItems": 6, "maxItems": 6,
      "items": { "$ref": "#/$defs/Stage" },
      "description": "固定六项：feedback/analysis/planning/decision/implementation/review"
    },
    "verdict":   { "type": "string", "enum": ["converging", "flat", "diverging", "pending"],
                   "description": "本轮 vs 上轮（W1 §3.1 强判据的结论字段，由 retro 计算填入）" }
  }
}
```

### 1.4 stage —— 六阶段（input/output artifacts + gate 状态）

```json
{
  "$defs": {
    "Stage": {
      "type": "object",
      "required": ["name", "gate"],
      "properties": {
        "name": { "type": "string",
                  "enum": ["feedback", "analysis", "planning", "decision",
                           "implementation", "review"] },
        "input_refs": {
          "type": "array",
          "items": { "type": "string", "description": "上游工件引用（路径或 #/cycles/i/stages/j）" }
        },
        "artifacts": {
          "type": "array",
          "items": { "$ref": "#/$defs/Artifact" }
        },
        "gate": { "$ref": "#/$defs/Gate" }
      }
    },
    "Artifact": {
      "type": "object",
      "required": ["kind", "ref"],
      "properties": {
        "kind": { "type": "string",
                  "description": "强类型枚举：ledger|coordinates|action_table|ruling|margin_table|task_list|retro_report；对应 W1 §1 工件列" },
        "ref":  { "type": "string", "description": "文件路径或结构化内容锚点——工件本体可外置 md/json" },
        "summary": { "type": "string", "maxLength": 300, "description": "自由文本，LLM 填" }
      }
    },
    "Gate": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "status": { "type": "string", "enum": ["open", "passed", "failed"],
                    "description": "open=未评估；passed/failed 由插件机械检查 + LLM 勾验共同判定" },
        "checks": {
          "type": "array",
          "items": { "$ref": "#/$defs/GateCheck" }
        },
        "checked_at": { "type": "string", "format": "date-time" }
      }
    },
    "GateCheck": {
      "type": "object",
      "required": ["rule_id", "result", "evidence"],
      "properties": {
        "rule_id": { "type": "string",
                     "description": "硬编码门禁规则 id，见 §2.2 各 action 前置表（如 G-FB-1 反馈须有证据出处）" },
        "result":  { "type": "string", "enum": ["pass", "fail", "manual_pass"] },
        "evidence":{ "type": "string", "maxLength": 500, "description": "证据引用（行号/查询 id/路径），fail 时空则拒绝" },
        "note":    { "type": "string", "description": "LLM/人补充说明（自由文本）" }
      }
    }
  }
}
```

### 1.5 margin snapshot —— 相位裕度快照（对齐 §4.2 结构）

对齐 meta-system-argument.md §4.2 表的「对象×偏差信号×当前估计×消耗/恢复动作」五列：

```json
{
  "$id": "MarginSnapshot",
  "type": "object",
  "required": ["taken_at", "cycle", "objects"],
  "properties": {
    "taken_at": { "type": "string", "format": "date-time" },
    "cycle":    { "type": "integer" },
    "objects": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["object_id", "deviation_signal", "reading", "estimate"],
        "properties": {
          "object_id":        { "type": "string", "description": "稳定对象 id（如 Z6）；id 强类型，语义由 SKILL 层维护" },
          "deviation_signal": { "type": "string", "description": "可测信号名（强类型建议：signal_key 枚举 + text 说明）" },
          "signal_key":       { "type": "string", "enum": ["write_conflict", "timeout_error", "same_family_rate",
                                    "schema_change", "diff_drift", "session_count", "chain_length",
                                    "budget_usage", "nudge_rate", "custom"] },
          "reading":  { "type": "number", "description": "从 tree-state 读到的即时值（机械采集）" },
          "estimate": { "type": "string", "enum": ["ample", "tight", "negative", "unknown"],
                        "description": "裕度估计——不给公式（W2 §1.4：量化留给人），但估计档位强类型" },
          "consume_actions": { "type": "array", "items": { "type": "string" }, "description": "消耗裕度的动作（自由文本，LLM 填）" },
          "restore_actions": { "type": "array", "items": { "type": "string" }, "description": "恢复动作（自由文本）" }
        }
      }
    },
    "tightest": { "type": "string", "description": "最紧裕度对象 object_id——决策阶段输入（自由文本判定，但字段强类型）" }
  }
}
```

### 1.6 强类型 vs 自由文本的分界原则

| 类别 | 字段举例 | 谁写 |
|---|---|---|
| 结构化强类型（schema 校验拒收不合规） | stage 名/顺序、gate status、GateCheck.rule_id/result、margin.estimate 枚举、cycle.round、trigger.signal_kind、verdict | 插件代码机械写 / LLM 按枚举选 |
| 自由文本（maxLength 限幅，不校验语义） | objective、artifact.summary、check.note、consume/restore_actions、五问答案、APX 裁决理由 | LLM 填写，人可覆核 |
| 明确不进状态（W2 §1.4 禁区） | 第一人称视角字段、向心力数值、六类标签枚举、「为何存在」的机内答案 | —— |

分界理由：**凡是会驱动闸门/判定/顺序的字段必须强类型；凡是「人的判断」只做登记与限幅，不做语义校验**——校验不了的东西强类型化只会制造表格填充仪式（W2 对向心力量化的否决论证）。

---

## 2. 工具面：单一复合工具 `meta_loop`

只做 1 个工具（不是 2 个）：六阶段门禁本就是状态机迁移，拆成多工具会暴露内部状态机碎片。action = 迁移动词。

```
meta_loop { action: init | feedback | advance | decide | retro | status }
```

### 2.1 action 逐项规格

**init** —— 开方法轮（M1）
- 输入：`{ tree_id: string, objective: string, first_trigger: TriggerSignal }`
- 输出：`{ loop_id, cycle: 1 }`
- 前置：无进行中 loop（同 scope）；first_trigger 非空（W1：无触发记录不开轮）。

**feedback** —— 登记反馈条目（阶段①，M2 半环）
- 输入：`{ entries: [ { source: enum[drift|verify|heartbeat|sweep|communication|external],
  signal_kind: enum, evidence: string, note?: string } ], query?: { since_cycle: int } }`
- 输出：`{ ledger_ref, aggregated: [ ...从 tree-state 只读聚合的反馈原材料... ] }`
- 前置：当前 stage=feedback；每条 entry 必须有 evidence（G-FB-1：无证据反馈不得进入分析，W1 §1 ①）。
- 说明：带 `query` 时插件只读扫描 tree-state（drift_log / verify verdicts / heartbeat / sweep events / communication_log），把原材料聚合返回但**不写入引擎状态**——M2 的「反馈聚合查询」即此。

**advance** —— 工件落账 + 门禁判定 + 阶段推进（M1 的状态机半环）
- 输入：`{ artifacts: [Artifact], gate_evidence?: [GateCheck 填充] }`
- 输出：`{ new_stage, gate: 逐条 checks 结果, blocked?: rule_id }`
- 前置：当前阶段 gate 通过才推进；review 阶段通过时自动生成 TriggerSignal 候选并置 verdict。
- 门禁规则硬编码于插件（每阶段一组，id 稳定）：
  - G-FB-1 反馈条目均有 evidence；G-AN-1 五问 4/5 非空；G-AN-2 断点清单逐条标开/闭；
  - G-PL-1 覆盖性：每个断点 id 在动作表中至少出现一次（断点 id 是强类型可机械对账）；
  - G-DE-1 每「选」方向关联稳定对象 id；G-DE-2 每稳定对象至少一个偏差信号；
  - G-IM-1 任务清单逐项勾验；G-IM-2 「缓」项有启用条件；
  - G-RV-1 结果 vs 预期比对完成；G-RV-2 残余问题逐条登记；G-RV-3 触发表至少一条被评估。
  - （对照 W1 §1 门禁列逐条翻译；语义校验不了的（如「五问答得好不好」）只查非空/存在性。）

**decide** —— 裁决与裕度落账（阶段④，O1/O2 的薄版进 MVP）
- 输入：`{ rulings: [ { candidate: string, verdict: enum[select|defer|drop],
  target_object_id?: string, reason: string } ],
  margin_snapshot?: MarginSnapshot 输入 }`
- 输出：`{ ruling_table_ref, margin_ref, tightest }`
- 前置：当前 stage=decision；每条 select 必须带 target_object_id（G-DE-1）；margin_snapshot 提供时机械采集信号即时值（sessionCount、链长、预算占用——从 tree-state 读）并与 LLM 填的 estimate 合并。
- 明确不做：不计算向心力分数；reason 是自由文本账本（O2 的薄版：可审计但不打分）。

**retro** —— 全树总体检视（M3）
- 输入：`{ window: enum[last_cycle|last_n], n?: int }`
- 输出：`{ retro_report_ref, residuals: [ ... ], trigger_signals: [TriggerSignal] | [], verdict }`
- 前置：当前 stage=review；至少一个已完成 cycle。
- 行为：只读汇总 events/drift_log/call-log + 本插件历史 cycles，产检视报告工件；按 M4 触发表规则（§2.3）判定递归触发——trigger_signals 非空则开下一 cycle，空且强判据连续 N 轮全绿则允许 `stable_declared`。

**status** —— 查询当前轮/阶段/门禁/裕度
- 输入：`{ verbose?: bool }` → 输出：loop 摘要 + 当前 stage gate 详情 + 最近 margin snapshot + 触发信号。只读。

### 2.2 与 tree_* 工具不重叠（边界清单）

| 插件不做 | 归属 | 理由 |
|---|---|---|
| 建 leaf / 改依赖 / 派发 / 取消 | tree_plan/tree_node/tree_dispatch | W2 §2.2 张力②：节点内与派发是引擎主权 |
| 复检 done 三重闸 | tree_report/state.js | W2 §2.2 张力③：合规门禁归引擎；插件 decision 只管方向取舍 |
| drift 写入 | tree_report drift 体系 | 反馈的「采集」半环在引擎；插件只读聚合 |
| verify / adversarial | tree_verify | per-node 验证是执行层；retro 是 per-round，不重跑验证 |

---

## 3. 与 tree-engine 关系（专章）

**结论：独立插件、协同只读。** 插件有自己的状态文件（`tree-engine-data/<tree_id>.meta-loop.json`，见 §5），通过宿主侧只读读取 tree-state 做反馈聚合与裕度采样；**零写入引擎状态**。理由：

1. **引擎状态形状不含 loop 概念**（engine.js init：leaves/drift_log/…/backups，W2 §1.3 实测）——扩展引擎顶层字段需要动引擎，违背「插件」边界；而 loop 状态的读写方只有插件自己，外置无一致性代价。
2. **依赖单向**：插件→（读）tree-state。tree-state 是引擎产物且有 drift/events 等完整留痕，天然是反馈原材料真源（正源原则：不为同一信息建第二真源）。插件状态文件只存引擎**没有**的东西（轮次、阶段、门禁、裁决、裕度时序）。
3. **崩溃隔离**：插件状态损坏不污染树；引擎回滚（restore）也不销毁方法轮记忆。

### 3.1 分层命题检验：「插件=执行治理层（怎么打循环），引擎=任务执行层（怎么把活分下去干完）」

继承 W2 §2 结论：**分层成立，附三条设计约束**。W2 的三处张力逐一化解为设计约束：

| W2 张力 | 事实 | 本设计的化解约束 |
|---|---|---|
| ① 竹节铁律已下沉引擎：engine.js:470 注释引 meta-system §4.2，「先 interrupt 后 start」本是一次裕度决策，已固化为执行不变式——治理决策会不可逆下沉 | 边界非单向，插件不能重复裁决 | **约束 C1（不重复裁决已下沉项）**：插件门禁规则（G-*）只覆盖六阶段工件完整性，不含任何派发许可判断；裕度快照里 Z6 类信号只做登记（L0 观察），consume/restore_actions 仅记录既有引擎机制名，不新设第二套闸。插件读到的「已下沉决策」在 retro 里作为既成事实入账，不重裁。 |
| ② 节点内自治循环已存在：adversarial attack→fix 回灌、竹节 sweep「观测→触发→交接」，执行层不是被动层 | 若插件也管节点内循环即双头指挥 | **约束 C2（主权=跨轮/跨节点）**：meta_loop 状态以 cycle/stage 为粒度，state 里无 leaf_id 维度（retro 汇总除外，且只读）；G-IM-1 任务清单勾验的是「清单项」而非引擎 leaf 状态——清单与 leaf 的映射由指挥官 SKILL 层维持，插件不感知节点生命周期。 |
| ③ done 三重闸占用「决策门禁」语义 | 若插件 decision 复检 done 条件即冗余双标 | **约束 C3（决策=方向取舍，非合规复检）**：decide 的 ruling 结构只有 candidate/verdict/target_object_id/reason，没有任何「该节点能不能算完成」的字段；门禁 G-DE-* 校验的是裁决表自身完整性（每个 select 有落点、每个稳定对象有信号），与引擎 done 闸正交。 |

**分层论证成立的最终表述**：引擎回答「这个活能不能派、能不能结算」（闭集状态机 + 三重闸），插件回答「现在该反馈还是该分析、这一轮比上一轮稳了吗、要不要再递归」（cycle/stage 状态机 + G-* 门禁 + M4 触发判定）。两个状态机无共享字段、无共享迁移动词，接缝只有只读数据流（tree-state → 反馈聚合/裕度采样）——这是 Z4 接口缝原则在插件层的重演。

---

## 4. 最小实现边界（MVP）

### 4.1 必做（对齐 W2 M1-M4）

| # | W2 原语 | MVP 落点 | 削减说明 |
|---|---|---|---|
| M1 | loop 状态 | §1 状态模型 + `init/advance/status` | 完整做 |
| M2 | 反馈聚合查询 | `feedback` 的 query 半环（只读扫描 tree-state） | 只聚合不「汉化」：返回结构化条目，措辞整理留给 LLM |
| M3 | 总体检视 retro | `retro` action | 等价 P3 的 retro 动作但落插件侧（不动 tree_maintain，避免改引擎工具面）；lessons 检索注入不做 |
| M4 | 递归触发判定 | `retro` 内置规则表（§2.3） | 规则表硬编码 4 条（见下），自定义规则后置 |

M4 规则表（MVP 硬编码）：① verify verdict 出现新 FAIL 或 adversarial FAIL findings 未清 → 开新 cycle、stage 回 analysis；② 触察期内竹节/降级事件频次超阈（frozen 或 degraded-lazy 计数 > N）→ 开新 cycle 回 analysis；③ 预算占用 > 80% → 开新 cycle 回 decision（先裁砍不砍）；④ 新外部反馈到达（feedback 登记 external 条目）→ 按信号类型回流对应阶段。

### 4.2 后置（O1-O5）

| # | 内容 | 后置理由 |
|---|---|---|
| O1 | 裕度周期采样（定时器自动 snapshot 时序） | MVP 只在 decide 时按需快照；时序累积需宿主 timer 端口，先验证快照形状好用再加 |
| O2 | 决策账本完整版（跨 cycle 检索、裁决一致性对账） | MVP 的 ruling 落账已够审计起步 |
| O3 | lessons 滚雪球（P3 全量：检索注入建点 prompt） | 需动 tree_maintain 或 commander SKILL，跨插件 |
| O4 | 1115 分析画布 schema（analysis artifacts 的结构化模板） | 先用自由文本 artifact + G-AN-1/2 存在性门禁；结构化收益待实证 |
| O5 | 事件驱动派发（P2 deps-ready） | 引擎提案未立项，与插件无耦合，不捆绑 |

### 4.3 明确不做（不硬造，留 SKILL/prompt 层）

- **系统第一人称视角**：叙述性世界观，机化为永不变字符串，零闸门收益（W2 §1.4）→ SKILL 层语境注入。
- **向心力量化**（引力/斥力打分）：人的价值判断，插件只提供可测证据（预算/不变式触碰），赋值写 reason 自由文本。
- **六类方法（固本/正源/…）自动分类**：组织注意力的分类学，非数据结构；动作表 artifact 允许 LLM 自行按六类组织文本，但不做枚举字段。
- **五问之「为何存在」机内作答**：目的论问题，任何机化答案都是预写文本。

---

## 5. 存储与 tree-engine-data 的关系

- **建议位置**：`tree-engine-data/<tree_id>.meta-loop.json`（与引擎数据同目录树、不同文件前缀）。
- **理由**：① 与树的备份/归档生命周期天然同置（tree_maintain backup 快照树文件时可顺带，虽然 MVP 不强求）；② scope=tree 的状态按 tree_id 分文件，天然支持多树并行各一轮；③ 不放引擎 state 内部（§3 结论），也不放插件安装目录（状态是数据不是代码）。
- **与 tree-engine-data 现有文件的关系**：只新增文件，不改任何现有文件格式；未来若 P3 lessons.jsonl 落地，retro 可向其追加（追加，不读写删除）。
- **并发**：单树单 loop 文件，插件侧写走「整文件读-改-原子写」（tmp+rename）；引擎对插件文件零访问，无跨层写冲突（Z1 一致性裕度不受消耗）。

---

## 6. 实现清单（给 W4 的交接面）

1. 插件骨架：注册 `meta_loop` 单工具（六 action），schema 校验 Draft-07。
2. 状态文件读写器（原子写 + schema_version 迁移钩子）。
3. tree-state 只读适配层：drift_log/heartbeat/communication/sweep events/verify verdicts 聚合查询 + 裕度信号即时值采集（sessionCount、链长、预算占用）。
4. G-* 门禁规则引擎（12 条规则，纯函数：state×artifacts→checks）。
5. M4 触发判定（4 条硬编码规则）。
6. SKILL 层配套文档：第一人称语境、六类组织法、五问作答指引（不在插件内，但随插件分发）。

> 完成定义回指：本文件即 W3 产物；验收 = 文件存在且形状合规（六阶段 schema、单工具六 action、与引擎关系专章含三张力化解、MVP 边界四表）。
