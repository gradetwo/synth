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
    version: '1.106.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**图模式的失真节点也能开 2× 过采样了**：以前只有链模式的 DRIVE 会过采样，路由图刻意不参与——因为并联支路没有逐节点延迟补偿会错相。现在图里的 DRIVE 节点在 2× 下跑，并由逐节点补偿把并联支路与干路重新对齐：离格混叠从 −33.4 dB 降到 **−59.5 dB（−26 dB）**，延迟如实上报为 **62 样本 / 1.29 ms**；开着时图输出与链模式**逐位一致**，关掉时逐字节不变。',
        '**Graph-mode distortion nodes can run at 2x too.** Only the chain\'s DRIVE used to oversample; the routing graph deliberately sat it out, because without per-node delay compensation its parallel branches would drift out of phase. The graph\'s DRIVE node now runs at 2x with per-node compensation realigning every branch and the dry path: its off-grid aliasing drops from -33.4 dB to **-59.5 dB (-26 dB)**, the latency is reported honestly as **62 samples / 1.29 ms**, and with the switch off the graph renders byte-for-byte what it did before.',
      ],
    ],
  };
