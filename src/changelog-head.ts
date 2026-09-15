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
    version: '2.1.2',
    date: '2026-09-15',
    kind: 'feature',
    items: [
      [
        '**给外部 AI 的接口又长了一层：现在它也能「看」界面。** 在原来的离线工具之外多了一个可选的**浏览器层**：外部的智能体可以打开真实页面、点击、读文本、截图，并按白名单跑既有的视觉/性能/参数门禁——所以它不但能离线量音频，也能核实界面里到底发生了什么。**这台合成器本身没有任何变化。**',
        '**The interface for other AI agents grew a browser layer.** Alongside the offline tools there is now an optional **browser layer**: an external agent can open the real page, click, read text, take screenshots and run the whitelisted visual/performance/parameter gates, so it can check what actually happens in the interface as well as measure audio offline. **The synth itself is unchanged.**',
      ],
    ],
  };
