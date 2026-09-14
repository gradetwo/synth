/**
 * The lazy half of the i18n tables (P11.2).
 *
 * Everything the first frame does **not** need lives here: the effect routing
 * graph (68 keys), the player panel with its takes and clip arrangement (104),
 * the piano roll (51), the imported wavetable and sampler rows (27), the audio
 * settings drawer (6), the guide and changelog dialogs (6) and the signal-flow
 * canvas (12). The 319 keys the first frame can render stay inline in
 * `src/i18n.ts`.
 *
 * ## Why one file, one chunk
 *
 * These tables are all loaded together at boot (`src/i18n.ts` `loadAllStrings`,
 * started by `src/main.tsx` before React mounts) and by the idle preload in
 * `App`. Keeping them in one module means one registration helper, one chunk and
 * one gzip context for copy that shares a lot of common Chinese and English
 * wording; the per-panel split was measured too and cost ~1.7 KB more of `dist`
 * for six extra chunk headers and six weaker compression contexts. The cost of
 * one chunk is that a panel's copy arrives with *every* panel's copy — but it
 * has normally already arrived while the browser was waiting for a gesture.
 *
 * ## The contract with `t()`
 *
 * `t()` is synchronous by design, so a key whose table has not arrived falls
 * back to the key name. That must never be visible:
 *   * the core table is always in memory, so the boot gate, the top bar, the
 *     module grid, the keyboard and the settings drawer never depend on this
 *     file;
 *   * a lazy panel (player, roll, graph, guide, changelog, audio settings) is
 *     imported *through* its loader in `App.tsx`, so the copy is registered
 *     before the component module resolves;
 *   * the one eager row with lazy copy — the imported wavetable/sampler pickers
 *     inside the module grid — is gated by `useStringsReady()`, so it renders
 *     nothing until these tables register rather than showing a key name.
 *
 * Key names are derived from `Object.keys(table)` inside `registerStrings()`,
 * so `hasKey()` becomes complete as each table registers and no parallel list of
 * names has to be shipped (a second copy of every key string cost ~7 KB of
 * `dist` for nothing). `i18n.test.ts` loads every table and cross-checks the
 * declared keys against the copy in both directions.
 */
import { registerStrings, type StringTable } from './i18n';

