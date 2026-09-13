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
    version: '1.105.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**包体小了一大截**：wasm 内核接入 `wasm-opt -Oz` 优化，两个核的**未压缩体积降了 31%/35%**，整个应用从 **1719 KB 降到 1523 KB（−196 KB，约 −11%）**；测试里首屏可交互时间约 1.0 s（三次取最快）。构建脚本取不到该工具时会打印原因并跳过，**绝不因此构建失败**；优化前后音频输出**逐字节相同**（三个指纹一字未动）。',
        '**The bundle got much smaller.** The wasm cores now go through `wasm-opt -Oz`, which cuts their uncompressed size by 31%/35% and takes the whole app from **1719 KB to 1523 KB (-196 KB, about -11%)**; first-interactive in the test suite measured about 1.0 s at best. The build prints a reason and skips the step if the tool is missing rather than failing, and the optimised cores render **byte-identical** audio (all three fingerprints unchanged).',
      ],
    ],
  };
