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
    version: '2.1.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**内部重构：把音频测量的「尺子」抽成共用模块。** 这次没有任何声音或界面变化——但它是一个**给后续 AI 工具接口（P13）铺路**的准备动作：门禁脚本里那套在 Node 里跑真 wasm 的渲染引导、以及两把测量尺子（7 项 Blackman-Harris 与 Hann 窗探针），现在是一份**被门禁和将来的工具共用**的实现，不再是各写一份。验收标准是**门禁读数逐字节不变**（136 行输出哈希一致），也就是说这次改动**证明了它没有改变任何测量结果**。',
        '**Internal refactor: the audio rulers became a shared module.** Nothing changed in the sound or the interface -- this is groundwork for the tool interface other agents will use (P13): the harness that boots the real wasm core in Node and the two measurement rulers (the 7-term Blackman-Harris scan and the Hann-window probe) are now one implementation that both the gates and the coming tools call, instead of two copies that could drift apart. The acceptance was that **not one gate reading moves** (all 136 output lines hash-identical), so this change proves it changed no measurement.',
      ],
    ],
  };
