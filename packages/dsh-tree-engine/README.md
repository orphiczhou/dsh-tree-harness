# @local/dsh-tree-engine

树形任务分解执行引擎（DSH 宿主插件）。行为基准：[docs/engine-spec.md](../../docs/engine-spec.md)（S0 冻结）；工具面：[docs/tools-mapping.md](../../docs/tools-mapping.md)。

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
