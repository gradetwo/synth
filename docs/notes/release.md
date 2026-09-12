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
