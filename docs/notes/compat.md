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

实践建议：本地用 `npm run nightly`（默认 WebKit，子集是核心 + 视觉冒烟 + 音频，Weston 有头，见
`docs/notes/nightly.md`）；`--core` 只跑核心子集，`--all` 跑全量；整包的判据仍然放在 CI。

## 4. 夜间跑（C1 的落地形态，P11.6 扩了覆盖率与记录）

- **子集（P11.6）**：`scripts/nightly-e2e.mjs` 现在有三块，默认全跑；`--core` 只跑第一块，`--all` 是不带文件列表的全量：
  - **核心**：iPhone/iPad 六视口、触屏、排版、启动、路由图、分享、抽屉、主题（8 个 spec）；
  - **视觉**：`e2e/visual.spec.ts`。**WebKit/Firefox 上只渲染、不比基线**（下一条说原因），Chromium 上照常比；
  - **音频**：`smoke`/`audio`/`filter`/`delay`/`fm`/`oversample`/`wavetable`/`sample`/`meter`（9 个 spec）——
    引擎起不起得来、改音色的控件可不可达、补丁带不带着走。
  清单只在脚本的常量里维护一处，本笔记不复述文件名（复述就会漂）。
- **视觉基线为什么在 WebKit/Firefox 上不比**：Playwright 找基线的模板是
  `{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}`（`playwright.config.ts`
  没有覆盖 `snapshotPathTemplate`），`snapshotSuffix` 是平台（`linux`）⇒ WebKit 找 `*-webkit-linux.png`、Firefox 找
  `*-firefox-linux.png`，而仓库里只有 48 张 `*-chromium-linux.png`。缺基线**也不是跳过**：默认
  `updateSnapshots: "missing"` 会把它**写下来并把用例判失败**（Playwright 1.63 里这个默认值与 CI 无关，
  见 `playwright/lib/common/index.js` 的 `updateSnapshots: ... "missing"`），本地跑一次就会
  往 `e2e/visual.spec.ts-snapshots/` 丢一批本机软件渲染出来的假基线。何况这两个内核上的像素带着本机的字体栈与
  软件渲染，放宽 `maxDiffPixelRatio`/`threshold` 只会把真差异一起放过——那是别处的门禁，这里不碰。
  所以 nightly 对 `e2e/visual.spec.ts` 传 `GS1_VISUAL=1 GS1_VISUAL_SMOKE=1`：每个面都截一张、断言拿到的是尺寸
  合理的 PNG，不读也不写基线；证明「比对机制本身能红」的两个 self-check 在这个模式下跳过。
- **记录（P11.6）**：`--update` 写 `docs/notes/nightly.md`，列是
  `日期 | 内核 | 显示 | 结果 | 通过 | 失败 | 通过率 | 用时`。`显示` 是这次真正走的那条路
  （`weston` / `xvfb` / `desktop` / `headless`；本机 `auto` = Weston 优先，CI 上没装 weston ⇒ `xvfb`）。行、通过率、
  以及表下的「通过率趋势」小节都由 `scripts/nightly-report.mjs` 从表本身重算，不留手写结论；
  `node scripts/nightly-report.mjs --self-test` 会校验**磁盘上的 `nightly.md` 正是脚本会写出的样子**，手改过的
  （因而会过期的）趋势过不了自测。写在这两列存在之前的旧行，`显示` 记 `—`：不回填、不猜。
- **CI**：`.github/workflows/ci.yml` 的 `nightly` 作业，`on.schedule: cron '0 19 * * *'`（UTC，约北京时间 03:00），
  只在 `github.event_name == 'schedule'` 时跑：WebKit（`--all` 全量，Xvfb 有头）+ Firefox（`--subset=nightly`，
  即核心 + 视觉冒烟 + 音频；全量 Firefox 已由同一 schedule 上的 `e2e-engines` 作业跑）+ `npm run bench:long`，
  产物（`.tmp/nightly`、`test-results`）保留 14 天。CI 不写记录（工作区一次性的），记录由本机 / systemd 那次写。
  `scripts/verify-ci.mjs` 把这个作业也纳入门禁，防止它被静默删掉。
- **本机**：`npm run nightly`（脚本 `scripts/nightly-e2e.mjs`）= 锁文件防并发（中途抛错也会释放）+ 每个内核一份日志
  （保留 14 份）+ `--update` 写记录。默认子集比 P11.6 之前大得多（核心 + 视觉冒烟 + 音频，约 50 个用例），而本机
  WebKit 约 1 fps，所以整轮以小时计；只想快速看一眼用 `--core`。`--display=desktop` 走自己的会话，
  `--display=xvfb` 强制旧路径；**明确要求**的显示路径不可用时脚本报错退出，不静默回退——否则记录会写一条没走过的路。
  `--dry-run` 只打印内核/显示/子集/命令行，不起浏览器、不写记录。
- **定时**：`scripts/install-nightly.sh` 安装 `scripts/systemd/gs1-nightly.{service,timer}`（用户定时器，
  每天 03:00，`Persistent=true`，`TimeoutStartSec=3h`）；本机当前 session 没有 user bus，安装脚本会给出提示
  （`systemctl --user` 需在登录会话里跑）。unit 跑的是 `--engines=webkit,firefox --update`，所以两个内核都会进记录。
