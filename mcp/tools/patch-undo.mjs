/**
 * `gs1.patch.undo` — step the session's patch back one write.
 *
 * The tool surface had no way back: `patch.set`, `patch.random`, `preset.apply`
 * and `patch.morph` all overwrite "the session's current patch", and an agent
 * that got one wrong could only re-derive what was there before. The app has its
 * own undo stack, but nothing exposed one (see `lib/session.mjs`).
 *
 * An empty history is **not** an error. "Undo when there is nothing to undo" is a
 * no-op, not a malformed request, so it comes back as `undone: false` with the
 * patch unchanged and the depth reported — a caller looping on `undoDepth > 0`
 * never has to special-case the last step.
 */
import { resolvePatch, patchSummary, commitPatch } from '../lib/patch.mjs';
import { popUndo, UNDO_LIMIT } from '../lib/session.mjs';

export default {
  name: 'gs1.patch.undo',
  description:
    'Undo the last write to the session patch (patch.set / patch.random / preset.apply / patch.morph), restoring the patch that was replaced. Reports the remaining undo depth; an empty history is a no-op, not an error.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (_args, ctx) => {
    const history = ctx.session.history ?? [];
    if (history.length === 0) {
      return {
        ok: true,
        undone: false,
        reason: 'the session has no patch writes to undo',
        undoDepth: 0,
        undoLimit: UNDO_LIMIT,
        source: 'session',
        patch: ctx.session.patch
          ? { params: ctx.session.patch.params, routes: ctx.session.patch.routes }
          : null,
        shareCode: ctx.session.patch?.shareCode ?? null,
      };
    }

    const restored = popUndo(ctx.session);
    if (restored === null) {
      // The write being undone was made against the *default* patch, so undoing
      // it means "there is no session patch again" — which is a real state, and
      // the one `patch.get` reported before that write. The default is resolved
      // and described rather than returned as a bare null, so the caller sees the
      // patch it is now playing.
      ctx.session.patch = null;
      const fallback = await resolvePatch(ctx.data, {});
      return {
        ok: true,
        undone: true,
        restoredTo: 'default',
        undoDepth: (ctx.session.history ?? []).length,
        undoLimit: UNDO_LIMIT,
        source: 'default',
        shareCode: fallback.shareCode,
        summary: patchSummary({ ...fallback }),
        patch: {
          params: fallback.params,
          params2: fallback.params2 ?? null,
          instanceMode: fallback.instanceMode ?? null,
          splitNote: fallback.splitNote ?? null,
          routes: fallback.routes,
        },
      };
    }

    // The snapshot is a full payload, so re-committing it recomputes the share
    // code from the same numbers rather than carrying a stale string.
    const result = commitPatch(
      ctx,
      {
        params: restored.params,
        params2: restored.params2,
        instanceMode: restored.instanceMode,
        splitNote: restored.splitNote,
        routes: restored.routes,
        presetId: restored.presetId,
      },
      { applied: 'undo' },
    );
    // `commitPatch` pushed this undo onto the history it just popped from; the
    // undo itself is not a step to come back to, so drop it again.
    ctx.session.history?.pop();
    return {
      ...result,
      undone: true,
      restoredTo: 'previous',
      undoDepth: (ctx.session.history ?? []).length,
      undoLimit: UNDO_LIMIT,
    };
  },
};
