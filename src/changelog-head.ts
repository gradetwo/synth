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
    version: '1.94.0',
    date: '2026-09-12',
    kind: 'feature',
    items: [
      [
        '**延迟与卷积可以同时用两个了**：以前一个音色里第二个延迟（或第二个卷积混响）节点会被直接跳过、等于没接；现在路由图里可以并排放**两个延迟和两个卷积**，各自有自己的回声时间线与混响尾部、互不串音。代价是内存——卷积的分区频谱是只读共享的，但每个节点要有自己的延迟线和变换缓冲，所以导入很长的 IR 时可用余量比以前紧张；同类节点的**第三个**会在编辑器里被禁用并写明原因。',
        '**Two delays and two convolutions at once**: a patch used to skip the second delay (or the second convolution) node entirely, as if it were not wired; the routing graph can now hold **two of each**, with their own echo timelines and reverb tails that do not bleed into one another. The cost is memory — the convolution’s partition spectra are shared read-only, but every node needs its own delay line and transform buffers, so importing a long impulse response leaves less headroom than it used to; a **third** node of the same kind is disabled in the editor with the reason shown.',
      ],
    ],
  };
