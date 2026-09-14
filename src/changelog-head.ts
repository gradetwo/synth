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
    version: '2.0.7',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**修好一批「选了却没用上」的音色与效果。** 浏览器里有一层参数范围挡在引擎前面：选**波表**会被悄悄换成噪声、选 **SEM / 共振峰 / 梳状**滤波会被换成陷波、效果槽里选**瞬态整形**实际跑的是 EQ。受影响的工厂音色共 **10 条**（4 条波表、`graphswell`、`phonk`、`robotvoice` 与 3 条 SEM 铺底）。现在这些选择真正到达引擎了——`wtorgan` 之类从「与噪声无法区分」变成正常的波表音色。另加了两道门禁（数据门禁 + 真浏览器 E2E）确保不会再发生。',
        '**A batch of choices that were selected but never reached the engine.** A parameter range in the browser sat in front of the core: picking a **wavetable** was quietly replaced by noise, a **SEM, formant or comb** filter became a notch, and choosing **transient shaping** for an effect slot actually ran the EQ. Ten factory patches were affected -- four wavetables, `graphswell`, `phonk`, `robotvoice` and the three SEM pads. Those choices now arrive: `wtorgan` and friends went from "indistinguishable from noise" to a proper wavetable tone. Two new gates (a data check and a real-browser test) keep this from happening again.',
      ],
    ],
  };
