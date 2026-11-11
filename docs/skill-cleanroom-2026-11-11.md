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

（待第二轮独立评审员回报后填写：结论、剩余缺口、是否 PASS。）

## 结论

（待填）
