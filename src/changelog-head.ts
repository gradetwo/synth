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
    version: '2.1.7',
    date: '2026-09-26',
    kind: 'fix',
    items: [
      [
        '**修好四个能听见的毛病，并给外部宿主补上 ABI 9。** ① 音符事件处不再有爆音——分块渲染时输出缓冲只留下了最后一个子块，而块正好切在音符落下的那一帧；② 连点同一个键不再没声或只响一小截——重按会顶掉同一个键上尚未触发的旧释放；③ 被抢的声部淡出由 20 ms 加长到 50 ms，持续音被抢时不再咔哒（**本版唯一的音色变动**：只有 `futurechord` 会抢声部，它的指纹已按流程重录并写明理由）；④ 定时音符改用音频上下文的时间轴，宿主提前排好的音不再整体迟到。宿主侧新增 `gs_note_bend`（逐音弯音）与 `gs_set_tuning_note`（逐键微分音），音符事件可以带 `cents`。**另外清掉了 GitHub Code Scanning 的全部九条告警**（toast 改为交给 React 转义、数值输入的正则范围、分配器游标、CI 权限、nightly 日志），`vitest` 升到 4、`wrangler` 升到 4.139，Dependabot 的八条告警全部关闭。',
        '**Four audible defects fixed, and ABI 9 for hosts.** (1) No more click at every note event: a split block kept only its last chunk, and a block splits on exactly the frame a note lands. (2) Tapping the same key twice no longer goes silent or plays a fragment — re-pressing supersedes the untriggered old release. (3) A stolen voice fades over 50 ms instead of 20, so stealing a ringing note no longer clicks (**the release\'s only timbre change**: only `futurechord` steals a voice, and its fingerprint was re-recorded with a written reason). (4) Timed notes use the audio context\'s timeline, so a host that schedules ahead no longer runs late. Hosts gain `gs_note_bend` (per-note bend) and `gs_set_tuning_note` (per-key microtuning), and note events accept `cents`. **All nine GitHub Code Scanning alerts are closed** (React-escaped toasts, the numeric filter\'s character class, the allocator cursor, CI permissions, the nightly log), and `vitest` 4 plus `wrangler` 4.139 close all eight Dependabot advisories.',
      ],
    ],
  };
