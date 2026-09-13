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
    version: '1.109.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**片段编排更好用**：片段里能**直接改音符**（含新的多选批量编辑，每次编辑一个撤销步），可以把片段**复制到另一层**，还能把片段存成**模板**再套用到任意层（放在工作区，不进音色/分享码）。跨层复制与「逐个音符复制再折叠」的结果**逐位一致**，副本与模板都**不共享状态**。另修好上一版里被误删的 2× 预设指纹门禁（内部）。',
        '**Clip arrangement got easier.** Notes can be edited **inside** a clip (including the new multi-select batch edits, one undo step each), a clip can be **copied onto another layer**, and a clip can be saved as a **template** and applied to any layer (kept in the workspace, not in the patch or the share code). The copy is **bit-for-bit** what copying the notes by hand produces, and neither copies nor templates share state. Also restored the 2x preset-fingerprint gate the previous release dropped (internal).',
      ],
    ],
  };
