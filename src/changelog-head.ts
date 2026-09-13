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
    version: '1.103.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**效果参数现在可以按节点覆盖**：路由图 6 个效果节点各自能覆盖自己的参数（延迟、混响、粉碎、EQ、drive 等，每个效果最多 4 个），不再出现「两个同类节点共用一组参数」。覆盖随分享码、`.gs1song` 与图模板携带，旧码仍可读；新增 8 条覆盖调制总线，可与既有图内调制同时把 8 个槽交给 LFO/包络。**不覆盖时与之前逐位相同。**顺带修好卡片拖拽（标题行在 Chromium 上高度为 0，此前一直没生效）。',
        '**Effect parameters can now be overridden per node.** The graph\'s six effect nodes each carry their own values (delay, reverb, crusher, EQ, drive, … up to four per effect), so two nodes of the same kind no longer share one set. Overrides travel with the share code, `.gs1song` and graph templates, and old codes still load; eight new override-modulation buses can hand eight slots to the LFOs/envelope at once alongside the existing in-graph modulation. **With nothing overridden the render is bit-for-bit what it was.** A side fix: dragging a node card works for the first time — its title row measured zero height in Chromium.',
      ],
    ],
  };
