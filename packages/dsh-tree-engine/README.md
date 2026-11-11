# @local/dsh-tree-engine

树形任务分解执行引擎（DSH 宿主插件）。行为基准：[docs/engine-spec.md](../../docs/engine-spec.md)（S0 冻结）；工具面契约以本包 `index.js` 的 8 个工具 schema 为准（[docs/tools-mapping.md](../../docs/tools-mapping.md) 是 S0 设计表，含未实现的 action，仅供设计参考）。

## v0.5.0 增量：SKILL 工程化（包内技能 + skill provider + 50% 交接纪律）+ 审计修复

- **技能迁入包内**：`skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md`（此前在仓根 `skills/`，未被任何 skill provider 加载）。现在随包发布、随包版本迭代。
- **活体装载**：`cordis.patch.yml` 第二条 insert 挂载 `@deepseek-ai/dsh-skill-filesystem`（`providerName: tree-engine`、`includeDefaultRoots: false`、`bundledSkillDir` 经安装包身份解析到本包 `skills/`）——新会话的 Skill 目录里能看到 `tree-commander` / `tree-worker`，模型不必被点名工具也能按 skill 工作。
- **会话交接纪律入 skill**：每个被派发的 leaf 是独立 DSH 会话；除引擎竹节（`tree_report {action:"context"}` 自报，pct≥42 触发接力）外，skill 要求会话在 `session_handoff {action:"status"}` 的 `context_pct ≥ 50` 时**自主交接**给同层级新会话（`session_handoff` 由会话树单包提供，缺省 auto：子会话→同父兄弟），并在 `tree_report {action:"progress"}` 里留下交接文件与新会话 id，供 commander 继续收割。
- **B1 修复（v0.5.0，审计 BLOCK）**：竹节接力成功后把 `leaf.session_id` 重绑到接手会话——此前接力会话写 `done` 会被 `E_BORROWED_IDENTITY` 拒、leaf 只能等 `nodeTimeoutMs` timeout；现在接力会话可正常收口（回归测试见 `tests/orchestrator.test.js` "B1 回归"）。
- **工具描述与审计对齐**：`tree_verify`（六种模式、FAIL 不抛错/不阻断 succeeded、cwd 来自 exec）、`tree_dispatch`（dod 不生效、assignee.preset 不生效、接力 owner 重绑）、`tree_node`（里程碑面无工具命令、收口以 runtime.succeeded 为准）、`tree_report`（宿主 tokenMeter 已接入）、`tree_status`（harvest 语义）与实际实现对齐；启动日志版本号与 sweep 兜底说明修正（timer 服务缺失时仍有进程内 60s 间隔，sweepMode=timer）。
- **测试**：**67/67**（62 引擎 + 4 技能打包 `tests/skills.test.js` + 1 竹节 owner 回归）。
- ⚠️ 宿主半/配置热更：patch 行改动需对 `include:tree-engine` 做一次 disable→enable（Loader 按包名缓存宿主模块，见仓库 [agent.md](../../agent.md) D12）。

## v0.3（S1 第三批）——**8/8 工具面齐 + 验证层第一批**

- **工具面（全量 8 个）**：tree_plan / tree_node / tree_dispatch / tree_report / tree_status / **tree_verify** / **tree_log** / **tree_maintain**。
- **验证策略层第一批**（src/verify.js）：self-report / artifact（glob+minSize+regex+jsonSchema）/ command（退出码+超时硬杀=verdict fail）；策略装载期校验（未知 mode/缺 glob/run → 报错含键名不静默）；DoD 前置注入生成器（与验证器同模板）；AND 短路；端口 fail-closed。
- **核心命令补齐**：event:list、drift:append/list（三层纠偏枚举）、heartbeat:append/tail（哨兵巡逻）、communication:log/list（外部通信可观测，防心跳误判冻结）、nudge:reset、tree:register-session（旁路登记幂等）、backup/restore（状态内快照×10，恢复前快照+tree_id 匹配校验；文件级随 storageDomain 适配）。
- **测试**：**40 项全绿**。

## v0.3.1 增量（S1 第四批）：差分金标准落地

