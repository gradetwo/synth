/**
 * Offline guide content.
 *
 * Everything ships in the bundle so the manual works with no network. Text is
 * authored as `[zh, en]` pairs and rendered through the active language.
 * Inline markup: `**bold**` and `` `code` ``.
 */

export type Bi = [zh: string, en: string];

export type Block =
  | { kind: 'p'; text: Bi }
  | { kind: 'h'; text: Bi }
  | { kind: 'ul'; items: Bi[] }
  | { kind: 'ol'; items: Bi[] }
  | { kind: 'table'; head: Bi[]; rows: Bi[][] }
  | { kind: 'tip'; text: Bi }
  | { kind: 'steps'; items: { title: Bi; body: Bi }[] };

export interface GuideSection {
  id: string;
  title: Bi;
  intro: Bi;
  blocks: Block[];
}

export const GUIDE_SECTIONS: GuideSection[] = [
  // ---------------------------------------------------------------- basics
  {
    id: 'basics',
    title: ['合成器基础', 'Synthesis basics'],
    intro: [
      '合成器用电子方式从零生成声音。理解它，只需要抓住四个量：音高、音量、音色、时间。',
      'A synthesizer generates sound electronically from scratch. Four quantities explain almost everything: pitch, level, timbre and time.',
    ],
    blocks: [
      { kind: 'h', text: ['声音的四个维度', 'The four dimensions of sound'] },
      {
        kind: 'table',
        head: [
          ['维度', 'Dimension'],
          ['物理量', 'Physical quantity'],
          ['本机模块', 'Module here'],
          ['听感', 'What you hear'],
        ],
        rows: [
          [
            ['音高', 'Pitch'],
            ['频率 Hz', 'Frequency (Hz)'],
            ['振荡器音高 / 键盘', 'Oscillator pitch / keyboard'],
            ['越高越尖', 'Higher = brighter'],
          ],
          [
            ['音量', 'Level'],
            ['振幅', 'Amplitude'],
            ['电平 / AMP ENV', 'Level / AMP ENV'],
            ['越大越响', 'Higher = louder'],
          ],
          [
            ['音色', 'Timbre'],
            ['谐波结构', 'Harmonic content'],
            ['波形 / 滤波器', 'Waveform / filter'],
            ['明暗、厚薄、软硬', 'Bright, dark, thick, thin'],
          ],
          [
            ['时间', 'Time'],
            ['变化过程', 'Change over time'],
            ['包络 / LFO', 'Envelopes / LFO'],
            ['起音、衰减、颤动', 'Attack, decay, wobble'],
          ],
        ],
      },
      { kind: 'h', text: ['振荡器 OSC', 'Oscillators'] },
      {
        kind: 'p',
        text: [
          '振荡器产生周期性波形，是声音的"原料"。本机有两个振荡器，可各自选择波形、音高、微调、电平与声像。',
          'Oscillators produce the periodic waveforms that feed everything else. This synth has two, each with its own waveform, pitch, detune, level and pan.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '**正弦 sine**：只有基频，最纯净。适合超低音、铃声、FM 载波。',
            '**Sine**: fundamental only, the purest tone. Great for sub bass, bells and FM carriers.',
          ],
          [
            '**三角 triangle**：比正弦多一点谐波，柔和。适合铺底、电钢。',
            '**Triangle**: a few more harmonics than sine, soft. Good for pads and electric piano.',
          ],
          [
            '**锯齿 saw**：奇偶谐波齐全，明亮厚实。Lead、bass、supersaw 的主力。',
            '**Saw**: all harmonics, bright and thick. The workhorse for leads, basses and supersaws.',
          ],
          [
            '**方波 square**：只有奇次谐波，中空的木管感。芯片音、风琴。',
            '**Square**: odd harmonics only, hollow and reedy. Chiptune and organ.',
          ],
          [
            '**脉冲 pulse**：占空比可变的方波。`PW` 越小越细、越有鼻音。',
            '**Pulse**: a square with variable duty cycle. Smaller `PW` = thinner and more nasal.',
          ],
          [
            '**噪声 noise**：没有音高，包含全部频率。风声、打击、上升音。',
            '**Noise**: no pitch, all frequencies. Wind, percussion and risers.',
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '`PITCH`：以半音为单位，±24 半音；−12 就是低一个八度。',
            '`PITCH`: semitones, ±24; −12 is one octave down.',
          ],
          [
            '`DETUNE`：以音分为单位，把两个振荡器稍微错开产生合唱/加厚。差 5–15 音分最自然。',
            '`DETUNE`: cents. Nudging two oscillators apart creates chorus and width; 5–15 cents is the sweet spot.',
          ],
          ['`LEVEL`：该振荡器在混音中的比例。', '`LEVEL`: this oscillator’s share of the mix.'],
          [
            '`PW`：脉冲宽度，仅对 pulse 有效；0.5 就是标准方波。',
            '`PW`: pulse width, only for the pulse wave; 0.5 equals a square.',
          ],
          ['`PAN`：左右声像。', '`PAN`: stereo position.'],
        ],
      },
      { kind: 'h', text: ['滤波器 FILTER', 'The filter'] },
      {
        kind: 'p',
        text: [
          '滤波器削减某些频率，决定音色的明暗。本机是经典的减法合成结构：先用富含谐波的波形做原料，再用滤波器雕刻出想要的声音。',
          'The filter removes frequencies and shapes brightness. This is subtractive synthesis: start with a harmonically rich waveform, then carve it with the filter.',
        ],
      },
      {
        kind: 'table',
        head: [
          ['类型', 'Type'],
          ['作用', 'Behaviour'],
          ['典型用途', 'Typical use'],
        ],
        rows: [
          [
            ['低通 LP', 'Low-pass'],
            ['保留低频，削弱高频', 'Keeps lows, removes highs'],
            ['最常用，让声音变暖变暗', 'Everyday tone shaping'],
          ],
          [
            ['高通 HP', 'High-pass'],
            ['削弱低频，保留高频', 'Removes lows, keeps highs'],
            ['去掉浑浊、做上升音', 'Cleaning mud, risers'],
          ],
          [
            ['带通 BP', 'Band-pass'],
            ['只保留中频一段', 'Keeps one mid band'],
            ['鼻音、人声感、电话音', 'Nasal, vocal, telephone'],
          ],
          [
            ['陷波 NT', 'Notch'],
            ['挖掉某一频段', 'Removes one band'],
            ['特殊音效', 'Special effects'],
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          ['`CUTOFF` 截止频率：滤波器开始起作用的频率。', '`CUTOFF`: where the filter starts acting.'],
          [
            '`RES` 共振：在截止点附近增强，产生"哇"的尖锐感；过高会自激啸叫。',
            '`RES`: emphasis at the cutoff, that classic "wah". Too much self-oscillates.',
          ],
          ['`DRIVE` 驱动：滤波器前级过载，带来饱和与额外谐波。', '`DRIVE`: overdrives the filter input for saturation and extra harmonics.'],
          [
            '`ENV AMT` 包络量：用 FILTER ENV 调制截止频率，是打击感的来源。',
            '`ENV AMT`: how much FILTER ENV moves the cutoff — the source of punch.',
          ],
          [
            '`KBD` 键盘跟踪：音高越高截止频率越高，让音色在全键盘保持一致。',
            '`KBD`: tracks the keyboard so high notes stay as bright as low ones.',
          ],
        ],
      },
      { kind: 'h', text: ['包络 ENV', 'Envelopes'] },
      {
        kind: 'p',
        text: [
          '包络描述一个参数随时间的变化，最常用的是 ADSR 四段。',
          'An envelope describes how a parameter changes over time. The classic form has four stages: ADSR.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '**Attack 起音**：按下到最大音量所需时间。短 = 打击感，长 = 渐入。',
            '**Attack**: time from key-down to full level. Short = percussive, long = fade-in.',
          ],
          ['**Decay 衰减**：从峰值降到 Sustain 所需时间。', '**Decay**: time from the peak down to the sustain level.'],
          [
            '**Sustain 延音**：按住时保持的电平。0 = 拨弦/打击，1 = 持续不断。',
            '**Sustain**: the level held while the key is down. 0 = plucked, 1 = endless.',
          ],
          ['**Release 释音**：松开后消失所需时间。', '**Release**: how long the sound fades after key-up.'],
        ],
      },
      {
        kind: 'p',
        text: [
          '本机有两条包络：**AMP ENV** 控制音量，**FILTER ENV** 控制截止频率。两者独立，这是"打击感 + 明亮起音"的关键。',
          'There are two envelopes: **AMP ENV** for level and **FILTER ENV** for cutoff. They are independent, which is what gives punchy, bright attacks.',
        ],
      },
      { kind: 'h', text: ['LFO 低频振荡器', 'LFO'] },
      {
        kind: 'p',
        text: [
          'LFO 本身听不见，它像一只自动的手，周期性地推动某个参数，速率通常低于 20 Hz。',
          'An LFO is inaudible by itself: an automatic hand that keeps pushing a parameter, usually below 20 Hz.',
        ],
      },
      {
        kind: 'ul',
        items: [
          ['`RATE` 速率：推动的快慢。0.1–1 Hz 缓慢起伏，5–8 Hz 是颤音。', '`RATE`: how fast. 0.1–1 Hz drifts, 5–8 Hz is vibrato.'],
          ['`DEPTH` 深度：推动的幅度。', '`DEPTH`: how far it pushes.'],
          [
            '`WAVE` 波形：sine 平滑、triangle 柔和、square 切换、saw 单向扫。',
            '`WAVE`: sine is smooth, triangle soft, square switches, saw sweeps one way.',
          ],
          [
            '`TARGET` 目标：cutoff 摆动、pitch 颤音、volume 门限、pwm 脉冲宽度变化。',
            '`TARGET`: cutoff, pitch, volume or pwm.',
          ],
          ['`SYNC`：与节拍同步。', '`SYNC`: lock the rate to the tempo.'],
        ],
      },
      {
        kind: 'p',
        text: [
          '本机有 **LFO** 与 **LFO2** 两个低频振荡器，可以分别指向不同目标。',
          'There are two of them — **LFO** and **LFO2** — each free to point at a different target.',
        ],
      },
      { kind: 'h', text: ['调制矩阵 MOD MATRIX', 'Mod matrix'] },
      {
        kind: 'p',
        text: [
          '矩阵把"源"连接到"目标"，并指定深度。源可以是 LFO、包络、调制轮、力度；目标是截止、音高、音量、PWM。多条路由可以叠加。',
          'The matrix wires sources to destinations with an amount. Sources are LFO, envelope, mod wheel and velocity; destinations are cutoff, pitch, volume and PWM. Routes stack.',
        ],
      },
      { kind: 'h', text: ['效果 FX', 'Effects'] },
      {
        kind: 'ul',
        items: [
          [
            '**混响 Reverb**：模拟空间反射。`SIZE` 是空间大小，`MIX` 是干湿比。',
            '**Reverb**: simulated space. `SIZE` is the room, `MIX` the dry/wet balance.',
          ],
          [
            '**延迟 Delay**：回声。`SYNC` 选与节拍同步的时值（1/4、1/8.、1/8、1/16），`FDBK` 是反馈量，过高会堆积。',
            '**Delay**: echoes. `SYNC` picks a note value (1/4, 1/8., 1/8, 1/16); `FDBK` is feedback — too much piles up.',
          ],
          ['**合唱 Chorus**：轻微延时调制，制造宽厚、多人的感觉。', '**Chorus**: gentle modulated delay for width and a "many players" feel.'],
          ['**镶边 Flanger**：更短、带反馈的延时，产生喷气式扫频。', '**Flanger**: a shorter, fed-back delay for jet-plane sweeps.'],
          ['**移相 Phaser**：相位抵消形成流动的陷波。', '**Phaser**: moving notches from phase cancellation.'],
          ['**过载 Drive**：失真饱和，增加谐波与力度感。', '**Drive**: saturation for extra harmonics and weight.'],
        ],
      },
      { kind: 'h', text: ['声部与演奏', 'Voicing and performance'] },
      {
        kind: 'ul',
        items: [
          ['**POLY 复音**：同时发声，最多 16 个声部。', '**POLY**: up to 16 simultaneous voices.'],
          ['**MONO 单音**：一次一个音，每次重新触发包络。', '**MONO**: one note at a time, retriggering the envelope.'],
          [
            '**LEGATO 连奏**：一次一个音，但连按不重触发包络，适合滑音主音。',
            '**LEGATO**: one note, but overlapping presses do not retrigger — ideal for gliding leads.',
          ],
          ['`GLIDE` 滑音：音与音之间平滑过渡的时间。', '`GLIDE`: the portamento time between notes.'],
          [
            '**力度 velocity**：影响音量，也能通过调制矩阵影响音色。',
            '**Velocity**: drives level, and can drive timbre through the matrix.',
          ],
        ],
      },
      { kind: 'h', text: ['增益与余量', 'Gain and headroom'] },
      {
        kind: 'p',
        text: [
          '多个声部相加会很快超过 0 dB。建议单振荡器电平 0.5–0.8、主音量 0.7 左右，并给效果留空间。听到爆音先降主音量。',
          'Voices add up fast. Keep oscillator levels around 0.5–0.8 and master near 0.7, leaving room for effects. If it crackles, drop the master first.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- start
  {
    id: 'start',
    title: ['新手教学', 'Getting started'],
    intro: [
      '五分钟从零到能弹、能换音色、能找到每个按钮。',
      'Zero to playing, browsing patches and knowing every button in five minutes.',
    ],
    blocks: [
      { kind: 'h', text: ['第一步：让声音响起来', 'Step one: make it sound'] },
      {
        kind: 'steps',
        items: [
          {
            title: ['启动音频引擎', 'Start the audio engine'],
            body: [
              '打开页面，点击中央的「启动音频引擎」。浏览器要求一次用户手势才能播放声音，这一步是必须的。',
              'Open the page and press the central "start audio" button. Browsers only allow sound after a user gesture, so this step is mandatory.',
            ],
          },
          {
            title: ['弹一下', 'Play a note'],
            body: [
              '点底部键盘上的任意琴键，或按电脑键盘 `A S D F…`，应该听到 INIT 音色。',
              'Tap any key on the bottom keyboard, or press `A S D F…` on a computer keyboard. You should hear the INIT patch.',
            ],
          },
          {
            title: ['没声音？', 'No sound?'],
            body: [
              '依次检查：设备音量与静音开关、是否点了启动、页面是否在后台、Safari 是否在同一个标签页内操作。',
              'Check, in order: device volume and mute, that you pressed start, that the page is in the foreground, and that Safari has focus in this tab.',
            ],
          },
        ],
      },
      { kind: 'h', text: ['认识界面', 'The interface'] },
      {
        kind: 'ul',
        items: [
          [
            '**顶栏**：电源、预设切换、A/B 音色槽、撤销/重做、MIDI、键盘显示、随机、保存、预设库。',
            '**Top bar**: power, preset stepper, A/B slots, undo/redo, MIDI, keyboard toggle, randomize, save, preset library.',
          ],
          [
            '**监视区**：示波器、频谱、音符/力度/复音、VU 表，以及 DEMO 和 WAV 导出。',
            '**Monitor row**: scope, spectrum, note/velocity/voice readout, VU meter, plus DEMO and WAV export.',
          ],
          [
            '**模块区**：OSC 1、OSC 2、FILTER、AMP ENV、LFO、MOD MATRIX、FX、FX 2，可折叠、可拖拽排序。',
            '**Modules**: OSC 1, OSC 2, FILTER, AMP ENV, LFO, MOD MATRIX, FX, FX 2 — collapsible and reorderable.',
          ],
          [
            '**底部**：悬浮键盘（可隐藏）、弯音轮与调制轮。',
            '**Bottom**: the floating keyboard (hideable) with pitch and mod wheels.',
          ],
        ],
      },
      { kind: 'h', text: ['用预设快速上手', 'Start from a preset'] },
      {
        kind: 'ol',
        items: [
          ['点击顶栏「预设库」，打开 67 个工厂预设。', 'Open the preset library from the top bar: 67 factory patches.'],
          [
            '用分类筛选（LEAD / BASS / PAD / PLUCK / KEYS / FX / BASIC）或搜索框。',
            'Filter by category (LEAD / BASS / PAD / PLUCK / KEYS / FX / BASIC) or use the search box.',
          ],
          [
            '点任意卡片即可载入，同时监视区显示当前音色名。',
            'Click any card to load it; the monitor shows the current patch name.',
          ],
          [
            '喜欢就点「保存」存进本地，也可以导出 `.gs1.json` 或生成分享链接。',
            'Save it locally with the save button, export a `.gs1.json`, or copy a share link.',
          ],
        ],
      },
      { kind: 'h', text: ['触屏与电脑的操作差异', 'Touch vs. mouse'] },
      {
        kind: 'ul',
        items: [
          [
            '旋钮：上下拖动调节；双击复位；桌面滚轮 / `Shift` 微调；触屏长按 0.6 秒再拖动微调。',
            'Knobs: drag up/down, double-tap to reset. On desktop the wheel and `Shift` fine-tune; on touch, hold 0.6 s then drag.',
          ],
          [
            '包络：直接拖动曲线上的点；触屏会自动吸附到最近的点。',
            'Envelopes: drag the points directly; on touch the nearest point is grabbed automatically.',
          ],
          [
            '键盘：触屏支持多指和弦；开启「力度」后按键位置决定力度。',
            'Keyboard: multi-touch chords on touch; with "VEL" on, the strike position sets velocity.',
          ],
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- help
  {
    id: 'help',
    title: ['使用帮助', 'Usage help'],
    intro: [
      '模块、预设、离线、快捷键和常见问题的速查。',
      'A quick reference for modules, presets, offline use, shortcuts and troubleshooting.',
    ],
    blocks: [
      { kind: 'h', text: ['模块与布局', 'Modules and layout'] },
      {
        kind: 'ul',
        items: [
          [
            '拖动模块标题栏的 ⠿ 手柄可调整顺序；点右侧箭头折叠 / 展开。',
            'Drag the ⠿ grip in a module header to reorder; click the arrow to collapse or expand.',
          ],
          [
            '顺序与折叠状态会记住，不会因为换预设而改变。',
            'Order and collapsed state persist and are untouched by preset changes.',
          ],
          ['预设库底部「重置布局」恢复默认。', '“Reset layout” at the bottom of the preset library restores the default.'],
        ],
      },
      { kind: 'h', text: ['预设与音色管理', 'Presets and patch management'] },
      {
        kind: 'ul',
        items: [
          ['**保存**：把当前音色存入浏览器本地。', '**Save**: stores the current patch in this browser.'],
          ['**导入 / 导出**：文件格式为 `.gs1.json`。', '**Import / export**: `.gs1.json` files.'],
          ['**分享**：生成带音色数据的 URL，别人打开即可载入。', '**Share**: a URL carrying the patch; opening it loads the sound.'],
          ['**A / B**：两个音色槽方便对比；⇄ 把当前音色复制到另一槽。', '**A / B**: two slots for comparison; ⇄ copies the current patch to the other slot.'],
          [
            '**撤销 / 重做**：顶栏 ↶ ↷，或 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`。',
            '**Undo / redo**: the ↶ ↷ buttons, or `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`.',
          ],
        ],
      },
      { kind: 'h', text: ['离线与更新', 'Offline and updates'] },
      {
        kind: 'ul',
        items: [
          [
            '首次打开后即可完全离线使用：界面、音色库、DSP 全在本地。',
            'After the first visit the whole app works offline: UI, patch library and DSP are all local.',
          ],
          [
            '有新版本时右下角出现「立即更新」，点击后更新并重载，不会打断演奏。',
            'When a new version is ready a banner appears; tap it to update and reload without cutting the sound.',
          ],
          [
            '长时间看不到更新，清除站点数据或删除后重新安装 PWA。',
            'If an update never appears, clear the site data or remove and reinstall the PWA.',
          ],
        ],
      },
      { kind: 'h', text: ['语言、主题与 MIDI', 'Language, theme and MIDI'] },
      {
        kind: 'ul',
        items: [
          ['预设库底部 **EN / 中文** 切换语言，会记住。', 'Switch language with **EN / 中文** at the bottom of the preset library; it is remembered.'],
          ['同一处的**高对比**切换强光下更清晰的配色。', 'The **Contrast** button next to it switches to a high-contrast theme for bright light.'],
          [
            '顶栏 **MIDI** 连接外部键盘；支持力度、CC1 调制轮、CC64 延音、CC123 全部音符关闭。',
            '**MIDI** in the top bar connects a hardware keyboard: velocity, CC1 mod wheel, CC64 sustain and CC123 all-notes-off.',
          ],
        ],
      },
      { kind: 'h', text: ['快捷键', 'Keyboard shortcuts'] },
      {
        kind: 'table',
        head: [
          ['快捷键', 'Shortcut'],
          ['功能', 'Action'],
        ],
        rows: [
          [['`A W S E D F T G Y H U J K O L`', '`A W S E D F T G Y H U J K O L`'], ['演奏音符', 'Play notes']],
          [['`Ctrl/Cmd + Z`', '`Ctrl/Cmd + Z`'], ['撤销', 'Undo']],
          [['`Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y`', '`Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y`'], ['重做', 'Redo']],
          [['方向键 / `Home`', 'Arrows / `Home`'], ['聚焦旋钮后调节 / 复位', 'Adjust / reset a focused knob']],
          [['`Esc`', '`Esc`'], ['取消数值输入', 'Cancel value editing']],
        ],
      },
      { kind: 'h', text: ['导出 WAV', 'WAV export'] },
      {
        kind: 'p',
        text: [
          '监视区的「WAV」按钮会用当前音色离线渲染一段音频并下载，适合把音色拿到别的工程里用。',
          'The WAV button in the monitor row renders the current patch offline and downloads it — handy for dropping the sound into another project.',
        ],
      },
      { kind: 'h', text: ['常见问题', 'Troubleshooting'] },
      {
        kind: 'ul',
        items: [
          [
            '**没声音**：确认点了启动、设备未静音、页面在前台；iOS 需在标签页内操作。',
            '**No sound**: confirm you started the engine, the device is not muted, the page is in front; on iOS interact inside the tab.',
          ],
          [
            '**卡顿 / 爆音**：关闭部分效果或降低电平；监视区会显示自动降复音。',
            '**Crackles**: turn off some effects or lower levels; the monitor shows automatic voice reduction.',
          ],
          [
            '**听不到某个模块**：检查 LED 开关、`LEVEL`、以及调制矩阵是否把参数拉到了极值。',
            '**A module seems silent**: check its LED, its `LEVEL`, and whether the matrix is pinning a parameter.',
          ],
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- build
  {
    id: 'build',
    title: ['从零捏一个音色', 'Build a sound from scratch'],
    intro: [
      '从 INIT 开始，一次只加一个模块，边弹边听。这是最快建立直觉的方法。',
      'Start from INIT and add one module at a time while you play. Nothing builds intuition faster.',
    ],
    blocks: [
      { kind: 'h', text: ['准备工作', 'Set-up'] },
      {
        kind: 'ol',
        items: [
          ['载入 BASIC 分类里的 **INIT** 预设。', 'Load the **INIT** patch from the BASIC category.'],
          ['弹一个中音 C4，确认是干净的单一正弦。', 'Play a middle C4 and confirm it is one clean sine.'],
          [
            '把 AMP ENV 的 Attack 调到最小、Sustain 调到 0.7 左右，得到一个稳定的基础音。',
            'Set AMP ENV attack to minimum and sustain to about 0.7 for a steady base tone.',
          ],
        ],
      },
      { kind: 'h', text: ['第 1 步：选择波形', 'Step 1 — pick a waveform'] },
      {
        kind: 'p',
        text: [
          '在 OSC 1 里依次点六个波形，听差别。想要厚实的 lead 用锯齿，想要柔和用三角，想要超低音用正弦。',
          'Cycle the six waveforms in OSC 1 and listen. Saw for a thick lead, triangle for soft, sine for sub bass.',
        ],
      },
      {
        kind: 'tip',
        text: [
          '打开 OSC 2，把 `DETUNE` 调到 +7 或 −7 音分、`LEVEL` 0.4，立刻得到双振荡器加厚效果。',
          'Turn on OSC 2, set `DETUNE` to +7 or −7 cents and `LEVEL` to 0.4 for instant two-oscillator thickness.',
        ],
      },
      { kind: 'h', text: ['第 2 步：用滤波器定形', 'Step 2 — shape with the filter'] },
      {
        kind: 'ol',
        items: [
          ['把 FILTER 的 `CUTOFF` 从 18000 慢慢降到 2000 左右，听声音变暗。', 'Bring `CUTOFF` down from 18000 towards 2000 and hear it darken.'],
          ['把 `RES` 提到 0.3–0.5，截止点附近出现"哇"的共振。', 'Raise `RES` to 0.3–0.5 for the resonant "wah" at the cutoff.'],
          [
            '把 `ENV AMT` 提到 0.6，再让 FILTER ENV 的 Decay 约 0.15 秒、Sustain 0.2，得到打击感。',
            'Set `ENV AMT` to 0.6 and give FILTER ENV a ~0.15 s decay and 0.2 sustain for punch.',
          ],
        ],
      },
      { kind: 'h', text: ['第 3 步：包络决定手感', 'Step 3 — envelopes define the feel'] },
      {
        kind: 'ul',
        items: [
          [
            '**打击 / 拨弦**：Attack 0.001–0.01，Decay 0.1–0.3，Sustain 0，Release 0.2。',
            '**Percussive / plucked**: attack 0.001–0.01, decay 0.1–0.3, sustain 0, release 0.2.',
          ],
          [
            '**铺底**：Attack 0.8–2，Decay 1–2，Sustain 0.8，Release 2–4。',
            '**Pad**: attack 0.8–2, decay 1–2, sustain 0.8, release 2–4.',
          ],
          ['**风琴**：Attack 0.005，Sustain 1，Release 0.08。', '**Organ**: attack 0.005, sustain 1, release 0.08.'],
        ],
      },
      { kind: 'h', text: ['第 4 步：加一点动', 'Step 4 — add motion'] },
      {
        kind: 'ul',
        items: [
          ['**颤音**：LFO RATE 5–6 Hz，DEPTH 0.15，TARGET pitch。', '**Vibrato**: LFO rate 5–6 Hz, depth 0.15, target pitch.'],
          ['**缓慢摆动**：LFO RATE 0.2–1 Hz，DEPTH 0.3，TARGET cutoff。', '**Slow movement**: LFO rate 0.2–1 Hz, depth 0.3, target cutoff.'],
          [
            '**摇摆贝斯**：LFO RATE 2–4 Hz，DEPTH 0.8，TARGET cutoff，关闭 SYNC。',
            '**Wobble bass**: LFO rate 2–4 Hz, depth 0.8, target cutoff, sync off.',
          ],
        ],
      },
      { kind: 'h', text: ['第 5 步：效果与空间', 'Step 5 — effects and space'] },
      {
        kind: 'ol',
        items: [
          ['先加混响：`SIZE` 0.5、`MIX` 0.25，给声音一个空间。', 'Start with reverb: `SIZE` 0.5, `MIX` 0.25 to place the sound in a room.'],
          [
            '需要节奏感就开延迟：`SYNC` 选 1/8，`FDBK` 0.3，`MIX` 0.2。',
            'For rhythm add delay: `SYNC` 1/8, `FDBK` 0.3, `MIX` 0.2.',
          ],
          ['想要更宽就开合唱：`DEPTH` 0.4、`MIX` 0.35。', 'For width, chorus: `DEPTH` 0.4, `MIX` 0.35.'],
          ['想要更凶就开过载：`DRIVE` 0.4、`MIX` 0.5。', 'For aggression, drive: `DRIVE` 0.4, `MIX` 0.5.'],
        ],
      },
      { kind: 'h', text: ['三个完整配方', 'Three complete recipes'] },
      {
        kind: 'p',
        text: [
          '未提到的参数保持 INIT 默认即可，先照抄再微调。',
          'Leave anything unlisted at its INIT default; copy first, tweak later.',
        ],
      },
      {
        kind: 'steps',
        items: [
          {
            title: ['Pluck Bass · 拨弦贝斯', 'Pluck Bass'],
            body: [
              'OSC1 锯齿、`PITCH` −12；OSC2 脉冲、`PITCH` −12、`LEVEL` 0.3；FILTER 低通 700 Hz、`RES` 0.45、`DRIVE` 0.4、`ENV AMT` 0.85；AMP ENV 1 ms / 0.16 s / 0.05 / 0.12 s；FILTER ENV 1 ms / 0.12 s / 0 / 0.1 s；关闭 LFO 与混响。',
              'OSC1 saw at `PITCH` −12; OSC2 pulse at `PITCH` −12, `LEVEL` 0.3; filter low-pass 700 Hz, `RES` 0.45, `DRIVE` 0.4, `ENV AMT` 0.85; AMP ENV 1 ms / 0.16 s / 0.05 / 0.12 s; FILTER ENV 1 ms / 0.12 s / 0 / 0.1 s; LFO and reverb off.',
            ],
          },
          {
            title: ['Warm Pad · 温暖铺底', 'Warm Pad'],
            body: [
              'OSC1 三角 `DETUNE` +5；OSC2 三角 `DETUNE` −5；FILTER 低通 3200 Hz、`RES` 0.15、`ENV AMT` 0.3；AMP ENV 1.1 s / 1.2 s / 0.85 / 2.2 s；LFO RATE 0.6、DEPTH 0.25；混响 `SIZE` 0.75、`MIX` 0.45。',
              'OSC1 triangle `DETUNE` +5; OSC2 triangle `DETUNE` −5; filter low-pass 3200 Hz, `RES` 0.15, `ENV AMT` 0.3; AMP ENV 1.1 s / 1.2 s / 0.85 / 2.2 s; LFO rate 0.6, depth 0.25; reverb `SIZE` 0.75, `MIX` 0.45.',
            ],
          },
          {
            title: ['Screaming Lead · 尖叫主音', 'Screaming Lead'],
            body: [
              'OSC1 锯齿 `DETUNE` +7；OSC2 锯齿 `DETUNE` −6；FILTER 低通 9000 Hz、`RES` 0.25、`DRIVE` 0.2、`ENV AMT` 0.5；AMP ENV 3 ms / 0.18 s / 0.6 / 0.3 s；LFO RATE 5、DEPTH 0.2 指向 pitch；延迟 1/8、`MIX` 0.2；混响 `MIX` 0.25。',
              'OSC1 saw `DETUNE` +7; OSC2 saw `DETUNE` −6; filter low-pass 9000 Hz, `RES` 0.25, `DRIVE` 0.2, `ENV AMT` 0.5; AMP ENV 3 ms / 0.18 s / 0.6 / 0.3 s; LFO rate 5, depth 0.2 to pitch; delay 1/8, `MIX` 0.2; reverb `MIX` 0.25.',
            ],
          },
        ],
      },
      { kind: 'h', text: ['最后：保存与对比', 'Finally — save and compare'] },
      {
        kind: 'ol',
        items: [
          ['点顶栏「保存」，起一个名字。', 'Press Save in the top bar and give it a name.'],
          ['用 A/B 槽对比两个版本，用撤销回退。', 'Compare two versions with the A/B slots and step back with undo.'],
          [
            '满意后导出 `.gs1.json` 备份，或生成分享链接。',
            'When happy, export a `.gs1.json` backup or copy a share link.',
          ],
        ],
      },
    ],
  },
];
