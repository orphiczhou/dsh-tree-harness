# session-tree v1.4.0 发布记录（2026-11-13）

> 结论先行：**`@orphiczhou/dsh-session-tree@1.4.0` 已发布到公开镜像仓**，镜像 `main` + tag **`v1.4.0` = `0343f0c`**，与源包 **21/21 SHA** 逐字节一致；本仓发布提交 **`d8b9f7c`**，两侧 `ls-remote` 核对通过。
> 发布方式：`node scripts/release-all.mjs --push --mirror-dir <clean checkout>`（一条命令：预检 → 同步 21/21 → 本仓 commit/push → 镜像 commit/tag/push → `ls-remote` 核对）。
> 状态：**GUI 可视化未验证**（用户 2026-11-13 反馈“现在看不到，记录下这个没有验证”）；待 DSH 重启/刷新后复验（见报告 [session-metadata-display-2026-11-12.md](session-metadata-display-2026-11-12.md) §9.8 与交接 §7.10h）。

---

## 1. 发布物内容

| 类别 | 内容 |
|---|---|
| **Q4 安全收紧** | `tree_send` 移除 `parent` 入参、调用者谱系校验、同根才投递（跨树 `E_CROSS_TREE_SEND`；`E_PARENT_REMOVED`/`E_CALLER_REQUIRED`/`E_SEND_TO_SELF`/`E_LINEAGE_UNRESOLVED` fail-closed）；新增 `test/tree-send.test.js` **25 例** |
| **会话界面元数据（方向修正）** | 不在左侧树显示；`conversation.composer.dock` 对子会话显示 `model · effort · context%`（官方对子会话隐藏 ModelSelect/effort）；只读子会话（one-shot/未知模式/父离线）用 `conversation.session.header.utilities` chip 兜底；root 保留官方 UI |
| **测试** | handoff 41/41、tree-send 25/25、meta 41/41、render 151/151 + 9/9 + 11/11、style-guard 26/26、skills 3/3、verify-bundle 0 fail、provider-conformance 29/29 |
| **版本** | `1.3.7` → **`1.4.0`**（D6 内容变化必 bump） |

## 2. 发布证据（原始输出摘要）

```text
release-plugin.mjs --check:
  files=21 match=21 mismatch=0 missing=0 extra=0
  RESULT: OK — 21/21 files byte-identical (SHA-256)

本仓:
  git commit d8b9f7c  feat/release: @orphiczhou/dsh-session-tree v1.4.0 — …
  git push origin master → 7ce41da..d8b9f7c  master -> master

镜像仓:
  git commit 0343f0c  sync: @orphiczhou/dsh-session-tree@1.4.0 from dsh-tree-harness packages/dsh-session-tree
  git tag v1.4.0
  git push origin main → 91c177e..0343f0c  main -> main
  git push origin v1.4.0 → [new tag] v1.4.0 -> v1.4.0

ls-remote:
  origin/master = d8b9f7ca7dfff9db5eb14f727887ffbd6eba7a39
  mirror main   = 0343f0c9a982b305e886eb3b4a9f22ded0f0b7be
  mirror tag v1.4.0 = 0343f0c9a982b305e886eb3b4a9f22ded0f0b7be
```

- 上一版：v1.3.7 = `91c177e`（19/19 SHA）。
- 镜像 checkout（本次发布使用，仓外）：`D:\Codes\_release\dsh-session-tree-mirror`；需要发布时先 clone：
  `git clone https://github.com/orphiczhou/dsh-session-tree.git <dir>`（干净 main）。
- 发布脚本前置：镜像 checkout 需配置 git `user.name/user.email`（本次已配置，等同本仓 identity）。

## 3. 未验证 / 注意事项

1. **GUI 可视化未验证**（用户反馈当前看不到）：client 半改动可能需 DSH 重启或插件重载后生效；复验步骤见交接 §7.10h（刷新/重开 `http://127.0.0.1:9398`，查 slot `conversation.composer.dock#session-meta` 与 `conversation.session.header.utilities#session-meta-chip`）。
2. **只读子会话无底部 slot**：平台边界（官方 composer 被 `SubagentReadOnlyComposer` 替换后无会话级 footer slot），当前用 header chip 兜底；若要求底部需 Phase 2 chain 覆盖（需复刻官方只读 UI）。
3. **`maxActiveSubagents` 24 未生效**：profile 已改 20→24（备份 `cordis.patch.yml.bak-20261112-budget`），**下次重启 DSH 生效**；当前运行仍 20。
4. `release-all.mjs` 的测试清单仍为 5 条（未含 `tree-send`/`meta`/`provider-conformance`），本次这些测试由人工/单测另行跑绿；建议下一轮把新增测试入口纳入发布门禁脚本。
