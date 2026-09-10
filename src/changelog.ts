/**
 * Release history shown by the in-app changelog.
 *
 * Newest first. Every entry carries both languages, so the panel follows the
 * current interface language like the rest of the app. Keep the entry for the
 * version in `package.json` at the top — a unit test enforces that.
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

export const CHANGELOG: Release[] = [
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
  },
];

/** The version this build reports. */
export const CURRENT_VERSION = __APP_VERSION__;

export function releaseDateLabel(date: string, lang: 'zh' | 'en'): string {
  const [y, m, d] = date.split('-');
  return lang === 'zh' ? `${y} 年 ${Number(m)} 月 ${Number(d)} 日` : `${y}-${m}-${d}`;
}
