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
    version: '1.96.0',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**装得更小、启动更快，而且启动时间也有了门禁**：图标从 24 位 PNG 换成 8 位（肉眼无差别，体积少约 49 KB）；从打开页面到「启动音频引擎」可点的实测最慢约 2.1 秒，现在由 E2E 门禁盯着（超过约 3.2 秒就红）。体积门禁同时**收紧**：总量 1712→1672 KB、首屏 JS 165→134 KB、CSS 22→21 KB、内核 230→70 KB，以后体积回涨会当场被发现。',
        '**A smaller download, a faster start, and a guard on startup time**: the icons went from 24-bit PNG to 8-bit (visually indistinguishable, about 49 KB less); opening the page to the Start button being clickable measures at worst about 2.1 s and is now held by an end-to-end gate that fails past about 3.2 s. The size budgets were tightened at the same time — total 1712→1672 KB, first-screen JS 165→134 KB, CSS 22→21 KB, core 230→70 KB — so a future regression shows up immediately.',
      ],
    ],
  };
