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
    version: '1.98.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**多了一个瞬态整形效果**：路由图里新增「TRANSIENT」——ATTACK 与 SUSTAIN 两个双向旋钮，用来提升或压低一个打点的起音与延音（满档约 ±7 dB，0 表示不变），另配 MIX 干湿比；默认关闭，持续音上不引入额外谐波（实测 THD 增量 0.00），关闭或中性设置时与之前逐位相同。',
        '**A transient shaper**: the routing graph gained TRANSIENT — attack and sustain knobs that lift or push down a hit’s onset and its tail (about ±7 dB at full, 0 is unchanged), plus a dry/wet mix. It is off by default, adds no harmonic content to a held note (measured THD increase 0.00), and off or neutral renders bit-for-bit what it did before.',
      ],
    ],
  };
