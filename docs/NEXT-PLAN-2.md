# 下一阶段开发 · 完善 · 改进计划（v2.0.4 起 · P10 已收官 · P12 已收官 · 1C 已落地 · v2.1.4 债单清账）

> 接在 `docs/NEXT-PLAN.md`（v1.79.0–v1.97.0，14 个批次全部交付）之后。本文档规划 **P9–P12 四个方向、23 个批次**（**另加用户 2026-09-14 新立的 P13「给其它 AI/LLM 的接口」5 个批次**，见 §三 P13）
> （原为 21 个；P9.1a 的实测发现把「硬同步重启对齐」立为新的 **P9.1c**，P9.1b 的实测发现把
> 「滤波器共振 × 新振荡器交互」立为 **P9.6**）。
> 执行纪律沿用不变：**每批 = 实现 + 单元/E2E 测试 + `npm run verify` 全绿 + 小步提交 + `npm run package` + 部署
> + 核对线上资源 + 中文文档/更新记录同步**；**音频批次必须同时有时域与频域断言**；**工程/质量批次必须自证有效**
> （故意改坏一处必须让门禁变红，并把证据写进文档）。

## 一、现状（**v2.1.3**；数字来自 v2.1.3 的发布跑与合并后的完整门禁，2026-09-15）

> 这一节原来停在 v1.97.0，里面的红线（`0.030806/0.030946`、81 条指纹）与体积线早就过期了，
> 第三次全面回归把它逐条抓了出来（见 §一.39）。**每次发布都要顺手改这里**，否则下一个人会拿旧数字当基线。

| 维度 | 现状 |
| :--- | :--- |
| 版本 | **v2.1.4** 已上线并核对：部署时 `live DxvYFUxW == built DxvYFUxW`，父代理再独立 curl 校验 `local == live == assets/index-DxvYFUxW.js`，且线上 `sw.js` 与 `release/retained/2.1.4/sw.js` **逐字节相同**（sha256 `e27a06a0…`、缓存 pin `gs1-accb42dfa74f`）；`release/retained/` 保留 5 个（v2.1.4、v2.1.3、v2.1.2、v2.1.1、v2.1.0；v2.0.7 按窗口淘汰） |
| 门禁 | **整链 `npm run verify` PASS**（clippy/rust/build/unit/lint/wasm/ci/release/dist/budget/audio/presets×2/bench/dsp/dsp:2x/mcp/llm-docs）；单元 **693 passed / 4 skipped**（66 文件）· Chromium E2E **156 passed**（含本批新增的截断提示与实例显示 2 条）· MCP 黄金会话 21 次调用两遍逐字节相同 · `verify:audio` 的计时**已判**、`bench` 这次是 correctness-only（宿主 load 5.7）· `verify:llm-docs` PASS；**视觉本批未跑**（§一.12 的根因仍在：`test:visual` 不在 CI/发布链） |
| 体积 | dist **≤1550 KB**（v2.1.4 实测 **1546.6**）、首屏 JS **≤115 KB** gzip（实测 **113.4**）、CSS **≤21 KB**（20.4）、最大 WASM gzip **≤75 KB**（74.9；前段抽头 192→128 后未涨） |
| 启动 / 性能 | v2.1.4 发布跑：首屏可交互 **538 ms** of [993, 661, 538]（预算 3200，FCP 740 ms）、fps idle / playback / graph-edit 分别是 **61.3 / 61.3 / 61.3**（各自五窗最差 61.3 / 55.0 / 57.5，仍远高于 floor） |
| 相容红线 | `test:dsp` **`rms 0.06147`**、`verify:dsp:2x` **`0.061703`**、`verify:presets` 与 `verify:presets:2x` 都是 **`91 presets unchanged · ABI 8`** 一字不动；零分配 `gs_alloc_violations()==0`；`PARAM_COUNT` **224**；ABI **8** |
| 已完成 | **P5–P13 全部交付**（P12.3 分享协作、P12.5 无障碍按用户决定不做）；债单转成的批次 **P9.10 / p141 / p142 / p926 / ffx / trel** 也全部交付（v2.1.1–v2.1.3）；**v2.1.4 又清掉 §一.8 / §一.20⑨ / §一.22 / §一.23（截断那半）/ §一.25**，§一.27 按用户 2026-09-15 的决定**暂时不做**；源码里 **无 TODO/FIXME 残留** |

### 已记录的技术债与已知边界（本计划的输入）

1. ~~**引擎非谐波底噪**：普通锯齿在 1562 Hz 的非谐波能量 **−35.1 dB**；硬同步残差随比值退化（锯齿 x7.1 −31.2、方波 x4.3 −37.8），与该底噪同量级 → 同步修正已不是瓶颈。~~ **✅ 已关闭（轨道 `pnoise`，2026-09-15，零代码改动）：今天的代码上这个底噪不存在。** 用门禁自己的 BH-7 尺子（4 s 整窗、每谐波 ±8 bin、Parseval、真 wasm、安静补丁、400 块稳定）实测：正弦 **−120…−129**、锯齿 **−102…−122**（1562 Hz **−111.6**）、方波 **−111…−125**、三角 **−73…−117** dB；第二把 Hann 尺子全在 −137…−187 dB。**旧数字的来源已钉死为两部分**：①它是 **P9.1b 之前**的 polyBLEP 混叠（P9.1b 文档自带的「改前」表：锯齿 1568 Hz = −41.6 dB BH-7）；②当年那把「整秒 + 矩形窗 + 精确 bin」的尺子本身是**频率计**——合成纯正弦标定：440 Hz 上偏 **10 mHz** 就读 **−34.8 dB**、偏 1 Hz 读 0.0 dB（引擎正弦实测 440.000121 Hz：用标称 440 读 −90.1、用实测频率读 −284、BH-7 读 −130）。**硬同步那条前提也过期**：今天锯齿 x7.1 **−114.1**、方波 x4.3 **−107.7** dB（旧值 −31.2/−37.8），最差是三角 x11.3 **−77.8**。消融：限幅器在安静补丁恒 `gs_limit_reduction() == 1.0000`；OS/res/cutoff/调制矩阵全无影响；唯一大源是 `FILTER_DRIVE 0.5`（−54/−49，有意失真）。**结论：不需要修**——地板比验收线低 13–60 dB，三角 3520 Hz −73.1 距门禁线 −68 还有 5 dB；根因是 **2× BLEP/BLAMP 振荡器自身残差**。完整报告：`.tmp/pnoise-report.md`。
2. ~~**P6.4 可选第三效果（瞬态整形）** 未做。~~ **✅ 已由 P9.2（v1.98.0）交付**：`FX_TRANSIENT_ON/ATTACK/SUSTAIN/MIX` = **179–182**（`crates/synth-core/src/params.rs`），有门禁与预设覆盖。原文已作废。
3. ~~**效果参数按种类、不是按节点**：延迟 time/fb、混响 size/mix 等无法每节点独立，也不能作为图内调制目标。~~ **✅ 已由 P9.3（v1.103.0）交付**：`fx.ovr[node][slot]` + 哨兵 `FX_OVR_UNSET`，**槽位含义由节点当前种类决定**（delay=time/fb/mix/damp 等），并且新增 **8 条覆盖调制总线**（target 指向 24 槽之一 + depth）；未覆盖、无调制时**逐位不变**（`node_overrides_are_bit_exact_until_set`）。原文已作废。
4. ~~**自由图 `FX_GRAPH` 模式不过采样**：缺逐节点延迟补偿（PDC），硬开会让干路/节点错 31 样本成梳状。~~ **✅ 已由 P9.4（v1.106.0）关闭**：图里的 DRIVE 节点现在跑 2×，并由逐节点补偿把并联支路与干路重新对齐（离格混叠 −33.4 → **−59.5 dB**，延迟如实上报 **62 样本 / 1.29 ms**；关掉时逐字节不变）。
5. ~~**波表/采样路径**未单独做带限复核。~~ **已在 v1.111.0（P9.5）复核，结论是未达标**：工厂波表 **−25.8…−46.7 dB**、采样 **−29.9…−31.0 dB**（同尺子正弦 −117.8），根因**不是表没带限而是线性插值**（表长扫描 16→2048 点 ≈ 12 dB/倍长 = 1/N²），已加确定性门禁钉住实测地面（**不是** −60）。修法见第 14 条。
6. ~~**体积**：最大未利用项是 `wasm-opt -Oz`；`i18n.ts` 双语文案全在首屏。~~ **两项都已结清**：`wasm-opt -Oz` 见 **v1.105.0（P11.1）**（raw −31/−35%，dist −195.5 KB）；首屏文案见 **v1.110.0（P11.2）**（首屏 JS gzip **134.65 → 123.75 KB，−10.89 KB**，阈值 136 → **125 KB**，且**没有**把同步 `t()` 异步化——按的是键组而不是语言）。**当前首屏 JS 余量只剩 ~1.2 KB**（实测 123.75 / 阈值 125），**dist 余量 ~3.7 KB**（实测 1558.3 / 1562），下一个动 UI 文案的批次要按这两条线记账。
7. ~~**`songs.ts` 懒加载经实测为负收益**（dist 净 +93 B，首屏 gzip 仅 −3.7 KB，却要异步化 eager 单例）~~ **✅ 已被 p926（v2.1.3）推翻并做成**：当年那次只把 `songs.ts` 单独 `import()`、仍走 eager 单例，所以只值 −3.7 KB；**连 `presets.ts` 一起、并且真正按需（打开抽屉/播放器才取）**之后是 **首屏 gzip −11.8 KB**（125.3 → 113.5），dist raw +6.5 KB（拆 chunk 的开销）。**教训**：这条「不要再试」的结论只对**当年的做法**成立，登记成「不要试」时要写清是哪个做法。
8. ~~**编辑器/实例显示不一致**（P7.3 交付者记录）：保存/套用跟随 store 的 `activeInstance`，而图编辑器显示实例 1 的 snapshot。~~ **✅ 已修（2026-09-15）**：`FxGraphEditor` 原来直接读 `snapshot.state.params`（恒为实例 1），而 `store.setParam` 写的是活动实例 ⇒ 在实例 2 里改一个节点，画面立刻弹回实例 1 的值。修法是让 store 自己回答「活动层是谁」：新增 `store.getActiveParams()`（实例 1/2 的参数集，引用在写之间稳定）与 `useActiveParams()` 选择器，图编辑器改用它。门禁两条：`src/state/store.test.ts` 的「hands a whole-patch view the active instance」与 `e2e/fxgraph.spec.ts` 的「pictures the instance it edits, not always instance 1」（在实例 2 把节点 1 设成 chorus、切回实例 1 仍是 delay、再切回去仍是 chorus；改前第一条断言就红）。
9. ~~**clips 与 take 的关系**：折叠成片段的层切换 take 对该层听感无效（take 作为素材保留）。~~ **已在 v1.104.0（P10.3）解决**：不再沉默——折叠层明确禁止切换/合并并给出原因（「take 仅作素材」），改名仍允许、录音仍保存。选「禁止」而非「take 作为片段源」，因为 `MidiClip` 没有 per-clip 的 take 链接、且重建会静默丢弃用户对片段的编辑（见 P10.3 条目）。
10. **启动阈值依赖机器**（本机软件渲染 + 并行套件实测）；更慢的 CI 上可能吃紧。**P9.1b 之后已部分缓解**：E2E 启动预算改为「三次取最快」并支持 `GS1_BOOT_BUDGET_MS` 覆盖；`bench` 的手忙判定改为「>0.5×核数」，并补上「跑动中才来的负载」。
11. ~~**节点参数区的编号重叠**（P9.4 发现，既有）~~ **✅ 已量化并关闭（轨道 `pid`，2026-09-15）：前提本身是错的，不需要重排编号，只加了护栏。** 原文给的三个算式**全部不成立**（`FX_NODE_OUT_GAIN+1 = 132 ≠ FX_DELAY_MIX = 35`、`FX_NODE_TO_OUT+5 = 130 ≠ FX_PARALLEL3 = 90`、`FX_NODE_IN1+5 = 106 ≠ FX_EQ_ON = 157`），真算式是 `FX_NODE_OUT_GAIN+6 == OSC_FM`（131+6=137）。六个字段的 base 相距恰好 `FX_SLOTS = 6`，半开区间 `[101,107)…[131,137)` **两两不相交、铺满 `[101,137)`**，每个 id 都解码到自己那格，`132..136` 是空缺号。宿主侧逐路径核对（worklet 224 条显式描述符、store/engine、`graphFromChain`、share/patchfile/preset 序列化、mcp `paramPairs`、门禁手写 `P` 表）**没有一条按区间猜节点** ⇒ 「宿主无法把 6 个节点清干净」今天不成立；`Params::set` 的 `slot < FX_SLOTS` 是**防御性**守卫（没有真实 id 会走到它）。**决定：不重排编号**——重排不改变任何 id 的落点、收益为 0，却必然动分享码/`.gs1proj`/91 条指纹（相容红线）。**交付**：Rust 4 条 + `src/audio/node-ids.test.ts` 5 条护栏（将来谁往 `[101,137)` 里塞普通参数、或右移节点块，CI 立刻红），逐 id 影响面与迁移备忘在 `docs/notes/node-param-ids.md`；参数 id / `PARAM_COUNT` / ABI / DSP 路径**一个都没改**。顺带更正 `docs/notes/oversampling.md` 末尾那段：P9.4 的 2× rms 真因是**过采样往返补偿被算了两遍**（该文件自己的有效章节就是这么写的），与编号无关。
12. ~~**视觉基线会漂移，因为套件不在 CI**（P11.3 发现）~~ **✅ 根因已处置（轨道 `infra`，2026-09-15）：套件现在跑在 CI 上，只不过是在 schedule 上「报告」而不是 push 上「阻塞」。** 做法：`.github/workflows/ci.yml` 新增 `visual` 作业——`if: github.event_name == 'schedule'` + `continue-on-error: true`，先 `npm run build`、装 Chromium，再 **`npm run test:visual -- --update-snapshots=none`**（硬约束：Playwright 对**缺失**基线默认「写一张再判失败」，那会在 runner 上铸假基线），失败时把 `test-results` 作为 `visual-diffs` 留 14 天；`verify-ci` 双向断言（作业必须存在、且**任何**跑 `test:visual` 的作业都必须 schedule-gated——把 `npm run test:visual` 塞进 push 的 verify 作业会当场红）。**为什么不直接阻塞 push**：基线录在开发机 CachyOS、runner 是 `ubuntu-latest`，字体栈不同是已知的，一条「不同 freetype」的红灯只会教人忽略红灯。**仍开着的只有收紧**：第一次 CI 实跑后按结果决定（字体差异 ⇒ 加 `GS1_VISUAL_SNAPSHOT_SUFFIX=-ci` 并在 runner 上录一套单独提交的 CI 基线；真界面差异 ⇒ 本机复现重录；绿 ⇒ 去掉 `continue-on-error`），三种走向都写进了 `docs/notes/visual-regression.md`；**在那之前，任何改 UI 的批次仍要自觉跑 `test:visual`**。原文（当时的状态）：`npm run test:visual` 是可选套件、`verify` 与 CI 都不跑，基线录于 `a092c6a` 之后一直没人重录——P11.3 开工时套件本来就是红的（10 张过期）。

13. ~~**fps 守卫是在并行 E2E 套件里测的（v1.110.0 发布时发现）**~~ **✅ 已在 v1.111.0 修复（隔离，阈值未动）**：原症状——`performance.spec.ts` 的三种负载跑在 141 条套件的第 77 条，测的时候其它 worker 正在压满 8 个核。v1.110.0 的发布跑里 `playback` 是 **22.5 fps（best of 5，窗口 16.3/22.5/18.8/18.8/18.8）**，靠最好的那一窗过；v1.111.0 的发布直接被挡下（**20.0 fps，窗口 13.8…20.0**），而同一份代码单跑是 60.0。best-of-N 是为本机软件渲染加的缓解，但**不能替代隔离**。**做法**：`playwright.config.ts` 新增 **`perf` project**（`testMatch: /performance\.spec\.ts/`，与 chromium 同 `devices['Desktop Chrome']`、同 `--autoplay-policy=user-gesture-required`）并在 **chromium project 加 `testIgnore`**；`package.json` 的 `test:e2e` 明确成 `playwright test --project=chromium`、新增 `test:perf` = `playwright test --project=perf --workers=1`；`scripts/release.mjs` 的 E2E 改成**两段**（先 app 套件、再隔离性能套件，仍解析 `[boot-budget]` 并把三条 `[fps]` 连窗口打进日志）；`.github/workflows/ci.yml` 与 `scripts/verify-ci.mjs` 同步。**隔离后新实测（1 worker，6 passed / 34.0 s）**：`idle-with-engine` **61.3** [61.3, 53.8, 61.3, 61.3, 60.0]、`playback` **52.5** [42.5, 52.5, 50.0, 37.5, 48.8]、`graph-edit` **61.3** [53.8, 56.3, 61.3, 58.8, 58.8]，`[boot-budget]` **907 ms** of [1101, 907, 1225]（预算 3200）；playback **每一窗都 >20**，窗口离散度从 13.8…20.0 收敛到 37.5…52.5。app 套件同次 **135 passed / 10 skipped**。门禁有效性自证：`FPS_FLOOR` 临时改 999 → 三条全红。细节见 `docs/notes/performance.md`。

14. ~~**波表/采样高音区带限未达标（P9.5 发现，v1.111.0 登记）**~~ **✅ 已由 P9.7（v1.113.0）与 P9.8（v2.0.1）+ 1C（v2.0.4）关闭**：波表 **−98.0 dB**、采样地板 **−86.4/−90.1/−92.7 dB**、全键盘最差 **−81.0 dB**，第二把尺子 −147.9 dB；代价（级 1/2 带宽收窄、4 s 导入耗时）分别记在第 22、23 条。**下面是当时的记录**：≥1 kHz 的非谐波能量实测 **−25.8…−46.7 dB**（波表）/ **−29.9…−31.0**（采样），远高于 P9.1b 给振荡器路径挣到的 −60 dB；计划 P9.5 的验收线因此**没有达到**，现由一条「实测 +5 dB 顶棚」的确定性门禁钉住，**不是** −60。归因是**线性插值读短 mip level**（1/N²；表长 16→2048 点 −24.4→−106.6 dB），不是表本身。**两条修法**（选更长 level / 换更好插值器）**都会改变音色并要重录全部 81 条预设指纹**（相容红线级），所以没有塞进复核批次。**用户已拍板（2026-09-14）：立独立批次修到接近 −60 dB**，接受音色变化与全部 81 条指纹重录 ⇒ 立为 **P9.7**（见 §三 P9.7 与版本表 11c）。

15. ~~**bench 的「超预算块占比」在本机不可复现（v1.111.0 发现）**~~ **✅ 判据统一已在 v2.1.1（轨道 `p142`）交付。** 三处计时门禁（`bench` / `verify-audio` / `fuzz.test.ts`）现在共用 `scripts/lib/host-load.mjs` 的 `hostLoad` / `cpuProbe` / `timingTrust`，**读数永远打印**，不可信时可见地报「未判」；阈值（60%/2%/4000 ms）一个没动。**残留的可见性小项归 §一.20②**：`verify` 复合链的汇总行仍是 `PASS`，只在同一行注明「timing not judged」，没有把它显示成非绿——这是有意的（跳过不是失败），但看汇总的人可能漏读。原文（当时的记录）：此前是环境假红，安静窗口 load 2.64/2.67 下 bench 两次都 timing judged 4/4（`p50 1199/1197 µs`、超预算块 0/2250），同一代码在 load 6.7 的复合链里读 `p50 1554 µs` + `PASS (correctness only)` ⇒ 唯一变量是宿主负载。

16. ~~**采样路径到不了 −60 dB（P9.7 量化）⇒ 用户已拍板「扩 arena」**~~ **✅ 已在 v2.0.1（P9.8）解决，且 P9.7 的估计错了 8 倍**。真因不是「录音自身带宽」，而是**每一级都按 2^k 抽取**——内容永远待在自身 Nyquist 的 0.44 处，表再长也没用；改成「**级长 = 该级带宽允许的长度**」（内容落在 1/16 Nyquist）后，弦误差按 ν⁴ 下降，采样 **−33.4 → −70.5 dB**（BH-7、4 s、真 wasm），第二把尺子 Hann Goertzel **−146.7 dB**，≥1 kHz 的 −60 验收线**达到且有 10 dB 余量**。级长是**一个精确大小的池**（`11.875 B/底采样`）：门禁样本 380 KB、1 s 557 KB、**上限 4 s 仅 2 227 KB**（P9.7 估的 18 MB 小了 8 倍）。**arena 8 → 12 MiB 是被一次真实失败逼出来的**（8 MiB 下门禁自己的「4 s 采样 + 96 KB 响应」压到 169 KB 后一次消息路径分配直接 trap），最坏峰值 ≈9.0 MB。**装不下时优雅拒绝**：`try_reserve_exact` → `SampleError::NoRoom` → `gs_sample_import` 返回 **4** → UI toast（复用既有 `smp.err.noRoom`，未动 i18n）；拒绝时旧采样保留、不 trap。**体积没有涨**：arena 是 `.bss`，wasm raw −0.7 KB、gzip 74.5/75 未变 ⇒ **不需要 rebase**。
**新登记的两条代价（见 §一.22/23）**：级 1/2（速率 1–4×）输出带宽收窄；4 s 采样的导入在消息路径上要 274 ms。

17. ~~**回滚后的更新横幅会写「被回滚掉的那个版本」（P12.4 发现）**~~ **✅ 版本号已由 P12.6（v2.0.2）修好**（向 waiting worker 握手取得，超时则不显示版本号）；**说明文字那一半仍开着，见第 27 条**。当时的记录：横幅的版本号取自**正在运行的那份 bundle** 的 `CHANGELOG_HEAD`。对「页面还开着、自回滚后从未重载」的 PWA，运行的仍是 vW，于是横幅写「新版本已就绪 · vW」（vW 正是被回滚掉的版本），点下去装的却是 vX。新访客与重载过的 PWA 不会错位。P12.4 已断言「线上 `sw.js` 的 cache 名 = 快照 pin」⇒ waiting worker 必然出现 ⇒ 横幅一定会重新出现（那类客户端唯一会被主动通知的通道），但**版本标签本身没修**。**用户 2026-09-14 批准**：给 SW 加**版本握手**（现在只有内容哈希缓存名、没有 semver），会动 `scripts/gen-sw.mjs` + `src/pwa/register.ts` + `src/App.tsx` + i18n + 首屏预算⇒ 立为 **P12.6**，但**排在 p104（工程管理）合并之后**再做（它要动 `src/App.tsx` 与 i18n，与 p104 撞）。

