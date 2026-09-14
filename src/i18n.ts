/**
 * Bilingual UI strings (zh / en) — the **first-screen core table**.
 *
 * Only the copy the first frame can render lives here: the boot gate, the top
 * bar, the module grid with its parameter labels and wave/mode names, the
 * performance keyboard, the filter and impulse-response selectors, and the
 * error strings the engine can toast before any panel exists. The test is
 * per-key, not per-prefix: every key below is read by code that runs during the
 * first frame, and `i18n.test.ts` asserts that by walking the eager import
 * graph.
 *
 * Everything else — the preset library drawer, the settings drawer, the audio
 * settings drawer, the player panel with its takes and clip arrangement, the
 * piano roll, the routing graph, the guide and changelog, the signal-flow
 * canvas and the imported-source rows — lives in `src/i18n-panels.ts` and is
 * registered at runtime. The three eager components whose copy is lazy (the
 * settings drawer and the two imported-source pickers) gate on a sentinel key
 * with `useStringsReady()`, so they render nothing for that microtask instead of
 * painting a key name.
 *
 * This is a structural split, not a lazy wrapper around a synchronous `t()`:
 * the string tables themselves leave the entry chunk, which is what moves the
 * first-screen JS gzip line (the measured before/after numbers are in
 * `scripts/verify-budget.mjs`).
 *
 * ## The loading contract
 *
 * * `hasKey()` answers for every key the app references **anywhere**, because
 *   registration folds in the keys of every table that has loaded. Registration
 *   is atomic, so "has this table arrived" is answered by probing one of its
 *   keys. `i18n.test.ts` loads everything first and then checks that every
 *   statically referenced key is covered, and that no key sits in two tables.
 * * `t()` and `getLang()` stay **synchronous** on purpose: toast helpers,
 *   `aria-label`s, canvas drawing and the worklet-status path call them from
 *   code that cannot await. A key whose table has not arrived falls back to the
 *   key name — the pre-existing "missing key" behaviour — which is why a panel
 *   must load its strings *before* it renders, exactly as it waits for its own
 *   chunk.
 * * Changing the language goes through `loadAllStrings()` and only then commits
 *   the layout (the settings drawer does the awaiting, so `store.toggleLang()`
 *   stays synchronous for its own callers), so a switch can never paint one
 *   language and correct itself a frame later.
 */

export type Lang = 'zh' | 'en';

/** One string in both languages: `[zh, en]`. */
export type Bi = [string, string];

/** A table of `key: [zh, en]` pairs, as each module exports it. */
export type StringTable = Record<string, Bi>;

