# 浏览器兼容记录 / Browser compatibility notes

记录只在特定浏览器/环境出现、且已定位的问题，以及本机 E2E 能力现状。用户可见的结论写进
`docs/USER-GUIDE.md` 与更新记录；这里留技术细节与复现方式。

## 1. Firefox：启动卡在「正在启动…」（v1.72.0 修复）

**现象**：Firefox 里点「启动音频引擎」后按钮一直显示“正在启动…”，启动遮罩不消失，页面进不去；
控制台只有一条 JavaScript 警告，没有报错。

**定位**：`preload()` 在页面载入时就创建了 `AudioContext`（此时还没有用户手势）。Firefox 会把这样的
上下文视为被自动播放策略拦住，随后在点击手势里调用的 `ctx.resume()` 返回的 promise **永不 settle**
（既不 resolve 也不 reject）。启动流程 `await resume` 因此挂住，`busy` 一直是 true。
Chromium 下同一个上下文往往自己就变成 `running`，所以本地 Chromium E2E 从未暴露它。

**修复**：`src/audio/settle.ts::settleWithin(promise, ms)`——启动等待 `resume()` 最多 2.5 s，
超时就按上下文当前状态继续（`running` 或 `suspended`）；图已建好即视为「跑过」，于是遮罩收起、
显示「点按恢复」提示，之后任何手势都会再试一次 `resume()`。回归用例：
`e2e/boot.spec.ts`「a resume that is never answered still leaves a usable app」把 `resume()` 换成
永不 settle 的 promise，断言遮罩收起、键盘可用。

**验证**：本机 Firefox 跑同一套 E2E：修复前 `smoke.spec.ts` 45 s 超时，修复后 11 s 通过；
整包 Firefox 72 passed / 7 failed（修复前大面积卡在启动）。

## 2. 本机浏览器可用性

| 引擎 | 状态 |
| :--- | :--- |
| Chromium（Playwright 自带） | ✅ 全量 91 项 |
| Firefox（Playwright 自带） | ✅ 可跑；比 Chromium 慢，滚动/拖拽类用例偶有差异 |
| WebKit | ✅ 系统库装好后可本地运行（`npm run test:e2e:webkit`，单 worker）；比 Firefox 更慢：单个用例常 30–45 s，整包连跑会有大量用例在「点击后卡住」处超时 |

## 3. WebKit（Safari 内核）本机现状

依赖装好后 WebKit 能跑起来：单独跑 `e2e/fxgraph.spec.ts`、`e2e/smoke.spec.ts` 之类的用例可以通过，
但整包连跑（24 个用例的抽样）出现 23 个超时。超时的形态一致：Playwright 报 “attempting click action …”
之后一直不返回，而页面快照显示点击其实已经生效（例如预设抽屉已经打开）。也就是说 **WebKit 下点击之后
主线程会有一次很长的停顿**，怀疑与 AudioWorklet 渲染线程抢 CPU（或 WebKit 的自动播放/音频线程调度）有关，
需要单独用一个快速开关（例如不启动引擎只测 UI）来隔离，暂记为待查。

**真正的根因（2026-09-11，实测帧率）**：本机 WebKit 只有**约 1 fps**——有头 + Xvfb 下 2.7 秒里只跑到 2 帧
（最坏帧间隔 1.9 s）；同机 Chromium 是 2.2 秒 12 帧。Playwright 每次点击都要等「两帧之间元素稳定」，
所以**每次点击天然要花 1–4 秒**，慢的用例撞上 45 s 超时就成了「失败」。这与页面代码无关：
前端做了两处优化（按需 chunk 预取、遮罩 memo 化减少重渲染）后，WebKit 下打开预设库仍是约 8 s，
因为瓶颈是帧率而不是渲染量。

**更早的定位（headless）**：headless WebKit 里 `requestAnimationFrame` **完全不触发**（实测 500 ms 内 0 帧）。
Playwright 的点击前「稳定性」检查要等两帧，所以每个需要该检查的点击都会一直等下去——这就是那 23 个用例
超时的原因，与页面代码无关。验证方法：`page.evaluate` 里数 500 ms 的 rAF 回调帧数，headless 为 0。