18. **nightly 默认子集在 1 fps 的 WebKit 上可能逼近 systemd 的 `TimeoutStartSec=3h`（P11.6 登记，未实测）**：默认子集从 8 个 spec 扩到 18（core+visual+audio），P11.6 按「不许为变绿缩子集」保留了它；第一次 timer 实跑后视情况决定是调 unit 的超时还是让默认走 `--core`（`scripts/systemd/gs1-nightly.service`）。
   **2026-09-15 进展**：①**可见性缺口已修（轨道 `nightlog`，v2.1.5）**——原来每个引擎的日志是 `spawnSync` 结束后才写盘，慢轨一次 `npm run nightly -- --engines=webkit,firefox --all` 跑了 **2 小时 12 分仍零输出**，只能中止；现在改成**边跑边落盘**（每 chunk 同步写、用户态零缓冲，SIGTERM/SIGKILL 都留下已写部分）并加「starting/finished」两行进度，判定语义（退出码 `code ?? 1`、`out` 仍是 stdout 后接 stderr、子集/重试/报告形状）一字未动。自证用假 `npx`：命令**未结束**时日志已有 `MARKER-A`，而改前同一时刻日志文件根本不存在。②**墙钟仍在量**：慢轨正用 systemd 单元同口径的默认子集（18 files）+ `time` 测；结论回来再决定是否调 unit 超时或走 `--core`。

19. ~~**跨引擎 E2E 脆弱用例挡住 Firefox/WebKit 信号**~~ **✅ 已在 v2.0.1（fxwire）修复——但真正的原因和慢轨的猜测不同，这一点更重要**。慢轨猜「`click({force:true})` 点包围盒中心、中心不在笔画上」；三引擎实测**否掉了它**（那个坐标恰好就是曲线中点，几何完全一致）。真因是 **`stroke-dasharray: 5 3`**：命中测试跟随**画出来的**描边，**虚线间隙在 Gecko/WebKit 上是死画布**，而 Chromium 把整条路径当命中区。**WebKit 是陷阱**：它的 `elementFromPoint` **忽略** dash、事件命中**不忽略**，两者不一致 ⇒ **不能拿 `elementFromPoint` 当判据**。**加宽也无效**（间隙横跨整个线宽）。**修法（产品侧）**：每条 wire 在可见路径之下加一条同曲线的**实心透明 2 px 命中笔画**（`aria-hidden`、不带 `data-wire`/`data-modwire`），**刻意不加宽**（实测 12 px 会让相邻 wire 互抢点击、删错边）。**足迹只有 2 个产品文件，`e2e/fxgraph.spec.ts` 最终未改**（测试是对的，产品有真缺陷）。**验收**：Firefox `--retries=0` 2/2 绿、Chromium 整个 spec 16/16 不回归、`test:visual` 10 passed。**与 webkitraf 合并后我在主树复跑**：headless WebKit 上这条用例 **40.7 s 通过**（远在 120 s 预算内）⇒ **不需要动 timeout**，CI 的 `e2e-engines` 那半应转绿（该作业 2026-09-14 已按 20 分钟判据并入 schedule 的 `nightly`，见第 38 条）。全量 grep 确认真正点 SVG 描边的只有 3 处（都在该 spec），均已被覆盖。教训写进 `docs/notes/compat.md` §8。

20. **门禁一致性与可见性（慢轨提出的系统性意见，未做）**：①计时判据不统一（bench 双判据 / fuzz 无判据 / fps 与 boot 只靠 best-of-N）⇒ 同一台机器「谁算红」取决于撞上哪道判据，正是第 15 条的病根；②`verify` 复合链里的 bench 会**静默降级**成 `PASS (correctness only)`，「整链绿」可能包含「计时根本没判」；③~~`e2e-engines`（WebKit/Firefox）既不在 `verify` 也不在 `release.mjs`，只在 CI~~ **部分处置（2026-09-14）**：它已按 20 分钟判据并进 CI 的 `nightly` 作业（见第 38 条），所以现在**本机也能用 `npm run nightly` 复现**同一件事，不再只能「看 CI」；但常规门禁里仍然没有它——这是有意的（第 19 条那种漏检要靠慢轨节奏，不是靠把 40 分钟塞回每次提交）；④nightly 把**端口冲突**报成引擎 `fail`（4–6 s 内 `0 passed / 0 failed`），应识别为启动失败并自动顺延端口；⑤`fuzz` 成功时不打印余量（无法判断 4000 ms 的富余）；⑥fps 的 best-of-5 会掩盖争用（实测 `graph-edit best 60.0 of [21.3, 32.5, 42.5, 33.8, 60.0]`，最差窗只比 floor 高 1.3，同次 load 2.6→6.25）⇒ 建议同时打印/断言最差窗；⑦48 张视觉基线既不在 CI 也不在发布链（与第 12 条同源）；⑧`SHA256SUMS` 只覆盖最新一版（P12.4 的 `release/retained/<v>/sha256.txt` 已部分补上历史）；⑨~~**`npm run lint` 只覆盖 `src/`**（`eslint src`），`e2e/`、`scripts/`、`mcp/` 都不在 lint 覆盖内——后果是那边可以有死变量、也可以有 `no-undef` 噪音（P13.4 抽出的 `e2e/interact.mjs` 与 `e2e/fixtures.ts` 各留了一个死变量，父代理在合并 ffx 时顺手删掉）。要真正修需要给这些目录配 eslint 的 env/规则（**登记，未做**）。~~ **✅ 已修（2026-09-15）**：`npm run lint` 现在是 `eslint src e2e scripts mcp`，`eslint.config.js` 给 `scripts/**`、`mcp/**`（Node）与 `mcp/ui/**`、`e2e/**`（Node + 浏览器全局）配上 env，并加了全局的 `_` 前缀忽略约定。**首次全绿共消掉 125 个 error**，其中**两条是真缺陷而不是噪音**：`scripts/lib/render-core.mjs` 的 `P` 常量表有 **9 个重复键**（值相同、后写覆盖前写，肉眼看不出来；清掉后用脚本逐键比对旧/新映射，**95 键、missing/extra/diff 全空**），以及 `mcp/tools/analyze.mjs` 导入的 `allocViolations` 与它实际使用的 `channels.allocViolations` 是两条来源（死导入已删）。其余是 `no-undef`、未使用变量/导入、`no-useless-assignment`、`no-useless-catch`、`preserve-caught-error`（补 `{ cause }`）和两处正则里的字面空格（改 ` {2}`/` {4}`）。
   **2026-09-15 汇总：①④⑤⑥⑦⑧⑨ 都已交付**——①⑤ 由 p142（共用 `host-load.mjs`、读数恒打印、fuzz 报可见 skipped），④ 由 §一.39 的 nightly 端口重试，⑦ 由轨道 `infra`（视觉基线进 schedule CI，见第 12 条），⑧ 由轨道 `infra`（`SHA256SUMS` 覆盖全部 retained），⑨ 由本批（lint 覆盖 e2e/scripts/mcp）。**②③ 保留为有意行为，不再算债**：②「整链绿」里计时被跳过时仍写 `PASS`，但同一行必然打印 `timing not judged` + 宿主读数（跳过不是失败，改成非绿会教人把宿主负载当回归）；③ 跨引擎仍只在 schedule 的 `nightly`（整包 WebKit 42.7 min，20 分钟判据，见第 38 条）。

21. ~~**headless WebKit 永远等 rAF**~~ **✅ v2.0.1（webkitraf）解决——但前提被推翻两次，两次都值得记**。**否定一**：headless WebKit **会**触发 rAF（空白页 55–57 fps、静态 data: 页 42–55）。真正发生的是**应用页交不出帧**（0 帧/3.5 s）：headless WebKitGTK 没有合成器、只能软件光栅化，而主线程是健康的（同期 `setTimeout` 跑了 110 次）。证据链：载入时 `#root{display:none}` → 82 帧、abort 全部 JS → 93 帧、单个 `box-shadow`/`filter: blur` 的 div 就只剩 1 帧；排除过 SW/wasm/字体/AudioContext/全部重绘特性/5 个合成环境变量。**否定二**：任务书首选的「注入 rAF 兜底」**从原理上够不着**——Playwright 在 `__playwright_utility_world__` **隔离世界**里做可操作性检查（三个内核都是），主世界的 `addInitScript` 改不到（实测注入后主世界 0 → 36–54 fps，而 `locator.click()` 仍超时）；`page.clock.install()` 同样无效。**采用的绕过（测试侧，仅 WebKit）**：`e2e/fixtures.ts` 把按帧等待的动词换成帧无关实现（定时器版可见性 + `isEnabled` + DOM scroll + `evaluate` 读盒子 + `elementFromPoint` 命中 + 真实 `page.mouse.click`/`touchscreen.tap`），**保留与帧无关的三项检查、只丢掉定义上依赖帧的两项**；**断言、阈值、超时、retries 一个没改**。`playwright.config.ts` **一行未改**（与其它轨道零冲突）。**实测**：单次点击 8–30 s → **39–57 ms**；`boot.spec.ts` 2.4 → 1.2 min（首例 56.3 → 6.6 s）；核心子集 8 spec/38 用例从「30 min 跑不到第 5 个」变成 **35 passed / 3 failed / 22.7 min**。3 个失败逐个归因：1 个是 WebKit 自身差异（已被 fxwire 修掉，见第 19 条）、2 个 `theme` 需要合成器（Weston 下 2 passed）。**Chromium 不受影响**（38 passed；把两个开关强制打开也是 38 passed，逐条一致）。仍需有头 Weston 的只有：`visual`（`locator.screenshot()` headless 20 s 不返回）与 `performance`（量的就是帧率）。诊断与边界写进 `docs/notes/compat.md` §3/§3.5。

22. ~~**采样：级 1/2 的带宽被换掉了（P9.8 登记，需拍板）**~~ **✅ 带宽已经换回，而且没有付出这里担心的代价——2026-09-15 用户拍板「换回；地板若压线就适当提高那条线」，核实后两件事都不需要再做，本条关闭。** 当年（1A，v2.0.1）为了让内容落在 1/16 Nyquist，级 1/2（播放速率 1–4×）的输出带宽收窄到 **3–12 kHz**（P9.7 的抽取链 10.6–21 kHz），补回级 1 的 6–12 kHz 估**+0.77 MB**、地板从 −79 抬到 **≈−60**（压线无余量）。**这个取舍在 1C（v2.0.4）被换成了另一个解**：布局改成 **ν=1/4（`LEVEL_NYQUIST = 0.25`）+ 16 抽头窗 sinc**，「布局 + 核」一起改，于是**每一级都拿到它自己速率范围允许的最宽带宽**。今天的实测口径：
   - **带宽**：级 k 的带宽 = `SR / 2^(k+1)`，表长 = `SR / 2^(k-1)`，所以级 1/2 读出来是 **12–24 kHz**（比 P9.7 的 10.6–21 kHz 更宽，根音以下逐字未变）。这条由 Rust 单测 **`every_level_keeps_its_content_well_inside_its_own_band`** 钉住：对每一级断言 `band × 2^k ∈ (SR/4, SR/2] = (12 kHz, 24 kHz]`，2026-09-15 复跑 **1 passed**（`dsp::sampler::tests`）。
   - **地板**：全键盘最差 **−81.0 dB**，门禁 `verify-audio` 的顶棚是 **−81**（高音，实测 −86.4）与 **−75**（键盘顶端，实测 −81.0）——**实测比顶棚还好 5 dB**，所以按「地板压线才抬线」的条件，**门禁阈值一个都没动**（`scripts/verify-audio.mjs` 原值）。
   - **代价**：那 +0.77 MB 事实上**已经花了**（池 1 497 → **2 244 KB**，arena 8 → 12 MiB，都是 v2.0.1/v2.0.4 已在发运的账），换来的不是「地板 −60」而是「地板 −81 + 带宽全宽」。
   数字与推导在 `docs/notes/band-limited-oscillators.md` §P9.8（1A/1C 两列）与 §P9.10。

23. **采样导入的 274 ms 卡顿与 >4 s 截断（P9.8 登记）**：4 s 样本的 mipmap 构建在**消息路径**（音频线程的消息处理里，不在 `process` 回调内）要 **273.9 ms**（当年 filter 16–64 → 192 抽头；32768 点 26.4 ms、1 s 39.3 ms。**现为前段 128 / 后段 96**：P9.10 的 clamp 外提 + §一.25 的 192→128 之后，同机交替 A/B 是 4 s **79.9 ms**、32768 点 **15.9 ms**）。**截断那一半已按用户 2026-09-15 的拍板处理完**：保留「文件偏长就截断」的既有产品行为（**不改成可见拒绝**），但**不再静默** —— `importUserSample` 现在返回 `{ sample, truncated }`，`UserSamplePicker` 在截断时把 toast 换成 `smp.loadedTruncated`（「已导入采样 …（文件偏长，已截断到上限）」）。判据是**两条**：超过暂存上限 `MAX_BASE_SAMPLES = 192 000`（JS 的 `SAMPLE_CAPACITY` 过去写成 `192 * 1024`，与 `gs_sample_capacity()` 不一致，已对齐），**或者**文件时长 > 4 s（= 192 000 / 48 kHz，重采样后超限）——后者是必要的：5 秒 @22.05 kHz 只有 110 250 个采样，看采样数看不出来。单元测试两条（200 000 点 → `truncated`、长度 192 000；110 250 点 @22.05 kHz → `truncated`、长度原样 110 250）与 E2E 一条（>4 s 报截断、≤4 s 不报）钉住。**只有一条 toast**：短文件提示与截断提示是两个互斥字符串，不会互相覆盖。

24. ~~**采样「1C」方案：拿回带宽并把地板压到 −70 的路子，本批未走通**~~ **✅ 已在 v2.0.4 做成（P9.8/1C）**。上一轮失败的原因找到了：**相位表少了最后一行**——`x=1` 处的核不是 `x=0` 处的核（插值点前进一格、delta 从抽头 7 移到抽头 8），在最后一个相位**回绕读 row 0** ⇒ 约每 1024 个样本有一次用「整体位移一个样本的核」插值 ⇒ 0.1% 密度的全幅脉冲串功率正好 **31 dB**，与实测吻合；而它的**相位取决于读取起点、读取起点又取决于上一次渲染留下的引擎状态**，所以表现为**顺序依赖**，把人先引向「引擎状态/内存布局」。修法：相位表建 **`KERNEL_PHASES + 1 = 1025` 行且不回绕**（**`dsp/sampler.rs` 的 `KERNEL_ROWS`**）。再加上把链式滤波**前段 192 抽头 / 后段 96**（前段要窄过渡带；后段表太短、长滤波的边缘钳位会盖住整个 loop）。
**结果**：采样地板 **1047 −86.4 / 2093 −90.1 / 4186 −92.7 dB**（1A 是 −75.3/−73.8/−70.5），**全键盘最差 −81.0 dB**（1A 是 −46.6），**带宽每级 12–24 kHz 全拿回**（1A 那个「根音上一个八度只剩 6 kHz」的坑没了），4 s 导入 157.6 → **141.1 ms**（同机同探针 A/B；1A 的另一半红利见第 29 条）。门禁新增「键盘顶端」守卫行；两条自证（去掉相位行 → 红；换回三次核 → 红）。
**体积**：SIMD wasm gzip 74.5 → **74.98 KB**（一度超 75.0 线 **51 字节**），已按「**先买回来再谈**」的规矩处理——把「插值窗跨表边界、每抽头都要回绕」的罕见路径抽成 `#[inline(never)] read_wrapped`，热路径不再出现第二份，**行为零变化**，省 **71 gzip 字节**，**没有动阈值**。⚠️ **余量只剩 20 字节**，第 29 条的导入提速会加代码 ⇒ 那一批**需要一次记账式 rebase**（我会用它的数字写注释）。另外记两条**没采用**的（gzip 对 raw 不单调，只能实测）：合并两个滤波循环 raw −360 B 但 **gzip +51 B**；给冷路径加 `#[inline(never)]` **gzip +20 B**。

25. ~~**采样导入的抽头数可以白捡 −33%（P9.8 后续，低风险）**~~ **✅ 已在 2026-09-15 做成（§一.25 的前一半）**：`CHAIN_TAPS_EARLY` 192 → **128**（后段仍是 96，`MAX_TAPS` 跟着 `CHAIN_TAPS_EARLY`）。**门槛与地板都没动**：`scripts/verify-audio.mjs` 的采样门禁三行在改后逐字读出同一组数（高音 **1047 −86.4 / 2093 −90.1 / 4186 −92.7**、键盘顶端 **5920 −90.9 / 8372 −81.0**、低音 **65 −81.9 / 131 −83.4 / 262 −82.5**，顶棚 −81/−75/−77 一个没改），时域「有界/无步进」两行也全过；`test:dsp` 基线不含采样路径，**不需要重录任何基线**。**速度是真 A/B 测的**：两个 wasm 在同一进程里**交替**跑（`.tmp/import-ab.mjs`，median of 9，宿主 load 8.27 时）——4 s 文件 **107.5 → 79.9 ms（1.34×）**，门禁样本 32768 点 **22.0 → 15.9 ms（1.38×）**。**为什么必须交替**：同一份代码隔几分钟单独测可以差 2 倍（本轮 128 一次读到 64.5 ms、另一次 146.4 ms），跨会话比导入时间就是自欺（§一.29 的口径修正）。**没做**的是后一半：两个滤波内循环的边界 `clamp` 外提**已经由 P9.10（v2.1.1）兑现**（逐位相同，4 s 130 → 78 ms），所以本条整条关闭。原始记录（当时的实测口径不同，别拿来当基线）：96 → 4 s ~137 ms、地板 −69.6；128 → ~183 ms、−70.3；64 及以下会破 −60。

26. ~~**工厂预设与曲库是 eager 的，于是「内容条数」和「首屏预算」被绑在一起（P12.2 发现）**~~ **✅ A 方案已由 p926（v2.1.3）做成**：`ensurePresets()` 在**打开抽屉/用顶栏 ±1/需要解析存量 id** 时才取工厂表，曲库在**打开播放器**时才取；`allPresets()` 在表未到时**抛具名 `PresetsNotLoadedError`**（不是返回空数组）；当前音色的**名字**随快照与 `.gs1proj` 持久化，所以首屏不必有表也能命名。实测 **首屏 JS gzip 125.3 → 113.1 KB（线 126 → 115，下调 11 KB）**，dist raw 1540.2 → 1546.8（+6.6，拆 chunk 开销）；`e2e/lazy-chunks.spec.ts` 用页面自己的 resource 列表**钉住「首屏不请求这两个 chunk」**，并断言打开抽屉/播放器后内容真的在。**已登记一条代价（§一.41）**。原文如下：`src/state/presets.ts`（45 KB）与 `src/midi/songs.ts`（30 KB）都经 `store.ts` **进首屏**，所以每加一条预设 ≈ **454 B raw / 83 B gzip**、每首歌 ≈ 430 B raw，而 v2.0.1 的 `initialJs` 只有 **123.8/125 KB**、`dist total` **1592.2/1595**。P12.2 实测「8–14 条新预设 + 曲库扩充」在**不动阈值、不动架构**的前提下**装不下**。**本批的处置（父代理决定）**：按预算文件里「下一批要体积的必须买回来」的规矩，先**压缩既有 81 条预设的编码**（对象字面量 → 紧凑元组，预计省 ~30% raw ≈ 12 KB、2–3 KB gzip），**既有 81 条必须 `unchanged` 逐字节证明**，再把完整内容包塞进去；**不动任何阈值**。**A 方案（把 presets/songs 改成懒 chunk）是更根本的解法**——它能一次性解除这个耦合（回收 1 万多 B raw），但要改 `store.ts` 的构造路径（`FACTORY_PRESETS[0].id`、`allPresets()`、`midiLibrary` 启动即建库），属真架构批次，**登记待立**。

27. **回滚后横幅的「说明文字」仍是被回滚那版的（P12.6 的残余）——用户 2026-09-15 决定：暂时不做回滚这块，本条挂起、不立批**：版本号已修（握手取得），但横幅标题下的那句更新说明仍取自**正在运行**的 bundle 的 `CHANGELOG_HEAD.items[0]`，所以回滚后会显示「`vX` · <被回滚版本的说明>」。要一并修需让 `gen-sw.mjs` 把 changelog 标题也嵌进 `sw.js`（解析 `src/changelog-head.ts` 较脆，或改构建注入），属另一笔预算/i18n 交易。**决定记录在此：不做，也不占版本表；等回滚功能本身再动时一并处理。**

28. ~~**首屏 JS 只剩 ~0.3 KB 余量**~~ **✅ 已解除（p926 / v2.1.3）**：`presets`/`songs` 移出首屏后，线从 **126 下调到 115** KB，实测 **113.1**（余 ~1.9 KB）。原文（当时的状态）：**首屏 JS 只剩 ~0.3 KB 余量** ⇒ **下一个动首屏的批次必须先买回空间**：首选把教学内容做成**懒 chunk**（P12.1 的教学面板只留一行 `lazy()`），或做第 26 条的 A（把 presets/songs 挪出首屏，standalone gzip 分别 7 448 / 5 058 B）。**不要**把这条线往上抬——它是访客真正下载的东西。

29. ~~**采样导入还能再快约 1.9×（P9.9 独立实测，逐位相同的实现，待立批）**~~ **✅ 已兑现并超额（P9.10 / v2.1.1 拿掉每抽头 clamp，§一.25 / v2.1.5 再把前段抽头 192 → 128）。** 今天同机交替 A/B（`.tmp/import-ab.mjs`）：4 s **107.5 → 79.9 ms**、门禁样本 32768 点 **22.0 → 15.9 ms**，两条改动都是逐位相同或门禁读数逐行不变。原文记录：`p99` 轨道独立测「192 抽头 + 每抽头 clamp」4 s = 157.6 ms、「128 抽头 + 去 clamp」= 55.6 ms（2.83×），**主因是「去掉每抽头 clamp」（≈1.9×）而不是降抽头（≈1.5×）**；实现是逐位相同的（前缀 + 无 clamp 主体 + 后缀，附逐位比对单测）。**口径修正仍然有效**：P9.8 钉的 273.9 ms 与同机 157.6 ms 差 1.74×，而 32768 点与 1 s 只差 1–2% ⇒ 那一档当时撞上了宿主负载，**导入耗时一律用「同机同探针的改前/改后」口径**。

30. **`crushbass` 几乎无声（慢轨抓到）✅ 已在 v2.0.5 修好**：既有守卫 `worklet-processor.test.ts`（对每条工厂预设弹 middle C、断言 **peak ≥ 0.003**）读到 **0.0020**。**根因不是 trim 太小，而是粉碎器的湿声路被量化成零**：`quantise` 的 `step = 2/2^bits`，4 bit ⇒ **0.125**，而该预设前置电平峰值只有 **~0.044** ⇒ 每次采样 `round(<0.5)=0`，湿声恒为 0，听到的只是 `1-mix = 10%` 的干声泄漏（0.00195 正好 = 0.1×干声，raw wasm 与 worklet **逐位一致**）。**修法**：`FX_CRUSH_BITS 4 → 6`（step 0.03125 < 0.044，粉碎器真正工作）+ `PATCH_GAIN 0.442 → 0.36`（把工作后的电平拉回库中位）；`DOWN 12`/`AA 0.6`/`MIX 0.9` 未动，仍是硬粉碎低音。middle C peak **0.00195 → 0.02258**，乐句 **−43.96 → −40.98 dBFS**（库中位 −40.87），spread 仍 **7.8 dB**。**只调 `PATCH_GAIN` 做不到**（它是驱动粉碎器的同一旋钮；跨过 4-bit 的 LSB 需要 gain ≈1.2–1.5，此时 ±0.125 方波成为输出、spread 涨到 19.8 dB 直接破 `preset-loudness`）⇒ 4 bit 在该 voicing 下**两个门禁互斥**。**门禁对齐**：新增**单音 middle C** 用例，**窗口与门槛（0.003）与既有守卫逐字相同**；和弦口径的 RMS 门槛从 1e-4（−80 dB）提到 **1e-3（−60 dBFS）**——坏版本和弦读 0.088、单音读 0.0020，**和弦掩盖了它**。指纹按协议只重录 `crushbass`（其余 90 条行级 sha256 前==后）。

