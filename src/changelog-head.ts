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
    version: '1.112.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修掉一声很罕见的爆音。** 高音区某些音符在起音的瞬间会有一次整级错误的修正，听起来是一声短促的爆音（实测约每 150 次新起音出现 1 次）。除此之外整段波形**逐字节不变**，工厂预设与音量都没有改动。',
        '**Fixed a crackle that only showed up rarely.** In the high register, a few notes got one full-scale correction error the moment they started, which sounds like a short crackle (measured: about one fresh note in 150). Every other phase is **byte-for-byte** unchanged, and no factory preset or level moved.',
      ],
    ],
  };