const CORE: StringTable = {
  // --- app shell -----------------------------------------------------------
  'app.start': ['启动音频引擎', 'Start Audio Engine'],
  'app.starting': ['正在启动…', 'Starting…'],
  'app.startFailed': ['启动失败', 'Startup failed'],
  'app.retry': ['重试', 'Retry'],
  'app.updateReady': ['新版本已就绪', 'New version ready'],
  'app.updateNow': ['立即更新', 'Update now'],
  'app.later': ['稍后', 'Later'],
  'app.suspended': ['⏸ 音频已暂停 · 点按此处恢复', '⏸ Audio suspended · tap to resume'],
  'app.sharedLoaded': ['已载入分享音色', 'Shared patch loaded'],
  'preset.initName': ['INIT · 初始正弦', 'INIT · Sine'],

  // --- top bar -------------------------------------------------------------
  'top.prevPreset': ['上一个预设', 'Previous preset'],
  'top.nextPreset': ['下一个预设', 'Next preset'],
  'top.openPresets': ['点击打开预设库', 'Open the preset library'],
  'top.random': ['随机', 'Random'],
  'top.randomTitle': ['随机生成新音色', 'Generate a random patch'],
  'top.randomToast': ['已随机生成新音色 · <b>RANDOM</b>', 'Random patch generated · <b>RANDOM</b>'],
  'top.save': ['保存', 'Save'],
  'top.browse': ['预设库', 'Presets'],
  'top.savedToast': ['已保存到预设库 · <b>{name}</b>', 'Saved to the preset library · <b>{name}</b>'],
  'top.keyboard': ['键盘', 'Keyboard'],
  'top.keyboardHide': ['隐藏键盘', 'Hide keyboard'],
  'top.keyboardShow': ['显示键盘', 'Show keyboard'],
  'top.midiUnsupported': ['此浏览器不支持 Web MIDI', 'Web MIDI is not supported in this browser'],
  'top.midiError': ['MIDI 错误：{msg}', 'MIDI error: {msg}'],
  'top.midiEnabled': ['已启用 · 未检测到设备', 'Enabled · no device detected'],
  'top.midiConnect': ['连接 MIDI 键盘 / 控制器', 'Connect a MIDI keyboard / controller'],
  'top.abGroup': ['A/B 音色对比', 'A/B patch compare'],
  'top.slotA': ['音色槽 A（点击切换，首次点击保存当前音色）', 'Patch slot A (tap to switch; the first tap captures the current patch)'],
  'top.slotB': ['音色槽 B（点击切换，首次点击保存当前音色）', 'Patch slot B (tap to switch; the first tap captures the current patch)'],
  'top.copySlot': ['把当前音色复制到另一个槽', 'Copy the current patch to the other slot'],
  'top.undo': ['撤销', 'Undo'],
  'top.redo': ['重做', 'Redo'],

  // --- panels --------------------------------------------------------------
  'panel.scope': ['SCOPE · 时域波形', 'SCOPE · Waveform'],
  'panel.spectrum': ['SPECTRUM · 频谱', 'SPECTRUM · Spectrum'],
  'panel.monitor': ['MONITOR · 监视', 'MONITOR · Monitor'],
  'monitor.polyTitle': ['负载过高时自动降低的复音上限', 'Polyphony cap reduced automatically under load'],
  'canvas.scopeAria': ['时域波形示波器', 'Waveform oscilloscope'],
  'canvas.spectrumAria': ['频谱分析', 'Spectrum analyser'],
  'canvas.meterHint': ['峰值 dB · 响度 dB · DSP 负载（占每个渲染量子的时间预算）', 'Peak dB · loudness dB · DSP load (share of the render-quantum budget)'],
  'canvas.vuAria': ['输出电平', 'Output level'],

  // --- modules -------------------------------------------------------------
  'module.osc1.sub': ['振荡器 A', 'Oscillator A'],
  'module.osc2.sub': ['振荡器 B', 'Oscillator B'],
  'module.filter.sub': ['滤波器', 'Filter'],
  'module.env.sub': ['振幅包络', 'Amp envelope'],
  'module.lfo.sub': ['低频振荡', 'Low-frequency oscillator'],
  'module.matrix.sub': ['调制路由', 'Modulation routing'],
  'module.fx.sub': ['效果处理', 'Effects'],
  'module.fx2.sub': ['调制效果', 'Modulation effects'],
  'module.drag': ['拖动排序', 'Drag to reorder'],
  'module.dragAria': ['拖动 {title} 排序', 'Drag {title} to reorder'],
  'module.collapse': ['收起', 'Collapse'],
  'module.expand': ['展开', 'Expand'],
  'module.ledAria': ['{title} 开关', '{title} on/off'],
  'module.addRoute': ['＋ 添加调制路由', '+ Add modulation route'],
  'module.voiceMode': ['声部模式', 'Voice mode'],
  'module.modePoly': ['复音', 'Poly'],
  'module.modeMono': ['单音 · 每次重新触发包络', 'Mono · retrigger the envelope'],
  'module.modeLegato': ['连奏 · 不重触发包络', 'Legato · no envelope retrigger'],
  'module.filterType': ['滤波器类型', 'Filter type'],
  'filter.lp': ['低通 · Moog 阶梯', 'Low-pass · Moog ladder'],
  'filter.hp': ['高通', 'High-pass'],
  'filter.bp': ['带通', 'Band-pass'],
  'filter.formant': ['元音共振峰：截止频率在 A-E-I-O-U 之间滑动，共振控制带宽', 'Vowel formants: the cutoff morphs A-E-I-O-U, resonance sets the bandwidth'],
  'filter.comb': ['梳状谐振器：截止频率决定梳齿音高，共振决定反馈量', 'Comb resonator: cutoff sets the comb pitch, resonance its feedback'],
  'module.filterRouting': ['滤波接法', 'Filter routing'],
  'filter.routingOff': ['只有一级滤波（默认，旧音色不变）', 'One filter stage (default; older patches unchanged)'],
  'filter.routingSeries': ['串联：信号依次经过两级，斜率相加', 'Series: the signal passes both stages and the slopes add up'],
  'filter.routingParallel': ['并联：两级各自处理同一输入，按混合量相加', 'Parallel: both stages filter the same input and BLEND mixes them'],
  'filter.sem': ['SEM 连续多模：12 dB/oct，MORPH 从低通连续扫到带通、陷波、高通', 'SEM continuous multimode: 12 dB/oct, MORPH sweeps low-pass → band-pass → notch → high-pass'],
  'filter.nt': ['陷波', 'Notch'],
  'filter.oversample': ['2× 过采样：失真/滤波路径在双倍采样率下运算再带限降回，代价是约 0.33 ms 延迟与更高 CPU', '2× oversampling: the drive/filter path runs at twice the rate and is band-limited back down; costs ~0.33 ms of latency and extra CPU'],
  'module.lfoTarget': ['LFO 目标', 'LFO target'],
  'module.lfo2Target': ['LFO 2 目标', 'LFO 2 target'],
  'module.lfoSync': ['LFO 同步', 'LFO sync'],
  'module.lfoRetrig': ['每个音符重触发 LFO（每声部独立相位）', 'Restart the LFO on every note'],
  'module.lfoRetrigShort': ['RETRIG', 'RETRIG'],
  'module.lfoOneshot': ['单次：跑完一个周期后停住', 'One-shot: run a single cycle and hold'],
  'module.lfoOneshotShort': ['ONE SHOT', 'ONE SHOT'],
  'module.lfo2Retrig': ['LFO 2 每个音符重触发', 'Restart LFO 2 on every note'],
  'module.lfo2Oneshot': ['LFO 2 单次运行', 'LFO 2 one-shot'],
  'module.lfo2On': ['LFO 2 开关', 'LFO 2 on/off'],
  'module.reverbOn': ['混响开关', 'Reverb on/off'],
  'module.delayOn': ['延迟开关', 'Delay on/off'],
  'module.crush': ['比特压碎', 'BIT CRUSH'],
  'module.eq': ['塑形均衡', 'SHAPING EQ'],
  'module.transient': ['瞬态整形', 'TRANSIENT'],
  'module.matrixSrc': ['调制源', 'Source'],
  'module.matrixDst': ['调制目标', 'Destination'],
  'module.matrixAmt': ['调制量', 'Amount'],
  'module.matrixEnable': ['启用路由', 'Enable route'],
  'module.matrixDelete': ['删除路由', 'Delete route'],
  'module.kbdTrack': ['键盘跟踪', 'Keyboard tracking'],
  'env.valueHint': ['长按或拖动上下调节 · 点击输入数值', 'Hold/drag vertically to adjust · tap to type a value'],

  // --- preset drawer -------------------------------------------------------
  'theme.label': ['主题', 'Theme'],
  'theme.dark': ['深色', 'Dark'],
  'theme.light': ['浅色', 'Light'],
  'theme.auto': ['自动', 'Auto'],

  // --- guide ---------------------------------------------------------------
  'display.expand': ['展开示波器与频谱', 'Show scope & spectrum'],
  'display.collapse': ['收起示波器与频谱', 'Hide scope & spectrum'],
  'top.more': ['更多操作', 'More actions'],

  // --- player / midi -------------------------------------------------------
  'player.title': ['播放器', 'Player'],
  'app.overload': [
    '设备负载偏高：已自动把复音数降到 {n}（监视器可查看 DSP 负载%）',
    'Device load is high: polyphony dropped to {n} automatically (the monitor shows the DSP load)',
  ],
  'roll.title': ['钢琴卷帘', 'Piano roll'],
  'roll.open': ['钢琴卷帘编辑', 'Piano roll editor'],
  'view.label': ['视图', 'View'],
  'view.modules': ['模块', 'Modules'],
  'view.flow': ['信号流', 'Flow'],
  'kbd.region': ['演奏键盘', 'Performance keyboard'],
  'kbd.octDown': ['降低八度', 'Octave down'],
  'kbd.octUp': ['升高八度', 'Octave up'],
  'kbd.pitch': ['弯音轮', 'Pitch wheel'],
  'kbd.mod': ['调制轮', 'Mod wheel'],
  'kbd.tip1': ['◈ <b>点击/滑奏琴键</b> 触发包络与示波器', '◈ <b>Tap / glide the keys</b> to trigger the envelope and scope'],
  'kbd.tip2': ['◈ <b>拖动旋钮</b> 上下调节 · <b>双击</b> 复位', '◈ <b>Drag a knob</b> to adjust · <b>double-tap</b> to reset'],
  'kbd.tip3': ['◈ <b>Shift+拖动</b> 微调 · 滚轮同样可用', '◈ <b>Shift+drag</b> to fine-tune · the wheel works too'],
  'kbd.tip4': ['◈ <b>拖动模块标题栏 ⠿</b> 调整顺序', '◈ <b>Drag a module header ⠿</b> to reorder'],
  // touch-specific tips: no Shift, no wheel — long-press instead
  'kbd.tipT1': ['◈ <b>点按/滑奏琴键</b> 触发包络与示波器', '◈ <b>Tap / glide the keys</b> to trigger the envelope and scope'],
  'kbd.tipT2': ['◈ <b>拖动旋钮</b> 上下调节 · <b>双击</b> 复位', '◈ <b>Drag a knob</b> up/down · <b>double-tap</b> to reset'],
  'kbd.tipT3': ['◈ <b>长按旋钮 0.6 秒</b> 再拖动可微调', '◈ <b>Hold a knob 0.6 s</b>, then drag to fine-tune'],
  'kbd.tipT4': ['◈ <b>长按数值格拖动</b> 调包络 · 单击可输入', '◈ <b>Hold & drag a value</b> to shape the envelope · tap to type'],
  'kbd.hintTouch': ['拖动旋钮调节 · 双击复位 · 长按后拖动可微调', 'Drag to adjust · double-tap to reset · hold, then drag to fine-tune'],
  'kbd.hintMouse': ['拖动旋钮 · 滚轮 / Shift 微调 · 双击复位', 'Drag to adjust · wheel / Shift to fine-tune · double-tap to reset'],
  'knob.fine': ['微调', 'fine'],
  'kbd.velocity': ['力度', 'VEL'],
  'kbd.velocityHint': ['按键力度：越靠近琴键下缘越响', 'Key velocity: the lower you strike, the louder'],
  'kbd.haptics': ['振动', 'HAP'],
  'kbd.hapticsHint': ['按键振动反馈（部分设备不支持）', 'Haptic feedback on key press (device dependent)'],

  // --- waveform names ------------------------------------------------------
  'wave.sine': ['正弦', 'Sine'],
  'wave.triangle': ['三角', 'Triangle'],
  'wave.saw': ['锯齿', 'Saw'],
  'wave.square': ['方波', 'Square'],
  'wave.pulse': ['脉冲', 'Pulse'],
  'wave.noise': ['白噪', 'White'],
  'wave.pink': ['粉噪', 'Pink'],
  'wave.brown': ['棕噪', 'Brown'],
  'wave.wavetable': ['波表（PW 选表）', 'Wavetable (PW picks it)'],
  'top.settings': ['设置', 'Settings'],
  // --- settings drawer -----------------------------------------------------
  'module.subOff': ['无 sub', 'No sub oscillator'],
  'module.subOne': ['低一个八度', 'One octave down'],
  'module.subTwo': ['低两个八度', 'Two octaves down'],
  'module.syncOff': ['OSC 1 自由振荡', 'OSC 1 runs free'],
  'module.syncOn': [
    '硬同步：OSC 2 每完成一个周期就把 OSC 1 的相位拉回起点（同步主音色；OSC 2 的 PITCH 就是比例）',
    'Hard sync: OSC 2 restarts OSC 1 every time it completes a cycle (the classic sync lead; OSC 2’s PITCH is the ratio)',
  ],
  'module.oscShaping': [
    'OSC 2 → OSC 1 · FM 相位调制 / RING 环形调制 / SYNC 硬同步（需要 OSC 2 打开）· NOISE 混入白噪',
    'OSC 2 → OSC 1 · FM phase modulation / RING ring modulation / SYNC hard sync (needs OSC 2 on) · NOISE blends white noise in',
  ],
  // --- two instances -------------------------------------------------------
  // --- sampler (A) ---------------------------------------------------------
  // --- impulse response reverb (A5) ---------------------------------------
  'ir.algo': ['算法', 'Algo'],
  'ir.ir': ['IR', 'IR'],
  'ir.import': ['导入 IR', 'Import IR'],
  'ir.none': ['未导入', 'none'],
  'ir.hint': [
    '导入一段脉冲响应（WAV/AIFF/FLAC/MP3，建议单声道、≤2 秒）作为卷积混响；超过 2 秒会被截断，音量按能量归一化',
    'Import an impulse response (WAV/AIFF/FLAC/MP3, mono and up to 2 s is typical) as a convolution reverb; longer files are truncated and the level is energy-normalised',
  ],
  'ir.clearHint': ['移除导入的脉冲响应', 'Remove the imported response'],
  'ir.loaded': ['已导入 IR {name}', 'Imported IR {name}'],
  'ir.cleared': ['已移除 IR', 'Impulse response removed'],
  'ir.err.short': ['这段 IR 太短，无法作为混响', 'That response is too short to be a reverb'],
  'ir.err.silent': ['这段 IR 里没有声音', 'That response is silent'],
  'ir.err.notFinite': ['IR 含有无效采样', 'That response contains invalid samples'],
  'ir.err.decode': ['无法解码这个文件（格式不支持或文件损坏）', 'That file could not be decoded (unsupported or damaged)'],
  'ir.err.noRoom': ['内存不足：请先清掉导入的采样/波表再试', 'Not enough room for the response: clear an imported sample or wavetable first'],
  // --- effect chain (A5) ---------------------------------------------------
  'fx.chain': ['信号链', 'CHAIN'],
  'fx.chainHint': [
    '效果的处理顺序：靠前的先处理。用 ‹ › 换位置，∥ 把插入式效果变成并联送出（干声保留，效果叠加）',
    'The order effects are processed in: earlier runs first. Use ‹ › to swap positions, ∥ to turn an insert effect into a parallel send (dry kept, effect added)',
  ],
  'fxg.title': ['效果路由图', 'Effect routing'],
  'fxg.hintOn': [
    '信号从左往右流：从干声或任一节点的输出拖（或先点输出再点输入）到输入端口即可连线；点连线或输入行的「无」断开。每个节点可有两路输入，一起求和。',
    'Signal flows left to right: drag from the dry source or a node output to an input (or tap the output, then the input) to connect; click a wire or pick “none” to disconnect. A node can sum two inputs.',
  ],
  'fx.moveLeft': ['前移一位', 'Move earlier'],
  'fx.moveRight': ['后移一位', 'Move later'],
  'fx.parallel': ['并联送出', 'Parallel send'],
  'fx.parallelHint': [
    '并联：效果声叠加在干声上，而不是与干声交叉淡化',
    'Parallel: the effect is added to the dry signal instead of being crossfaded with it',
  ],
  // --- delay (A5) ----------------------------------------------------------
  'fx.pingPong': ['乒乓', 'Ping-pong'],
  'fx.pingPongHint': [
    '开启后回声左右交替出现；关闭时左右各自重复',
    'Echoes alternate between the speakers; off, each channel repeats its own input',
  ],
  // --- imported single-cycle wavetable (A6.2) ------------------------------

  // --- errors / diagnostics ------------------------------------------------
  'err.wasmFetch': ['WASM 下载失败 (HTTP {status})', 'WASM download failed (HTTP {status})'],
  'err.wasmValidate': ['WASM 模块校验失败（SIMD 与标量核心均不可用）', 'WASM validation failed (neither the SIMD nor the scalar core is usable)'],
  'err.midiUnsupported': ['此浏览器不支持 Web MIDI', 'Web MIDI is not supported in this browser'],
  'err.midiDevice': ['未命名设备', 'Unnamed device'],
};

