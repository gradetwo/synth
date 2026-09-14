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
    version: '1.111.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**内部维护版：声音与界面没有任何变化。** 新增了波表/采样音源在高音区的回归门禁，并如实登记一个**已知边界**：这类音色在高音区的非谐波能量高于普通振荡器路径（要修就得改变它们的音色，所以留到单独一批再动）。引擎与上一版**逐字节相同**。',
        '**Internal maintenance release: nothing changed in the sound or the interface.** Added a regression gate for the wavetable and sampler sources in the high register, and recorded a **known boundary**: up there those sources carry more non-harmonic energy than the ordinary oscillator path does (fixing it means changing how they sound, so it is left to a batch of its own). The engine is **byte-for-byte** the previous build.',
      ],
    ],
  };
