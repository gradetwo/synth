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
| Firefox（Playwright 自带） | ✅ 可跑；比 Chromium 慢，滚动/拖拽类用例偶有差异。**但本会话沙箱里没有音频后端，Firefox 起不来实时 `AudioContext`；音频观测类用例会显式 skip，见 §11** |
| WebKit | ✅ 系统库装好后可本地运行（`npm run test:e2e:webkit`，单 worker）；比 Firefox 更慢：单个用例常 30–45 s，整包连跑会有大量用例在「点击后卡住」处超时 |

## 3. WebKit（Safari 内核）本机现状

### 3.1 更正：headless 下 rAF 是会触发的（2026-09-14 重测）

本节早先写的「headless WebKit 里 `requestAnimationFrame` **完全不触发**（实测 500 ms 内 0 帧）」
**是错的**：它把「应用页没有帧」误当成了「内核不触发 rAF」。本轮用同一个探针重测
（Playwright 1.63 / WebKit 26.6，本机 headless，除注明外都是 1.5 s 窗口）：

| 页面 | rAF 帧数 |
| :--- | ---: |
| `about:blank` | 55–57 |
| 静态 `data:` 页 | 42–55 |
| 一个 div + `box-shadow` | **1** |
| 一个 div + `filter: blur(4px)` | **1**（且主线程被占 5.6 s） |
| 应用页（启动遮罩可见） | **0**（3.5 s 窗口，`setTimeout` 同期跑了 110 次） |
| 应用页 + 载入时就把 `#root` 设成 `display:none` | **82** |
| 应用页 + 把所有 JS 请求 abort | **93** |

结论：**headless WebKitGTK 会触发 rAF，但它没有合成器、只能软件光栅化**；只要页面需要真的画出来
（本应用 1500–2300 个节点 + 7 个 canvas），它一帧都交不出来（内核上限是 55 fps 级的，见
`ui-frame-cost.md` 的空白页数字）。主线程是好的：同一时刻 `setTimeout` 仍能跑 ~50 次/秒，
`page.mouse.click()` 也能立刻生效；把 `#root` 从载入起就 `display:none`（不做布局/绘制）帧率立刻
回到 55 fps。**帧钟是按页面隔离的**：应用页死掉之后，同一个 browser 里新开的页面照样 55–59 fps。

排除过的其它解释：关掉 SW（`serviceWorkers: 'block'`）、abort `sw.js`、abort wasm、abort 字体、
stub 掉 `AudioContext`、把 `box-shadow`/`filter`/`backdrop-filter`/渐变/圆角/动画全部用载入期 CSS
关掉（已核对 `getComputedStyle` 确认生效）、`WEBKIT_DISABLE_COMPOSITING_MODE` /
`WEBKIT_FORCE_COMPOSITING_MODE` / `WEBKIT_DISABLE_DMABUF_RENDERER` / `LIBGL_ALWAYS_SOFTWARE` /
`GDK_BACKEND=broadway` —— 全都还是 0 帧。只要应用真的可见地画出来，headless 就交不出帧。

### 3.2 卡点是 Playwright 的 actionability；而 init script 够不着它

Playwright 每次点击前要等元素的盒子「连续两帧不变」（stable）。帧率 ~0 ⇒ 每次 `locator.click()`
都等到超时：实测 8–30 s，`boot.spec.ts` 两个用例 2.4 min。卡点就是这一条，报错原文是
`waiting for element to be visible, enabled and stable`（元素其实是 visible + enabled 的）。
对照：`page.mouse.click(x, y)` 不做这些检查，同一元素 **40–220 ms** 就能点到。

**但是**「用 `page.addInitScript` 注入 rAF 兜底」**不能**解决它（这是本轮最重要的否定结论）。
Playwright 的注入脚本跑在 **`__playwright_utility_world__` 隔离世界**里
（`playwright-core/lib/coreBundle.js` 里 Chromium/Firefox/WebKit 三处都是这个常量），它用的是那个
世界里的原生 `requestAnimationFrame`；主世界的 init script 改不到它。实测证据：注入兜底后主世界
rAF 从 0 回到 36–54 fps，主世界里该按钮 `visible`、`enabled`、**连续两帧盒子完全相同**、
`elementFromPoint` 命中，而 `locator.click()` 仍然一直等到超时。`page.clock.install()` 同样不行
（实测一样超时）。所以「rAF 兜底」这条路在本机是死的——它只能救**应用自己**的 rAF 循环，
救不了 Playwright 的等待。

