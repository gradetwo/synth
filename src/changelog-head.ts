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
    version: '2.0.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**v2.0.0：创作与工作流二期完成。** 现在可以同时保存**多套工程**（切换、复制、打标签、快照恢复），并把它们导入导出成 `.gs1proj` 文件；存储空间不足时操作会被取消，而**当前正在做的东西不会丢**。内置曲库**清掉了全部仍在版权保护期内的曲目**（换成公版作品或本站原创编配），每首曲子都标注**来源与许可**；导入自己的 MIDI 或工程文件时，若文件损坏会**说明具体是哪一种问题**。',
        '**v2.0.0: the writing-and-workflow phase is done.** You can keep **several projects** side by side -- switch, duplicate, tag, restore a snapshot -- and import or export them as `.gs1proj` files; if storage runs out the operation is cancelled and **your current work is kept**. The built-in library **no longer contains any in-copyright works** (they are replaced with public-domain pieces or arrangements of our own), every track now shows its **source and licence**, and importing your own MIDI or project file says **which** kind of damage made it refuse.',
      ],
    ],
  };
