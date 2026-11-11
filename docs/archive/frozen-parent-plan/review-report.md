# 文档审查报告 (AC 范式 v1.3)

## 审查概要
- 文档：Proma-Easy → DSH 插件移植方案（PLAN）
- 范式：对抗-收敛 (AC v1.3.0, DUAL-GATE四闸协议 + Executor编排 + 双Arbiter交叉验证)
- 终态：**EARLY_STOP_HUMAN_ADJUDICATED → 版本快照冻结（SKILL §1.1(c)）**
- 冻结版本：**PLAN-v1.7.md**（sha256=`213dcc352cba079e80e60c417e519876c2d964d57d82a38504130647681c1d6b`，382→v1.7 实际 275 行 / 87,653 B）
- 审查轮次：**7 轮**（R1–R7）
- 总发现：**57 条**（blocking: 2，major: 21，minor: 33，suggestion: 1）
- 确认缺陷：**57 条全部闭环**（52 accept 修复 / 4 refute 经下一轮 Attacker 逐条裁决 attack_dismissed / 1 clarify 附引擎级实测反证并同步落修）
- 争议/升级：Dispute 4 起（U-004/F-006/F-008/I-012，全部 attack_dismissed）；escalate_human 3 起（R1/R5/R7 overly_compliant）→ 达暂停线 → **人工裁决：defer_to_v_next（版本冻结）**
- 停止方式：`early_stop_human_adjudicated`（人工裁决收口；非统计收敛，见"协议偏差与限制"）

## 收敛诊断
- 停止轮次：第 7 轮（人工裁决触发 §1.1(c) 版本快照冻结）
- AC触发(G1)：未触发（7 轮中无连续 2 轮全六维 DIM_CLEAN；人工在 G1 前选择冻结）
- NHPP GO(G2)：未执行（冻结早于拟合；无统计意义）
- Prober确认(G3)：未执行（冻结早于 G3 spot-check）
- Arbiter一致率(G4)：**100%**（2 次双 Arbiter 审计：R1 抽样 3/3 + R5 全样本 2/2，A/B 零分歧）
- Constant场景触发：否
- Chapman事后估计：**不可用**（m₁₂=0，全部缺陷当轮修复无重捕；残余风险估计不可靠——按 SKILL 标注"⚠️ 重捕数据不足"）
- 残余风险：低-中（见已知限制清单）
- Executor越界自检：**7/7 轮 all_verified=true**（无越界；R5 曾漏触发 REPAIR_MODE_RESET，属编排遗漏非角色越界，已在 R6 补正并记录）
- 文档版本指纹链：v1.0→v1.7 共 8 版，逐版 SHA-256 + mtime 三元组完整（见 attack-log.json version_history）

## 发现衰减与轮次明细
| 轮 | Attacker（家族） | D_k | Defender 回应 | 修复版 | 特殊事件 |
|---|---|---|---|---|---|
| R1 | deepseek-v4-pro (D) | 14 | 14a | v1.1 | overly_compliant→抽样审计 3/3 upheld |
| R2 | deepseek-v4-pro (D) | 11 | 9a/1r/1c | v1.2 | U-004 争议（后裁决 dismissed） |
| R3 | glm-5.3 (Z) 硬轮换 | 7 | 6a/1r | v1.3 | **REPAIR_MODE_RESET#1**→三层同步法；H1 避让切换 Defender；I-007 攻击协议自身→常设化 H1-H3+G0 |
| R4 | glm-5.3 (Z) | 10 | 8a/2r | v1.4 | F-006/I-012 前身争议起 |
| R5 | MiniMax-M3 (M) 硬轮换 | 3 | 2a/1c | v1.5 | overly_compliant→全样本审计 2/2 upheld + 4 advisory；Z 维首攻即中（超时无定时器） |
| R6 | MiniMax-M3 (M) | 7 | 5a/2r | v1.6 | **REPAIR_MODE_RESET#2**→对账矩阵法（额外挖出 7 处跨章节缺口 α-η） |
| R7 | deepseek-v4-pro (D) 周期复用 | 5 | 4a/1c | v1.7 | F-008/I-012 裁决 dismissed；U-012 附引擎级实测反证；**escalate 3/3 → 暂停 → 人工裁决 defer_to_v_next** |

## 确认缺陷（按严重度汇总；全量 57 条见 logs/attack-log.json all_attacks）
### Blocking（2，均 R1，已修复）
| ID | 维度 | 描述 | 修复 |
|----|------|------|------|
| ATK-I-002 | I | 里程碑编号 M0-M7 两套体系撞车 | S0-S5 / M1-M8 双编号约定 + 映射表 |
| ATK-L-014 | L | cancelled 未纳入棒/序列状态机 + handoff×cancel 幂等交互缺失（R6） | gradeState 扩展 + 迁移表三行 + 并发仲裁 + 六类路径断言 |