其余「按帧等待」的动词也一并实测过：`scrollIntoViewIfNeeded()`（8 s 超时）、`hover()`、
`dblclick()`、`tap()` 都是按帧的；`boundingBox()` 也要 14.2 s（所以「改用 `page.mouse.click`」
不能只把 `click()` 换掉，取坐标本身也会卡；`click({ force: true })` 也还要 5.5 s）。
不按帧的：`isEnabled()` 12 ms、`isVisible()` 7 ms、`locator.evaluate()` 33 ms、
`getAttribute()` 22 ms、`press()` 29 ms、`fill()` 61 ms、`selectOption()` 17 ms、
`waitFor({ state: 'visible' })` 19 ms。断言（`expect(locator).*`）走的是定时器轮询，不受影响。

### 3.3 采用的办法：帧无关的交互（`e2e/fixtures.ts`，仅 WebKit）

`e2e/fixtures.ts` 在 WebKit 下把按帧等待的几个动词（`click` / `dblclick` / `hover` / `tap` /
`check` / `uncheck` / `scrollIntoViewIfNeeded`）换成帧无关实现：

1. `waitFor({ state: 'visible' })` —— Playwright 自己的可见性等待，定时器驱动，实测 19 ms；
2. `isEnabled()`（12 ms）；
3. 一次 DOM `scrollIntoView`（只在元素出屏时做）；
4. `locator.evaluate()` 读盒子（33 ms，**不带** auto-wait）；
5. `elementFromPoint` 命中测试（「元素真的能收到指针事件」；每次重试都重新读一次盒子，因为
   正在滑入的面板会移动），失败就重试到用例超时；
6. `page.mouse.click(x, y)`（或 `touchscreen.tap`）派发真实事件。

保留的是**可见性、启用状态、命中测试**这三项与帧无关的可操作性检查，丢掉的只有定义上就依赖动画帧
的那两项（stability、按帧的滚动等待）。**断言一个都没改，阈值一个都没放宽。** 实测同一批点击
39–57 ms。`locator.click()` 的 `position` / `button` / `clickCount` / `modifiers` / `delay` /
`force` / `trial` / `timeout` 都照常处理，超时默认沿用用例超时（与 Playwright 的 `actionTimeout`
默认一致），没有另设更短的封顶。

同时注入 `e2e/raf-fallback.init.js`：它**不改变** Playwright 的等待（做不到，见 3.2），但让
**应用自己**的 rAF 循环（播放器、节拍器、`animationBus` 上的画布）在合成器饿死时仍然有帧可跑。
两个开关互相独立：`GS1_E2E_FRAME_FREE_CLICKS=1/0`、`GS1_E2E_RAF_FALLBACK=1/0`；默认都只对
WebKit 生效。Chromium/Firefox 的路径不变：补丁按用例重新检查引擎，同一个 worker 进程里跑别的
project 会退回原生实现。

### 3.4 结果（headless，`--workers=1`，`--retries=0`，核心子集 8 个 spec / 38 个用例）

| | 之前 | 之后 |
| :--- | :--- | :--- |
| `boot.spec.ts` | 2 passed / 2.4 min | 2 passed / 1.2 min（用例 1：56.3 s → 6.6 s） |
| 核心子集 | 30 min 只跑到第 5 个 spec，反复 20 s 级超时，最后被 kill | **35 passed / 3 failed / 22.7 min** |

3 个失败逐个核对过（把 `GS1_E2E_FRAME_FREE_CLICKS=0` 关掉、用原先那条慢路径单独重跑同样 3 个用例）：

- `fxgraph.spec.ts`「pulls a modulation wire, sees the change, and keeps it across a fresh load」：
  `[data-mod-edit="0"]` 不出现。**关掉本改动后同样失败**（1.1 min）⇒ 与本批无关，是 WebKit 自身差异。
