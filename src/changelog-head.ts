/**
 * The newest release, on its own.
 *
 * The update banner sits on the first screen and only needs its headline, but
 * importing `CHANGELOG` dragged every release note into the initial bundle —
 * which is exactly the budget the size gate is there to protect. The panel
 * that shows the history loads lazily; this is the one entry the banner reads,
 * and `changelog.test.ts` keeps it identical to `CHANGELOG[0]`.
 */
export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: 'sound' | 'feature' | 'fix';
  items: [string, string][];
}

export const CHANGELOG_HEAD: Release = {
    version: '2.0.5',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修好两个「看着没问题、用起来不对」的毛病。** ①**Crushed Sub** 这个音色其实几乎没声音——它的位粉碎步长比信号本身还大，每一个采样都被量化成零，只剩 10% 的干声漏出来；现在是真正的 6 bit 粉碎，低频回来了。②导入曲目现在**按文件内容判断格式**，不再只看扩展名：文件名里没有 `.mid` 的 MIDI 以前会被直接拒掉（提示「无法识别的文件格式」），现在能正常导入。',
        '**Two things that looked fine until you used them.** (1) The **Crushed Sub** patch was effectively silent: its bit-crusher step was larger than the signal itself, so every sample quantized to zero and only 10% of the dry path leaked through. It is a real 6-bit crush now and the low end is back. (2) Importing a track now decides the format from the **file\'s content** instead of its name -- a MIDI file whose name lacks `.mid` used to be refused outright ("unrecognised file format") and now imports normally.',
      ],
    ],
  };
