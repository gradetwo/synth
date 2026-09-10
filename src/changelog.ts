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
