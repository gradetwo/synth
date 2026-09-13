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

## 为什么是可选套件（不进 CI、不进 `verify`）

文字栅格化是**这台机器的字体栈**的属性，不是仓库的属性。在 CachyOS 上录的基线没有资格去判
Ubuntu runner 的对错；一条含义为「freetype 版本不同」的红灯，只会教人忽略红灯。所以：

- CI 的 `npm run test:e2e` 会加载这个 spec 并**跳过**（文件顶部的 `test.skip(!RUN, …)`），不产生噪声；
- 录基线是显式动作；比较也是显式动作。当前基线属于本机 + 本机 Chromium。

如果以后要进 CI，正确做法是给 CI 单独录一套基线（Playwright 的默认 `snapshotPathTemplate` 会带上
project 与平台后缀，文件名已经天然分开），而不是让两边共用一套。

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

## 维护

- 改了界面样式：先 `npm run test:visual` 看红了哪些界面、差异多少（`test-results/` 里有三张图），
  确认是有意的改动，再 `npm run test:visual:update`，然后 `git diff --stat e2e/visual.spec.ts-snapshots/`
  确认变动的图和你以为的一致。
- 基线变动必须和样式改动**在同一个提交**里，这样回看历史能知道界面为什么变。
- 新增界面时在 `capture()` / `captureSurfaces()` 里加一个 `shot()` 调用即可，文件名沿用
  `<界面>-<主题>-<设备>.png`。
- 新的画布如果由 rAF 重画，先加进 `ANIMATED`，否则它迟早会以「随机红」的形式找上门。
- 界面上任何**随发布/时间/数据变化**的文字（版本号、更新标题……）都要么 mask 掉、要么由读数值的
  断言去守，否则它会以「每版必红」的形式找上门，而那比没有基线更糟。