export const FX_STRINGS: StringTable = {
  'fxg.canvas': ['画布', 'Canvas'],
  'fxg.list': ['列表', 'List'],
  'fxg.rebuild': ['从信号链重建', 'Rebuild from chain'],
  'fxg.resetLayout': ['重置布局', 'Reset layout'],
  // Graph templates (P7.3): the routing is saved in the workspace, so the list
  // travels with the browser rather than with the patch or a share code.
  'fxg.tpl': ['图模板', 'Graph template'],
  'fxg.tplPick': ['套用模板…', 'Apply template…'],
  'fxg.tplBuiltin': ['内置', 'Built-in'],
  'fxg.tplSaved': ['已保存', 'Saved'],
  'fxg.tplSave': ['存为模板', 'Save as template'],
  'fxg.tplSaveHint': [
    '把当前的节点、连线与增益存进工作区（不进音色、不进分享码）',
    'Save the current nodes, wires and gains into the workspace (not the patch, not a share code)',
  ],
  'fxg.tplDefaultName': ['模板', 'Template'],
  'fxg.tplApplied': ['已套用模板 · {name}', 'Template applied · {name}'],
  'fxg.tplSavedToast': ['已保存模板 · {name}', 'Template saved · {name}'],
  'fxg.tplDeleted': ['已删除模板', 'Template deleted'],
  'fxg.tplDelete': ['删除模板', 'Delete template'],
  'fxg.tpl.serial': ['经典串联', 'Classic serial'],
  'fxg.tpl.dualDelay': ['双延迟', 'Dual delay'],
  'fxg.tpl.parallelReverb': ['并行混响', 'Parallel reverb'],
  'fxg.tpl.driveSplit': ['失真分路', 'Drive split'],
  'fxg.tpl.empty': ['空图（仅干声）', 'Empty (dry only)'],
  'fxg.dragHint': ['拖动卡片标题可移动位置', 'Drag a card by its title to move it'],
  'fxg.rebuilt': ['已按当前信号链重建路由', 'Routing rebuilt from the current chain'],
  'fxg.close': ['关闭路由图', 'Close routing'],
  'fxg.dry': ['干声', 'DRY'],
  'fxg.dryHint': ['未经过效果的信号', 'Before the effects'],
  'fxg.outHint': ['送到主输出', 'To the master bus'],
  'fxg.node': ['节点', 'Node'],
  'fxg.input': ['输入', 'input'],
  'fxg.output': ['输出', 'output'],
  'fxg.source': ['来源', 'source'],
  'fxg.gain': ['增益', 'gain'],
  'fxg.mix': ['混合', 'MIX'],
  'fxg.effect': ['效果', 'effect'],
  'fxg.on': ['开关', 'on/off'],
  'fxg.parallel': ['并联送出', 'Parallel send'],
  'fxg.toOut': ['送到输出', 'To output'],
  'fxg.outGain': ['输出增益', 'output gain'],
  'fxg.none': ['无', 'none'],
  'fxg.disconnect': ['断开', 'Disconnect'],
  'fxg.poolFull': ['池已满', 'pool full'],
  'fxg.delayPoolFull': [
    '延迟池已满：{capacity} 条延迟线 × {seconds} s 都已分配给节点',
    'the delay pool is full: all {capacity} lines × {seconds} s are assigned to nodes',
  ],
  'fxg.convPoolFull': [
    '卷积池已满：{capacity} 个卷积节点都已分配（IR 共享，尾部各自独立）',
    'the convolution pool is full: all {capacity} convolution nodes are in use (the response is shared, the tails are not)',
  ],
  'fxg.delayPool': [
    '延迟池 {used}/{capacity} · 剩余可分配 {left} s',
    'delay pool {used}/{capacity} · {left} s still available',
  ],
  'fxg.convPool': ['卷积池 {used}/{capacity}', 'convolution pool {used}/{capacity}'],
  'fxg.wireHint': ['点连线可以改这条连线的增益或断开它', 'Click a wire to set its gain or cut it'],
  // In-graph modulation (P7.2). The depth lives on the edge, so the source
  // cards carry no amount of their own.
  'fxg.mod': ['图内调制', 'In-graph modulation'],
  'fxg.modHint': [
    'LFO / ENV 是图中的调制源：从它们的输出拖到节点底部的 I1 / I2 / O 端口即可拉一条调制线，深度在线上。它和 8 槽调制矩阵并存：矩阵按声部控制率跑，图内调制按块率加到节点增益上，写入前先过平滑器。',
    'LFO and ENV are modulation sources in the graph: drag from their output to a node’s I1 / I2 / O port to pull a modulation wire, whose depth sits on the wire. It lives alongside the 8-slot matrix: the matrix runs per voice at control rate while an in-graph edge adds to a node gain at block rate, through the smoother.',
  ],
  'fxg.modSource': ['调制源', 'modulation source'],
  'fxg.modTarget': ['调制目标', 'modulation target'],
  'fxg.modDepth': ['调制深度', 'modulation depth'],
  'fxg.modPortIn1': ['输入 1 增益', 'input 1 gain'],
  'fxg.modPortIn2': ['输入 2 增益', 'input 2 gain'],
  'fxg.modPortOut': ['输出增益', 'output gain'],
  'fxg.modTargetLabel': ['节点 {node} {port}', 'Node {node} {port}'],
  'fxg.modFull': ['调制边已满（{slots} 条）', 'all {slots} modulation edges are in use'],
  'fxg.modDelete': ['删除调制边', 'Delete modulation edge'],
  // Per-node effect parameters (P9.3). A node can override the parameters its
  // effect kind shares with every other node of that kind; the toggle is what
  // decides whether the slot values in the patch are read at all.
  'fxg.ovr': ['参数覆盖', 'Override'],
  'fxg.ovrHint': [
    '每个节点可以覆盖自己那份效果参数：延迟时间/反馈/混合/阻尼、混响大小/混合/阻尼/预延迟、EQ 三段、失真量……未覆盖时跟随该效果的默认值。覆盖随分享码与图模板一起保存。',
    'A node can override its own copy of the effect parameters: delay time/feedback/mix/damping, reverb size/mix/damping/pre-delay, the three EQ bands, drive amount, and so on. Left alone, a slot follows that effect’s own value. Overrides travel in share codes and graph templates.',
  ],
  'fxg.ovrFollow': ['跟随种类默认', 'follows the kind’s default'],
  'fxg.ovrFollowShort': ['默认', 'default'],
  'fxg.ovrClear': ['全部跟随默认', 'Follow defaults'],
  'fxg.ovrMod': ['覆盖调制', 'Override modulation'],
  'fxg.ovrModHint': [
    '用 LFO / ENV 扫一个覆盖槽位，深度是该槽位自身量程的比例；只影响被选中的那一个槽位。目标槽位未开启覆盖时，从该效果的默认值起扫。',
    'Sweep one override slot with LFO 1, LFO 2 or the envelope. The depth is a fraction of that slot’s own range, and only the selected slot is affected. A slot with no override of its own starts from the effect’s default value.',
  ],
  'fxg.ovrModTarget': ['调制槽位', 'modulated slot'],
  'fxg.hintOff': [
    '当前用的是信号链。改动这里会自动切到路由图，并按当前信号链为起点，所以声音不会跳变。',
    'The chain is in charge right now. Editing here switches to the graph, seeded from the current chain, so the sound does not jump.',
  ],
};

