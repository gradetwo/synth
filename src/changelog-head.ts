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
    version: '2.1.8',
    date: '2026-09-27',
    kind: 'feature',
    items: [
      [
        '**给外部 agent 补上两件工具、放宽渲染的输入与上限，并修好「强制降级其实没释放」。** `gs1.render` 现在三选一：音符列表、内置曲的 `songId`、或 base64 的 MIDI 文件——后两条把一段编曲从几十 KB JSON 变成几 KB；单次渲染上限 30 → **120 秒**、音符 512 → **4096**（旧上限其实会拒绝几乎所有内置曲）。新增 `gs1.patch.morph`：`warmth` / `air` / `brightness` / `width` / `softness`，每个只动三四个参数并如实返回动前动后；新增 `gs1.patch.undo`，写入可以逐步退回。音频侧：被复音上限挤掉的声部原先按**预设自己的 release** 收尾，于是「强制释放」可能几秒内什么都没释放——现在和窃音一样走 50 ms 淡出。**默认声音与 91 条预设指纹未变。**',
        '**Two more tools for external agents, wider render inputs and limits, and a fix for a force-release that did not release.** `gs1.render` now takes exactly one of a note list, a built-in song by `songId`, or a standard MIDI file as base64 — the last two turn an arrangement from tens of KB of JSON into a few KB. The render cap goes 30 -> **120 seconds** and 512 -> **4096 notes** (the old cap rejected nearly every built-in song). New `gs1.patch.morph`: `warmth` / `air` / `brightness` / `width` / `softness`, each moving three or four parameters and returning every before/after it touched; new `gs1.patch.undo` steps back through writes. On the audio side, a voice pushed out by the polyphony cap used to finish on the **patch\'s own** release, so a "force release" could free nothing for seconds; it now fades over 50 ms like a steal. **The default sound and all 91 preset fingerprints are unchanged.**',
      ],
    ],
  };
