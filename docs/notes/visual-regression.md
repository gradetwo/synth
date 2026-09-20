# 视觉回归：48 张基线，和它们能被信任的理由

## 覆盖什么

`e2e/visual.spec.ts`，两组界面，深/浅两套配色 × 手机（390×844）/桌面（1440×900）：

**A. 五个默认界面**（`capture()`，20 张；P11.3 之前就有）

| 界面 | 选择器 | 为什么是它 |
| :--- | :--- | :--- |
| 启动页 | `.start-overlay` | 用户看到的第一屏；版本号被 mask，见下 |
| 模块网格 | `.modules-grid` | 参数面板的排版、字号、配色 |
| 播放器 | `.player` | 抽屉式面板的列表、气泡、按钮 |
| 信号流 | `.flow-canvas-wrap` | 画布上的节点、端口、连线 |
| 钢琴卷帘 | `.roll` | 网格、音符块、工具行 |

**B. 六个只靠几何断言守着的状态**（`captureSurfaces()`，28 张；P11.3 新增）

| 界面 | 选择器 | 进入方式 / 为什么是它 |
| :--- | :--- | :--- |
| 更新横幅 | `.update-banner` | 伪造「有 worker 等待」（照抄 `update-banner.spec.ts`）；一个发布周期只出现一次的状态，几何断言守不住它的排版 |
| 播放器 take 行 | `.take-tools` | 真录两遍，得到两个 take 叠片；空行不是任何东西的基线 |
| 滤波双级（串联） | `[data-module-id="filter"]` | `SER`：第二级的 CUTOFF 2 / RES 2 |
| 滤波双级（并联） | `[data-module-id="filter"]` | `PAR`：BLEND 取代 RES 2 |
| 过采样 LED | `[data-module-id="filter"] .toggle-cell:has(button[aria-label*="过采样"])` | 点亮状态（`aria-pressed="true"`）的那一格 |
| 图模板 select | `.fxg-tpl` | 应用内置模板后的模板选择器 + 保存/删除 |
| 路由图调制线 | 桌面 `.fxg-scroll` / 手机 `.fxg-mod[data-view="mod"]` | LFO 1 → 节点 1 的 output gain，深度 50% |

共 **48 张基线**（20 + 28），存在 `e2e/visual.spec.ts-snapshots/`（约 3.6 MB，无损 PNG，随仓库入库）。
文件名是 Playwright 默认模板给的 `<界面>-<主题>-<设备>-chromium-linux.png`。

### 为什么调制线在手机上拍的不是「线」

`.fxg-canvas` 有八个节点卡那么高（1405 px），远高于它的滚动容器。对它做元素截图会让 Playwright
「capture beyond viewport」，拍到的其实是对话框背后的整页合成图（实测如此，而且逐次不同，3.8 %
像素漂移）。所以桌面拍 **`.fxg-scroll`** —— 滚动窗口，线就在里面。

手机上，两条调制条加上每节点的覆盖参数条把对话框占满，滚动窗口只剩 **33 px** 高，线根本看不见；
手机给的是这条线在手机上的等价物：承载它的那一条调制行（`.fxg-mod[data-view="mod"]`，src / dst /
depth 三个控件）。两种设备拍同一个「状态」，但不是同一个方块，这是有意为之。

## 怎么跑

```bash
npm run test:visual          # 比较（含「自证」用例）
npm run test:visual:update   # 重录基线（只有在你确实想改界面时才用）
```

- 失败时 Playwright 把 `-expected` / `-actual` / `-diff` 三张图留在 `test-results/`（已 gitignore），
  报错信息里带「多少像素不同、占比多少」，不需要靠放大镜猜。
- 需要先 `npm run build`（套件跑 `vite preview` 的是 `dist/`）。
- E2E 有自己的端口 **4783**（`playwright.config.ts`），`vite preview` 用 `--strictPort`，
  不会复用 4173 上别的项目。

## 为什么曾经是可选套件（这段前提仍然成立）

文字栅格化是**这台机器的字体栈**的属性，不是仓库的属性。在 CachyOS 上录的基线没有资格去判
Ubuntu runner 的对错；一条含义为「freetype 版本不同」的红灯，只会教人忽略红灯。所以：

