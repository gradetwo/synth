# 视觉回归：20 张基线，和它们能被信任的理由

## 覆盖什么

`e2e/visual.spec.ts`，五个界面 × 深/浅两套配色 × 手机（390×844）/桌面（1440×900）：

| 界面 | 选择器 | 为什么是它 |
| :--- | :--- | :--- |
| 启动页 | `.start-overlay` | 用户看到的第一屏；版本号被 mask，见下 |
| 模块网格 | `.modules-grid` | 参数面板的排版、字号、配色 |
| 播放器 | `.player` | 抽屉式面板的列表、气泡、按钮 |
| 信号流 | `.flow-canvas-wrap` | 画布上的节点、端口、连线 |
| 钢琴卷帘 | `.roll` | 网格、音符块、工具行 |

共 20 张基线，存在 `e2e/visual.spec.ts-snapshots/`（约 2.9 MB，无损 PNG，随仓库入库）。

## 怎么跑

```bash
npm run test:visual          # 比较（含「自证」用例）
npm run test:visual:update   # 重录基线（只有在你确实想改界面时才用）
```

- 失败时 Playwright 把 `-expected` / `-actual` / `-diff` 三张图留在 `test-results/`（已 gitignore），
  报错信息里带「多少像素不同、占比多少」，不需要靠放大镜猜。
- 需要先 `npm run build`（套件跑 `vite preview` 的是 `dist/`）。

## 为什么是可选套件（不进 CI、不进 `verify`）

文字栅格化是**这台机器的字体栈**的属性，不是仓库的属性。在 CachyOS 上录的基线没有资格去判 Ubuntu runner 的对错；
一条含义为「freetype 版本不同」的红灯，只会教人忽略红灯。所以：

- CI 的 `npm run test:e2e` 会加载这个 spec 并**跳过**（文件顶部的 `test.skip(!RUN, …)`），不产生噪声；
- 录基线是显式动作；比较也是显式动作。当前基线属于本机 + 本机 Chromium。

如果以后要进 CI，正确做法是给 CI 单独录一套基线（Playwright 的默认 `snapshotPathTemplate` 会带上 project 与
平台后缀，文件名已经天然分开），而不是让两边共用一套。

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
这也是把五个界面都纳入的原因，而不是只挑一张全景图。

## 两道自证

1. **套件内的自证用例**（`self-check › a painted style change is reported as a diff`）：
   先正常比较一次（必须通过，否则这个用例什么也证明不了），然后用 `addStyleTag` 把
   `.modules-grid .module` 刷成品红，再要求同一次比较**被拒绝**。
   `npm run test:visual:update` 时它会被跳过——`--update-snapshots` 会把基线改写成被污染的那张。
2. **上面那张标定表**：真实 CSS 改动 + 真实构建，套件确实红了（而不是"设计上应该会红"）。

## 屏蔽（mask）什么，以及为什么

- `.mini-canvas`、`.scope-body`、`.vu-track`：引擎跑起来之后由 rAF 重画的画布，逐帧都在变。
  它们的内容由读数值的测试（`verify-audio.mjs`、DSP 指纹、E2E 断言）负责，放进来只会制造噪声。
- 启动页的 `.start-sub`（版本号那一行）：它**本来就应该**每次发布都变，
  所以屏蔽，而不是每版重录一次基线。

## 一个真实的坑：service worker 会喂给你上一个构建

第一次做标定时出现过「改了 CSS、重新 `npm run build`、套件却全绿」，第二次跑才红。原因是本地
`vite preview` 加载的页面注册了 service worker，缓存里是**上一个构建**的资源：基线是新的、页面是旧的。

修法是在视觉套件的三个 `test.use` 里都加 `serviceWorkers: 'block'`——视觉套件要比较的是刚刚构建出来的
那份 `dist/`，不是浏览器上一次缓存下来的那份。`e2e/pwa.spec.ts` 仍然单独测 service worker 本身。

## 维护

- 改了界面样式：先 `npm run test:visual` 看红了哪些界面、差异多少（`test-results/` 里有三张图），
  确认是有意的改动，再 `npm run test:visual:update`，然后 `git diff --stat e2e/visual.spec.ts-snapshots/`
  确认变动的图和你以为的一致。
- 基线变动必须和样式改动**在同一个提交**里，这样回看历史能知道界面为什么变。
- 新增界面时加一个 `shot()` 调用即可，文件名沿用 `<界面>-<主题>-<设备>.png`。