31. **P10.5 引入的「重新导入被静默拒绝」✅ 已在 v2.0.5 修好——而父代理的定位假设是错的，值得记下来**：既有用例 `e2e/clips.spec.ts:218` 确定性红（`Expected: < 0.9 / Received: 0.9`，`--repeat-each=3` → 3/3）。二分把范围钉死在 P10.5（v1.112.0 与 p104 都通过），我据此**猜**「导出读到库里/快照里的旧 song」。**实测推翻了这个猜测**：导出本身完全正确（探针原文：`beforeExport(seekMax)=0.9 exportNotes=1 exportEnd=0.5`；`0.9` 只是 `withClips` 给 `song.duration` 加的 0.4 s 尾巴）。**真因**：P10.5 新加的**按扩展名分流导入**——`/\\.(mid|midi)$/i` 才走 `parseMidi`，否则抛「无法识别的文件格式」；而用例用 `setInputFiles(download.path())` 重新导入，Playwright 给的是临时目录里**无扩展名的 GUID 文件** ⇒ 导入被拒、seekMax 保持 0.9。v1.112.0 无条件 `parseMidi`，所以同一文件能读进去。**修法（比我的猜测更好）**：**按内容判断**——新增 `looksLikeMidi(bytes)`（查 `MThd`），`importFile` 先看字节再看名字；P10.5 的所有具名拒绝理由保留。验收：`clips.spec.ts --repeat-each=3` **6 passed**，最终 seekMax **0.5 < 0.9**；自证：把判据换回扩展名 ⇒ 红。**这条还带来一个真实用户收益**：名字里没有 `.mid` 的 MIDI 以前会被直接拒掉，现在能导入。

32. **快轨清单补一条（由上面那条教训得出）**：**动了「库 / 持久化 / 导入导出」路径的批次，快轨必须跑 `e2e/clips.spec.ts`**——P10.5 当时只跑了 player/export，而 clips 正是覆盖「编曲 × 导出」的那条，所以两条真回归之一从 v2.0.0 活到了 v2.0.3。同类补全：动了**预设/曲库内容**的批次必须跑 `worklet-processor` 的全预设扫描（见第 30 条）。**总原则：先问「仓库里还有什么门禁会看到我这次改的东西」。**

33. **两条「父代理的根因假设都被实测推翻」——流程价值（2026-09-14）**：这一轮我给修复轨道的两个假设**都是错的**：①「导出读旧 song」→ 真因是**导入按扩展名分流**把重新导入拒了；②「调 `PATCH_GAIN` 就能修 crushbass」→ 真因是**4 bit 步长大于信号、湿声被量化成零**，只调 gain 会撞破 `preset-loudness`。两次都是**子代理先证实、再动手**才没走错路。**规矩**：父代理的定位只作为**假设**下发，必须要求「先证实再修」，并且**不许拿假设去改测试或改阈值**；子代理推翻假设时要有原始输出。
   同一轮还两次踩到**体积线压线**（v2.0.5 发布时 `initialJs 124.7 → 125.05 KB`、`total 1614 → 1615`，是**发布自己的更新记录**把线顶破的）⇒ v2.0.5 记账式 rebase `initialJs 125 → 126`、`total 1614 → 1619`，**wasm 75.0 未动**（两个修复都没让它涨，P9.10 要用自己数字申报）。

34. ~~**整机比满幅低约 13 dB（用户 2026-09-14 报告「默认输出比其它软件轻」）**~~ **✅ 已处置：`VOICE_GAIN 0.22 → 0.44`（+6.0 dB，v2.0.6，见第 36 条）。** 本条里的 `0.22`、`−13.4 dBFS`、`0.030735` 都是**改动前**的历史读数，当前红线是 **0.061470**（见 §一 现状表与 §六.3）——**别拿本条的数字当基线**。原文记录：满幅正弦只到 −13.4 dBFS、全默认单音 −20.0，`gs_limit_reduction()` 恒 1.00；根因是 `engine.rs` 的 `const VOICE_GAIN: f32 = 0.22`（= −13.2 dB），其注释写明这是有意的（让密集和弦待在限幅器线性区），属产品取舍。

35. **慢轨第二次扫描（v2.0.3）的完整判决与后续**：两个真红都已修（`crushbass` 见第 30 条、`clips.spec` 见第 31 条，均在 **v2.0.5**）；另发现**一条 CI 级缺陷已被父代理当场修掉**：`npm run verify` 与 `.github/workflows/ci.yml` 都把 `npm test` 排在 `build` 之前，而 `src/generated/*.wasm` 是 gitignore 的构建产物 ⇒ **干净 worktree / 新 runner 必红**（16 个文件 `Failed to resolve import "@/generated/synth_core.wasm?url"`）。自证：删掉 wasm 后「先测」= 7/26 文件红；「先 build」= **26 文件 / 163 用例全绿**。修复提交 `0a5aca3`（`verify` 链与 CI 步骤顺序对调）。
   **其它发现（已登记，未做）**：①**WebKit headless 9 条红**（`clips` 已修）⇒ **已在 v2.1.0 之后逐条归因**（轨道 `p-webkit9`，结论见第 38 条）；②**weston lane 产能与误报**：38 条约需 ~2.5 h（40 min 只到 11 passed），且新 worktree 里 `PLAYWRIGHT_BROWSERS_PATH` 默认指向不存在的 `$root/.pw-browsers` 时会把「浏览器启动失败」报成 38 条用例失败；③Firefox `export:12` 的 MP3 下载 200 s 超时待确认；④`timeout … npm run <script>` 的 SIGTERM **不传播**给 npm 子进程（上限形同虚设）；⑤停 lane 后残留的 `vite preview` 会占端口，让下一条 `test:visual` 启动即失败。
   **门禁本身的意见**（与第 20 条同源，逐项仍未做）：`verify` 首个失败即停 + bench 可静默降级 ⇒「整链绿」语义弱；fuzz 成功不打印余量；fps 仍用 best-of-5（本次最差窗 22.5 仅比 floor 20 高 12%）；跨引擎只在 CI。
   **慢轨确认的好消息**：`bench --long` 在**安静窗口（load 1.13）**下 PASS：`p50 1091 µs (40.9%)`、**`wasm memory 15.1 MB`**（上限 32）、**arena 余 8471 KB**、`0/22500` 超预算 ⇒ **P9.8 扩 arena 的内存风险点确认未触发**；perf 6 passed（启动 395 ms、fps 53.8/51.3/61.3）；视觉首跑 1 failed 是**负载导致的 60 s 启动超时**（load 7.6–8.3），重跑 load 2.83 → **10 passed / 48 基线**；线上与产物**全站 43/43 文件 sha256 逐字节相同**（当时 v2.0.3；期间已滚动到 v2.0.5）。

36. **默认输出电平偏低（用户报告）⇒ 决定：`VOICE_GAIN 0.22 → 0.44`（+6.0 dB）**（测量见第 34 条，执行轨道 `p-loud2`）。**测量轨道同时修正了父代理的三处数字**：①干净满幅正弦是 **−18.82 dBFS**（不是 −13.4；早先探针有参数泄漏），其中 `VOICE_GAIN` 只占 −13.15，另 5.6 dB 来自等功率声像（−3.01）/ osc 0.9（−0.92）/ 梯形通带（≈−1.7）；②`gs_limit_reduction()` 返回**线性增益**（1.0=不动作）而不是 dB；③真正在削波的是 `soft_limit()`（knee 0.82），**基线 16 音满幅和弦就已经在软削波**（peak 0.901）；④**首次启动的 patch 是 `DEFAULT_PARAMS`（PATCH_GAIN=1.0，−20.02 dBFS）不是 pluck 预设** ⇒ 只改预设 trim 治不到用户报的那个「默认」。
   **+6 的实测代价**：bank 中位 RMS −40.05 → **−34.04**、默认 patch −20.02 → **−14.00**、密集 bench −8.04 → **−4.89**、最响预设 peak **−0.73**（`phonk`，32 样点软削波 0.06 dB）、密集素材限幅器**全程不动**；`preset-loudness` spread 7.8 → **8.1**（门禁 <9）。**要重录**：`tests/dsp-baseline{,-2x}.json`（0.030735 → 0.061470、0.030852 → 0.061703）与**两份 91 条指纹**（crush 系因为进入粉碎器的电平变了而**真的变音色**，必须逐条真测）。**两条绝对步进门禁**（P9.6 的 `P96_STEP_BOUND 0.13`、hard-sync `jump < 0.25`）在 +6 后分别变成 0.2123 / 0.259（**比值不变 ×2.001**）⇒ 本批要求把它们**改写成尺度相关形式**（`step < k × peak`），这样以后任何增益变化都不必再改门禁；并附「标定非放宽」的证据。**+9 已证伪**（3 条预设触膝、`phonk` limiter −2.79 dB、**2× 驱动抗混叠掉到 11.2 dB < 12**）；**+3 不划算**（只多 3 dB，spread 8.9 已贴线）。**注**：+6 后 2× 抗混叠余量只剩 **1.7 dB**（13.7 vs 12），是下一批要盯的地方。

37. **【写文档时挖出的真缺陷，v2.0.7 已修】AudioParam 量程窄于引擎枚举 ⇒ 10 条工厂音色在浏览器里跑的是错误算法**：`worklet-processor.js` 的 `parameterDescriptors` 把 `osc1Wave`/`osc2Wave` 上限写成 **7**、`filterType` 写成 **3**、`fxChain1..6` 写成 **8**，而引擎枚举接受 **0..9**（8=wavetable、9=sample）、**0..6**（4=comb、5=formant、6=sem）、**0..9**（FxKind，9=transient）；`engine.ts:504` 在送出前 `clamp(value, param.minValue, param.maxValue)`，而实例 A 的唯一送参路径就是 AudioParam ⇒ **波表变 brown noise、SEM 变 notch、效果槽选瞬态整形实际跑 EQ**。**受影响 10 条**：`wtorgan/wtvocal/wtglass/wtmetal/graphswell`（wave=8）+ `phonk(comb)/robotvoice(formant)/semmorph/semparabass/semnotch(sem)`。
   **为什么四类门禁全都看不见**：`verify-presets`/`preset-loudness`/`verify-audio` 直调 `gs_set_param`；`worklet-processor.test.ts` 把 `osc1Wave: 8` 直接写进 mock 的 parameters 记录——**全部绕过描述符与浏览器钳位**。**浏览器侧实测证据**（真页面 + AnalyserNode）：修复前 `wtorgan` 与「显式 brown noise」「显式 wavetable」三条 take 的谐波梳比分别是 **12.0 / 14.2 / 12.4 dB**（无法区分）；修复后 `wtorgan` **73.9 dB**、显式 wavetable **88.9 dB**、brown noise 仍 12.6 dB。
   **修法**：把量程放宽到与引擎枚举一致（只改钳位边界，`clamp` 逻辑保留）+ `fxChain1..6` 同步修；顺带把 `DISCRETE` 从 `engine.ts` 移到 `params.ts`（纯移动）以便门禁枚举。**新增两道门禁**：`src/audio/param-range.test.ts`（读 worklet 真正服务的描述符，断言每个离散参数量程**包含** Rust 解码器的最大值，并钉住 max 与共享 TS 枚举一致）与 `e2e/param-range.spec.ts`（真浏览器读**写入 AudioParam 的值**）。两条都自证过：把 max 改回 7/3/8 ⇒ 数据门禁三处分别变红、浏览器门禁 `Expected 8 Received 7` / `Expected 6 Received 3` / `fxChain1 >= 9 Received 8`。
   **离线门禁对本批完全无感**（`test:dsp 0.06147`、`91 presets unchanged`、`tests/*.json` 未变）——这正是它活了这么久的原因，也是「新增门禁必须走真浏览器」的理由。**发现方式**：写 `docs/DSP-GUIDE.md` 时逐条核对「文档说的」与「代码做的」⇒ **这次写文档不是抄写任务**。顺带修掉 6 条陈旧注释（`engine.rs` 的图 2×「held off」、`wasm-ladder-root-cause.md` 的「shipped DSP is unchanged」、`ladder.rs` 的 4 dB vs 6.02 dB、`eighty presets`、`6.0 dB spread`、`src/params.rs` 路径笔误）与 §32.1 的一处事实错误（`formant` 预设其实不受影响，真正的是 `phonk`/`robotvoice`）。

38. **WebKit 归因结果（轨道 `p-webkit9`，2026-09-14 按用户「往后放一放」暂停）+ 两件必须处理的事**：
   口径 `GS1_E2E_PORT=4852 npx playwright test e2e/{clips,flow,player,pwa,roll,takes}.spec.ts --project=webkit --workers=1 --retries=0`（**相关 6 spec 子集 50 条，不是整包**）。跑到 **38/50** 被中断：日志存活 **19.1 min**、38 条自报合计 642 s，其余约 8 min 是 webServer/context/WebKit 启动开销。对照 v2.0.3 整包 42.7 min ⇒ **整包必然仍 >20 min ⇒ 按用户判据 WebKit 不进常规门禁，只留慢轨/CI**（这条结论就此写死，不再重复取舍）。
   **逐条归因**：`clips:127` **已绿**（28.7 s）、`flow:115` 本次也绿。`flow:251`（含手机版 `flow:289`）偏移 **7.0099 px = 14.02/2**，正好是**经典滚动条的一半**；`.flow-params` 是 `fixed + translate(-50%,-50%)`，相对布局视口（`clientWidth`）居中是对的，是**用例拿 `window.innerWidth` 当参照错了**；且 Chromium headless 默认 `--hide-scrollbars`（已在 `playwright-core` 源码核对）、真 Safari 是 overlay（0 px）⇒ **参照系/环境，不是产品缺口**。`roll:181`（2.0 min 超时）是**测试基建缺口**：spec 本就写 `click({force:true})`，而 `e2e/fixtures.ts` 的帧无关点击**根本没读 `options.force`**，照样循环做 `elementFromPoint` 命中测试直到 120 s 超时 ⇒ **修法极小且不是放宽阈值**。`player:153`：320 px 下 `scrollWidth - clientWidth = 10`（Chromium 绿）⇒ **✅ 已查明并修（轨道 `overflow`，2026-09-15）：既不是窄屏产品缺口，也不是参照系伪影。** 稳定状态下 320 px 两引擎都是 **0**（Chromium 连去掉 `--hide-scrollbars`、经典 15 px 滚动条真占位时仍是 0 ⇒ 排除 `100vw`/滚动条那一类）。10 px 只在应用**被留在 `desktop` 类别**时出现：超宽元素唯一是顶栏的 `div.preset-ctrl`（`rect x=10..330`、`computed min-width:320px`），而 `gs1.css` 的 `.app[data-device='desktop'] .preset-ctrl{min-width:320px}` 加顶栏左内边距 10 px 正好把它推到 330。**为什么类别会陈旧**（决定性探针，同一构建两引擎对比）：`page.setViewportSize` 在 **headless WebKit 上不给页面任何通知**——`resize`、`visualViewport.resize`、`ResizeObserver(documentElement)` **一条都不触发**（Chromium 三条都触发且事件内 `innerWidth` 已是 320）⇒ 应用保持 1280×900 启动时的 `desktop`；WebKit 里直接在 320 启动就是 `phone`、溢出 0。**修法（一行 CSS，桌面逐像素不变）**：`.preset-ctrl{min-width:min(320px,100%)}`（宽屏下 `100%` 远大于 320 ⇒ 取 320）；断言落在 `e2e/player.spec.ts`（320 px 下强制 `data-device=desktop` 再量根溢出）：旧 CSS 读 **10** ⇒ 红，新 CSS 读 0 ⇒ 绿，WebKit 重放同一状态 10 → 0；视觉 48 张全绿、无 `--update`。**这同时给 `flow:251` 提供了更深的解释**：该引擎不通知视口变化，很可能就是那一类问题的共同来源。`flow:363` fill 0.842 vs `>0.85`（差 1%）；`pwa:100` 是 `page.reload: WebKit encountered an internal error`（引擎差异/已知 flaky）。`takes:207` **与 marquee 无关**（失败点是 `:226` 录音后 note 数 2→1）：`overdubTake → mergeNotes` 对同音高且 start 差 ≤ `TAKE_RESTRIKE=0.05 s` 会并轨替换（有单测、是有意设计），而 `recorder` 用 `performance.now()` 记 start ⇒ **用例场景依赖 50 ms 墙钟边界**（床铺音恰是 D4，首录也是 62）。`roll:573`（marquee 本尊）**未跑到** ⇒ 还不能断言 Safari 拖不动 marquee。
   **两件待处理**：①~~`ci.yml` 的 `e2e-engines` 与 20 min 判据冲突~~ **✅ 已做（2026-09-14，父代理）**：**删除** `e2e-engines` 作业（它每次 push/PR 阻塞式跑整包 WebKit），两个慢引擎改由 **schedule 触发的 `nightly` 作业**各跑一遍 `--all`（Firefox 从 `--subset=nightly` 升为 `--all`，**覆盖率零损失**）；`scripts/verify-ci.mjs` 同时改：新增「慢引擎只许出现在 schedule 作业里」（把 `--project=webkit` 加回 push 作业会当场红）与「`nightly` 必须对两个引擎都跑 `--all`」（防止删作业变成静默的覆盖率损失），并删掉原先硬断言必须保留 `e2e-engines` 的两条。**三条自证**：往 verify 作业插一行 `--project=webkit` ⇒ `✗ the "verify" job runs the slow engines only on the schedule`；追加一个 `e2e-engines:` 作业 ⇒ `✗ no push-triggered cross-engine job`；把 Firefox 改回 `--subset=nightly` ⇒ `✗ it runs both engines over the whole suite`；还原后 `verify:ci` 绿。文档同步：`DEPLOY.md`、`docs/notes/release.md`（20 分钟那节）、`docs/notes/compat.md`。②~~`e2e/fixtures.ts` 的 `force` 缺口~~ **✅ 已由 P13.4（v2.1.2）修好**：帧无关交互抽成 `e2e/interact.mjs` 时**遵守了 `force`**（自证：删掉那 5 行分支 ⇒ 5 条单测 30 s 超时变红）；`gs1.ui.click` 与 E2E 共用同一份实现。**仍开着的是 `flow:251` 的参照系修正**（用例拿 `window.innerWidth` 当参照，而元素是按布局视口居中的）——它要等 WebKit 轨道重启才能「修后绿」，届时做（仍要「修前红 / 修后绿 + Chromium 不回归」）。