- **tests/diff.test.js**：同输入序列喂源引擎（`D:\Codes\tree-harness\tree-engine.cjs` 直连 require）与本引擎，投影逐字段深度相等——**首跑全链一致**（init → leaf add → brief_echo → set-context → segment append；非法输入三例行为一致）。
- **差分驱动修正**（源规则实测对齐）：path 精确规则（`path ≡ leaf_id 的 path 段`，如 'C1'）；root leaf `added_by=null`、`model/channel='unknown'`；源 `run(cmd, args, treesRoot?, caller?)` 签名。
- **冻结偏差登记**：[tests/diff.DEVIATIONS.md](tests/diff.DEVIATIONS.md)（D-v1 错误字段名 / D-v2 E_CALLER_REQUIRED 待移植 / D-v3 startup_notice 由派发提示词承担 / D-v4 完整性签名列尾批）。
- **测试**：**43 项全绿**。
- ⚠️ 工程教训：PowerShell `Set-Content` 会以系统编码毁 UTF-8 中文文件——测试文件一律用 write/edit 工具维护。

## v0.3.2 增量：五项 API 形状升级为源码级验证

经 `scripts/asar-tool.cjs` 直读 `app.asar` 实现源，修正宿主适配三处：
1. **dispatch 端口**按权威 `ContinuableStartSpec {provider*, label*, request{prompt: ContentBlock[]}, signal}` 传参，返回取 **childId**（原实现传参形状错误）；
2. **callerOf** → `exec.agent?.session`（dsh-tools 实证）；
3. **timer** → `ctx.timer` 直用（cordis-plugin-timer `ctx.mixin("timer")` 实证；保留 ctx.get 兜底）。

证据落盘：[docs/engine-spec.md §8](../../docs/engine-spec.md)；smoke 清单收窄至 5 项装载实测。

## v0.4.0 增量：对抗式验证(异族攻击-防御-审计迭代,≤3 轮)