- `theme.spec.ts`「filled controls keep their contrast in light mode」与「auto follows the system live,
  and the choice persists」：**关掉本改动后通过**（各 1.1 min）。原因不是点击实现，而是**headless
  下没有渲染更新**：`page.emulateMedia()` 改了颜色偏好后，WebKit 要等一次渲染更新才会重新求值
  媒体查询，而这一页永远不产生帧。独立探针（完全不点任何东西）复现的形态是
  `emulateMedia(dark)` 之后 `data-theme` 先变 `dark`、1.5 s 后又退回 `light` —— 应用侧这套
  「跟随系统」的逻辑在媒体查询不会重新求值时会来回摆。慢路径之所以通过，只是因为它的点击慢到
  足以等到那几次稀有的真实帧。这两条**需要在有合成器的环境（Weston/Xvfb）上跑**：已在
  Weston headless + 本 fixtures 下实测通过（`./scripts/e2e-webkit-wayland.sh e2e/theme.spec.ts
  --retries=0 -g "…"`，2 passed / 3.0 min）——说明它们纯粹是「headless 没有帧钟」，
  不是帧无关交互的语义问题，而且帧无关交互在有合成器的环境里同样正常。
- 另外 `theme.spec.ts:137` 与 `:192` 的失败都落在**同一条**「媒体查询不会重新求值」上，不是两条
  独立的缺陷。

### 3.5 边界：读像素的事仍然必须有合成器

- `locator.screenshot()` 在 headless WebKit 下**不返回**（实测 20 s 超时）；`page.screenshot()`
  能出图但要 4–5 s（`fullPage` 4.0 s）。所以 `e2e/visual.spec.ts` 仍然只能跑在 Weston/Xvfb 上，
  基线比对更不能在 headless 下做。
- `e2e/performance.spec.ts` 量的是帧率，headless 下没有意义（它本来也只在 chromium project 里）。
- 帧无关的交互**不验证「元素连续两帧不动」**：正在滑入/动画中的元素，实现每次重试都会重新读盒子，
  但「两帧不动」这条在 headless 下无从验证。真实差异仍然要靠 Weston 那一遍。

### 3.6 历史坑（仍然有效）

**装饰性动画 vs Playwright 的「稳定性」检查（已修）**。即使有头模式，WebKit 下点击一个带动画的
界面（启动页呼吸动画、示波器、脉冲提示等）时，Playwright 会一直等「两帧之间盒子不变」，实测**等到
90 s 超时**；把 `prefers-reduced-motion: reduce` 打开后同一个点击 6.3 s 完成、面板正常出现。因此
`playwright.config.ts` 里 WebKit / Firefox 两个项目显式设了 `reducedMotion: 'reduce'`：应用本身尊重
这个偏好，测试要断言的是行为而不是动画。（注意这条和 3.1 是两件事：动画导致的「不稳定」在
Chromium 上同样会让点击超时——实测一个无限平移的按钮在两个内核上都点不中——那是 Playwright 的
正常语义。）

**第二个坑：`reload()` 后渲染线程长时间不回应（已绕开）**。WebKit 下「页面重载 + 音频引擎重启」之后，
点击会长时间卡在 “performing click action”（实测 120 s 超时）；把持久化用例改成**新开一个页面重新加载**
（`page.context().newPage()` + `goto`，状态只来自 localStorage）后立即通过。同一改动在 Chromium/Firefox 上等价
（它们本来就用 reload 验同一件事），所以 `e2e/fxgraph.spec.ts` 用它做「重开后仍在」的回归。

**顺带的产品改进**：路由图的「从信号链重建」原来要写 37 个参数、每次 `setParam` 都 commit + 两次 localStorage
写入 → 一个动作触发几十轮重绘，WebKit 下尤其慢。现在 `store.setParams([...])` 把一批参数作为**一次变更**提交，
重绘与存储各一次。

