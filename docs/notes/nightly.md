# 夜间浏览器跑 / Nightly browser runs

由 `npm run nightly -- --update`（本机）或 CI 的 `nightly` 作业写入：WebKit / Firefox 的 E2E。

怎么读这张表：**Chromium 是门禁**（必须全绿）；**WebKit / Firefox 是报告**。本机 WebKit 只有约 1 fps
（有头 + Xvfb 实测 2.7 秒 2 帧，见 `docs/notes/compat.md`），而 Playwright 每次点击都要等两帧，
所以整包连跑必然有超时；按文件单独跑通常全绿。CI 的 `nightly` 作业跑全量 WebKit + Firefox + `bench:long`，
产物保留 14 天。本机 `npm run nightly` 默认只跑 WebKit 核心子集（iPhone/iPad 六视口、触屏、排版、启动、
路由图、分享、抽屉、主题），加 `--all` 跑全量。

| 日期 | 内核 | 结果 | 通过 | 失败 | 用时 |
| :--- | :--- | :--- | ---: | ---: | ---: |
| 2026-09-11 | chromium | ✅ pass | 25 | 0 | 196s |
| 2026-09-11 | webkit | ❌ fail | 18 | 7 | 2459s |