**可用跑法**：`xvfb-run -a npm run test:e2e:webkit:headed`（有头 + 虚拟显示，rAF 恢复）。有头模式下点击正常，
用例会走到真实差异上（例如 `smoke` 的「折叠模块」在 WebKit 下没生效、导出渲染较慢），这些属于待逐个核对的差异。

**性能实测（2026-09-11，同一台机器，同一份 dist）**：打开预设库（81 张卡片）——
Chromium：点击耗时 160 ms、抽屉可见 +19 ms；WebKit 有头：**点击耗时 5.4 s**、抽屉可见 +490 ms。
WebKit 在这台机器上比 Chromium 慢一个数量级，慢的主要是「首次加载 + 解析按需 chunk + 渲染 81 张卡片」这一段。
因此 WebKit 项目在 `playwright.config.ts` 里单独给了 `timeout: 120s / expect: 20s / retries: 1`：
默认的 45 s 会把「慢」变成「失败」，那种失败说明不了产品问题。

**当前本地结果（核心子集，`--headed` + Xvfb + 单 worker，25 项）**：官方记录见 `docs/notes/nightly.md`；
最好的一次 18 passed / 7 failed（失败里有两个是当时的**测试自身缺陷**：Chromium 专用启动参数让 WebKit 直接
启不起来、FX 模块被浮动键盘挡住——两个都已修）。单独跑各文件时：`fxgraph` 4/4、`boot+smoke+share+responsive`
11/12、`responsive`/`touch`/`text-fit` 全绿。**单文件跑通过、整包连跑仍会因 1 fps 撞超时**，这就是本机现状。

**早期记录（16 项的核心子集）**：13 项通过——
iPhone/iPad 六种视口、触屏手势、中英文排版都通过；3 项失败全部是「点击一直等不到渲染线程回应」
（reload 后点启动键、点预设库等）。也就是说：**手机上真正相关的用例已经能在本机跑通**，
剩下的失败是这台 Linux 机器上 WebKit 的帧/主线程调度问题。

**第二个坑：装饰性动画 vs Playwright 的「稳定性」检查（已修）**。即使有头模式，WebKit 下点击一个带动画的
界面（启动页呼吸动画、示波器、脉冲提示等）时，Playwright 会一直等「两帧之间盒子不变」，实测**等到 90 s 超时**；
把 `prefers-reduced-motion: reduce` 打开后同一个点击 6.3 s 完成、面板正常出现。因此 `playwright.config.ts` 里
WebKit / Firefox 两个项目显式设了 `reducedMotion: 'reduce'`：应用本身尊重这个偏好，测试要断言的是行为而不是动画。

**第三个坑：`reload()` 后渲染线程长时间不回应（已绕开）**。WebKit 下「页面重载 + 音频引擎重启」之后，
点击会长时间卡在 “performing click action”（实测 120 s 超时）；把持久化用例改成**新开一个页面重新加载**
（`page.context().newPage()` + `goto`，状态只来自 localStorage）后立即通过。同一改动在 Chromium/Firefox 上等价
（它们本来就用 reload 验同一件事），所以 `e2e/fxgraph.spec.ts` 用它做「重开后仍在」的回归。

**顺带的产品改进**：路由图的「从信号链重建」原来要写 37 个参数、每次 `setParam` 都 commit + 两次 localStorage
写入 → 一个动作触发几十轮重绘，WebKit 下尤其慢。现在 `store.setParams([...])` 把一批参数作为**一次变更**提交，
重绘与存储各一次。

实践建议：本地用 `npm run nightly`（默认 WebKit 核心子集，`xvfb-run -a … --headed`，见
`docs/notes/nightly.md`）；`npm run nightly -- --all` 跑全量；整包的判据仍然放在 CI。

## 4. 夜间跑（C1 的落地形态）