export const ROLL_STRINGS: StringTable = {
  'roll.edit': ['编辑', 'Edit'],
  'roll.bpm': ['速度 BPM', 'Tempo BPM'],
  'roll.snap': ['网格', 'Grid'],
  'roll.length': ['长度', 'Length'],
  'roll.beats': ['拍', 'beats'],
  'roll.quantize': ['量化到网格', 'Quantize to grid'],
  'roll.octaveDown': ['降低八度', 'Down an octave'],
  'roll.octaveUp': ['升高八度', 'Up an octave'],
  'roll.velocity': ['力度', 'Velocity'],
  'roll.start': ['起点', 'Start'],
  'roll.duration': ['时长', 'Length'],
  'roll.holdHint': ['按住琴键的时长决定音符长度', 'Hold a key longer to write a longer note'],
  'roll.input': ['输入', 'Input'],
  'roll.inputOn': ['输入已开启 · 点网格或弹琴键添加音符', 'Input armed · tap the grid or play keys to add notes'],
  'roll.inputOff': ['输入已关闭 · 只试听不写入', 'Input off · keys only audition'],
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
  'roll.layer': ['层', 'Layer'],
  'roll.layerHint': [
    '多轨文件一次编辑一层；时间线条上的改动会立刻出现在这里',
    'A multi-track file is edited one layer at a time; edits on the layer strip show up here at once',
  ],
  'roll.builtinHint': ['内置曲目保存时会另存为新片段', 'Built-in tracks are saved as a new clip'],
  'roll.empty': ['空片段 · 点网格或弹琴键添加音符', 'Empty clip · tap the grid or play keys to add notes'],
  'roll.keyboard': ['输入键盘', 'Input keyboard'],
  'roll.seek': ['定位播放头', 'Seek playhead'],
  'roll.selectedN': ['已选 {n} 个音符', '{n} note(s) selected'],
  'roll.multi': ['多选', 'Multi'],
  'roll.multiOn': [
    '多选模式已开启 · 点音符累加选择，点空白清空',
    'Multi-select on · tap notes to add to the selection, empty space to clear',
  ],
  'roll.multiOff': [
    '多选模式 · 点一下即可累加选择（手机上代替 Ctrl 键）',
    'Multi-select mode · tap to accumulate a selection (the phone stand-in for Ctrl)',
  ],
  'roll.nudgeLeft': ['把选中的音符向左移一格', 'Move the selection one grid step earlier'],
  'roll.nudgeRight': ['把选中的音符向右移一格', 'Move the selection one grid step later'],
  'roll.nudgeUp': ['把选中的音符升高一个半音', 'Move the selection up one semitone'],
  'roll.nudgeDown': ['把选中的音符降低一个半音', 'Move the selection down one semitone'],
  'roll.copy': ['复制', 'Copy'],
  'roll.paste': ['粘贴', 'Paste'],
  'roll.deselect': ['取消选择', 'Deselect'],
  'roll.copyHint': ['复制所选音符（Ctrl/Cmd+C）', 'Copy the selected notes (Ctrl/Cmd+C)'],
  'roll.pasteHint': [
    '粘贴到播放头位置（Ctrl/Cmd+V），副本成为新的选择',
    'Paste at the playhead (Ctrl/Cmd+V); the copies become the selection',
  ],
  'roll.quantizeSelection': ['只量化所选音符（一个撤销步）', 'Quantise only the selected notes (one undo step)'],
  'roll.pasteHidden': [
    '副本落在了原音符位置：先移动播放头，或把原音符拖开',
    'The copies landed on the notes they came from — move the playhead, or drag the originals aside',
  ],
  'roll.crossLayerBlocked': [
    '跨层移动暂不支持：一层是一套音符/take/片段编排，换层请先把音符复制到该层',
    'Moving notes across layers is not supported: each layer has its own notes, takes and clip arrangement — copy them into the other layer instead',
  ],

  // --- signal flow ---------------------------------------------------------
};

