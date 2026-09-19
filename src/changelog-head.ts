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
    version: '2.1.6',
    date: '2026-09-16',
    kind: 'feature',
    items: [
      [
        '**采样引擎的处理器改为「压缩后发运」：首次访问要下载的东西少了约 20 KB**（那段代码里的注释与空白不再跟着上线），功能与声音一字未改。另外**给外部宿主补上了「按帧寻址的音符事件」**（`noteAt` / `noteOffAt`：可以指定**绝对帧号**，事件就落在那一帧而不是下一个渲染块边界；队列有 1024 的上限；握手消息会告知固定 **128 帧**的起声延迟），并把它写成了**对外契约文档** + 一条「文档与代码必须一致」的防漂移门禁；输入也做了校验——**省略力度按满力度**，**非有限值整条忽略**（以前缺字段会把 NaN 送进引擎，坏帧号还会被当成第 0 帧立刻发声）。**合成器默认的声音没有任何变化。**',
        '**The sampler engine\'s processor now ships minified: a first visit downloads about 20 KB less** (the comments and whitespace in that file no longer travel with it), with no change in behaviour or sound. Also, **external hosts get frame-addressed note events** (`noteAt` / `noteOffAt`: name an **absolute frame** and the note lands on exactly that frame instead of the next render-block boundary; the queue is bounded at 1024; the ready handshake reports the fixed **128-frame** voice-start latency), written up as an **external contract** with a drift gate that keeps the document and the code in step. Input is validated too: **a missing velocity means full velocity**, and **non-finite values drop the whole event** (previously a missing field could send NaN into the engine, and a malformed frame number was treated as frame 0 and sounded immediately). **The synth sounds the same by default.**',
      ],
    ],
  };