- **CI**：`.github/workflows/ci.yml` 新增 `nightly` 作业，`on.schedule: cron '0 19 * * *'`（UTC，约北京时间 03:00），
  只在 `github.event_name == 'schedule'` 时跑：WebKit（`--all`，Xvfb 有头）+ Firefox + `npm run bench:long`，
  产物（`.tmp/nightly`、`test-results`）保留 14 天。`scripts/verify-ci.mjs` 把这个作业也纳入门禁，
  防止它被静默删掉。
- **本机**：`npm run nightly`（脚本 `scripts/nightly-e2e.mjs`）= 锁文件防并发 + 每个内核一份日志（保留 14 份）
  + 结果行写入 `docs/notes/nightly.md`；WebKit 默认只跑**核心子集**（iPhone/iPad 六视口、触屏、排版、启动、
  路由图、分享、抽屉、主题），`--all` 跑全量。
- **定时**：`scripts/install-nightly.sh` 安装 `scripts/systemd/gs1-nightly.{service,timer}`（用户定时器，
  每天 03:00，`Persistent=true`）；本机当前 session 没有 user bus，安装脚本会给出提示（`systemctl --user` 需在登录会话里跑）。
已有的本地记录：`e2e/fxgraph.spec.ts`、`e2e/smoke.spec.ts` 单独跑通过（引擎启动 11 s），
`share.spec.ts`/`fxgraph` 在 WebKit 下也能跑完。

## 5. Firefox 仍未追平的用例（待查，非启动阻塞）

- `roll.spec.ts`「拖动右边缘改音符长度」：Firefox 下拖拽没有改变宽度（指针事件差异，待查）。
- `meter.spec.ts` 空闲电平、`flow.spec.ts` 连线动画、`audio.spec.ts` MPE、`pwa.spec.ts` 的 SW 控制：
  在 Firefox/Playwright 环境下不稳定，尚未判定是真实差异还是环境差异。
- `export.spec.ts` 的 MP3 离线渲染在 Firefox 下超出用例时限（渲染比 Chromium 慢很多）。

## 6. 忙机器上的计时门禁

这台机器经常被其它负载占满（8 核老 i7，实测 load 8–13），此时 `bench` 的平均块耗时会是空载的 3–4 倍，
但 DSP 一行没改。因此 `scripts/bench.mjs` 现在有**两道自检**：跑前跑后的 `loadavg`，以及**自身的持续负载**
（空载约 250 µs/块，超过 450 µs 即认为宿主被过度占用）。任一条命中就只报正确性检查、把计时检查标记为
「跳过（宿主繁忙）」并说明原因，退出码仍为 0；空载时计时门禁照旧。Playwright 的默认超时也从 45 s 提到 60 s，
路由图用例的编辑器内点击走 `force`（等两帧在 load 12 时会超时，而每次点击后面都有状态断言兜底）。

## 7. 忙碌宿主上的 E2E 判据补充

同一台机器一旦被别的负载占满（实测 load 14.6 / 8 核），整套 Chromium E2E 会出现 2–3 个**超时**失败，
而按文件重跑立刻全绿（本轮实测：整包 96/99，失败 3 项按文件重跑 16/16 全通过）。所以本地流程是：
整包失败且 `loadavg` 明显大于核数时，先看失败项是不是「等元素/等帧」类超时，再按文件重跑确认；
`bench` 的计时门禁同理（见第 6 节）。真正的判据仍是空载整包 + CI。

## 8. 部署后核对线上资源的两个坑（Cloudflare）

1. `wrangler deploy` 之后 **CF 边缘可能还缓存着旧的 `index.html`**（`cache-control: max-age=0,
   must-revalidate`，但边缘 HIT 会先给旧副本）：用带随机查询串的请求核对资源 hash，
   若第一次仍是旧的，**再跑一次 `npx wrangler deploy`**（第二次会提示 “No updated asset files”，
   但会把新清单推上去），几秒后即一致。
2. 核对方式：`curl -s "https://synth.wangda.today/?cb=$RANDOM" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
   与 `grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html` 对比，两边一致才算部署成功。