/**
 * Runtime table: the core entries plus every module that has been registered.
 * Registration is additive and idempotent, so loading a module twice is free.
 */
const DICT: StringTable = { ...CORE };

/**
 * Key names of every module that ships copy, folded in at registration time.
 * This is what keeps `hasKey()` complete without putting the copy in the entry
 * chunk.
 */
const DECLARED = new Set<string>(Object.keys(CORE));

/** Keys that actually came from a lazy module; the tests tell the two apart. */
const FROM_MODULES = new Set<string>();

/** Listeners that want to know when new copy has arrived (see the hook). */
const REGISTRY_LISTENERS = new Set<() => void>();

/**
 * Subscribe to registry changes. Used by `useStringsReady()`, which gates the
 * imported-source rows: they are eager UI whose copy is not, so they wait for
 * the registration rather than rendering a key name for a frame.
 */
export function subscribeStrings(listener: () => void): () => void {
  REGISTRY_LISTENERS.add(listener);
  return () => REGISTRY_LISTENERS.delete(listener);
}

/**
 * Register a module's copy. Called by the module loaders.
 *
 * The key names come from the table itself rather than from a parallel list:
 * the list used to be a separate `readonly string[]` next to each table, but it
 * lives in the same chunk as the copy it names, so for the `dist` budget (a raw
 * byte sum) it was ~7 KB of duplicated strings rather than the "cheap key names"
 * the split was designed around. Registration is atomic — the whole table lands
 * and then the listeners fire — so callers may gate on any single key.
 */