实践建议：本地 WebKit 仍然优先 `npm run nightly`（Weston 有头，见 `docs/notes/nightly.md`），因为它要跑视觉
子集；只想跑核心/音频子集时 headless 现在也能用了（`GS1_E2E_PORT=4797 npx playwright test --project=webkit
--workers=1`），`e2e/fixtures.ts` 会自动接管 WebKit 的按帧交互。

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
  只在 `github.event_name == 'schedule'` 时跑：WebKit 与 Firefox **各一遍 `--all` 全量**（Xvfb 有头）+ `npm run bench:long`，
  产物（`.tmp/nightly`、`test-results`）保留 14 天。CI 不写记录（工作区一次性的），记录由本机 / systemd 那次写。
  `scripts/verify-ci.mjs` 把这个作业也纳入门禁，防止它被静默删掉。
  **2026-09-14 变更**：原来另有一个每次 push/PR 都跑的 `e2e-engines` 作业（WebKit 全量 + Firefox 全量），
  已按用户的 **20 分钟判据**删除（WebKit 整包实测 **42.7 min**，连最相关的 50 条都要 **19.1 min**）⇒ 两个慢引擎
  现在**只**在这个 schedule 作业里跑。`verify-ci.mjs` 为此加了断言：慢引擎不许出现在任何非 schedule 的作业里，
  且 `nightly` 必须对**两个**引擎都跑 `--all`——否则删掉 `e2e-engines` 就成了一次静默的覆盖率损失。
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

**更正（2026-09-14，见 §3.1）**：WebKit headless 的「0 帧」是**应用页**的 0 帧，不是内核不触发 rAF
（空白页实测 55–58.7 fps）。同一份测量在 §3.1 重做过一遍：headless 的 WebKitGTK 就是没法把这一页
软件光栅化到能出帧，所以「每次点击等两帧」在那里永远等不到；帧无关的交互（§3.3）绕过了这一点，
但读像素的用例（`locator.screenshot()`）仍然必须有合成器。

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

### 8.1 贴 60 s 线的用例：`e2e/player.spec.ts:45`（2026-09-15 修，trel 轨道）

**现象**：整套跑 `Test timeout of 60000ms exceeded`（慢轨 v2.1.0 那轮停在
`locator('.player-transport .player-btn[aria-label^="清除"]')`），单跑 13.8 s 绿；同 spec 的
`player:153` 整套里 49.7 s。要判的是：这是「争用」还是「这条本身贴线」？

**可复现的对照**（不必把机器压满，因此也不影响别的轨道）：用 CDP
`Emulation.setCPUThrottlingRate` 把**渲染进程**按倍数放慢（**安静宿主**，load 8–16），跑同一条用例，
只改这一个变量：

| 渲染放慢 | 修前 | 修后 |
| ---: | :--- | :--- |
| 1× | ✓ 20.0 s | ✓ 21.1 s |
| 4× | ✓ 40.8 s | ✓ 48.6 s |
| 6× | ✓ 41.7 s | ✓ 54.0 s |
| **8×** | **✘ `Test timeout of 60000ms exceeded`** | ✓ 47.9 s |

修前 8× 那次停在 `page.locator('.player-time').textContent()`，慢轨那轮停在「清除 A/B」的点击——
**每次停在不同的步**，因为预算是在整条用例上耗尽的：谁落在 60 s 那一刻谁就是报错行。选择器没坏、
也没有某个固定的资源在争用 ⇒ 不是产品缺陷，是**这条用例自己的时间预算**（内部 `1200+1500+4000 ms`
三段固定 sleep，外加约二十次交互，每次都要付 actionability 的「等两帧」＋一个 CDP 往返）。

**修法**：A/B 两个点改成**等 transport 自己的时钟**（`expect.poll` `.player-seek` 的值越过阈值），
不再猜 1200/1500 ms；「不能跑出区间」也从「睡 4 s 后读一次」改成**采样并要求回绕**——每个采样都必须落在
区间内，而且必须看到 `time` 变小（回绕），这比原来的一次读数**证据更多**而不是更少。阈值与断言一条没放宽。