39. **第三次全面回归（冻结 v2.1.0，2026-09-14）——两条确定性真红 + 一批「门禁在骗人」**（报告：`.tmp/sweep-v2.1.0-report.md`，589 行）
   **背景**：距上次全面回归（v2.0.3）已发 5 版，按用户「几次版本发布后彻底测一次」的指示开了慢轨轨道；冻结 tag `v2.1.0`（`5852687`），干净树自证通过，收尾时 worktree 未被弄脏（`docs/notes/nightly.md` 被 nightly 写过，已还原——**提醒：nightly 不是只读命令**）。
   **两条确定性真红（与负载无关）**：
   - **① `verify:clippy` EXIT=101——`verify` 链第一步就断。** clippy **1.98** 把 `approx_constant` 变成 deny-by-default（不带任何 `-D` 也红），打中 `crates/synth-core/src/dsp/sampler.rs` 测试里的 `assert!((reference - 0.7071).abs() < 0.02)`（单位正弦 RMS）。代码来自 v2.1.0 之前的 `5421198`，**是工具链升级让老代码变红**；CI 用 `dtolnay/rust-toolchain@stable` 且无 `rust-toolchain.toml` ⇒ CI 同样会红在第一步。**✅ 已修（父代理，`d5b8679`）**：改用 `core::f32::consts::FRAC_1_SQRT_2`；`verify:clippy` 由 101 转 0。**未做**：把 `rustc/clippy --version` 打进 CI 日志（`@stable` 不钉版本，这类事会复发）。
   - **② `verify:budget` EXIT=1——`dist total 1619.6 / 预算 1619.0 KB`，tag 自身超线 0.6 KB。** 归因：v2.0.7→v2.1.0 的 `Changelog-*.js` **113 366 → 114 644 B（+1 278）**、`index-*.js` −58 B、两个 wasm 逐字节未变 ⇒ **这一版自己的更新记录把线顶破**（与 §一.33 的 v2.0.5 同类，但那次的洞更大：`release:fast` 完全跳过整条 `verify`）。
     **根因是结构性的**：更新记录每发一版 +≈1.2 KB，rebase 只能撑一版。**用户 2026-09-14 拍板 A 方案**：**应用内只保留最近约 30 条更新记录**，更早的搬到 `src/changelog-archive.ts`（不进 bundle），界面写明「更早的见项目仓库」⇒ 预计 dist **−≈78 KB**，且增长**永久有界**。**✅ 已在 v2.1.1 做成（轨道 `p141`）**：发运列表 = **30 条（head 也算一条，即面板正好列 30 条）**，更早的 104 条搬进 `src/changelog-archive.ts`（不进 bundle）。实测 `Changelog-*.js` **114.7 → 33.5 KB**、dist total **1619.6 → 1540.2 KB**，父代理把线**下调** 1619 → **1550**（余 ~9 KB，够 4 个版本；增长从此有界）。搬运由测试逐条校验（新增/丢失/改文案/换顺序都红）。
   **③ 已顺带堵掉的两个洞（父代理，`d5b8679`）**：`scripts/release.mjs` 现在在 `package` 之后**无条件**跑 `verify:ci`/`verify:dist`/`verify:budget`（它们量的是刚构建出来的产物，秒级、确定性、不需要浏览器）——`--skip-verify` 再也不能把体积门禁一起跳过去；`scripts/nightly-e2e.mjs` 现在把「套件根本没启动」（端口被残留 preview 占、缺浏览器、没有 display）识别出来并在**空闲端口重试一次**，而不是写成一格 `❌ fail — 0 passed, 0 failed`；`PLAYWRIGHT_BROWSERS_PATH` 只在目录存在时才钉住，缺浏览器改成**启动前具名报错**（第三次回归为此白跑了一整轮 Firefox：把「浏览器没装」报成 **141 条用例失败**，与真红无法区分）。
   **④ Firefox 新增 6 条红 ⇒ ✅ 已查明是「宿主没有音频后端」并修好测试（轨道 `ffx`，2026-09-15）**：`boot:54`、`fm:33`、`i18n:83`、`meter:10`、`preset-audition:42`、`pwa:33`。
     **结论：产品零改动。** 本容器的 `/dev` 被 tmpfs 盖住（`ls /dev/snd` 无此文件、`aplay -l` 无卡、无 pulse/pipewire 守护进程），Firefox 的 cubeb 拿不到后端，stderr 一次运行重复 18 次 `Failed to create secure directory (/run/user/1000/pulse): Read-only file system`；**任何**实时 `AudioContext`（手势前建的、点击里新建的、显式 48 kHz 的）`resume()` 都**永不 settle**、state 恒 `suspended`。Chromium 有 **null sink 兜底**，所以同机同 dist 全绿。
     **两条被证伪的假设（都记下来，免得再走）**：① 「缺自动播放放行」——`navigator.userActivation.hasBeenActive` 是 `true`，父代理加的 `media.autoplay.*` pref 改动**已撤销**；② 「v2.0.7 放宽 `parameterDescriptors` 让 Firefox 起不来」——`addModule(真 worklet-processor)` 与 `new AudioWorkletNode` **都成功**，`OfflineAudioContext` 也正常渲染（peak=1），**只有输出设备缺失**。另外父代理猜的「Firefox 44.1 / Chromium 48」**不成立**：两侧默认都是 44.1，采样率不是原因。与 v2.0.3 的对照（`.tmp/sweep-v2.0.3/dist`，同一探针）**读数逐项相同** ⇒ 也不是 v2.0.4–v2.1.0 的回归（**顺带修正 §一.39 里「v2.0.3 那 4 条是绿的」这一说法：同一探针在 v2.0.3 上也读到 suspended，那一轮没红更可能是当时宿主状态不同**）。
     **修法（全部在测试侧，改前红/改后绿都有）**：① 新增 `e2e/audio-host.ts`，用**全新 `AudioContext`、零应用代码、在受信任点击里 `resume()`** 判定宿主能否发声（所以**应用级回归伪装不了它**：宿主能跑而应用坏了 ⇒ 判定仍是 null，spec 照跑照红）；不能发声时 `boot:54`/`meter:10`/`preset-audition:42`/`pwa:33` 显式 `test.skip` 并在**终端**打印读数（`[audio-host] firefox: skip audio assertions -- …`）。Chromium 下判定为 null ⇒ **不 skip**（13 passed）。
     ② 顺带查出 `fm:33`/`i18n:83` 是**同一根因的另一副面孔**：无声卡时 `start()` 要等两次 2.5 s grace，`.start-overlay` **实测 5033 ms** 才抬起，而 fm 的 boot 只等 300 ms、i18n 只等 `.kbd-dock.open`（在遮罩后面也算可见）⇒ 拖拽/点击被遮罩接走。两个 `boot()` 改成**显式等 `.start-overlay` 消失**（15 s 预算，**没有**放宽任何断言/阈值/超时）。探针证据：遮罩在时 `elementFromPoint(FM 中心)` 是 `start-overlay`，抬起后是 `knob-dial`，同一 60 px 拖拽 0→0.3158（与 Chromium 相同）。
     诊断与「怎么复跑探针」写进 `docs/notes/compat.md` §11。
   **⑤ 门禁/测试基建缺陷（与真回归同等价值）——✅ 已在 v2.1.1 修（轨道 `p142`）**：
   - **`verify-audio.mjs` 里藏着一个计时门禁却没有负载探针**（16 声部满链、`<60% of 2667 µs`）：load 16–21 读 **232%/149%/155% 红**，安静窗口（load1=1.00）读 **26% PASS**；**失败时不打印 perBlockUs、不打印 load、不给跳过路径**。这正是它连续误导三个 agent + 一次全面回归的原因。**修法**：三处计时门禁（bench / verify-audio / fuzz）现在共用 `scripts/lib/host-load.mjs`（`hostLoad` / `cpuProbe` / `timingTrust`），**读数永远打印**（含余量与每一轮窗口），宿主不可信时 `verify-audio` 打 `⚠ inconclusive` 且 PASS 行写明「timing not judged」，fuzz 用 vitest 的运行时 `ctx.skip()` 报**可见的 skipped**；**阈值一个都没动**。
   - **`src/fuzz.test.ts` 的 4000 ms 预算**同样无探针：load 16–21 读 4050/4252/6001/7945 ms（红），安静窗口读 **442/656/452/328 ms**；成功时也不打印余量。**✅ 已修**（同上）。
   - 因此本轮所有「Vitest 6 红」「`verify:audio` 红」「`test:e2e player:45` 60 s 超时」「visual self-check 红」**全部判为环境假红**（安静窗口逐条转绿：perf 6 passed、bench timing judged `p50 1111 µs (41.7%)`、`bench --long p50 1215 µs`、`player:45` 单跑 13.8 s 绿、visual self-check 单跑 18.7 s 绿）。
   - **`test:visual` 的 self-check 用例整套红/单跑绿 —— ✅ 已修（轨道 `trel`），而且真因与慢轨的假设不同**：慢轨猜「起点被前面用例污染」，`trel` 用探针**否掉了它**。真因是**光栅竞态**：`.modules-grid` 是 1324×**1441**，比 900 高的视口高 ⇒ Playwright 走 `captureBeyondViewport`，**第一张**截图可能在视口外的瓦片画完之前就返回（同一份 dist、同一套 mask、DOM 在 7.5 s 内采 60 次**零变化**的前提下：第 1 张与基线差 **16.9%**、第 2 张**逐像素相同**；差异区正是没画出来的 OSC/FILTER/ENV/MOD MATRIX/REVERB/DELAY 面板体，mask 矩形位置逐像素一致 ⇒ 布局没动）。Playwright 把它读成 `274404 px (0.15)`，再要一张确认稳定、第二张落不进 15 s `expect` 预算，于是报「Failed to take two consecutive stable screenshots」。**修法**：新增 `prime()`——对**比视口高**的元素先白白截一张把光栅推完，再让正常比对判第二张（`shot()` 供 48 张基线共用）。**没放宽** `maxDiffPixelRatio`/`threshold`、**没** `--update`、**没** skip、**没**重录基线；自证仍有效（临时画花 ⇒ **稳定地**报 diff：652420 px / ratio 0.35，而不再是「不稳定」超时）。改后：整套 **10 passed**（idle 2.0 min；带可控负载 load 22.1 时 5.4 min）、self-check `--repeat-each=3` 3 passed、`npm run test:e2e` **150 passed / 10 skipped**（慢轨那轮是 149 + 1 failed）。
     顺带一条**方法论**：慢轨报的「整套红/单跑绿」现象为真，但「串行状态污染」这个归因是错的——这次和「导出读旧 song」「调 PATCH_GAIN 修 crushbass」一样，**假设必须先证实**。
   - **`e2e/player.spec.ts:45` 的 60 s 超时 —— ✅ 已修（轨道 `trel`），判定是「用例自己的预算」而不是资源争用**：用 CDP `Emulation.setCPUThrottlingRate` 只放慢渲染进程（安静宿主）做单变量对照——修前 1×/4×/6× 分别 20.0/40.8/41.7 s 通过、**8× 超时**，且每次停在**不同的步**（CDP 那轮停在 `.player-time`、慢轨那轮停在「清除 A/B」）⇒ 是整条用例的预算耗尽，不是坏选择器、也没有固定资源在争。**改法**：三段固定 sleep（1200/1500/4000 ms）改成 `expect.poll` **等 transport 自己的时钟**；「不能跑出区间」从「睡 4 s 读一次」改成**采样 + 必须看到回绕**（证据更多，断言一条没放宽）；另给 chromium 加 `timeout: 90_000`（**没有加 `retries`**——重试会把真抖动洗成绿），理由与全部数字写进 `playwright.config.ts` 的注释（修后 8× 已能在不改配置的情况下过；4×/6× 读到 48.6/54.0 s，整套里邻居 `preset-audition:42` 48.7 s ⇒ 60 s 对慢主机零余量；90 s 就是同文件 Firefox 的既有数字）。副作用：`test:visual` 同为 chromium project，**用例**预算也变 90 s（**比对**预算 `expect.timeout` 15 s 未动）。
   - **`playwright.config.ts` 没配 `retries`**：贴 60 s 线的用例（`player:45`，同 spec 邻居整套里 49.7 s）在慢主机上直接红。**登记待立批**，但**不许靠重试掩盖**——要么降低套件争用，要么明确「这条在慢主机上属于计时项」。
   **⑥ 体积余量告警（已解决一半）**：SIMD wasm gzip 当时只剩 **18 字节**（76 775 / 76 800）。P9.10 的改动一度把它顶到 76 892（超 92 B）；**父代理把 `low_pass_at` 改成 `#[inline(never)]`**（少一份内联副本）后 **76 717 B = 74.92 KB，余 83 B**，**没有动阈值**，且速度红利仍在（同机同探针 4 s 导入 130 → 78 ms）。
   **⑦ 本轮确认无问题的部分**（也要记，免得下一个人重查）：线上 `synth.wangda.today` 与最新 tag 的 dist **44/44 文件 sha256 逐字节一致**（含 `sw.js`、`index.html`、懒 chunk），本地 `dist/` 与 `release/gs1-synth-2.1.0-dist.zip` 解包后 44 文件全同，三个产物 `sha256sum -c` 全 OK，`retained/` 五个快照齐全，线上 TTFB 0.67–0.91 s；`test:rust` **231 passed**、`verify:presets(:2x)` **91 unchanged · ABI 8**、`test:dsp 0.06147`、`verify:dsp:2x 0.061703`、`test:wasm` PASS（零分配、ABI 8）、`PARAM_COUNT 224`、`nightly-report --self-test` 12/12、`rollback --self-test` 32/32。
   **⑧ 覆盖缺口**：**WebKit 本轮未做**（用户指示 + 整包 42.7 min）；§一.38 的三条待处理项里，`roll:181` 的 `force` 缺口已由 P13.4 修好、`player:153` 已由轨道 `overflow` 查明并修（见第 38 条），**只剩 `flow:251` 的参照系修正**（而那很可能与「headless WebKit 不通知视口变化」同源）。全部渲染/性能结论在**软件渲染**下取得（沙箱 tmpfs 盖住 `/dev/dri`，不是没有 GPU）。
   **⑨ 文档一致性抽查（第 11 项，6 条旧值）**：本轮已修 §一 现状表（v1.97.0 → v2.1.0）、§六.2 的链序（`build` 必须在 `test` 前）、§六.3 的相容红线（`0.030735/0.030852/81` → `0.061470/0.061703/91`）、§一.34 的 `VOICE_GAIN 0.22`（已由 §一.36 改成 0.44）。复核对的部分：§一.11 的参数编号重叠算式逐条成立、§一.12/20⑦「48 张基线不在 CI」至今成立、源码无 TODO/FIXME。

40. **MCP 接口（P13.2/P13.3）登记的三条边界**（都不是缺陷，但下一个人会撞到）
   - **`gs1.sample.import` 的 `noRoom`（返回码 4）在 12 MiB arena 下真实不可达**：仓库自己的 Rust 测试
     `the_longest_mipmap_fits_the_arena` 就断言最长 mipmap < arena/2，P13.3 的探针（98304 样本 IR + 4 s 采样）
     跑完仍余 7.9 MB。所以「装不下要如实透出 code 4」这条**用单一注入缝测**（只替换「决定判定的那一次 core 调用」），
     同一条测试再用真 core 跑一遍断言 `code === 0`，并在 `mcp/lib/import.mjs` 的注释与 `docs/notes/mcp.md` 里写明。
     **要真触发它**只能临时改 `ARENA_SIZE` 重建 wasm（属另一批）。
   - **`gs1.patch.random` 的配方是从 `src/state/store.ts` 的 `randomize()` 转写**（UI 用全局 `Math.random()`，
     运行时无法重放）。P13.3 用 mulberry32 驱动，并有一条测试**从源码里抽出 `randomize()` 的 id 集合**比对
     （id 漂移会红），但**分布改变需要人工同步**。以后动 `randomize()` 的人要连带看 `mcp/lib/random.mjs`。
   - **`gs1.analyze` 量的是「你给的那段音频」**（含调制与混响能量），门禁口径的**振荡器地板**要用 `gs1.gate`；
     `gs1.render` v1 **只渲染 instance A**（结果里 `layersRendered: "instance A only"` 注明）。
   - **`gs1.songs.list` 与 `gs1.preset.apply/save` 的名字是任务书定的**，`docs/LLM-INTERFACE.md` §4.1/§4.2 原来
     没列全（`songs.list` 被列在只读类而 P13.2 没交付；`preset.apply/save` 根本没行）。已在文档里补齐并注明出处；
     **P13.5 已经接手把整篇文档对齐实现**，本条的结论直接进那份文档。
   - **MCP 的 `dependencies` 判定口径**：本仓库的 `dependencies` **本来就不是空对象**（6 条），
     所以 P13.2/P13.3 的验收是「**与基线一字不差**」（有测试断言），不是「空对象」。任务书写错过一次，记在这里免得再犯。

41. **p926 的代价：首访总下载量基本持平（SW 预缓存与首屏并发）**（2026-09-15，轨道自报，父代理记账）
   `registerServiceWorker()` 在挂载时就跑，SW 的 `install`/`cache.addAll` 与首屏**并发**，所以新拆出来的
   `presets-*.js`（6.8 KB gzip）与 `songs-*.js`（5.5 KB gzip）**在首次访问时仍会被后台下载**（它们在
   `dist/sw.js` 的 PRECACHE 名单第 22/25 项，共 44 项；`e2e/lazy-chunks.spec.ts` 把这一点也钉住了）。
   于是：**首屏关键路径少 11.8 KB、首屏 JS 门禁线降 11 KB、重复访问走缓存、不打开面板就不解析/不执行那 45 KB 数据**，
   但**首访总字节几乎不变**。
   **要让首访也不下载**：把这两个 chunk 加进 `scripts/gen-sw.mjs` 的 `DEFERRED`（现在只排除 `synth_core_scalar-*.wasm`），
   代价是「首访当场打开抽屉、且当时已经离线」会看到加载失败 + 重试（联网打开过一次后就会被 fetch 处理器缓存）。
   **✅ 用户 2026-09-15 拍板：保持预缓存，维持离线可用性优先。** 不把这两个 chunk 加进 `gen-sw.mjs` 的 `DEFERRED`，
   因此「首访当场、且从未联网打开过抽屉/播放器」时它们已经在缓存里、离线也能开；代价仍是首访总字节基本不变（首屏关键路径
   与重复访问才是收益）。若将来把「首访少下 ~12 KB」看得比「首访当场离线可用」更重，再加 `DEFERRED` 即可——那是一个
   独立小改（`scripts/gen-sw.mjs` + `e2e/lazy-chunks.spec.ts` 的断言同步），本条记录决策后关闭。

42. ~~**`MASTER_TUNE` 在渲染路径被应用两次**（轨道 `pnoise` 途中发现，父代理按源码复核，2026-09-15）~~
   **✅ 已修（轨道 `pitchbug`，3 条 commit，已并入 v2.1.5 批次）。** 原文记录：`Engine::flush_pending`（`engine.rs:1830` 附近）
   用 `pitch_hz_with(note, master_tune, &tuning)` 设声部基频（应用一次），同一块的渲染又
   `let mut pitch_mod = … + params.master_tune`（:1965）再乘一次 ⇒ 真 wasm 实测 note 69 发
   `+1 / +7 / +12 / −12` → 音频 **+2.005 / +13.998 / +24.000 / −24.022** 半音（**正好两倍**）。公开 `pitch_hz()`（:1244）
   与既有 Rust 单测只覆盖「应用一次」的路径 ⇒ **渲染路径没有门禁**。**影响面小**：91 条工厂预设 masterTune 全 0、
   UI 没有这个旋钮，只能经 MCP 裸参数 / `.gs1proj` / CC 到达。
   **修法**：删掉渲染里那次多加（`pitch_mod` 只留 bend/LFO/调制矩阵；`pitch_hz*()` 那次是正确的一次，MONO 滑音与 pending 提升都走它）。
   **两条门禁都加了**：Rust `master_tune_moves_the_rendered_pitch_once`（旧代码读 +2.000 半音 ⇒ 红）+ 真 wasm
   `scripts/verify-audio.mjs` 的 4 行（0/+1/+12/−12，容差 0.1 半音；临时还原生产行 ⇒ 三条红，原文见轨道报告）。
   真 wasm 复测：`0/+1/+7/+12/−12` → **−0.000/+1.000/+7.000/+12.000/−12.000** 半音。
   **默认 0 逐位不变**（`a + 0.0` 逐位等于 `a`；`semitone_ratio(±0.0)==1.0`），`test:dsp 0.061470`、`verify:dsp:2x 0.061703`、
   `91 presets unchanged · ABI 8` 全部未动；wasm raw −6 B（gzip 76715 → 76710 B）。
   **一条行为变化（已知并接受）**：master tune 现在**在 note-on 生效**——按住键期间改它不再实时移动已发声音部
   （改前会跟调，但整体是双倍）。UI 无此控件，若要「持键实时微调」，正确形态是基频不预含 tune、只在渲染加一次，
   那会改默认 0 的路径，另立批再说。
43. ~~**同音高双振荡器的相对初相随 note-on 变**（轨道 `pnoise` 途中发现，2026-09-15，**需拍板**）~~
   **✅ 用户 2026-09-15 拍板：(a) 保持现状，不立批。** 记录：`Engine::next_phases()`（`engine.rs:1377`）给 osc1/osc2
   各一条黄金比序列的伪随机相位、**每次 note-on 都不同**（P9.1c 为打散硬同步/混叠爆发而做的「反坏对齐」设计）。
   后果：两个**设置完全相同**的锯齿会梳状叠加、**偶发抵消基频**——6 次 note-on 实测 h2/h1 在 440 Hz 摆
   **−25.5…+12.9 dB**、1568 Hz 摆 **−31.4…+19.0 dB**（单振荡器稳定 −6.0/−6.2 dB）。
   **这是一个有意的取舍，不是缺陷**：去相关换来的是同步/混叠爆发不在同一相位上累积，改它会动 P9.1c 的验收。
   其余选项（同设置时对齐、只用确定性慢漂移）**不做**；将来若要「同一和弦每次一致」，按新需求另立批并重录指纹。
44. ~~**推入限幅器时出现 `k·f0 ± 40 Hz` 侧带地板**（轨道 `pnoise` 途中发现，2026-09-15，低优先）~~
   **✅ 已修（轨道 `limiter`，2026-09-15，已并入 v2.1.6 批次）。** 原文记录：用 `PATCH_GAIN`（id 78）把单声部推过限幅器后
   BH-7 读 **−35.2 / −35.1 dB**（pg 6/8），增益峰-峰纹波 **1.1 dB**，主峰在 f0 与 **40 Hz**，音频里是
   **k·f0 ± 40 Hz** 侧带（55/110/220/440 全是 ±40 Hz）。**严重性边界**：`verify-presets` 的乐句下 **0/91 进入限幅器**
   （单声部要 `PATCH_GAIN ≳ 2.4`），10 音满电平和弦会进入。
   **机制（上游那句「与 f0 无关」是只测 A 音的巧合，已纠正）**：`limit_peak` 是**逐采样**的「快起 + 50 ms 指数落」检波器；
   对**有跳变沿**的波形（锯齿/方波/脉冲），「离峰值最近的那个采样」的高度取决于边沿落在采样之间的位置，而采样相位每周期
   前进非整数个采样 ⇒ 每周一次增益谷的深度抖动（110 Hz 实测 **4.4%**，与谷深相关 **−0.908**，理论边带 ≈ −33 dBc，正是观测值）。
   **40 Hz = 采样相位图案的重复率**：110 Hz 的图案要 11 周期（0.1 s）复位，抖动谱落在 `f0/11 = 10 Hz` 的整数倍上，四个 A 音
   都可整除 11 ⇒ 40 Hz 在四条谱里都强；**换成非 A 音就不是 40 Hz**（note 46 → ±15、50 → ±14、67 → +177/+215）。直接证据：
   同条件下 sine −92.1 / triangle −70.6 / **saw −34.8 / square −36.7 dB** ⇒ 罪魁是有沿波形；对真实信号低通 3 kHz 就把
   40 Hz 调制从 −2.8 压到 −28.4 dB。**逐常数扫描：没有任何单常数能压下去**（ceiling 只改深度、release 只线性减纹波、
   hold 要长到覆盖图案周期才见效）。
   **修法（`engine.rs`，不新增状态/参数 id）**：**峰值仍高于 ceiling 时不释放**——「信号还没回到 ceiling 以下，就没有可释放的对象」：
   `let step = release_step * f32::from(u8::from(need >= 1.0));`。写成 `else if need >= 1.0` 会破坏 LLVM 的 branchless 目标更新、
   gzip 涨到 **75.19 KiB（超线）**，无分支写法只 **+13 B**（74.9121 → 74.9248 KiB，余 0.075 KiB，**没动阈值**）。
   **实测 A/B（同进程同 note-on 历史，真 wasm）**：锯齿 note45 地板 **−35.2 → −58.3 dB**、f0±40 侧带 **−40.5 → −89.1 dBc**、
   持续音纹波 **1.085 → 0.000 dB**、键盘 55…440 Hz **−28.3…−39.9 → −52…−61**、十音和弦泵动 **6.499 → 0.000 dB**；
   峰值/单步仍在界内（0.9124 / 0.8148）。**残余地板不是限幅器而是 `soft_limit` 的膝 0.82**（固定增益控制实测 −55…−57 dB），
   所以验收线取 **−50 dB**（按该地板定，理由在 `docs/notes/limiter-sidebands.md`）。**限幅器不动作时逐位不变**：
   64000 样本逐 f32 位比较，`limit_gain` 恒 1.0 的渲染 **0 处不同** ⇒ `test:dsp`/`verify:dsp:2x`/91 条指纹一字未动。
   门禁：Rust `the_limiter_does_not_modulate_the_bus_at_the_phase_rate`（**一组音高**，含实测最差的 440 Hz）+ 真 wasm
   `verify-audio.mjs` 的 §一.44 段（同一组 + sine 控制项）。
45. ~~**并行的整链验证会被 `mcp/ui/ui.test.mjs` 的端口假设弄红**（慢轨 `slowver` 发现，2026-09-15）~~
   **✅ 已修（父代理，集成窗口）。** 该测试断言 `E2E_PORT === 4783`、再拒绑 `GS1_MCP_UI_PORT=4783`，而
   `mcp/ui/lib/preview.mjs` 里 `E2E_PORT = Number(process.env.GS1_E2E_PORT ?? 4783)` ⇒ **任何**按
   `parallel-dev.md` §六 给自己一个端口（`GS1_E2E_PORT=479x`）的轨道，跑整链 `verify` 都会在这一条**假红**
   （产品无碍，`npm test` 1 failed / 708 passed）。修法：拒绑跟着**解析后的** `E2E_PORT` 走，文档同步。
   实测：无覆盖 **31 passed**、`GS1_E2E_PORT=4791` **31 passed**（改前后者红）。这条修完，「多线推进」的整链验证才真正可用。
46. **nightly 的 lock 在 SIGTERM 后不删，手动重试会被自己挡 6 小时**（轨道 `nightlog` 途中发现，2026-09-15，未做）
   `scripts/nightly-e2e.mjs` 的 `nightly.lock` 只在正常退出路径的 `finally` 里删；被信号打断时
   （systemd `TimeoutStartSec=3h` 到点、或人工 Ctrl-C / `kill`）`finally` 不执行，于是**同一台机器在
   6 小时内再跑 `npm run nightly` 会被自己的 lock 拒绝**（6 小时后走既有的 `clearing a stale lock`）。
   轨道 `nightlog` 的作者自己就被实验后的残留 lock 挡过一次。**systemd 定时器每天一次（>6h）所以生产上撞不到**，
   撞到的是「手动复跑」这条路径。**没改**：在信号处理里删 lock 会削弱并发保护语义（两个 nightly 同时跑会抢端口/资源），
   要改应当把「持锁者还活着吗」做成判据（例如记录 pid 并检查），属独立小批，**登记待立**。

