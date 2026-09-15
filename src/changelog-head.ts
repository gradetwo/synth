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
    version: '2.1.5',
    date: '2026-09-15',
    kind: 'fix',
    items: [
      [
        '**修好三处「平时听不出来、一旦踩到就很怪」的问题，另外把几条「门禁存在但没人跑」的债清了。** ① `MASTER_TUNE`（主调音）以前在渲染路径被应用了两次——发 +12 半音实际响 +24（默认 0、任何工厂预设都不受影响）。② 把电平推得足够高、进到限幅器时，总线会出现一层 **k×f0 ± 40 Hz 的侧带**（约 −40 dBc）和约 1 dB 的增益纹波；限幅器现在只在信号回到上限以下才释放，侧带掉到 −89 dBc、纹波归零，而且**不触发限幅器时逐位不变**。③ 窄屏下如果页面没收到视口变化通知（WebKit 的 `setViewportSize` 就是这样），顶栏的桌面最小宽度会把页面撑出 10 px；已被一行 CSS 封住，桌面像素不变。内部方面：48 张视觉基线接进 CI（在 schedule 上报告差异，不阻塞提交）、`npm run lint` 覆盖扩到 `e2e/scripts/mcp`（清掉 125 个 error，其中两个是真缺陷）、发布清单 `SHA256SUMS` 覆盖全部保留版本、nightly 的每个引擎日志现在**边跑边落盘**（长跑中途可见，不再只有结束才知道）。**默认声音没有任何变化。**',
        '**Three problems that are inaudible until you step on them are fixed, along with a batch of "the gate exists but nobody runs it" debt.** (1) `MASTER_TUNE` was applied twice on the render path, so +12 semitones sounded +24 -- at its default of 0 nothing changes, and no factory preset uses it. (2) Pushing a voice hard enough to reach the limiter put a **k x f0 +- 40 Hz sideband comb** on the bus (around -40 dBc) with about 1 dB of gain ripple; the limiter now holds its release until the signal is back under the ceiling, which takes the sidebands to -89 dBc and the ripple to zero, and is **bit-identical whenever the limiter does not engage**. (3) At 320 px, if the page is never told the viewport changed (WebKit\'s `setViewportSize` does exactly that), a desktop-only minimum width pushed the top bar 10 px out of the page; a one-line CSS cap fixes it with desktop pixels unchanged. Internally: the 48 visual baselines now run on a CI schedule (reported, not blocking), `npm run lint` covers `e2e/scripts/mcp` (125 errors removed, two of them real defects), and the release manifest covers every retained version, and each engine\'s nightly log now lands on disk while it runs instead of only at the end. **The default sound is unchanged.**',
      ],
    ],
  };