### Major（21 条，已全部修复）——按主题归组
- **状态机闭环族**（L-001/002/004/005/006/008/010/011/015/I-013）：dispatch 回流、角色序列终止、快照冻结源、completed 重入、running 超时、验收棒序列无关绑定、双状态机同步表（R6 新增即被 R7 抓出漏行——对账矩阵价值实证）、lastOutputAt 误判保护
- **可测性族**（G-001~008）：E2E 终态客观化、脱敏断言、差分判据、审批观测载体、退化短 id 谓词、K1-K5 清单、K3 回溯算法、sweepMode 降级断言
- **一致性与保真族**（I-003/005/007/F-001/002/003/I-008/I-011/Z-002）：数据通路两阶段、E2E 验收步骤、审查协议同族窗口（H1-H3+G0）、工作量精确求和口径、双状态机 rollback 同步规则
- **工程正确性族**（Z-001，R5 M 族独有捕获）：超时硬截止需内部定时器 → ctx.timer sweep 双轨四路径 + 假时钟断言

### 被驳回的攻击（4，全部经下一轮 Attacker 依协议裁决 attack_dismissed）
| ID | 攻击描述 | 驳回理由（Defender 反驳成立点） |
|----|---------|------------------------------|
| U-004 | remote 注入歧义 | v1.2 白名单重写后歧义文本不存在（R3 Attacker 裁决） |
| F-006 | sessionQuery 不在实测清单 | 目录内确有该条目 + 注册侧实证；附录自标节选（R4 Attacker 裁决） |
| F-008 | 假时钟钩子未声明 | 注入缝由既有架构决策必然得出；攻击截引 §8 既有假时钟句（R7 Attacker 裁决） |
| I-012 | P2 待定后路径未闭环 | P2=未立项无欠交付；S0 先于 S2 无实施窗（R7 Attacker 裁决） |

## 统计信息
- 收敛判定：early_stop_human_adjudicated（§1.1(c) 版本快照冻结 + defer_to_v_next）
- 收敛轮次：第 7 轮（MIN_ROUNDS=2 ✓，MAX_ROUNDS=10 未触）
- 总调用数：7 Attacker + 7 Defender + 4 Arbiter（2 次双审计）= 18 次 Agent 调用 + 0 Prober
- Executor: glm-5.3-flash（编排，未担任任何 Agent 角色，7/7 越界自检通过）
- Attacker: deepseek-v4-pro (R1,2,7) / glm-5.3 (R3,4) / MiniMax-M3 (R5,6)——硬轮换+周期复用 ✓
- Defender: glm-5.3 (R1,2,5,6,7) / deepseek-flash (R3,4，H1 避让)——三家族异构 ✓
- Arbiter-A: MiniMax-M3 (R1) / deepseek-flash (R5)；Arbiter-B: deepseek-flash (R1) / glm-5.3-flash (R5)
- Defender Refute 率（逐轮）：0% / 9.1% / 14.3% / 20% / 0% / 28.6% / 0%
- 回归率：机械口径 R4 90% / R5 100% / R6 100%（饱和失判——全文均处历次修复区）；REPAIR_MODE_RESET 触发 2 次，第二次切换对账矩阵法后矩阵额外发现 7 缺口
- 同底座降级：false（三家族全程可用）
- Attacker轮换：2 次硬轮换 + 1 次周期复用（deepseek→zai→minimax→deepseek）
- Veto事件：无 NHPP/Prober veto；constant 场景未触发
- 特殊事件：repair_mode_reset ×2 / escalate_human ×3 → pause → human_adjudicated / defender_family_swap ×1 窗口 / overly_compliant ×3 / protocol_note ×2（R5 reset 漏记补正；R6 起 doc_pass_mode 改磁盘+哈希闸门）

## 已知限制清单（版本冻结残留，转下一版本处理）
| # | 限制 | 处置建议 |
|---|---|---|
| K-1 | §4.6 四项 P2 待定（remote-session 桥 / 协作工具重叠度 / 事件推送 / host-remote 回退面） | 按 PLAN §4.6 于 S0 裁决 |
| K-2 | 收敛统计闸（G2 NHPP / G3 Prober）因人为冻结未执行 | 冻结选择的固有代价；如需统计背书可对 v1.7 重开审查 |
| K-3 | 实机视觉验证（面板/预览 UI）未做 | S2/S4 实现阶段按 §8 第 4 层执行 |
| K-4 | m₁₂=0，Chapman 残余风险估计不可靠 | 协议固有标注；57/57 当轮闭环本身是高质量信号 |
| K-5 | 软约束 S1 在 R1-2 窗口未满足（Prober 与 Attacker 同族） | 非阻断；v1.3 §10 已有显式登记例外条款 |
| K-6 | 方案为实施蓝图：S0–S5 里程碑（12.5–19 人天，MVP 6.5–10）为后续工作 | 按冻结版 PLAN 执行 |

## 人工裁决记录
- 裁决人：人类操作员（2026-10-03）
- 裁决对象：R1/R5/R7 三条 overly_compliant escalate_human 事件
- 裁决结果：**defer_to_v_next**（三条同裁）→ 触发 §1.1(c) 版本快照冻结终态
- 冻结版本：v1.7-draft（即本报告所附最终方案）；escalate 计数随冻结闭卷，不再恢复

## 产物清单
- 冻结方案：`docs/PLAN-v1.7.md`（87,653 B）
- 攻击全量账本：`logs/attack-log.json`（8 版指纹链 + 57 条攻击 + 7 轮明细 + 全部事件）
- Defender 独立信息源：`logs/dsh-host-services.txt`、`logs/ref-dsh-session-tree-README.md`
- 本报告：`docs/review-report.md`