- CI 的 `npm run test:e2e` 会加载这个 spec 并**跳过**（文件顶部的 `test.skip(!RUN, …)`），不产生噪声；
- 录基线是显式动作；比较也是显式动作。当前基线属于本机 + 本机 Chromium。

「不进 CI」在 §一.12 里被证明是有代价的：没人跑 ⇒ 基线漂了十张没人知道。下一节是修这个代价的
**第一步**，它没有推翻上面这段前提。

## 从「可选套件」到 CI 上的报告（§一.12 / §一.20⑦）

`.github/workflows/ci.yml` 里有一个 `visual` 作业：跑
`npm run test:visual -- --update-snapshots=none`，把 48 张基线比一遍、把差异作为制品留下来。
**它只在手工触发（`workflow_dispatch`）时跑**（2026-09-19 起）：`nightly --all` 现在每个引擎都跑一遍，
Chromium 那一遍已经在对这套基线，所以这个作业是「需要看图时点一下」的按需入口——在 Actions 页点
「Run workflow」，它上传 `-expected`/`-actual`/`-diff` 三张图（留 14 天）。`verify` 与 `nightly` 的
`if:` 都排除了 `workflow_dispatch`，所以手工触发只跑这一个作业。

### 为什么保留 `continue-on-error`

- **`continue-on-error: true`**：手工跑出来的红也可能是「runner 的字体栈不同」而不是「界面变了」——
  基线录在开发机（CachyOS），CI runner 是 `ubuntu-latest`。作业本身仍然报 failed、仍然留下图，但它
  不会单独把整次运行判死；手工触发本来也没有 PR 可以挡，保留它是为了让结果按「报告」来读。收紧成硬
  信号是下面「收紧」一节写的下一步，等 runner 的表现明确了再做。
- **`--update-snapshots=none`**：命令本身承诺「只报差异、不录基线」。Playwright 对**缺失**基线的默认
  行为是「写一张然后判失败」——在字体栈不同的 runner 上，那等于**悄悄铸出一张假基线**，而不是把差异
  摆出来。这一条把「别让本地基线被静默覆盖」变成命令行里的硬约束。
- 失败时的 `-expected` / `-actual` / `-diff` 三张图作为 `visual-diffs` 制品留 14 天，让「收紧还是不管」
  这个决定能看着图做。

`scripts/verify-ci.mjs` 的断言：作业必须存在、必须构建后跑套件、必须装 Chromium、必须带
`--update-snapshots=none`；它**只能由手工触发**（`if:` 里只有 `workflow_dispatch`），而且
`verify`/`nightly` 的 `if:` 必须排除 `workflow_dispatch`（手工触发不会顺带跑它们）。
**任何**跑 `test:visual` 的作业都还受「不能在 push/PR 上失败」这条约束——所以以后把它塞进一个必过的
push 作业会在 `verify:ci` 红，而不是变成每个 PR 一条「不同 freetype」的红灯。

### 其它引擎的视觉覆盖在 `nightly` 里，不在这里

这个手工作业只比对 Chromium 的基线。基线文件名是「内核 + 宿主」相关的
（Playwright 模板 `{arg}{-projectName}{-snapshotSuffix}`）：WebKit 会去找 `*-webkit-linux.png`，
Firefox 会去找 `*-firefox-linux.png`，两套都不存在、也不该由开发机录——在 runner 上录它们，等于把
runner 的字体栈与软件渲染固化成「正确」。其它引擎的视觉覆盖因此由 `nightly` 的 `--all` 承担：
`e2e/visual.spec.ts` 在 WebKit/Firefox 上以 `GS1_VISUAL_SMOKE=1` **只渲染、不比对**
（`scripts/nightly-e2e.mjs` 按引擎自动选），证明「这些界面在那两个引擎上画得出来」。
要在这两个引擎上做真正的像素比对，唯一诚实的路是给每个引擎单独录一套基线（见下面「收紧」第 1 条），
而那要先看一次 `visual-diffs` 再决定。

### 第一次实跑之后怎么收紧（**未做：本机验证不了 runner 的字体/渲染**）

