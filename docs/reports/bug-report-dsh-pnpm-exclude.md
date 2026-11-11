# [Bug] pnpm 11.7.0 `minimumReleaseAgeExclude` 在锁文件校验路径不生效 → plugin_manager 任意安装被第三方插件新版本阻塞 24h

> 提交处：https://github.com/deepseek-ai/deepseek-harness/discussions（Bug Report 分类）
> 上游同族缺陷：https://github.com/pnpm/pnpm/issues/10361（`--fix-lockfile` 变体；本报告补充裸 `install` 变体与四通道判别矩阵，可在该 issue 下交叉引用）

## TL;DR

DSH 自带的 pnpm 11.7.0 给 `minimum-release-age` 加了 **24h 安全缺省**（`pnpm.mjs` defaults 表 `"minimum-release-age": 24 * 60`），每次 `plugin_manager install_bundle` 都会全量复验 profile 锁文件；但 `pnpm-workspace.yaml` 里的 `minimumReleaseAgeExclude` 排除表**在锁文件校验路径被整体忽略**（四种注入通道实测全部无效）。结果：profile 中任一第三方插件发布新版本后 24 小时内，**所有**新安装（包括纯本地 link 包）被 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 阻塞，且用户侧豁免手段全部失效。

## 环境

- DSH profile：desktop；pnpm 11.7.0（DSH runtime 自带：`dsh-runtimes/dsh-primary-runtime/dependencies/pnpm`）
- 复现包：`dsh-thoughtdag@0.5.16`（npm 发布于 2026-10-03T12:33:25Z）已在 profile 依赖中
- 尝试安装：任一本地 link 包（如 `@local/dsh-tree-engine`，不涉及任何 registry 下载）

## 复现（判别矩阵）

profile 的 `pnpm-workspace.yaml` 已含：

```yaml
minimumReleaseAgeExclude:
  - dsh-thoughtdag@0.5.15
  - dsh-thoughtdag@0.5.16
```

| # | 通道 | age | exclude | 结果 |
|---|---|---|---|---|
| 1 | 裸 `pnpm install --lockfile-only` | 缺省（24h） | workspace yaml | ❌ `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` |
| 2 | CLI | `--config.minimum-release-age=1440` | CLI `--config.minimum-release-age-exclude=dsh-thoughtdag@0.5.16` | ❌ 同上 |
| 3 | 环境变量 | CLI 1440 | `npm_config_minimum_release_age_exclude=...` | ❌ 同上 |
| 4 | workspace yaml 同源 | `minimumReleaseAge: 1440` 写入 yaml | yaml（同源） | ❌ 同上 |
| 5 | CLI 关检查 | `--config.minimum-release-age=0` | — | ✅ 通过 |

**关键对照**：age 旗标在所有通道都生效（#5 即证），exclude 在所有通道都被忽略（#2–#4）——排除表不是"没配对"，是根本没被消费。

## 根因定位（源码级）

- 缺省来源：`dist/pnpm.mjs` 选项缺省表 `"minimum-release-age": 24 * 60`（约 L145910，注释 `// 1 day`）。`pnpm config get minimumReleaseAge` 显示 `undefined`（缺省值不在 config 层），因此该检查"来源不可见"。
- 排除表读取链路各站点均正确透传（`createResolutionVerifiers` → `createNpmResolutionVerifier` → `isExcluded`，匹配逻辑逐行核对可命中 `name@version`），且 `pnpm config get minimumReleaseAgeExclude` 能原样返回用户配置——**配置解析成功、校验器拿不到**：丢弃发生在 config → install opts 的映射层。与上游 [#10361](https://github.com/pnpm/pnpm/issues/10361)（`--fix-lockfile` 路径同症状）同族，疑似 11.7 引入 age 缺省时未把 exclude 接入锁文件校验路径。
- DSH 侧放大因素：`plugin_manager install_bundle` 每次触发 pnpm 对**整个锁文件**（本例 5 条目）复验，而非仅新装条目。

## 影响

1. 任一已安装第三方插件（thoughtdag、市场插件等）发新版后 24h 内，用户**无法安装任何新插件**（含本地 link 包）；
2. 用户在 `pnpm-workspace.yaml` 配置的排除表形同虚设——而 DSH 的报错提示（"run pnpm clean --lockfile … Alternatively, relax the policy"）会把用户引向更重的重建路径；
3. 该模式**每次插件更新都会重演**（本例 0.5.15 时代已发生过一次，当时即靠加排除表"绕过"——实际是 24h 窗口自然过期产生的误归因）。

## 建议（DSH 侧可做）

1. 向 pnpm 上游补充本判别矩阵（#10361 或新 issue）；
2. 过渡缓解：plugin_manager 在调用 pnpm 时**透传用户的 `minimumReleaseAgeExclude`**（例如以与 age 同源的注入方式一并传递），或在检测到 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 时提示用户 `--config.minimum-release-age=0` 的临时开关与风险；
3. 文档：说明 24h 冷静期行为与排除表现状。

## 附：诊断证据留存

四通道判别矩阵的完整命令输出、`config get` 对照、源码行号定位（defaults 表 L145910、透传链 L136011-136026/L161880-161886、匹配逻辑 L64037-64105/L64645）均已留档，可按需提供。
