# P8.5 体积与启动预算：账、判定方法与还能怎么省

收尾批次（v1.95.0）。上一批（P7.2/P7.3）把 dist 顶到 **1711.7 / 1712.0 KB**，只剩 0.3 KB；
P6.4 已经把阈值从 1700 抬到 1712 一次，本批**不再抬**。结果不是抬阈值，而是**真的省出 48.9 KB 并把
阈值整体收紧**，同时新增一条首屏可交互时间门禁。

单位：本文所有 KB 都是 **KiB（1024 B）**，与 `scripts/verify-budget.mjs` 一致。
数字取自 `npm run build` 后的 `dist/`；gzip 为 `node:zlib` level 9（与门禁同源）。

## 一、预算（`scripts/verify-budget.mjs`，全部为「实测 + 小余量」）

| 项 | 实测 | 新阈值 | 余量 | 旧阈值 |
| :-- | --: | --: | --: | --: |
| dist 总量（raw） | 1662.8 KB | **1672 KB** | +9.2 KB（+0.55 %） | 1712 KB |
| 首屏 JS（gzip，2 文件） | 131.2 KB | **134 KB** | +2.8 KB（+2.1 %） | 165 KB |
| 首屏 CSS（gzip） | 19.7 KB | **21 KB** | +1.3 KB | 22 KB |
| 最大 WASM（gzip） | 67.9 KB | **70 KB** | +2.1 KB | 230 KB |

四条都从「整数关口」改成「本次测量值 + 一档」，下一次增长会真的红，而不是先吃掉十几 KB 余量。
P6.4 花掉的 12 KB（两个默认关的效果 + 14.4 KB wasm）在本批**全额还清**。

## 二、真正的节省：PWA 图标 PNG24 → PNG8（−49.0 KB）

四个图标是一块**平色 + 抗锯齿边缘**的矢量 logo，PNG24 存了全部渐变像素；256 色调色板就够。
`scripts/gen-icons.mjs` 新增 `shrinkPng()`：栅格化之后过一遍 ImageMagick
`-strip -colors 256 -define png:compression-level=9`。

| 文件 | 前 (B) | 后 (B) | 相对原始栅格的 RMSE |
| :-- | --: | --: | --: |
| `icons/icon-512.png` | 29 868 | 10 066 | 0.059 % |
| `icons/maskable-512.png` | 25 625 | 8 631 | 0.052 % |
| `icons/icon-192.png` | 10 306 | 3 423 | 0.092 % |
| `icons/apple-touch-icon.png` | 9 624 | 3 151 | 0.102 % |
| **合计** | **75 423** | **25 271** | **−50 152 B = −48.97 KB** |

**为什么这是「真正的节省」**：`verify-budget` 的 dist 总量按**原始文件字节**求和，图标占原来的 4.4 %；
这 49 KB 不牺牲任何功能（尺寸、格式、manifest 引用都不变，肉眼不可分）。

**一个踩到的坑**（已写进脚本注释）：ImageMagick 从**输出扩展名**选 coder。临时文件命名成
`*.png8` 会走 `PNG8:` coder，量化质量差一个数量级（RMSE 0.71 % vs 0.06 %）却只省 2 KB；
临时文件必须保持 `.png`。另外 `npm run icons` 会重新栅格化，所以仓库里提交的 PNG 就是产物，
`npm run build` **不**跑这个脚本（dist 直接用提交的 PNG）。

## 三、dist 账（1662.8 KB，按 raw 排序；「首屏」= `index.html` 直接引用）

