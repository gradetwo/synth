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
    version: '1.99.0',
    date: '2026-09-13',
    kind: 'fix',
    items: [
      [
        '**音质门禁换了一把更可靠的尺子**：旧的「精确 bin 相减」在两数相减时会留下假底噪，纯正弦被读成 −84…−102 dB；改用 7 项 Blackman-Harris 窗（4 秒整窗、每谐波 ±2 Hz 带外功率求和）后读数稳定，正弦离谐波能量最差 **−119.1 dB**，断言收紧到 **−105 dB**。另新增「同场景连做 8 次」的稳定性断言（实测离散度 **0.00 dB**），并记录锯齿/方波/三角的真实混叠底，供下一批带限使用。引擎与音色**逐位未变**。',
        '**The audio gate now measures with a ruler that does not lie.** Its old "exact-bin subtraction" left a false floor when two nearly equal numbers were subtracted, so a pure sine read -84...-102 dB; a 7-term Blackman-Harris window (four whole seconds, power summed outside +/-2 Hz of each harmonic) is stable, puts the sine at a worst case of **-119.1 dB**, and lets the assertion tighten to **-105 dB**. A new assertion renders one scene eight times and demands agreement (measured spread **0.00 dB**), and the saw/square/triangle alias floors are recorded for the next band-limiting batch. The engine and every sound are **bit-for-bit unchanged**.',
      ],
    ],
  };