export const PLAYER_STRINGS: StringTable = {
  'player.play': ['播放', 'Play'],
  'player.pause': ['暂停', 'Pause'],
  'player.stop': ['停止', 'Stop'],
  'player.loop': ['循环', 'Loop'],
  'player.seek': ['播放进度', 'Seek'],
  'player.metronome': ['节拍器', 'Metronome'],
  'player.setA': ['把 A 点设在当前位置（配合 B 循环这一段）', 'Set loop point A at the playhead'],
  'player.setB': ['把 B 点设在当前位置', 'Set loop point B at the playhead'],
  'player.clearAB': ['清除 A/B 循环段', 'Clear the A/B loop'],
  'player.countIn': ['预备拍', 'Count-in'],
  'player.track': ['曲目', 'Track'],
  'player.record': ['录制', 'Record'],
  'player.stopRec': ['停止录制', 'Stop recording'],
  'player.importedBy': ['导入文件', 'Imported file'],
  'player.imported': ['已导入 <b>{name}</b> · {n} 个音符', 'Imported <b>{name}</b> · {n} notes'],
  'player.importFailed': ['MIDI 导入失败：{msg}', 'MIDI import failed: {msg}'],
  'player.emptyFile': ['文件里没有音符', 'the file contains no notes'],
  'player.exportMidi': ['导出 MIDI', 'Export MIDI'],
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
  'player.clipSaved': [
    '录制完成 · {n} 个音符 · 点「编辑」可在钢琴卷帘里修改',
    'Take finished · {n} notes — tap Edit to tweak it in the piano roll',
  ],

  // --- recorded takes (P5.4, P10.3) ----------------------------------------
  'take.title': ['录音分层', 'Takes'],
  'take.defaultName': ['第 {n} 遍', 'Take {n}'],
  'take.rename': ['重命名', 'Rename'],
  'take.renameHint': ['重命名这条录音（回车提交，Esc 取消）', 'Rename this take (Enter to save, Esc to cancel)'],
  'take.renameCancel': ['取消重命名', 'Cancel rename'],
  'take.ab': ['A/B 试听', 'A/B'],
  'take.abHint': [
    '在同一点来回试听两条录音（键盘 A / B）；停止或按 Esc 回到 A',
    'Compare two takes from the same point (keys A / B); stop or press Esc to return to A',
  ],
  'take.abOn': ['A {a} · B {b}', 'A {a} · B {b}'],
  'take.abBack': ['试听结束 · 已回到 <b>{name}</b>', 'Audition over — back on <b>{name}</b>'],
  'take.mergeUnion': ['并集合并', 'Merge (union)'],
  'take.mergeUnionHint': [
    '合并后播放每一条 take 的全部音符（现有的合并方式）',
    'Merged take plays every note of every take (the existing merge)',
  ],
  'take.mergeOverwrite': ['覆盖合并', 'Merge (overwrite)'],
  'take.mergeOverwriteHint': [
    '新 take 覆盖同一时间上旧 take 的音符，只保留旧 take 没被盖住的部分',
    'A newer take replaces the older notes it plays over; only the uncovered older material stays',
  ],
  'take.foldedHint': [
    '该层已折叠为片段：take 仅作素材，切换/合并都不会改变听感',
    'This layer is folded into clips — takes are material only, so switching or merging will not change what plays',
  ],

  // --- piano roll ----------------------------------------------------------
  'player.tempoMapHint': [
    '速度与拍号：每一段从上一段结束处开始；最后的「小节」是这段的长度（空 = 到曲末）。读数为「小节.拍」',
    'Tempo and signature: each section starts where the last one ends; the number is how many bars it lasts (blank = to the end). The readout is bar.beat',
  ],
  'player.tempoBpm': ['速度（BPM）', 'Tempo (BPM)'],
  'player.tempoBar': ['拍号', 'Time signature'],
  'player.tempoAdd': ['加一段速度/拍号', 'Add a tempo section'],
  'player.tempoRemove': ['删掉最后一段', 'Remove the last section'],
  'clip.lane': ['片段编排', 'Clip lane'],
  'clip.fold': ['折叠成片段', 'Fold into a clip'],
  'clip.foldHint': [
    '把这一层折叠成一个片段：之后可以拖动、复制、循环铺排；片段内部仍可点「编辑」进卷帘修改',
    'Fold this layer into a clip: drag it, copy it, loop it; its notes are still edited in the piano roll',
  ],
  'clip.moveEarlier': ['向前移一个窗口', 'Move one window earlier'],
  'clip.moveLater': ['向后移一个窗口', 'Move one window later'],
  'clip.copy': ['复制片段', 'Duplicate the clip'],
  'clip.windowShorter': ['缩短循环窗口（超出的音符不再播放，加长可复原）', 'Shorten the loop window (notes past it stop playing; widening brings them back)'],
  'clip.windowLonger': ['加长循环窗口', 'Lengthen the loop window'],
  'clip.repeatLess': ['少铺一次', 'One repeat fewer'],
  'clip.repeatMore': ['多铺一次', 'One repeat more'],
  'clip.delete': ['删除片段', 'Delete the clip'],
  'clip.copyLayer': ['复制到另一层…', 'Copy to another layer…'],
  'clip.copyLayerHint': [
    '原样复制到选中的层：起点、窗口、重复与音高都不变（层决定音色，不改音区）',
    'Copies to the chosen layer as it is: same start, window, repeats and pitches (a layer sets timbre, not register)',
  ],
  'clip.copyLayerShort': ['复制过去', 'Copy over'],
  'clip.copyLayerDone': ['已复制「{name}」到第 {n} 层', 'Copied “{name}” to layer {n}'],
  'clip.tpl': ['片段模板', 'Clip template'],
  'clip.tplPick': ['套用片段模板…', 'Apply clip template…'],
  'clip.tplSave': ['存为模板', 'Save as template'],
  'clip.tplSaveHint': [
    '存进工作区（不进音色、不进分享码）；套用生成新片段，与原件互不影响',
    'Saved in the workspace (not the patch, not a share code); applying makes a new, independent clip',
  ],
  'clip.tplDelete': ['删除片段模板', 'Delete clip template'],
  'clip.tplSavedToast': ['已保存模板 · {name}', 'Template saved · {name}'],
  'clip.tplApplied': ['已套用模板 · {name}', 'Template applied · {name}'],
  'clip.tplDeleted': ['已删除模板', 'Template deleted'],
  'clip.label': ['片段', 'Clip'],
  'clip.pickHint': [
    '这一层有片段编排：卷帘编辑的是所选片段的内容，循环由时间线决定',
    'This layer is arranged with clips: the roll edits the selected clip, and the timeline decides the loops',
  ],
  'layer.mute': ['静音', 'Mute'],
  'layer.volume': ['音量', 'Volume'],
  'layer.pan': ['声像', 'Pan'],
  'layer.map': ['时间线', 'Timeline'],
  'layer.mapHint': [
    '点一下定位播放位置；拖动音符可左右移动、拖右缘改长度、双击删除；拖动空白处整体前后移动这一层',
    'Tap to scrub; drag a note to move it, drag its right edge to resize, double-click to delete; drag the background to move the whole layer',
  ],
  'layer.modeArrange': ['编排', 'Arrange'],
  'layer.modeNote': ['音符', 'Notes'],
  'layer.modeHintArrange': [
    '编排模式：拖空白处整体移动这一层，点一下定位播放位置；切到「音符」可直接改音符',
    'Arrange mode: drag the background to move this layer, tap it to seek; switch to “Notes” to edit notes',
  ],
  'layer.modeHintNote': [
    '音符模式：拖动音符改位置，拖右缘改长度，双击删除，选中后用下面的按钮微调',
    'Notes mode: drag a note to move it, drag its right edge to resize, double-click to delete, then nudge it with the buttons below',
  ],
  'layer.selected': ['已选：{note} · {start} 秒起 · {length} 秒长', 'Selected: {note} · from {start}s · {length}s long'],
  'layer.editHint': ['选中一个音符后可在这里微调（手机上没有拖拽也能编辑）', 'Select a note to nudge it here — no dragging needed on a phone'],
  'layer.earlier': ['提前一格', 'Earlier one step'],
  'layer.later': ['推后一格', 'Later one step'],
  'layer.shorter': ['缩短一格', 'Shorter one step'],
  'layer.longer': ['加长一格', 'Longer one step'],
  'layer.delete': ['删除这个音符', 'Delete this note'],
  'layer.copied': ['内置曲目不能改，已存成副本 <b>{name}</b> 继续编辑', 'Built-in songs cannot be edited: saved <b>{name}</b> as a copy to edit'],
  'layer.solo': ['独奏', 'Solo'],
};