| 文件 | raw KB | gzip KB | 首屏？ | 说明 |
| :-- | --: | --: | :-- | :-- |
| `assets/synth_core-*.wasm` | 282.9 | 67.9 | 启动时 | SIMD 内核，`cargo --release`（lto=fat、strip、panic=abort）已是优化态 |
| `assets/index-*.js` | 281.0 | 86.7 | **是** | App + store + panels + i18n + 参数表 + `midi/songs` |
| `assets/synth_core_scalar-*.wasm` | 277.8 | 65.7 | 按需 | 无 SIMD 回退；`gen-sw.mjs` 的 `DEFERRED` 使它**不进 precache**，用到时才取 |
| `assets/lamejs-*.js` | 164.9 | 57.0 | 懒 | MP3 导出；门禁专门断言它不被 `index.html` 引用 |
| `assets/vendor-react-*.js` | 139.4 | 44.6 | **是** | React + scheduler（`manualChunks`） |
| `assets/index-*.css` | 101.8 | 19.4 | **是** | 全部应用 CSS（含 `@font-face`） |
| `assets/Changelog-*.js` | 87.8 | 38.7 | 懒 | 更新记录全文（含历史），`App.tsx` 里 `lazy()` |
| `assets/Guide-*.js` | 82.1 | 37.5 | 懒 | 指南正文，`lazy()` |
| `assets/worklet-processor-*.js` | 23.9 | 7.1 | 启动时 | AudioWorklet，由引擎 `addModule`（非 `index.html` 引用） |
| `assets/PlayerPanel-*.js` | 20.3 | 6.2 | 懒 | 播放器面板 |
| `assets/FxGraphEditor-*.js` | 20.0 | 5.9 | 懒 | 节点图编辑器 |
| `assets/SignalFlow-*.js` | 17.1 | 6.5 | 懒 | 信号流画布 |
| `assets/PianoRoll-*.js` | 15.4 | 5.0 | 懒 | 钢琴卷帘 |
| 字体 6 × `.woff2` | 82.3 | 82.4 | 首屏 CSS 引用 | Space Grotesk 500/600/700 + IBM Plex Mono 400/500/600，仅 latin 子集，**只有 woff2**（`vite.config.ts` 的 `woff2Only()` 在构建期删掉 woff 回退，约 −108 KB） |
| `assets/roll-*.js` | 11.3 | 3.9 | 懒 | 与 PianoRoll 共享的卷帘逻辑 |
| `icons/*.png` | 22.0 | 22.0 | 首屏 meta 引用 | 本批 PNG8 后的四个图标 |
| `assets/AudioSettings-*.js` | 7.0 | 2.3 | 懒 | MIDI 输出设置 |
| `assets/TransportIcon-*.js` / `sw.js` / `index.html` / manifest / svg | 其余 ~12 | — | — | |

首屏 JS gzip 131.2 KB = `index` 86.7 + `vendor-react` 44.6（+ 0.97 KB 的 `vendor-fonts.css` 属 CSS 侧）。

## 四、`midi/songs.ts`：为什么在首屏，以及为什么**没有**把它懒加载

**为什么在首屏（这是它唯一的原因）**：`src/App.tsx` 静态 import `store`，`src/state/store.ts`
静态 import `@/midi/library`，而 `src/midi/library.ts` 静态 import `./songs` 并导出
`export const midiLibrary = new MidiLibrary()`。类字段 `private tracks = builtinTracks()` 在模块求值时就
`DEMO_SONGS.map(specToSong)` 铺好 12 首内置曲，所以 `songs.ts` 的数据 + 记谱 DSL 进入 `index-*.js`，
并在首帧前执行。`PlayerPanel`/`PianoRoll`/`SignalFlow` 也引用 library，但它们是懒 chunk；**拽它进首屏的是
store 这条 eager 路径**。

**懒加载实验（临时 `manualChunks` 把 `songs.ts` 单独成 chunk，实测）**：

| | 前 | 后 | Δ |
| :-- | --: | --: | --: |
| `index-*.js` raw | 281.0 KB | 264.9 KB | −16.1 KB |
| `index-*.js` gzip | 89.2 KB | 84.2 KB | −5.0 KB（本次 probe 无 woff2 插件，比例不受影响） |
| 新 `songs` chunk raw | — | 16.2 KB | +16.2 KB |
| 新 chunk gzip | — | 5.05 KB | +5.05 KB |
| **dist 总量 raw** | — | — | **+93 B（约 0）** |
| 首屏 JS gzip | — | — | **−3.7 KB** |

**结论：不动它。** 理由不是省不了，而是**这笔账对不上本批的瓶颈**：

