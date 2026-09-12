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
        '**路由图里可以拉调制线了**：图里新增 **LFO1 / LFO2 / ENV** 三个调制源卡片，从源拖到任意节点的输入或输出增益上就能给它加调制——虚线显示这条边，线上的深度小标签可以改深度或删掉；不想拖拽也可以用键盘可达的「MOD」一行按 源 / 目标 / 深度 逐条设置。增益每块解算一次并经过原有平滑，**深度为 0 时与没有调制逐位相同**；它与原来的 8 槽调制矩阵并存（矩阵管音高/滤波/音量等声部参数，图内边管节点增益），互不干扰。',
        '**Modulation wires in the routing graph**: three source cards (**LFO1, LFO2, ENV**) can be dragged onto any node’s input or output gain to modulate it — a dashed wire shows the edge, with a depth chip on it you can edit or delete — and the keyboard-reachable **MOD** row sets source, target and depth without dragging. The gains are resolved once per block through the existing smoother, and **at depth 0 the render is bit-for-bit what it was without the feature**; it sits beside the eight-slot modulation matrix (which still drives pitch, filter, volume and the rest) rather than replacing it.',
      ],
      [
        '**效果图可以存成模板了**：路由图头部多了模板一栏——把当前的图（节点类型、并联、连线、增益）**存为模板**，以后一键套用；内置 5 个示例（经典串联、双延迟、并行混响、失真分路、空图）。模板存在**工作区**里，不进音色也不进分享码；读取时按白名单校验（只认图结构与节点增益，**不会**碰到混响模式、IR 或音色参数），损坏的条目会被夹取或拒绝。',
        '**Effect graphs can be saved as templates**: the routing graph’s header gained a template row — save the current graph (node kinds, parallel sends, wires, gains) as a template and apply it with one click, with five built-in examples (classic chain, dual delay, parallel reverb, drive split, empty). Templates live in the **workspace**, not in a patch or a share link, and are validated against a whitelist on load (graph structure and node gains only — never reverb mode, an impulse response or a patch parameter); corrupt entries are clamped or refused.',
      ],
    ],
  };
