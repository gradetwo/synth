/**
 * The practice panel's own copy (P12.1).
 *
 * Same reason as `src/i18n.library.ts`: `src/i18n-panels.ts` is the shared
 * panel table and two parallel UI tracks would collide in it, so the teaching
 * batch registers its strings from this module instead. The pattern is the one
 * every lazy table uses — a table plus a `once()` loader — and the panel waits
 * for `loadTeachStrings()` before it renders, so `t()` is never asked for a key
 * whose copy has not arrived.
 *
 * The scale/chord names are looked up dynamically by id
 * (`teach.scale.<id>` / `teach.chord.<id>`); `theory.test.ts` checks that every
 * id in `teaching/theory.ts` has both languages here, because the i18n source
 * walker cannot see a key built at runtime.
 */
import { registerStrings, type StringTable } from './i18n';

export const TEACH_STRINGS: StringTable = {
  // --- entry / panel -------------------------------------------------------
  'teach.title': ['教学与练习', 'Practice'],
  'teach.open': ['打开教学面板', 'Open practice panel'],
  'teach.close': ['关闭教学面板', 'Close practice panel'],
  'teach.hint': [
    '选好音阶或和弦，目标音会在钢琴键盘上高亮。按「开始练习」，预备 4 拍后跟着弹，结束时给出量化评分。',
    'Pick a scale or chord and its notes light up on the keyboard. Press Start, play after the 4-beat count-in, and get a quantified score at the end.',
  ],

  // --- setup ---------------------------------------------------------------
  'teach.kind': ['类型', 'Type'],
  'teach.kind.scale': ['音阶', 'Scale'],
  'teach.kind.chord': ['和弦', 'Chord'],
  'teach.root': ['根音', 'Root'],
  'teach.octaves': ['八度', 'Octaves'],
  'teach.bpm': ['速度', 'Tempo'],
  'teach.target': ['目标音', 'Target notes'],
  'teach.targetCount': ['{n} 个音', '{n} notes'],

  // --- transport -----------------------------------------------------------
  'teach.start': ['开始练习', 'Start'],
  'teach.stop': ['停止并评分', 'Stop & score'],
  'teach.reset': ['重来', 'Reset'],
  'teach.countIn': ['预备…（4 拍后开始记录）', 'Count-in… (recording starts after 4 beats)'],
  'teach.recording': ['正在记录 · 跟着高亮的琴键弹', 'Recording · play the highlighted keys'],
  'teach.done': ['评分完成', 'Scored'],
  'teach.ready': ['准备就绪', 'Ready'],
  'teach.noResult': ['还没有评分结果', 'No score yet'],

  // --- results -------------------------------------------------------------
  'teach.score': ['总分', 'Score'],
  'teach.hitRate': ['命中率', 'Hit rate'],
  'teach.missed': ['漏音', 'Missed'],
  'teach.extra': ['多音', 'Extra'],
  'teach.intonation': ['音准', 'Intonation'],
  'teach.timing': ['节奏', 'Timing'],
  'teach.hits': ['命中 {hit}/{expected}', 'Hits {hit}/{expected}'],
  'teach.meanError': ['平均偏差 {n} 半音', 'Mean error {n} semitones'],
  'teach.maxError': ['最大 {n} 半音', 'Max {n} semitones'],
  'teach.meanTiming': ['平均 {n} ms（≈{beats} 拍）', 'Mean {n} ms (≈{beats} beats)'],
  'teach.maxTiming': ['最大 {n} ms', 'Max {n} ms'],
  'teach.earlyLate': ['早 {early} · 晚 {late}', 'early {early} · late {late}'],
  'teach.perPitch': ['逐音命中', 'Per-pitch hits'],

  // --- scale names ---------------------------------------------------------
  'teach.scale.major': ['大调', 'Major'],
  'teach.scale.minor': ['自然小调', 'Natural minor'],
  'teach.scale.harmonicMinor': ['和声小调', 'Harmonic minor'],
  'teach.scale.dorian': ['多利亚', 'Dorian'],
  'teach.scale.majorPentatonic': ['大调五声', 'Major pentatonic'],
  'teach.scale.minorPentatonic': ['小调五声', 'Minor pentatonic'],
  'teach.scale.blues': ['布鲁斯', 'Blues'],

  // --- chord names ---------------------------------------------------------
  'teach.chord.major': ['大三和弦', 'Major'],
  'teach.chord.minor': ['小三和弦', 'Minor'],
  'teach.chord.dim': ['减三和弦', 'Diminished'],
  'teach.chord.aug': ['增三和弦', 'Augmented'],
  'teach.chord.sus2': ['挂二和弦', 'Sus2'],
  'teach.chord.sus4': ['挂四和弦', 'Sus4'],
  'teach.chord.maj7': ['大七和弦', 'Maj7'],
  'teach.chord.min7': ['小七和弦', 'Min7'],
  'teach.chord.dom7': ['属七和弦', 'Dom7'],
};

/** Register once; a second call is free (same shape as `i18n.library.ts`). */
function once(load: () => void): () => Promise<void> {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      load();
    }
    return Promise.resolve();
  };
}

export const loadTeachStrings = once(() => registerStrings(TEACH_STRINGS));
