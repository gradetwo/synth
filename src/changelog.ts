/**
 * Release history shown by the in-app changelog.
 *
 * Newest first. Every entry carries both languages, so the panel follows the
 * current interface language like the rest of the app. Keep the entry for the
 * version in `package.json` at the top — a unit test enforces that.
 */

export type ReleaseKind = 'sound' | 'feature' | 'fix';

export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: ReleaseKind;
  items: [string, string][];
}

export const CHANGELOG: Release[] = [
  {
    version: '1.27.0',
    date: '2026-09-10',
    kind: 'fix',
    items: [
      [
        '修复**导出音频过轻**（电钢 + 致爱丽丝实测峰值仅 **−23.4 dBFS**）：导出改为**双向归一化**，现在会把安静的音色提升到 −1 dBFS 附近（提升上限 +24 dB）。过轻的文件会逼着播放端大幅加增益（手机响度自动补偿、蓝牙编解码、功放底噪都会被一起推起来），这正是"听起来有刺啦"的常见来源。',
        'Fixed **exports that were far too quiet** (the electric piano + Für Elise export peaked at **−23.4 dBFS**): exports are now normalised **in both directions**, lifting quiet patches to about −1 dBFS (boost capped at +24 dB). A too-quiet file forces the playback chain to add 20+ dB — the phone loudness normaliser, a Bluetooth codec, the amplifier noise floor — which is a common source of "crackling" that the synth never produced.',
      ],
      [
        'MP3 导出码率 192 → **256 kbps**：音色起音快时编码预回声（pre-echo）更不容易被听到。',
        'MP3 exports now encode at **256 kbps** instead of 192, which keeps pre-echo away from sharp attacks.',
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
  },
];

/** The version this build reports. */
export const CURRENT_VERSION = __APP_VERSION__;

export function releaseDateLabel(date: string, lang: 'zh' | 'en'): string {
  const [y, m, d] = date.split('-');
  return lang === 'zh' ? `${y} 年 ${Number(m)} 月 ${Number(d)} 日` : `${y}-${m}-${d}`;
}