1. dist 总量按 raw 计，拆出去只是把 16.2 KB 从 `index` 搬到新 chunk，净变化 +93 B（chunk 头开销），
   **对本批 0.3 KB 的危机毫无帮助**；
2. 唯一收益是首屏 gzip −3.7 KB，而首屏 JS 现在是 131.2/134 KB，计划目标 140 KB 早已达标；
3. 代价不小：`midiLibrary` 是 eager 单例，构造函数里就 `midiPlayer.load(demo:arpeggio)` 并 `persist()`，
   拆懒必须把初始化改成异步（`store`、`PlayerPanel`、`library.test.ts`/`recording.test.ts` 都要跟着改），
   否则启动时要么多一个串行请求、要么首屏没有已加载曲目——**用启动时间换 3.7 KB 首屏 gzip，不划算**。

**接手方式（如果以后要做）**：先给 `MidiLibrary` 一个 `whenReady: Promise<void>` + `tracks` 只读快照，
把所有 `getTracks()/getCurrent()` 的调用点改成「ready 前渲染占位」；`demoSong()`/`specToSong` 保持惰性
（`songs.test.ts` 直接单测这些纯函数，不受影响）；然后才把 `import { DEMO_SONGS }` 改成动态 import。
验证点：`library.test.ts`「never stores the built-in songs」、`recording.test.ts`、
E2E `player.spec.ts`/`clips.spec.ts` 的首屏曲目断言。

## 五、其余「大对象」复核（都已是懒 chunk，无需再动）

| 项 | 判定方式 | 结论 |
| :-- | :-- | :-- |
| `lamejs`（165 KB） | `verify-budget` 断言 `lamejs-*.js` 不被 `index.html` 引用 | 懒 ✅（`src/midi/export.ts` 动态 import） |
| 指南 `Guide`（82 KB） | `changelog-head` 之外，`App.tsx` `lazy()` | 懒 ✅ |
| 更新记录 `Changelog`（88 KB） | `App.tsx` `lazy()`；只把 `CHANGELOG_HEAD` 留在首屏 | 懒 ✅ |
| `PlayerPanel` / `SignalFlow` / `FxGraphEditor` / `PianoRoll` / `PresetDrawer` / `AudioSettings` / `roll` / `recording` | `index.html` 只引用 2 个 JS，以上各自成 chunk | 懒 ✅ |
| 字体 | `dist/assets/*.woff` 不存在（`woff2Only()` 构建期剥离） | 只有 woff2 ✅ |

## 六、首屏可交互时间预算（`e2e/performance.spec.ts`）

**测量点**（写在 spec 注释里，这里摘要）：

- 时钟是页面自己的 `performance.now()`，零点 = `performance.timeOrigin` = 导航开始，**不跨 CDP 对时**；
- 观测量 `.start-btn`（启动门上的「启动音频引擎」按钮，其他 spec 的 `boot()` 点的是同一个）**在 DOM 里且
  enabled**，**并且**已经发生 first-contentful-paint；
- `addInitScript` 在应用任何字节之前装好轮询；FCP 由 `PerformanceObserver(type:'paint', buffered)` 提供。

**为什么必须把 paint 算进去**：本机实测按钮 **~190 ms 就在 DOM 里且 enabled**，但**首次内容绘制在
~1 250 ms**。只看 DOM 会报一个用户还盯着空屏的时刻，所以第一版「只等 enabled」的写法被否掉了。

| | 实测（5–6 次） | 最慢 |
| :-- | :-- | --: |
| 前（1711.7 KB dist） | 1 561 / 1 815 / 1 870 / 2 132 / 2 264 ms | 2 264 ms |
| 后（1662.8 KB dist） | 1 595 / 1 872 / 1 878 / 1 971 / 1 973 / 2 096 ms | 2 096 ms |
| 整套 E2E 并行跑（`test:e2e`，其它 worker 同时在启动） | 2 450 ms | 2 450 ms |

