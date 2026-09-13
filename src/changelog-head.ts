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
    version: '1.107.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**卷帘可以多选了**：框选、Ctrl 点选、Shift 范围选、全选，然后整组批量操作——移动、复制/粘贴、缩放、量化、力度、删除，**每次编辑一个撤销步**。键盘方向键微移（Shift 一个八度），手机多了「多选」开关与批量按钮。跨层拖拽会明确提示「暂不支持」而不是静默丢音。',
        '**Multi-select in the roll.** Marquee, Ctrl-click, Shift-range and select-all, then act on the group: move, copy/paste, scale, quantise, velocity, delete — **each edit is one undo step**. Arrow keys nudge (Shift for an octave), and phones get a multi-select toggle plus batch buttons. Dragging across layers says so instead of silently losing the notes.',
      ],
    ],
  };