本机**无法**验证 CI runner 的字体栈与渲染是否与开发机一致，所以本批只交付「按需报告 + 制品留存」，
把收紧步骤写死，免得下一次靠感觉决定。手工跑一次 `visual`，看它上传的 `visual-diffs`：

1. **差异只落在文字边缘/字形**（典型：每张图几百到几千像素、占比 < 1%，人眼只看出抗锯齿不同）
   ⇒ 这是字体栈差异，**不要**用 runner 的输出覆盖仓库里的基线。正确做法是给 CI 单独一套基线：
   给 `playwright.config.ts` 的 `snapshotPathTemplate` 加一个环境变量后缀（例如
   `GS1_VISUAL_SNAPSHOT_SUFFIX`），在 `visual` 作业里设成 `-ci`，然后用
   `npm run test:visual -- --update-snapshots=all` 在 runner 上录一次，把 48 张带 `-ci` 的图**提交**进仓库；
   之后该作业比对的是 CI 自己的基线，本机那套 `-chromium-linux` 一张都不动、也不允许被覆盖。
2. **差异是真界面差异**（大面积、结构性、能指到某个选择器）⇒ 那是真回归，按「维护」一节走：本机
   `npm run test:visual` 复现、确认是有意改动再重录。
3. **绿** ⇒ 说明两边渲染一致到阈值以内，此时可以去掉 `continue-on-error`。但要去掉的是「豁免」，而且
   要顺带想清楚这条作业还要不要留在手工触发上：`scripts/verify-ci.mjs` 现在断言这条 `continue-on-error`
   与「只能手工触发」，所以收紧必须同时改门禁与本节的结论，是有意为之的一步，不会因为某次绿跑悄悄发生。

在没做完上面那一步之前，**不要**把这条作业的绿读成「视觉门禁已经接上」。它现在的定位是
**按需报告 + 制品留存**（每个引擎的自动覆盖在 `nightly`），真正意义上的「门禁」还差第 1/2/3 步里的一个。
改界面的批次照旧要自觉跑 `npm run test:visual` 并重录（见「维护」一节）——CI 这条作业**不替代**那件事，
它替代的是「没人跑所以漂到过期」。

## 阈值：0.01 像素占比 + 0.05 单像素色距（实测标定）

同一台机器、同一个 Chromium，渲染是确定的，所以阈值可以收得很紧。实测（把 `--accent` 改成不同值再重跑，
service worker 已在 spec 里屏蔽，见下节）：

| 改动 | 阈值 `0.25` / 占比 `0.03`（Playwright 默认口味） | 阈值 `0.05` / 占比 `0.01`（现在） |
| :--- | :--- | :--- |
| `--accent:#ffb340` → `#ffb350`（单通道 16/255，约 6%） | **5 passed** —— 漏掉 | **失败**：浅色桌面启动页 52 585 px（ratio 0.05） |
| `--accent:#ffb340` → `#ff4040`（明显换色） | —（未测） | **失败**：深色桌面播放器 4 102 px（ratio 0.02） |

两条都是真实构建、真实截图：先把色值写进 `src/styles/gs1.css`、`npm run build`、再跑套件，跑完
`git checkout -- src/styles/gs1.css` 并重新构建。

注意差异**不是均匀分布的**：同一个色值改动，模块网格那几张可能仍然通过，而启动页（按钮是大面积纯色）
或播放器（高亮元素集中）会失败。所以「一次失败」就足以拦住改动，而「某些界面通过」不代表没改到——
这也是把界面都纳入的原因，而不是只挑一张全景图。

## 两道自证

1. **套件内的自证用例**（`self-check › a painted style change is reported as a diff`）：
   先正常比较一次（必须通过，否则这个用例什么也证明不了），然后用 `addStyleTag` 把
   `.modules-grid .module` 刷成品红，再要求同一次比较**被拒绝**。
   `npm run test:visual:update` 时它会被跳过——`--update-snapshots` 会把基线改写成被污染的那张。
