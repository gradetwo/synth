/**
 * Release history shown by the in-app changelog.
 *
 * Newest first. Every entry carries both languages, so the panel follows the
 * current interface language like the rest of the app. Keep the entry for the
 * version in `package.json` at the top — a unit test enforces that.
 *
 * **Only the newest `SHIPPED_CHANGELOG_LIMIT` releases live here** (P141). The
 * panel and this module are a lazily loaded chunk, but that chunk is still part
 * of `dist`, and every release added another ~1.2 KB of permanently shipped
 * payload — enough to overrun the size budget on its own by v2.1.0. The rest of
 * the history is in `src/changelog-archive.ts`, which nothing that runs may
 * import, and the panel points readers at the repository for it.
 *
 * House style: say what changed for the person using the synth, in one or two
 * sentences. No root causes, no measurement tables, no internal names — those
 * belong in the commit message and `docs/`. "Fixed the crackle on simple
 * patches" is the entry; *why* it crackled is not.
 */

export type ReleaseKind = 'sound' | 'feature' | 'fix';

export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: ReleaseKind;
  items: [string, string][];
}

/**
 * How many releases the app carries. Raising it grows the bundle, and the size
 * gate in `scripts/verify-budget.mjs` names what pays for that; the number is
 * exported so `changelog.test.ts` can fail the moment this list grows past it
 * (a new release is added by dropping the oldest one into the archive, not by
 * appending here).
 */
export const SHIPPED_CHANGELOG_LIMIT = 30;

import { CHANGELOG_HEAD } from './changelog-head';

