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
  'monitor.polyTitle': ['负载过高时自动降低的复音上限', 'Polyphony cap reduced automatically under load'],
  'canvas.scopeAria': ['时域波形示波器', 'Waveform oscilloscope'],
  'canvas.spectrumAria': ['频谱分析', 'Spectrum analyser'],
  'canvas.meterHint': ['峰值 dB · 响度 dB · DSP 负载（占每个渲染量子的时间预算）', 'Peak dB · loudness dB · DSP load (share of the render-quantum budget)'],
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
  'filter.formant': ['元音共振峰：截止频率在 A-E-I-O-U 之间滑动，共振控制带宽', 'Vowel formants: the cutoff morphs A-E-I-O-U, resonance sets the bandwidth'],
  'filter.comb': ['梳状谐振器：截止频率决定梳齿音高，共振决定反馈量', 'Comb resonator: cutoff sets the comb pitch, resonance its feedback'],
  'filter.nt': ['陷波', 'Notch'],
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
  'module.matrixSrc': ['调制源', 'Source'],
  'module.matrixDst': ['调制目标', 'Destination'],
  'module.matrixAmt': ['调制量', 'Amount'],
  'module.matrixEnable': ['启用路由', 'Enable route'],
  'module.matrixDelete': ['删除路由', 'Delete route'],
  'module.kbdTrack': ['键盘跟踪', 'Keyboard tracking'],
  'env.valueHint': ['长按或拖动上下调节 · 点击输入数值', 'Hold/drag vertically to adjust · tap to type a value'],

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
  'drawer.guide': ['使用指南', 'Guide'],
  'drawer.changelog': ['更新记录', 'Changelog'],
  'drawer.contrast': ['高对比', 'Contrast'],
  'theme.label': ['主题', 'Theme'],
  'theme.dark': ['深色', 'Dark'],
  'theme.light': ['浅色', 'Light'],
  'theme.auto': ['自动', 'Auto'],
  'theme.autoHint': ['跟随系统', 'Follow system'],
  'theme.switched': ['主题：{name}', 'Theme: {name}'],
  'drawer.haptics': ['振动反馈', 'Haptics'],
  'drawer.hapticsOn': ['已开启振动反馈', 'Haptic feedback on'],
  'drawer.hapticsOff': ['已关闭振动反馈', 'Haptic feedback off'],
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

  // --- guide ---------------------------------------------------------------
  'guide.title': ['使用指南', 'Guide'],
  'changelog.title': ['更新记录', 'Changelog'],
  'changelog.sub': ['版本历史与更新内容 · 当前版本', 'Release history · running'],
  'changelog.current': ['当前版本', 'current'],
  'changelog.footer': ['更新记录随应用离线保存；部署新版本后这里会列出对应的改动。', 'The changelog ships with the app and works offline; each deployment lists its changes here.'],  'guide.sub': ['合成器基础 · 新手教学 · 使用帮助 · 从零捏音色', 'Synthesis · Getting started · Help · Sound design'],
  'guide.toc': ['目录', 'Contents'],
  'guide.footer': ['按 Esc 或点击空白处关闭 · 全部内容随应用离线可用', 'Press Esc or click outside to close · fully offline'],

  // --- responsive chrome ---------------------------------------------------
  'display.expand': ['展开示波器与频谱', 'Show scope & spectrum'],
  'display.collapse': ['收起示波器与频谱', 'Hide scope & spectrum'],
  'top.more': ['更多操作', 'More actions'],

  // --- player / midi -------------------------------------------------------
  'player.title': ['播放器', 'Player'],
  'player.play': ['播放', 'Play'],
  'player.pause': ['暂停', 'Pause'],
  'player.stop': ['停止', 'Stop'],
  'player.loop': ['循环', 'Loop'],
  'player.seek': ['播放进度', 'Seek'],
  'app.built': ['版本号（更新记录里可查看是否有新版）', 'current build (see Changelog for newer)'],
  'app.overload': [
    '设备负载偏高：已自动把复音数降到 {n}（监视器可查看 DSP 负载%）',
    'Device load is high: polyphony dropped to {n} automatically (the monitor shows the DSP load)',
  ],
  'tuning.import': ['导入 .scl', 'Import .scl'],
  'tuning.importHint': ['导入 Scala 调律文件（.scl），支持任意音数与非八度周期', 'Import a Scala tuning file (.scl): any number of notes, non-octave periods included'],
  'tuning.imported': ['已导入 {name}（{notes} 音）', 'Imported {name} ({notes} notes)'],
  'tuning.importFailed': ['导入失败：{msg}', 'Import failed: {msg}'],
  'tuning.scala.tooShort': ['文件太短', 'file too short'],
  'tuning.scala.badCount': ['音数无效', 'invalid note count'],
  'tuning.scala.tooFewNotes': ['音数不足', 'fewer intervals than declared'],
  'tuning.scala.badInterval': ['音程无法解析', 'unreadable interval'],
  'tuning.scala.badRatio': ['音程比值无效', 'invalid ratio'],
  'tuning.scala.badPeriod': ['周期无效', 'invalid period'],
  'scene.title': ['场景', 'Scenes'],
  'scene.pick': ['选择场景…', 'Recall a scene…'],
  'scene.save': ['保存当前', 'Save current'],
  'scene.delete': ['删除最后一个', 'Delete last'],
  'scene.defaultName': ['场景', 'Scene'],
  'scene.saved': ['已保存 {name}', 'Saved {name}'],
  'scene.applied': ['已切换到该场景', 'Scene recalled'],
  'scene.deleted': ['已删除场景', 'Scene deleted'],
  'velocity.title': ['力度曲线', 'Velocity curve'],
  'velocity.changed': ['力度曲线：{name}', 'Velocity curve: {name}'],
  'tuning.title': ['调律', 'Tuning'],
  'tuning.changed': ['调律已改为 {name}', 'Tuning set to {name}'],
  'midi.mpe': ['MPE 输入', 'MPE input'],
  'midi.mpeHint': ['每个音独立弯音（每通道一音，通道压力仍作用于整体）', 'Per-note pitch bend (one note per channel; channel pressure still applies globally)'],
  'cc.title': ['MIDI CC 映射', 'MIDI CC mapping'],
  'cc.hint': ['选一个控件 → 点「学习」→ 转动 MIDI 控制器上的旋钮即可绑定（可在下面查看/清除）。映射会记住。',
    'Pick a control, press Learn, then move the knob on your MIDI controller. Mappings are listed below and remembered.'],
  'cc.param': ['要映射的控件', 'Control to map'],
  'cc.learn': ['学习', 'Learn'],
  'cc.waiting': ['等待 CC…（点此取消）', 'Waiting for CC…'],
  'cc.clear': ['清除', 'Clear'],
  'cc.none': ['尚未映射任何 CC。', 'No controllers mapped yet.'],
  'audio.output': ['输出设备', 'Output device'],
  'audio.outputHint': ['把声音送到指定设备（需要浏览器支持，且设备标签可能需要先授权麦克风才可见）', 'Route the output to a chosen device (browser support required; labels may need microphone permission first)'],
  'audio.outputSet': ['已切换输出设备', 'Output device switched'],
  'audio.outputUnsupported': ['此浏览器不支持选择输出设备', 'This browser cannot select an output device'],
  'audio.refresh': ['刷新', 'Refresh'],
  'audio.title': ['音频设置', 'Audio settings'],
  'audio.sub': ['引擎状态 · 采样率 · 延迟 · 复音数 · 实时负载', 'Engine · sample rate · latency · polyphony · live load'],
  'audio.engine': ['引擎状态', 'Engine'],
  'audio.notStarted': ['未启动（点“启动音频引擎”）', 'not started'],
  'audio.sampleRate': ['采样率', 'Sample rate'],
  'audio.latency': ['输出延迟', 'Output latency'],
  'audio.core': ['DSP 内核', 'DSP core'],
  'audio.peak': ['输出峰值', 'Output peak'],
  'audio.load': ['DSP 负载', 'DSP load'],
  'audio.loadHint': ['占每个渲染量子的时间预算；长期 >90% 说明设备吃力，建议降低复音或关闭效果', 'Share of the render-quantum budget; sitting above 90% means the device is struggling'],
  'audio.polyphony': ['复音数', 'Polyphony'],
  'audio.polyHint': ['负载过高时引擎会自动下调；这里可以手动设一个上限。', 'The engine lowers this automatically under load; set a ceiling here if you prefer.'],
  'audio.resume': ['恢复音频', 'Resume audio'],
  'audio.footer': ['这些数字来自浏览器与渲染线程本身，用于判断“音质问题”到底出在哪一环。', 'These numbers come from the browser and the render thread, so a sound problem can be traced to the right stage.'],
  'drawer.checkUpdate': ['检查更新', 'Check for updates'],
  'drawer.updateCurrent': ['已是最新版本', 'You are on the latest version'],
  'drawer.updateFound': ['发现新版本，正在更新…', 'New version found, updating…'],
  'drawer.updateUnsupported': ['离线模式不可用', 'Update check unavailable'],
  'player.metronome': ['节拍器', 'Metronome'],
  'player.setA': ['把 A 点设在当前位置（配合 B 循环这一段）', 'Set loop point A at the playhead'],
  'player.setB': ['把 B 点设在当前位置', 'Set loop point B at the playhead'],
  'player.clearAB': ['清除 A/B 循环段', 'Clear the A/B loop'],
  'player.countIn': ['预备拍', 'Count-in'],
  'player.rate': ['速度', 'Rate'],
  'player.transpose': ['移调', 'Transpose'],
  'player.track': ['曲目', 'Track'],
  'player.record': ['录制', 'Record'],
  'player.stopRec': ['停止录制', 'Stop recording'],
  'player.recordingName': ['我的录制', 'My recording'],
  'player.recordedBy': ['现场演奏', 'Live take'],
  'player.import': ['导入 MIDI', 'Import MIDI'],
  'player.importedBy': ['导入文件', 'Imported file'],
  'player.imported': ['已导入 <b>{name}</b> · {n} 个音符', 'Imported <b>{name}</b> · {n} notes'],
  'player.importFailed': ['MIDI 导入失败：{msg}', 'MIDI import failed: {msg}'],
  'player.emptyFile': ['文件里没有音符', 'the file contains no notes'],
  'player.exportMidi': ['导出 MIDI', 'Export MIDI'],
  'player.midiSaved': ['已导出 <b>{name}.mid</b>', 'Exported <b>{name}.mid</b>'],
  'player.exportWav': ['导出 WAV（无损）', 'Export WAV'],
  'player.wavSaved': ['已保存 {name}.wav（无损，体积较大）', 'Saved {name}.wav (lossless, large)'],
  'player.wavHint': ['无损导出：文件更大，但没有任何编码噪声——如果 MP3 听起来有底噪，用它对比', 'Lossless export: larger, no encoder noise at all — use it to check whether an MP3 artefact is the encoder'],
  'player.exportMp3': ['导出 MP3', 'Export MP3'],
  'player.mp3Saved': ['已导出 <b>{name}.mp3</b>', 'Exported <b>{name}.mp3</b>'],
  'player.mp3Failed': ['MP3 导出失败：{msg}', 'MP3 export failed: {msg}'],
  'player.rendering': ['渲染中…', 'Rendering…'],
  'player.notes': ['音符', 'notes'],
  'player.search': ['搜索曲目…', 'Search tracks…'],
  'player.groupClip': ['录制', 'Recordings'],
  'player.groupImported': ['导入', 'Imported'],
  'player.groupBuiltin': ['内置曲目', 'Built-in'],
  'player.quantise': ['量化', 'Quantise'],
  'player.quantiseHint': ['录制结束时把音符对齐到网格（不影响已有曲目）', 'Snap a recording to the grid when it is saved (does not touch existing tracks)'],
  'player.clipSavedQuantised': ['已保存录制（{n} 个音，已按 {grid} 量化）', 'Recording saved ({n} notes, quantised to {grid})'],
  'player.clipSaved': [
    '录制完成 · {n} 个音符 · 点「编辑」可在钢琴卷帘里修改',
    'Take finished · {n} notes — tap Edit to tweak it in the piano roll',
  ],
  'player.copyright': [
    '古典与民乐为公版作品，已完整编配；现代影视 / 游戏主题仅作简短示范，版权归原作者所有。',
    'Classical and folk pieces are public domain and fully arranged; modern film/game themes are short demonstrations and remain the property of their owners.',
  ],

  // --- piano roll ----------------------------------------------------------
  'roll.title': ['钢琴卷帘', 'Piano roll'],
  'roll.open': ['钢琴卷帘编辑', 'Piano roll editor'],
  'roll.edit': ['编辑', 'Edit'],
  'roll.bpm': ['速度 BPM', 'Tempo BPM'],
  'roll.snap': ['网格', 'Grid'],
  'roll.length': ['长度', 'Length'],
  'roll.bars': ['小节', 'bars'],
  'roll.beats': ['拍', 'beats'],
  'roll.quantize': ['量化到网格', 'Quantize to grid'],
  'roll.transpose': ['移调', 'Transpose'],
  'roll.octaveDown': ['降低八度', 'Down an octave'],
  'roll.octaveUp': ['升高八度', 'Up an octave'],
  'roll.velocity': ['力度', 'Velocity'],
  'roll.pitch': ['音高', 'Pitch'],
  'roll.start': ['起点', 'Start'],
  'roll.duration': ['时长', 'Length'],
  'roll.holdHint': ['按住琴键的时长决定音符长度', 'Hold a key longer to write a longer note'],
  'roll.input': ['输入', 'Input'],
  'roll.inputOn': ['输入已开启 · 点网格或弹琴键添加音符', 'Input armed · tap the grid or play keys to add notes'],
  'roll.inputOff': ['输入已关闭 · 只试听不写入', 'Input off · keys only audition'],
  'roll.midiIn': ['MIDI 输入', 'MIDI in'],
  'roll.midiConnect': ['连接 MIDI', 'Connect MIDI'],
  'roll.midiDevices': ['MIDI 输入 · {n} 个设备', 'MIDI in · {n} device(s)'],
  'roll.midiUnsupported': ['此浏览器不支持 Web MIDI', 'Web MIDI is not available in this browser'],
  'roll.delete': ['删除所选音符', 'Delete selected note'],
  'roll.undo': ['撤销', 'Undo'],
  'roll.redo': ['重做', 'Redo'],
  'roll.clear': ['清空音符', 'Clear notes'],
  'roll.save': ['保存到播放器', 'Save to player'],
  'roll.saved': ['已保存 · <b>{name}</b> · {n} 个音符', 'Saved · <b>{name}</b> · {n} notes'],
  'roll.copyOf': ['{name} · 编辑', '{name} · edit'],
  'roll.builtinHint': ['内置曲目保存时会另存为新片段', 'Built-in tracks are saved as a new clip'],
  'roll.empty': ['空片段 · 点网格或弹琴键添加音符', 'Empty clip · tap the grid or play keys to add notes'],
  'roll.keyboard': ['输入键盘', 'Input keyboard'],
  'roll.seek': ['定位播放头', 'Seek playhead'],

  // --- signal flow ---------------------------------------------------------
  'view.label': ['视图', 'View'],
  'view.modules': ['模块', 'Modules'],
  'view.flow': ['信号流', 'Flow'],
  'flow.enable': ['启用', 'Enable'],
  'flow.disable': ['旁通', 'Bypass'],
  'flow.expand': ['展开参数', 'Open parameters'],
  'flow.remove': ['从画布移除', 'Remove from canvas'],
  'flow.always': ['始终启用', 'always on'],
  'flow.removed': ['已移除：', 'Removed:'],
  'flow.reset': ['重置画布', 'Reset canvas'],
  'flow.master': ['主音量', 'Master'],
  'flow.zoom': ['画布缩放', 'Canvas zoom'],
  'flow.zoomIn': ['放大', 'Zoom in'],
  'flow.zoomOut': ['缩小', 'Zoom out'],
  'flow.fit': ['适应全部节点', 'Fit all nodes'],

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

/** True when the key exists (used by the coverage test). */
export function hasKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DICT, key);
}

export const LANG_LABELS: Record<Lang, string> = { zh: '中文', en: 'EN' };
