/**
 * The newest release, on its own.
 *
 * The update banner sits on the first screen and only needs its headline, but
 * importing `CHANGELOG` dragged every release note into the initial bundle —
 * which is exactly the budget the size gate is there to protect. The panel
 * that shows the history loads lazily; this is the one entry the banner reads,
 * and `changelog.test.ts` keeps it identical to `CHANGELOG[0]`.
 *
 * A release ends by rotating this file: the entry that was here moves into
 * `CHANGELOG` (as a literal, right behind the head reference) and the oldest
 * shipped entry moves to the front of `changelog-archive.ts`, so the shipped
 * list stays at `SHIPPED_CHANGELOG_LIMIT`. `changelog.test.ts` fails if any of
 * that is skipped, done twice, or done with a typo.
 */
export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: 'sound' | 'feature' | 'fix';
  items: [string, string][];
}

export const CHANGELOG_HEAD: Release = {
    version: '2.1.1',
    date: '2026-09-15',
    kind: 'feature',
    items: [
      [
        '**内置了一个给其它 AI 用的离线接口（MCP）。** 外部的智能体现在可以查询参数与音色、读改整套音色（**夹取会如实报告**，不静默）、导入采样与波表，把一段演奏**渲染成 WAV**，并用**本应用自己那套交叉验证过的尺子**量出结构化数字（非谐波地板、THD、峰值、最大步进）——所以它可以对着真实门禁调音色，而不是凭感觉。另有**采样导入快约 1.7 倍**（4 秒样本 130 → 78 ms，音色逐位不变）。界面只有一处小变化：**更新记录面板改为只列最近 30 条**（更早的见项目仓库），顺带让整个应用小约 79 KB。',
        '**An offline interface (MCP) for other AI agents.** An external agent can now read the parameter and patch tables, change a whole patch (clamps are **reported, not silent**), import samples and wavetables, render a performance to **WAV**, and measure it with **the same cross-checked rulers the app\'s own gates use** (non-harmonic floor, THD, peak, largest step) -- so it can tune toward a real gate instead of a feeling. Sample import is also **about 1.7x faster** (a 4 s sample: 130 ms to 78 ms, bit-identical audio). One small visible change: the **changelog panel now lists the most recent 30 releases** (earlier ones live in the repository), which takes about 79 KB off the app.',
      ],
    ],
  };