export const SOURCES_STRINGS: StringTable = {
  'wave.sample': ['采样', 'Sample'],
  'smp.import': ['导入采样', 'Import sample'],
  'smp.none': ['未导入', 'none'],
  'smp.hint': [
    '导入一个音频文件（WAV/AIFF/FLAC/MP3）作为采样音源；按 ROOT 指定的音高变速播放，超过 4 秒会截断',
    'Import an audio file (WAV/AIFF/FLAC/MP3) as a sampler source; it plays at speed by pitch from ROOT, and files over 4 s are truncated',
  ],
  'smp.clearHint': ['移除导入的采样', 'Remove the imported sample'],
  'smp.loaded': ['已导入采样 {name}', 'Imported sample {name}'],
  'smp.cleared': ['已移除采样', 'Sample removed'],
  'smp.modeOneShot': ['一次性：放完即停（鼓、音效）', 'One-shot: play once and stop (drums, effects)'],
  'smp.modeLoop': ['循环：到循环终点跳回起点（持续音）', 'Loop: jump back to the loop start (sustained tones)'],
  'smp.modePingPong': ['乒乓循环：到端点反向（铺底、磁带感）', 'Ping-pong: reverse at each bound (pads, tape feel)'],
  'smp.err.short': ['采样太短，无法播放', 'That sample is too short to play'],
  'smp.err.silent': ['采样里没有声音', 'That sample is silent'],
  'smp.err.notFinite': ['采样含有无效数据', 'That sample contains invalid data'],
  'smp.err.decode': ['无法解码这个文件（格式不支持或文件损坏）', 'That file could not be decoded (unsupported or damaged)'],
  'smp.err.noRoom': ['内存不足，无法载入这段采样', 'Not enough room to load that sample'],
  'wt.import': ['导入波形', 'Import wave'],
  'wt.use': ['使用', 'Use'],
  'wt.none': ['未导入', 'none'],
  'wt.hint': [
    '导入一个单周期波形（WAV/AIFF/FLAC/MP3）。超过一周期会自动找出周期并取平均',
    'Import one cycle (WAV/AIFF/FLAC/MP3). A longer file has its period found and averaged',
  ],
  'wt.clearHint': ['移除导入的波形', 'Remove the imported waveform'],
  'wt.loaded': ['已导入波形 {name}', 'Imported {name}'],
  'wt.cleared': ['已移除导入波形', 'Imported waveform removed'],
  'wt.err.short': ['波形太短，无法作为波表', 'That waveform is too short to be a table'],
  'wt.err.silent': ['文件里没有声音', 'That file is silent'],
  'wt.err.notFinite': ['文件含有无效采样', 'That file contains invalid samples'],
  'wt.err.decode': ['无法解码这个文件（格式不支持或文件损坏）', 'That file could not be decoded (unsupported or damaged)'],
  'wt.err.noRoom': ['内存不足，无法载入这个波形', 'Not enough room to load that wavetable'],
};

