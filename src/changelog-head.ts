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
    version: '1.110.0',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**启动更快**：首屏要下载的 JavaScript 少了约 **11 KB**（面板文案改为打开面板时才加载），第一次打开和弱网下最明显。面板文案没到之前不会闪出占位键名，切换语言也不会先显示另一种语言再纠正。声音引擎与上一版**逐字节相同**。发布流程另加一道门禁：首屏可交互时间超标会直接中止发布（内部）。',
        '**Starts faster.** The first screen downloads about **11 KB** less JavaScript (panel copy now loads when its panel opens), which shows up most on the first visit and on slow connections. A panel never flashes placeholder key names before its copy arrives, and switching language never paints one language and then corrects itself. The audio engine is **byte-for-byte** the previous build. Publishing also gained a gate that aborts a release when first-interactive time regresses (internal).',
      ],
    ],
  };
