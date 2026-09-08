/**
 * Bilingual UI strings (zh / en).
 *
 * A flat `key: [zh, en]` table keeps the two languages side by side. Components
 * call `t('key')`; the active language is mirrored from the persisted layout
 * state via `setLang()`, so changing it re-renders through the normal store
 * subscription. Missing keys fall back to the key itself, which makes gaps
 * obvious without throwing.
 */

export type Lang = 'zh' | 'en';

const DICT: Record<string, [string, string]> = {
  // --- app shell -----------------------------------------------------------
  'app.start': ['启动音频引擎', 'Start Audio Engine'],
  'app.starting': ['正在启动…', 'Starting…'],
  'app.startHint': ['浏览器需要一次点击才能播放声音', 'Browsers need one tap before audio can play'],
  'app.startFailed': ['启动失败', 'Startup failed'],
  'app.retry': ['重试', 'Retry'],
  'app.updateReady': ['新版本已就绪', 'New version ready'],
  'app.updateNow': ['立即更新', 'Update now'],
  'app.later': ['稍后', 'Later'],
  'app.suspended': ['⏸ 音频已暂停 · 点按此处恢复', '⏸ Audio suspended · tap to resume'],
  'app.sharedLoaded': ['已载入分享音色', 'Shared patch loaded'],
  'preset.initName': ['INIT · 初始正弦', 'INIT · Sine'],
  'app.noScript': ['GROOVE SYNTH GS-1 需要启用 JavaScript 才能运行。', 'GROOVE SYNTH GS-1 requires JavaScript.'],

  // --- top bar -------------------------------------------------------------
  'top.power': ['电源开关', 'Power'],
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
  'panel.bins': ['36 BINS · PEAK HOLD', '36 BINS · PEAK HOLD'],
  'monitor.demo': ['▶ DEMO 琶音', '▶ DEMO arpeggio'],
  'monitor.stop': ['■ STOP', '■ STOP'],
  'monitor.wav': ['⤓ WAV', '⤓ WAV'],
  'monitor.rendering': ['⏳ 渲染中', '⏳ Rendering'],
  'monitor.wavTitle': ['离线渲染当前音色为 WAV', 'Render the current patch to WAV offline'],
  'monitor.wavDone': ['已导出 WAV', 'WAV exported'],
  'monitor.wavFailed': ['导出失败：{msg}', 'Export failed: {msg}'],
  'monitor.polyTitle': ['负载过高时自动降低的复音上限', 'Polyphony cap reduced automatically under load'],
  'canvas.scopeAria': ['时域波形示波器', 'Waveform oscilloscope'],
  'canvas.spectrumAria': ['频谱分析', 'Spectrum analyser'],
  'canvas.vuAria': ['输出电平', 'Output level'],

  // --- modules -------------------------------------------------------------
  'module.osc1': ['OSC 1', 'OSC 1'],
  'module.osc1.sub': ['振荡器 A', 'Oscillator A'],
  'module.osc2': ['OSC 2', 'OSC 2'],
  'module.osc2.sub': ['振荡器 B', 'Oscillator B'],
  'module.filter': ['FILTER', 'FILTER'],
  'module.filter.sub': ['滤波器', 'Filter'],
  'module.env': ['AMP ENV', 'AMP ENV'],
  'module.env.sub': ['振幅包络', 'Amp envelope'],
  'module.lfo': ['LFO', 'LFO'],
  'module.lfo.sub': ['低频振荡', 'Low-frequency oscillator'],
  'module.matrix': ['MOD MATRIX', 'MOD MATRIX'],
  'module.matrix.sub': ['调制路由', 'Modulation routing'],
  'module.fx': ['FX', 'FX'],
  'module.fx.sub': ['效果处理', 'Effects'],
  'module.fx2': ['FX 2', 'FX 2'],
  'module.fx2.sub': ['调制效果', 'Modulation effects'],
  'module.drag': ['拖动排序', 'Drag to reorder'],
  'module.dragAria': ['拖动 {title} 排序', 'Drag {title} to reorder'],
  'module.collapse': ['收起', 'Collapse'],
  'module.expand': ['展开', 'Expand'],
  'module.ledAria': ['{title} 开关', '{title} on/off'],
  'module.wavePreview': ['WAVE PREVIEW', 'WAVE PREVIEW'],
  'module.addRoute': ['＋ 添加调制路由', '+ Add modulation route'],
  'module.voiceMode': ['声部模式', 'Voice mode'],
  'module.modePoly': ['复音', 'Poly'],
  'module.modeMono': ['单音 · 每次重新触发包络', 'Mono · retrigger the envelope'],
  'module.modeLegato': ['连奏 · 不重触发包络', 'Legato · no envelope retrigger'],
  'module.filterType': ['滤波器类型', 'Filter type'],
  'filter.lp': ['低通 · Moog 阶梯', 'Low-pass · Moog ladder'],
  'filter.hp': ['高通', 'High-pass'],
  'filter.bp': ['带通', 'Band-pass'],
  'filter.nt': ['陷波', 'Notch'],
  'module.lfoTarget': ['LFO 目标', 'LFO target'],
  'module.lfo2Target': ['LFO 2 目标', 'LFO 2 target'],
  'module.lfoSync': ['LFO 同步', 'LFO sync'],
  'module.lfo2On': ['LFO 2 开关', 'LFO 2 on/off'],
  'module.reverbOn': ['混响开关', 'Reverb on/off'],
  'module.delayOn': ['延迟开关', 'Delay on/off'],
  'module.matrixSrc': ['调制源', 'Source'],
  'module.matrixDst': ['调制目标', 'Destination'],
  'module.matrixAmt': ['调制量', 'Amount'],
  'module.matrixEnable': ['启用路由', 'Enable route'],
  'module.matrixDelete': ['删除路由', 'Delete route'],
  'module.kbdTrack': ['键盘跟踪', 'Keyboard tracking'],

  // --- preset drawer -------------------------------------------------------
  'drawer.title': ['PRESET LIBRARY · 预设库', 'PRESET LIBRARY'],
  'drawer.close': ['关闭', 'Close'],
  'drawer.search': ['搜索音色 / 风格 / 分类…', 'Search tone / style / category…'],
  'drawer.noResult': ['NO PRESET FOUND', 'NO PRESET FOUND'],
  'drawer.loaded': ['已载入预设 <b>{name}</b>', 'Loaded preset <b>{name}</b>'],
  'drawer.delete': ['删除预设', 'Delete preset'],
  'drawer.deleted': ['已删除用户预设', 'User preset deleted'],
  'drawer.import': ['导入', 'Import'],
  'drawer.export': ['导出', 'Export'],
  'drawer.share': ['分享', 'Share'],
  'drawer.contrast': ['高对比', 'Contrast'],
  'drawer.reset': ['重置布局', 'Reset layout'],
  'drawer.imported': ['已导入音色文件', 'Patch file imported'],
  'drawer.importFailed': ['文件格式无法识别', 'Unrecognised file format'],
  'drawer.exported': ['已导出当前音色 · <b>.gs1.json</b>', 'Exported the current patch · <b>.gs1.json</b>'],
  'drawer.shared': ['分享链接已复制到剪贴板', 'Share link copied to the clipboard'],
  'drawer.shareFailed': ['分享链接已写入地址栏', 'Share link written to the address bar'],
  'drawer.contrastOn': ['已切换高对比配色', 'High-contrast theme on'],
  'drawer.contrastOff': ['已切换默认配色', 'Default theme restored'],
  'drawer.resetDone': ['已重置面板布局与键盘显示', 'Layout and keyboard display reset'],
  'drawer.footer': ['共 <b>{n}</b> 个预设 · {m} 个本地收藏', '<b>{n}</b> presets · {m} local'],

  // --- keyboard ------------------------------------------------------------
  'kbd.region': ['演奏键盘', 'Performance keyboard'],
  'kbd.octDown': ['降低八度', 'Octave down'],
  'kbd.octUp': ['升高八度', 'Octave up'],
  'kbd.pitch': ['弯音轮', 'Pitch wheel'],
  'kbd.mod': ['调制轮', 'Mod wheel'],
  'kbd.tip1': ['◈ <b>点击/滑奏琴键</b> 触发包络与示波器', '◈ <b>Tap / glide the keys</b> to trigger the envelope and scope'],
  'kbd.tip2': ['◈ <b>拖动旋钮</b> 上下调节 · <b>双击</b> 复位', '◈ <b>Drag a knob</b> to adjust · <b>double-tap</b> to reset'],
  'kbd.tip3': ['◈ <b>Shift+拖动</b> 微调 · 滚轮同样可用', '◈ <b>Shift+drag</b> to fine-tune · the wheel works too'],
  'kbd.tip4': ['◈ <b>拖动模块标题栏 ⠿</b> 调整顺序', '◈ <b>Drag a module header ⠿</b> to reorder'],

  // --- waveform names ------------------------------------------------------
  'wave.sine': ['正弦', 'Sine'],
  'wave.triangle': ['三角', 'Triangle'],
  'wave.saw': ['锯齿', 'Saw'],
  'wave.square': ['方波', 'Square'],
  'wave.pulse': ['脉冲', 'Pulse'],
  'wave.noise': ['噪声', 'Noise'],

  // --- errors / diagnostics ------------------------------------------------
  'err.wasmFetch': ['WASM 下载失败 (HTTP {status})', 'WASM download failed (HTTP {status})'],
  'err.wasmValidate': ['WASM 模块校验失败（SIMD 与标量核心均不可用）', 'WASM validation failed (neither the SIMD nor the scalar core is usable)'],
  'err.wasmMissing': ['缺少 WASM 数据', 'Missing WASM data'],
  'err.wasmInstantiate': ['WASM 实例化失败：{msg}', 'WASM instantiation failed: {msg}'],
  'err.midiUnsupported': ['此浏览器不支持 Web MIDI', 'Web MIDI is not supported in this browser'],
  'err.midiDevice': ['未命名设备', 'Unnamed device'],
};

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

/** True when the key exists (used by the coverage test). */
export function hasKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DICT, key);
}

export const LANG_LABELS: Record<Lang, string> = { zh: '中文', en: 'EN' };
