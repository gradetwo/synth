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
        '**几个能听见的毛病修好了。** ① **每个音符事件处的爆音**：一个渲染块被切开时，输出缓冲只留下了最后一个子块，而块正好切在定时音符落下的那一帧——于是每次 note-off 后面都跟着一个宽频阶跃（UK Garage 主音上最明显）；现在每个子块都按顺序写回。② **同一个键连点两下会没声或只响一小截**：旧的 note-off 还排在新 note-on 后面，把刚起声的新音又放掉了；重按现在会顶掉同一个键上尚未触发的旧释放。③ **被抢的声部淡出由 20 ms 加长到 50 ms**，持续音被抢时不再有咔哒声（**这是本版唯一的音色变动**：`futurechord` 是唯一会触发抢声部的出厂预设，它的指纹已按流程重录并写明理由）。④ **定时音符改用音频上下文的时间轴**，宿主提前排好的音不再整体迟到。',
        '**Several audible defects are fixed.** (1) **A click at every note event**: when a render block was split, the output buffer kept only its last chunk, and a block is split on exactly the frame a timed note lands — so every note-off was followed by a broadband step (worst on the UK Garage lead); each chunk is now written back in order. (2) **Tapping the same key twice went silent or played a fragment**: the old note-off stayed queued behind the new note-on and released the note that had just started; re-pressing now supersedes an untriggered release on the same key. (3) **A stolen voice now fades over 50 ms instead of 20**, so stealing a sounding note no longer clicks (**this is the release\'s only timbre change**: `futurechord` is the one factory preset that steals a voice, and its fingerprint was re-recorded with a written reason). (4) **Timed notes are addressed in the audio context\'s timeline**, so a host that schedules ahead no longer has every event arrive late.',
      ],
      [
        '**给外部宿主补上 ABI 9 和逐音微分音。** 新增两个导出：`gs_note_bend`（逐音弯音，引擎钳到 ±48 半音）和 `gs_set_tuning_note`（逐键微分音，钳到 ±1200 音分）。同时 `noteAt` / `noteOnAt` / `noteOn` / `noteOnPan` 现在可以带 `cents`：微分音和它所属的音符在**同一帧、同一条事件**里生效，不再有「先把键改了音、音符才到」的次序问题；契约文档与防漂移门禁同步更新。',
        '**Hosts get ABI 9 and per-note microtuning.** Two exports are new: `gs_note_bend` (per-note bend, clamped by the engine to +-48 semitones) and `gs_set_tuning_note` (per-key microtuning, clamped to +-1200 cents). `noteAt` / `noteOnAt` / `noteOn` / `noteOnPan` also accept `cents` now, applied in the **same frame and the same event** as the note it belongs to, so a host no longer has to retune a key before the note arrives. The contract documents and their drift gate moved with them.',
      ],
      [
        '**安全加固：GitHub Code Scanning 的九条告警全部清零。** toast 不再用「正则删标签 + `dangerouslySetInnerHTML`」，而是把消息切成文本片段、只把 `<b>` 渲染成真正的元素，转义交给 React（旧写法遇到没有闭合 `>` 的 `<script` 会原样留下）。数值输入的正则字符类里 `+-e` 曾被解析成一个范围，`,` 到 `e` 之间的 `A-Z`、`:`、`/` 等字符因此没有过滤掉。分配器的空闲链表游标改用 `Option` 而不是空指针。CI 工作流显式声明 `permissions: contents: read`；nightly 的进度日志不再回读 env 对象。',
        '**Security hardening: all nine GitHub Code Scanning alerts are closed.** The toast no longer strips tags with a regex and injects the result through `dangerouslySetInnerHTML`; the message is split into text runs and only `<b>` becomes a real element, with React doing the escaping (the old pattern left `<script` intact whenever the input had no closing `>`). In the numeric input\'s character class, `+-e` parsed as a range, so `A-Z`, `:`, `/` and everything between them was never stripped. The allocator\'s free-list cursor is an `Option` rather than a null pointer, the CI workflow declares `permissions: contents: read`, and the nightly progress log no longer reads its port back out of an environment object.',
      ],
      [
        '**依赖与流水线。** `vitest` 升到 4、`wrangler` 升到 4.139，Dependabot 的 8 条告警（1 critical、2 high、5 moderate）全部关闭。PWA 缓存匹配加上 `ignoreVary`，修掉偶发的「离线重载后一启动引擎就白屏」。`nightly` 改为三个引擎跑全量套件，视觉基线对比改成只在手动触发时运行。',
        '**Dependencies and pipeline.** `vitest` moved to 4 and `wrangler` to 4.139, closing all eight Dependabot advisories (one critical, two high, five moderate). PWA cache matching gained `ignoreVary`, fixing the intermittent white screen when the engine started after an offline reload. The nightly job now runs the whole suite on all three engines, and the visual-baseline comparison runs on manual dispatch only.',
      ],
    ],
  };