**结果**：修后 8×（= 宿主比本机慢 8 倍）**不改配置就能过**；但 4×/6× 已读到 48.6 / 54.0 s，
说明更慢的宿主上 60 s 仍是硬约束，所以 chromium project 补了 `timeout: 90_000`
（与 Firefox 同数、同一理由，注释里写了上表）。**没有加 `retries`**：重试会把「三次里红一次」的真实抖动
洗成绿；预算只决定一个**卡住**的步骤能等多久，断言本身一条没动。

注意 `test:visual` 也是 `--project=chromium`，因此同样拿到 90 s 的**用例**预算；它的**比对**预算是另一个
`expect.timeout`（15 s），没有改——视觉那条自证用例的红是光栅没画完，修法是先 prime 再比，
见 `docs/notes/visual-regression.md`。

## 9. 部署后核对线上资源的两个坑（Cloudflare）

1. `wrangler deploy` 之后 **CF 边缘可能还缓存着旧的 `index.html`**（`cache-control: max-age=0,
   must-revalidate`，但边缘 HIT 会先给旧副本）：用带随机查询串的请求核对资源 hash，
   若第一次仍是旧的，**再跑一次 `npx wrangler deploy`**（第二次会提示 “No updated asset files”，
   但会把新清单推上去），几秒后即一致。