已有的本地记录（P11.6 之前的子集）：`e2e/fxgraph.spec.ts`、`e2e/smoke.spec.ts` 单独跑通过（引擎启动 11 s），
`share.spec.ts`/`fxgraph` 在 WebKit 下也能跑完。

## 5. Firefox 仍未追平的用例（待查，非启动阻塞）

P11.6 起，下面这些里的 `meter.spec.ts` 与 `audio.spec.ts` 属于 nightly 的**音频子集**，所以它们的已知不稳定
会如实进入记录与通过率趋势。不为了「看起来全绿」把它们移出子集——要移出，先按本节的办法定位并写清结论。

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

## 7. 本机显示栈与 WebKit 帧率（2026-09-12 实测）

WebKitGTK 的合成要走显示服务器，帧率直接决定 Playwright 能不能点得动（每次点击等两帧稳定）。
同一台机器（CachyOS，i915 + amdgpu 模块已加载，但本会话的沙箱里看不到 `/dev/dri`，只有软件渲染）实测：

| 方案 | 帧率 | 说明 |
| :--- | :--- | :--- |
| **自己的桌面会话**（推荐） | 正常（有 GL） | 在桌面里的终端跑 `npm run test:e2e:webkit:desktop`；`/dev/dri` 存在时 WebKit 走 GPU，不需要 Xvfb |
| Weston headless（`npm run test:e2e:webkit:wayland`） | 2.2 s / 4 帧 ≈ **1.8 fps** | 比 Xvfb 快一倍多；本机已装 weston 15。有 `/dev/dri` 时应能走 GL |
| Xvfb（`npm run test:e2e:webkit:headed`） | 2.7 s / 2 帧 ≈ **0.7 fps** | 之前记录用的方案，最慢 |
| Docker（官方 `mcr.microsoft.com/playwright:v1.63.0-noble`） | headless **0 帧/4 s**；headed + 容器内 xvfb **>10 分钟无输出** | 容器里没有 `/dev/dri`（要 `--device /dev/dri` 才有）；本轮实测结论：**Docker 在这台机器上帮不上忙** |

**更正（2026-09-12）**：上面的数字都是**应用页**的帧率，不是内核上限。用空白页测，三个内核都能到 60 fps
（Chromium 61.3、Firefox 61.3、WebKit headless 58.7）；真正的原因是应用页每帧做的事太重
（全屏 `backdrop-filter` + 画布每帧重绘 + 启动页 box-shadow/drop-shadow 动画），已修复：
Chromium 空闲 7.5 → 28–33 fps，音频运行中 → 60.8 fps，本机全量 E2E 从 8.7 分钟降到约 4.2 分钟。
详见 `docs/notes/ui-frame-cost.md`。所以「换显示服务器」不是必需的，Weston 的价值在于 WebKit 需要合成器
（headless 下 0 帧），以及有 `/dev/dri` 时能走 GPU。

结论：本机 WebKit 慢的根因是**软件渲染**（叠加当时的应用页每帧成本），不是 Xvfb 本身；换显示服务器只能好一倍，
仍然不够。
真正的解法是在有 GL 的环境里跑（自己的桌面会话），或把 WebKit 的判据交给 CI。

**约定（2026-09-12 起）**：开发与测试中 **本地 WebKit 一律走 Weston**——
`npm run test:e2e:webkit:wayland`（headless Weston；传 spec 文件即只跑该文件，`--all` 跑全量），
桌面里则用 `npm run test:e2e:webkit:desktop`；`npm run nightly` 会自动优先 Weston，其次 Xvfb，
最后才 headless，并把**实际走的那条路**（`weston` / `xvfb` / `desktop` / `headless`）写进
`docs/notes/nightly.md` 的 `显示` 列（P11.6 起；明确用 `--display=` 要求的那条路不可用时直接报错，不静默回退）。
Xvfb（`test:e2e:webkit:headed`）只在 Weston 不可用时作为回退。
注意：本轮为验证 Docker 拉取了 3.56 GB 的镜像，`docker rmi mcr.microsoft.com/playwright:v1.63.0-noble` 可删除。

## 8. 忙碌宿主上的 E2E 判据补充

同一台机器一旦被别的负载占满（实测 load 14.6 / 8 核），整套 Chromium E2E 会出现 2–3 个**超时**失败，
而按文件重跑立刻全绿（本轮实测：整包 96/99，失败 3 项按文件重跑 16/16 全通过）。所以本地流程是：
整包失败且 `loadavg` 明显大于核数时，先看失败项是不是「等元素/等帧」类超时，再按文件重跑确认；
`bench` 的计时门禁同理（见第 6 节）。真正的判据仍是空载整包 + CI。

## 9. 部署后核对线上资源的两个坑（Cloudflare）

1. `wrangler deploy` 之后 **CF 边缘可能还缓存着旧的 `index.html`**（`cache-control: max-age=0,
   must-revalidate`，但边缘 HIT 会先给旧副本）：用带随机查询串的请求核对资源 hash，
   若第一次仍是旧的，**再跑一次 `npx wrangler deploy`**（第二次会提示 “No updated asset files”，
   但会把新清单推上去），几秒后即一致。
2. 核对方式：`curl -s "https://synth.wangda.today/?cb=$RANDOM" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
   与 `grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html` 对比，两边一致才算部署成功。