2. **P11.3 的标定：只改新基线覆盖的那一处**（`.take-chip` 的底色 `var(--bg-inset)` → `#ff00ff`，
   真实构建），套件确实红了，而且**只**红在新基线上：

   | 运行 | 结果（原文） |
   | :--- | :--- |
   | 桌面深色 | `✘ desktop 1440×900 · P11.3 surfaces › dark` · `Snapshot: takes-dark-desktop.png` · `2262 pixels (ratio 0.06 of all image pixels) are different.` |
   | 手机深色 | `✘ iPhone 390×844 · P11.3 surfaces › dark` · `Snapshot: takes-dark-phone.png` · `3104 pixels (ratio 0.09 of all image pixels) are different.` |

   同一轮里 `capture()` 的四个旧界面（启动页/模块/播放器/信号流/卷帘）全部 `✓` 通过——证明这次红
   确实是新基线判出来的，不是阈值抖动。`git checkout -- src/styles/gs1.css` + 重新构建后
   **9 passed**（含套件内自证）。

## 屏蔽（mask）什么，以及为什么

- `.mini-canvas`、`.scope-body`、`.vu-track`：引擎跑起来之后由 rAF 重画的画布，逐帧都在变。
- `.spec-body`（P11.3 补上）：频谱画布**同样是每帧重画**，此前漏在 mask 外。它在浅色桌面启动页上
  撞到「第一帧还没画」的竞态：同一份基线录完立刻比较，`.spec-body` 里 0.4 % 的像素就不一样了
  （`5817 (0.0045) are different`）。补进 mask 后重录，套件稳定。
- `.strip-scope` / `.strip-spec`：紧凑条上同样的两块画布（横屏手机/平板才会出现），一并 mask 掉。
- 启动页的 `.start-sub`（版本号那一行）：它**本来就应该**每次发布都变，所以屏蔽，而不是每版重录一次。
- 更新横幅的 `.update-what`（P10.2 补上，就是那行 `v{version} · {headline}`）：**同一个理由**，而且此前
  漏在 mask 外，已经造成了假红。`App.tsx` 从构建时的 `CHANGELOG_HEAD` 渲染这一行，所以基线里焊死了
  **录制那一版的版本号与更新记录标题**：v1.107.0 录的是「卷帘可以多选了」，v1.108.0 变成「回归门禁补强」，
  于是 `banner-*` 四张全红（实测桌面深色 `2363 pixels (ratio 0.07) are different.`）。这不是界面回归，
  是发布；下个版本还会再红一次，所以**重录不是修复，mask 才是**。分工是明确的：
  横幅的**几何**由 `e2e/update-banner.spec.ts` 在两档视口上钉住（横幅高 ≤ 64/120 px、`.update-copy`
  高 ≤ 36 px、单行省略、两个按钮恰好 32 px），像素基线只守**横幅的壳**（背景、圆角、间距、两个固定动作）。
  机制本身有一条自证用例：`self-check › the banner baseline does not depend on the release line`
  把同一张基线用两条不同的版本行各比一次（其中一条长到会改写那一行的排版），**两次都必须通过**，
  随后再把横幅底色刷成品红、要求比较**被拒绝**——所以 mask 遮掉的只是那一行，不是整个横幅。
  不用「注入固定文案」代替 mask：这一行的**文字内容**（版本号与标题）没有可用的稳定替身，
  改了它这份基线就不再是当前界面的基线；而 mask + 几何断言把「谁守什么」说清楚了。

被 mask 的区域由读数值的测试负责（`verify-audio.mjs`、DSP 指纹、E2E 断言），放进来只会制造噪声。

## 一个真实的坑：service worker 会喂给你上一个构建

第一次做标定时出现过「改了 CSS、重新 `npm run build`、套件却全绿」，第二次跑才红。原因是本地
`vite preview` 加载的页面注册了 service worker，缓存里是**上一个构建**的资源：基线是新的、页面是旧的。

修法是在视觉套件的三个 `test.use` 里都加 `serviceWorkers: 'block'`——视觉套件要比较的是刚刚构建出来的
那份 `dist/`，不是浏览器上一次缓存下来的那份。`e2e/pwa.spec.ts` 仍然单独测 service worker 本身。

## 第二个真实的坑：比视口高的元素，第一张截图可能还没画完（2026-09-15 修）

