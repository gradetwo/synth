# 夜间浏览器跑 / Nightly browser runs

由 `npm run nightly -- --update`（本机 / systemd 定时器）写入。CI 的 `nightly` 作业跑同一套
子集但不写这张表：它的工作区是一次性的，写不进仓库。表、每行的通过率与下面的趋势都由
`scripts/nightly-report.mjs` 生成；`node scripts/nightly-report.mjs --self-test` 会校验**本文件
就是脚本会写出的样子**，所以手工改过的、会过期的趋势过不了自测。

怎么读这张表：**Chromium 是门禁**（必须全绿）；**WebKit / Firefox 是报告**。本机 WebKit 只有约
1 fps（见 `docs/notes/compat.md`），所以 `npm run nightly` 默认跑三块子集：

- **核心子集**：iPhone/iPad 视口、触屏、排版、启动、路由图、分享、抽屉、主题；
- **视觉子集**：`e2e/visual.spec.ts`。WebKit/Firefox 上只做**不比对基线**的冒烟——视觉基线只有
  `*-chromium-linux.png`，而 Playwright 按「内核 + 平台」找 `*-webkit-linux.png` /
  `*-firefox-linux.png`，在这两个内核上必然找不到；拿 Chromium 的基线去卡它们是拿字体栈与软件
  渲染判产品，放宽阈值只会把真差异一起放过（那套阈值是别处的门禁，这里不动）；
- **音频子集**：`smoke` / `audio` / `filter` / `delay` / `fm` / `oversample` / `wavetable` /
  `sample` / `meter`——引擎起不起得来、改音色的控件可不可达、补丁带着走不走。

`--core` 只跑核心子集（本机快速看），`--all` 跑全量（CI 的 WebKit 作业用它）。文件清单是
`scripts/nightly-e2e.mjs` 里的常量，本文件不复述，免得两处各说各话。

`显示` 是这次实际走的显示路径：`weston`（headless Weston，本机默认）、`xvfb`（回退）、
`desktop`（真实会话，`--display=desktop`）、`headless`（没有显示服务器；Chromium/Firefox 用它，
WebKit 在 headless 下交不出应用页的帧——不是不触发 rAF，见 `docs/notes/compat.md` §3.1；
`e2e/fixtures.ts` 让按帧的交互不再等帧，但读像素的视觉子集仍要有合成器）。它决定耗时与稳定性，
所以跨显示的通过率对比只是近似。

| 日期 | 内核 | 显示 | 结果 | 通过 | 失败 | 通过率 | 用时 |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: |
| 2026-09-11 | chromium | — | ✅ pass | 25 | 0 | 100.0% | 196s |
| 2026-09-11 | webkit | — | ❌ fail | 18 | 7 | 72.0% | 2459s |

> `显示` 与 `通过率` 两列从 v2.0.1（P11.6）起记录。写在这两列存在之前的行，`显示` 记 `—`：
> 当时用的是哪条显示路径已无从回填，不猜。它们的 `通过率` 是对该行已有的「通过 / 失败」做算术，不是新测的数字。

<!-- nightly-trend:start -->
## 通过率趋势 / Pass-rate trend（脚本生成，勿手改）

由 `node scripts/nightly-report.mjs --render`（或 `npm run nightly -- --update`）从上面的表重算。
通过率 = 通过 / (通过 + 失败)；`—` 表示该次没有可判定的用例（浏览器没起来、收集到 0 个用例）。
`变化` = 最近一次通过率 − 上一次通过率（单位：个百分点），只有一次记录时为 `—`。
`显示` 会影响耗时与稳定性，跨显示的通过率比较只是近似；判据仍然是「同显示下的纵向变化」。

| 内核 | 记录数 | 最近 5 次通过率（旧 → 新） | 最近 5 次均值 | 变化（最近一次 − 上一次） |
| :--- | ---: | :--- | ---: | ---: |
| chromium | 1 | 100.0% | 100.0% | — |
| webkit | 1 | 72.0% | 72.0% | — |

全期合计：43 passed / 7 failed = 86.0%（2 次运行，2 个内核）。
<!-- nightly-trend:end -->
