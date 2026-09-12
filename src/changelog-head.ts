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
    version: '1.95.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**路由图里可以拉调制线了**：新增 **LFO1 / LFO2 / ENV** 三个调制源卡片，拖到任意节点的输入/输出增益即可调制它——虚线表示这条边，线上的深度可改可删；也可用键盘可达的「MOD」一行按源/目标/深度设置。深度为 0 时与没有调制**逐位相同**；它与原有 8 槽调制矩阵并存（矩阵管音高/滤波/音量等声部参数，图内边管节点增益）。',
        '**Modulation wires in the routing graph**: three source cards (**LFO1, LFO2, ENV**) drag onto any node’s input or output gain to modulate it — a dashed wire shows the edge and its depth chip can be edited or deleted, and the keyboard-reachable **MOD** row does the same without dragging. At depth 0 the render is **bit-for-bit** what it was; it sits beside the eight-slot matrix (voice parameters) rather than replacing it (node gains).',
      ],
      [
        '**效果图可以存成模板**：图头部多了模板一栏，把当前的节点类型、并联、连线与增益**存为模板**，一键套用；内置 5 例（经典串联、双延迟、并行混响、失真分路、空图）。模板存在**工作区**、不进音色也不进分享码，读取时按白名单校验（只认图结构与节点增益，不会碰到混响模式、IR 或音色参数）。',
        '**Effect graphs can be saved as templates**: the graph header can save the current node kinds, parallel sends, wires and gains as a template and apply it in one click, with five built-ins (classic chain, dual delay, parallel reverb, drive split, empty). Templates live in the **workspace**, never in a patch or share link, and load through a whitelist (graph structure and node gains only).',
      ],
    ],
  };