`.modules-grid` 在 1440×900 下是 **1324×1441**，比视口高，所以 Playwright 用
`Page.captureScreenshot({ captureBeyondViewport: true })` 服务它：**每一张**截图都要把视口外的瓦片重新光栅化，
而**第一张**可以在瓦片画完之前就返回。实测（宿主 load 17–25，十颗忙核压在八核老 i7 上；同一时刻 DOM 是稳定的——
7.5 s 内采 60 次，每个模块的 box 与 `documentElement.scrollHeight` 一字未变，mask 照打）：

| 截图 | 耗时 | 与基线 `modules-dark-desktop.png` 的像素差 |
| :--- | ---: | ---: |
| 第 1 张 | 3595 ms | **0.1694**（323 223 px） |
| 第 2 张 | 3250 ms | **0.0000**（逐像素相同） |

缺的像素是**还没画出来**的 OSC / FILTER / ENV / MOD MATRIX / REVERB / DELAY 面板体，不是「状态不同」：
两张图里洋红 mask 矩形的位置逐像素相同 ⇒ 布局根本没动。所以这条红与「上一个用例污染了状态」无关
（同一份代码**单跑**这条自证用例、宿主 load 17 时，同样报 `274404 pixels (ratio 0.15)`）。

Playwright 分不出「没画完」和「真改了」。它把第一张读成
`274404 pixels (ratio 0.15 of all image pixels) are different`，再截一张确认稳定；宿主一忙，第二张落不进
15 s 的 `expect` 预算，于是报 **`Failed to take two consecutive stable screenshots`**——自证用例就是这样红的，
而 48 张基线**一直是好的**。它是唯一会跑 `.modules-grid`（= 唯一比视口高的界面）的比对用例，所以只有它中招。

修法是 `visual.spec.ts` 的 `prime()`：对**比视口高**的元素，先白白截一张把光栅推完，再让正常的比对判第二张。
阈值一个都没动（同一份基线、同一个 `maxDiffPixelRatio` / `threshold`、没有 `--update`、没有 skip）：

- 修前 / 修后（人为加同样负载）：`274404 px` 红 → 单跑 **35.1 s 绿**（load 24.7，比红的那次 17.0 还高）；
- `npm run test:visual` 整套：**10 passed**（含两条自证）；
- **自证仍然有效**：临时把 `.modules-grid .module` 刷成品红再走一次「必须匹配」的比对 ⇒
  `652420 pixels (ratio 0.35 of all image pixels) are different`，用例红（原文见下）。

```
✘ 1 [chromium] › e2e/visual.spec.ts:542:3 › self-check › a painted style change is reported as a diff (11.3s)

  Error: expect(locator).toHaveScreenshot(expected) failed
  Locator: locator('.modules-grid')
    652420 pixels (ratio 0.35 of all image pixels) are different.
  Snapshot: modules-dark-desktop.png
```

48 张基线**一张都没有重录**：基线录的就是「已画完」的那一张（Playwright 录的时候也要求连续两张稳定），
`prime()` 只是让比对也落在那一张上，所以 48 张仍然逐像素通过。

## P11.3 顺手修的两件事（都是布局改动**之后**没跟上造成的）

1. **10 张旧基线已经过期**。它们在 `a092c6a`（建这套基线的那次提交）录制，之后 SEM 滤波类型、
   第二级滤波（OFF/SER/PAR）、2× LED、take 行、每节点效果参数陆续落进 `gs1.css`——而视觉套件不进 CI，
   没人重录。于是 `npm run test:visual` 在 v1.107.0 上本来就是**红的**（实测旧基线的滤波模块里只有
   `LP HP BP NT CMB FRM` 六个类型、没有路由段、没有 2× LED）。本批把这 10 张重录到当前界面：
   `modules-{dark,light}-{desktop,phone}`、`player-{dark,light}-{desktop,phone}`、
   `splash-{dark,light}-desktop`。其余 10 张（`splash-*-phone`、`flow-*`、`roll-*`）逐像素未变。
   **这不是 P11.3 的界面改动**，是补上拖欠的重录；基线之间的差异就是那几次功能提交。