阈值 **3 200 ms = 整套并行跑的最慢值 2 450 ms + 约 30 %**。两侧单跑重叠，说明**启动耗时不回退**
（图标不在关键路径上）；并行那个数才是 `npm run test:e2e` 会遇到的工况，所以以它为准。
headless Chromium 是软件渲染，所以数字是秒级而不是几十毫秒。

## 七、还能怎么省（按「省得多 → 省得少」，都未做）

1. **`wasm-opt -Oz`**：两个内核共 560.7 KB raw / 133.6 KB gzip，是最大的一块。Binaryen 通常再省 5–15 %
   （约 30–80 KB raw）。代价：`scripts/build-wasm.mjs` 要依赖一个本机没有的二进制、CI 与 `verify:release`
   要跟着装，且必须重跑 `test:dsp`（0.030806）与 `verify:presets`（81 unchanged）确认语义未变。
   本机 `wasm-opt` 缺失，未做。
2. **~~按语言拆 `i18n.ts`（45 KB 源）~~ 已在 P11.2 兑现**，但拆的是**键组**不是语言（理由见第九节）：
   首屏 JS gzip **134.6 → 127.3 KB**，代价是 dist **+7.8 KB**。
3. **CSS 按 chunk 拆**：`index-*.css` 101.8 KB 里含只有懒面板才用的规则；拆出去能降首屏 CSS，
   **但 dist 总量不变**（还是那些字节），对本批瓶颈无帮助。
4. **字体再子集化**：6 个字重共 82.3 KB。若确认某个 500 字重页面从未用到可删一个（−13～15 KB），
   但会动视觉，需要重跑 `test:visual`。
5. **`songs.ts` 懒加载**：见第四节，净省 0（总量）、首屏 −3.7 KB gzip，代价是异步库初始化。

## 八、复现

```bash
npm run build          # 产出 dist/（含 PNG8 图标）
npm run verify:budget  # 四条阈值 + lamejs 懒 chunk 断言
npm run verify:dist    # 引用/预缓存/manifest 断言
npm run icons          # 重新栅格化 + PNG8（需要 rsvg-convert 或 magick；magick 缺失时保留现有 PNG）
PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers npx playwright test e2e/performance.spec.ts --project=perf --workers=1
# 或 npm run test:perf。性能 spec 不在 chromium project 里（v1.111.0 起隔离单跑），
# 用 --project=chromium 跑它会匹配 0 条。
```

`songs.ts` 的懒加载账用临时 `manualChunks` 测（把 `src/midi/songs.ts` 指到 `probe-songs`），
`index-*.js` 前后对比即可复现；脚手架不留在仓库里。

## 九、P11.2（v1.110.0）：i18n 结构性拆分，首屏 134.65 → 123.75 KB（−10.89 KB）

第七节第 2 条（「按语言拆 i18n」）在本批兑现，但做法不是按语言，而是**结构性地把「首屏最小集」留在
内联表里、其余按键组分到懒模块**。选按键组而不是按语言：`DICT` 是 `key: [zh, en]` 的扁平双语表，
按语言拆意味着「切到 en 时中文仍在首屏 chunk 里」（或要再请求一次），而按键组拆收益一样，却**不把同步
`t()`/`getLang()` 变成异步**——它们被 toast、`aria-label`、canvas 与 worklet 状态路径调用。

| | 前 | 后 | Δ |
| :-- | --: | --: | --: |
| `index-*.js` raw | 299 983 B | 271 040 B | −28 943 B |
| `index-*.js` gzip | 92 238 B | 81 084 B | −11 154 B |
| **首屏 JS gzip（index + vendor-react）** | **137 878 B（134.65 KB）** | **126 724 B（123.75 KB）** | **−11 154 B（−10.89 KB）** |
| dist 总量 | 1556.9 KB | 1558.3 KB | **+1.4 KB** |
| 首屏 CSS gzip | 20.2 KB | 20.2 KB | 0 |
| 最大 WASM gzip | 74.2 KB | 74.2 KB | 0（本批不碰引擎） |

