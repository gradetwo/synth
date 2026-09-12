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
    version: '1.91.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**录音不再覆盖上一遍**：每次录完都成为一条独立的 take（内容 = 当前 take 或该层原有的音符 + 刚弹的），新的自动选中、旧的全部保留，随时切回去听。同一个音在 50 ms 内重复按算重击，替换而不是叠成双倍力度；每层最多 8 条，超出淘汰最旧的。切 take 立刻改变该层内容，播放、卷帘、MIDI/WAV/MP3 导出与分享码都跟着当前 take；分享码会带上全部 take，对方也能切。',
        '**Recording no longer overwrites the last pass**: every finished recording becomes its own take (the selected take’s notes, or the layer’s, plus what you just played), the new one is selected and the old ones stay, so switching back to hear them is a click. The same key inside 50 ms counts as a re-strike and replaces the note instead of doubling its velocity into a flam, and a layer keeps up to eight takes, retiring the oldest. Switching a take changes the layer immediately, and playback, the roll, MIDI/WAV/MP3 export and the share link all follow the selected take; the link carries every take so the other side can switch too.',
      ],
    ],
};
