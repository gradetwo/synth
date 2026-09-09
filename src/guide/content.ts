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
  // ================================================================ basics
  {
    id: 'basics',
    title: ['合成器基础', 'Synthesis basics'],
    intro: [
      '合成器用电子方式从零构造声音，而不是回放录音。要理解它，需要先理解声音的物理、谐波与数字采样，再理解减法合成的思路。',
      'A synthesizer constructs sound from scratch instead of playing back a recording. That starts with the physics of sound, harmonics and digital sampling, then the idea of subtractive synthesis.',
    ],
    blocks: [
      { kind: 'h', text: ['什么是合成', 'What synthesis is'] },
      {
        kind: 'p',
        text: [
          '合成（synthesis）是实时计算波形。采样器把录下的声音回放出来，合成器则从一个简单的电子信号出发，用滤波器、包络和调制把它塑造成乐器。',
          'Synthesis computes a waveform in real time. A sampler plays back a recording; a synthesizer starts from a simple electrical signal and shapes it into an instrument with filters, envelopes and modulation.',
        ],
      },
      { kind: 'h', text: ['声音的物理', 'The physics of sound'] },
      {
        kind: 'p',
        text: [
          '声音是介质中的压力波。描述一个周期波只需要三个量：**频率**（每秒振动次数，单位 Hz）、**振幅**（压力变化的幅度）、**相位**（周期的起点）。周期与频率互为倒数 `T = 1/f`；波长 `λ = c/f`，空气中声速约 343 m/s。',
          'Sound is a pressure wave in a medium. A periodic wave needs only three quantities: **frequency** (cycles per second, Hz), **amplitude** (how large the pressure swing is) and **phase** (where the cycle starts). Period and frequency are reciprocals, `T = 1/f`; wavelength is `λ = c/f`, with sound travelling at about 343 m/s in air.',
        ],
      },
      {
        kind: 'p',
        text: [
          '人耳大致能听到 20 Hz–20 kHz。钢琴最低音 A0 是 27.5 Hz，最高音 C8 是 4186 Hz；中央 C（C4）约 261.6 Hz。听觉对频率是对数感知的——这就是为什么音高用半音和音分来度量。',
          'Human hearing spans roughly 20 Hz–20 kHz. A piano’s lowest A0 is 27.5 Hz and its top C8 is 4186 Hz; middle C (C4) is about 261.6 Hz. Pitch is perceived logarithmically — which is why we measure it in semitones and cents.',
        ],
      },
      {
        kind: 'table',
        head: [
          ['术语', 'Term'],
          ['含义', 'Meaning'],
          ['听感 / 用途', 'Perception / use'],
        ],
        rows: [
          [
            ['频率 Frequency', 'Frequency'],
            ['每秒周期数，Hz', 'Cycles per second, Hz'],
            ['决定音高', 'Sets pitch'],
          ],
          [
            ['振幅 Amplitude', 'Amplitude'],
            ['压力变化的大小', 'Size of the pressure swing'],
            ['决定响度', 'Sets loudness'],
          ],
          [
            ['相位 Phase', 'Phase'],
            ['周期内的位置，0–360°', 'Position in the cycle, 0–360°'],
            ['决定波形叠加的相长/相消', 'Causes constructive or destructive addition'],
          ],
          [
            ['谐波 Harmonics', 'Harmonics'],
            ['基频的整数倍分量', 'Integer multiples of the fundamental'],
            ['决定音色（明暗、软硬）', 'Sets timbre (bright, dark, soft, hard)'],
          ],
        ],
      },
      { kind: 'h', text: ['谐波与傅里叶定理', 'Harmonics and Fourier'] },
      {
        kind: 'p',
        text: [
          '傅里叶定理指出：任何周期波都可以分解为一系列正弦波——一个基频加上它的整数倍谐波。基频决定音高，各次谐波的相对幅度与相位决定音色。这就是"频谱"的含义。',
          'The Fourier theorem says any periodic wave can be decomposed into sine waves: a fundamental plus its integer multiples. The fundamental sets the pitch; the relative amplitude and phase of the harmonics set the timbre. That is what “spectrum” means.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '谐波序列：`f, 2f, 3f, 4f…`。偶次谐波（2f、4f）听起来更暖更圆，奇次谐波（3f、5f）更空、更像木管。',
            'The harmonic series is `f, 2f, 3f, 4f…`. Even harmonics (2f, 4f) sound warm and round; odd harmonics (3f, 5f) sound hollow and reedy.',
          ],
          [
            '方波只含奇次谐波，所以中空；锯齿波奇偶都有，所以明亮厚实；正弦只有基频，所以纯净。',
            'A square contains only odd harmonics, hence the hollow tone; a saw has both, hence bright and thick; a sine has only the fundamental, hence pure.',
          ],
          [
            '非整数倍的分量叫非谐波泛音，会带来金属、钟琴、锣一类的质感；噪声则是连续频谱、没有音高。',
            'Non-integer partials are inharmonic and give metallic, bell-like or gong-like colours; noise is a continuous spectrum with no pitch.',
          ],
          [
            '两个频率非常接近的振荡器会产生**拍频**（beating），每秒拍的次数等于频率差——这就是失谐（detune）让声音变宽的原理。',
            'Two oscillators tuned very close together produce **beating** at the frequency difference — that is how detune widens a sound.',
          ],
        ],
      },
      { kind: 'h', text: ['音高、音程与音分', 'Pitch, intervals and cents'] },
      {
        kind: 'p',
        text: [
          '现代音乐用十二平均律：一个八度分成 12 个等比半音，半音频率比是 `2^(1/12) ≈ 1.059463`。国际标准音 A4 = 440 Hz。MIDI 音号 n 的频率为 `f = 440 × 2^((n−69)/12)`。',
          'Modern tuning is twelve-tone equal temperament: an octave is 12 equal semitones with a ratio of `2^(1/12) ≈ 1.059463`. The reference A4 is 440 Hz. MIDI note n has frequency `f = 440 × 2^((n−69)/12)`.',
        ],
      },
      {
        kind: 'p',
        text: [
          '音分（cent）是八度的 1/1200，一个半音正好 100 音分。本机的 `PITCH` 以半音为单位，`DETUNE` 以音分为单位——差 5–15 音分是加厚声音的常用范围。',
          'A cent is 1/1200 of an octave, so a semitone is exactly 100 cents. This synth expresses `PITCH` in semitones and `DETUNE` in cents; 5–15 cents is the usual range for thickening a sound.',
        ],
      },
      { kind: 'h', text: ['采样、混叠与量化', 'Sampling, aliasing and quantisation'] },
      {
        kind: 'p',
        text: [
          '数字音频把连续波形按固定采样率离散化。**奈奎斯特定理**：采样率必须高于信号最高频率的 2 倍，否则高频会被"折叠"成错误的低频——这就是**混叠**（aliasing）。44.1 kHz 能无混叠地表示到 22.05 kHz，48 kHz 到 24 kHz。',
          'Digital audio discretises a continuous waveform at a fixed sample rate. The **Nyquist theorem** requires the rate to exceed twice the highest frequency, otherwise high frequencies fold down to wrong lower ones — **aliasing**. 44.1 kHz represents up to 22.05 kHz cleanly; 48 kHz up to 24 kHz.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '**位深**决定量化噪声与动态范围，大约每比特 6 dB。内部用 32 位浮点处理可获得极大余量。',
            '**Bit depth** sets quantisation noise and dynamic range, roughly 6 dB per bit. Internal 32-bit floating point gives enormous headroom.',
          ],
          [
            '锯齿波和方波在数学上含无限次谐波，直接生成一定会混叠。**带限合成**解决这个问题：polyBLEP 在波形跳变处加一段多项式修正，或改用加法/波表。',
            'Saw and square waves mathematically contain infinite harmonics, so generating them naively always aliases. **Band-limited synthesis** solves it: polyBLEP adds a polynomial correction at each discontinuity, or you use additive/wavetable methods.',
          ],
          [
            '本机的三角、锯齿、方波、脉冲都使用 DaisySP 的 polyBLEP 变体，正弦使用正弦表；噪声由 Rust 端的 xorshift 生成。',
            'This synth uses DaisySP’s polyBLEP variants for triangle, saw, square and pulse, a sine table for sine, and a Rust xorshift generator for noise.',
          ],
        ],
      },
      { kind: 'h', text: ['分贝、余量与削波', 'Decibels, headroom and clipping'] },
      {
        kind: 'p',
        text: [
          '分贝是对数比值：`dB = 20·log10(A/A0)`。幅度翻倍约 +6 dB，感知响度翻倍约 +10 dB。数字满刻度是 0 dBFS，超过就硬削波，产生刺耳的谐波。',
          'A decibel is a logarithmic ratio: `dB = 20·log10(A/A0)`. Doubling amplitude is about +6 dB; doubling perceived loudness about +10 dB. Digital full scale is 0 dBFS, and exceeding it hard-clips into harsh harmonics.',
        ],
      },
      {
        kind: 'p',
        text: [
          '多个声部相加会迅速堆高电平。工程上要给效果和复音留出余量；软削波（`tanh`、过载）比硬削波好听得多。',
          'Voices add up quickly. Leave headroom for effects and polyphony; soft clipping (`tanh`, overdrive) sounds far better than hard clipping.',
        ],
      },
      { kind: 'h', text: ['减法合成', 'Subtractive synthesis'] },
      {
        kind: 'p',
        text: [
          '本机属于**减法合成**（subtractive / virtual analog）：先用谐波丰富的振荡器做原料，再用滤波器"减掉"不需要的频段，用包络和 LFO 随时间塑造音量和音色，最后加效果。Minimoog、Prophet-5 都是这个范式。',
          'This synth is **subtractive** (virtual analog): start with harmonically rich oscillators, subtract unwanted bands with a filter, shape level and timbre over time with envelopes and LFOs, then add effects. The Minimoog and Prophet-5 follow the same model.',
        ],
      },
      { kind: 'h', text: ['调制基础', 'Modulation basics'] },
      {
        kind: 'ul',
        items: [
          [
            '**调制**是用一个信号去改变另一个参数。速率低于约 20 Hz 时听成"变化"（LFO、包络）；高于 20 Hz 时听成新的音高成分（FM 的边带）。',
            '**Modulation** uses one signal to change another parameter. Below about 20 Hz it is heard as movement (LFO, envelope); above 20 Hz it is heard as new pitched content (FM sidebands).',
          ],
          [
            '**AM 幅度调制**产生颤音或门限；**FM 频率调制**（严格说是相位调制）产生大量边带，是 DX7 的基础；**环形调制**是双极性 AM，产生金属、非谐波音色。',
            '**AM** gives tremolo or gating; **FM** (strictly phase modulation) creates dense sidebands and is the basis of the DX7; **ring modulation** is bipolar AM and produces metallic, inharmonic tones.',
          ],
        ],
      },
      { kind: 'h', text: ['滤波器理论', 'Filter theory'] },
      {
        kind: 'ul',
        items: [
          [
            '滤波器是一个频率相关的增益。**截止频率**是增益下降 3 dB 的点，**斜率**用 dB/oct 表示，取决于极点数量：一极点 6 dB，二极点（SVF）12 dB，四极点（梯形）24 dB。',
            'A filter is a frequency-dependent gain. The **cutoff** is the −3 dB point; the **slope** in dB/oct depends on the number of poles: one pole 6 dB, two poles (SVF) 12 dB, four poles (ladder) 24 dB.',
          ],
          [
            '**共振（Q）**在截止点附近抬高增益形成峰。Q 足够高时滤波器进入自激振荡，输出接近正弦音。',
            '**Resonance (Q)** lifts a peak around the cutoff. High enough Q drives the filter into self-oscillation, close to a sine tone.',
          ],
          [
            '模拟滤波器的饱和与反馈带来"温暖"的听感；数字模型用非线性 `tanh` 与过采样去逼近它——本机的低通就是 Huovilainen New Moog 模型。',
            'Analogue saturation and feedback give the classic “warmth”; digital models approximate it with `tanh` non-linearity and oversampling — this synth’s low-pass is the Huovilainen New Moog model.',
          ],
        ],
      },
      { kind: 'h', text: ['包络与低频振荡', 'Envelopes vs. LFOs'] },
      {
        kind: 'p',
        text: [
          '包络是**一次性**调制：每次按键触发一条时间曲线，走完就停。LFO 是**周期性**调制：持续循环推动某个参数。包络的段可以是线性或指数；模拟合成器多是指数（RC 充放电），本机是线性 attack 加一极点指数 decay/release。',
          'An envelope is a **one-shot** modulation: each key press triggers a time curve that runs once. An LFO is **periodic**: it keeps cycling and pushing a parameter. Envelope stages can be linear or exponential; analogue synths are usually exponential (RC charging), while this synth uses a linear attack plus one-pole exponential decay/release.',
        ],
      },
    ],
  },

  // ================================================================ history
  {
    id: 'history',
    title: ['合成器简史', 'A short history'],
    intro: [
      '从 200 吨的巨型机器到浏览器里的 WASM，合成器史就是一部"把声音拆开再装回去"的历史。',
      'From a 200-ton machine to WASM in a browser: the history of synthesizers is the story of taking sound apart and putting it back together.',
    ],
    blocks: [
      { kind: 'h', text: ['前史：会唱歌的机器（1897–1935）', 'Prehistory: singing machines (1897–1935)'] },
      {
        kind: 'ul',
        items: [
          [
            '**Telharmonium / Dynamophone**（Thaddeus Cahill，1897 年专利，1906 年建成）：重约 200 吨的加法音轮机器，通过电话线向酒店和剧院"广播"音乐，是第一台真正意义上的电子乐器。',
            '**Telharmonium / Dynamophone** (Thaddeus Cahill, patented 1897, built 1906): a ~200-ton additive tonewheel machine that “broadcast” music to hotels and theatres over telephone lines — the first true electronic instrument.',
          ],
          [
            '**Theremin**（Léon Theremin，1920）：两个高频振荡器差拍，音高和音量由手与天线的电容控制，是第一种无需触碰的乐器。',
            '**Theremin** (Léon Theremin, 1920): two high-frequency oscillators beating against each other, with pitch and volume controlled by hand capacitance — the first instrument played without touching it.',
          ],
          [
            '**Ondes Martenot**（Maurice Martenot，1928）与 **Trautonium**（Friedrich Trautwein，1930）：前者用拉环连续滑音，后者用金属丝与共振峰滤波，影响了很多后来的演奏界面。',
            '**Ondes Martenot** (Maurice Martenot, 1928) and **Trautonium** (Friedrich Trautwein, 1930): the former glides continuously with a ring, the latter uses a wire and formant filtering — both shaped later performance interfaces.',
          ],
          [
            '**Hammond 风琴**（1935）：音轮加法合成，用机械齿轮产生正弦分音，成为教堂、爵士和摇滚的常客。',
            '**Hammond organ** (1935): tonewheel additive synthesis, generating sine partials mechanically — a staple of church, jazz and rock.',
          ],
        ],
      },
      { kind: 'h', text: ['实验室与计算机（1948–1960）', 'Laboratories and computers (1948–1960)'] },
      {
        kind: 'ul',
        items: [
          [
            '**具体音乐**（musique concrète，Pierre Schaeffer，1948）与**电子音乐**（WDR 科隆工作室，1951）把磁带剪辑、振荡器与滤波变成作曲手段。',
            '**Musique concrète** (Pierre Schaeffer, 1948) and **elektronische Musik** (WDR Cologne, 1951) turned tape editing, oscillators and filters into compositional tools.',
          ],
          [
            '**RCA Mark II Sound Synthesizer**（1955–57，哥伦比亚-普林斯顿）：真空管、打孔纸带序列控制，是第一台可编程合成器，体积占满一间屋子。',
            '**RCA Mark II Sound Synthesizer** (1955–57, Columbia-Princeton): vacuum tubes and a punched-paper sequencer, the first programmable synthesizer, filling a whole room.',
          ],
          [
            '**Max Mathews** 在贝尔实验室写出 **MUSIC I**（1957），第一次用计算机合成音乐；MUSIC N 系列后来演变成 Csound 等系统。',
            '**Max Mathews** wrote **MUSIC I** at Bell Labs (1957), the first computer music program; the MUSIC N family later grew into systems such as Csound.',
          ],
        ],
      },
      { kind: 'h', text: ['电压控制革命（1963–1970）', 'The voltage-control revolution (1963–1970)'] },
      {
        kind: 'ul',
        items: [
          [
            '**Moog modular**（Robert Moog 与 Herbert Deutsch，1964）把振荡器、滤波器、放大器做成**电压控制**模块，键盘输出 1V/oct 的 CV，第一次让"键盘 + 合成器"成为一体。Moog 的晶体管梯形低通滤波器（24 dB/oct）成为标志性音色。',
            'The **Moog modular** (Robert Moog with Herbert Deutsch, 1964) made oscillators, filters and amplifiers **voltage-controlled**; the keyboard output 1 V/oct CV and turned “keyboard + synthesizer” into one instrument. Moog’s transistor ladder low-pass (24 dB/oct) became an icon.',
          ],
          [
            '**Buchla 100**（Don Buchla，1963）走"西海岸"路线：复杂振荡器、低通门（low-pass gate）、触摸板，不做传统键盘，强调音色与随机。',
            'The **Buchla 100** (Don Buchla, 1963) took the “west-coast” path: complex oscillators, low-pass gates and touch plates instead of a keyboard, focused on timbre and chance.',
          ],
          [
            '**EMS VCS3 / Synthi A**（1969）用插针矩阵连接模块，成为实验与摇滚的宠儿。',
            'The **EMS VCS3 / Synthi A** (1969) connected modules with a pin matrix and became a favourite of experimental and rock musicians.',
          ],
        ],
      },
      { kind: 'h', text: ['便携、复音与可编程（1970–1983）', 'Portable, polyphonic, programmable (1970–1983)'] },
      {
        kind: 'ul',
        items: [
          [
            '**Minimoog Model D**（1970）把模块合成器压缩成便携一体化乐器，成为史上最著名的单音合成器之一；**ARP 2600**（1971）则是半模块化的代表。',
            'The **Minimoog Model D** (1970) compressed the modular into a portable, integrated instrument and became one of the most famous monosynths; the **ARP 2600** (1971) represented semi-modular design.',
          ],
          [
            '**Sequential Circuits Prophet-5**（1978）：第一台**全可编程复音**模拟合成器，用微处理器存储音色，从此"预设"成为常态。',
            'The **Sequential Circuits Prophet-5** (1978) was the first fully programmable polyphonic analogue synth, storing patches in a microprocessor — presets became the norm.',
          ],
          [
            '**Roland TR-808**（1980）与 **TB-303**（1981）商业上并不成功，却在二手市场催生了 hip-hop、house 与 acid；303 的滑音 + 共振滤波器成为 acid 的定义。',
            'The **Roland TR-808** (1980) and **TB-303** (1981) flopped commercially but spawned hip-hop, house and acid; the 303’s glide plus resonant filter literally defined acid.',
          ],
        ],
      },
      { kind: 'h', text: ['数字、采样与工作站（1979–1990s）', 'Digital, sampling and workstations (1979–1990s)'] },
      {
        kind: 'ul',
        items: [
          [
            '**Fairlight CMI**（1979）与 **E-mu Emulator**（1981）开启采样时代：任何声音都能被录下、变调、铺到键盘上。',
            'The **Fairlight CMI** (1979) and **E-mu Emulator** (1981) opened the sampling era: any sound could be recorded, transposed and mapped to a keyboard.',
          ],
          [
            '**Yamaha DX7**（1983）用 FM 合成和数字芯片卖出了数十万台，定义了 80 年代的玻璃电钢与贝斯音色。同年 **MIDI** 标准发布，不同厂牌的设备第一次能互通。',
            'The **Yamaha DX7** (1983) used FM synthesis and a digital chip to sell in the hundreds of thousands, defining 80s glassy electric pianos and basses. **MIDI** arrived the same year, letting instruments from different makers finally talk to each other.',
          ],
          [
            '**Roland D-50**（1987）的 LA 合成与 **Korg M1**（1988）的工作站把采样、合成与效果整合进一台琴，数字合成也让音色可以完美复制、批量生产。',
            'Roland’s **D-50** (1987) with LA synthesis and Korg’s **M1** (1988) workstation integrated samples, synthesis and effects; digital also made sounds perfectly reproducible and mass-produced.',
          ],
        ],
      },
      { kind: 'h', text: ['软件与虚拟模拟（1996–2010s）', 'Software and virtual analogue (1996–2010s)'] },
      {
        kind: 'ul',
        items: [
          [
            '**Steinberg VST**（1996）把合成器变成宿主里的插件；**Propellerhead ReBirth**（1997）用软件复刻了 303 和 808。',
            '**Steinberg VST** (1996) turned synthesizers into host plug-ins; **Propellerhead ReBirth** (1997) recreated the 303 and 808 in software.',
          ],
          [
            'Native Instruments 的 Reaktor / Absynth、Arturia 的模拟建模，以及 CPU 性能的暴涨，让**虚拟模拟**（virtual analogue）几乎可以以假乱真。',
            'Native Instruments’ Reaktor / Absynth, Arturia’s analogue modelling and exploding CPU power made **virtual analogue** nearly indistinguishable from hardware.',
          ],
        ],
      },
      { kind: 'h', text: ['当代（2010s–今天）', 'The present (2010s–today)'] },
      {
        kind: 'ul',
        items: [
          [
            '**波表合成**（如 Xfer Serum，2014）让振荡器在单周期波形表之间插值，兼顾减法合成的直觉与数字频谱的自由度。',
            '**Wavetable synthesis** (e.g. Xfer Serum, 2014) interpolates through single-cycle tables, combining subtractive intuition with digital spectral freedom.',
          ],
          [
            '**MPE**（每音独立的表情控制）与 **Eurorack** 模块化复兴，把演奏表情和可重构信号链重新带回主流。',
            '**MPE** (per-note expression) and the **Eurorack** modular revival brought expressive playing and reconfigurable signal chains back into the mainstream.',
          ],
          [
            '**Web Audio API + WebAssembly** 让完整合成器直接跑在浏览器里。本机就是 Rust 编译到 WASM、在 AudioWorklet 中逐块计算——历史上第一次，一台 Prophet 式的减法合成器可以是一个网址。',
            'The **Web Audio API + WebAssembly** let a complete synthesizer run in a browser. This synth is Rust compiled to WASM, computing block by block inside an AudioWorklet — for the first time, a Prophet-style subtractive synth can be a URL.',
          ],
        ],
      },
    ],
  },

  // ================================================================ types
  {
    id: 'types',
    title: ['合成器分类', 'Synthesizer taxonomy'],
    intro: [
      '合成器可以从三个维度分类：发声方法、信号架构、演奏方式。',
      'Synthesizers are classified along three axes: sound-generation method, signal architecture and playing style.',
    ],
    blocks: [
      { kind: 'h', text: ['按发声方法', 'By sound-generation method'] },
      {
        kind: 'table',
        head: [
          ['方法', 'Method'],
          ['原理', 'Principle'],
          ['代表机型', 'Classic examples'],
        ],
        rows: [
          [
            ['减法 Subtractive', 'Subtractive'],
            ['富含谐波的波形 → 滤波器削减', 'Rich waveform → filter subtracts bands'],
            ['Minimoog、Prophet-5、本机', 'Minimoog, Prophet-5, this synth'],
          ],
          [
            ['加法 Additive', 'Additive'],
            ['叠加许多正弦分音', 'Sum many sine partials'],
            ['Hammond、Synclavier', 'Hammond, Synclavier'],
          ],
          [
            ['FM / 相位调制', 'FM / phase modulation'],
            ['载波被调制器改变相位，产生边带', 'A modulator changes the carrier’s phase, creating sidebands'],
            ['Yamaha DX7、Opsix', 'Yamaha DX7, Opsix'],
          ],
          [
            ['波表 Wavetable', 'Wavetable'],
            ['在单周期波形表之间插值扫描', 'Interpolate through single-cycle tables'],
            ['PPG Wave、Serum', 'PPG Wave, Serum'],
          ],
          [
            ['相位失真 Phase distortion', 'Phase distortion'],
            ['用分段曲线加速相位，模拟滤波器感', 'Bend phase with piecewise curves for a filter-like sweep'],
            ['Casio CZ 系列', 'Casio CZ series'],
          ],
          [
            ['采样回放 Sample-based', 'Sample-based'],
            ['播放录下的样本并变调', 'Play back recordings transposed'],
            ['Fairlight、Kontakt', 'Fairlight, Kontakt'],
          ],
          [
            ['颗粒 Granular', 'Granular'],
            ['把样本切成大量短颗粒拼接', 'Slice samples into many short grains'],
            ['GRM Tools、Absynth', 'GRM Tools, Absynth'],
          ],
          [
            ['物理建模 Physical modelling', 'Physical modelling'],
            ['用波导/弦模型模拟真实振动', 'Simulate real vibrating systems with waveguides'],
            ['Yamaha VL1', 'Yamaha VL1'],
          ],
          [
            ['共振峰 Formant', 'Formant'],
            ['用人声共振峰滤波塑造元音', 'Shape vowels with vocal formant filters'],
            ['声码器类', 'Vocoder-style instruments'],
          ],
          [
            ['向量 Vector', 'Vector'],
            ['在四个音源之间连续混合', 'Crossfade between four sources'],
            ['Prophet VS', 'Prophet VS'],
          ],
          [
            ['频谱 Spectral', 'Spectral'],
            ['在 FFT 频域直接处理', 'Process directly in the FFT domain'],
            ['Synclavier、Kyma', 'Synclavier, Kyma'],
          ],
        ],
      },
      { kind: 'h', text: ['按信号架构', 'By signal architecture'] },
      {
        kind: 'ul',
        items: [
          [
            '**固定架构**：信号链在出厂时就定好（本机）。上手快、复音成本低、音色稳定。',
            '**Fixed architecture**: the signal path is fixed at the factory (this synth). Fast to learn, cheap polyphony, consistent results.',
          ],
          [
            '**模块化 / 半模块化**：每个模块都要自己连线（Eurorack、Moog modular、ARP 2600）。自由度极高，但复音昂贵、上手慢。',
            '**Modular / semi-modular**: you patch every connection yourself (Eurorack, Moog modular, ARP 2600). Maximum freedom, but polyphony is expensive and the learning curve is steep.',
          ],
          [
            '**模拟 / 数字 / 混合**：模拟振荡器与滤波器有元件漂移与非线性，数字则精确、可复现、易扩展；混合设计取两者之长。',
            '**Analogue / digital / hybrid**: analogue oscillators and filters drift and saturate; digital is precise, repeatable and extensible. Hybrids take both.',
          ],
          [
            '**硬件 / 软件**：硬件有实体手感与电路特性；软件易保存、易更新、可无限复音。本机是浏览器里的软件合成器。',
            '**Hardware / software**: hardware gives physical control and circuit character; software is easy to save, update and scale. This synth is software in a browser.',
          ],
        ],
      },
      { kind: 'h', text: ['按演奏方式', 'By playing style'] },
      {
        kind: 'ul',
        items: [
          ['**单音 Mono**：一次一个音，通常带滑音，适合贝斯与主音。', '**Mono**: one note at a time, usually with glide — basses and leads.'],
          [
            '**准复音 Paraphonic**：多个音共享一条包络/滤波器，能同时响但无法独立塑形。',
            '**Paraphonic**: several notes share one envelope/filter, so they sound together but cannot be shaped independently.',
          ],
          [
            '**复音 Poly**：每个音有独立声部（本机 16 复音），是铺底与和弦的基础。',
            '**Poly**: each note has its own voice (16 here) — the basis of pads and chords.',
          ],
          [
            '**MPE**：每个音有独立的弯音、压力和滑音，表现力接近原声乐器。',
            '**MPE**: per-note pitch bend, pressure and slide for near-acoustic expression.',
          ],
        ],
      },
      { kind: 'h', text: ['本机定位', 'Where this synth sits'] },
      {
        kind: 'p',
        text: [
          '本机是**数字减法合成器（虚拟模拟）**：固定架构，两个振荡器 + 梯形/SVF 滤波器 + 双包络 + 双 LFO + 4 路调制矩阵 + 立体声效果，16 复音，参数以块速率更新，运行在浏览器 AudioWorklet 里。',
          'This synth is a **digital subtractive (virtual analogue)** instrument: fixed architecture, two oscillators, a ladder/SVF filter, two envelopes, two LFOs, a four-slot mod matrix and stereo effects, 16-voice polyphonic, with block-rate parameters inside a browser AudioWorklet.',
        ],
      },
    ],
  },

  // ================================================================ modules
  {
    id: 'modules',
    title: ['模块原理详解', 'How the modules work'],
    intro: [
      '这一节讲每个模块背后的算法，以及本机的具体实现（Rust + DaisySP/Soundpipe，编译为 WASM）。',
      'This section explains the algorithm behind each module and how this synth implements it (Rust + DaisySP/Soundpipe, compiled to WASM).',
    ],
    blocks: [
      { kind: 'h', text: ['信号链总览', 'Signal flow overview'] },
      {
        kind: 'p',
        text: [
          '每个声部：`OSC1 + OSC2`（各自波形/音高/失谐/电平/脉宽/声像）→ 混合 → `AMP ENV × 力度` → LFO 音量调制 → 滤波器（受 `FILTER ENV`、键盘跟踪、LFO 与矩阵调制）→ DC 阻断 → 等功率声像 → 立体声总线。总线再依次经过合唱/镶边/移相/过载 → 混响 → 延迟 → 主音量。',
          'Per voice: `OSC1 + OSC2` (each with waveform/pitch/detune/level/pulse width/pan) → mix → `AMP ENV × velocity` → LFO volume modulation → filter (modulated by `FILTER ENV`, keyboard tracking, LFOs and the matrix) → DC block → equal-power pan → stereo bus. The bus then runs chorus/flanger/phaser/overdrive → reverb → delay → master volume.',
        ],
      },
      { kind: 'h', text: ['振荡器 OSC', 'Oscillator'] },
      {
        kind: 'ul',
        items: [
          [
            '**相位累加器**：每个采样把相位加上 `f / fs` 并对 1 取模；相位回绕就产生一个周期。频率越高，每周期采到的样点越少。',
            '**Phase accumulator**: each sample adds `f / fs` to the phase and wraps at 1. Wrapping produces one cycle; the higher the frequency, the fewer samples per cycle.',
          ],
          [
            '**带限波形**：三角/锯齿/方波/脉冲使用 polyBLEP——在波形跳变处叠加一段多项式修正，抵消混叠；正弦用正弦表。',
            '**Band-limited waveforms**: triangle, saw, square and pulse use polyBLEP, adding a polynomial correction at each discontinuity to cancel aliasing; sine uses a table.',
          ],
          [
            '**失谐与拍频**：`DETUNE` 以音分微调两个振荡器，频率差产生拍频和立体宽度。差 5–15 音分最自然。',
            '**Detune and beating**: `DETUNE` shifts the two oscillators in cents; the frequency difference produces beating and width. 5–15 cents is most natural.',
          ],
          [
            '**脉冲宽度**：`PW` 改变方波的占空比。占空比越小，谐波越偏奇次、越"鼻音"；LFO 或矩阵可以调制它（PWM）。',
            '**Pulse width**: `PW` changes the square’s duty cycle. Narrower duty emphasises odd harmonics and sounds nasal; LFOs or the matrix can modulate it (PWM).',
          ],
          [
            '**噪声**：Rust 端的 xorshift 白噪声，无音高、频谱连续，用于风声、打击与上升音。',
            '**Noise**: a Rust xorshift white-noise generator, pitchless with a flat spectrum, used for wind, percussion and risers.',
          ],
          [
            '**保护**：频率被钳制在 0.25 Hz–0.45×采样率，避免极端设置产生非法值或超声折叠。',
            '**Safety**: frequency is clamped to 0.25 Hz–0.45× the sample rate to avoid invalid values or ultrasonic folding.',
          ],
        ],
      },
      { kind: 'h', text: ['滤波器 FILTER', 'Filter'] },
      {
        kind: 'ul',
        items: [
          [
            '**低通（LP）**使用 Huovilainen New Moog 梯形模型：四极点 24 dB/oct，4× 线性过采样加 `tanh` 非线性，共振映射为 `res × 1.7`，接近自激。这是"Moog 味"的来源。',
            '**Low-pass (LP)** uses the Huovilainen New Moog ladder: four poles at 24 dB/oct, 4× linear oversampling and `tanh` non-linearity, with resonance mapped to `res × 1.7`, close to self-oscillation. That is where the “Moog” character comes from.',
          ],
          [
            '**高通 / 带通 / 陷波**使用状态变量滤波器（SVF）：二极点 12 dB/oct，数值稳定、便于调制。',
            '**High-pass / band-pass / notch** use a state-variable filter (SVF): two poles at 12 dB/oct, numerically stable and easy to modulate.',
          ],
          [
            '**驱动 DRIVE**：低通用输入增益 `1 + drive × 1.5` 推入 `tanh` 饱和；SVF 用内置的 `SetDrive`。驱动越强，谐波与响度感知越高。',
            '**Drive**: the ladder pushes an input gain of `1 + drive × 1.5` into `tanh` saturation; the SVF uses its built-in `SetDrive`. More drive means more harmonics and perceived loudness.',
          ],
          [
            '**键盘跟踪 KBD**：截止频率按半音比例随音高移动，让高音和低音保持相同的明亮度。',
            '**Keyboard tracking**: the cutoff follows the note in semitone ratio so high and low notes stay equally bright.',
          ],
          [
            '**FILTER ENV**：截止频率乘以 `2^(env × amount × 6)`，满量程约 ±6 个八度；LFO 与矩阵分别用 `2^(x × 4)` 调制。',
            '**FILTER ENV** multiplies the cutoff by `2^(env × amount × 6)`, about ±6 octaves at full range; LFOs and the matrix modulate with `2^(x × 4)`.',
          ],
          [
            '**DC 阻断**：滤波器与过载会引入直流偏移，每声部末尾有一个 DC blocker 把它去掉，避免浪费动态余量。',
            '**DC blocking**: filters and overdrive introduce DC offset, so a DC blocker at the end of each voice removes it and preserves headroom.',
          ],
        ],
      },
      { kind: 'h', text: ['包络 ENV', 'Envelope'] },
      {
        kind: 'ul',
        items: [
          [
            '**Attack 是线性的**：每个采样增加 `1/(attack × fs)`；**Decay / Release 是一极点指数**，按时间常数平滑趋近目标。这比全线性更接近模拟电路。',
            '**Attack is linear**: each sample adds `1/(attack × fs)`. **Decay and release are one-pole exponentials** that approach the target with a time constant — closer to analogue circuits than all-linear segments.',
          ],
          [
            '**双包络**：`AMP ENV` 乘到音量；`FILTER ENV` 调制截止频率。两者共享按键 gate，但时间参数完全独立，这是"打击感 + 明亮起音"的关键。',
            '**Two envelopes**: `AMP ENV` multiplies the level, `FILTER ENV` modulates the cutoff. They share the gate but have fully independent times — the key to punchy, bright attacks.',
          ],
          [
            '**偷声**时可以对被抢占的声部单独缩短 release，让它平滑淡出而不是硬切，避免咔哒声。',
            'During **voice stealing** the victim’s release can be shortened independently so it fades instead of cutting, avoiding clicks.',
          ],
        ],
      },
      { kind: 'h', text: ['LFO', 'LFO'] },
      {
        kind: 'ul',
        items: [
          [
            '速率范围 0.02–40 Hz，可选正弦 / 三角 / 方波 / 锯齿，并可同步到节拍。',
            'Rate spans 0.02–40 Hz with sine, triangle, square or saw, optionally synced to tempo.',
          ],
          [
            '**目标换算**：pitch 为 ±2 半音（depth = 1），cutoff 为 `2^(±4 八度)`，pwm 为 ±0.4，volume 为颤音。',
            '**Target scaling**: pitch ±2 semitones at depth 1, cutoff `2^(±4 octaves)`, pwm ±0.4, volume as tremolo.',
          ],
          [
            '两个 LFO 可以分别指向不同目标，也可以作为源进入调制矩阵。',
            'The two LFOs can point at different targets, or act as sources in the mod matrix.',
          ],
        ],
      },
      { kind: 'h', text: ['调制矩阵 MOD MATRIX', 'Mod matrix'] },
      {
        kind: 'ul',
        items: [
          [
            '**源**：LFO、包络、调制轮、力度；**目标**：截止、音高、音量、PWM。每条路由有深度，可多条叠加。',
            '**Sources**: LFO, envelope, mod wheel, velocity. **Destinations**: cutoff, pitch, volume, PWM. Each route has an amount and routes stack.',
          ],
          [
            '矩阵以**块速率**（每 128 采样）在每个声部上计算一次，然后在整个块内平滑应用，兼顾效率与稳定。',
            'The matrix is evaluated once per **block** (128 samples) per voice and applied smoothly across the block — efficient and stable.',
          ],
          [
            'pitch 目标按 ±12 半音换算，cutoff 按 `2^(x × 4)` 换算，volume 直接乘到包络之后的增益。',
            'Pitch routes scale to ±12 semitones, cutoff routes to `2^(x × 4)`, and volume routes multiply the post-envelope gain.',
          ],
        ],
      },
      { kind: 'h', text: ['效果 FX', 'Effects'] },
      {
        kind: 'ul',
        items: [
          [
            '**混响**：Soundpipe 的 `reverbsc`（Sean Costello 的八延时线反馈网络）。`SIZE` 映射反馈 0.70–0.97 与低通 4–14 kHz，`MIX` 控制干湿比。',
            '**Reverb**: Soundpipe’s `reverbsc` (Sean Costello’s eight-delay-line feedback network). `SIZE` maps feedback 0.70–0.97 and a low-pass from 4–14 kHz; `MIX` sets the dry/wet balance.',
          ],
          [
            '**延迟**：单条延时线加反馈，时值可同步到 1/4、1/8.、1/8、1/16；改变时值时用约 20 ms 的一极点平滑，避免咔哒。',
            '**Delay**: one delay line with feedback, synced to 1/4, 1/8., 1/8 or 1/16. Time changes are smoothed with a ~20 ms one-pole to avoid clicks.',
          ],
          [
            '**合唱**：短延时（约 5–30 ms）被 LFO 调制，产生多个失谐副本；**镶边**用更短的延时并加入反馈，形成梳状滤波扫频。',
            '**Chorus**: a short delay (~5–30 ms) modulated by an LFO, creating detuned copies; **flanger** uses a shorter delay with feedback for a comb-filter sweep.',
          ],
          [
            '**移相**：一串全通滤波器，LFO 移动它们的中心频率，形成流动的相位抵消陷波。',
            '**Phaser**: a chain of all-pass filters whose centre frequencies are moved by an LFO, creating moving phase-cancellation notches.',
          ],
          [
            '**过载**：非线性波形整形（waveshaping），增加谐波，让声音听起来更响更"脏"。',
            '**Overdrive**: non-linear waveshaping that adds harmonics and makes the sound louder and dirtier.',
          ],
        ],
      },
      { kind: 'h', text: ['声部与复音', 'Voices and polyphony'] },
      {
        kind: 'ul',
        items: [
          [
            '最多 **16 个声部**，每个声部有独立的振荡器状态、包络和滤波器状态。',
            'Up to **16 voices**, each with its own oscillator state, envelopes and filter state.',
          ],
          [
            '**分配与偷声**：优先用空闲声部；满了以后挑最旧/最弱的声部进入短 release，并把新音放进 8 槽待定队列，等槽位空闲后无咔哒地重触发。',
            '**Allocation and stealing**: free slots are claimed first. When full, the oldest/quietest voice is forced into a short release and the new note waits in an eight-slot pending queue until a slot frees, then retriggers without a click.',
          ],
          [
            '**滑音 GLIDE**：用指数一极点从当前频率逼近目标频率，时间常数约为 `glide × 0.5`。',
            '**Glide**: an exponential one-pole approach from the current frequency to the target, with a time constant of about `glide × 0.5`.',
          ],
          [
            '**力度**乘到音量，也可以通过矩阵调制音色；**声像**把两个振荡器的 PAN 按电平加权成一个声部位置，再用等功率 `cos/sin` 分配到左右声道。',
            '**Velocity** multiplies the level and can modulate timbre through the matrix; **pan** combines the two oscillator PANs into one level-weighted voice position, then uses equal-power `cos/sin` to place it in the stereo field.',
          ],
        ],
      },
      { kind: 'h', text: ['数字实现', 'Digital implementation'] },
      {
        kind: 'ul',
        items: [
          [
            'Rust 编译到 `wasm32-unknown-unknown`，无 crates.io 依赖；同时产出 SIMD 与标量两份，运行时用 `WebAssembly.validate` 探测并自动回退。',
            'Rust compiles to `wasm32-unknown-unknown` with no crates.io dependencies. Both SIMD and scalar builds ship, and `WebAssembly.validate` picks one at runtime with automatic fallback.',
          ],
          [
            '在 AudioWorklet 中按 128–1024 采样的**块**处理，参数是 **k-rate**（每块取一次值），既符合 AudioParam 模型又足够高效。',
            'Processing runs in an AudioWorklet in blocks of 128–1024 samples with **k-rate** parameters (one value per block) — faithful to the AudioParam model and efficient.',
          ],
          [
            '**零分配**：Rust 与 C 共享一块 8 MiB 静态 arena，`gs_alloc_violations()` 监控任何越界分配，保证音频线程不触发 GC 或 `malloc`。',
            '**Zero allocation**: Rust and C share an 8 MiB static arena, and `gs_alloc_violations()` flags any stray allocation so the audio thread never calls `malloc` or triggers a GC.',
          ],
          [
            '不使用 SharedArrayBuffer，音符事件通过 **Transferable ArrayBuffer** 传入，兼容 Safari 等严格环境。',
            'No SharedArrayBuffer is used; note events arrive as **Transferable ArrayBuffers**, keeping strict environments such as Safari happy.',
          ],
          [
            '负载过高时按 4 步自动降低复音，并在负载回落后缓慢恢复，避免爆音。',
            'Under heavy load polyphony drops in steps of four and recovers slowly afterwards, preventing dropouts.',
          ],
        ],
      },
    ],
  },

  // ================================================================ start
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
            '**顶栏**：预设切换、A/B 音色槽、撤销/重做、MIDI、钢琴卷帘、键盘显示、随机、保存、预设库（手机/平板竖屏把次要操作收进「⋯」）。',
            '**Top bar**: preset stepper, A/B slots, undo/redo, MIDI, piano roll, keyboard toggle, randomize, save, preset library (phones and portrait tablets keep the secondary actions under “⋯”).',
          ],
          [
            '**监视区**：示波器、频谱、音符/力度/复音、VU 表，以及播放器入口。',
            '**Monitor row**: scope, spectrum, note/velocity/voice readout, VU meter and the player entry.',
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

  // ================================================================ help
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
          [
            '**手机**默认只展开 OSC 1/2、FILTER 与 AMP ENV，收起 LFO/MATRIX/FX/FX 2，并把示波器与频谱收成一行（点右侧箭头展开）；顶栏「⋯」里放 MIDI、随机、保存等次要操作。',
            'On **phones** only OSC 1/2, FILTER and AMP ENV start expanded; LFO/MATRIX/FX/FX 2 are collapsed and the scope/spectrum row shrinks to one strip (tap the arrow to expand). Secondary actions such as MIDI, randomise and save live under the “⋯” menu.',
          ],
          [
            '**平板**竖屏把品牌、视图切换与常用动作排在第一行、预设独占第二行，监视区默认也是一条带波形与频谱的紧凑条（点箭头展开三块面板），模块全部保持展开。',
            'On **tablets** in portrait the wordmark, view toggle and primary actions share the first row while the preset stepper owns the second; the monitor also starts as a compact strip with live waveform and spectrum (tap the arrow for the three panels) and every module stays expanded.',
          ],
          [
            '**电脑**顶栏保持单行，但把 A/B 对比、随机、保存收进右侧「⋯」，让预设名完整显示；模块默认全部展开，监视区显示示波器、频谱与监视三块面板。',
            'On **desktop** the bar stays a single row, but A/B compare, randomise and save move into the “⋯” menu so the preset name is never clipped. Every module starts expanded and the monitor shows the scope, spectrum and monitor panels.',
          ],
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
          ['同一处的**高对比**在深/浅色之上再加强对比度，适合强光环境或低视力用户。', 'The **Contrast** button next to it layers extra contrast on top of either colour scheme, for bright light or low vision.'],
          [
            '**主题**：预设库底部的「深色 / 浅色 / 自动」切换配色，**自动**会实时跟随系统的深色模式（改系统外观立即生效）；顶栏「⋯」里的主题按钮可以快速循环切换，选择会记住。',
            '**Theme**: the “Dark / Light / Auto” control at the bottom of the preset library switches the colour scheme; **Auto** follows the operating system live (switching appearance takes effect immediately). The theme button in the top-bar “⋯” menu cycles through the three modes, and the choice is remembered.',
          ],
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

  // ================================================================ tools
  {
    id: 'tools',
    title: ['播放器与信号流', 'Player & signal flow'],
    intro: [
      '监视区的「播放器」按钮打开 MIDI 播放器；顶栏「信号流」切换到可拖拽的信号流视图，两者共同构成演奏与录制的工作区。',
      'The Player button in the monitor opens the MIDI player; the Flow toggle in the top bar switches to a draggable signal-flow canvas. Together they are the performance and recording workspace.',
    ],
    blocks: [
      { kind: 'h', text: ['MIDI 播放器', 'MIDI player'] },
      {
        kind: 'ul',
        items: [
          [
            '内置 16 首曲目：致爱丽丝、卡农、月光奏鸣曲（第一乐章）、梦中的婚礼、土耳其进行曲、River Flows in You、Summer、克罗地亚狂想曲、天空之城、超级玛丽主题曲、权力的游戏主题曲、茉莉花、梁祝（选段）、沧海一声笑，以及琶音、音阶两条练习素材。',
            'Sixteen built-in items: Für Elise, Canon in D, Moonlight Sonata (I), Mariage d’Amour, Turkish March, River Flows in You, Summer, Croatian Rhapsody, Castle in the Sky, the Super Mario theme, the Game of Thrones theme, Jasmine Flower, Butterfly Lovers (excerpt), A Chinese Ghost Story, plus arpeggio and scale exercises.',
          ],
          [
            '**导入 MIDI**：支持标准 MIDI 文件（`.mid` / `.midi`，格式 0/1），自动合并多轨、读取速度与音轨名，导入后立即出现在曲目列表并可播放。',
            '**Import MIDI**: standard MIDI files (`.mid` / `.midi`, format 0/1) are parsed, multi-track files merged, tempo and track names read, and the result appears in the list ready to play.',
          ],
          [
            '**播放控制**：播放 / 暂停、停止、循环、拖动进度条定位、速度 0.5–1.5×、移调 ±12 半音。播放使用当前音色，所以边播边换预设就能听到同一旋律的不同配器。',
            '**Transport**: play/pause, stop, loop, seek, rate 0.5–1.5× and transpose ±12 semitones. Playback uses the current patch, so changing presets while it plays re-orchestrates the same melody live.',
          ],
          [
            '**录制**：点 ● 录制后用屏幕键盘、电脑键盘或 MIDI 控制器演奏，再点 ■ 结束；录制会忽略播放器自身的输出，只记录你弹的内容。',
            '**Recording**: hit ● and play on the screen keyboard, computer keyboard or a MIDI controller, then ■ to stop. The player’s own output is ignored, so only your playing is captured.',
          ],
          [
            '**导出 MIDI**：把当前曲目或录制保存为 `.mid`，可在别的 DAW 里继续编辑。',
            '**Export MIDI**: saves the current track or take as `.mid` for further editing in a DAW.',
          ],
          [
            '**导出 MP3**：用当前音色离线渲染整首曲目并编码为 192 kbps MP3。录制的片段可以在换音色后重新导出，得到不同音色的版本。',
            '**Export MP3**: renders the whole track offline with the current patch and encodes it to 192 kbps MP3. A recorded take can be re-exported after changing the patch for a different timbre.',
          ],
        ],
      },
      {
        kind: 'tip',
        text: [
          '内置曲目是简短示范片段，版权归原作者所有；古典与民乐为公版作品。练习素材（琶音、音阶）可直接用来熟悉键盘与音色。',
          'The built-in items are short demonstration excerpts; rights remain with their owners. Classical and folk pieces are public domain. The exercises (arpeggios, scales) are there for getting comfortable with the keyboard and patches.',
        ],
      },
      { kind: 'h', text: ['信号流视图', 'Signal-flow view'] },
      {
        kind: 'ul',
        items: [
          [
            '每个节点代表一个处理单元：OSC 1、OSC 2、FILTER、AMP ENV、LFO、LFO 2、MATRIX、FX、FX 2、OUT。节点内的迷你画面实时显示波形、滤波响应、包络、LFO 形状、矩阵路由或效果衰减。',
            'Each node is one processing unit: OSC 1, OSC 2, FILTER, AMP ENV, LFO, LFO 2, MATRIX, FX, FX 2, OUT. The mini display inside shows the waveform, filter response, envelope, LFO shape, matrix routing or effect decay in real time.',
          ],
          [
            '**拖拽**节点可自定义布局，位置会记住；手机竖屏默认两列。',
            '**Drag** nodes to arrange the canvas; positions persist, and phones default to two columns.',
          ],
          [
            '**缩放 / 重置**：画布左上角的浮层里有 `−` / `+` 缩放、`⤢` 一键适应全部节点、`⟲` 重置画布；桌面端 `Ctrl/Cmd + 滚轮`（触控板双指）也可缩放。打开时默认自动适应到全部节点可见，画布会自动为浮层让出空间。',
            '**Zoom**: `−` / `+` in the toolbar, `⤢` to fit every node, and `Ctrl/Cmd + wheel` (trackpad pinch) on desktop. The canvas auto-fits so all nodes are visible when it opens.',
          ],
          [
            '**旁通 / 启用**：带电源图标的节点（振荡器、LFO、效果）可以一键开关，节点变灰并显示 `BYPASS`。',
            '**Bypass / enable**: nodes with a power icon (oscillators, LFOs, effects) switch off with one tap; the node greys out and shows `BYPASS`.',
          ],
          [
            '**移除 / 添加**：✕ 把节点从画布移除，工具栏会保留对应按钮，随时点回来；工具栏的 ⟲「重置画布」恢复默认布局。',
            '**Remove / add**: ✕ takes a node off the canvas; a chip in the toolbar brings it back at any time, and the toolbar’s ⟲ “Reset canvas” restores the default layout.',
          ],
          [
            '**展开参数**：点节点或 ⤢ 打开右侧参数面板，里面就是该模块的完整控件。',
            '**Open parameters**: click a node or ⤢ to open the full control set for that module in a side panel.',
          ],
        ],
      },
      { kind: 'h', text: ['演奏模式', 'Performance mode'] },
      {
        kind: 'p',
        text: [
          '信号流视图顶部的性能条就是演奏模式：选择曲目、播放 / 暂停 / 停止 / 循环、录制。缩放与重置画布在画布左上角的浮层里；导入、导出 MIDI / MP3 在「播放器」面板里。手机上进入信号流视图时，监视条会自动收起、底部键盘默认收起，把整屏留给信号图；点右下角「⌨ 键盘」或顶栏键盘按钮可以随时把键盘调出来，画布会自动让出空间。',
          'The bar at the top of the flow view is performance mode: pick a track, play/pause/stop/loop and record. Zoom and canvas reset live in a floating panel at the top-left of the board; import and MIDI/MP3 export live in the player panel. On phones the monitor strip hides and the keyboard starts tucked away so the graph owns the screen; tap the “⌨ keyboard” pill or the top-bar toggle to bring it back and the canvas makes room automatically.',
        ],
      },
      { kind: 'h', text: ['钢琴卷帘编辑器', 'Piano-roll editor'] },
      {
        kind: 'p',
        text: [
          '顶栏「钢琴卷帘」（手机/平板在「⋯」里）或播放器面板的「编辑」按钮打开。它编辑当前曲目：点空白处画音符，拖动音符移动音高与时间，拖右缘改长度，双击或 `⌫` 删除，`Ctrl/Cmd+Z` 撤销。',
          'Open it from **Piano roll** in the top bar (under “⋯” on phones/tablets) or the **Edit** button in the player panel. It edits the current track: tap empty space to draw a note, drag a note to move it in pitch and time, drag its right edge to resize, double-click or press `⌫` to delete, and `Ctrl/Cmd+Z` to undo.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            '工具栏：BPM、网格（1/32–1/4）、长度、量化、移调 ±12、力度、撤销/重做、清空、导出 MIDI、保存。',
            'Toolbar: BPM, grid (1/32–1/4), length, quantize, transpose ±12, velocity, undo/redo, clear, export MIDI, save.',
          ],
          [
            '**输入**开关打开后，点网格或弹底部键盘都能写入音符；外部 MIDI 键盘点「连接 MIDI」授权后同样可用。步进输入：停止状态下弹奏时，**按住琴键的时长就是音符长度**，松开后写入并前进到音符末尾。',
            'With **Input** armed, tapping the grid or playing the keyboard strip writes notes; an external MIDI keyboard works after “Connect MIDI”. Step input: while stopped, **how long you hold the key becomes the note length**, and the playhead advances to the end of the note.',
          ],
          [
            '内置曲目保存时会另存为新片段，导入文件与录制片段则原地更新。',
            'Saving a built-in track creates a new clip; imported files and recordings are updated in place.',
          ],
        ],
      },
      { kind: 'h', text: ['和弦识别', 'Chord recognition'] },
      {
        kind: 'p',
        text: [
          '同时按住两个以上音符时，监视器会把 `NOTE` 自动切换为 `CHORD` 并显示和弦名（大三、小三、减、增、挂留、七和弦、九和弦、加九，以及 `/低音` 转位），下方列出实际按下的音。',
          'When two or more notes are held, the monitor switches from `NOTE` to `CHORD` and shows the chord name (major, minor, diminished, augmented, sus, sevenths, ninths, add9 and slash inversions), with the actual notes listed underneath.',
        ],
      },
    ],
  },

  // ================================================================ build
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