2. 核对方式：`curl -s "https://synth.wangda.today/?cb=$RANDOM" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
   与 `grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html` 对比，两边一致才算部署成功。

## 8. 虚线描边的命中测试在 Gecko/WebKit 上会「漏」（v2.0.1，fxwire 轨道实测）

**现象**：`e2e/fxgraph.spec.ts` 的「拉调制线」用例在 **Firefox 与 WebKit 上确定性失败、Chromium 通过**，
自 P7.2（v1.101.0）起就如此。它让当时的 CI 跨引擎作业（`e2e-engines`，2026-09-14 已按 20 分钟判据并进 `nightly`）
长期带着一个假红——**跨引擎信号因此失去意义**。

**真因不是「点到了包围盒中心之外」**（那条被点线的包围盒中心恰好就是曲线中点，三引擎几何完全一致），
而是 **`stroke-dasharray: 5 3`**：命中测试跟随**画出来的**描边，而虚线间隙是死画布。

| 引擎 | 同一点 `elementFromPoint` | 同一点的真实事件 | `dasharray:none` 后 |
| :--- | :--- | :--- | :--- |
| Chromium | `path.fxg-wire mod` | 命中（它把**整条路径**当命中区） | 命中 |
| Firefox | `div.fxg-canvas`（未命中） | 未命中 | **命中** |
| WebKit | `path.fxg-wire mod`（**说命中了**） | **五个事件 target 全是 `div.fxg-canvas`** | **命中** |

**WebKit 的坑**：它的 `elementFromPoint` **忽略** dash，而事件命中**不忽略**——两者不一致，
所以**不能拿 `elementFromPoint` 当判据**，必须看真实事件。
**加宽也没用**：虚线保持 `5 3`、线宽加到 12 px，Firefox 的中点依然点空（间隙横跨整个线宽）。

**修法（产品侧）**：每条 wire 在可见路径**之下**加一条同曲线的**实心透明 2 px 命中笔画**（`.fxg-wire-hit`），
共享同一个 `onClick`；它 `aria-hidden`、**不带** `data-wire`/`data-modwire`（否则 `toHaveCount(1)` 类断言会翻倍）。
**刻意保持 2 px 不加宽**：实测 12 px 会让相邻 wire **互相抢点击**（点 wire0 的中点选中了 edge 1，删错边）。
若要真做成手指友好的宽命中区，正确做法是「在候选里取最近的那条 wire」，而不是简单加宽。

**验证**：Firefox `--retries=0` **2/2 绿**；Chromium 整个 `fxgraph.spec.ts` **16/16** 不回归；
WebKit 功能上 2/2 绿（600 s 诊断预算下），但**仓库现有 120 s/用例预算在当时的会话里不够**——那次会话**看不到 `/dev/dri`**（见下面的沙箱说明）、
软件渲染 ~1.8 fps，该用例约需 162 s，而**修复前 WebKit 也是顶满 120 s 才失败**，所以这不是本批引入的预算问题。
（**后续更正**：fxwire + webkitraf 两条轨道合并后，同一条用例在 headless WebKit 下 **40.7 s 通过**，标准 120 s 预算够用。）
**没有**改 `playwright.config.ts` 的 timeout 去制造绿灯。

**同类风险扫描**：全量 grep `click({ force: true })` 后，真正点 SVG **描边**的只有 3 处，全在 `fxgraph.spec.ts`
（`:93` 音频线是实线所以未暴露、`:411`/`:439` 是调制虚线），均已被同一修法覆盖；其余 force 点击的目标都是 HTML。
**教训**：给 SVG 描边做点击目标时，**不要依赖 dash 的可见段**；要么用实心透明命中笔画，要么自己算最近路径。

## 9. ⚠️ 沙箱会隐藏 `/dev/dri`（2026-09-14 用户指正）

**本机是有 `/dev/dri` 的**（Intel HD 3000 + Radeon HD 6400M，i915/amdgpu 已加载）。但**本会话所有命令都跑在一个
沙箱里，它把 tmpfs 挂在 `/dev` 上、盖住了真正的 devtmpfs** ⇒ `ls /dev/dri` 得到「不存在」，
只有 `null/zero/random/tty/...` 这几个节点。

后果与规矩：
- **任何「本机没有 GPU / 只有软件渲染」的结论，都必须写成「本会话的沙箱里看不到 `/dev/dri`」**，不要写成机器的事实——
  否则会把一个沙箱限制误记成硬件限制（本轮就发生过：两个 agent 的报告都这么写了）。
- `scripts/e2e-webkit-wayland.sh` 第 66 行会打印 `renderer:`，**看它就知道这次跑的是 GL 还是软件**；在沙箱里必然打 `software (no /dev/dri)`。
- **要用 GPU 就必须在沙箱外跑**（用户自己的桌面会话里的终端，或用放宽沙箱的一次性运行）。
  在那之前，所有 weston/WebKit 的帧率数字都只代表**软件渲染**，`compat.md` §3 的 1.8 fps 也是软件数字。
- 这不影响测试的**正确性**（功能断言与帧率无关），只影响**速度**与「能不能跑得完」。

## 10. 有了 `/dev/dri` 到底快了多少？——**渲染快了，测试没快**（A/B/C 实测，2026-09-14）

三套配置、同一棵树、同一台机器、同一批用例。帧率用 `.tmp/fps-probe.mjs`（每页数 2 s 的 rAF 回调）：

| 配置 | blank | 静态绘制页 | **应用页（启动遮罩）** | **应用页（引擎已启动）** |
| :--- | ---: | ---: | ---: | ---: |
| **A** headless（无合成器）+ 帧无关点击 | 62.5 | 62.5 | **0.5** | 1.0 |
| **B** weston，**软件**渲染，有头 | 28.5 | 21.5 | 3.5 | 23.5 |
| **C** weston，**GL**（`/dev/dri/renderD128`），有头 | **57.5** | **45.0** | 3.5 | **35.5** |

`e2e/boot.spec.ts`（2 条用例）的墙钟：

| 配置 | 墙钟 | Playwright 自报 |
| :--- | ---: | :--- |
| **A** headless + 帧无关点击 | **30.5 s** | 2 passed (27.7 s) |
| **B** weston 软件 | 78.1 s | 2 passed (1.3 m) |
| **C** weston GL | 83.0 s | 2 passed (1.3 m) |

**结论（三条，别只读第一条）**：
1. **GL 确实加速渲染**：引擎跑起来时 **23.5 → 35.5 fps（+51%）**，blank 28.5 → 57.5（+102%），静态页 21.5 → 45.0（+109%）。
2. **但它没有省测试时间**：GL 83 s vs 软件 78 s —— **GL 反而略慢（在噪声内）**。原因是这些用例的瓶颈**不是帧率**，而是每次操作的开销与应用自身的工作量；
   注意**启动遮罩页在两套 weston 下都只有 3.5 fps**（首帧绘制很贵），而用例大量时间花在启动阶段。
3. **最快的是 A（headless + 帧无关点击）**：30.5 s，比两套 weston 都快 **2.6×**。所以 WebKit 通道的速度来自**去掉对帧的依赖**，
   不是来自 GPU。GPU 的意义在「要*看*这个应用」（视觉/截图类工作），不在「驱动测试」。

**A/B 暴露了我自己补丁里的两个真 bug**（只在非 GL 路径出现，所以不做 A/B 就会带病上线）：
① `"${arr[@]}"` 在 `set -u` 下遇到**空数组**会直接报 unbound variable ⇒ **任何没有 `/dev/dri` 的机器上整条通道会在 0.3 s 内退出**；
② `grep` 没匹配 + `set -e`+`pipefail` ⇒ 软件路径直接中止。两处都已修，并加了 `GS1_WESTON_NO_GL=1` 以便随时 A/B。

## 11. ⚠️ 沙箱里没有音频后端 ⇒ Firefox 起不来任何实时 `AudioContext`（2026-09-15，ffx 轨道实测）

**一句话**：本会话的沙箱把 tmpfs 挂在 `/dev` 上（没有 `/dev/snd`）且没有 PulseAudio/PipeWire 守护进程，
Firefox 因此拿不到 cubeb 后端，**任何**实时 `AudioContext` 都停在 `suspended`——`resume()` 永不 settle。
Chromium 有 **null sink** 兜底，照常 `running`。所以 Firefox 上「引擎状态 suspended、电平表恒 `— · —`」
是**宿主限制，不是产品回归**；产品零改动，E2E 侧改成显式 skip（见本节末）。

### 11.1 宿主事实（原始输出）

```
$ ls /dev/snd
ls: cannot access '/dev/snd': No such file or directory
$ ls /dev
core  fd  full  null  ptmx  pts  random  shm  stderr  stdin  stdout  tty  urandom  zero
$ pactl info
Failed to create secure directory (/run/user/1000/pulse): Read-only file system
Connection failure: Connection refused
$ aplay -l
aplay: device_list:279: no soundcards found...
$ ps aux | grep -E 'pipewire|pulse|wireplumber' | grep -v grep
（无输出：/run/user/1000/pipewire-0 socket 在，但守护进程没跑）
```

Firefox 自己的 stderr（`DEBUG=pw:browser`，一次探针运行里重复 18 次）：

```
[pid=15][err] Failed to create secure directory (/run/user/1000/pulse): Read-only file system
```

（`/proc/asound` 里能看到 `card0/card1`，那是宿主内核的账本；沙箱的 `/dev` 里没有对应节点，打不开。）

### 11.2 决定性探针：Firefox（rv:155，同一份 v2.1.1 dist）

全部在**受信任点击**里创建/恢复（Firefox 会拒绝它认为「没有手势」的上下文，所以这是最严格的问法）：

```
A 预手势建的 ctx，在点击里 resume        : resume TIMEOUT_after_6s, state suspended, 44100 Hz
B 点击里新建 ctx 并 resume                : resume TIMEOUT_after_6s, state suspended, 44100 Hz
C 点击里 new AudioContext({sampleRate:48000}): resume TIMEOUT_after_6s, state suspended, 48000 Hz
D OfflineAudioContext 渲染                : peak 1（离线渲染正常 ⇒ Web Audio 本身没坏，坏的是输出设备）
navigator.userActivation.hasBeenActive     : true（⇒ 不是自动播放策略拦的）
navigator.mediaDevices.enumerateDevices()  : []（连一个 audiooutput 都没有）
audioWorklet.addModule(真 worklet-processor): ok（1109 ms，二次 27 ms 缓存）
new AudioWorkletNode('gs1-synth-processor') : ok
设置面板                                   : 引擎状态 suspended · 采样率 44.1 kHz · DSP 内核 simd · 流式编译 · 输出峰值 —
电平表                                     : — · —
```

### 11.3 Chromium 对照（同一台机器、同一份 dist）

```
A/B/C（含 --autoplay-policy=user-gesture-required）: resume resolved, state running
设置面板                                            : 引擎状态 running · 采样率 44.1 kHz · 输出延迟 42 ms · DSP 负载 1%
```

**「Firefox 44.1 / Chromium 48」这条线索在本轮不成立**：两侧默认都是 **44.1 kHz**，Firefox 也接受
`{sampleRate: 48000}`（C 读出 48000）却照样不跑。采样率不是原因；差别只在「有没有 null sink」，
44.1 kHz 是无声卡时的回退默认值（`verify-audio` 里的 48 kHz 是 wasm/预算常量，不是浏览器上下文）。

### 11.4 不是 v2.0.3 之后的产品回归

用同一探针跑 `.tmp/sweep-v2.0.3/dist`（v2.0.3 worktree 的既存构建），读数与 v2.1.1 **逐项相同**：
`引擎状态 suspended`、电平表 `— · —`、`addModule ok`、裸 ctx 永远 suspended、44.1 kHz。
`e2e/boot.spec.ts` 与 `src/audio/engine.ts` 自 v2.0.3 起也没有变化（`git diff v2.0.3..HEAD` 为空/仅
v2.0.7 的量程改动）。⇒ v2.0.3 那一轮 Firefox 这两个用例「绿」与本轮的差异在**宿主/当时读数**，不在代码。

**产品侧线索也排除了**：v2.0.7 放宽过 `worklet-processor.js` 的 `parameterDescriptors` 量程，本轮直接证伪——
Firefox 上 `addModule` 与 `new AudioWorkletNode` 都成功，描述符不是启动失败点。

### 11.5 E2E 处置：`e2e/audio-host.ts`

`hostAudioUnavailableReason(page)`：**一个全新 `AudioContext`、零应用代码，在受信任点击里创建并 `resume()`**，
用它自己是否 `running` 作判据：

- 返回 `null`（宿主能跑声音）⇒ 用例照常断言，**产品回归不会被跳过掩盖**；
- 返回带读数的原因 ⇒ `boot.spec.ts` / `meter.spec.ts` / `preset-audition.spec.ts` / `pwa.spec.ts`
  这 4 条音频观测用例 `test.skip` 并在终端打印原因（`[audio-host] firefox: skip audio assertions -- …`）。

Chromium（含 `--autoplay-policy=user-gesture-required`）下该判据返回 `null`，**Chromium 覆盖不变**。
本机想手动复核，最短路径就是在目标浏览器开应用，`new AudioContext()` 后点一次真实的手势再 `resume()`，
读 `state`：本沙箱里 Firefox 永远 `suspended`、Chromium 立刻 `running`。

### 11.6 同一个根因的另一副面孔：启动遮罩在 Firefox 上要 ~5 s 才抬起（`fm:33` / `i18n:83`）

`engine.start()` 在上下文起不来时会**等两次** `settleWithin(resume, RESUME_GRACE_MS)`（先 resume、再
`resumeIfSuspended`），每次 2500 ms，所以 `.start-overlay` 要 **~5 s** 才消失；Chromium 上 `resume()` 立刻
resolve，遮罩几乎马上抬起。探针实测（Firefox，点击启动到 `.start-overlay` 消失）：**gateMs = 5033 ms**。

在那之前 `.start-overlay` 铺满整页，`document.elementFromPoint()` 在 FM 旋钮中心返回的是
`class="start-overlay"`；遮罩一抬起，同一个点返回 `class="knob-dial" / aria-label="FM"`，同一个 60 px
拖拽把值从 0 变成 **0.3158**（与 Chromium 逐位相同）。

- `e2e/fm.spec.ts::boot()` 原来只 `waitForTimeout(300)`，于是第一次拖拽落在遮罩上，`fmValue` 读回 0；
- `e2e/i18n.spec.ts::boot()` 原来只等 `.kbd-dock.open` **可见**（它在遮罩后面也算可见），随后
  `{ force: true }` 的点击被遮罩接走，播放器/设置面板根本没打开 ⇒ `.player-transport` 找不到。

**修法（测试基建，未放宽任何断言）**：两个 `boot()` 在点击启动后显式等
`expect(page.locator('.start-overlay')).toHaveCount(0, { timeout: 15_000 })`——这正是产品承诺的行为
（`boot.spec.ts` 第一条用例就在断言它），再继续交互。正常机器上这条等待是毫秒级。