export function registerStrings(table: StringTable): void {
  for (const key of Object.keys(table)) {
    DECLARED.add(key);
    FROM_MODULES.add(key);
  }
  Object.assign(DICT, table);
  for (const listener of REGISTRY_LISTENERS) listener();
}

let current: Lang = 'zh';

export function setLang(lang: Lang): void {
  current = lang === 'en' ? 'en' : 'zh';
}

export function getLang(): Lang {
  return current;
}

/** Translate a key, interpolating `{name}` placeholders. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  let text = entry ? entry[current === 'zh' ? 0 : 1] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Preset/author names are authored as `English · 中文`. English UI shows only
 * the English part; Chinese keeps the full bilingual label.
 */
export function localizeName(name: string): string {
  if (current === 'en') {
    const separator = name.indexOf(' · ');
    return separator > 0 ? name.slice(0, separator).trim() : name;
  }
  return name;
}

/** How many keys the inline table holds; the lazy tables add the rest. */
export function coreKeyCount(): number {
  return Object.keys(CORE).length;
}

/** True when the key's copy is in the inline first-screen table. */
export function hasCoreCopy(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CORE, key);
}

/** Keys that have arrived from a lazy module so far (test helper). */
export function moduleKeyCount(): number {
  return FROM_MODULES.size;
}