export const AUDIO_STRINGS: StringTable = {
  'midi.outTitle': ['MIDI 输出', 'MIDI output'],
  'midi.outHint': ['把演奏的音符发送到外部设备（硬件合成器、鼓机、DAW）；需要先在顶栏授权 MIDI', 'Send played notes to an external device (hardware synth, drum machine, DAW); grant MIDI access in the top bar first'],
  'midi.outPort': ['输出端口', 'Output port'],
  'midi.outNone': ['未检测到 MIDI 输出设备。', 'No MIDI output device found.'],
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
  'audio.streamed': ['流式编译', 'streamed'],
  'audio.outputSet': ['已切换输出设备', 'Output device switched'],
};

export const DOCS_STRINGS: StringTable = {
  'guide.title': ['使用指南', 'Guide'],
  'changelog.title': ['更新记录', 'Changelog'],
  'changelog.current': ['当前版本', 'current'],
  'changelog.footer': ['更新记录随应用离线保存；部署新版本后这里会列出对应的改动。', 'The changelog ships with the app and works offline; each deployment lists its changes here.'],
  'guide.toc': ['目录', 'Contents'],
  'guide.footer': ['按 Esc 或点击空白处关闭 · 全部内容随应用离线可用', 'Press Esc or click outside to close · fully offline'],

  // --- responsive chrome ---------------------------------------------------
  'changelog.sub': ['版本历史与更新内容 · 当前版本', 'Release history · running'],
  'guide.sub': ['合成器基础 · 新手教学 · 使用帮助 · 从零捏音色', 'Synthesis · Getting started · Help · Sound design'],
};

export const FLOW_STRINGS: StringTable = {
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
};


export const SETTINGS_STRINGS: StringTable = {
  'drawer.close': ['关闭', 'Close'],
  'drawer.guide': ['使用指南', 'Guide'],
  'drawer.changelog': ['更新记录', 'Changelog'],
  'drawer.contrast': ['高对比', 'Contrast'],
  'theme.autoHint': ['跟随系统', 'Follow system'],
  'drawer.haptics': ['振动反馈', 'Haptics'],
  'drawer.hapticsOn': ['已开启振动反馈', 'Haptic feedback on'],
  'drawer.hapticsOff': ['已关闭振动反馈', 'Haptic feedback off'],
  'drawer.reset': ['重置布局', 'Reset layout'],
  'drawer.contrastOn': ['已切换高对比配色', 'High-contrast theme on'],
  'drawer.contrastOff': ['已切换默认配色', 'Default theme restored'],
  'drawer.resetDone': ['已重置面板布局与键盘显示', 'Layout and keyboard display reset'],
  'tuning.import': ['导入 .scl', 'Import .scl'],
  'tuning.imported': ['已导入 {name}（{notes} 音）', 'Imported {name} ({notes} notes)'],
  'tuning.importFailed': ['导入失败：{msg}', 'Import failed: {msg}'],
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
  'drawer.checkUpdate': ['检查更新', 'Updates'],
  'settings.title': ['设置', 'Settings'],
  'settings.workspace': ['工作区', 'Workspace'],
  'settings.instances': ['第二层音色', 'Second timbre'],
  'settings.performance': ['演奏', 'Playing'],
  'inst.pick': ['正在编辑', 'Editing'],
  'inst.hint': ['1 = 主音色，2 = 第二层（面板显示正在编辑的那一层）', '1 = main patch, 2 = second layer (the panels show the one being edited)'],
  'inst.route': ['按键分配', 'Routing'],
  'inst.single': ['只用第 1 层', 'Instance 1'],
  'inst.layer': ['叠加两层', 'Layer both'],
  'inst.split': ['按音高分区', 'Split by key'],
  'inst.splitAt': ['分界音', 'Split at'],
  'settings.appearance': ['界面', 'Appearance'],
  'settings.behaviour': ['交互', 'Interaction'],
  'settings.about': ['关于与文档', 'About & docs'],
  'settings.docs': ['文档', 'Docs'],
  'settings.openAudio': ['打开音频设置', 'Audio settings'],
  'fxg.open': ['打开路由图', 'Open routing'],
  'tuning.importHint': ['导入 Scala 调律文件（.scl），支持任意音数与非八度周期', 'Import a Scala tuning file (.scl): any number of notes, non-octave periods included'],
  'tuning.scala.tooShort': ['文件太短', 'file too short'],
  'tuning.scala.badCount': ['音数无效', 'invalid note count'],
  'tuning.scala.tooFewNotes': ['音数不足', 'fewer intervals than declared'],
  'tuning.scala.badInterval': ['音程无法解析', 'unreadable interval'],
  'tuning.scala.badRatio': ['音程比值无效', 'invalid ratio'],
  'tuning.scala.badPeriod': ['周期无效', 'invalid period'],
};

