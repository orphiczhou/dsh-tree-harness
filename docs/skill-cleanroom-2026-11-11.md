# Skill 文档「洁净室」多轮评审记录（2026-11-11）

> 目的：验证 GitHub 上的**用户可见材料**（公开插件仓 + 本仓文档）是否完整包含「使用随包 Skill」所需的全部要素。
> 方法：由**独立子会话**（干净上下文，不继承 Lead 对话）以「第一次接触的新用户」身份只读评审；每轮新起会话，不复用上一轮上下文。评审对象是 **GitHub 上的实际内容**（并非本地工作树）。
> 触发：用户要求「github 资料里面要包含使用 skill 等完整的使用用到的要素，这个要独立子会话进行多轮洁净室检查」。

## 第 1 轮（对象：v1.3.1 已发布 + 本仓 master）

| 评审员 | 对象 | 结论 | 关键发现 |
|---|---|---|---|
| R1-A（公开插件仓新用户） | `github.com/orphiczhou/dsh-session-tree` README/package/patch/SKILL | **PASS_WITH_GAPS**（无 BLOCK） | G1 无 handoff 调用样例/参数表；G2 未说明 `dsh-skill-filesystem` 随桌面版内置、Skill 目录需新开会话；G3 三处脚本引用在公开仓 404（`docs/`、`scripts/e2e/`、`scripts/skill-e2e/` 不存在）；G4 未写从 <1.2.0 升级要先停旧 bundle；G5 新会话首测会被 `below-threshold` 拒、易误判；G6 功能表 `lang=zh\|en` 管道未转义；G7 SKILL frontmatter 无英文触发词但 README 声称有；G8/G9 SKILL 引用了不在本包的 tree skill 与 monorepo 内部路径；G10 无版本/CHANGELOG 入口；G11 Dev 文件树漏 `test/skills.test.cjs`；G12 SKILL 无直链 |
| R1-B（本仓文档新读者） | 本仓 README、`docs/skills-usage.md`、三份 SKILL.md、相关报告 | （见 §2 补记） | — |

**5 分钟路径复盘（R1-A）**：装→看侧栏→问 Skill 目录都顺；卡点 ①`dsh-skill-filesystem` 是否要自装/旧会话目录不变 ②新会话直接 `handoff` 被 `below-threshold` 拒 ③验证语种要连交两次撞 `recent-handoff` 且脚本 404。

## 第 1 轮修订（v1.3.2 内容，未发布前完成）

见 `CHANGELOG.md` §1.3.2：公开插件仓 README 中英双向补 G1–G12；`skills/session-handoff/SKILL.md` 补英文触发词、通用化样例、标注 tree skill 归属；`docs/skills-usage.md` 补「§3.1 五分钟冒烟」与内置 provider 说明。

## 第 2 轮（对象：v1.3.2 已发布 GitHub 内容）

（待第二轮独立评审员回报后填写：结论、剩余缺口、是否 PASS。）

## 结论

（待填）