/** True when the key is declared, whether or not its copy has arrived yet. */
export function hasKey(key: string): boolean {
  return DECLARED.has(key);
}

/** True once a key's copy is actually in the runtime table (test helper). */
export function hasCopy(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DICT, key);
}

/**
 * Load every lazy string module and register it.
 *
 * This is the switch's precondition: `store.toggleLang()` awaits it *before*
 * committing the new language, so the re-render that follows already has both
 * languages for every key and can never show one language and correct itself on
 * the next frame. The idle preload below calls the same function, so by the
 * time a user reaches the settings drawer the modules are normally there and
 * the switch resolves in a microtask.
 */
export async function loadAllStrings(): Promise<void> {
  const { STRING_LOADERS } = await import('./i18n-panels');
  // The library's table is its own module (P10.5): the panel tables are shared
  // between parallel UI tracks, so a new batch registers its copy separately
  // rather than editing `i18n-panels.ts`.
  const { loadLibraryStrings } = await import('./i18n.library');
  await Promise.all([...STRING_LOADERS.map((load) => load()), loadLibraryStrings()]);
}

/** True once every declared key has copy (used by the i18n tests). */
export function isFullyLoaded(): boolean {
  return DECLARED.size === Object.keys(DICT).length;
}

/**
 * Warm every lazy table while the browser is idle.
 *
 * The modules are tiny and the browser is otherwise waiting for a gesture at
 * this point, so this costs nothing on the critical path; it exists so the
 * *first* open of a panel does not have to wait on copy. A failure is swallowed
 * on purpose: the panel's own loader retries the same import, and a genuinely
 * missing chunk is already reported by that panel's Suspense boundary.
 */
export function preloadStrings(): void {
  const idle = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  };
  const warm = () => void loadAllStrings().catch(() => {});
  if (typeof idle.requestIdleCallback === 'function') idle.requestIdleCallback(warm, { timeout: 4000 });
  else window.setTimeout(warm, 800);
}

/**
 * The language button's own label, shown by the settings drawer.
 *
 * Two literals rather than a `DICT` pair on purpose: each label is written in
 * the language it switches *to*. They live in this module (and so in the entry
 * chunk) because the drawer's button needs a label the moment it mounts, whether
 * or not the lazy settings table has arrived yet.
 */
export const LANG_LABELS: Record<Lang, string> = { zh: '中文', en: 'EN' };
