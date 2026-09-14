/**
 * `gs1.render` — a patch plus a performance, rendered to a WAV.
 *
 * The driver is `mcp/lib/render.mjs`, which is a thin spec adapter over
 * `scripts/lib/render-core.mjs`. The WAV is written by the app's own
 * `encodeWavBuffer`, and `sha256` is over those exact bytes so a caller can
 * verify it got the file the tool says it wrote.
 */
import { writeFileSync } from 'node:fs';
import { validateRenderSpec, renderChannels, wavSha256 } from '../lib/render.mjs';
import { resolvePatch, patchSummary } from '../lib/patch.mjs';
import { resolveOutputPath, repoPath } from '../lib/paths.mjs';
import { renderFields, patchRef } from './_schemas.mjs';

export default {
  name: 'gs1.render',
  description:
    'Render a patch and a note list through the real WASM core to a 16-bit stereo WAV under .tmp/mcp/, returning the path, peak/rms and the WAV sha256. Deterministic for a given (patch, notes, seconds, seed).',
  inputSchema: {
    type: 'object',
    properties: { ...patchRef, ...renderFields },
    required: ['notes'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const spec = validateRenderSpec(args);
    // Check the write boundary *before* spending seconds in the DSP: a rejected
    // path should be cheap.
    const requested = args.outPath === undefined ? null : resolveOutputPath(args.outPath);
    const payload = await resolvePatch(ctx.data, args, ctx.session);
    const channels = renderChannels(ctx.data, spec, payload, ctx.session);
    const { bytes, sha256, byteLength } = wavSha256(ctx.data, channels, spec.sampleRate);
    const absolute = requested ?? resolveOutputPath(null, `${sha256.slice(0, 16)}.wav`);
    writeFileSync(absolute, bytes);
    return {
      ok: true,
      wavPath: repoPath(absolute),
      sha256,
      byteLength,
      samples: channels.frames,
      channels: 2,
      sampleRate: spec.sampleRate,
      seconds: spec.seconds,
      blocks: channels.blocks,
      seed: spec.seed,
      oversample: spec.oversample,
      /** Time-domain facts about the float render, before 16-bit quantisation. */
      time: {
        ruler: 'time-domain-float',
        peak: channels.peak,
        rms: channels.rms,
        maxStep: channels.maxStep,
      },
      nonFinite: channels.nonFinite,
      allocViolations: channels.allocViolations,
      patch: {
        ...patchSummary(payload),
        // A layered patch is read, but `gs1.render` v1 plays instance A only.
        layersRendered: payload.params2 ? 'instance A only' : 'single',
      },
    };
  },
};
