# Skill 文档「洁净室」多轮评审记录（2026-11-11）

> 目的：验证 GitHub 上的**用户可见材料**（公开插件仓 + 本仓文档）是否完整包含「使用随包 Skill」所需的全部要素。
> 方法：由**独立子会话**（干净上下文，不继承 Lead 对话）以「第一次接触的新用户」身份只读评审；每轮新起会话，不复用上一轮上下文。评审对象是 **GitHub 上的实际内容**（并非本地工作树）。
> 触发：用户要求「github 资料里面要包含使用 skill 等完整的使用用到的要素，这个要独立子会话进行多轮洁净室检查」。

## 第 1 轮（对象：v1.3.1 已发布 + 本仓 master）

| 评审员 | 对象 | 结论 | 关键发现 |
|---|---|---|---|
| R1-A（公开插件仓新用户） | `github.com/orphiczhou/dsh-session-tree` README/package/patch/SKILL | **PASS_WITH_GAPS**（无 BLOCK） | G1 无 handoff 调用样例/参数表；G2 未说明 `dsh-skill-filesystem` 随桌面版内置、Skill 目录需新开会话；G3 三处脚本引用在公开仓 404（`docs/`、`scripts/e2e/`、`scripts/skill-e2e/` 不存在）；G4 未写从 <1.2.0 升级要先停旧 bundle；G5 新会话首测会被 `below-threshold` 拒、易误判；G6 功能表 `lang=zh\|en` 管道未转义；G7 SKILL frontmatter 无英文触发词但 README 声称有；G8/G9 SKILL 引用了不在本包的 tree skill 与 monorepo 内部路径；G10 无版本/CHANGELOG 入口；G11 Dev 文件树漏 `test/skills.test.cjs`；G12 SKILL 无直链 |
| R1-B（本仓文档新读者） | 本仓 README、`docs/skills-usage.md`、三份 SKILL.md、相关报告 | **PASS_WITH_GAPS**（初步 4 个 P1，完整缺口表随后） | P1-1 根 README §已知边界 仍称 tree-engine「sweep 降级/非后台自动」与代码相反；P1-2 文档索引把 `docs/handoff-2026-11-11.md` 标为「当前交接」但该文仍是 v1.2.0/66 项/25s 热更；P1-3 tree-commander SKILL §3.1「owner 不自动迁移」与 §1.3/§3.3 及代码（v0.5.0 重绑）矛盾；P1-4 `docs/skills-usage.md` §2.2 对 tree-engine 只写「从本仓安装」，无可复制的 clone/link/reload 命令 |

**5 分钟路径复盘（R1-A）**：装→看侧栏→问 Skill 目录都顺；卡点 ①`dsh-skill-filesystem` 是否要自装/旧会话目录不变 ②新会话直接 `handoff` 被 `below-threshold` 拒 ③验证语种要连交两次撞 `recent-handoff` 且脚本 404。

## 第 1 轮修订（v1.3.2 内容，未发布前完成）

见 `CHANGELOG.md` §1.3.2：公开插件仓 README 中英双向补 G1–G12；`skills/session-handoff/SKILL.md` 补英文触发词、通用化样例、标注 tree skill 归属；`docs/skills-usage.md` 补「§3.1 五分钟冒烟」与内置 provider 说明。

**第 1 轮 B 的 4 个 P1 修订（v1.3.2 发布后、第二轮评审期间完成）**：

1. 根 README §已知边界：sweep 说法改为「进程内 60s 兜底，sweepMode=timer」；RC2 补测条目改为 67 项口径。
2. `docs/handoff-2026-11-11.md`：版本/测试数/热更口径刷新到 v1.3.2 + 67/67；补第四/五轮摘要；sweep 与 `apply.log` 说明修正。
3. `tree-commander` / `tree-worker` SKILL：竹节后 owner 语义统一为「v0.5.0 起自动重绑给接手会话」；交接样例路径通用化；`tree-engine` bump **0.5.1**（代码无变化）。
4. `docs/skills-usage.md` §2.2：新增 tree-engine **可复制安装步骤**（clone 本仓 → `hmr.root` → profile `link:` 依赖 → `pnpm install` → disable→enable → 新会话自检）。

对应提交：`d7db874`（本仓 master）。

## 第 2 轮（对象：v1.3.2 已发布 GitHub 内容）

| 评审员 | 对象 | 结论 | 关键发现 |
|---|---|---|---|
| R2-A（公开插件仓） | v1.3.2 main（= tag v1.3.2） | **PASS_WITH_GAPS** | **G1–G12 全部确认修复（12/12）**、无新增死链、版本链与 tag 自洽；新发现 **N1（中）**：README 冒烟测试称「单发 `spawn:false` 可只写文件」不准确——阈值闸在 `spawn:false` 分支之前，pct 可测且 <50 时会被 `below-threshold` 拒；N2–N7（低）：例题含 monorepo 内部路径、marketplace 问题自相矛盾、SKILL 样例行缺 `lang=`、SKILL 保留过期 34/34、`package.json.files` 缺 `README.zh.md`、tree_send 示例内部路径 |
| R2-B（本仓文档） | v1.3.2 本仓 | **PASS_WITH_GAPS**（无 BLOCK；6 个 P1 文档债） | 首轮 4 P1 中 3 已修、1 部分；G1 `spawn:false` 与阈值闸顺序（与 R2-A N1 同源）；G2 tree-commander owner 矛盾；G3 根 README 随包 Skill 节仍 v1.3.1；G4 已知边界 sweep 说法；G5 `collect-skills.mjs` 自检缺 `--expect`（只装 session-tree 会误报 missing）；G6 cleanroom/CHANGELOG/README 的「待第二轮」占位；另 P2：34/34 残留、SKILL status 缺 `lang=`、tree-worker owner 句、旧 degraded 日志串、patch YAML 伪代码、测试入口计数、tree skill 无英文触发词、`skills-usage` 自称「全部可复制」；P3：SKILL 版本头、旧日志串 |