## 二、四个方向

| 方向 | 目标 | 为什么现在做 | 批次 |
| :--- | :--- | :--- | :--- |
| **P9 音频质量二期** | 把引擎自身底噪压到 −60 dB 级，补完效果与调制粒度 | 底噪影响**所有**音色，比继续调同步核收益大一个量级；效果参数粒度是图内调制的最后一公里 | P9.1–P9.5 |
| **P10 创作与工作流二期** | 时间线/片段/take/工程管理的下一步 | 用户每天用得到；且 clips×take 的语义歧义必须修掉 | P10.1–P10.5 |
| **P11 工程与质量二期** | 体积、回归覆盖、平台矩阵、启动预算进发布门禁 | v1.97.0 的门禁已经很紧，下一步靠工具链（wasm-opt）与覆盖率扩展 | P11.1–P11.6 |
| **P12 产品化与生态** | 教学内容、内容包、分享协作、分发回滚、（可选）无障碍 | 让「能用的合成器」变成「有人愿意分享与留下」的产品 | P12.1–P12.5 |

## 三、批次明细

### P9 · 音频质量二期（每批都必须时域 + 频域断言）

**P9.1 引擎非谐波底噪治理** —— 📊 调查完成（`.tmp/noise-floor-report.md`，254 行），**拆成 a/b 两批**
- **调查结论（实测，2026-09-12）**：
  1. **纯正弦的 −84…−102 dB「底噪」是测量伪影**：振荡器相位增量是 f32 量化（880 Hz 实际跑 879.999965 Hz），门禁在**标称**谐波上做精确 bin 会按 `1−(πΔfT)²/3` 少收能量。三条证据：理想 f64 正弦放在 f32 精确频率上，五个音高的引擎读数**逐个 0.0 dB 吻合**；读数随窗口每翻倍 **+6 dB**；与电平完全无关。8 s Blackman-Harris 谱上正弦离网 **≤ −105 dB**——引擎本身干净。
  2. **锯齿/方波/三角的 −40…−69 dB 是真实底噪**，来源是 **DaisySP 2 点 polyBLEP 的混叠**：离网分量精确落在折叠像位置（距谐波 `48000 mod f0`：110→40、880→480、1568→960、3520→1280 Hz）；对电平/限幅器/滤波类型不敏感（换成 drive=0 的**线性** SVF 结果不变）；离线复刻 DaisySP polyBLEP 的模型在四个音高与引擎差 **≤0.3 dB**。
  3. ~~**硬同步原来的 −68.7 dB 不可复现**（同场景同进程 8 次波动 33 dB）；**稳定 400 块后 6 次全部 −80.8 dB**。波动根因是 `gs_init` 不复位参数块/调制矩阵/`sync_mphase/sync_sphase` 相位历史与 voice 轮转——**是测度问题，不是引擎问题**：P6.2b 第三步实际比记录更好。~~
     **这条结论被 P9.1a 推翻**：场景卫生（全 pin + 清调制矩阵 + settle 400）确实消掉了「6 次全 −80.8」的**跨场景**离散，但**同一个持续音之内**的波动还在——连续 8 个 4 s 窗在 BH-7 尺子下是 `−109.2 / −36.5 / −48.3 / −56.3 / −105.3 / −111.5 / −117.0 / −36.1 dB`，旧尺子同步摆动（`−30.5 … −68.7`），所以 **−68.7 dB 只是抽到了好窗**，坏窗可达 **−33 dB**。这条是**真的引擎缺陷**，登记为下面的 P9.1c；证据见 `.tmp/hard-sync-drift.md`。
- **P9.1a 度量与门禁卫生** ✅ **v1.99.0 交付**——实测否掉了任务书的首选（「探测改到 f32 精确频率」在同一场景时而 −74 dB、时而触 `max(residual,1e-30)` 下限，因为该度量是两个大数相减），改用 **7 项 Blackman-Harris 整 4 s 窗、零填充 FFT、每谐波 ±8 bin（±2 Hz）带外功率 / 总功率**：正弦最差 **−119.1 dB**（断言收紧到 **< −105**）、锯齿/方波/三角首次记录真实离格底（−56.7…−37.4 / −58.4…−39.0 / −104.0…−49.4 dB，P9.1b 收紧到 −60）、新增「同场景连做 8 次离散度 < 1 dB」断言（实测 **0.00 dB**）；锯齿/方波在新旧尺子下逐格 ≤0.6 dB，证明**变的是尺子不是引擎**。引擎/`crates` 零改动，红线逐字复现。**硬同步段未动**（原度量与原 −60 断言保留，注释写明真相），阈值未放宽。遗留：Rust 侧 `settled_off_grid` 等仍用旧尺子，P9.1b 重录时一并换。**不重录任何基线**（引擎未改）。
- **P9.1c 硬同步重启对齐** ✅ **v1.100.0 交付**（新增，由 P9.1a 的实测发现立项）
- **问题（P9.1a 实测）**：硬同步的 `−60 dB` 验收**不是稳定属性**。同一个持续音内连续 8 个 4 s 窗，BH-7 尺子给出 `−109.2 / −36.5 / −48.3 / −56.3 / −105.3 / −111.5 / −117.0 / −36.1 dB`（旧尺子同样波动：`−30.5 … −68.7`）。也就是说门禁/文档里的 **−68.7 dB 只是抽到了好窗，坏窗可达 −36 dB**；8 次全新 `gs_init` 场景的离散度 63–82 dB，稳定块数 200→400→800 都不解决。
- **根因（P9.1c 定量）**：不在「主振相位漂移」——DaisySP 在 P6.2b 已把 `phase_` 与 `phase_inc_` 都改成 double，且主振重启的整周位置**精确**（`xm` 小数部分每 11 次重启逐位复现）。真正的原因是 **`sync_kernel` 跨过 BLEP 残差自身的跳变做线性插值**：`g_blep` 表是「带限阶跃 − 朴素阶跃」的残差，在 `d=0` 有真实跳变（`i == GS_BLEP_OFF` 那个节点是右极限）；当查询落在 `d∈[−1/64,0)`（即重启亚样本位置 `xm` 撞进样本边界前最后一格）时，插值取错边，给出**反号、近乎满幅**的修正 → 每次重启 1 个过采样样本被整级错修，残余爆到朴素锯齿水平（−33 dB）再回落。触发量是主振增量的 f32 量化（`f*(1.0f/sr)`），它让 `xm` 缓慢走进那一格。消融：`minc` 换精确 double → 爆发消失；主振初相扫描的坏点**精确对应 `xm≈0`**；从振初相**完全无影响**；只杀任一 BLEP 都退化到 −26…−34。
- **修复**：`sync_kernel` 对跨跳变那一格（`!slope && i == GS_BLEP_OFF - 1`）补上连续带限阶跃与残差之差（`v += f`），BLAMP 连续、不受影响。代价 **+196 B/核 wasm**。
- **验收结果**：新尺子下三种波形 × 四个比值 × 36 s 逐窗扫描，**12/12 场景、396/396 窗全部 ≥ −60 dB**（最差 **−88.1**，余量 ≥28 dB；改前最差 −33.2、37 窗里 19 窗超标）。时域：周期相关 0.9988…0.9999、峰值 ≤0.136、最大相邻步进 ≤0.129、无 NaN；同步关闭逐位不变（三条红线逐字复现）。**`≥30 s 离散度 < 3 dB` 未完全达到：只有 triangle×1.7/2.0/3.3（0.2–0.8 dB）满足，锯齿/方波为 4.3–16.4 dB**（16 次连续 `note_on` 离散度 18.8 dB，改前 84 dB）。这是 2× BLEP 在 −100 dB 底上的位置相关残余，**不是旧爆发**；要压到 <3 dB 需要更高过采样或重做核，登记为技术债。`44.1/96 kHz` 的包络周期**未定量**（48 kHz 的 ~24 s 与「11 值星形旋转一格 = 24.1 s」吻合，但同模型给 44.1 kHz 31 s / 96 kHz 12 s，实测 21 s / 6 s，对不上）。
- 输入材料：`/.tmp/hard-sync-drift.md`（P9.1a 的原始窗序列、两种尺子对照、拍频/比值消融）；结论已折进 `docs/notes/hard-sync-aliasing.md`（「已知缺陷」已升级为「已修复 + 新验收 + 技术债」）。

**P9.1b 普通振荡器带限** ✅ **v1.102.0 交付**（真收益，主批）——按报告 `方案 B`：把硬同步已有的「朴素波形 + BLEP/BLAMP + 95 抽头抽取」复用到**普通锯齿/方波/三角**（正弦/波表/采样保持原路径）。**实测远好于离线预测**（预测 −63…−80 dB）：

| 波形 | 改前最差（3520 Hz） | 改后最差 | 逐格（55…3520 Hz） |
| :--- | ---: | ---: | :--- |
| 锯齿 | −37.4 | **−100.8** | −119.3…−100.8 |
| 方波 | −39.0 | **−111.3** | −119.1…−111.3 |
| 三角 | −49.4 | **−72.9** | −118.1…−72.9 |
| 正弦 | −119.1 | −119.4 | 不回退 |

- 代价：振荡器 **1.44×/1.98×/2.28×/2.55×**（1/4/8/16 声部，落在预期的 2–3×）、单声部延迟 **23.5 样本**（旧路径已补偿）、dist **1677.6 → 1683.0 KB**（阈值 1678 → 1684）、最大 wasm gzip **69.4 → 71.2 KB**（阈值 70 → 72）。整链 16 声部 p50 260 → 1169 µs（9.8% → 44%）、p99 92%。
- 基线**显式重录**：81/81 预设指纹全变（`--reason` 已写入）；`test:dsp` 0.030806 → 0.030735、`verify:dsp:2x` 0.030946 → 0.030852（**注意：后两者变化在脚本 1e-4 容差内、旧基线本来也会过，是形式重录；真正 gate 住音色的是 81 条指纹与收紧后的 `verify:audio` 阈值**）。kind = `sound`。
- 过程中发现并修掉三个真 bug：`PhaseInc()` 单位错导致普通路径**整体高一个八度**（会伪造出假的 −100 dB）；复用了 P9.1c 的 BLEP 跨跳变修正；`scripts/bench.mjs` 的计时门禁因 `mean > 450 µs` 启发式而**静默失效**（引擎变重后被误判成宿主过载，门禁只跑正确性就打 PASS），已换成与 DSP 无关的 `cpuProbe()` + `p50 < 60%` + 超标比例 ≤2%。
- 门禁：地板断言阈值按新实测**收紧**到 三角 −68 / 锯齿 −95 / 方波 −105；P9.1a 的「8 次逐位相同」断言在带限路径上语义不再成立，改写为「8 个全新场景离散度 < 20 dB」（实测 7.26/4.65/0.61 dB）。Rust 侧旧尺子（精确 bin 相减）已换成与 wasm 同构的 BH-7。
- **不做**（报告 `方案 D`）：不要为 −84 dB 正弦去改振荡器/限幅器（伪影）；不要在 DaisySP 已带限输出上再叠 BLEP（已两次失败）；不要改用现有波表替代（n81 −44.4，n91+ 更差 −32.9/−30.1/−26.7）。
- 方案 C（4 点 polyBLEP，+10…15 dB）单独不够，只在 B 之后作为补强考虑。
- 完整记录见 `docs/notes/band-limited-oscillators.md`。

**P9.6 滤波器共振 × 新振荡器的交互** ✅ **v1.112.0 交付（但计划的前提被实测否掉，真因是 BLEP 查表舍入）**
- **计划的前提不成立**（本批最重要的结论，配对实测、真 wasm；初相 = `note_on` 序号，`gs_init` 不复位相位计数器）：
  第 53 次 `note_on` 在工厂滤波 res 0.05 下 **−43.9 dB**，**把 res 改成 0 仍是同一个坏点 −44.5 dB**，res 0 的 150 场扫描**同样 1/150**；
  同初相换 **sine**（滤波/cutoff/res 全同）→ **−121.7 dB 干净**；comb（近似纯延迟）与 HP 20 Hz **照样有坏点**。
  ⇒ **既不是共振也不是滤波器**；计划里「`res=0` 时 150/150 干净」是**换相位序列后的运气**；候选解 **(1) 改工厂默认 res 与 (2) 起音斜坡都修不掉它**（用户对这两条的授权**因此没有使用**：工厂默认仍是 0.05，没有为此改动任何音色）。
- **真根因**：P9.1b 带限振荡器 `sync_emit` 的 BLEP 查表。表游走 `t += GS_BLEP_R` 是 **f32 累加**，`t ≈ 4096` 处 ULP = **4.88e-4**；当真位置落在节点下方半个 ULP 内（触发窗 `xw < ~2e-6`）时，累加把它**向上舍入到正好 `GS_BLEP_OFF`**，于是 **P9.1c 修的 `i == GS_BLEP_OFF - 1` 分支不再命中**，该抽头读到跳变的**右**极限 `tab[OFF] = −0.498` 而不是**左**极限 `+0.502` ⇒ **一个抽头满幅错修**。直接证据：把该声部**裸振荡器**（临时导出）取出，坏点上**单样本阶跃 1.906**（正常包裹 1.071）、波形越界到 **−1.45**；用引擎精确 inc 的 JS 复刻**逐位复现**同一坏点。
- **修法**（`crates/synth-core/c_bridge/gs_daisy.cpp`，一次无符号区间判断保住热路径）：跳变分支改为 `if (jumped && (unsigned)(i - (GS_BLEP_OFF - 1)) <= 1u)`，其中 `i == OFF-1` 走 P9.1c 的 `v += f`，`i == OFF` 且**精确判定在跳变左侧**（`t0_exact + R*k < OFF`，double）时 `v += 1.0f`。**用严格小于**是关键：第一版写成 `<=` 会误伤每个 `x == 1`（其第 32 抽头正好落在节点上），150/150 场景掉到 −31 dB，已否掉。
- **结果**：res 0.05 **1/150 → 0/150**（最差 −110.4）；res 0 同样 **1/150 → 0/150**（−111.1）。**逐位证据**：触发相位（#53、#707）的 4 s 渲染 sha256 改变，非触发相位（#54/#100/#239/#390）**逐字节相同**。
- **没有重录任何基线**：`test:dsp` **0.030735**、`verify:dsp:2x` **0.030852**、81 预设指纹 1×/2× 全部 **unchanged · ABI 8**——没有任何预设渲染命中触发窗；因此也没有走 `--reason` 协议。P9.1b/P9.1c 余量逐字相同（锯齿最差 −105.3、方波 −111.1、三角 −73.1、正弦 −117.8、硬同步 −91.7 dB；8 场离散度 8.79/3.97/0.21 dB）。
- **确定性门禁**（`scripts/verify-audio.mjs` 新增 P9.6 节）：相位钉成**绝对种子 707**（用「每块一次释放」把 `noteOns` 计数器走到它，对上游场景数免疫），并断言时域步进（`P96_STEP_BOUND = 0.13`，实测 0.1061）。自证：把分支改回去 → `phase 707 reads -44.8 dB` + **`[audio] FAIL`**；改回 → `-112.4 dB` + PASS。
- **P9.1c 的姊妹案例**（已写进 `docs/notes/hard-sync-aliasing.md`）：P9.1c 修的是 `OFF-1`（斜坡侧），本批补 `OFF`（f32 舍入到节点那一侧）。教训单独记一句：**用「换一批随机初相」验证密性修复，会系统性漏掉这种窄窗 bug**（窗宽 ~2e-6、约 1/150），必须把已知坏场景钉成**确定性**断言。
- **留待慢轨**：本批改动是「1 次无符号比较」替代「1 次相等比较」，但两次 `verify:bench` 都撞上宿主负载（load 3.69 时 IR 路径假红 77/2250、load 6.0 时计时被跳过），**没拿到安静主机上的干净判定**——由全面回归扫描去确认（对照 P9.1b 的 p50 1169 µs / 44%）。

**P9.7 波表/采样高音区带限修到接近 −60 dB** ✅ **v1.113.0 交付（波表超额达标；采样部分见边界登记 §一.16）**
- **波表：−25.8…−46.7 dB → ≥1 kHz 最差 −98.0 dB**（vocal 从 −25.8 → **−104.8**；organ/hollow/metallic/glass 与导入单周期锯齿全部 **≤ −98.0**），目标 −60 被超出 38 dB。
- **关键洞察（推翻了本计划的直觉）**：「把最短 level 加长」**反而更差**（离线实测 −8.2…−9.2 dB），因为 level 是按**自身表长**带限的、`h/N` 一直顶在 Nyquist（P9.5 那个 1/N² 扫描固定了谐波数才成立）。正确修法是**每个 level 都读成全长 2048 点表、只按八度降低谐波上限**：C8 选中的 level 只装 4 个谐波却有 2048 点，读步进仅 0.087 个表采样。代价：arena 余量 **−280 KB**（4655 → 4375 KB，≈5 张表 ×56.3 KB）、`gs_init` **3.82 → 12.06 ms**（一次性建表，best-of-9；不影响启动预算，实测 perf `[boot-budget]` 546 ms）。ABI 未动、零分配不变、无新参数。
- **采样**：`ReadState.position/direction` 与 `render` 的步进改 **f64** + 线性 → **4 点三次 Lagrange**，实测 **−29.9 → −33.4 dB**（note 84/96/108 = −40.3/−36.9/−33.4）。f32 那层的证据：同一内容换 f64 后最强线整批换频率（22882.x → 22883.x Hz），即那些线就是 f32 累加的量化误差。**到 −60 的代价已量化并登记为边界**（§一.16）：若要硬做，上限 4 s 样本需要 ≈18 MB ≫ 8 MiB arena。
- **P9.1b/P9.1c 余量逐条原值**：saw −89.5、square −155.6、pulse −156.7、三角/锯齿/方波键盘扫描 −73.1/−105.3/−111.1、硬同步 12 场景 −91.7…−116.2、P9.6 钉相位 −112.4、正弦 −117.8；**wavetable@C7 −130.0 → −153.9、导入锯齿 −128.9 → −158.1（变好）**。
- **门禁收紧 + 第二把尺子升级**：顶棚从「修复前实测 +5 dB」改成「**修复后实测 +5 dB**」（波表 −95…−90、C2 行 −100…−84、采样 −28）。第二把尺子从矩形窗换成 **Hann 窗 Goertzel 打在谐波空隙**（9000/9200/9500 Hz，实测 −168…−184 dB，断言 <−150 且 BH-7 <−95）——**教训**：地板从 −30 压到 −100 dB 后，矩形窗自己的 1/bin 旁瓣（每 bin 约 −13 dB 泄漏）已经不够用了，是**换尺子**而不是放宽阈值。时域：峰值 ≤0.125、步进 < π×峰值、正控 1.078 > 0.289。
- **基线**：指纹 1×/2× 各 81 条按 `--reason` 协议重录（理由串原文写在两个基线里）；**真的变的只有 4 条**（wtglass 2.604/2.796、wtmetal 1.175/1.940、wtvocal 0.838/4.083、wtorgan 0.793/0.839 dB），其余 77 条 ≤0.0090 dB（重编译噪声）。**`test:dsp` 0.030735 与 `verify:dsp:2x` 0.030852 未变 ⇒ 未重录 DSP 基线**（默认音色是锯齿，不走波表）。
- **体积**：两核 wasm **raw +3 702 B**（SIMD 216239→217198、scalar 200065→202808），dist **1564.4 KB**；阈值已按记账式 rebase **1562 → 1568 KB**（见 §四 与 `verify-budget.mjs` 注释：增量全在 raw、gzip 只 +0.1 KB、首屏 JS/CSS 逐字节未变），**下一批要体积的必须买回**。
- **自证两条**：①把 level 回退成短表（`from_recipe` 抽取版）→ 5 张高音行 + 5 张 C2 行 + Hann 探针（−96.3 > −150）共 11 条红、`[audio] FAIL`；且**导入单周期那行仍 −101.8 绿**（反证两条路径读数真实）；②vocal 顶棚 −95 → −105（严 0.1 dB）→ 红。均还原后 PASS。
- **快轨门禁**（未跑全量 `npm test`/fuzz/bench/E2E，按要求）：`verify:audio` PASS（133 项 ✓）、`verify:presets`/`:2x` 81 unchanged · ABI 8、`cargo test` 225 passed、`test:wasm` PASS、`verify:budget`/`verify:dist` PASS、`lint`/`typecheck` PASS。

**P9.8 扩 arena + 采样路径修到接近 −60 dB**（新增，P9.7 的采样续批；**用户 2026-09-14 拍板「扩 arena」**）
- **输入**：P9.7 的量化（§一.16）。要修的是采样表长——每级 ×12–13，门禁样本总链 ≈2.5 MB、1 s ≈3.4 MB、**上限 4 s ≈18 MB**。
- **必须「按需增长」**：arena 容量是**上限**，实际占用随导入样本长度增长（短样本不吃满）；**音频线程零分配不变**（`gs_alloc_violations()==0`，表只在 import/init 建）；**装不下时优雅拒绝 + 可见原因**（中英成对），**不许静默截断成错音**。
- **必须如实评估的既有约束**：`test:wasm` 的零分配、`bench --long` 的 `wasm memory < 32 MB`、`gs_arena_free_bytes` 读数，以及**对低端设备（手机）内存的含义**。
- **门禁**：采样那几条顶棚**收紧到本批实测 + 余量**；保留两把独立尺子（BH-7 + Hann 窗 Goertzel）、确定性、真 wasm、时域 Bernstein 上限。
- **自证三条**：表长回退 → 红；顶棚再抬高 → 红；**超限样本的拒绝路径 → 优雅拒绝 + 可见原因**（不崩、不静默）。
- **体积**：扩 arena 很可能让 wasm raw/gzip 上涨 ⇒ **涨了先报我**，别自行调阈值。

**（历史）P9.1 原条目**
- 要点：按正在进行的归因（限幅器峰值检波的增益调制 / 音高量化 / 波表插值 / 振荡器带限 / 过采样器旁瓣 / 测量伪影）做定点修复。若是限幅器：评估 lookahead 或更慢释放；若是音高/参数平滑：提高内部精度或分离控制率与频率。
- 验收（频域）：普通**锯齿/方波/三角**在 110/220/440/880/1562 Hz 的**非谐波能量 ≤ −60 dB**；**正弦对照不劣化**；硬同步在 1.7/4.3/7.1/11.3× 也 ≤ −60 dB。验收（时域）：峰值/最大步进/周期相关不回退。
- 门禁：`verify-audio` 加分音高断言（现有稳定度量：整秒 + 矩形窗 + 精确 bin + Parseval）；Rust 单测留最小回归样本。
- 风险：若改动落在限幅器/增益路径，**所有音色的响度与削波行为都会变** → `tests/dsp-baseline.json`、`tests/dsp-baseline-2x.json` 与 81 个预设指纹必须显式重录，并附「为什么变」的说明；这一类基线更新必须由我确认。