- **tree_verify {action:"adversarial"}**:每轮 = 结构检查(既有 policy/taskType 路由)+ **异族红队攻击会话**(缺省 DeepSeek-V4-Pro,`TREE_ENGINE_JUDGE_ASSIGNEE` 可配;与执行者异族防同源偏置——随感 #33/#30)→ FAIL 则 findings 回注执行者修复 → 下一轮;≤max_rounds(1-5,缺省 3)。
- **裁决回收双通道**:文件握手为主(judge 把裁决 JSON 写引擎指定绝对路径,轮询文件——确定性免疫会话形状/时序)+ readSession ATTACK_VERDICT 提取为辅;超时 fail-closed(缺省 300s,`attack_timeout_ms` 30s–600s 可调,超时后终局再收一次)。
- **修复回注双路径**:①交棒通道 prompt 原执行者(父会话活)②**同叶自动重派修复会话**(原父会话死时兜底;轮询其 succeeded 再进下一轮,attempt 递增留痕)。
- **裁决落账**:`leaf:set-verification` 透传 rounds 逐轮(structural/attack/findings/fixed)。
- **hostGlob P0 修复**(advtx E2E 抓出):①'**' 零段匹配(顶层文件可命中)②返回绝对路径(此前相对路径按引擎进程 cwd 解析→ENOENT);Set 去重;单测回归(export hostGlob)。
- **E2E 四轮迭代实证(tree advtx)**:GLM worker 埋两雷(光速 10 倍错误 + 100% 夸大)→ DeepSeek 红队 100% 命中并挖出逻辑矛盾 → **全自动**(无人工干预)重派修复会话真实清除埋雷 → 复审;终态 3 轮 FAIL 属红队逐轮升级(攻强守弱),闭环每环均被观测。已知行为:对抗强度螺旋下 max_rounds 可能耗尽,终态 FAIL=如实反映"仍有可攻击点"。
- **测试**:61 项全绿(含攻防循环/结构跳过攻击/端口 fail-closed/rounds 落账/hostGlob 回归)。

## v0.3.9 增量：竹节简报回收 + 验证 batch-2 + usagePct + Config 校验 + 差分扩面（handoff §7 任务 3–8 主体）

- **K1–K5 交棒简报回收 + 宽限**（任务 4）：promptHandoff 发交棒指令后按 grace 轮询 readSession（上限 min(graceMs,12s)），防御性提取含 K1/K2/K5 标记的简报全文；超时/不可提取 → no-handoff-summary 降级。**E2E 真机实证（tree e2erly）：chain 0→2，bamboo(ok) 全文回收，attempt=1，succeeded**。
- **usagePct 宿主测量接入**（任务 5）：tokenMeter.measure（readSession 快照 → measure → pct/context.pct/pressure.pct 防御提取，0–1 归一）；首调用经 apply.log 冻结返回形状；任何失败返回 null → 自报信号生效（先到者生效）。
- **验证层 batch-2**（任务 6）：`llm-judge`（ports.judge 异族评审，rubric 必填，fail-closed）/ `composite`（checks[] 平铺 AND 链，嵌套 composite 装载期拒）/ `human`（approval=never 降级 = frozen 待裁：pass=false+pending，人工经 policy_id 显式覆盖裁决）。
- **Config schema 装载期校验**（任务 8，src/config.js）：TREE_ENGINE_CONFIG JSON 全键类型/范围校验，未知键拒绝；非法即装载失败（apply 终止、工具不注册），报错含键名；护栏键进 config、编排键进 orchestra 自动拆分。
- **差分扩面**（任务 7 主体）：52 组 LCG 生成调用序列（合法+非法混合）逐调用 ok 一致 + 终态投影一致；新冻结偏差 **D-v5**（源可恢复错误自动 drift）/ **D-v6**（源 leaf add 必填 model）登记 [diff.DEVIATIONS.md](tests/diff.DEVIATIONS.md)。
- **tree-worker SKILL 重写**（任务 3，`skills/tree-worker/SKILL.md`，v0.5.0 起位于本包 `packages/dsh-tree-engine/skills/tree-worker/SKILL.md`）：8 工具语法、开工四步/竹节协议/护栏表/一图流；**剔除 tree_leaf_autonomy_override 漂移引用**（用 drift 申报替代）。
- **E2E**：e2ev39（依赖闸+路由+validate 全过）+ e2erly（竹节 relay 专项，简报全文回收）。
- **测试**：**56 项全绿**（52 + 4：llm-judge 三态/human 降级+composite 展开/Config 校验）。剩余：observeSession 事件面（§7-9，宿主形状未冻结）与 llm-judge 宿主 judge 端口装配（评审会话派发）列下批。

## v0.3.8 增量：dependencies enforcement + taskType 验证路由（handoff §7 任务 1/2）

- **节点 `dependencies` 引擎侧 enforcement**：leaf:add 装载期校验（string[] / 存在性 / 自指 / 重复 / DFS 环检测纵深防御）；`dispatch:start` 前置依赖闸——所有依赖节点须 `status=done ∨ runtime.state=succeeded`，否则 `E_DEPENDENCY_NOT_MET`（含各依赖当前状态明细）。
- **`leaf.taskType` 验证策略自动路由**：leaf:add 存字段（字符串校验）；派发端口透传 taskType（DoD 注入按类型取模板）；tree_verify 缺省 policy_id 时按 `leaf.taskType → taskTypeMap → default` 解析（research/question→research-answer，doc→artifact-doc，code-change→code-change）；裁决经新命令 `leaf:set-verification` 持久化到 `leaf.verification{ts,policy_id,pass,verdicts}` + progress 事件观测。
- **E2E 真机实证（tree e2edep，单代际）**：B2 依赖 B1——B1 未完成时 dispatch B2 被拒（E_DEPENDENCY_NOT_MET 原文含状态明细）；B1 done 事件回流 succeeded 后同调用放行；B2 产物 [demo/e2edep-notes.md](../../demo/e2edep-notes.md)；verify 无 policy_id 路由至 artifact 模式（policy_id 落账为请求键 "doc"，verdicts.mode=artifact 证明模板命中）；validate 0 issues。
- **测试**：**52 项全绿**（47 + 5 新增：装载期拦截 / 环不误伤 / 依赖闸双向 / set-verification 落账 / taskType 校验）。
- ⚠️ 工程教训复现：pwsh `Set-Content -Encoding utf8` 仍引入 BOM + mojibake（GBK 读入）——文件改动一律 write/edit 工具，本轮已用 git checkout 恢复重做。

## v0.3 边界（诚实声明）

1. 装载 smoke 未做（同 v0.2：startContinuable/prompt/interrupt 形状、caller 提取、timer 注入——今晚装载后实测）；
2. 验证层第二批（llm-judge/composite/human）未实现——策略引用即装载报错（fail-closed）；
3. 节点级 verification.policy 解析未流经核心 bambooRelay spec（竹节接手提示词的 DoD 暂走 default 策略）；
4. command 模式经 child_process（宿主侧执行不经执行者 ✓）；DSH subprocess 服务适配为 smoke 后可选项；
5. backup/restore 为状态内快照（语义对齐：轮转 10/恢复前快照/跨树校验；文件级落盘随 storageDomain）。

## v0.2（S1 第二批）

- **核心**（`src/`，纯逻辑不 import DSH API）：v0.1 全部 + **编排层**——`dispatch:start/cancel`（runtime 状态机 pending→running→succeeded|failed|timeout|cancelled|frozen）、`sweep:tick`（超时硬截止 + lastOutputAt 收割时刷新误判保护 + 竹节自动接力）、竹节流程（K1–K5 简报指令 → **先 interrupt 后 dispatch** → 基准重置 → attempt 不变）、链长上限 frozen、sweep timer/degraded-lazy 双模式、`attachPorts` 热装配。
- **工具面**：tree_plan / tree_node / **tree_dispatch** / tree_report / tree_status（8 中的 5 个；tree_status 含 harvest 显式收割）。
- **持久化**：fsStore @ `<DSH_PROFILE_DIR>/tree-engine-data/`（tmp+rename 原子写）。
- **测试**：`node --test tests/*.test.js`（**33 项全绿**，含假时钟硬截止窗口断言、误判保护、竹节顺序铁律断言）。

## v0.2 边界（诚实声明）

1. `startContinuable` / `prompt` / `interrupt` 精确 spec 形状未 smoke——装载后 `tree_dispatch` 单节点实测修正（S1 smoke 清单第一项）；
2. usagePct 端口暂缺（tokenMeter 形状未定）→ 竹节依赖执行者自报 `tree_report {context}`（源引擎语义；宿主测量接入后先到者生效）；
3. 交棒简报全文回收未接入（v0.2 promptHandoff 返回 null → `no-handoff-summary` 降级接手；smoke 后经 readSession 提取 K1–K5）；
4. tree_verify / tree_log / tree_maintain 未注册（下一批）；
5. caller 会话 id 从 exec 尽力提取，缺 extraction 时 caller 校验操作 fail-closed。

## v0.1（S1 第一批）

- **核心**（`src/`，纯逻辑不 import DSH API）：闭集状态机 + done 三重闸 + 7-strike + macp2 护栏三件套 + UUID 严格校验 + caller 防借身份 + per-tree 串行队列 + 时钟注入缝 + 竹节触发/接力登记（42 阈值 + 链长熔断）+ `call()` 永不 throw 契约。
- **工具面**：tree_plan / tree_node / tree_report / tree_status（8 工具中的 4 个）。
- **测试**：`node --test tests/*.test.js`（24 项全绿）。

## v0.1 边界（诚实声明）

1. 持久化 = 进程内内存 store（storageDomain / 插件数据目录适配在下一批随 smoke 结论落地）；
2. tree_dispatch（subagents 派发 + 竹节自动接力 sweep）、tree_verify / tree_log / tree_maintain 未注册（下一批）；
3. caller 会话 id 从工具 exec 上下文尽力提取，提取不到时 caller 校验操作 fail-closed（E_BORROWED_IDENTITY）；
4. 路径一致性校验为简化判据（path 尾段 = leaf_id 去 prefix 层级），精确判据随差分测试冻结。

## 运行测试

```powershell
& 'C:\Users\sir_c\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' --test tests/*.test.js
```
