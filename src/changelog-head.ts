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

/**
 * Where the source and the full release history live.
 *
 * It sits in this file rather than a new module because the update banner already
 * imports this one — putting it anywhere that pulls in `CHANGELOG` would drag the
 * whole history back into the first-screen chunk, which is what this file exists
 * to avoid.
 */
export const REPO_URL = 'https://github.com/gradetwo/synth';

export const CHANGELOG_HEAD: Release = {
  version: '2.1.9',
  date: '2026-10-12',
  kind: 'feature',
  items: [
    [
      '**支持 WebCodecs 硬件加速压缩导出、波表位掩码采样优化与状态持久化脏检查。** 导出功能新增基于 WebCodecs 的 Opus/AAC 原生编码与 16 ms 协作时间分片，彻底杜绝主线程冻结；Ogg 页面批量封装提升 3.1× 封包速度并减少 18.6% 容器冗余。DSP 核心新增波表位掩码直读快速路径与 Worklet 静态参数脏检查。持久化层引入 `saveJsonIfChanged` 脏检查减少 62.5% 的旋钮拖拽写入，32 位单声道 WAV 支持直接内存批量拷贝解码。默认音质与全部 91 条预设指纹完全保持不变。',
      '**WebCodecs hardware-accelerated compressed export, bit-mask wavetable fast path, and store persistence dirty checking.** Song export adds native WebCodecs Opus/AAC encoding with a 16 ms cooperative yield to prevent main-thread UI freezes; batched Ogg pages speed up packing by 3.1x with 18.6% smaller container overhead. The DSP core adds a bit-mask wavetable sampling fast path and Worklet parameter dirty-checking. Persistence adds `saveJsonIfChanged` to skip 62.5% of redundant knob-drag writes, and float32 mono WAVs decode via direct memcpy. Default audio and all 91 preset fingerprints are unchanged.',
    ],
  ],
};