**P9.2 瞬态整形（P6.4 的第三件）** — ✅ v1.98.0 完成
- 已做：`fx_shaping.rs` 的 `TransientShaper`（整流后 200 Hz 两极点平滑 + 60 Hz 快包络 + **4 Hz 慢包络追快包络**，起音取前导半、延音取后拖半，增益 `2^(dB/6)` 用 `exp2`、硬夹 `[0,8]`）；参数 id **179–182**（ON/ATTACK/SUSTAIN/MIX，`PARAM_COUNT 183`），每节点 `transients[6]` 状态、零分配；接入信号链与路由图两条路径；UI 进 FX2 strip 与节点内联，i18n 中英。
- 实测（Rust 210 passed 含 4 条新测；真 wasm 门禁 7 项全绿）：attack=**±0.5 → +2.99 / −2.97 dB**（引擎级；wasm +2.87/−2.86）、sustain=±0.5 → **∓2.9 dB**（wasm −2.29/+2.33）、**MIX=0 与中性（on=1, amt=0, mix=1）都与空槽逐位相同**、持续音 **THD 增量 0.00**（断言 ≤0.5 点）、猛拉三参数有界（峰值有界、最大步进 <0.5、无 NaN）。
- 预算是本批的一个决策点：dist 实测 **1674.0 KB** 超过 P8.5 收紧后的 1672 KB（+2.5 SIMD wasm / +2.3 标量 wasm / +1.4 JS），按预算文件里「下一批要回来申报交易」的规矩**显式 re-base 到 1676 KB**（注释写明由 **P11.1 `wasm-opt -Oz`** 买回）；其余三条阈值未动（最大 WASM 现 69.8/70 KB，留给 P11.1）。
- 验收：完整 `npm run verify` 绿（我独立复跑 `test:rust` 210 / `npm test` 391 / `test:dsp` 0.030806 / `verify:presets` 81 unchanged 全部一致）、E2E `fxgraph.spec.ts` 含新用例「放一个瞬态整形节点、重开保持」通过。

**（历史）P9.2 原条目**
- 要点：`Transient{attack_amt, sustain_amt, env}` 进节点池（照 P6.4 的 BitCrusher 模式），UI 进 FX2 与路由图节点内联。
- 验收（时域）：attack 段增益提升/削减量（dB）与设定一致（±1 dB）、无爆音、有界；干湿为 0 **逐位直通**。验收（频域）：不引入新谐波（THD 增量 ≤ 0.5%）。
- 门禁：成本增量 ≤ +10%（`verify:bench`）；参数 id 从当前最大 +1 起。

**P9.3 每节点效果参数** ✅ **v1.103.0 交付**
- **做法**：`fx.ovr[node][slot]`（6 节点 × **4 槽共享池**）+ 哨兵 `FX_OVR_UNSET = -2.0`。**槽位含义由该节点当前的效果种类决定**（delay=time/fb/mix/damp、reverb=size/mix/damp/predelay、crush=bits/down/aa/mix、eq=低/中/高增益+中频、drive=量/混合，chorus/flanger/phaser/transient 各 3 槽），所以没有「种类 × 节点」的爆炸。id 净增 **41**：24 个覆盖槽（183–206）+ 8 个调制 target（207–214）+ 8 个 depth（215–222）+ 1 个 src（223），`PARAM_COUNT` **183 → 224**（四处同步：`params.rs`/`params.ts`/`worklet-processor.js`/`i18n.ts`；33 连续 + 8 离散）。
- **逐位不变**：未覆盖时 `stored == UNSET ⇒ 直接返回种类值本身`、无调制时 `scale == 0` 不做任何乘加。断言原文：`expect(worstDiff(plain, sentinel), 'an unset slot changed the render').toBe(0)`（`fxgraph.test.ts`）+ Rust `node_overrides_are_bit_exact_until_set` 用 `to_bits()` 逐一对照。**三条红线一字未动**：`test:dsp` 0.030735、81 预设指纹、`verify:dsp:2x` 0.030852。
- **图内调制**：新增 **8 条覆盖调制总线**（每条 = 1 target 指向 24 槽之一 + 1 depth），共用 1 个源码（0/LFO1/LFO2/ENV，与 P7.2 同一套）；同一 `(node,slot)` 被多条命中时求和后夹 ±1，**可同时调制 8 个覆盖槽**；与 P7.2 的 4 条边**并存不挤占**，老图两者全 0 逐位不变。落在计划写的「先只暴露常用 4–8 个」内。
- **携带**：分享码按 id 升序位置化、新 id 追加在末尾 ⇒ **旧码仍可读**（新 id 落回哨兵，已用手工构造的旧长度码断言）；`.gs1song` 同路径；图模板白名单扩了 24 个覆盖槽，**仍不含** `FX_REVERB_MODE`/`FX_CONV_TRIM`，也不含总线 target/depth/src（调制不是路由）。**换种类语义（本批裁定）**：槽位**保留数值、按新种类的含义重新解释**（切回原种类不丢设置），读时按新种类区间夹取；Rust 与 TS 各一条测试钉死。
- **验收结果**：链上两个 delay 的四个 time×fb 组合两两可区分（`worstDiff > 0.001`）且各自重渲染逐位相同；E2E `e2e/fxgraph.spec.ts` **16 passed**（含新增的「覆盖一个节点不影响同类兄弟」与 390×844 手机 36 px 目标）；`npm run verify` exit 0（bench 真判定）。
- 体积：dist **1683.9 → 1710.2 KB**（阈值 1684 → **1711**）、最大 wasm gzip **71.2 → 73.1 KB**（阈值 72 → **74**）。记账式 rebase，注释写清增量构成，并更正「P11.1 只能买回 dist（raw），买不回 gzip」。
- **顺带修好的三个既存 bug**：① `.fxg-card-title` 在 Chromium 上高度为 **0** ⇒ **卡片拖拽从来没生效**（补 `min-height`/`display:flex`）；② 覆盖槽的 AudioParam 量程原定 −2..4，会把 8000 Hz / 16 bit **夹成 4** ⇒ 放宽到 −2..8000 并加守卫测试；③ 两条 E2E 的固定像素几何被更高的卡片顶出视口 ⇒ 改成按视口判定（不是放宽断言）。
- 遗留（登记，不阻塞）：某效果只有 3 个可用槽时第 4 槽是空的（渲染忽略、UI 不显示），但总线仍能指向它（空转）；图模式的逐节点 PDC 归 **P9.4**。

**P9.4 图模式过采样（逐节点 PDC）** ✅ **v1.106.0 交付**
- **做法**：`node_oversampled(kind) = Drive`（CRUSH 同类未开；线性节点只补偿不上采样）。节点索引即拓扑序，单次前向解 PDC：`lat(v) = max(max_输入边 lat(src), own(v))`、`M = max_v lat(v)`、**每条边的权重 `w = M − lat(src)`**（因此「干声源→输出汇」这条不经过任何 2× 节点的直通支路也必被延迟 M），总延迟 = `OS_LATENCY + M`。每条输入边独占一条 31 样本历史（不能原地延迟节点缓冲）；干声总线共享、每块只按最大权重延迟一次，节点边只补差值。
- **踩过的坑（值得记住）**：第一版把 2× 节点的往返**算了两遍**（既在节点内部的干/湿对齐里，又在 PDC 的输入权重里）⇒ 干腿 +62 / 湿腿 +31 ⇒ `blend_node` 做 31 样本错位交叉淡化 ⇒ **图模式 2× 的混叠比 1× 还差 25 dB（−33.0 → −7.1）**，而链模式同代码是下降 26 dB。误判方向是「问题在节点之后」，因为**把真机的节点输入喂回两条路径时二者逐位相同**；真正的线索是**节点混合后的输出**——往返正确、混合错误，就一定在「节点内部对齐」或「输入的额外延迟」上，而往返只能算一次。
- **验收结果（真 wasm，note 45、1 s、精确 bin / BH-7）**：

  | 场景 | 1× | 2× | 变化 |
  | :--- | ---: | ---: | ---: |
  | 链 DRIVE | −33.43 | −59.55 | **−26.12 dB** |
  | 图 DRIVE（修前） | −33.43 | −33.43 | 0.00 dB（门禁读 −7.1） |
  | 图 DRIVE（修后） | −33.43 | **−59.54** | **−26.11 dB** |
  | 图 + 并联 EQ 支路 | −33.52 | −58.94 | −25.42 dB |

  时域：**图 2× vs 链 2× 互相关 1.000000 / 0.999983 at lag 0**（最强证据）；图 2× vs 图 1× 为 0.998292、**最佳 lag = 62 = 上报延迟**（链的同一比较也是 0.998292 ⇒ 0.998 是「1× 硬驱方波 vs 2× 带限方波」的物理上限，不是对齐误差）。**延迟上报**：开关开且图 2× 活跃时 **62 样本 / 1.29 ms**；`graph_latency()` 报图自身份额。
- **逐位不变**：图模式 1× 与链模式 1× 的 wasm **sha256 改前 = 改后**；三红线一字未动（`test:dsp` 0.030735、81 指纹、`verify:dsp:2x` 0.030852）。
- 成本：整链 16 声部 p50 **1099 → 1325 µs（1.21×）**（只有 DRIVE 节点跑 2×）；体积 dist +5.0 KB、最大 wasm gzip +0.6 KB（阈值 1533→**1538**、74→**75**）。
- **既存边界（A/B 确认不是本批引入）**：图 patch 上 switch/驱动量急变的最大相邻跳变 **1.8088827（v1.105.0 无 P9.4 代码）** vs 1.795138（含 P9.4）——是声部滤波路径自己的 31 样本往返在硬驱方波上换挡。
- **发现但未修的既存 bug（登记）**：`graph_param_field` 的 `base <= id < base+FX_SLOTS` 让节点参数区与其它参数编号**重叠**（`FX_NODE_OUT_GAIN+1 == FX_DELAY_MIX`、`FX_NODE_TO_OUT+5 == FX_PARALLEL3`、`FX_NODE_IN1+5 == FX_EQ_ON`），后果是**宿主无法把 6 个节点全部清干净**（JS 探针出现「节点 2 读节点 1」的双驱动；Rust 走内部 API 不受影响、两把尺子的**差值**也不受影响）。修它要动参数编号（红线级），留给后续批次。