/** Preset-library drawer copy (P11.2); see the header for the split. */
export const DRAWER_STRINGS: StringTable = {
  'drawer.title': ['PRESET LIBRARY · 预设库', 'PRESET LIBRARY'],
  'drawer.search': ['搜索音色 / 风格 / 分类…', 'Search tone / style / category…'],
  'drawer.loaded': ['已载入预设 <b>{name}</b>', 'Loaded preset <b>{name}</b>'],
  'drawer.delete': ['删除预设', 'Delete preset'],
  'drawer.deleted': ['已删除用户预设', 'User preset deleted'],
  'drawer.import': ['导入', 'Import'],
  'drawer.export': ['导出', 'Export'],
  'drawer.share': ['分享', 'Share'],
  'drawer.imported': ['已导入音色文件', 'Patch file imported'],
  'drawer.importFailed': ['文件格式无法识别', 'Unrecognised file format'],
  'drawer.exported': ['已导出当前音色 · <b>.gs1.json</b>', 'Exported the current patch · <b>.gs1.json</b>'],
  'drawer.shareFile': [
    '曲目太长，已改为下载 .gs1song 文件（对方用预设库「导入」即可）',
    'The song is too long for a link, so it was downloaded as a .gs1song file (the other side imports it from the preset library)',
  ],
  'drawer.shared': ['分享链接已复制到剪贴板', 'Share link copied to the clipboard'],
  'drawer.shareFailed': ['分享链接已写入地址栏', 'Share link written to the address bar'],
  'drawer.footer': ['共 <b>{n}</b> 个预设 · {m} 个本地收藏', '<b>{n}</b> presets · {m} local'],
  'drawer.updateCurrent': ['已是最新版本', 'You are on the latest version'],
  'drawer.updateFound': ['发现新版本，正在更新…', 'New version found, updating…'],
  'drawer.updateUnsupported': ['离线模式不可用', 'Update check unavailable'],
};

/**
 * Project management copy (P10.4). Its own table for the same reason as the
 * others: the panel is a lazy chunk and every one of these keys is read only
 * after it opens.
 *
 * Two families are built dynamically from the *reason* a call failed
 * (`project.bad.*` for an unreadable file, `project.fail.*` for a refused
 * write), which is what keeps one message per failure mode without a parallel
 * switch in the component; `state/projects.test.ts` asserts that every reason
 * the model can return has copy here.
 */
