# 差分冻结偏差登记（diff.DEVIATIONS）

差分基准：`D:/Codes/tree-harness/tree-engine.cjs`（engine-spec §9 锚定）；投影规则见 `diff.test.js` 头注。
状态：2026-10-04 差分首跑全链投影一致（init → leaf add → brief_echo → set-context → segment append；非法输入三例行为一致）。

## 已对齐（差分驱动修正，本轮落盘）

| # | 项 | 源规则（差分实测） | 处置 |
|---|---|---|---|
| A-v1 | path 一致性 | `path ≡ parsePathFromLeafId(leaf_id)`（逐字相等，如 'C1'；空段只能空）——不是"层级路径尾段" | 引擎已改精确规则（engine.js leafAdd） |
| A-v2 | root leaf 字段 | `added_by=null`、`model/channel` 缺省 `'unknown'` | 引擎已对齐（cmdInit） |
| A-v3 | run() 签名 | `run(cmd, args, treesRoot?, callerSessionId?)`——第三参是 treesRoot、第四参才是 caller | 差分夹具已按此调用 |

## 已冻结偏差（保留差异，理由与去向）

| # | 项 | 源 | 本引擎 | 理由 / 去向 |
|---|---|---|---|---|
| D-v1 | 错误对象字段名 | `error.msg` | `error.message` | 封套层差异，不进状态投影；宿主工具层已统一 message。保持（DSH 侧惯例） |
| D-v2 | `E_CALLER_REQUIRED` 生产闸 | 写操作 caller 缺省一律拒（`TREE_ENGINE_ALLOW_CLI=1` 测试旁路） | caller 校验仅在身份类操作（leaf add/set-status/set-session、done event） | DSH 工具上下文自动注入 caller，宿主侧无 CLI 旁路场景；作为待移植项列入 S1 尾批评估（若 smoke 发现 caller 提取不可靠则升级为硬闸） |
| D-v3 | startup_notice / tips 注入 | init/leaf_add 返回注入任务启动须知（macp2 红线） | 未注入 | DSH 形态下由派发提示词组装（DoD + 约束）承担同职责；SKILL 重写版落地时对齐文案要点 |
| D-v4 | 完整性签名 / call-log | writeState 自动签名 + call-log.jsonl | 签名未实现；call-log 落 store 端口（fsStore 已写 call-log.jsonl） | 签名列 S1 尾批（tamper 检测依赖落盘形态稳定后加）；call-log 已对齐 append-only 语义 |
| D-v5 | 可恢复错误自动 drift | 可恢复错误（如 E_SCHEMA_INVALID）自动记 `action=self_correct, reason="auto-logged recoverable error …"` 到操作目标/root | 未移植（失败仅返回错误封套，不落 drift） | 扩面差分（52 组生成序列）发现；观测语义差异不改变状态机行为。差分投影白名单剔除该 reason 模式。移植评估列尾批（需先冻结源 auto-log 的落点全集） |
| D-v6 | leaf add 必填 model | leaf json 缺 `model` → E_SCHEMA_INVALID 拒 | model 可选（缺省 undefined） | 扩面差分发现。本引擎经工具面 add 的节点由派发端口补 model 路由（agentOptions），add 时不强制；两侧对缺 model 叶子的接受度差异已由 D-v5 白名单吸收（源拒时不落叶） |

## 白名单（投影剔除，engine-spec §9）

ISO 时间戳类全部字段；运行期生成 id（备份名）；内部自增序号。
