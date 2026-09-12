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
    version: '1.92.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**两个新效果：位粉碎与塑形 EQ**：路由图里多了「CRUSH」（降位 4–16 bit + 降采样 1–64 倍，带可调抗混叠，适合 lofi 与电子质感）和「EQ」（低架 + 可扫中频峰值 + 高架，各段独立增益与频率），都有干湿混合、默认关闭、随音色保存与分享；原来的六个效果节点与所有旧音色**完全不变**。',
        '**Two new effects: bit-crusher and shaping EQ**: the routing graph gained CRUSH (4–16 bits, 1–64× downsampling, adjustable anti-aliasing — the lofi and digital texture) and EQ (low shelf + sweepable mid peak + high shelf, each with its own gain and frequency). Both have a dry/wet mix, are off by default, and save and share with the patch; the original six effect nodes and every existing patch are unchanged.',
      ],
    ],
  };