2. **`.spec-body` 没在 mask 里**（见上），是 P11.3 加浅色启动页对照时暴露出来的。

## P10.2（片段编排二期）：跑了哪些、变了什么、为什么

**跑过，48 张里只动了 4 张 `banner-*`，而它们动的原因是发布而不是本批的界面改动**（见上面 mask 一节）。

- 本批确实改了片段泳道（`PlayerPanel` 多了一行「片段模板 / 复制到另一层」）。第一次跑就把
  `player-{dark,light}-{desktop,phone}` 全跑红（桌面深色实测 `13969 pixels (ratio 0.04)`，是阈值
  0.01 的四倍）：原因是**新那一行在「没有片段」的曲目上也渲染**，于是播放器面板长高了一行。
  这是**真的界面回归**，修法是让它只在当前层有片段时出现（`clipRows.rows[roll.layerIndex]?.length`），
  和它旁边那排片段按钮的显示条件一致。修完这四张**逐像素回到原基线**，一张都没重录。
- 内建演示曲目**没有** `clips`，所以本批对**所有**默认界面（启动页/模块/播放器/信号流/卷帘）的像素
  是零影响——`player-*` 那四张仍然通过，就是这条结论的证据。
- 另外修了一个与视觉套件相邻的既存竞态：`captureSurfaces` 用 `.start-btn` 是否**存在**来判断要不要点
  启动键，但引擎已起、React 还没摘掉启动门的那一两帧里，按钮仍在 DOM 里且 `disabled`，于是
  `click` 会一直重试到超时（实测浅色桌面 surfaces 就这样红了 1 分钟）。改成先看按钮是否**可点**，
  不可点就走「门已经不在」的分支。
- 4 张 `banner-*` 重录的**唯一**理由是补上 `.update-what` 的 mask（录制时 mask 区域会换成新基线，
  所以必须重录一次）。重录后全绿：`10 passed`（含两条自证）。

## P10.5（曲库来源与许可标注）：跑了哪些、变了什么、为什么

**跑过，只有 4 张 `player-*` 变了**（`player-{dark,light}-{desktop,phone}.png`）。原因就是本批的界面改动：
播放器列表每一行在「作曲者 · 音符数 · 时长」下面多了一行 `.pt-source`（`公版作品 · WoO 59` /
`原创作品 · GS-1` / `用户导入 · <文件名>`），页脚文案也从「现代影视 / 游戏主题仅作简短示范……」
换成「内置曲目均为公版作品或本站原创编配……」。桌面深色实测 **9719 pixels（ratio 0.03）**，
是阈值 0.01 的三倍。

这 4 张**重录**（`git diff --stat e2e/visual.spec.ts-snapshots/` 只有这 4 个文件动了），其余基线逐像素未变；
重录后整套 `10 passed`。行高没有造成布局尺寸变化：播放器列表本来就是纵向滚动，新标签自带 9px 行高。

## 维护

- 改了界面样式：先 `npm run test:visual` 看红了哪些界面、差异多少（`test-results/` 里有三张图），
  确认是有意的改动，再 `npm run test:visual:update`，然后 `git diff --stat e2e/visual.spec.ts-snapshots/`
  确认变动的图和你以为的一致。
- 基线变动必须和样式改动**在同一个提交**里，这样回看历史能知道界面为什么变。
- 新增界面时在 `capture()` / `captureSurfaces()` 里加一个 `shot()` 调用即可，文件名沿用
  `<界面>-<主题>-<设备>.png`。
- 新的画布如果由 rAF 重画，先加进 `ANIMATED`，否则它迟早会以「随机红」的形式找上门。
- 新增的界面如果**比视口高**（`.modules-grid` 是 1440 px / 900 px 视口），比对前记着走 `prime()`
  （`shot()` 已经带了）：Chromium 会用 `captureBeyondViewport` 拍它，第一张可能是没画完的光栅，
  报错读起来像真回归。见上面「第二个真实的坑」。
- 界面上任何**随发布/时间/数据变化**的文字（版本号、更新标题……）都要么 mask 掉、要么由读数值的
  断言去守，否则它会以「每版必红」的形式找上门，而那比没有基线更糟。