**P9.5 波表/采样带限复核** ⚠️ **v1.111.0 交付，但验收线未达标（已登记，修法需独立批次）**
- **结论：计划写的「≥1 kHz 波表与采样音源非谐波能量 ≤ −60 dB」没有达到。** 用**同一把** P9.1a BH-7 尺子（4 s 整窗、精确 bin、每谐波 ±8 bin、清调制矩阵、参数块用 `renderFloor` 钉死、真 wasm）实测：工厂 5 张波表 **−25.8…−46.7 dB**（最差 vocal @C8 = −25.8），用户导入单周期锯齿 −31.2，采样 **−29.9…−31.0**。同尺子下正弦对照 **−117.8 dB** ⇒ 这 80 dB 不是尺子的账。两次运行逐字节相同。
- **归因不是「表没带限」，而是线性插值**（4 条独立证据，全在 `docs/notes/band-limited-oscillators.md` 的 P9.5 节）：①最强离格线正好落在 `48000 − k·f0`（C7：4047=48000−21f、6140=48000−20f、8233=48000−19f…）；②**独立 JS 复刻**只有读表算法，读出**同一批线**（频率逐 bin 相同；引擎更低只是 18 kHz 低通在衰减）；③同内容**表长扫描** 16→2048 点：−24.4/−34.0/−46.4/−58.5/−70.6/−82.6/**−106.6** dB（≈12 dB/倍长 = 线性插值的 1/N²；最近邻 −10.4、4 点三次只 −30.4）；④**第二把独立尺子**（C7 的 4 s 恰为 8372 个整周期 ⇒ 矩形窗 + 精确 bin + Goertzel，无泄漏）−30.1/−37.5/−32.7，与 BH-7 差 **≤0.2 dB**。采样另有独立一层：`state.position` 是按 level 采样数计的 **f32**（对波表的 `phase∈[0,1)` 粗约 10⁴ 倍）⇒ 以 loop 重复率为间隔的边带（整段 ±8.2 Hz；f32 复刻 −35.2 与引擎逐 bin 相同，f64 复刻 −44.7 且边带消失）。出厂波表 5 张（`OSC1_PW` 选 recipe）逐张测；**出厂无采样内容**，用 `gs_sample_import` 确定性导入 32768 点 / 256 个 375 Hz 周期 / 谐波 1..48 幅度 1/k、loop 取整周期（无缝）。
- **本批做了什么**（0–1 批，**没有为凑改动去改 DSP**）：在 `scripts/verify-audio.mjs` 加 **P9.5 小节**（真 wasm、确定性），阈值取**实测最差 +5 dB 顶棚**（organ −26 / hollow −28 / vocal −21 / metallic −25 / glass −28 / 用户表 −26 / 采样 −25），**注释与 check 文案都写明「这不是 −60 及原因」**；顺手把 `SMP_LOOP_START/END` 补进手写 `P` id 表。时域另断言峰值有界、无 NaN/Inf、最大相邻步进 < `π×峰值`（Bernstein 上限），并有**正控**（打一个 +1.0 采样必须越界：1.078 > 0.289）与「把采样 root 设 A4 ⇒ 尺子读 −0.0 dB ⇒ 红」的标定。
- **自证**：①把 vocal 顶棚临时改成 **−60**（即计划验收线）→ `✗ … worst -25.8 dB, ceiling -60` + `[audio] FAIL`——**这同时就是「未达标」的直接证明**；②采样顶棚改 −35 → 红；③喂不合规内容 → 红。三次 `diff` 还原为逐字节相同后重跑 ⇒ PASS。
- **本批未改任何 app/runtime 代码**：两个 wasm 与 v1.110.0 的发布包**逐字节相同**（`ec1bb7b6…` / `15807e44…`），dist 1559.3/1562 未动，三条红线一字未动（`test:dsp` 0.030735、`verify:dsp:2x` 0.030852、presets 81 unchanged · ABI 8 ×2）。**这解释了为什么现存的** §3c、§5 与 Rust `an_imported_cycle_is_band_limited_at_a_high_pitch` **仍绿**：它们用的是半整数点旧尺子，读不到这些折回来的线（已在文档里点明，改它们的阈值属于改现有断言，留给修法批次）。
- **后续（需用户拍板，已登记为债 §一.14）**：修到 −60 只有两条路——选**更长 level** 或换**更好插值器**——**都会改变音色并要重录全部 81 条预设指纹**（相容红线级），所以不放进本批复核里。

### P10 · 创作与工作流二期

**P10.1 时间线多选编辑** ✅ **v1.107.0 交付**
- **选择集语义**（纯模块 `src/midi/selection.ts` + 23 条单测）：点选清空后选一、**Ctrl/Cmd+点**切换、**Shift+点**按 `(start, pitch)` 矩形与已有选择并集（anchor 不变，可连续扩）、**空白拖拽框选**（用 `.roll-grid` 的**实时 boundingRect** 换算，滚动/缩放都参与，单测用滚动过的 box 断言同一 client x 从 0 拍变 10 拍）、`Ctrl/Cmd+A` 全选、`pruneSelection` 在文档变化时剔除已不存在的 id 并恢复文档顺序。框选矩形用 ref 跟随 pointermove（不触发 React 重渲染）。
- **批量编辑，每次恰好一个撤销步**：移动（整组同一 delta，`clampSelectionDelta` 按整组夹取时间/音高，相对关系严格保持）、复制/粘贴（新 id、副本成为新选择集）、删除、**缩放到同一结束拍**（拖任一选中音符的右边缘）、量化、力度。手势期间 `commitLive` 不记历史，pointerup 由 `settleGesture` 从拖动前文档重放 → 一步。单测逐条证明「恰好一步」（含「两次 undo 精确回退」「第一次 undo 后 `canUndo` 仍为 true」这类边界）。
- **跨层拖拽：选「明确禁止 + 可见原因」**。理由与 P10.3 的 clips×take 同源：层自带 take 历史与片段编排、`MidiClip` 没有 per-layer 链接，搬层只能静默丢语义或改写源层。多层曲目里竖直拖超过 2 行 → toast「跨层移动暂不支持…换层请先把音符复制到该层」（中英成对），拖动留在本层、层选择器不变、**不丢音**；单测断言层 0 批量移动后层 1 逐字段不变。
- **键盘**：←/→ 一格（`roll-snap`，默认 1/16 拍）、↑/↓ 一半音、Shift+↑/↓ 一个八度、Ctrl/Cmd+方向键 0.125 拍/1 半音（给不在网格上的组）；Delete、Ctrl+A/C/V、Esc（有选择时先清选择、再按才关闭）；每次方向键=一个撤销步（长按得到可逐步回退的历史）。
- **手机**（390×844）：工具栏「多选」开关（点音符累加、点空白清空）；未开多选时**空白拖拽也能框选**；选择条含计数 + 四向微移 + 复制/粘贴/量化/删除/取消，`pointer: coarse` 下所有按钮**双向 ≥36 px**（E2E 实测断言）、面板无横向溢出。
- 验收结果：`npm test` **437 passed（56 文件；新增 30 条）**；`e2e/roll.spec.ts` **18 passed**（原 12 条一条没破 + 新 6 条：框选后拖整组、Ctrl 多选+一次删除+撤销、Shift 范围、键盘移动/复制/粘贴/清除、选择条批量、手机多选+批量条）；takes/clips/fxgraph/oversample **22 passed**；`npm run verify` exit 0（bench 真判定）。
- 体积：dist **1536.8 → 1548.7 KB**（阈值 1538 → **1550**；`wasm` 保持 75、**逐字节未动**）。涨在 `PianoRoll` chunk +6.1 KB raw（框选手势/选择集管道/手势结算/批量调用/选择条）、`index.js` raw +~3 KB（20 组新中英文案）、`index.css` raw +~1 KB（框选矩形、选择条、36 px 粗指针目标）。
- 两个已处理的坑（写下来免得再踩）：Playwright 的 `click({modifiers})` 在本机**不会**把 ctrlKey 带进 `pointerdown`（E2E 改用 `keyboard.down('Control')`）；V8 的 `Math.max(-0.25, -0)` 返回 `-0` 且 `-0.25 > -0` 为 `false`（`clampSelectionDelta` 改成对正数量级比较）。
- 行为变化（记录）：Esc 现在「有选择时先清选择」，再按才关闭编辑器；检查器仍以最后选中的音符为主（起点/时长只改它，力度改整组）；粘贴固定落播放头（压住原件时 toast 提示，但副本确实存在）；多选时拖**左**边缘仍只改被抓的那个音符（右边缘才整组缩放）。

**P10.2 片段编排二期** ✅ **v1.109.0 交付**
- **① 片段内直接编辑**：入口就是既有的那条路（片段泳道与卷帘**共用一份文档** `rollSession`），所以 P10.1 的批量编辑直接作用在片段文档上，`commit` 一次 = 一个撤销步；**不去改源层 take**（`syncTakeFromLayer` 对已折叠层早退，既有语义，用测试钉住）。
- **② 跨层复制片段**：新增 `copyClipToLayer`（`start/length/repeat` 不变、音符逐个深拷贝）与 `foldClipsInto`（把整条时间线含 repeat/窗口裁切折成一个片段）。**音高映射故意取恒等**：`MidiClip` 存绝对 MIDI 音高，层决定的是**音色**不是音区，做移调会破坏本批被判定的「逐位一致」。两条路**结构性**汇到同一个 `clipFromNotes`，测试**两条都真跑**并断言 `toEqual`。
- **③ 片段模板**：`src/midi/cliptemplates.ts` + **工作区 `LayoutState.clipTemplates`**（照 P7.3 图模板：不进音色/分享码；理由是模板属于工作台而非某个作品）；`store.saveClipTemplate/deleteClipTemplate`，套用生成新片段。
- **逐位一致证据**：`expect(byHand.notes).toEqual(copy.notes)`、`expect(expandClips([byHand]).notes).toEqual(expandClips([copy]).notes)`，且两者都等于源层演奏；另用**带 repeat + 窗口裁切**的素材钉住折叠路（`expandClips([folded]).notes` 与折叠前逐位相同，替换源层编排后 flat 列表也逐位不变）。
- **不共享状态证据**：`expect(copy.notes).not.toBe(source.notes)` / `copy.notes[0]).not.toBe(source.notes[0])`（不是同一数组、不是同一对象），改副本不动原件、**改原件也不动副本**；模板更用「就地改字段」这种浅拷贝必败的形式断言（改 `first.notes[0].note` 后模板与第二份都不变）。
- **过程中修掉一个语义 bug**：折叠时把展开结果**多减了一次**源片段起点（`expandClips` 已是相对零、新片段又声明 `start`），音符会整体后移 0.5 s；现在是 `copyClipNotes(expanded, -from)` 并附注释。
- **撤销步**：片段内批量编辑 = 一步；**跨层复制 = 一个 app 级撤销步**（安排变更本来就走 `store` 历史，会话自己的 `past` 栈是音符编辑的——断言据此改用 `store.undo()`）；`fold()` 现在**也可撤销**（以前清空历史）。
- 验收结果：`npm run verify` exit 0（**链里已含 `verify:presets:2x`**）；Rust **225**、Vitest **449（57 文件）**、`e2e/clips + roll + takes` **24 passed**、`npm run test:visual` **10 passed**。
- 体积：dist **1549.6 → 1555.9 KB**（阈值 1550 → **1562**）；`wasm 74.2/75` 与 `CSS 20.2/21` 未动。

**⚠️ 同时修掉我（父代理）在 v1.108.0 发布时犯的一个错（记在案，教训在 `docs/notes/release.md`）**：发布 v1.108.0 时我为重做版本号跑了一次 `git checkout -- package.json`，把 P11.4 子代理**尚未提交**的脚本文案一起回退，于是 **v1.108.0 里 `verify:presets:2x`/`presets:update:2x` 丢失、`verify` 链里也没有 2× 预设立场门禁**——线上下载的包与 CI 里的 `npm run verify:presets:2x` 都对不上（CI 会红），而 `verify:ci` **当时报 PASS**（它只检查工作流文本，不检查脚本是否存在）。本批做了两件事：**(1)** 恢复四个脚本文案与 `verify` 链里的 `verify:presets:2x`；**(2)** 强化 `scripts/verify-ci.mjs`，让它**同时**校验「工作流文本里有这条命令」**且**「`package.json` 的 `scripts` 里真的定义了它」**且**「`verify` 链里点名了每个非 E2E 必需命令」，并做了自证（临时删脚本 → `[ci] FAIL … scripts["verify:presets:2x"] is missing`；临时从链里摘掉 → `[ci] FAIL — the "verify" script runs …`；还原后 `[ci] PASS`）。

**P10.3 录音 take 二期** ✅ **v1.104.0 交付**
- ① **重命名上 UI**：take 行内按钮/双击进入输入框，**Enter 提交、Esc 取消**，✓/✕ 手机可达；`renameTake` 是**一个撤销步**且写进 localStorage（单测断言 `store.undo()` 一次完整回退、空串/同名返回 false 且不落盘）。
- ② **A/B 试听**：行内按钮 + 键盘 `a`/`b`，**真的换播放内容**（E2E 断言 strip 音符 2↔3）且**保持播放位置**（`atB > 0.25`）、停止回 A 并 toast。
- ③ **合并策略可选**：`union`（并集，P5.4 原行为，默认）与新的 **`overwrite`**（同时间窗内更新的 take 覆盖旧的，边界相接算清空不算冲突），按钮 title 写明差异。**诚实的边界**：直线式 overdub（每遍都含上一遍）下两种策略结果相同，只有**分支历史**（回到旧 take 再录）才可区分；这是 take 模型的性质，已写进注释与 UI。
- ④ **clips×take 的语义歧义修掉** ✅——**选 (b) 明确禁止 + 提示**，因为数据模型**不支持** (a)：
  - `MidiClip` 字段只有 `id/name/layer/start/length/repeat/notes`，**没有 per-clip 的 take 链接**（`MidiSong` 只有歌曲级 `takeId`），`foldLayer` 连名字都取**层名**，`normalizeClips` 也只持久化这些字段；
  - 「音符相等」不是身份：overdub 可让两条 take 逐音符相同，且一层可有多个 clip（`foldLayer` 追加、`duplicateClip`），一条 take 无法确定重建哪一个；
  - **重建保不住用户编辑**：`resizeClip` 明确不重写内容、`clipWithNotes` 就是改 clip 音符，且窗口按整小节取整、`expandClips` 会裁掉越界音符——没有任何 dirty/generation 字段能区分「来自 take」与「用户改过」；
  - 代码里其实早就写死了这个结论：`syncTakeFromLayer` 对已折叠层直接 `return`（注释：其 clips 是计划，take 是素材）。
  - **原先的静默无效已被钉死**：`withTakes` 把 take 写进层后又 `withClips` 展开覆盖。新单测原文：`withTakes({...folded, takes:[B], takeId:'t2'}, [B], 't2')` 返回 `takeId==='t2'` 但 `notes===[60,64]`（clip 展开），B 的音一点没响。
  - **现在的行为**：折叠层的 take chip 带 `data-blocked`，点击 → toast「该层已折叠为片段：take 仅作素材，切换/合并都不会改变听感」且**选择与展开结果一字不变**；合并/A-B 按钮 `disabled` 且 `title` 同因；take 行下常驻可见提示；**改名仍允许**（命名是素材属性）；**在折叠层录音仍然保存该 take**（模型底线是不丢演奏），只在保存 toast 追加同一句提示。
- 验收结果：`npm test` **407 passed**（新增覆盖合并 vs 并集、边界相接、折叠层切换/重建、改名一撤销步、两策略产出不同、折叠层拒绝）；E2E `e2e/takes.spec.ts` **4 passed**（改名重开仍在、A/B 真换内容且保位置并停止回 A、两策略 4 vs 3 音、折叠层提示 + 拒绝）；`npm run verify` exit 0（bench 真判定）。
- 体积：dist **1711.4 → 1717.6 KB**（阈值 1712 → **1720**），**+6.16 KB 全是 JS/CSS、wasm 逐字节不动**（`PlayerPanel.js` +3521 B、首屏 `index.js` +1262 B（9 组新文案）、`index.css` +624 B、`recording.js`/`roll.js` 各内联一份 take-edit +513/+392 B）；首屏 JS gzip 133.5/134、CSS 20.1/21。
- 遗留（记录，不阻塞）：`take-edit.ts` 被 `recording.js` 与 `roll.js` 各内联一份（懒 chunk 重复，+905 B；要省应抽共享 chunk 而不是砍文案）。

**P10.4 工程管理（多套用户工程）** ✅ **v2.0.0 交付**
- **「工程 = 什么」**：`ProjectDoc = { state, layout, userPresets, currentPresetId, scenes, clips, currentClipId }`——整套音色 + 曲目/录音（含 takes/clips 编排）+ **布局里属于工程的那一半**（order/collapsed/view/flowPos/fxGraphPos/模板/调律…）。**不含**人/机器级设置（theme/lang/ccMap/`activeInstance`/midiOut/polyphony…），沿用 `scenes.ts` 的先例划的人机线。往返**逐字段相等**（`parse(serialize(x))` 与原 doc `toEqual`），并断言序列化文本里**没有** `activeInstance`/`theme`/`ccMap`。
- **键与迁移**：老键（`gs1:state:v1` 等）**完全不动**——活动工程就是这些键（启动路径/撤销/既有测试零改动）；新键 **`gs1:projects:v1`** 存列表 + 每个**非活动**工程的整份 doc（**活动工程的 `doc` 为 null**，这就是「它是活动工程」的标记）。读到更高 schema ⇒ 不半读，原文另存 `.newer`，本进程**只读**（所有写返回 `readonly`），绝不覆盖更新版本写的列表。文件格式 `{ format:'gs1-proj', schema:1, doc }`。
- **配额降级（写顺序就是安全故事）**：`switchTo/create/import` **先写列表、成功后才**替换活动文档 ⇒ 列表写失败时**内存索引不变、活动文档根本没动**，返回 `{ok:false,reason:'quota'}` + 面板红条「操作已取消（当前工作没有丢）」；列表写成功但活动文档写失败 ⇒ 目标 doc 留在列表里当**恢复副本**并报 `degraded`（提示立刻导出）；**导出只走内存、不写 storage**（配额单测里断言仍能导出）。E2E 用真把 localStorage 填满的方式验了这条。
- **损坏输入拒绝矩阵**（`parseProjectFile` 是 total function，永不抛）：`truncated` / `format` / `version` / `missing` 各自有可见文案；**局部**损坏则修复后接受（路由行丢、amount 夹取、参数键丢、非法 track/preset/scene 丢）。写操作另有 `quota`/`unavailable`/`readonly`/`limit`(24 个工程)/`missing`/`active`/`same`/`damaged`，且每个 reason **都有文案**（单测断言）。
- **体积**：**这就是 v2.0.0 把 `dist total` 从 1568 抬到 1595 KB 的那个功能**——`Projects-*.js` **18 428 B** + `Projects-*.css` **2 226 B** 是**懒 chunk**（由设置抽屉里一个 `lazy()` 行到达，`index.html` 不引用），`i18n-panels` +~2.2 KB，其余是构建 churn。**首屏 JS 只 +116 B（123.9 → 124.0 KB）**（删了 4 个全仓无调用的 store 方法抵掉 ~76 B）。注释里写明这条线是「仓库产物回归的绊线」而不是「访客下载量」——后者是 `initialJs`（124.0/125）。
- **自证**：①序列化漏 `scenes` → 往返单测红（贴出 `- "scenes": Array [ ]` / `+ "scenes": Array []` 的 diff）；②让配额路径假装成功 → **4 条红**。均还原后 22 passed。
- **验收**：单测 22（+7 文件 85 条相关）；E2E `e2e/projects.spec.ts` **3 passed**（两套工程内容真不同→切换→刷新仍在；5 种损坏文件逐个被拒且文案正确；把 localStorage 填满→新建被取消且当前音色未变）；`test:visual` **10 passed 且基线零变化**。
- 遗留（登记）：崩溃窗口（列表写与活动文档写之间进程被杀）无自动恢复；24 工程/8 快照的体量上限撞配额时走拒绝路径；`Projects` chunk 在设置抽屉**首次渲染**时请求（不在首屏引用里，但也不是「点击才请求」，若要改成后者约 +40 B 首屏字节）。

**（历史）P10.4 原条目**
- 要点：工程列表（重命名/复制/打标签/快照恢复）、导入导出 `.gs1proj`、配额超限提示与降级。
- 验收：单测（序列化往返、配额与损坏拒绝）+ E2E（建两套 → 切换 → 重开仍在）；首屏 JS 不增（懒加载）。

**P10.5 曲库按需与公版合规** ✅ **v2.0.0 交付（v2.0.0 里程碑那一批）**
- **合规是重点，而且清单比计划多出两首**：计划列的 7 首之外，本批复核又发现 **`croatian`（克罗地亚狂想曲，Tonči Huljić）与 `mario`（超级马里奥主题，Koji Kondo / Nintendo）也在版权保护期内**，一并移除 ⇒ **共 9 首**被移除/替换，替换为 5 首公版（Offenbach 康康、Grieg 山魔王、Brahms 摇篮曲、Tchaikovsky 糖果仙子、英格兰民谣 Scarborough）与 **4 首原创**（元数据写明 `original`，不冒充民歌）。仍 20 首。`tetris`（Korobeiniki，1861 民歌）与 `greensleeves`（1580 登记）**复核为公版**并保留。新增守卫：被移除的 9 个 id **不得回归**、每首 `kind ∈ {public-domain, original}` 且 `credit` 非空。
- **来源/许可标注**：`SongSpec.source = { kind, credit, url? }` → `Track.source`（随存储往返；磁盘脏值校验后替换为 `user`）。播放器**每一行**显示 `公版作品 · WoO 59` / `原创作品 · GS-1` / `用户导入 · <文件名>`，页脚换成版权说明。文案在**新模块** `src/i18n.library.ts`（这也是「并行开发时每条 UI 轨道自带 i18n 模块」的第一个实例），注册进 `loadAllStrings()` 并纳入 `i18n.test.ts` 的两向一致检查。
- **用户导入**：曲库 import 现接受 `.mid/.midi/.gs1song/.json`，按扩展名分流；**分因拒绝**（非 JSON / 格式不识 / 是音色文件不含曲目 / 分享码损坏），文件读取异常也被捕获。导入的 MIDI 带 `source:{kind:'user'}`。
- **按需加载**：按**技术债第 7 条**保持 eager、**不做假懒加载**，验收线是「首屏 JS 不增」——实测 `index-*.js` raw 271 260 → 270 116 B、**gzip 81 261 → 81 253 B（−8 B）**，首屏合计 123.9 KB 不变；`dist total` +1.2 KB。**如实说明**：raw 降 ~1.1 KB 是因为删掉的谱面数据够付新增 metadata + 懒 chunk + CSS，但 gzip 只降 8 B（新增的来源/许可字符串熵比被删的高度重复音符串高）。
- **自证**：①清空某曲 credit → `songs.test.ts` 红；②让损坏 `.gs1song` 被静默接受 → E2E 红（`Expected substring: "损坏"` / `Received: "已导入 琶音（练习） · 243 个音符"`）。均还原并复绿。
- **验收**：`npx vitest run src/midi src/i18n.test.ts` **160 passed**、`song-quality` 5 passed、lint/typecheck/build/budget/dist 全绿、E2E player+export 通过、`test:visual` **10 passed**（48 张里**只有 4 张 `player-*`** 因新来源行+页脚变化，已重录并记因）。
- 遗留（登记）：`PresetDrawer` 的 `<input accept=".json,application/json">` 仍选不中 `.gs1song`（既有缺陷，现在 `.gs1song` 可走曲库入口）；`.gs1song` 走 `store.importPresetFile` 时会**同时应用文件里的音色**（既有语义）；替换用的公版是**自编缩编**、非原谱逐音转录（若需逐音考据另立批）。

**（历史）P10.5 原条目**
- 要点：把内置曲目替换为公版/可授权曲库 + 用户导入；元数据标注来源与许可；曲库文件按需加载（**注意**：单独拆 chunk 经实测是负收益，必须连初始化语义一起改，或以数据格式优化替代）。
- 验收：首屏 JS 不增、每首曲目有来源标注、E2E 播放与导出。

### P11 · 工程与质量二期

**P11.1 `wasm-opt -Oz` 接入** ✅ **v1.105.0 交付**
- 要点：把 binaryen 的 `wasm-opt -Oz` 接入 `build-wasm.mjs`（两个核都过），复核 ABI、零分配、指纹与体积。
- **原验收判据是错的，已更正**：计划写「两核 **gzip** 下降 ≥10%；若收益 <5% 则放弃」。实测（binaryen 132、`-Oz --all-features`）**raw −31.2%/−35.0%，但 gzip 只 −0.9%/−1.0%**——gzip 已经把重复结构压掉了，`-Oz` 省的是 raw。而 `scripts/verify-budget.mjs` 的 **`dist total` 恰好是 raw 字节求和**（只有「最大 WASM」那条用 gzip），所以本批的价值落在 **dist**：**1718.6 → 1523.1 KB（−195.5 KB，−11.4%）**。按错误的 gzip 判据会把本批毙掉，判据已改。
- **做法**：`binaryen@^132.0.0` 进 **devDependencies**（只进构建期，不进产物；`package-lock.json` 同步，CI 的 `npm ci` 即可）；`build-wasm.mjs` **幂等且永不失败**——取不到 `wasm-opt`、执行报错、或产物过不了 `WebAssembly.validate` 都打印原因并**保留未优化模块**继续（实测 `WASM_OPT=0` 与 `WASM_OPT=/nonexistent` 均 exit 0 + 警告；降级后 dist 1718.6 KB 会被 1530 阈值挡红，这是**有意的告警路径**而非静默劣化）。必须 `--all-features`（否则被 wasm-validator 以 SIMD/bulk-memory/trunc_sat 拒收）；**未使用 relaxed-simd**。
- **等价性（比指纹更强）**：三红线逐字不变（`test:dsp` 0.030735、81 指纹、`verify:dsp:2x` 0.030852），且同一 dsp 补丁在优化前后**两核 × 1×/2× 各渲染 96 000 样本逐字节完全相同（4/4）** → 等价优化，非行为改变。新增 `scripts/verify-wasm-features.mjs` 把「SIMD 核仍有 v128、标量核 0 处 v128、两核 0 处 relaxed-simd」钉进 `test:wasm` 与 CI。
- **阈值**：`total` **1720 → 1530 KB**（实测 1523.1 + ~0.5%，只留发布 changelog 的 ~1 KB）、`wasm` **74 → 73 KB**（实测 72.4；**如实注明** gzip 只降 0.9%，这是刻意收紧不是真收益，下一次 gzip 增长必须申报）；首屏 JS/CSS 不动。`verify-budget.mjs` 注释结清了 P9.2/P9.1c/P10.3 三条「P11.1 要买回来」的承诺。
- 代价：`wasm-opt` 每核约 23 s，`build` 与 `test:wasm` 各跑一次 ⇒ 每个 CI job 约 +50 s。
- 顺带：`THIRD_PARTY_NOTICES.md` 补了 Binaryen（Apache-2.0，dev-only、不随产物分发）的构建期条目；`package-lock.json` 的 root `version` 被 npm 从过期的 1.78.0 同步为 1.104.0（package.json 的 version 未动）。

**P11.2 i18n 按语言拆分** ✅ **v1.110.0 交付**
- **做法是按键组的结构性拆分，不是按语言**：`DICT` 是 `key:[zh,en]` 扁平双语表，按语言拆会把另一种语言留在首屏、收益相同却要把同步 `t()`/`getLang()` 异步化。所以 `src/i18n.ts` 只留**首帧真会渲染的 174 键**，其余 **355 键**按面板分表进 `src/i18n-panels.ts`（只被 `import()` 到达：FX 68 / PLAYER 104 / ROLL 51 / DRAWER 18 / SOURCES 27 / SETTINGS 48 / AUDIO+cc 27 / DOCS 8 / FLOW 12）。**判据是逐键的**（每个 core 键的读者都在首帧代码里），移动后再审计一次：**零 audit-only 键**。
- **首屏最小集的边界（可复核）**：`panels/layout.tsx`（顶栏/示波器行/键盘 dock/卷帘按钮）、`panels/modules.tsx` + `Module.tsx` + `state/layout.ts`（模块网格与标签）、`Keyboard.tsx`、`controls.tsx`（`t(\`wave.${w}\`)`、`knob.fine`）、`EditableValue.tsx`、`canvas.tsx`、`App.tsx`、`engine.ts`+`midi.ts`+`render.ts`（启动期 `err.*` toast）。再往下搬只能搬「首帧就在 DOM 里的 `title`/`aria-label`」或首帧可见文本 ⇒ 会在首屏先画 key 名，正是本批禁止的闪烁。
- **同步性保住了**：`t()` 字面量调用点 **1342 处 / 57 个非测试文件，全部保持同步，没有一处被异步化**；`getLang()` 的 5 个调用点（录音量化 toast、播放器网格标签、Guide/Changelog 的 `pick()`、`midi/library.ts` 曲名、更新横幅）都在事件/toast 路径。新增的异步面只有三处且都不在首帧：`main.tsx` 的 boot 预载（**不 await**）、`App` 的 idle 预载、懒面板的「先 loadStrings 再 import 组件」。`store.toggleLang()` **仍是同步**，await 放在设置抽屉的按钮里 ⇒ 切换语言先加载完再提交，**不闪烁**。
- **设置/预设库抽屉的文案搬走了**（我复核时驳回了「测试要它所以留在首屏」这个理由）：两者都不是首帧可见内容；设置抽屉用 `useStringsReady()` 门住（表未到渲染 `null`），`App.test.tsx` 改成先 `await loadAllStrings()`。**测试驱动不是设计理由**。
- **另外两处真实节省**：①键名清单改为 `Object.keys(table)` 在 `registerStrings()` 内派生（原设计给每张表配 `readonly string[]`，与文案同 chunk ⇒ `dist` 按 raw 求和时**重复约 7 KB 字符串**）；②删 **36 个死键**（`src/`、`e2e/`、`scripts/`、`index.html` 零引用，逐个 grep 证实；沿用 P10.2 删 `clip.tplDefaultName` 的先例）。
- **实测（同口径，用 v1.109.0 的 release 包里的 `index.html` 对比）**：`index-*.js` raw **299,983 → 271,040 B**、gzip **92,238 → 81,084 B**；**首屏 JS gzip 137,878 → 126,724 B（134.65 → 123.75 KB，−10.89 KB）**，落在计划的 8–12 KB 内；阈值 **136 → 125 KB**（实测 + ~1.2 KB），**P10.2 记在 136 上的那 2 KB 账就此结清**。dist **1556.9 → 1558.3 KB**（+1.4 KB，仍在未动的 1562 KB 内 ⇒ 没有放宽任何阈值；**余量只剩 ~3.7 KB**）。CSS 20.2/21、wasm 74.2/75 未动。
- **首帧不等懒 chunk 的证据**（防止「用后台请求把字节挪出指标」的读法）：`main.tsx` 的 `void loadAllStrings()` 不 await；`i18n.test.ts` 新增「**首屏 import 图里出现的键必须都在 core**」的断言 + 一条**元测试**证明那个 import 图遍历器真的能找到文件（否则它会在守卫生效时静默变绿）；三个 eager-but-lazy-copy 组件（设置抽屉、两个导入源 picker）在表未到时渲染 `null`；`e2e/i18n.spec.ts` reload 用例断言首帧就是 `Start Audio Engine` + 模块名。
- **不闪烁的断言**：`e2e/i18n.spec.ts` 用 MutationObserver 记录整段 DOM 文本，断言切换后懒面板变成 `Quantise`、**全程不出现 key 名**、且转录恰好两端（无第三态）。**2 passed**。
- **一处语义收窄（登记）**：`hasKey()` 现在在表未加载时返回 `false`（原为 `true`）——键名改由 `Object.keys(table)` 派生是省掉 ~7 KB 的代价。生产代码里 `hasKey` **只被 `i18n.test.ts` 使用**（已 grep 证实）；守卫（字面量有键、两表不重复、首屏 import 图只用 core、gated 文件必须调 `useStringsReady()`、两表都加载后覆盖全字典）全部保留。要恢复「未加载也能答」需把键名清单放回懒 chunk（首屏 JS 不受影响，dist +~0.2 KB，可由余量吸收）。
- 体积取舍（注释里留了数字）：单 chunk vs 每面板一 chunk 都实测过，**每面板一 chunk 在 dist 上差 1.7 KB**（多 6 个 chunk 头 + 6 个更弱的压缩上下文），首屏数字相同 ⇒ 合成一个模块。

**P11.3 视觉回归扩容** ✅ **v1.108.0 交付**
- **新增 28 张基线**（6 处界面 × 深/浅 × 手机 390×844 / 桌面 1440×900）：**更新横幅**（伪造 waiting worker）、**播放器 take 行**（真录两条 take）、**滤波双级** 串联/并联各一张、**过采样 LED**、**图模板 select**、**路由图调制线**；**总量 20 + 28 = 48 张**（目录 2.9 → 3.6 MB）。阈值沿用 **0.05 色距 + 0.01 占比**；mask 补了 `.spec-body` / `.strip-scope` / `.strip-spec`（`.spec-body` 是频谱画布，漏在 mask 外时浅色启动页有 0.45% 的 rAF 竞态漂移）。清单/总量/mask 约定已写进 `docs/notes/visual-regression.md`。
- **自证①**：把 `.take-chip` 底色改成 `#ff00ff` 并真构建 → `takes-dark-desktop` **2262 px（ratio 0.06）**、`takes-dark-phone` **3104 px（ratio 0.09）** 红，`-expected/-actual` 归档；还原后整套 **9 passed**。
- **⚠️ 本批暴露的真相（比扩容本身重要）**：`npm run test:visual` 在 **v1.107.0 上开工前就是红的**——基线录于 `a092c6a`，之后 SEM 滤波类型、第二级 OFF/SER/PAR、2× LED、take 行等等都改过界面，而**视觉套件不在 CI、没人重录**。实测那些基线里连 `SER`/`PAR`/2× LED 都还没有。本批把 **10 张过期的**重录到当前界面（`modules-*`×4、`player-*`×4、`splash-{dark,light}-desktop`），其余 10 张逐像素未变。**这不是 P11.3 引入的改动，是补拖欠的重录**；已登记为债（见 §一.12）。
- **已知边界**：手机 390 宽时，两条调制条 + 每节点覆盖参数条把对话框占满，滚动窗口仅剩 **33 px**，线实际看不见——手机基线取承载该边的调制行，桌面仍拍 `.fxg-scroll` 里的线。要真在手机上拍线得改窄屏 fxg 面板布局，另开批次。

**P11.4 预设指纹二期** ✅ **v1.108.0 交付**
- `scripts/verify-presets.mjs` 支持 `--oversampled` → `tests/preset-fingerprint-2x.json`（镜像 DSP 基线 `tests/dsp-baseline-2x.json` 的约定），新命令 `verify:presets:2x` / `presets:update:2x`；`--reason` 强制保留（缺理由实测 exit 2）。**两个模式都是硬门禁、互不派生**，已进 `npm run verify` 链、`.github/workflows/ci.yml` 与 `scripts/verify-ci.mjs` 必需清单。
- **全量 81 × 2，未抽样**（合计 ≈34 s，低于 60 s 门槛）：1× **13.4 s**、2× **20.6 s**。实测 **80/81** 个预设在 1×/2× 之间已有数值差异（最大 **43.87 dB**，`wtmetal`），所以这份基线不是冗余。
- **自证②**：把 pluck 的 `FILTER_CUTOFF` 5200 → 4680（−10%）→ 1× 红（`7943Hz -133.012 -> -128.641 dB`）、**2× 也红**（`7943Hz -128.084 -> -126.861 dB`，且提示语是 `presets:update:2x`）；还原后两个模式都 `81 presets unchanged · ABI 8`。
- **本批未触碰 `dist`/wasm**：dist 聚合 sha256 与两个 wasm sha256 前后逐字节相同（`src/`、`crates/` 零改动）。

**P11.5 启动/运行时预算进发布门禁 + 性能守卫扩展** ✅ **v1.110.0 交付**
- `scripts/release.mjs` 把 `e2e/performance.spec.ts` 的 `[boot-budget]` 行做成**具名、可覆盖**的发布步骤（`[release] ▸ first-interactive budget (3200 ms)`，`GS1_BOOT_BUDGET_MS` 可覆盖）。**正常路径把浏览器门禁分成两段**（v1.111.0 起）：先 `npm run test:e2e`（app 套件）、再 `npm run test:perf`（`perf` project，1 worker），两段输出都扫 `[boot-budget]` 并复核（否则 `--skip-e2e` 会把门禁一起关掉）；只有 `--skip-e2e` 时才单独跑这一个 spec 文件。新增 `--skip-git-check` 仅供演练。
- **失败路径已演练（自证）**：`GS1_BOOT_BUDGET_MS=1` → spec 红（`interactive best 883 ms of [3118,1493,883]`，budget 1 ms）+ **`[release] FAIL … exited 1`（EXIT=1）**；还原后 `interactive 509 ms ≤ 3200 ms` → `[release] PASS`。原始输出见提交信息与 `docs/notes/performance.md`。
- **fps 守卫扩到三种负载**（阈值仍是 **>20**，best-of-5 × 800 ms，理由与 boot 预算/bench 的机器探针同源）：`idle-with-engine` / **`playback`（真播放）** / **`graph-edit`（真拖节点）**。实测：单跑 61.3 / **60.0** / **61.3** fps；全量并行套件下 50.0 / **28.8** / **31.3** fps（并行下曾出现 20.0/17.5 的单窗 ⇒ 因此把 best-of-3×1.2 s 改成 best-of-5×0.8 s，**没有**动阈值）。**v1.111.0 起该 spec 移出 app 套件，由 `test:perf` 在 `perf` project 里单跑（见 §一.13）。**

**P11.6 平台矩阵常规化**（1 批）
- 要点：nightly 的 WebKit/Firefox 覆盖率提升（核心子集 + 视觉/音频子集）、iOS 真机手测清单固化在 `docs/DEVICE-TESTING.md`。
- 验收：nightly 记录含 display 列与通过率趋势；清单含可勾选步骤与预期结果。

### P12 · 产品化与生态（按收益取舍）

**P12.1 教学与练习模式** ✅ **v2.0.3 交付（P12 方向就此收官）**
- **纯逻辑**（`src/teaching/theory.ts` + `score.ts`，36 条单测）：音阶/和弦用 **MIDI note 号**产出音高集合；评分 `score = round(100 · hitRate · (0.6 + 0.2·音准Q + 0.2·节奏Q))`，300 ms 窗口**边界包含**、平手取**靠前** step、命中要求音高精确匹配、错音既不算命中又进半音误差、漏音 = expected − matched。**边界都被单测钉死**：完美 = 100、**空演奏 = 0**、**空目标 = 0**（不给「虚空的 100」）、4 音目标错 1 个音（差 1/4/6 半音）= 70/65/64、整体迟到 150 ms = 90、散和弦（0/50/100 ms）= 97。
- **一个明确的取舍**：**完全错时的多音不扣总分**（只进 `extra` 字段）。理由是让公式一行能写完、能手算复核；分数回答「该弹的音有没有弹对/弹准/弹在拍上」，不是「有没有乱弹」。已写进 `docs/notes/teaching.md`。
- **UI 是懒 chunk**（`Teaching-*.js` 10 855 B + CSS 2 335 B + 自有 `i18n.teach` 2 949 B）：入口是设置抽屉里的一行，**首屏只 +433 B（124.7 → 124.8 KB，线 125）**。目标音高亮直接画在既有键盘的 `[data-midi]` 上（`MutationObserver` 抗 React 重写 className），高亮逻辑全在懒 chunk 里。**并核对过没有重复模块**（`t`/`haptic`/`noteBus` 从入口 chunk 取，`i18n.teach` 被 Vite 正确抽成共享 chunk）。
- **`dist total` 记账式 rebase 1595 → 1614 KB**（实测 1610.1；增量 = 三个新 chunk + index +433 B + sw 预缓存名单 ~119 B）。**首屏线没有动**——教学对「打开它的人」值约 7.5 KB gzip，对**从不打开的人为零**。
- **E2E**（真实 window keydown/keyup，节拍锚定到面板自己的 `data-state="recording"`，不受 Playwright 往返延迟影响）：正确一遍 **score 100**（hitRate 1 / missed 0 / meanMs 5），错误一遍 **score 0**（hitRate 0 / missed 8 / extra 8）；高亮断言是 DOM 的（8/6/4 个目标键、根音带 `data-teach-root`）并真点了一下键证明面板没盖住键盘。
- **自证**：错音也算命中 → 4 条红；音准权重置零 → 2 条红；还原后 45 passed。
- 遗留（登记）：和弦练习是**每拍一个音的琶音**（评分器本身支持块状和弦，有单测；要改只需动 `buildExercise`）；高亮要求面板挂载时 `.keyboard` 已存在（手机 compaction 下未单独测）。

**（历史）P12.1 原条目**：和弦/音阶助手、练习评分（音准/节奏准确率）、可量化结果 + E2E。
**P12.2 内容包**（1 批）：新增工厂预设（专门展示 SEM 双滤波、位粉碎、过采样、图内调制），曲库扩充；指纹显式更新 + 试听门禁。
**P12.6 SW 版本握手 + 修「回滚后横幅写错版本号」**（新增，P12.4 的续批；**用户 2026-09-14 批准动 SW 协议 + i18n + 首屏预算**）
- **症状**（§一.17）：回滚后，「页面还开着、从未重载」的 PWA 上，更新横幅的版本号取自**正在运行**的 bundle，于是写着被回滚掉的 vW，点下去装的却是 vX。
- **做法**：给 Service Worker 加**版本握手**（现在 `sw.js` 只有内容哈希缓存名 `gs1-<hash>`，没有 semver），让横幅报的是**将要安装的那个版本**而不是当前运行的那个；相应动 `scripts/gen-sw.mjs` + `src/pwa/register.ts` + `src/App.tsx` + i18n。
- **注意**：会动**首屏预算**（横幅在第一屏）⇒ 首屏 JS 只能往下或持平，超了要按记账式 rebase 报我。改 UI 要跑 `test:visual`；改 SW 要让 PWA 的离线/更新 E2E 保持绿。
- **别名/顺序**：文件名用 **P12.6**（P12.5 是用户排除的无障碍），**排在 P10.4 之后**做（要动 `src/App.tsx` 与 i18n，与 P10.4 的地盘重叠）。

**P12.3 分享与协作** —— ❌ **不做**（用户明确排除；既有分享码/`.gs1song`/图模板能力保持现状）
**P12.4 分发与回滚**（1 批）：版本化 CDN 保留 N 个版本、回滚开关与演练脚本、更新提示联动；线上核对纳入演练。
**P12.5 无障碍** —— ❌ **不做**（沿用项目最初约定；用户明确排除）

### P13 · 给其它 AI / LLM 的接口（**用户 2026-09-14 新立，设计见 `docs/LLM-INTERFACE.md`**）

**目标**：让外部 agent **离线、确定地**看懂/改/听/量这台合成器——**尤其是用本仓库自己的尺子量**
（BH-7 + Hann 双尺子、±8 bin 地板、THD、步进、零分配）。别的 agent 就能对着**真实门禁**迭代音色，而不是凭感觉调参。
**形态**：MCP（stdio，手写 JSON-RPC、**不引新运行时依赖**）+ 同工具的只回环 HTTP 入口；两层共用一份 tool registry。
**关键前提**：不新增音频代码——`verify-audio.mjs` 今天已经在 Node 里起真 wasm 量这些数；本方向是把它**抽出来共用**。

| 批 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P13.1 抽尺子** | `scripts/lib/render-core.mjs` + `scripts/lib/audio-ruler.mjs`；门禁改为调用它们 | **门禁读数逐字节不变**（`verify:audio` 每条、`test:dsp` 0.030735、`verify:dsp:2x` 0.030852 一字不动）；纯重构，**不接受任何数字变化** |
| **P13.2 只读+渲染+测量** | `mcp/server.mjs` + `gs1.describe`/`params.list`/`presets.list`/`patch.get`/`render`/`analyze`/`gate` + `npm run mcp` | 工具级单测 + 黄金会话（同调用两次逐字节相同）+ 手写 JSON-RPC 的 `initialize`/`tools/list`/`tools/call` 有测试 + **`dependencies` 仍为空** |
| **P13.3 操作类** | `patch.set`/`patch.random`/`sample.import`/`wavetable.import`/preset 套用保存 | 覆盖「夹取要报告」「装不下返回 `noRoom`」「坏文件结构化拒绝」；patch 往返一致 |
| **P13.4 浏览器层 + 范例** | ✅ `gs1.ui.*`（Playwright，复用抽出来的 `e2e/interact.mjs`）+ 实战范例 | 范例**真跑过**：`crushlead` 只改 `fxCrushBits 6→4`，≥1 kHz Hann 地板 **−4.02 → −64.88 dB（60.86 dB）**，前后 JSON/分享码/调用序列都在 `docs/LLM-INTERFACE.md` §4.5 且可重放；截图 1440×900 与桌面基线同尺寸 |
| **P13.5 文档与发现** ✅ | `docs/LLM-INTERFACE.md` 补齐工具契约/限制/示例；`docs/notes/mcp.md` 记设计与坑；`scripts/verify-llm-docs.mjs` 钉住不许漂移 | ✅ 一个**无上下文**新 agent 只读这两份文档就端到端跑通（`initialize → tools/list → presets.list → render → analyze`，自算 sha256 与返回一致）；它卡住的 8 处已据此改文档 |

**非目标（第一版）**：不接声卡（只离线渲染）、不联网、不接受任意代码/表达式、**永不部署**。
**依赖与并行**：依赖 P9.x/P10.x 已定型（尺子/返回码）；足迹是 `scripts/lib/`、`mcp/`、`docs/`，
**与 P12.1/P12.2/P12.6 不重叠，可并行**。

## 四、执行顺序与里程碑

| 顺序 | 批次 | 依赖 | 预估 | 版本 |
| :--- | :--- | :--- | :--- | :--- |
| 1a | P9.1a 度量与门禁卫生（零风险） | 调查结论 ✅ | 小 | ✅ v1.99.0 |
| 1b | P9.1c 硬同步重启对齐（每窗 ≥ −60 dB 达成，最差 −88.1；<3 dB 离散度部分达成，技术债） | P9.1a | 中 | ✅ v1.101.0 |
| 1c | P9.1b 普通振荡器带限（音色改变，已重录基线） | P9.1a | 中大 | ✅ v1.102.0 |
| 2 | P9.2 瞬态整形 ✅ v1.98.0 | P6.4 | 小 | ✅ v1.98.0 |
| 3 | P9.3 每节点效果参数 | P7.2 | 中 | ✅ v1.103.0 |
| 4 | P10.3 take 二期 | P5.4 | 小 | ✅ v1.104.0 |
| 5 | P11.1 wasm-opt | — | 小 | ✅ v1.105.0 |
| 6 | P9.4 图模式过采样 | P9.3 | 中 | ✅ v1.106.0 |
| 7 | P10.1 时间线多选 | P5.1 | 中 | ✅ v1.107.0 |
| 8 | P11.3 视觉回归扩容 + P11.4 指纹二期 | — | 小 | ✅ v1.108.0 |
| 9 | P10.2 片段二期 | P5.2 | 中 | ✅ v1.109.0 |
| 10 | P11.2 i18n 拆分 + P11.5 启动门禁 ✅ 首屏 JS −10.89 KB | — | 中 | ✅ v1.110.0 |
| 11 | P9.5 波表带限复核 ⚠️ **验收线未达标**：实测 −25.8…−46.7 dB，根因是线性插值，已加门禁钉住实测地面 | P9.1 | 小 | ✅ v1.111.0 |
| 11b | P9.6 滤波器共振 × 新振荡器交互 ⚠️ **计划前提被否掉**：真因是 BLEP 查表 f32 舍入（P9.1c 姊妹案例），已修 1/150 → 0/150，**无基线重录** | P9.1b | 小 | ✅ v1.112.0 |
| 11c | **P9.7 波表/采样插值器** ✅ 波表 **−98.0 dB**（超额）、采样 −33.4（边界见 §一.16）；指纹重录（真的只变 4 条）；dist 记账 rebase 1568 | P9.5 | 中 | ✅ v1.113.0 |
| 11d | **P9.8 扩 arena（8→12 MiB）+ 采样修到 −60 dB** ✅ 实测 **−33.4 → −70.5 dB**；级长 = 带宽允许的长度（P9.7 的 18 MB 估计错了 8 倍，实际 2.23 MB）；**体积未涨** | P9.7 | 中 | ✅ v2.0.1 |
| 12 | P10.4 工程管理 ✅ 多套工程 + `.gs1proj` + 配额降级；**dist 记账 rebase 1595** | — | 中 | ✅ v2.0.0 |
| 13 | P10.5 曲库合规 → **收官打 v2.0.0** ✅ 移除 **9 首**在版权曲目（计划外多 2 首）+ 逐首来源/许可 + 分因拒绝的导入 | — | 中 | ✅ **v2.0.0** |
| 17b | **P12.6 SW 版本握手 + 修回滚后的横幅标签** ✅ 横幅版本号改为**向 waiting worker 握手**取得（超时则**不显示版本号**），回滚形态已断言；首屏 JS +0.1 KB | P12.4 | 中 | ✅ v2.0.2 |
| 14 | P11.6 平台矩阵 ✅ **随并行轨道提前交付**：nightly 加 display 列 + 生成式通过率趋势（12 项自测）、DEVICE-TESTING 32 个可勾选项、视觉在 WebKit/Firefox 走冒烟（有证据地不比像素） | — | 小 | ✅ v1.113.0 |
| 15 | P12.1 教学/练习 ✅ 纯逻辑评分（公式可手算）+ 懒 chunk UI；正确 100 / 错误 0；首屏只 +0.1 KB、dist 记账 rebase 1614 | P10 | 中 | ✅ v2.0.3 |
| 16 | P12.2 内容包 ✅ **10 条新预设**（SEM 双滤波/位粉碎/过采样/图内调制）+ **5 首公版曲**（20→25）+ 试听门禁；指纹 81 → **91**（既有 81 条逐字节未变）；**压缩工厂表把空间买回来**（dist 反降 0.2 KB） | P9 | 中 | ✅ v2.0.2 |
| 17 | P12.4 分发与回滚 ✅ **随并行轨道提前交付**：保留 N=5（`release/retained/`，逐文件 sha256 + tar 快照）、`rollback` 默认 dry-run、演练脚本、storeSchema 倒退闸；横幅标签错位见 §一.17 | P11 | 中 | ✅ v1.113.0 |
| 18 | **P13.1 抽尺子（为 LLM 接口共用一份测量实现）** ✅ 门禁读数逐字节不变 | P9/P10 定型 | 中 | ✅ v2.1.0 |
| 19 | **P13.2 MCP 只读+渲染+测量** ✅ 7 个工具、54 条测试、黄金会话逐字节相同、目录驱动注册表、`npm run mcp` 与 CI/verify-ci 同步；**零新增运行时依赖** | P13.1 | 中 | ✅ **v2.1.1** |
| 20 | **P13.3 MCP 操作类（patch/sample/preset）** ✅ 7 个工具、变异工具会如实报告夹取/拒绝；MCP 测试共 **88** 条、黄金会话 21 次调用两遍哈希相同 | P13.2 | 中 | ✅ **v2.1.1** |
| 21 | **P13.4 MCP 浏览器层 + 实战范例** ✅ v2.1.2 · 5 个 `gs1.ui.*` 工具（独立入口 `npm run mcp:ui`、只用 4796、只连 127.0.0.1、白名单 spec）；**帧无关交互抽成 `e2e/interact.mjs` 与 E2E 共用**，顺带修掉 `force` 从不被读的真缺陷（删掉那 5 行 ⇒ 5 条单测 30 s 超时变红）；**范例真跑**：`crushlead` 只改 `fxCrushBits 6→4`，≥1 kHz Hann 地板 **-4.02 → -64.88 dB（60.86 dB）** | P13.2 | 中 | v2.1.2 |
| 22 | **P13.5 LLM 接口文档与发现** ✅ v2.1.2 · `docs/LLM-INTERFACE.md` 402→744 行改成**外部契约**（19 工具分两层、限制/拒绝、客户端接法、20 条接入自查清单）+ `docs/notes/mcp.md` 补完；新门禁 **`verify:llm-docs`**（工具名/错误码**双向**一致、上限与端口从代码派生）；**外部视角检验**用一个无上下文 agent 真跑通调用链，并据它卡住的 8 处改了文档 | P13.2 | 小 | v2.1.2 |
| 23 | **P9.10 采样导入提速（每抽头 clamp 提出内循环，逐位相同；§一.29）** ✅ 安静主机 4 s 导入 **130 → 78 ms**（1.68×），`test:dsp` / 91 指纹 / 导入→渲染 sha256 全部一字不动；`#[inline(never)]` 把 wasm gzip 从超线 92 B 买回（76 717 B，余 83 B） | P9.8 | 小 | ✅ **v2.1.1** |
| 24 | **p141 更新记录上限化（买回 dist 体积；§一.39②）** ✅ dist **−79.4 KB**，线 1619 → **1550（下调）** | — | 小 | ✅ **v2.1.1** |
| 25 | **p142 计时判据统一 + 读数可见（§一.20①②⑤）** ✅ 三处门禁共用 `scripts/lib/host-load.mjs`，读数恒打印，不可信时可见地 skip；阈值未动 | — | 小 | ✅ **v2.1.1** |
| 26 | **p926 预设/曲库按需加载（§一.26 A、§一.7、§一.28）** ✅ 首屏 JS gzip **125.3 → 113.3 KB**，线 **126 → 115（下调）**；`allPresets()` 未加载时抛具名错误；`e2e/lazy-chunks.spec.ts` 钉住「首屏不请求这两个 chunk」；代价见 §一.41 | — | 中 | ✅ **v2.1.3** |
| 27 | **ffx Firefox 6 条红（§一.39④）** ✅ 根因是**宿主没有音频后端**（产品零改动）；新增 `e2e/audio-host.ts` 用应用无关的裸 `AudioContext` 判定宿主并**显式 skip + 打印原因**；顺带修好 `fm:33`/`i18n:83`（等 `.start-overlay` 抬起） | — | 中 | ✅ **v2.1.2** |
| 28 | **trel 两条慢轨门禁（§一.39⑤）** ✅ `test:visual` 自证的真因是 `captureBeyondViewport` 的**光栅竞态**（不是状态污染），加 `prime()` 修好；`player:45` 是**用例自己的预算**，改成等 transport 时钟 + 要求看到回绕，chromium 给 90 s 无 retries | — | 中 | ✅ **v2.1.2** |
| 29 | **v2.1.4 债单五条（无独立批次名）** ✅ §一.22 核实为**早已由 1C 关闭**（每级带宽 12–24 kHz、地板 −81，未动任何阈值）；§一.23 的截断改成**可见提示**（保留截断、不改拒绝）；§一.25 前段抽头 **192 → 128**（交替 A/B 导入 **1.34×**，门禁逐行不变）；§一.8 图编辑器改跟**活动实例**（自证：旧代码下新 E2E 红）；§一.20⑨ `lint` 覆盖 **e2e/scripts/mcp**（首绿消掉 125 error，含 `P` 表 9 个重复键与一条死导入两条真缺陷） | — | 中 | ✅ **v2.1.4** |

> **并行开发（2026-09-14 起，用户指示）**：多个 agent 在各自 worktree/分支上并行开发、由父代理合并后发布，所以**版本号的「批次」映射关系不再严格**——版本列是**预计**，实际以发布顺序为准（同一次发布可能合并了多批，例如 v1.113.0 = P9.7 + P11.6 + P12.4）。规则见 `/.tmp/parallel-dev.md`。

> **范围决定（用户）**：**P12.3（分享与协作）与 P12.5（无障碍）不做**，其余 19 个批次全部交付。
> 无障碍沿用项目最初约定（不做 a11y）；分享码/图模板/工程的既有能力保持现状，不再扩充分发形态。

> 版本号策略（**用户已定，2026-09-13**）：P9/P10 阶段继续累加次版本，**在 P10 收官的那一批打
> **v2.0.0****（即 P10.5 交付后由 v1.111.0 跳到 v2.0.0），作为「创作与工作流二期完成、可以日常
> 当主力工具」的里程碑；此后 P11/P12 从 **v2.0.1** 重新累加，P12 收官仍是 v2.x 的次版本。
> 已写进 `docs/ROADMAP.md` 的交接窗口。见下面批次表末尾的版本列。

## 五、风险与对策

| 风险 | 对策 |
| :--- | :--- |
| P9.1 改动落在限幅器/增益路径，所有音色响度与削波行为变化 | 先量化「改前/改后」的响度与峰值表；DPR/DSP 指纹与 81 预设指纹**显式重录 + 理由**；由我确认后才发布 |
| 每节点效果参数导致 id 空间与 UI 失控 | 按「共享 + 覆盖槽位」设计，先出 id 预算表（每效果 ≤ 4 个新 id）再动手 |
| PDC 引入的延迟影响既有音色 | 只在图模式且开启过采样时补偿；链模式逐位不变；UI/文档明示延迟值 |
| wasm-opt 与既有指纹不一致 | ~~收益 <5% 就放弃并记录~~ → **已由 P11.1 结清**：判据本身是错的（gzip 只 −1%，raw −33%，而 `dist total` 按 raw 求和），所以保留；等价的判据是「指纹逐字不变 + 逐字节渲染对照」 |
| i18n 拆分波及所有文案断言 | 先拆数据、后拆加载；首屏保留最小内联集；全部 e2e 文案断言回归 |
| 启动阈值依赖机器 | 阈值取「并行套件最慢 + 30%」，并允许 CI 单独覆盖（环境变量），本机与 CI 各记录基线 |
| 曲库/教学内容的版权 | 只用公版或自有内容，元数据标注来源与许可；不引入第三方采样 |

## 六、每批的完成定义（Definition of Done）

1. **实现**（含注释说明「为什么」）+ **单元测试**（音频批次还要真 wasm 门禁）+ **E2E**（用户可见改动必须有）。
2. `npm run verify` **全绿**（实际链序：clippy → `test:rust` → **build** → `test` → lint → `test:wasm` → ci → release → dist → budget → audio → presets → presets:2x → bench → dsp → dsp:2x → `mcp --self-test` → `verify:llm-docs`）。
   **`build` 必须排在 `test` 前面**：`src/generated/*.wasm` 是 gitignore 的构建产物，干净 worktree 上先测必红（§一.35，修复提交 `0a5aca3`）。
3. **相容红线**：`test:dsp` **0.061470**、`verify:dsp:2x` **0.061703**、`verify:presets` 与 `verify:presets:2x` 都是 **`91 presets unchanged · ABI 8`**，除非本批有意改变并显式重录（附理由）。
4. **小步提交**（功能 / 文档+版本 分开）+ `npm run package` + `npm run release -- <version>`。
5. **线上核对**：用 `https://synth.wangda.today/` 比对 `assets/index-*.js` 指纹，并在线上 bundle 里查本批文案。
6. **中文同步**：更新记录（中英成对）、`docs/NEXT-PLAN-2.md` 状态、`docs/ROADMAP.md` 队列行、必要的 `docs/notes/*`（含实测数字与「自证」证据）。
7. **工程批次自证**：故意改坏一处 → 门禁红（把证据写进文档）。