**第 2 轮修订（v1.3.3）**：

1. **N1 行为修正（不是仅改文档）**：`spawn:false` 干跑改为**不受 below-threshold 阈值闸限制**（阈值闸条件加 `!fileOnly`），新增单测「spawn=false 在阈值以下也能只写文件」→ handoff **41/41**；README 中英、`docs/skills-usage.md` 口径同步。
2. N2/N3：README 中英例题换为中性 `src/refund/...` 示例，`open_questions` 不再提 marketplace。
3. N4/N5：SKILL status/handoff 样例补 `lang=zh`；删掉过期 34/34。
4. N6：`package.json.files` 补 `README.zh.md`。
5. N7：tree_send 示例路径中性化。
6. 发布 v1.3.3（`cce2975`，18/18 SHA，main+tag）。

**第 2 轮 B（本仓文档）与 R1-B 补交报告的修订（v1.3.4）**：

1. 根 README 随包 Skill 节版本矩阵 → v1.3.4；`docs/publishing.md` / `docs/handoff-2026-11-11.md` / `docs/session-handoff-2026-11-11.md` / `agent.md` 同步清扫；历史 `v1.0.4`、`3 份 cjs` 残留修正；测试入口改为 6 个。
2. `docs/skills-usage.md`：`collect-skills.mjs` 自检补 `--expect`（只装 session-tree 不再误报）；tree_plan 样例补 `session_id` 并按 `root_dod:{dod:...}` 对齐；worker 验收明确「commander 跑 tree_verify」；竹节等待原因改为「链满 frozen / 简报回收失败 / 已非 running owner」；新增 profile 修改备份警示；新增版本差异速查（1.3.0→1.3.3）；patch YAML 改为真实行并注明「无需手抄」。
3. `tree-commander` / `tree-worker` SKILL：补英文触发词（英文用户可发现）；版本头改 v0.5.1；旧 `sweep:degraded:no-timer` 表述改为「宿主无 timer、进程内兜底」。
4. `session-handoff` SKILL：`set-session` 重绑主体改为「leaf 的 creator/上级（通常是父 commander）」；README 语言验收表述修正（脚本会解码接替会话首条消息）。
5. 发布 v1.3.4（`f784c6e`，18/18 SHA，main+tag）。

## 第 3 轮（对象：v1.3.3 已发布内容）

| 评审员 | 对象 | 结论 | 关键发现 |
|---|---|---|---|
| R3-A（公开插件仓 / 复核） | v1.3.3 main（= tag `cce2975`） | **PASS** | **N1–N7 全部确认修复**：`index.js` 阈值守卫为 `!force && !fileOnly && …`，`spawn:false` 确实跳过阈值闸且防重复闸仍生效；新增单测 20% 上下文 `spawn:false` → `file-only`、`force` 低于阈值 → `handed-off`；README 中英/指南三处口径一致；G1–G12 无回归；无新增死链；18 文件与源码仓 18/18 一致；5 分钟路径 **5/5**。非阻断收尾：版本矩阵滞后（已在本轮 v1.3.4/v1.3.5 清扫）、cleanroom 记录第 2 轮占位（已补）、SKILL §0 未写 `spawn:false` 例外（v1.3.5 已补）、README root→grandchild 措辞（v1.3.5 已改） |

## 结论

- **三轮独立洁净室评审全部完成**：第 1 轮 12 缺口（G1–G12）+ 4 P1 → v1.3.2；第 2 轮 12/12 确认修复 + N1–N7 → v1.3.3（含 `spawn:false` 干跑行为修正）；R1-B/R2-B 的文档债 → v1.3.4；第三轮 **PASS**，其非阻断收尾项 → v1.3.5。
- 最终状态：公开插件仓 **v1.3.5 = `1fb9193`**（18/18 SHA，main+tag=本地）；本仓 master 与 GitHub 同步；用户可见材料覆盖「安装 → 发现 Skill → 触发 → 参数/样例 → 验收 → 语言 → 升级 → 排障」全路径，中英等价。
- 已知边界：洁净室评审员均为只读代码/文档走查 + 离线测试复核，未在 GUI 重装；真机行为证据见 [docs/e2e-kickoff-language-2026-11-11.md](e2e-kickoff-language-2026-11-11.md) 与 [docs/skill-e2e-2026-11-11.md](skill-e2e-2026-11-11.md)。
