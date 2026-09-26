/**
 * Archived release notes: everything older than the newest 30 releases.
 *
 * The in-app changelog only shows the most recent releases so one more version
 * costs one more entry rather than another ~1.2 KB of permanently shipped
 * payload (see `src/changelog.ts` and the size note in
 * `scripts/verify-budget.mjs`). These entries are NOT forgotten: the full
 * history stays here, so "older releases" means "older than the app shows",
 * not "lost". Do not delete them, and do not import this module from runtime
 * code — that would put every historical note back into a shipped chunk, which
 * is exactly what the 30-entry limit exists to prevent.
 * `changelog.test.ts` fails if any module that runs reaches this file.
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
 * Newest archived release first. The text is moved verbatim from the pre-split
 * `src/changelog.ts`; `changelog.test.ts` proves the shipped list plus this
 * one is the original, entry for entry and field for field.
 */
export const CHANGELOG_ARCHIVE: Release[] = [
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
  {
    version: '1.87.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**界面被改坏会当场发现**：模块网格、信号流、钢琴卷帘、播放器和启动页现在都有一份「应该长什么样」的基线，深色/浅色、手机/桌面共 20 张；任何改动只要让其中一屏看起来不一样，就会在发布前报错，并留下「原来的样子 / 现在的样子 / 差在哪」三张图。以后「这次发布是不是把哪个面板弄花了」不再靠人眼抽查。',
        '**A broken layout is caught at once**: the module grid, signal flow, piano roll, player and start screen each have a recorded "what it should look like" baseline — 20 of them, across the dark and light palettes on a phone and a desktop. A change that makes any of those screens look different now fails before release and leaves the expected, actual and difference images behind. "Did this release smudge a panel?" is no longer answered by eye.',
      ],
    ],
  },
  {
    version: '1.86.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**速度与拍号（tempo map）**：播放器面板现在可以给一首曲子加**多段速度与拍号**——每段有自己的 BPM 与「几几拍」（2/4–7/4），从上一段结束处开始；每拍的长短、重音（每小节第一拍更响）、预备拍、量化网格与「小节.拍」读数全部跟着它走，所以 3/4 段里一小节就是三拍，而不是四拍。**小节数与拍号随曲目保存**，重开仍在；导出的 MIDI 会在正确的 tick 上写出 tempo 与拍号事件，用自家解析器往返可读回同一张表。',
        '**Tempo and time signature map**: the player panel can now give a song **several tempo and signature sections** — each with its own BPM and time signature (2/4–7/4), starting where the previous one ends. The length of a beat, the accents (the first beat of a bar is louder), the count-in, the quantise grid and the “bar.beat” readout all follow it, so a bar in a 3/4 section is three beats rather than four. **Sections are saved with the song** and come back after a reload, and a MIDI export writes the tempo and signature events at the right ticks — our own parser reads the same map back.',
      ],
    ],
  },

  {
    version: '1.85.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**长音更干净**：振荡器的相位累加改用双精度。单精度累加器每步的舍入误差会累积成每个分音周围的一圈「裙边」噪声（长按高音时能听成轻微沙沙声），实测从 −66 dB 降到 −87 dB；音色、音量与既有音色行为完全不变（DSP 指纹未动）。',
        '**Long notes are cleaner**: the oscillators now accumulate phase in double precision. A single-precision accumulator turns its own rounding into a skirt of noise around every partial (a faint hiss under a held high note); measured, it drops from -66 dB to -87 dB. Timbre, level and every existing patch are unchanged — the DSP fingerprint does not move.',
      ],
    ],
  },
  {
    version: '1.84.0',
    date: '2026-09-12',
    kind: 'sound',
    items: [
      [
        '**硬同步（SYNC）、sub 振荡器与噪声混合**：OSC 1 模块多了一个 **SYNC** 开关——OSC 2 每完成一个周期就把 OSC 1 的相位拉回起点，得到经典的同步主音色，用 OSC 2 的 PITCH 设比例；每个振荡器多了一组 **SUB**（关 / 低一个八度 / 低两个八度）与 **SUB LVL**，低音更厚；OSC 1 上还多了 **NOISE** 旋钮，把白噪混进声音（风声、打击感、铺底都用得上）。三者默认都是关/0，老音色一点不变。',
        '**Hard sync (SYNC), a sub oscillator and a noise blend**: the OSC 1 module gained a **SYNC** switch — OSC 2 restarts OSC 1 every time it completes a cycle, for the classic sync lead, with OSC 2’s PITCH setting the ratio; each oscillator gained **SUB** (off / one octave down / two down) with a **SUB LVL** level for a thicker bottom end; and OSC 1 gained a **NOISE** knob that blends white noise into the voice (wind, percussion, beds). All three default to off/zero, so every existing patch sounds exactly as it did.',
      ],
      [
        '**同步是带抗混叠处理的**：重启相位是一个不连续点，直接做会撒出宽带噪声，所以同步对（主振 + 从振）以 2 倍过采样运行，并经过一个 95 抽头低通（通带 19.2 kHz、阻带 −72 dB）再降采样；重启点也按**亚采样精度**对齐（用主振已越过零点多少来定从振的起始相位），而不是落在采样格上。',
        '**Sync is anti-aliased**: restarting a phase is a discontinuity, and doing it naively sprays broadband hash, so the sync pair runs at 2x oversampling through a 95-tap low-pass (flat to 19.2 kHz, -72 dB stopband) before being decimated; the restart is also placed at **sub-sample accuracy** (from how far past the wrap the master already is) instead of on the sample grid.',
      ],
    ],
  },
  {
    version: '1.83.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**片段编排：把一层折叠成片段，然后拖动、复制、循环铺排**：播放器面板的层条上多了「折叠成片段」——这一层的音符变成一个片段（循环窗口默认对齐到整小节，所以折叠后听起来完全一样），选中片段后可以前后移一个窗口、**复制**、改**循环窗口长度**、加减**铺排次数**，时间线上画出片段块与每一次循环的分隔线。片段内容仍用钢琴卷帘编辑（卷帘工具栏多一个「片段」选择器）。这一层被编排后，这一层就按片段播放；其它层没被折叠就照原样播放。导出 MIDI / WAV / MP3 跟随编排。',
        '**Arrangement clips: fold a layer into a clip, then drag, copy and loop it**: the player panel’s layer strip gained “Fold into a clip” — the layer’s notes become one clip (its loop window lines up with whole bars, so a folded layer sounds exactly as it did), and a selected clip can be moved a window at a time, **duplicated**, have its **loop window** widened or narrowed and its **repeat count** raised or lowered, with the timeline drawing the clip blocks and a tick at every loop. The clip’s notes are still edited in the piano roll (its toolbar gained a clip picker). A layer that is arranged plays its clips; a layer that is not keeps playing as written, and MIDI / WAV / MP3 exports follow the arrangement.',
      ],
    ],
  },
  {
    version: '1.82.0',
    date: '2026-09-12',
    kind: 'sound',
    items: [
      [
        '**OSC 2 现在可以塑形 OSC 1：FM 相位调制与 RING 环形调制**：OSC 1 模块多了 **FM** 与 **RING** 两个旋钮——FM 是 OSC 2 推动 OSC 1 相位的深度（经典 FM 的明亮、金属味，用 OSC 2 的 PITCH/DETUNE 设“比例”；把 OSC 2 的 LEVEL 关掉就是纯 FM，听不到调制器本身），RING 是把两个振荡器相乘（铃声、边带、非谐音色；两个 LEVEL 决定强度）。两者默认都是 0，所以老音色听起来一模一样。',
        '**OSC 2 can now shape OSC 1: FM phase modulation and RING ring modulation**: the OSC 1 module gained **FM** and **RING** knobs — FM is how far OSC 2 pushes OSC 1’s phase (the bright, metallic sound of classic FM; set the ratio with OSC 2’s PITCH/DETUNE, and turn OSC 2’s LEVEL down for pure FM where the modulator is inaudible), while RING multiplies the two oscillators (bell tones, sidebands, inharmonic colour; the two LEVELs set how strong it is). Both default to 0, so every existing patch sounds exactly as it did.',
      ],
      [
        '**两者都能被包络、LFO 和调制矩阵驱动**：调制矩阵的目标列表新增 **FM** 与 **RING**，所以“包络扫 FM 深度”就是最经典的 FM 亮度包络；分享码与预设会一起带走这两个参数。',
        '**Both can be driven by an envelope, an LFO or the modulation matrix**: the matrix’s destination list gained **FM** and **RING**, so “envelope to FM depth” is the classic FM brightness sweep; share codes and presets carry the two parameters with the patch.',
      ],
    ],
  },
  {
    version: '1.81.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**导入损坏的 MIDI 文件更稳了**：内容被截断的文件以前可能直接报错，现在会尽量把能读的部分读出来；损坏字节造出的音符、力度、速度都会先夹到合法范围（音符 0–127、力度 0–1、速度有限），谎报轨道数量的文件也不会再让导入卡一下。播放器导入、分享码里的曲目、导出的 `.mid` 都走同一条路径。',
        '**Importing a damaged MIDI file is sturdier**: a truncated file used to fail outright and now gives up only what it cannot read, note numbers, velocities and tempos from corrupt bytes are clamped into legal ranges (0–127, 0–1, a finite BPM), and a file that lies about how many tracks it holds no longer stalls the import. The player, a song inside a share link and an exported `.mid` all take the same path.',
      ],
      [
        '**导入的音色文件会显示自己的名字**：以前从补丁文件导入的音色虽然已经生效，顶栏还是显示上一个音色的名字，现在会显示文件名。',
        '**An imported patch file shows its own name**: the sound was already live, but the top bar kept showing the name of the patch it replaced; it now names the file you imported.',
      ],
      [
        '**所有解析器都加了随机输入测试**：分享码、补丁文件、`.gs1song`、MIDI、Scala 音律表、WAV、存储波形，每种每个版本跑一万个随机与「合法文件的变异」输入，保证不崩溃、不卡死、不产出非法数据。',
        '**Every parser now has a fuzzer**: share codes, patch files, `.gs1song`, MIDI, Scala tuning files, WAV and stored waveforms each get ten thousand random and mutated inputs on every run, so none of them can crash, hang or hand the rest of the app an illegal value.',
      ],
    ],
  },
  {
    version: '1.80.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**时间线上直接改音符**：播放器面板里的缩略时间线多了一个「音符」模式——点选音符、拖动改位置、拖右缘改长度、双击删除，都按 1/16 吸附；选中后下面还有一排按钮（提前/推后一格、缩短/加长、删除），手机上不拖拽也能编辑。它和钢琴卷帘是**同一份数据、同一套撤销**：在时间线上挪一个音，打开卷帘就在新位置；改动立刻随曲目保存，重开仍在。原来的行为（拖动整层前后移动、点一下定位播放位置）原样保留在默认的「编排」模式里。',
        '**Edit notes directly on the timeline**: the mini timeline in the player panel gained a “Notes” mode — select a note, drag it to move, drag its right edge to resize, double-click to delete, all snapping to sixteenths, plus a row of buttons (earlier/later one step, shorter/longer, delete) so a phone needs no dragging at all. It shares one document and one undo history with the piano roll: move a note on the timeline and it is already moved in the roll, and an edit is saved with the song the moment you let go, so it is still there after a reload. The old behaviour — dragging the whole layer, tapping to seek — is untouched in the default “Arrange” mode.',
      ],
      [
        '**多轨文件不再被卷帘压成一条轨**：钢琴卷帘现在一次编辑一层（工具栏多了「层」选择器），保存和导出 MIDI 时其余各层原样保留；内置示范曲目第一次编辑会自动存成副本并提示一次。',
        '**Multi-track files are no longer flattened by the roll**: the piano roll now edits one layer at a time (a “Layer” picker appears in its toolbar), and saving or exporting MIDI keeps every other layer as it was. Editing a built-in demo saves a copy first, with a message saying so.',
      ],
    ],
  },
  {
    version: '1.79.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**空闲界面更省电、更跟手**：示波器、频谱、迷你波形、滤波曲线和电平表以前不管有没有新数据都在每帧重画，现在只在画面真的变化时重画；启动页与各抽屉的全屏模糊背景也去掉了。修好后同一台机器上界面帧率从 7.5 fps 升到 60 fps，低端机和手机上更省电、拖动更顺，在电脑上跑测试也快了一倍。',
        '**The idle interface is lighter and smoother**: the scope, spectrum, mini waveforms, filter curve and meters used to repaint every frame whether or not anything had changed, and now redraw only when the picture actually changes; the full-screen blurred backdrops on the start screen and the drawers are gone as well. On the same machine the interface went from 7.5 fps to 60 fps: less battery drain and smoother dragging on low-end phones, and tests on a laptop run about twice as fast.',
      ],
    ],
  },
  {
    version: '1.78.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '**效果路由图里同一个效果可以用在多个节点**：算法混响、合唱、镶边、移相、过载现在每个节点都有自己的一套内部状态——两个合唱各摆各的、两个混响就是两间不同的房间，并联做层次一下子方便很多。',
        '**The routing graph can use the same effect in more than one node**: the algorithmic reverb, chorus, flanger, phaser and overdrive now keep their own state per node — two choruses sweep independently, two reverbs are two different rooms, and layering them in parallel is finally straightforward.',
      ],
      [
        '**延迟与卷积混响（IR）仍然每个音色只能用一次**：一条延迟线 768 KB、一份卷积 787 KB，六份放不进 8 MiB 的内存里。第二个同类节点会原样直通（不再共用一条线），编辑器里这样的选项会显示「已占用」并不可选，免得白选。顺带修掉一个隐患：以前把同一效果放到两个节点会共用内部状态、互相干扰听起来不对。',
        '**The delay and the convolution reverb still run once per patch**: a delay line is 768 KB and a convolver 787 KB, and six of either does not fit in the 8 MiB the engine has. A second node of those kinds passes its input through (it no longer shares one line), and the editor marks such an option “in use” and disables it so it cannot be picked by mistake. This also fixes a real hazard: two nodes of the same effect used to share internal state and interfere.',
      ],
    ],
  },
  {
    version: '1.77.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '**分享链接会压缩了**：带曲目的链接先压缩再编码，一首五分钟的曲子从约 36,000 个字符降到约 1,500 个（小 96%），以前长曲目只能下载 `.gs1song` 文件，现在基本都能直接发链接；纯音色的链接格式不变，旧链接照常能打开。',
        '**Share links are compressed now**: a link that carries a song is deflated before it is encoded, so a five-minute arrangement goes from about 36,000 characters to about 1,500 (96% smaller) — long songs that used to need a `.gs1song` file now travel as a link. Patch-only links keep their format and old links still open.',
      ],
      [
        '**效果路由图的连线更好用了**：点连线现在是「选中」而不是直接断开（改增益、误触都不会掉线），选中后可以直接在连线上调增益，不是 100% 的连线会显示百分比；键盘也能全程操作——Tab 到端口用回车选来源、再回车落到输入，连线本身可聚焦，回车选中后即可用滑杆调增益。',
        '**The routing-graph wires are easier to work with**: clicking a wire now selects it instead of cutting it (no more losing a connection to a stray click), the selected wire carries its own gain slider, and a connection that is not at 100% shows its percentage. The whole editor works from the keyboard: tab to a port and Enter picks a source, Enter again lands it on an input, and a wire itself takes focus so Enter selects it and the slider sets its gain.',
      ],
    ],
  },
  {
    version: '1.76.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '**效果路由图的卡片可以拖动摆放**：拖卡片标题就能挪位置，连线会跟着走；摆放属于工作区（不进音色），换曲目/换音色都在，重开也还在；「重置布局」一键回到默认排布。',
        '**The routing-graph cards can be arranged**: drag a card by its title and the wires follow. The arrangement belongs to the workspace rather than to the patch, so it survives switching patches and reloading, and “Reset layout” puts the board back.',
      ],
      [
        '顺带把路由图的批量改动做成**一次提交**（重建/首次连线要写 37 个参数）：界面不再为了一个动作重绘几十次，慢设备上明显更跟手。',
        'Bulk changes to the graph now land as **one change** (a rebuild or the first edit writes 37 parameters), so the interface no longer redraws dozens of times for one action — noticeably smoother on slow devices.',
      ],
    ],
  },
  {
    version: '1.75.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '**更新提示会说更新了什么**：检测到新版本时，提示条里除了「立即更新」，还会显示新版本的**第一条更新内容**，先看清楚再刷新也不迟。',
        '**The update banner says what changed**: when a new build is ready it now shows the first line of that release\'s notes next to the update button, so you can see what you are getting before reloading.',
      ],
    ],
  },
  {
    version: '1.74.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '**分享一份完整编曲**：预设库里的「分享」现在会把当前曲目与它的层混音（静音/独奏/音量/声像/时间偏移）一起放进链接——对方打开链接就能看到、能播同一首曲子，混音也一模一样。曲目太长大到链接装不下时，会自动改成一个 `.gs1song` 文件（对方在预设库「导入」即可）。内置示范曲不会被分享。',
        '**Share a whole arrangement**: “Share” in the preset library now puts the current song and its layer mix (mute/solo/level/pan/time offset) into the link — the other side opens it and gets the same song, playable, with the same balance. If the song is too long for a link it becomes a `.gs1song` file instead, which the other side imports from the preset library. Built-in demos are never shared.',
      ],
    ],
  },
  {
    version: '1.73.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '新增**效果路由图**：六个效果位置现在不只是顺序，而是可以连线的节点。每个节点最多两路输入（可以取干声或任一更靠前节点的输出，各自带增益），任一节点都能送到输出，于是串联、并联送出、一分多路、两路求和都能做。入口在 FX 模块的「效果路由图」、信号流视图工具栏，以及设置抽屉；手机默认是列表式的连接编辑，桌面上可以拖线（点输出再点输入也行）。',
        'A **routing graph** for the effects: the six positions are no longer only an order but nodes you can wire. Each node sums up to two inputs (the dry signal or any earlier node, each with its own gain) and any node can reach the output, so series, parallel sends, fan-out and two-into-one summing are all possible. Open it from the FX module, the signal-flow toolbar or the settings drawer; phones get a list editor, desktops can drag wires (tap output then input works too).',
      ],
      [
        '路由图改动前，声音还是原来的信号链；开始连线时会自动切到路由图、并以当前信号链为起点，所以不会突然变声。想回去就按「从信号链重建」。',
        'Until you change something, the sound is still the old chain; the first edit switches to the graph seeded from that chain, so nothing jumps. “Rebuild from chain” puts it back.',
      ],
    ],
  },
  {
    version: '1.72.0',
    date: '2026-09-11',
    kind: 'fix',
    items: [
      [
        '修复 **Firefox 里点「启动音频引擎」后一直停在「正在启动…」、界面进不去**的问题。现在会正常进入；如果浏览器当时还不让出声，会出现「点按恢复声音」的提示，点一下即可，之后弹琴、播放都会再自动尝试恢复。',
        'Fixed **Firefox getting stuck on “Starting…” after tapping the start button**, which left the interface unreachable. Startup now completes; if the browser is still holding the audio back you get a “tap to restore sound” hint, and playing or starting playback retries automatically.',
      ],
    ],
  },
  {
    version: '1.71.0',
    date: '2026-09-11',
    kind: 'fix',
    items: [
      [
        '**导出跟随当前混音**：多轨曲目里如果静音了某层、调过每层音量或声像、拖动过时间线，导出的 MIDI 与 WAV/MP3 现在和听到的完全一致（以前导出的是文件原样，混音被丢掉）。MIDI 里音量写进力度、声像写进 CC10、时间偏移写进时间，DAW 打开就是同一份编曲。',
        '**Exports now follow your mix**: if you muted a layer, changed per-layer level or pan, or nudged a layer on the timeline, the exported MIDI and WAV/MP3 match what you hear. (They used to export the raw file and drop the mix.) In the MIDI file the level becomes velocity, pan becomes CC10 and the time offset becomes the note timing, so a DAW opens the same arrangement.',
      ],
    ],
  },
  {
    version: '1.70.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '多轨曲目的每层多了一个**声像**滑杆：把某一层推到左边或右边，两层就能各占一边，比单纯调音量更容易分辨。声像和静音/独奏/音量、时间偏移一样属于这首曲子，重开还在；演奏时按下的音符仍然居中，不受影响。',
        'Each layer of a multi-track song now has a **pan** slider: push a layer left or right and two layers can sit apart, which is far easier to tell apart than level alone. Like mute/solo/level and the time offset, the pan belongs to the song and comes back when you reopen it; notes you play by hand stay centred.',
      ],
    ],
  },
  {
    version: '1.69.0',
    date: '2026-09-11',
    kind: 'sound',
    items: [
      [
        '导入脉冲响应（IR）的卷积混响改为**把每个 hop 的运算摊到整段时间里**：以前是每约 21 毫秒集中算一次长 IR，最忙的那一个音频块明显更重，机器一忙就容易被顶掉；现在这部分工作分散到 hop 内的各个块，峰值明显下降（2 秒 IR 实测最差块从约 1.5 毫秒降到约 1.2 毫秒），声音与之前完全一致——只是更稳。',
        'Convolution reverb with an imported impulse response now **spreads each hop\'s work across the hop** instead of doing it all at once every ~21 ms. That single heavy block was the first thing a busy machine would drop; the work is now distributed over the blocks inside the hop, which cuts the peak noticeably (a 2 s IR measured ~1.5 ms worst block before, ~1.2 ms now) with the identical sound — just steadier.',
      ],
    ],
  },
  {
    version: '1.68.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '缩略时间线现在可以**直接操作**：在某一层的时间线上点一下就把播放位置跳到那一点；左右拖动则整层前后移动，音符跟着一起走，可以做出错位的层次感。挪动属于这首曲子本身，重新打开还会保留（左右最多各挪一分钟，移到起点之前的音符不再发声，画面上也不再画出来）。',
        'The mini timelines are now **controls**: tap one to jump the transport to that point, or drag sideways to move that whole layer in time — the notes travel with it, which is an easy way to offset layers against each other. The nudge belongs to the song and comes back when you reopen it (up to a minute either way; notes pushed before the start stop sounding and stop being drawn).',
      ],
    ],
  },
  {
    version: '1.67.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '多轨曲目的轨道条每层多了一条**缩略时间线**：该层音符按时间排成小块，播放时有一条跟着走的播放头，一眼就能看出哪层在什么时候有内容（时间线的第一步，之后再做可拖拽的编辑）。',
        'Each layer in a multi-track song now has a **mini timeline**: its notes as blocks laid out in time, with a playhead that follows the transport, so it is obvious at a glance which layer plays when. The first step of the timeline; dragging comes later.',
      ],
    ],
  },
  {
    version: '1.66.0',
    date: '2026-09-11',
    kind: 'feature',
    items: [
      [
        '新增**持续负载基准**（`npm run bench`）：跑 6 秒「双锯齿齐奏 + 全套效果 + 16 个持续音」的最坏情况，把平均/p50/p99/最差耗时与占用率写进 `docs/notes/performance.md`（可随提交看历史），并作为门禁检查——当前实测平均 **243 µs/块（占 2.67 ms 预算的 9.1%）**，最差 940 µs，无溢出、无音频线程分配。',
        'Added a **sustained-load benchmark** (`npm run bench`): six seconds of the worst case (two unison saws, the whole effect chain, sixteen held notes), writing mean/p50/p99/worst block time and the budget share into `docs/notes/performance.md` so the history is visible in git — and gating on it. Currently **243 µs per 128-frame block (9.1% of the 2.67 ms budget)**, worst 940 µs, no overruns and no audio-thread allocation.',
      ],
    ],
  },
  {
    version: '1.65.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**分层音色可以存成预设 / 导出 / 分享了**：用了第二层的音色保存时会把第二层与「按键分配（单层 / 叠加 / 分区 + 分界音）」一起带上——导出成 `.gs1.json`、分享链接、预设库都完整还原；没有用第二层的音色仍然和以前一样短。',
        '**A layered patch can now be saved, exported and shared**: when a patch uses the second layer, saving it carries the layer *and* the key routing (single / layer / split, with the split note) — the `.gs1.json` export, the share link and the preset library all restore it. A patch without a layer is exactly as small as before.',
      ],
      [
        '反过来的照顾：加载一个**没有**第二层的音色（例如内置预设）时，不会动你自己的第二层；分享链接里没有第二层时，也不会覆盖对方的。',
        'And the other way round: loading a patch with **no** layer (a factory preset, say) leaves your own second layer alone, and a share link without one does not overwrite the recipient\'s.',
      ],
    ],
  },
  {
    version: '1.64.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '**英文界面不再撑坏排版**：版面是按中文（2–4 个字）留的宽度，英文同样的意思可能长一倍。现在固定位置上的文字一律单行 + 省略号（`…`），一行放不下时整行换行而不是把别的控件挤出屏幕；顶栏与音色名尤其明显。',
        '**English labels no longer break the layout**: the design is sized for Chinese (two to four glyphs), and the same label in English can be twice as wide. Text in a fixed slot is now one line with an ellipsis, and rows wrap when they run out of room instead of pushing their neighbours off screen — most visible in the top bar and the patch name.',
      ],
      [
        '几个过长的英文按钮改成更短的写法（`Open audio settings` → `Audio settings`、`Check for updates` → `Updates`、`Instance 1 only` → `Instance 1`、`Key routing` → `Routing`），避免省略号切掉意思。',
        'A few over-long English buttons were shortened (`Open audio settings` → `Audio settings`, `Check for updates` → `Updates`, `Instance 1 only` → `Instance 1`, `Key routing` → `Routing`) so the ellipsis never has to cut the meaning.',
      ],
      [
        '新增「英文版排版」端到端用例：切到英文后，在**手机竖屏与桌面**两种宽度下遍历模块视图、设置抽屉与预设库，断言没有任何容器把内容挤出自己的右边界、页面也不会横向滚动。',
        'Added an "English layout" end-to-end test: after switching to English it walks the module view, the settings drawer and the preset library at **phone portrait and desktop** widths, asserting that nothing overflows its own right edge and the page never scrolls sideways.',
      ],
    ],
  },
  {
    version: '1.63.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '手机竖屏顶栏重新分行：**音色名独占一行、完整显示**（不再被挤成「Re…」），「模块 / 信号流」移到下一行的等宽两格，左上角的按钮也不会再被挤出屏幕。',
        'The phone portrait top bar is laid out in rows again: the **patch name gets a full row and reads in full** (no more "Re…"), the Modules / Signal flow switch moves to an equal-width pair on the next row, and the buttons on the left can no longer be pushed off screen.',
      ],
      [
        '启动页重做：上面是 **logo + 版本号**，下面是一枚**更小**的启动按钮，去掉了「浏览器需要一次点击…」这行说明；logo 的波形会缓慢流动、按钮有轻微呼吸光晕（系统开启「减弱动态效果」时自动静止）。',
        'The start screen was redone: **logo and version** on top, a **smaller** start button below it, and the "browsers need one tap…" line is gone. The logo\'s waveform drifts slowly and the button has a soft breathing glow — both stop when the system asks for reduced motion.',
      ],
    ],
  },
  {
    version: '1.62.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '多轨曲目的**混音设置会跟着曲目保存**：调好的静音/独奏/每层音量在重开页面、切换曲目再切回来之后都还在（以前一刷新就回到默认）。',
        'A multi-track song\'s **mix is saved with the song**: the mute, solo and per-layer levels you set survive a reload and switching away and back (they used to reset on every refresh).',
      ],
    ],
  },
  {
    version: '1.61.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '多轨曲目的轨道条新增**每层音量滑杆**：`M`（静音）、`S`（独奏）之外可以单独调每一层的响度，方便把伴奏压下去、把主旋律顶上来。拉到最低时音符仍然存在（只是以最小力度播放），不会把编曲删掉。',
        'The track strip for multi-track songs gained a **volume slider per layer**: besides `M` (mute) and `S` (solo) each layer has its own level, so a backing part can be pushed down under the lead. At the bottom of the slider the notes still exist — they just play at the smallest velocity — rather than being deleted from the arrangement.',
      ],
    ],
  },
  {
    version: '1.60.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**多轨 MIDI 分轨导出**：如果当前曲目是多轨文件（导入的格式 1），导出的 `.mid` 现在是 **format 1** —— 一条指挥轨（速度 + 曲名）加上每层一条轨道（带轨道名），在 DAW 里会分成独立轨道而不是合成一坨；单轨曲目仍导出 format 0，与以前完全一致。',
        '**Multi-track MIDI export**: when the current song has layers (an imported format-1 file), the exported `.mid` is now **format 1** — a conductor track (tempo and title) plus one named track per layer, so a DAW imports them as separate tracks instead of one merged blob. Single-track songs still export as format 0, unchanged.',
      ],
    ],
  },
  {
    version: '1.59.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '手机竖屏：**音色名横幅不再独占一行**，改为和上方图标同一行的紧凑胶囊（图标尺寸不变），模块因此整体上移；音色名与分类标签的字号也同步收紧。',
        'Phone portrait: the **patch name banner no longer takes a row of its own** — it is a compact pill in the same row as the icon buttons (their size is unchanged), so the modules start higher. The name and tag type are tightened to match.',
      ],
      [
        '「启动音频引擎」按钮重做：去掉那个突兀的播放图标，改成一枚干净的大按钮（更圆、更大的字号，副提示用分隔线放在下面）。',
        'The Start Audio Engine button was redone: the jarring play glyph is gone, replaced by a clean large button — rounder, bigger label, with the hint under a divider.',
      ],
      [
        '**触屏尺寸**：设置里的 `1 / 2` 正在编辑切换从 52×34 变成 56×44 的按钮，设置抽屉里的按钮/下拉、播放器的层静音/独奏（M/S）在触屏设备上一律不小于 44px——按手指的粒度，而不是鼠标的精度。',
        '**Touch sizing**: the `1 / 2` editing switch in Settings is now a 56×44 button instead of 52×34, and every button and select in the settings drawer plus the player\'s layer mute/solo (M/S) is at least 44px on touch devices — sized for a finger, not a cursor.',
      ],
    ],
  },
  {
    version: '1.58.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '多轨 MIDI 现在**分层播放**：导入格式 1 文件后，播放器上方会出现一条轨道条，每层都有 `M`（静音）与 `S`（独奏）；播放中按下立即生效（被静音层正在发声的音会立刻收掉）。',
        'Multi-track MIDI now **plays by layer**: import a format-1 file and a track strip appears above the player list, with `M` (mute) and `S` (solo) per layer. Changes take effect immediately while playing — a muted layer\'s sounding notes are released rather than ringing on.',
      ],
      [
        '单轨文件（含内置曲目与录音）行为不变，仍然只有一层、没有轨道条。',
        'Single-track files (including the built-in songs and recordings) behave exactly as before: one layer, no strip.',
      ],
    ],
  },
  {
    version: '1.57.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '导入的**多轨 MIDI 现在会保留轨道分层**：格式 1 文件里的每条音轨（含轨道名）都会被记下来，钢琴卷帘仍显示合并后的音符。这是「多轨播放 / 分轨导出 / 时间线」的第一步。',
        'Imported **multi-track MIDI now keeps its layers**: every track of a format-1 file (with its name) is remembered, while the piano roll still edits the merged note list. This is the groundwork for multi-track playback, per-track export and the timeline.',
      ],
    ],
  },
  {
    version: '1.56.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**分享链接现在也带第二层音色**：如果这个音色用了第二层，链接里会一并带上（对方打开就是完整的两层）；如果没用第二层，链接长度不变，而且**不会**把对方的第二层覆盖掉。',
        '**Share links now carry the second timbre too**: if the patch uses a second layer, the link includes it, so the recipient hears the whole sound. A patch without a layer produces the same short link as before, and does not overwrite the recipient\'s own layer.',
      ],
    ],
  },
  {
    version: '1.55.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**第二层音色可以用了**：设置 →「第二层音色」里选 `1` / `2` 决定面板正在编辑哪一层（所有旋钮、波形、包络、调制的改动都作用在该层，切回去第一层原样不变），并选按键分配：**只用第 1 层 / 叠加两层 / 按音高分区**（分区时可选分界音）。',
        '**The second timbre is playable**: in Settings → Second timbre, `1` / `2` picks which layer the panels are editing — every knob, wave, envelope and modulation change applies to that layer, and switching back leaves the first exactly as it was — and Key routing chooses Instance 1 only, Layer both, or Split by key (with a split note).',
      ],
      [
        '第二层的参数存在音色里（重开、场景、撤销重做都会带上），按键分配跟着工作区保存；默认仍是「只用第 1 层」，旧音色与分享链接不受影响。',
        'The second layer is stored with the patch (it survives a reload, scenes and undo/redo) and the key routing is saved with the workspace. The default is still Instance 1 only, so existing patches and share links are unaffected.',
      ],
    ],
  },
  {
    version: '1.54.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**设置有了自己的入口**（顶栏「设置」，和「预设库」同级），不再挤在预设库底部。里面按用途分组：**工作区**（场景）、**演奏**（调律 / 力度曲线 / 音频设置）、**界面**（主题 / 高对比 / 语言 / 振动 / 重置布局）、**关于与文档**（使用指南 / 更新记录 / 检查更新），以后加东西有地方放。',
        '**Settings have their own entry** now (the Settings button in the top bar, beside the preset library) instead of living at the bottom of it. They are grouped by purpose: **Workspace** (scenes), **Playing** (tuning, velocity curve, audio settings), **Appearance** (theme, contrast, language, haptics, reset layout) and **About & docs** (manual, changelog, check for updates) — so the next control has a home.',
      ],
      [
        '下拉框不再为了对齐被强行拉长（宽度按内容来），预设库底部只剩「导入 / 导出 / 分享」三个等宽按钮。',
        'Selects are no longer stretched to fill a column — they size to their content — and the preset library keeps just three equal-width buttons: Import, Export and Share.',
      ],
      [
        '测试新增 **iPhone / iPad 横竖屏** 六种尺寸的端到端用例：启动按钮完整可见、没有横向滚动、设置入口可达、抽屉不超出屏幕、键盘在屏内。',
        'Added end-to-end coverage for **six iPhone / iPad sizes in both orientations**: the start button fits, nothing scrolls sideways, the settings entry is reachable, the drawer stays on screen and the keyboard is visible.',
      ],
    ],
  },
  {
    version: '1.53.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复「关掉标签页再打开后没有声音、刷新也没用」：浏览器有时会在你还没点任何按钮时就把音频上下文标记为「已运行」，程序据此以为引擎已经启动，于是藏起了启动按钮——但此时声音引擎其实根本没建起来，于是没有声音、示波器与频谱全黑，刷新还会重复同样的状态。现在只有引擎**真正启动完成**才会收起启动按钮。',
        'Fixed "no sound after closing and reopening the tab, and refreshing does not help": the browser can mark the audio context as running before any tap, and the app took that as "the engine is started" and hid the start button — while no sound engine had actually been built. The result was silence, black scope and spectrum, and a refresh that repeated the same state. The start button is now only dismissed once the engine has genuinely started.',
      ],
      [
        '如果你现在遇到这个状态：强刷一次（Mac ⌘⇧R / Windows Ctrl+Shift+R）后点一下「启动音频引擎」即可恢复。',
        'If you are in that state right now: hard-refresh once (⌘⇧R on macOS, Ctrl+Shift+R on Windows) and tap Start Audio Engine — that is all it takes.',
      ],
    ],
  },
  {
    version: '1.53.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '预设库底部重新排版：按钮排成整齐的等宽网格（一行四个），调律/场景/力度曲线也各自成行、左右对齐，不再是长短不一的一团。',
        'The bottom of the preset library is laid out again: the buttons form a regular equal-width grid (four per row), and tuning, scenes and velocity curve each get their own aligned row instead of a ragged pile.',
      ],
      [
        '设置区不再**固定占住**预设列表的高度：它跟着列表一起滚动，所以打开预设库时看到的是更多音色，而不是半屏按钮。',
        'The settings no longer **occupy a fixed slice** of the preset list: they scroll with it, so opening the library shows more sounds instead of half a screen of buttons.',
      ],
    ],
  },
  {
    version: '1.53.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '引擎现在支持**两层音色**（Layer / Split）：同一台合成器里可以有两套完整的振荡器/滤波器/包络/调制设置，共享效果器与总输出。这一版先把两层引擎和按键/力度路由做进核心（下一版接入界面）。',
        'The engine now supports **two timbres at once** (Layer / Split): two complete oscillator, filter, envelope and modulation setups inside one synth, sharing the effect chain and master output. This release lands the engine and the key/velocity routing; the controls follow in the next one.',
      ],
      [
        '默认仍是单层：没有打开分层时，所有音色与之前完全一致（音色文件、分享链接都不受影响）。',
        'Single remains the default: with layering off, every patch behaves exactly as before, and saved patches and share links are unaffected.',
      ],
    ],
  },
  {
    version: '1.52.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复 Safari/Chrome 升级后打不开的问题：某些静态托管会把 `/index.html` 重定向到 `/`，离线缓存把这次重定向的结果当页面交回浏览器，于是第二次访问会直接跳到「网页可能暂时无法访问」。现在离线缓存改为请求不会重定向的地址，并且即使遇到重定向也会重新包装后再交给浏览器。',
        'Fixed the blank/error page on Safari and Chrome after an update: some static hosts redirect `/index.html` to `/`, and the offline cache was handing that redirect back to the browser as the page, so the second visit landed on "this page might be down". The cache now asks for a URL that does not redirect, and rebuilds the response if it ever gets one.',
      ],
      [
        '如果你现在正好卡在这个错误页：**强制刷新一次**（Mac: ⌘⇧R，Windows: Ctrl+Shift+R）即可恢复；之后正常刷新不会再出现。',
        'If you are stuck on that error page right now: **one hard refresh** (⌘⇧R on macOS, Ctrl+Shift+R on Windows) brings it back, and normal refreshes will be fine afterwards.',
      ],
    ],
  },
  {
    version: '1.52.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**导入的 MIDI 与录制片段现在会保存在本机**：重开页面后它们仍在曲库里，并且还是上次选中的那一首——以前一次刷新就全丢了。',
        '**Imported MIDI files and recordings are now kept on the device**: they are still in the player library after a reload, with the same track selected — previously one refresh lost them.',
      ],
      [
        '最多保留 12 首、且体积超限的曲目只在本次会话内有效（避免占满浏览器存储）；来自更新版本的曲库文件会被忽略而不是读错。',
        'Up to 12 user tracks are kept, and anything oversized stays for the session only (so a phone is not filled up); a library written by a newer version is ignored rather than misread.',
      ],
    ],
  },
  {
    version: '1.51.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '启动更快：DSP 内核改为**边下载边编译**（浏览器支持时），首屏点「启动音频引擎」的等待更短；「音频设置」里的内核一行会显示是否为流式编译。若服务器或浏览器不支持，会自动退回原来的下载方式，功能不受影响。',
        'Faster start: the DSP core is **compiled while it is still downloading** where the browser allows it, so the wait after tapping Start is shorter. The core line in Audio settings says whether it took that path; without support, the app falls back to the old download, unchanged.',
      ],
      [
        '持续集成现在也跑**音质门禁、体积预算、lint**，并在三个浏览器引擎（Chromium / WebKit / Firefox）上跑端到端测试，平台相关的问题不会再等到用户发现。',
        'Continuous integration now also runs the **audio quality gates, the payload budget and lint**, and runs the end-to-end suite on all three browser engines (Chromium / WebKit / Firefox), so platform-specific problems are caught before a player finds them.',
      ],
    ],
  },
  {
    version: '1.50.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '波形新增 **SMP 采样**：导入一段自己的音频（WAV/AIFF/FLAC/MP3）当作振荡器音源，鼓、音效、人声切片、真实乐器单音都能直接用。选 `SMP` 后会出现「导入采样」以及 `ROOT`（这段音频原本的音高）与 `ONE / LOOP / P-P`（一次性 / 循环 / 乒乓循环，后两者还能调循环起止点）。',
        'A new **SMP** wave plays your own audio (WAV/AIFF/FLAC/MP3) as an oscillator source, so drums, effects, vocal chops and real instrument notes can be played from the keyboard. Pick `SMP` and an Import row appears with `ROOT` (the pitch the file was recorded at) and `ONE / LOOP / P-P` (one-shot, loop, ping-pong, the last two with loop points).',
      ],
      [
        '采样按音高变速播放并**按八度分层抗混叠**（高音不会出现折叠噪声），文件超过 4 秒会截断，导入的音频保存在本机、重开仍在、导出会一并渲染。',
        'Samples are pitch-shifted and **band-limited per octave**, so high notes do not fold; files over 4 s are truncated, and the imported audio is kept on the device, survives a reload and is rendered by export.',
      ],
    ],
  },
  {
    version: '1.49.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '音色存档、分享链接、工作区与场景现在都带**格式版本号**：以后升级时旧数据会自动按新格式读取，不会再出现「某个参数悄悄变回默认」的情况。',
        'Saved patches, share links, the workspace and scenes now carry a **format version**: when a later release changes the format, older data is migrated on load instead of quietly losing a parameter back to its default.',
      ],
      [
        '如果存档来自**更新的版本**（例如先用了新版又回退），程序不会读出一半参数，而是回退到初始状态并保留原存档副本，方便新版再取回。',
        'If a document comes from a **newer build** (you tried a newer version and went back), the app no longer half-reads it: it falls back to the initial state and keeps the original document aside so the newer build can still recover it.',
      ],
    ],
  },
  {
    version: '1.48.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '混响新增第二种引擎：**卷积混响（IR）**。在混响单元里把 ALGO 切到 IR，即可导入一段脉冲响应文件（WAV/AIFF/FLAC/MP3），用真实空间的采样做混响；`TRIM` 调湿声大小，文件超过 2 秒会截断，响度按能量自动归一化，所以不同 IR 的干湿比例是可比的。',
        'The reverb has a second engine: **convolution (IR)**. Switch ALGO to IR in the reverb unit and import an impulse response (WAV/AIFF/FLAC/MP3) to reverb in a real space; `TRIM` sets the wet level, files longer than 2 s are truncated, and the level is energy-normalised so the mix knob means the same thing for every response.',
      ],
      [
        '导入的 IR 保存在本机、重开还在，切回 ALGO 或用 `✕` 移除都不会影响原有算法混响；导出的音频会一并渲染。',
        'The imported response is kept on the device and survives a reload; switching back to ALGO or removing it with `✕` leaves the algorithmic reverb untouched, and audio export renders it too.',
      ],
    ],
  },
  {
    version: '1.47.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '效果链可以**自由换顺序**了：FX 模块顶部新增「信号链」一行，用 `‹` `›` 把混响、延迟、合唱、镶边、移相、过载排成你想要的先后顺序（靠前的先处理，例如「先失真后延迟」和「先延迟后失真」听起来完全不同）。顺序随音色保存。',
        'The effect chain can now be **reordered**: a new Chain row at the top of the FX module moves reverb, delay, chorus, flanger, phaser and drive into whatever order you want with `‹` `›` (earlier processes first, and drive-then-delay does not sound like delay-then-drive). The order is saved with the patch.',
      ],
      [
        '每个插入式效果还多了 `∥` **并联送出**开关：打开后效果声叠加在干声上，而不是与干声交叉淡化——想保留原始音头、只加一层效果时用它。',
        'Each insert effect also has a `∥` **parallel send** switch: the effect is added on top of the dry signal instead of being crossfaded with it, which is what you want when the original attack has to stay intact.',
      ],
    ],
  },
  {
    version: '1.46.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '延迟效果重做：新增**乒乓（PING-PONG）**开关，回声左右交替；新增 `DAMP` 旋钮，每一遍回声都比上一遍更暗（默认 35%，尾音不再刺耳）。',
        'The delay was rebuilt: a **Ping-pong** switch makes the echoes alternate between the speakers, and a `DAMP` knob makes each repeat darker than the one before it (35% by default, so the tail is no longer brittle).',
      ],
      [
        '时值切换仍然平滑无咔哒，反馈与同步分频的行为不变，旧音色听起来还是原来的样子。',
        'Time changes are still smooth and click-free, and feedback and sync divisions behave as before, so existing patches still sound like themselves.',
      ],
    ],
  },
  {
    version: '1.45.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '波表振荡器现在可以**导入你自己的单周期波形**：在振荡器上选 `WT`，点「导入波形」选一个音频文件（WAV/AIFF/FLAC/MP3）。文件里超过一个周期时会自动找出周期并取平均；导入后「使用」开关自动打开，同时在波表预览里画出你的波形。',
        'The wavetable oscillator can now **import a single cycle of your own**: choose `WT` on an oscillator and hit Import wave (WAV/AIFF/FLAC/MP3). A file holding more than one cycle has its period found and averaged, the Use switch follows the import, and the wave preview draws what you loaded.',
      ],
      [
        '导入的波形保存在本机，重开页面仍在，并会随离线导出一并渲染；不想用了点「✕」即可移除，原有五张内置表不受影响。',
        'The imported waveform is kept on the device and survives a reload, and offline exports render it too. Remove it with ✕ at any time; the five built-in tables are untouched.',
      ],
    ],
  },
  {
    version: '1.44.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '选了波表波形后，`PW` 旋钮的标签会**直接显示当前是哪张表**（如 `WT 玻璃`），不再需要靠听来猜它在做什么。',
        'With the wavetable wave selected, the `PW` knob now **labels which table it is on** (for example `WT Glass`), instead of leaving you to work it out by ear.',
      ],
    ],
  },
  {
    version: '1.44.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '音质门禁的**混叠检查扩展到全部含谐波波形**（锯齿 / 方波 / 脉冲 / 波表，最高音区实测 −84 ～ −156 dB），此前只抽查了锯齿与波表——任何一档振荡器出现混叠都会被立刻拦下。',
        'The gate\'s **aliasing check now covers every harmonic-rich wave** (saw, square, pulse, wavetable; measured −84 to −156 dB at the top of the keyboard). It used to spot-check only the saw and the wavetable, so a regression in any other oscillator would have slipped through.',
      ],
    ],
  },
  {
    version: '1.44.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **4 个波表音色**：**波表风琴**（organ 表，明亮通透）、**波表人声**（vocal 表 + 慢颤音，像合唱"啊"）、**波表玻璃**（glass 表 + 同步延迟，晶莹）、**波表金属**（metallic 表 + 高通，敲击金属感）——正好演示五张表里的四张，`PW` 旋钮就是选表。',
        'Four **wavetable presets**: **Wavetable Organ** (the organ bank, bright and open), **Wavetable Vox** (the vocal bank with slow vibrato, a choir-like "ah"), **Wavetable Glass** (the glass bank with synced delay) and **Wavetable Metal** (the metallic bank through a high-pass). Between them they demonstrate four of the five banks, with the PW knob selecting which.',
      ],
    ],
  },
  {
    version: '1.43.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '内置使用指南补齐本轮新增能力：**波表（WT，PW 选表）、MIDI 输出、输出设备选择**。',
        'The built-in guide now covers this round of additions: the **wavetable (WT, chosen with the PW knob)**, **MIDI output** and the **output device picker**.',
      ],
    ],
  },
  {
    version: '1.43.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '音质门禁新增一项：**波表在键盘最高音区不产生混叠**（实测谐波之间的混叠能量低于基频 76.9 dB）。至此波表从生成、播放到门禁全线覆盖。',
        'The audio gate gained a check that the **wavetable does not alias at the top of the keyboard** (measured: between-harmonic energy 76.9 dB below the fundamental), which closes the loop from table generation through playback to the gate.',
      ],
    ],
  },
  {
    version: '1.43.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增 **MIDI 输出**（音频设置）：把演奏的音符发送到外部设备——硬件合成器、鼓机、DAW 都能收到。先在顶栏授权 MIDI，再选输出端口并打开开关；关闭时会先发送"全部音符关闭"，避免外部设备留下长音。',
        'New **MIDI output** (Audio settings): send played notes to an external device — a hardware synth, a drum machine or a DAW. Grant MIDI access in the top bar, pick the output port and switch it on; switching it off sends an all-notes-off first, so nothing is left droning on the other end.',
      ],
    ],
  },
  {
    version: '1.42.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '「音频设置」新增**输出设备**选择：可把声音送到指定的输出（耳机 / 扬声器 / 音频接口）而不改动系统默认设备。浏览器不支持时会明确说明；未命名的设备会显示为"输出 1/2…"（浏览器需要先授权麦克风才会显示真实名称）。',
        'Audio settings gained an **output device** picker: route the synth to a chosen output (headphones, speakers, interface) without changing the system default. Browsers without support say so, and unnamed devices show as "Output 1/2…" — the real names need microphone permission first.',
      ],
    ],
  },
  {
    version: '1.41.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **波表振荡器（WT）**：波形列表最后一项。它由**谐波配方**生成五张表（风琴 / 中空 / 人声 / 金属 / 玻璃），每张表按八度分层的**抗混叠波表**——高音自动用更少谐波，**不会产生混叠**（门禁实测：谐波之间的混叠能量低于基频 60 dB 以上）。**用 `PW` 旋钮选表**（0.05 起依次五张），因为波表本身没有脉宽。',
        'New **wavetable oscillator (WT)**, last in the wave list: five tables generated from harmonic recipes (organ, hollow, vocal, metallic, glass), each stored as **anti-aliased tables per octave**, so high notes use fewer harmonics and cannot alias (the gate measures between-harmonic energy more than 60 dB below the fundamental). The **PW knob picks the table**, since a table has no pulse width of its own.',
      ],
    ],
  },
  {
    version: '1.40.1',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '波表振荡器的**波表引擎**已就位（五个谐波配方 + 每八度一层的抗混叠波表），下一步接进振荡器与界面即可使用。',
        'The **table generator** for the wavetable oscillator is in place (five harmonic recipes with one anti-aliased table per octave); the next step wires it into the oscillator and the UI.',
      ],
    ],
  },
  {
    version: '1.40.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增「**场景**」（预设库里）：把当前**工作区**存成一个命名场景，之后一键切回——包含模块顺序与折叠、当前视图、信号流节点位置与隐藏项。**语言、配色、触感、MIDI 映射等个人偏好不会被场景改动**，场景只管"工作台长什么样"。适合"演奏 / 调音 / iPad"等不同用途来回切。',
        'New **scenes** (in the preset drawer): save the current **workspace** under a name and switch back to it in one tap — module order and which ones are collapsed, the current view, and the signal-flow node positions and hidden nodes. Personal preferences (language, colours, haptics, MIDI mappings) are never touched: a scene describes the workbench, not the person.',
      ],
    ],
  },
  {
    version: '1.39.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '录制的片段现在可以**量化**：播放器里选「量化」网格（十六分 / 八分 / 八分三连 / 四分），停止录制时把音符起点对齐到网格，音符长度与演奏的相对位置都不变。只作用于**新录制**，已有曲目与导入文件不受影响。',
        'Recordings can now be **quantised**: pick a grid in the player (1/16, 1/8, 1/8 triplet, 1/4) and a take snaps to it when you stop recording, keeping note lengths and the take\'s own position. It only touches **new recordings** — existing tracks and imports are untouched.',
      ],
    ],
  },
  {
    version: '1.38.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '补齐文档：用户手册新增 **CC Learn / MPE / 力度曲线 / 调律与 .scl 导入 / 噪声颜色 / 预设响度统一** 的说明，更新音色与曲目数量，并补充故障排查（没声音、静音读数、负载提示、导出音量）。',
        'Documentation catch-up: the user guide now covers **CC Learn, MPE, velocity curves, tuning and .scl import, noise colours and preset level matching**, with updated counts for presets and songs and a troubleshooting section (no sound, silent readout, load messages, export level).',
      ],
    ],
  },
  {
    version: '1.38.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '声部被抢占时（同时按键超过复音数）的取舍规则做了测试固化：优先抢占**已经松开且最轻**的声部，只有并列时才按"谁最旧"决定，所以长时间按住的和弦不会被新音随手抢掉。',
        'The rule for what gets cut when you play more notes than the polyphony allows is now covered by a test: a **released and quiet** voice goes first, and "oldest" only breaks ties — so a chord you are holding is not stolen out from under you.',
      ],
    ],
  },
  {
    version: '1.38.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增**力度曲线**（预设库里）：线性 / 柔和 / 强硬。触摸屏和 MIDI 键盘常常"轻触太轻、重击又都一样响"，柔和曲线让轻触更容易出声、强硬曲线让力度更可控。只影响**实时演奏**，曲目播放保持原谱力度。',
        'New **velocity curves** (in the preset drawer): Linear, Soft and Hard. Touchscreens and MIDI keyboards often feel either too quiet at light touches or flat at the top; Soft makes a light touch audible, Hard gives more control. They shape **live playing only** — song playback keeps the dynamics in the file.',
      ],
    ],
  },
  {
    version: '1.37.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **10 个现代/好玩的音色**：超流行主音、未来和弦、合成器波浪贝斯、暗黑牛铃、钻头 808、氛围绽放、机器人声、芯片主音、水晶玻璃、摇摆低音——都已纳入响度校准，切换时音量一致。',
        'Ten new **modern / fun presets**: Hyperpop Lead, Future Chord, Synthwave Bass, Phonk Cowbell, Drill 808, Ambient Bloom, Robot Voice, Chiptune Lead, Crystal Glass and Wobble Bass. All are level-matched, so switching patch does not change the volume.',
      ],
      [
        '曲库新增 **4 首**：俄罗斯方块主题、欢乐颂、绿袖子、致爱丽丝（八位机版）——前两首适合试主音，后两首适合试拨弦与延迟。',
        'Four new songs: **Tetris (Korobeiniki)**, **Ode to Joy**, **Greensleeves** and **Für Elise (8-bit)** — the first two suit leads, the last two show off plucks and delay.',
      ],
    ],
  },
  {
    version: '1.36.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '**统一了各预设的响度**：此前不同音色之间的响度差异最大可到约 47 dB，换音色像在拧音量；现在每个预设带一个出厂响度校准，实测差异收敛到约 **6 dB** 以内。你自己的音量旋钮不受影响（换音色不会动它）。',
        '**Preset loudness is now consistent**: patches used to differ by as much as 47 dB, so changing patch felt like turning the volume knob. Every factory preset now carries a level trim, bringing the spread down to about **6 dB**. Your own volume setting is untouched by patch changes.',
      ],
    ],
  },
  {
    version: '1.35.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**更新后偶发"打不开、没有声音"**：若浏览器缓存了旧版页面，会去加载已经不存在的文件；现在启动页面总是取最新版本，遇到这种情况会自动清理缓存并重新加载一次。',
        'Fixed the **occasional "will not open / no sound" after an update**: a cached older page asked for files the new deployment no longer has. The shell is now always fetched fresh, and if a load fails the app clears its caches and reloads once.',
      ],
    ],
  },
  {
    version: '1.35.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**刚打开应用时的音色与显示名称不一致**：上次退出时用的音色现在会连名字一起恢复，打开即可直接弹奏且与显示一致。',
        'Fixed the **patch not matching the name shown right after opening the app**: the preset used last time is restored with its name, so playing straight away sounds like what is displayed.',
      ],
    ],
  },
  {
    version: '1.35.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '波形新增**粉噪（PNK）**与**棕噪（BRN）**，比白噪更厚、更柔，适合风声、海浪与鼓的噪声层。',
        'New **pink (PNK)** and **brown (BRN)** noise waves: softer and weightier than white, which is what you want for wind, surf and drum noise layers.',
      ],
    ],
  },
  {
    version: '1.34.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**什么都不弹时监视器读数仍在跳动**：静音时读数统一显示「— · —」并保持稳定，DSP 负载低于 5% 时不再显示。',
        'Fixed the **monitor readout twitching while nothing plays**: silence now reads a steady "— · —", and the DSP load stays hidden below 5%.',
      ],
    ],
  },
  {
    version: '1.34.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**刚打开程序或按一个键就误报"设备负载偏高"**：现在只有真正持续过载才会自动降低复音数。',
        'Fixed the false **"device overloaded"** message on startup or after a single key press: voices are only shed under genuinely sustained load.',
      ],
    ],
  },
  {
    version: '1.34.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增 **MPE 输入**（音频设置里打开）：支持每个音独立弯音，配合 MPE 控制器演奏更自然；关闭时立即复位。',
        'New **MPE input** (Audio settings): per-note pitch bend for MPE controllers, released immediately when switched off.',
      ],
    ],
  },
  {
    version: '1.33.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '调律新增「**导入 .scl**」：可导入 Scala 调律文件（任意音数与非八度周期），导入后自动启用并记住。',
        'Tuning gained **Import .scl**: load Scala tuning files (any note count, non-octave periods included); the scale is applied and remembered.',
      ],
    ],
  },
  {
    version: '1.32.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '彻底移除了一类**只在网页版出现**的隐患（滤波器状态被反复清零），并加入构建检查防止再次引入。',
        'Removed a whole class of **web-build-only** hazard (filter state being reset repeatedly) and added a build check so it cannot come back.',
      ],
    ],
  },
  {
    version: '1.32.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '音质测试升级为**时域 + 频域双重检查**（咔哒、谐波、宽带噪声、混叠），并修复低通在正常音量下也会染色的问题。',
        'Audio testing now checks **both the time and frequency domain** (clicks, harmonics, broadband noise, aliasing), and the low-pass no longer colours ordinary levels.',
      ],
    ],
  },
  {
    version: '1.32.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增 **MIDI CC 映射（CC Learn）**：在「音频设置」里选一个控件 → 点「学习」→ 转动 MIDI 控制器上的旋钮，即完成绑定。之后该 CC 直接驱动这个参数（对数控件按对数缩放，开关/步进控件取整），映射**会记住**、可单独清除。CC1（调制轮）与 CC64（延音）未被映射时仍保留原有功能。',
        'New **MIDI CC mapping (CC Learn)**: in Audio settings pick a control, press Learn, then move a knob on your MIDI controller. That CC then drives the parameter — logarithmic controls scale logarithmically, stepped controls round to whole steps. Mappings are **remembered** and can be cleared individually. CC1 (mod wheel) and CC64 (sustain) keep their built-in behaviour when unmapped.',
      ],
    ],
  },
  {
    version: '1.31.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '**导出音频时自动暂停当前播放**：渲染导出（MP3 / WAV）会离线再跑一遍整首曲子，若同时还在实时播放，两套引擎会抢同一个 CPU，等待期间反而听到卡顿；现在导出前暂停、导出完成后恢复原来的播放状态。',
        '**Playback pauses while an export renders**: an export renders the song again offline, so leaving the live transport running puts two engines on the same CPU and turns the wait into stutter. Playback now pauses for the duration and returns to whatever it was doing afterwards.',
      ],
    ],
  },
  {
    version: '1.31.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增**微调律**（预设库里的「调律」）：**平均律 / 纯律 / 毕达哥拉斯律 / 中庸律**四种，逐键的音分偏移直接送进 DSP 内核，音高、弯音、滑音、曲目播放全部照常工作，只是每个音落在它该在的位置。选择会记住。',
        'New **microtuning** (Tuning in the preset drawer): **Equal, Just, Pythagorean and quarter-comma meantone**, with per-key cent offsets sent into the DSP core. Pitch bend, glide, the keyboard and file playback all keep working — the notes simply land where the temperament puts them. The choice is remembered.',
      ],
      [
        '纯律/中庸律的念珠三度会明显"甜"起来，代价是某些五度会变窄——这正是历史律法的取舍；偏移一律折算到 ±50 音分以内，读起来才是"略低"而不是"高近半音"。',
        'Just and meantone make thirds lock in, at the cost of a narrow fifth — which is exactly the historical trade-off. Offsets are folded into ±50 cents so a pitch reads as "slightly flat" rather than "nearly a semitone sharp".',
      ],
    ],
  },
  {
    version: '1.30.1',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '启动界面直接显示**当前版本号**：离线优先的应用可能一直在跑缓存里的旧版本，这样"我到底跑的是哪一版"一眼可见（若显示的不是最新版，用预设库里的「检查更新」）。',
        'The start screen now shows the **running version**: an offline-first app can keep serving a cached build, so "which version am I actually on?" is answerable at a glance (use Check for updates in the preset drawer if it is not the latest).',
      ],
    ],
  },
  {
    version: '1.30.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**简单音色（如纯正弦主音）弹单音时的刺啦声**——低通滤波器已重写，波形更干净，实时负载也明显下降。',
        'Fixed the **crackle on simple patches** such as Pure Sine Lead: the low-pass filter was rewritten, which cleaned up the waveform and lowered CPU load.',
      ],
      [
        '部分音色音量会**略低 1–3 dB**（导出的文件仍会归一化，不受影响）。',
        'Some patches now sit **1–3 dB lower** (exported files are normalised, so they are unaffected).',
      ],
    ],
  },
  {
    version: '1.29.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '新增「**导出 WAV（无损）**」：完全不过编码器，用来判断"底噪/刺啦"到底来自 MP3 编码还是别处——如果 WAV 干净而 MP3 不干净，就是编码器；两个都干净则问题在播放设备。',
        'New **Export WAV (lossless)**: no encoder at all, so it settles whether a fizzy sound comes from the MP3 stage or from somewhere else.',
      ],
      [
        'MP3 码率提升到 **320 kbps**（MPEG-1 上限），并把导出渲染的复音数从 16 提到 **32**（离线渲染没有实时截止时间，长释放音色不再被偷声切断；实测 77 秒曲目渲染 19.5 秒）。',
        'MP3 exports now use **320 kbps** (the MPEG-1 ceiling), and export rendering gets the full **32-voice** pool instead of 16 — offline rendering has no deadline, so long-release patches are no longer cut short by voice stealing (a 77 s song renders in 19.5 s).',
      ],
      [
        '偷声淡出从 8 ms 延长到 **20 ms**：密集曲目里被抢占的尾音不再有细微的"咔"感。',
        'The voice-steal fade is now **20 ms** instead of 8 ms, so a tail that has to be cut on dense material no longer produces a faint tick.',
      ],
    ],
  },
  {
    version: '1.28.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **FRM 元音共振峰**滤波类型：三组并联带通对应人声元音，**截止频率旋钮在 A–E–I–O–U 之间滑动**（对数映射，80 Hz ≈ A、4 kHz 及以上 ≈ U），共振控制带宽。用它做"说话"的合成器、机器人声、哇音铺垫都很直接。',
        'New **FRM vowel formant** filter type: three parallel band-passes voice the vowels, with the **cutoff knob morphing A–E–I–O–U** (logarithmic: 80 Hz ≈ A, 4 kHz and up ≈ U) and resonance setting the bandwidth — instant talking-synth, robot-voice and vocal-pad tones.',
      ],
      [
        '与已有的 LP / HP / BP / NT / CMB 并列，共六种滤波类型；共振峰同样支持每个振荡器独立处理（声像拉开时的真立体声）。',
        'It sits alongside LP / HP / BP / NT / CMB for six filter types, and formants also run per oscillator when the pans are apart.',
      ],
    ],
  },
  {
    version: '1.27.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**导出音量过轻**：安静的音色现在也会被提升到正常导出音量，不再需要把播放音量开得很大。',
        'Fixed **exports coming out far too quiet**: quiet patches are now lifted to a normal export level, so playback no longer needs the volume cranked up.',
      ],
      [
        'MP3 导出码率提高，快起音的音色更干净。',
        'Higher MP3 export bitrate for cleaner sharp attacks.',
      ],
    ],
  },
  {
    version: '1.26.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增「**音频设置**」面板（预设库里的入口）：显示**引擎状态、采样率、输出延迟、DSP 内核（simd/scalar）、输出峰值与实时 DSP 负载%**，并可直接**固定复音数**（4/8/16/32，会记住）。负载长期偏高时，把复音数钉在 8 或 4 是最有效的降载手段。',
        'New **Audio settings** panel (from the preset drawer): engine state, sample rate, output latency, DSP core (simd/scalar), output peak and live **DSP load**, plus a **polyphony ceiling** (4/8/16/32, remembered). Pinning it at 8 or 4 is the most effective way to cut load when a device struggles.',
      ],
      [
        '手动的复音上限**会被负载监控尊重**：监控仍可在过载时继续下调，但不会再把上限顶回去（之前点了 8 也会被自动恢复成 16）。',
        'A pinned polyphony ceiling is now **respected by the load monitor**: it may still drop lower under overload, but it never climbs back over your setting (previously choosing 8 was silently restored to 16).',
      ],
      [
        '**首屏更小**：使用指南、更新记录、音频设置三个面板改为**按需加载**，首屏 JS 从 150 KB 降到 **110 KB**（gzip），打开应用更快。',
        '**Smaller first load**: the guide, changelog and audio-settings panels are now **loaded on demand**, cutting the entry JS from 150 KB to **110 KB** gzipped.',
      ],
      [
        '**启动更快**：页面加载时就在后台预热音频路径（注册 AudioWorklet、预取并校验 DSP 内核），点「启动音频引擎」时只剩恢复上下文与建图，不再在静音里等下载与编译；内核只会下载一次。',
        '**Faster start**: the audio path is warmed in the background on page load (worklet module registered, DSP core fetched and validated), so tapping Start only has to resume the context and build the graph instead of waiting in silence — and the core is downloaded exactly once.',
      ],
    ],
  },
  {
    version: '1.25.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '当引擎因负载过高自动减少复音数时，现在会**弹出提示**告诉你降到了多少，并可到监视器查看 **DSP 负载%**——"破音是不是性能问题"从此可判断。',
        'When the engine sheds voices because the device is overloaded it now **says so**, and the monitor shows the **DSP load** — so "is this distortion a performance problem?" has an answer.',
      ],
      [
        '预设库新增「**检查更新**」按钮：离线优先的应用可能长时间运行旧缓存版本，现在可以手动强制检查并立即更新。',
        'The preset drawer gained a **Check for updates** button: an offline-first app can keep running a cached build for a long time, so you can now force a check and update immediately.',
      ],
      [
        '诊断用：电钢 + 致爱丽丝的渲染经离线频谱（噪声底 −54 dB，10 kHz 以上仅占 0.21%）、浏览器实时抓取（最大样本跳变 0.035）与整曲峰值扫描三重验证，**引擎输出本身无失真**；负载也已从 24–27% 降到 11%。',
        'Diagnostics: the electric-piano + Für Elise render was verified three ways — offline spectrum (noise floor −54 dB, only 0.21% of energy above 10 kHz), a live browser capture (largest sample step 0.035) and a whole-song peak scan — the **engine output itself is clean**, and the load already dropped from 24–27% to 11%.',
      ],
    ],
  },
  {
    version: '1.24.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '**撤销/重做覆盖整个工作区**：除音色参数外，模块折叠与展开、视图切换、信号流节点位置与「重置画布」、删除用户预设、删除录制/导入片段都可撤销（`⌘/Ctrl+Z`、`⇧⌘/Ctrl+Shift+Z` 或 `Ctrl+Y`）。',
        '**Undo/redo now covers the whole workspace**: besides patch parameters, it restores module collapse/expand, view switches, signal-flow node positions and canvas resets, deleted user presets, and removed recordings/imports (`⌘/Ctrl+Z`, `⇧⌘/Ctrl+Shift+Z` or `Ctrl+Y`).',
      ],
      [
        '会话开始时的状态会作为第 0 步记录下来，因此**打开应用后的第一个操作也能撤销**；拖动节点位置与旋钮扫动一样会合并成一步，不会产生几十条历史。',
        'The state the session started from is recorded as step zero, so the **very first action after opening the app can be undone**; dragging a node coalesces into one step, exactly like a knob sweep.',
      ],
    ],
  },
  {
    version: '1.23.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复电钢等**长释放音色播放密集曲目时的刺啦声**：释放尾巴低于 −54 dB 后不再走滤波器（听不见的部分不再消耗 CPU），实测浏览器里 DSP 负载从 24–27% 降到 **11%**，手机上再也不会顶满预算丢帧。',
        'Fixed the **crackling with long-release patches** such as the electric pianos: release tails below −54 dB no longer run the filter, so the inaudible part stops costing CPU. Measured DSP load in the browser drops from 24–27% to **11%**, leaving phones well inside the budget.',
      ],
      [
        '过载保护更果断：单个渲染块一旦吃满时间预算（此刻已经产生爆音）立即减少 8 个声部，严重过载时步长更大、冷却时间更短。',
        'Overload handling is more decisive: a block that eats the whole render quantum (an audible glitch already) sheds eight voices immediately, with bigger steps and a shorter cooldown under severe load.',
      ],
      [
        '监视器新增 **DSP 负载**读数（峰值 · 响度 · 负载%），负载过高时读数变红——判断"爆音是不是性能问题"一眼可见。',
        'The monitor now shows **DSP load** next to peak and loudness (and turns red when it is high), so "is this crackle a performance problem?" is answerable at a glance.',
      ],
    ],
  },
  {
    version: '1.22.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **CMB 梳状谐振器**滤波类型：截止频率决定梳齿音高、共振决定反馈量，能把噪声变成有音高的声音（金属 / 机器人 / 拨弦质感）。',
        'New **CMB comb resonator** filter type: cutoff sets the comb pitch and resonance its feedback, turning noise into a pitched tone (metallic, robotic, plucked).',
      ],
    ],
  },
  {
    version: '1.21.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '预设库新增「**更新记录**」入口（与使用指南同级）：按版本倒序列出音质 / 新功能 / 修复三类改动，当前运行的版本高亮标注，随应用离线可用。',
        'The preset drawer gained a **Changelog** entry next to the guide: every release with its sound / feature / fix notes, the running version highlighted, available offline.',
      ],
    ],
  },
  {
    version: '1.20.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '两个振荡器的声像拉开时，自动切换为**每个振荡器独立滤波 + 等功率声像**，左右声道是两把不同的声音；声像相同时仍走原来的单声道通路（零额外开销）。',
        'Panning the two oscillators apart now switches the voice to **per-oscillator filtering with equal-power panning**, so the channels carry two different sounds; equal pans keep the original mono path with no extra cost.',
      ],
    ],
  },
  {
    version: '1.19.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '播放器新增 **A/B 循环**：在播放位置点 A 设起点、点 B 设终点，进度条亮出该段并自动循环，练难点很方便。',
        'Player gains an **A/B loop**: mark A and B at the playhead, the region lights up on the seek bar and playback loops inside it.',
      ],
      [
        '新增**节拍器**（每拍一响、每小节重音）与**预备拍**；节拍器走独立音频通道，不染色、不进录制、不参与导出。',
        'New **metronome** (a click per beat, accented on the first beat of the bar) with a one-bar **count-in**. It runs on its own audio path and never colours the patch, recordings or exports.',
      ],
    ],
  },
  {
    version: '1.18.3',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '浅色模式：主按钮（预设库、启动引擎等）改为浅色**色调式**；虚拟键盘的黑键恢复为黑色；进度条、卷帘力度条、信号流滑杆统一为浅色轨道。',
        'Light mode: primary buttons (presets, start engine, …) became light **tonal** controls, the black keys stay black, and every slider got an explicit light track.',
      ],
      [
        '钢琴卷帘在**手机横屏**下按安全区缩进标题栏（不再被刘海/灵动岛挡住），标题栏更紧凑，网格多出约 19px。',
        'The piano roll now respects the safe areas on a **landscape phone** (its header no longer sits under the notch) and the tighter header hands about 19 px back to the grid.',
      ],
    ],
  },
  {
    version: '1.18.2',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**演奏破音**：负载监控要求的复音上限会被参数推送覆盖，慢设备上一直按 16 复音运行而丢帧；现在上限稳定生效。',
        'Fixed **crackling during playback**: the polyphony the load monitor asked for was being overwritten by the parameter stream, so slow devices kept running sixteen voices and missed deadlines.',
      ],
      [
        '每声部滤波器前加入 0.65 的增益整理（滤波后补偿），实测 THD 从 1.13% 降到 0.45%，干净音色不再带互调颗粒。',
        'The per-voice filter is now driven through a 0.65 trim with make-up gain: measured THD drops from 1.13% to 0.45%, so clean patches lost their intermodulation grit.',
      ],
    ],
  },
  {
    version: '1.18.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '浅色主题重做配色：亮橙底+黑字的"荧光块"改为琥珀墨色与暖色调底，填充控件对比度 5:1（达 WCAG AA）。',
        'Reworked the light palette: the bright amber slabs became amber ink on warm tints, with filled controls at 5:1 contrast (WCAG AA).',
      ],
    ],
  },
  {
    version: '1.18.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        'LFO 新增 **RETRIG**（每个音符重新起振，每个声部独立相位）与 **ONE SHOT**（跑完一个周期后停住），LFO 1/2 各自独立。',
        'LFOs gain **RETRIG** (restart on every note, per-voice phase) and **ONE SHOT** (run a single cycle then hold), independently for LFO 1 and 2.',
      ],
    ],
  },
  {
    version: '1.17.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '新增 **Unison 叠层**：每个振荡器可叠 1–7 个副本，`SPREAD` 控制失谐散布；复音上限按层数自动折算，保证 CPU 不失控。',
        'New **unison**: stack 1–7 detuned copies per oscillator with `SPREAD` for the detune width; the voice ceiling scales with the stack so the CPU stays in budget.',
      ],
    ],
  },
  {
    version: '1.16.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '调制矩阵扩到 **8 槽**并支持**双极深度**（左负右正）；新增 **AFTER（触后）/ RANDOM（每音随机）/ KEY（键位跟踪）** 与第二 LFO 作为调制源，目标新增 PAN 与 RES。',
        'The modulation matrix grows to **eight slots** with **bipolar depth**, plus **aftertouch / per-note random / key tracking** and LFO 2 as sources, and PAN / RES as destinations.',
      ],
    ],
  },
  {
    version: '1.15.1',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '钢琴卷帘：拖动音符经过多个音高不再留下"嗡嗡"不停的挂音；**单击音符即可试听该音高**。',
        'Piano roll: dragging a note across pitches no longer strands a droning voice, and **a single click auditions the note**.',
      ],
    ],
  },
  {
    version: '1.15.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '主输出换成 **128 采样前瞻限制器**（约 2.7ms），真正压住瞬态；末级为 0.82 以下逐位透明的软限制器。',
        'The master bus gained a **128-sample (≈2.7 ms) lookahead limiter** that actually catches transients, with a bit-transparent soft limiter as the final stage.',
      ],
      [
        '监视器新增**真峰值 / 短时响度 / 限制器衰减**读数；导出统一按 −1 dBFS 规范化；新增独立音质门禁。',
        'The monitor now shows **true peak / short-term loudness / gain reduction**, exports are normalised to −1 dBFS, and a dedicated audio-quality gate joined the test suite.',
      ],
    ],
  },
  {
    version: '1.14.0',
    date: '2026-09-10',
    kind: 'sound',
    items: [
      [
        '混响换成自研 Freeverb 结构：每声道 8 阻尼梳状 + 4 全通扩散，新增 **DAMP（尾音阻尼）/ WIDTH（立体声宽度）/ PRE（预延迟）**。',
        'Replaced the reverb with an in-house Freeverb topology (8 damped combs + 4 allpass diffusers per channel) with new **DAMP / WIDTH / PRE** controls.',
      ],
    ],
  },
  {
    version: '1.13.3',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复多复音**刺啦破音**：总线不再提前削波（实测约 25% 的样本曾被削），限制器不再空转，和弦起音相位打散让峰值从 1.61 降到 0.90。',
        'Fixed **polyphonic crackle**: the bus no longer clips early (~25% of samples were being shaped), the limiter actually engages, and spread start phases dropped the worst-case peak from 1.61 to 0.90.',
      ],
    ],
  },
  {
    version: '1.13.2',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '钢琴卷帘：**触屏横向拖动右缘改音符长度**、同一音高不再叠音（重叠自动裁切）、拖动改音高时试听、底部键盘条可收起。',
        'Piano roll: **drag the right edge to resize on touch**, one note per pitch lane (overlaps are trimmed), pitch audition while dragging, and a collapsible keyboard strip.',
      ],
    ],
  },
  {
    version: '1.13.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '新增**深色 / 浅色 / 自动**三套主题，跟随系统并可固定；配套重画所有面板、画布与键盘。',
        'Added **dark / light / auto** themes that follow the system or can be pinned, with every panel, canvas and keyboard repainted for each.',
      ],
    ],
  },
  {
    version: '1.12.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '信号流节点详情改为"展开的模块卡片"并居中显示；内置曲目补齐为完整段落（如《月光》5:02、《卡农》1:39）。',
        'Flow node details became the expanded module card, centred on screen, and the built-in songs were extended to full arrangements.',
      ],
    ],
  },
  {
    version: '1.11.0',
    date: '2026-09-10',
    kind: 'feature',
    items: [
      [
        '卷帘输入键盘可开关；音符长度跟随按键时长并可编辑；去掉常亮电源灯与 ONLINE 徽标；移动端遮罩不再盖住顶栏菜单。',
        'Roll keyboard toggle, note length follows the held key and stays editable, the always-on power light and ONLINE badge are gone, and mobile overlays no longer cover the top menu.',
      ],
    ],
  },
  {
    version: '1.10.0',
    date: '2026-09-09',
    kind: 'feature',
    items: [
      [
        '新增**钢琴卷帘编辑器**（画/拖/量化/移调/力度/撤销）与 MIDI 输入，可从顶栏或编辑按钮打开。',
        'Added the **piano roll editor** (draw, drag, quantise, transpose, velocity, undo) with MIDI input, openable from the top bar or any edit button.',
      ],
    ],
  },
  {
    version: '1.9.0',
    date: '2026-09-09',
    kind: 'feature',
    items: [
      [
        '移动端与平板布局重做：竖屏/横屏各自的信号流列数、顶栏平衡、桌面端模块默认全部展开。',
        'Reworked the phone and tablet layouts: per-orientation flow columns, a balanced top bar, and desktop modules expanded by default.',
      ],
    ],
  },
  {
    version: '1.8.0',
    date: '2026-09-09',
    kind: 'sound',
    items: [
      [
        '参数平滑（消除拉链噪声）、主输出保护、性能预算门禁；内置 16 首曲目、67 个工厂预设、和弦识别与 PWA 离线安装。',
        'Parameter smoothing (no more zipper noise), master output protection and a performance budget gate, alongside 16 built-in songs, 67 factory presets, chord detection and offline PWA install.',
      ],
    ],
  }
];