- **首屏最小集 = 174 键**（内联在 `src/i18n.ts`）。判据不是「哪个前缀」，而是**每个键都由首帧会执行的
  代码读取**：启动门 `app.*`、顶栏 `top.*`、示波器行 `panel.*`/`canvas.*`/`monitor.*`、模块标签
  `module.*`（含 `state/layout.ts` 的 `MODULE_META[i].sub` 与 `modules.tsx` 的标签表）、滤波器类型
  `filter.*`、波表/采样选择器的 `wave.*`（`controls.tsx` 的 `t(\`wave.${w}\`)`）、卷积混响选择
  `ir.*`、FX 链头 `fx.*`、演奏键盘 `kbd.*`（含 tips 数组）、首帧的 `preset.initName`/`roll.title`/
  `roll.open`/`player.title`/`theme.label`/`env.valueHint`/`knob.fine`，以及引擎在面板出现前就可能
  toast 的 `err.*`。移动后**再跑一遍审计：没有任何 core 键的读者是懒组件或 gated 组件**。
- **懒模块 = 355 键**（`src/i18n-panels.ts`，只被 `import()` 到达），按面板分表：`fxg`、`roll`、
  `player`（含 `clip`/`layer`/`take`）、`drawer`（预设库抽屉）、`sources`（导入波表/采样）、
  `settings`（设置抽屉）、`audio`（含 `cc`）、`docs`（指南/更新记录）、`flow`。
- **设置抽屉与预设库抽屉的文案为什么能搬**：两者都**不是首帧渲染的内容**（设置抽屉在 DOM 里但被 CSS
  移出视口；预设库抽屉只在点击后挂载）。`useStringsReady('settings.title')` 让设置抽屉在这一微任务里
  渲染 `null`（本来也看不见），而不是先把 key 名画进 DOM；为此 `App.test.tsx` 的 `beforeAll` 里
  `await loadAllStrings()`——浏览器里由 `main.tsx` 在挂载前启动同一个加载。
- **键名清单改成 `Object.keys(table)` 派生**：第一版给每个表配了一份 `readonly string[]` 清单，但清单和
  文案在**同一个 chunk** 里，而 `dist` 按 raw 求和，于是那 355 个键名是 ~7 KB 的重复字符串（gzip 早就
  见过它们）。注册是原子的，所以需要「这个表到了吗」的调用点只探一个哨兵键。
- **删掉 36 个死键**：先用「`src/`、`e2e/`、`scripts/`、`index.html` 里零引用」筛出候选，再逐个 grep
  确认。多为被硬编码取代的名字（16 个 `module.<id>` 被 `MODULE_META[i].title` 取代、`app.noScript` 的
  文案在 `index.html` 的 `<noscript>` 里）与从未接线的条目（`drawer.noResult`、`err.wasmMissing`/
  `Instantiate`、`panel.bins`、`theme.switched` 等）。沿用 P10.2 删 `clip.tplDefaultName` 的先例。
- **不闪的做法**：`main.tsx` 在 React 挂载前 `loadAllStrings()`（**不 await**，首帧不等它），`App` 再在
  idle 里预载；每个懒面板的 `lazy()` 是「先 `loadXStrings()` 再 import 组件」；三处「eager UI 用懒文案」
  用 `useStringsReady()` 门住，未就绪时渲染 `null`；切换语言由设置抽屉 `await loadAllStrings()` 之后才
  `store.toggleLang()`，所以切换那一帧两种语言的表都已在内存里。
- **守卫**（`src/i18n.test.ts`）：①所有 `t('字面量')` 都有键；②每个懒表两个方向一致且有 zh/en、不与
  core 重复；③**首屏 import 图**（静态 import，排除 `import()`）里出现的键必须都在 core；④三个 gated
  文件必须真的调用 `useStringsReady()`。
- **首帧不等 chunk 的证据**：③是断言而非声明（首屏会渲染的文案全在 core 表内）；三个 gated 组件在表未到
  时渲染 `null`；`e2e/i18n.spec.ts` 的 reload 用例断言首帧就有 `Start Audio Engine` 与模块名；切换用例用
  MutationObserver 记录整段文本变更，断言**从未**出现 `player.*`/`settings.*` 之类的 key 名。
