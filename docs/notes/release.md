# 一键发布 / One-command release

```bash
npm run release -- 1.80.0            # 完整发布
npm run release -- 1.80.0 --dry-run  # 演练：跑真实门禁，但不部署、不打 tag
npm run release -- --check           # 只做发布前校验（`npm run verify` 也会跑它）
```

`scripts/release.mjs` 按固定顺序执行，任何一步失败立即停止：

| # | 步骤 | 失败原因示例 |
| :-- | :--- | :--- |
| 1 | **发布前校验**：版本号 `x.y.z`、`package.json` 一致、`src/changelog.ts` 最新一条就是它、日期是今天、`kind` 合法、每条都中英双份、版本号唯一且倒序、工作区干净、不在 detached HEAD | 忘记 bump 版本 / 更新记录日期写成昨天 |
| 2 | `npm run verify`（clippy、Rust、单测、lint、build、wasm、ci、release、dist、budget、audio、bench、dsp） | 任一门禁红 |
| 3 | Chromium 全量 E2E | 交互回归 |
| 4 | `npm run package`（release/ 里的 zip/tar.gz/SHA256SUMS） | 构建失败 |
| 5 | `wrangler deploy`（token 取环境变量，取不到就读 `~/.zshrc` 里的 `export CLOUDFLARE_API_TOKEN=`） | 未登录 / 网络 |
| 6 | **线上资源核对**：带随机查询串拉首页，比对 `assets/index-*.js` 与 `dist/index.html`；不一致时每 5 秒重试，第 3 次重试前**再部署一次**（CF 边缘偶尔还挂着旧清单）；6 次仍不一致即失败 | 边缘缓存 / 部署没推上去 |
| 7 | 打附注 tag `v<version>`（已存在则跳过，不覆盖） | — |

参数：`--skip-verify`、`--skip-e2e`、`--skip-deploy`（只打包打 tag）、`--quiet`、`GS1_SITE=<url>` 覆盖线上地址。

**线上地址就是 `https://synth.wangda.today/`**（`scripts/release.mjs` 里 `site` 的默认值）。它挂在 Worker `shiny-sky-9ea0` 的
自定义域名上（`GET /accounts/<id>/workers/domains` 可查），`wrangler.toml` 里的 `name` 就是这个 Worker。
**不要拿 `*.pages.dev` 的主机名核对**：本项目早已不通过 Pages 发布，旧主机名（如 `gs1.pages.dev`）现在对任何客户端
都返回 Cloudflare 的请求元数据 JSON——其中还有 `"pagesHostName"` 字样，很容易被误读成「站点正常」。核对时务必同时看
**返回体的 `assets/index-*.js` 哈希**与本地 `dist/index.html` 是否一致（第 6 步就是这么做的），只看 HTTP 200 没有意义。

设计取舍：

- **版本与更新记录的校验放在最前面**：一个版本号写错不该花 10 分钟跑完所有门禁才发现；同一个校验也以 `npm run verify:release` 挂在本地 `verify` 与 CI 的 verify 作业里，所以「版本和更新记录脱节」永远进不了 main。
- **CI 里只查「日期是真实日期且不是未来」**，不查「必须是今天」——CI 什么时候捡到这次提交不由我们决定，本地发布时才要求当天。
- **不做自动回滚**：部署失败时重新跑一次比猜「该撤销什么」更可靠；tag 只在全部成功后打，所以「有 tag 的提交 = 已上线的那份代码」。
- **不自动 commit**：改动和更新记录仍随功能批次一起提交，发布脚本只负责校验、打包、部署、打 tag。

## 一次真实的发布事故：`git checkout -- package.json`（v1.108.0）

发布 v1.108.0 时，更新记录的第一版把首屏 JS 顶过了线，于是重做版本号；重做时我跑了
`git checkout -- src/changelog.ts src/changelog-head.ts package.json package-lock.json` 把它退回再
`bump`。问题是**那一刻 `package.json` 里还有子代理尚未提交的脚本文案**（P11.4 的
`verify:presets:2x` / `presets:update:2x` 与 `verify` 链里的那一条），于是它们被一起回退，随后我提交了
一个「只差版本号」的 `package.json`。后果：

- `npm run verify` **静默跳过了 2× 预设指纹门禁**；
- `.github/workflows/ci.yml` 里那条 `npm run verify:presets:2x` 在 CI 上会**直接失败**；
- 而 `scripts/verify-ci.mjs` **仍然报 `[ci] PASS`** —— 它当时只检查「CI 工作流文本里有没有这条命令」，
  不检查「这条 npm script 是否真的存在」。

两条结论，都已落地：

1. **重做版本号不要用 `git checkout -- <file>`**。要退回的只有版本字段时，直接改那一个字段；要整文件退回
   时先 `git status` 确认那些文件**没有他人未提交的改动**，或者先把子代理的成果提交再动。
2. **`verify:ci` 现在同时校验两半**：工作流文本里有这条命令 **∧** `package.json` 的 `scripts` 里真的定义了它
   （`npm run <name>` / `npm test` / `npm run <name> -- <args>` 都能解析）**∧** `verify` 链里点名了每个非 E2E
   必需命令。自证方式是把脚本名临时删掉或从链里摘掉，两种都必须让 `[ci]` 变红——见 P10.2（v1.109.0）的报告与提交。

## 快轨 / 慢轨：不要把全面测试塞进每一次迭代（2026-09-14 起）

每批都跑一遍完整 `npm run verify` + 全量 E2E 会把迭代周期拖到几十分钟，而其中绝大部分与本次改动无关
（而且本机 8 核在负载下会让 `src/fuzz.test.ts` 的时间预算和 `bench` 的 over-budget 判定**假红**，
见 `docs/NEXT-PLAN-2.md` §一.15 —— 花了大量时间去追一个不存在的回归）。

**快轨（每批）**：只跑与本批相关的定向门禁 —— 相关测试文件、相关音频/体积门禁脚本、`lint` / `typecheck` /
`build`；改了 UI 才跑 `test:visual`，改了 E2E 才跑那个 spec 文件。**不跑** `fuzz` / `bench` / 全量 E2E /
整链 `verify`。

**发布（快轨）**：`npm run release:fast -- <version>`（即 `release.mjs --skip-verify --skip-e2e`）——
preflight → package → deploy → 线上哈希核对 → tag，几分钟内完成。前提是快轨已绿、工作树干净。

**慢轨（每 3–4 个版本一次）**：另开一个 agent 在**安静主机**上做全面回归 —— 完整 `npm run verify`、
全量 E2E（app 套件 + 隔离的 perf 套件）、视觉基线、**WebKit 与 Firefox**（`e2e-engines` / nightly 子集）、
以及一段时间的连续观察；
> **Firefox / WebKit 只在慢轨测**（用户 2026-09-14 明确指示）：日常批次只跑 chromium，不碰 firefox/webkit project，也不跑 nightly。
它**只报告**，发现的问题回头**单独立批**修。慢轨与开发**解耦**：它慢它的，迭代继续。

这样分工的前提是**快轨必须真的跑**：慢轨是补网，不是替代品。任何一批如果连定向门禁都没跑就发布，
那就不是快轨而是没有轨。