export const PROJECT_STRINGS: StringTable = {
  'project.title': ['工程', 'Projects'],
  'project.open': ['工程管理', 'Projects'],
  'project.hint': [
    '一个工程 = 一整套工作区：音色、编排（曲目/录音/片段）、用户预设、场景与面板布局。语言、主题、CC 映射等个人设置不随工程切换。',
    'A project is a whole workspace: timbre, arrangement (tracks, takes, clips), user presets, scenes and panel layout. Personal settings — language, theme, CC map — do not travel with it.',
  ],
  'project.new': ['新建', 'New'],
  'project.defaultName': ['工程 {n}', 'Project {n}'],
  'project.rename': ['重命名', 'Rename'],
  'project.duplicate': ['复制', 'Duplicate'],
  'project.tags': ['标签', 'Tags'],
  'project.tagsHint': ['逗号分隔，最多 8 个', 'Comma separated, up to 8'],
  'project.export': ['导出', 'Export'],
  'project.delete': ['删除', 'Delete'],
  'project.switch': ['切换', 'Switch'],
  'project.save': ['保存', 'Save'],
  'project.cancel': ['取消', 'Cancel'],
  'project.active': ['当前', 'Current'],
  'project.damaged': ['内容已损坏', 'Unreadable'],
  'project.empty': [
    '还没有工程。点「新建」把当前工作区存成第一个工程。',
    'No projects yet — press New to keep this workspace as the first one.',
  ],
  'project.created': ['已新建工程 · {name}', 'Project created · {name}'],
  'project.renamed': ['已重命名', 'Renamed'],
  'project.duplicated': ['已复制工程', 'Project duplicated'],
  'project.deleted': ['已删除工程', 'Project deleted'],
  'project.exported': ['已导出 · {name}.gs1proj', 'Exported · {name}.gs1proj'],
  'project.switched': ['已切换到 {name}', 'Switched to {name}'],
  'project.switchDegraded': [
    '已切换，但存储写满：新工作区只存在于本次会话，请立刻导出',
    'Switched, but storage is full: the new workspace lives in this session only — export it now',
  ],
  'project.snapshot': ['快照', 'Snapshots'],
  'project.snapshotHint': [
    '快照是工程内的时间点副本；恢复算一个撤销步（Ctrl/Cmd+Z 可退回）。',
    'A snapshot is a point in time inside the project; restoring it is one undo step (Ctrl/Cmd+Z goes back).',
  ],
  'project.snapshotName': ['快照名（可留空）', 'Snapshot name (optional)'],
  'project.snapshotSave': ['存快照', 'Save snapshot'],
  'project.snapshotSaved': ['已保存快照 · {name}', 'Snapshot saved · {name}'],
  'project.snapshotRestore': ['恢复', 'Restore'],
  'project.snapshotRestored': [
    '已恢复快照 · 可按 Ctrl/Cmd+Z 撤销',
    'Snapshot restored · Ctrl/Cmd+Z undoes it',
  ],
  'project.snapshotDelete': ['删除快照', 'Delete snapshot'],
  'project.snapshotNone': ['还没有快照', 'No snapshots yet'],
  'project.import': ['导入 .gs1proj', 'Import .gs1proj'],
  'project.imported': ['已导入工程 · {name}', 'Project imported · {name}'],
  'project.bad.truncated': ['文件不是完整的 JSON（可能被截断）', 'That file is not complete JSON — it may be truncated'],
  'project.bad.format': ['不是 GS-1 工程文件（.gs1proj）', 'Not a GS-1 project file (.gs1proj)'],
  'project.bad.version': ['工程文件来自更新的版本，请先更新应用', 'That project file comes from a newer version — update the app first'],
  'project.bad.missing': ['工程文件缺少必需内容（音色或布局）', 'That project file is missing the timbre or the layout'],
  'project.fail.quota': [
    '存储空间不足，操作已取消（当前工作没有丢）',
    'Not enough storage: the action was cancelled and nothing was lost',
  ],
  'project.fail.unavailable': ['浏览器存储不可用（隐私模式？）', 'Browser storage is unavailable (private mode?)'],
  'project.fail.readonly': [
    '工程列表由更新版本写入，本版本只读（原文件已另存为 .newer）',
    'The project list was written by a newer build: this one is read-only (the original is kept as .newer)',
  ],
  'project.fail.limit': ['工程数量已达上限（24）', 'Project limit reached (24)'],
  'project.fail.missing': ['找不到这个工程', 'No such project'],
  'project.fail.active': ['当前工程不能删除，先切换到别的工程', 'The current project cannot be deleted — switch first'],
  'project.fail.damaged': ['这个工程的内容读不出来', 'That project’s document could not be read'],
  'project.fail.same': ['已经在这个工程里', 'That project is already open'],
};

function once(load: () => void): () => Promise<void> {
  let done = false;
  return () => {
    if (!done) { done = true; load(); }
    return Promise.resolve();
  };
}

export const loadFxStrings = once(() => registerStrings(FX_STRINGS));
export const loadRollStrings = once(() => registerStrings(ROLL_STRINGS));
export const loadPlayerStrings = once(() => registerStrings(PLAYER_STRINGS));
export const loadSourcesStrings = once(() => registerStrings(SOURCES_STRINGS));
export const loadAudioStrings = once(() => registerStrings(AUDIO_STRINGS));
export const loadDocsStrings = once(() => registerStrings(DOCS_STRINGS));
export const loadFlowStrings = once(() => registerStrings(FLOW_STRINGS));
export const loadSettingsStrings = once(() => registerStrings(SETTINGS_STRINGS));
export const loadDrawerStrings = once(() => registerStrings(DRAWER_STRINGS));
export const loadProjectStrings = once(() => registerStrings(PROJECT_STRINGS));

export const STRING_LOADERS: ReadonlyArray<() => Promise<void>> = [
  loadDrawerStrings,
  loadSettingsStrings,
  loadFxStrings,
  loadRollStrings,
  loadPlayerStrings,
  loadSourcesStrings,
  loadAudioStrings,
  loadDocsStrings,
  loadFlowStrings,
  loadProjectStrings,
];