export const CHANGELOG: Release[] = [
  CHANGELOG_HEAD,
  {
    version: '2.1.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**内部重构：把音频测量的「尺子」抽成共用模块。** 这次没有任何声音或界面变化——但它是一个**给后续 AI 工具接口（P13）铺路**的准备动作：门禁脚本里那套在 Node 里跑真 wasm 的渲染引导、以及两把测量尺子（7 项 Blackman-Harris 与 Hann 窗探针），现在是一份**被门禁和将来的工具共用**的实现，不再是各写一份。验收标准是**门禁读数逐字节不变**（136 行输出哈希一致），也就是说这次改动**证明了它没有改变任何测量结果**。',
        '**Internal refactor: the audio rulers became a shared module.** Nothing changed in the sound or the interface -- this is groundwork for the tool interface other agents will use (P13): the harness that boots the real wasm core in Node and the two measurement rulers (the 7-term Blackman-Harris scan and the Hann-window probe) are now one implementation that both the gates and the coming tools call, instead of two copies that could drift apart. The acceptance was that **not one gate reading moves** (all 136 output lines hash-identical), so this change proves it changed no measurement.',
      ],
    ],
  },
  {
    version: '2.0.7',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修好一批「选了却没用上」的音色与效果。** 浏览器里有一层参数范围挡在引擎前面：选**波表**会被悄悄换成噪声、选 **SEM / 共振峰 / 梳状**滤波会被换成陷波、效果槽里选**瞬态整形**实际跑的是 EQ。受影响的工厂音色共 **10 条**（4 条波表、`graphswell`、`phonk`、`robotvoice` 与 3 条 SEM 铺底）。现在这些选择真正到达引擎了——`wtorgan` 之类从「与噪声无法区分」变成正常的波表音色。另加了两道门禁（数据门禁 + 真浏览器 E2E）确保不会再发生。',
        '**A batch of choices that were selected but never reached the engine.** A parameter range in the browser sat in front of the core: picking a **wavetable** was quietly replaced by noise, a **SEM, formant or comb** filter became a notch, and choosing **transient shaping** for an effect slot actually ran the EQ. Ten factory patches were affected -- four wavetables, `graphswell`, `phonk`, `robotvoice` and the three SEM pads. Those choices now arrive: `wtorgan` and friends went from "indistinguishable from noise" to a proper wavetable tone. Two new gates (a data check and a real-browser test) keep this from happening again.',
      ],
    ],
  },
  {
    version: '2.0.6',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**整体响了约 6 dB（大致 4 倍功率）。** 以前这台合成器明显比别的软件轻——即使振荡器开满、滤波全开，峰值也只到 −19 dBFS，限幅器几乎从不工作；现在同样设置是 −13 dBFS，工厂音色、默认音色与随机音色一起抬升。代价如实说明：把**极端**素材（十几个声部全开、主音量也拉满）推得更狠时，软削波会多一些（实测 1.5% 的采样点）。想更响需要改输出级设计，而不是继续加增益——实测 +9 dB 会让 2× 抗混叠余量真的劣化。另有几条**位粉碎**类工厂音色听感会变，因为它们现在才真正开始量化。',
        '**Everything is about 6 dB louder -- roughly four times the power.** The instrument used to sit well below other software: with the oscillators at full and the filter wide open, peaks reached only -19 dBFS and the limiter almost never worked. At the same settings it now reaches -13 dBFS, and factory, default and random patches move together. One honest cost: pushing **extreme** material (a dozen voices wide open with the master up) soft-limits a little more, measured at 1.5% of samples. Going further would need an output-stage redesign rather than more gain -- +9 dB was measured to erode the 2x anti-alias margin. A few **bit-crusher** factory patches also change audibly, because they only now start quantising.',
      ],
    ],
  },
  {
    version: '2.0.5',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修好两个「看着没问题、用起来不对」的毛病。** ①**Crushed Sub** 这个音色其实几乎没声音——它的位粉碎步长比信号本身还大，每一个采样都被量化成零，只剩 10% 的干声漏出来；现在是真正的 6 bit 粉碎，低频回来了。②导入曲目现在**按文件内容判断格式**，不再只看扩展名：文件名里没有 `.mid` 的 MIDI 以前会被直接拒掉（提示「无法识别的文件格式」），现在能正常导入。',
        '**Two things that looked fine until you used them.** (1) The **Crushed Sub** patch was effectively silent: its bit-crusher step was larger than the signal itself, so every sample quantized to zero and only 10% of the dry path leaked through. It is a real 6-bit crush now and the low end is back. (2) Importing a track now decides the format from the **file\'s content** instead of its name -- a MIDI file whose name lacks `.mid` used to be refused outright ("unrecognised file format") and now imports normally.',
      ],
    ],
  },
  {
    version: '2.0.4',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**导入的采样再干净一档。** 高音区的折回杂音从 −70 dB 降到 **−86 dB**，而且把上一版为压杂音牺牲掉的**高音亮度也拿回来了**——采样弹到原音以上一个八度时不再发闷。顺带修掉一个偶发、还随调用顺序变化的插值错位（相位表少了最后一行，约每 1024 个样本错用一次核）。导入速度没有变慢，反而略快。',
        '**Imported samples got cleaner again.** The folded-back grit in the high register drops from -70 dB to **-86 dB**, and the **brightness the last version traded away comes back** -- a sample played an octave above its root is no longer dull. Also fixed an intermittent interpolation slip that changed with call order: the phase table was missing its last row, so roughly one sample in 1024 used the wrong kernel. Importing is not slower; it is slightly faster.',
      ],
    ],
  },
  {
    version: '2.0.3',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**新增教学与练习模式。** 选一个音阶或和弦，目标音会在键盘上高亮；弹一遍就给出**可量化的评分**——命中率、音准、节奏偏差和 0–100 的总分。评分规则是写下来、可以手算复核的，不是黑箱。这个面板**按需加载**，所以从没打开过它的人不会为此多下载任何东西。',
        '**New teaching and practice mode.** Pick a scale or a chord and the target notes light up on the keyboard; play a take and it scores it -- hit rate, intonation, timing deviation and an overall 0-100. The scoring rule is written down and can be checked by hand rather than being a black box. The panel loads on demand, so anyone who never opens it downloads nothing for it.',
      ],
    ],
  },
  {
    version: '2.0.2',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**新增 10 个工厂音色和 5 首曲子。** 新音色专门展示双滤波、位粉碎、过采样与图内调制这几项能力；曲库扩到 25 首，全部公版并标注来源。顺带修好更新横幅：**它现在报的是「将要安装的版本」**，而不是页面正在跑的那个——回滚之后那条提示曾经指向的就是被回滚掉的版本。',
        '**Ten new factory patches and five more songs.** The patches exist to show off the dual filter, the bit crusher, oversampling and in-graph modulation; the library grows to 25 tracks, all public domain and each labelled with its source. Also fixed: the update banner now names **the version it is about to install** rather than the one the page is running -- after a rollback that notice used to point at the very version being rolled back.',
      ],
    ],
  },
  {
    version: '2.0.1',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**导入的采样音色更干净了**：高音区的折回杂音从 −33 dB 降到 **−70 dB**——这也是采样器「逐级抽取」那个老问题的真正修复。副作用如实说明：把采样弹得比原音略高时，亮度会比上一版窄一点。另外修好了 **Safari / Firefox 里点不中连线**的问题（虚线描边的命中区在 Gecko/WebKit 上会漏掉一段）。工厂预设与默认音色未变。',
        '**Imported samples sound cleaner.** The folded-back grit in the high register drops from -33 dB to **-70 dB**, which is the real fix for how the sampler decimated its levels. One honest side effect: playing a sample a little above its root sounds slightly less bright than the last version. Also fixed **wires being unclickable in Safari and Firefox**, where the hit area of a dashed stroke has gaps. No factory preset or default voice moved.',
      ],
    ],
  },
  {
    version: '2.0.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**v2.0.0：创作与工作流二期完成。** 现在可以同时保存**多套工程**（切换、复制、打标签、快照恢复），并把它们导入导出成 `.gs1proj` 文件；存储空间不足时操作会被取消，而**当前正在做的东西不会丢**。内置曲库**清掉了全部仍在版权保护期内的曲目**（换成公版作品或本站原创编配），每首曲子都标注**来源与许可**；导入自己的 MIDI 或工程文件时，若文件损坏会**说明具体是哪一种问题**。',
        '**v2.0.0: the writing-and-workflow phase is done.** You can keep **several projects** side by side -- switch, duplicate, tag, restore a snapshot -- and import or export them as `.gs1proj` files; if storage runs out the operation is cancelled and **your current work is kept**. The built-in library **no longer contains any in-copyright works** (they are replaced with public-domain pieces or arrangements of our own), every track now shows its **source and licence**, and importing your own MIDI or project file says **which** kind of damage made it refuse.',
      ],
    ],
  },
  {
    version: '1.113.0',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**高音区更干净。** 波表音色在高音区原本有一层"沙"——那是插值读表的折回成分（非谐波能量 −26…−47 dB），现在**最差 −98 dB**；导入的采样音色也一并更干净（−30 → −33 dB，这条受录音自身带宽限制，已如实记录）。用到波表的 4 个工厂预设音色会有轻微变化，其余 77 个在百分之一 dB 以内，默认音色不受影响。内部同时加入了发布版本保留 + 一键回滚，以及 nightly 的平台矩阵报告（对使用者不可见）。',
        '**Cleaner high notes.** Wavetable voices carried a layer of grit up high -- the folded-back products of reading the tables with interpolation, at -26...-47 dB of non-harmonic energy -- and that now measures a worst case of **-98 dB**. Imported samples are cleaner too (-30 -> -33 dB, limited by the recording\'s own bandwidth, which is written down honestly). Four factory presets that use wavetables change slightly, the other 77 stay within a hundredth of a dB, and the default voice is untouched. Internally this also brings release retention with one-command rollback and a nightly platform-matrix report, neither visible in the app.',
      ],
    ],
  },
  {
    version: '1.112.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修掉一声很罕见的爆音。** 高音区某些音符在起音的瞬间会有一次整级错误的修正，听起来是一声短促的爆音（实测约每 150 次新起音出现 1 次）。除此之外整段波形**逐字节不变**，工厂预设与音量都没有改动。',
        '**Fixed a crackle that only showed up rarely.** In the high register, a few notes got one full-scale correction error the moment they started, which sounds like a short crackle (measured: about one fresh note in 150). Every other phase is **byte-for-byte** unchanged, and no factory preset or level moved.',
      ],
    ],
  },
  {
    version: '1.111.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**内部维护版：声音与界面没有任何变化。** 新增了波表/采样音源在高音区的回归门禁，并如实登记一个**已知边界**：这类音色在高音区的非谐波能量高于普通振荡器路径（要修就得改变它们的音色，所以留到单独一批再动）。引擎与上一版**逐字节相同**。',
        '**Internal maintenance release: nothing changed in the sound or the interface.** Added a regression gate for the wavetable and sampler sources in the high register, and recorded a **known boundary**: up there those sources carry more non-harmonic energy than the ordinary oscillator path does (fixing it means changing how they sound, so it is left to a batch of its own). The engine is **byte-for-byte** the previous build.',
      ],
    ],
  },
  {
    version: '1.110.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**启动更快**：首屏要下载的 JavaScript 少了约 **11 KB**（面板文案改为打开面板时才加载），第一次打开和弱网下最明显。面板文案没到之前不会闪出占位键名，切换语言也不会先显示另一种语言再纠正。声音引擎与上一版**逐字节相同**。发布流程另加一道门禁：首屏可交互时间超标会直接中止发布（内部）。',
        '**Starts faster.** The first screen downloads about **11 KB** less JavaScript (panel copy now loads when its panel opens), which shows up most on the first visit and on slow connections. A panel never flashes placeholder key names before its copy arrives, and switching language never paints one language and then corrects itself. The audio engine is **byte-for-byte** the previous build. Publishing also gained a gate that aborts a release when first-interactive time regresses (internal).',
      ],
    ],
  },
  {
    version: '1.109.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**片段编排更好用**：片段里能**直接改音符**（含新的多选批量编辑，每次编辑一个撤销步），可以把片段**复制到另一层**，还能把片段存成**模板**再套用到任意层（放在工作区，不进音色/分享码）。跨层复制与「逐个音符复制再折叠」的结果**逐位一致**，副本与模板都**不共享状态**。另修好上一版里被误删的 2× 预设指纹门禁（内部）。',
        '**Clip arrangement got easier.** Notes can be edited **inside** a clip (including the new multi-select batch edits, one undo step each), a clip can be **copied onto another layer**, and a clip can be saved as a **template** and applied to any layer (kept in the workspace, not in the patch or the share code). The copy is **bit-for-bit** what copying the notes by hand produces, and neither copies nor templates share state. Also restored the 2x preset-fingerprint gate the previous release dropped (internal).',
      ],
    ],
  },
  {
    version: '1.108.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**回归门禁补强**：视觉基线 20 → **48 张**（更新横幅、take 行、滤波串联/并联、过采样指示灯、图模板、路由图调制线；深浅 × 手机/桌面），并暴露一个真相——**这批基线此前已经过期、套件本来就是红的**（10 张补录）。预设指纹现在同时覆盖 **1× 与 2×**（81 × 2）。应用未变：wasm 与上一版**逐字节相同**。',
        '**Regression gates widened.** Visual baselines 20 -> **48** (banner, take row, serial/parallel filter, oversampling LED, template picker, modulation wire; dark/light x desktop/phone), which also surfaced that they had gone stale and the suite was **already red** (ten re-recorded). Preset fingerprints now cover **1x and 2x** (81 x 2). The app is unchanged: the wasm is **byte-for-byte** the previous build.',
      ],
    ],
  },
  {
    version: '1.107.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**卷帘可以多选了**：框选、Ctrl 点选、Shift 范围选、全选，然后整组批量操作——移动、复制/粘贴、缩放、量化、力度、删除，**每次编辑一个撤销步**。键盘方向键微移（Shift 一个八度），手机多了「多选」开关与批量按钮。跨层拖拽会明确提示「暂不支持」而不是静默丢音。',
        '**Multi-select in the roll.** Marquee, Ctrl-click, Shift-range and select-all, then act on the group: move, copy/paste, scale, quantise, velocity, delete — **each edit is one undo step**. Arrow keys nudge (Shift for an octave), and phones get a multi-select toggle plus batch buttons. Dragging across layers says so instead of silently losing the notes.',
      ],
    ],
  },
  {
    version: '1.106.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**图模式的失真节点也能开 2× 过采样了**：以前只有链模式的 DRIVE 会过采样，路由图刻意不参与——因为并联支路没有逐节点延迟补偿会错相。现在图里的 DRIVE 节点在 2× 下跑，并由逐节点补偿把并联支路与干路重新对齐：离格混叠从 −33.4 dB 降到 **−59.5 dB（−26 dB）**，延迟如实上报为 **62 样本 / 1.29 ms**；开着时图输出与链模式**逐位一致**，关掉时逐字节不变。',
        '**Graph-mode distortion nodes can run at 2x too.** Only the chain\'s DRIVE used to oversample; the routing graph deliberately sat it out, because without per-node delay compensation its parallel branches would drift out of phase. The graph\'s DRIVE node now runs at 2x with per-node compensation realigning every branch and the dry path: its off-grid aliasing drops from -33.4 dB to **-59.5 dB (-26 dB)**, the latency is reported honestly as **62 samples / 1.29 ms**, and with the switch off the graph renders byte-for-byte what it did before.',
      ],
    ],
  },
  {
    version: '1.105.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**包体小了一大截**：wasm 内核接入 `wasm-opt -Oz` 优化，两个核的**未压缩体积降了 31%/35%**，整个应用从 **1719 KB 降到 1523 KB（−196 KB，约 −11%）**；测试里首屏可交互时间约 1.0 s（三次取最快）。构建脚本取不到该工具时会打印原因并跳过，**绝不因此构建失败**；优化前后音频输出**逐字节相同**（三个指纹一字未动）。',
        '**The bundle got much smaller.** The wasm cores now go through `wasm-opt -Oz`, which cuts their uncompressed size by 31%/35% and takes the whole app from **1719 KB to 1523 KB (-196 KB, about -11%)**; first-interactive in the test suite measured about 1.0 s at best. The build prints a reason and skips the step if the tool is missing rather than failing, and the optimised cores render **byte-identical** audio (all three fingerprints unchanged).',
      ],
    ],
  },
  {
    version: '1.104.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**录音 take 更好用了**：take 可以**改名**（一个撤销步），可以 **A/B 试听**两个 take（键盘 A/B，播放位置不变，停止回到原来的），合并新增**覆盖**策略（同时间窗内更新的 take 覆盖旧的，原来只有并集）。另外修掉一个一直沉默的坑：**折叠成片段的层切 take 听感不会变**——现在会明确拒绝并提示「take 仅作素材」，不再让人以为切换生效了。',
        '**Recorded takes are easier to work with.** A take can be **renamed** (one undo step) and **A/B auditioned** against another (keys A/B, playhead preserved, stopping returns to the first), and merging gained an **overwrite** strategy (a newer take replaces the older material in the same time window, alongside the existing union). A silent trap is fixed too: on a layer that has been folded into clips, switching takes used to change nothing; it is now refused with "takes are material only" instead of pretending it worked.',
      ],
    ],
  },
  {
    version: '1.103.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**效果参数现在可以按节点覆盖**：路由图 6 个效果节点各自能覆盖自己的参数（延迟、混响、粉碎、EQ、drive 等，每个效果最多 4 个），不再出现「两个同类节点共用一组参数」。覆盖随分享码、`.gs1song` 与图模板携带，旧码仍可读；新增 8 条覆盖调制总线，可与既有图内调制同时把 8 个槽交给 LFO/包络。**不覆盖时与之前逐位相同。**顺带修好卡片拖拽（标题行在 Chromium 上高度为 0，此前一直没生效）。',
        '**Effect parameters can now be overridden per node.** The graph\'s six effect nodes each carry their own values (delay, reverb, crusher, EQ, drive, … up to four per effect), so two nodes of the same kind no longer share one set. Overrides travel with the share code, `.gs1song` and graph templates, and old codes still load; eight new override-modulation buses can hand eight slots to the LFOs/envelope at once alongside the existing in-graph modulation. **With nothing overridden the render is bit-for-bit what it was.** A side fix: dragging a node card works for the first time — its title row measured zero height in Chromium.',
      ],
    ],
  },
  {
    version: '1.102.0',
    date: '2026-09-13',
    kind: 'sound',
    items: [
      [
        '**普通振荡器的混叠底噪基本消失**：锯齿/方波/三角改用硬同步那套带限振荡器，全键盘离格能量从最差 **−37.4/−39.0/−49.4 dB** 降到 **−100.8/−111.3/−72.9 dB**；正弦/波表/采样不变，并补上 23.5 样本延迟补偿。代价是振荡器约 2.6× CPU；**这是有意的音色改变**，81 个预设指纹已显式重录。',
        '**The ordinary oscillators\' aliasing floor is essentially gone.** Saw, square and triangle now use hard sync\'s band-limited oscillator: their worst off-grid energy drops from **-37.4/-39.0/-49.4 dB** to **-100.8/-111.3/-72.9 dB**, while sine, wavetable and sample keep their path and gain a 23.5-sample delay compensation. The cost is about 2.6x CPU in the oscillator; **this is a deliberate change of sound**, so all 81 preset fingerprints were re-recorded.',
      ],
    ],
  },
  {
    version: '1.101.0',
    date: '2026-09-13',
    kind: 'fix',
    items: [
      [
        '**硬同步的混叠爆发修好了**：BLEP 表是「带限阶跃 − 朴素阶跃」的残差，直接跨过它的跳变做线性插值会取错边，使每次重启有 1 个过采样样本被整级错修——约每 24 秒里有 ~11 秒爆到 **−33 dB**，听感是一层周期性噪声。改为对连续带限阶跃插值再显式减掉朴素阶跃后，三种波形 × 四个从振比值的**每一个** 4 秒窗都 ≤ **−88 dB**，离散度由 86 dB 降到 8–12 dB；时域相关 ≥0.9988、峰值有界。默认关闭，关闭时逐位不变。',
        '**Hard sync\'s alias bursts are fixed.** The BLEP table is the residual `band-limited step - naive step`, so interpolating across its jump reads the wrong side and hands back a full-magnitude correction of the wrong sign: one oversampled sample per restart was mis-corrected, bursting to **-33 dB** for about 11 s out of every 24 s as an audible periodic layer. Interpolating the continuous band-limited step and subtracting the naive step puts **every** four-second window of three waveforms times four ratios at or below **-88 dB**, cutting the spread from 86 dB to 8-12 dB with the time domain still correlated at 0.9988 or better. Sync is off by default and bit-identical when off.',
      ],
    ],
  },
  {
    version: '1.99.0',
    date: '2026-09-13',
    kind: 'fix',
    items: [
      [
        '**音质门禁换了一把更可靠的尺子**：旧的「精确 bin 相减」在两数相减时会留下假底噪，纯正弦被读成 −84…−102 dB；改用 7 项 Blackman-Harris 窗（4 秒整窗、每谐波 ±2 Hz 带外功率求和）后读数稳定，正弦离谐波能量最差 **−119.1 dB**，断言收紧到 **−105 dB**。另新增「同场景连做 8 次」的稳定性断言（实测离散度 **0.00 dB**），并记录锯齿/方波/三角的真实混叠底，供下一批带限使用。引擎与音色**逐位未变**。',
        '**The audio gate now measures with a ruler that does not lie.** Its old "exact-bin subtraction" left a false floor when two nearly equal numbers were subtracted, so a pure sine read -84...-102 dB; a 7-term Blackman-Harris window (four whole seconds, power summed outside +/-2 Hz of each harmonic) is stable, puts the sine at a worst case of **-119.1 dB**, and lets the assertion tighten to **-105 dB**. A new assertion renders one scene eight times and demands agreement (measured spread **0.00 dB**), and the saw/square/triangle alias floors are recorded for the next band-limiting batch. The engine and every sound are **bit-for-bit unchanged**.',
      ],
    ],
  },
  {
    version: '1.98.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**多了一个瞬态整形效果**：路由图里新增「TRANSIENT」——ATTACK 与 SUSTAIN 两个双向旋钮，用来提升或压低一个打点的起音与延音（满档约 ±7 dB，0 表示不变），另配 MIX 干湿比；默认关闭，持续音上不引入额外谐波（实测 THD 增量 0.00），关闭或中性设置时与之前逐位相同。',
        '**A transient shaper**: the routing graph gained TRANSIENT — attack and sustain knobs that lift or push down a hit’s onset and its tail (about ±7 dB at full, 0 is unchanged), plus a dry/wet mix. It is off by default, adds no harmonic content to a held note (measured THD increase 0.00), and off or neutral renders bit-for-bit what it did before.',
      ],
    ],
  },
  {
    version: '1.97.0',
    date: '2026-09-12',
    kind: 'sound',
    items: [
      [
        '**硬同步不再有可闻的毛刺**：给同步振荡器换成专用的带限实现（朴素波形 + 相位回绕与主振重启的 BLEP/BLAMP 修正，共用同一套高精度相位），锯齿/方波/三角在同步时的混叠能量从约 −32/−34/−50 dB 降到 **−69/−69/−77 dB**（实测，整秒矩形窗精确 bin），也就是比原来低约 28–37 dB；时域上从振仍严格对齐主振周期（相关 0.9995+）。同步**关闭**时（默认）渲染与之前逐位相同。',
        '**Hard sync no longer has audible grit**: the synced oscillator now has its own band-limited implementation (naive shapes with BLEP/BLAMP corrections for both the phase wrap and the master restart, sharing one high-precision phase). Aliasing under sync drops from about −32/−34/−50 dB to **−69/−69/−77 dB** for saw, square and triangle (measured over an integer second with a rectangular window and exact bins) — roughly 28–37 dB lower — while the slave stays locked to the master’s period in the time domain (correlation above 0.9995). With sync **off** (the default) the render is sample-for-sample what it was.',
      ],
    ],
  },
  {
      version: '1.91.0',
      date: '2026-09-12',
      kind: 'feature',
      items: [
        [
          '**录音不再覆盖上一遍**：每次录完都成为一条独立的 take（内容 = 当前 take 或该层原有的音符 + 刚弹的），新的自动选中、旧的全部保留，随时切回去听。同一个音在 50 ms 内重复按算重击，替换而不是叠成双倍力度；每层最多 8 条，超出淘汰最旧的。切 take 立刻改变该层内容，播放、卷帘、MIDI/WAV/MP3 导出与分享码都跟着当前 take；分享码会带上全部 take，对方也能切。',
          '**Recording no longer overwrites the last pass**: every finished recording becomes its own take (the selected take’s notes, or the layer’s, plus what you just played), the new one is selected and the old ones stay, so switching back to hear them is a click. The same key inside 50 ms counts as a re-strike and replaces the note instead of doubling its velocity into a flam, and a layer keeps up to eight takes, retiring the oldest. Switching a take changes the layer immediately, and playback, the roll, MIDI/WAV/MP3 export and the share link all follow the selected take; the link carries every take so the other side can switch too.',
        ],
      ],
  },
  {
    version: '1.90.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**滤波可以接两级了**：滤波模块多了一排「接法」——**串联**时第二级接着第一级（斜率相加：两级低通就是 24 dB/oct，落点更陡），**并联**时两级各自处理同一路信号、由 BLEND 决定比例（0 是只有第一级、1 是只有第二级），第二级的类型、截止、共振、驱动全部独立。默认关闭，所有旧音色的声音**完全不变**。',
        '**The filter can run two stages**: the filter module gained a routing row — in **series** the second stage follows the first (the slopes add up: two low-passes make 24 dB/oct, which is how you get a steeper knee), in **parallel** both stages filter the same signal and BLEND sets the mix (0 is the first stage alone, 1 the second alone), with the second stage’s type, cutoff, resonance and drive all independent. Off by default, and every existing patch sounds exactly as before.',
      ],
    ],
  },
  {
    version: '1.89.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**滤波多了一个「连续可变」的档（SEM）**：滤波类型里新增 SEM 风格的多模滤波，12 dB/oct，一个 MORPH 旋钮从低通连续扫过带通、陷波到高通——扫它就像把滤波器的开口慢慢拧开，适合长音渐亮的 pad 和扫频，中间的陷波位置能把一个频段整个挖掉。原来的 LP/HP/BP/NT/CMB/FRM 六档与所有旧音色的声音**完全不变**（新档默认不启用）。',
        '**The filter gained a continuous mode (SEM)**: a 12 dB/oct multimode whose single MORPH knob travels from low-pass through band-pass and notch to high-pass — a continuous opening rather than one more switch position, which is what a slowly brightening pad or a sweep wants, and the notch position digs one band right out. The original LP/HP/BP/NT/CMB/FRM settings and every existing patch sound exactly as before (the new mode is off by default).',
      ],
      [
        '**断网也能打开应用了**：以前在完全离线时重新打开会看到浏览器的错误页——缓存其实齐全、Service Worker 也在控制页面，只是缓存里那份首页带着「经过重定向」的标记，而浏览器的导航请求拒绝使用这种响应（在线时这条路早就处理过，离线那条没有）。现在离线会正常进入应用，离线启动音频引擎也能用（内核与 worklet 都在缓存里）。',
        '**The app opens with the network off**: reopening it offline used to land on the browser’s own error page — the cache was complete and the Service Worker was in control, but the cached shell carried a “came from a redirect” flag that a navigation request refuses to use (the online path already handled that; the offline one did not). It now opens offline, and the engine starts offline too: the core and the worklet are both in the cache.',
      ],
    ],
  },
  {
    version: '1.88.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**预设音色被悄悄改动会当场发现**：工厂库里的 81 个音色现在各有一份「音色指纹」（电平、峰值、左右平衡、24 个频段的频谱），任何一个音色的声音变了、变响了或没声了，都会在发布前被拦下并要求写明原因。以后你不会在一次更新之后发现某个音色变成了别的样子。',
        '**A quietly changed preset is caught**: each of the 81 factory sounds now has a recorded tone fingerprint — level, peak, left/right balance and 24 frequency bands — so a sound that changed shape, changed level or went silent fails before release and has to be explained. You will not find out after an update that a patch turned into something else.',
      ],
    ],
  },
];

/** The version this build reports. */
export const CURRENT_VERSION = __APP_VERSION__;

export function releaseDateLabel(date: string, lang: 'zh' | 'en'): string {
  const [y, m, d] = date.split('-');
  return lang === 'zh' ? `${y} 年 ${Number(m)} 月 ${Number(d)} 日` : `${y}-${m}-${d}`;
}
