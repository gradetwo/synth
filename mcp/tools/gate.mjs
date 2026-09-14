/**
 * `gs1.gate` — the same judgement `npm run verify:audio` makes, exposed as a tool.
 *
 * The gate measures an oscillator's non-harmonic floor with a settled, pinned,
 * unmodulated four-second render of one note and two independent rulers. This
 * tool does exactly that: `mcp/lib/measure.mjs`'s `settledFloor` is the gate's
 * own `renderFloor` fixture with the caller's patch, and the numbers come from
 * the gate's own `offGridFloor`/`binMagHann` in `scripts/lib/audio-ruler.mjs`.
 * It reports each pitch's floor and whether it clears the threshold; it does
 * **not** decide a patch is good — that stays with the caller, as §7 says.
 */
import { allocViolations } from '../../scripts/lib/render-core.mjs';
import { settledFloor, hannProbes, DEFAULT_PROBES } from '../lib/measure.mjs';
import { validateRenderSpec } from '../lib/render.mjs';
import { resolvePatch } from '../lib/patch.mjs';
import { distinctNotes } from '../lib/measure.mjs';
import { renderFields, patchRef } from './_schemas.mjs';

/** The P9.1b acceptance line: 1 kHz-and-up non-harmonic energy at or below -60 dB. */
export const DEFAULT_THRESHOLD_DB = -60;

export default {
  name: 'gs1.gate',
  description:
    'Measure per-pitch non-harmonic floors with the verify:audio rulers (BH-7 off-grid floor and/or Hann gap probes) and report whether each pitch clears a threshold. Same implementation as the gate.',
  inputSchema: {
    type: 'object',
    properties: {
      ...patchRef,
      notes: renderFields.notes,
      oversample: renderFields.oversample,
      // No `seed`: the gate's fixture pins its own start phase (a fresh core per
      // note), so accepting a seed here would advertise an input that does
      // nothing. `gs1.render` is the seeded entry point.
      ruler: { type: 'string', enum: ['bh7', 'hann', 'both'], description: 'Which ruler(s) to judge with (default bh7).' },
      harmonics: { type: 'integer', minimum: 0, maximum: 64, description: 'BH-7 exclusion half-width in bins (default 8).' },
      thresholdDb: { type: 'number', minimum: -200, maximum: 0, description: 'The line to clear (default -60).' },
      probes: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: { type: 'number', minimum: 1, maximum: 24000 },
        description: 'Hann probe frequencies; defaults to the gate\'s C7 set [9000, 9200, 9500].',
      },
    },
    required: ['notes'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const spec = validateRenderSpec({ seconds: 2, ...args });
    const payload = await resolvePatch(ctx.data, args, ctx.session);
    const ruler = args.ruler ?? 'bh7';
    const bins = args.harmonics ?? 8;
    const thresholdDb = args.thresholdDb ?? DEFAULT_THRESHOLD_DB;
    const useBh7 = ruler === 'bh7' || ruler === 'both';
    const useHann = ruler === 'hann' || ruler === 'both';
    const probes = args.probes ?? DEFAULT_PROBES;

    let nonFinite = 0;
    const perNote = distinctNotes(spec.notes).map((note) => {
      const settled = settledFloor(payload, note, bins, spec.oversample, ctx.session);
      for (let i = 0; i < settled.samples.length; i++) {
        if (!Number.isFinite(settled.samples[i])) nonFinite += 1;
      }
      const entry = { note, f0: settled.f0 };
      if (useBh7) {
        entry.bh7 = {
          ruler: settled.ruler,
          window: settled.window,
          bins: settled.bins,
          floorDb: settled.floorDb,
          passed: settled.floorDb < thresholdDb,
        };
      }
      if (useHann) {
        const second = hannProbes(settled.samples, settled.f0, probes);
        entry.hann = {
          ruler: second.ruler,
          window: second.window,
          probes: second.probes,
          worstDb: second.worstDb,
          passed: second.worstDb < thresholdDb,
        };
      }
      entry.passed = [entry.bh7?.passed, entry.hann?.passed].filter((value) => value !== undefined).every(Boolean);
      return entry;
    });

    return {
      ok: true,
      ruler,
      bins,
      thresholdDb,
      criteria:
        'scripts/lib/audio-ruler.mjs — offGridFloor (7-term Blackman-Harris, ±bins) and/or binMagHann (Hann Goertzel), over the gate\'s settled four-second single-note fixture (scripts/lib/render-core.mjs renderFloor).',
      isGateRuler: true,
      perNote,
      worstBh7Db: useBh7 ? Math.max(...perNote.map((entry) => entry.bh7.floorDb)) : null,
      worstHannDb: useHann ? Math.max(...perNote.map((entry) => entry.hann.worstDb)) : null,
      passed: perNote.every((entry) => entry.passed),
      nonFinite,
      allocViolations: allocViolations(),
    };
  },
};
