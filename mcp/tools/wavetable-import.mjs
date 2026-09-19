/**
 * `gs1.wavetable.import` — load a single cycle for the wavetable oscillator.
 *
 * The cycle is found by the app's own importer (`decodeCycle` → the
 * autocorrelation in `src/audio/wavefile.ts`), so a file that is one cycle and
 * a file that is a played note are both handled the way the picker handles
 * them. What arrives at the core is exactly `CYCLE_LENGTH` samples; anything
 * longer than `gs_wavetable_capacity()` is refused rather than cut down, and a
 * decoder or core refusal is a structured `E_IMPORT`.
 *
 * Like `gs1.sample.import`, the cycle becomes session state and is replayed
 * into every fresh engine a later `render`/`gate` builds.
 */
import { ex, SR } from '../../scripts/lib/render-core.mjs';
import { readImportBytes, decodeCycle, runWavetableImport, importRefusal } from '../lib/import.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';

export default {
  name: 'gs1.wavetable.import',
  description:
    'Import a wave cycle from a WAV in the repository (`path`) or from base64 (`cycleBase64`) into the wavetable oscillator, using the app\'s own cycle analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, description: 'A WAV inside the repository.' },
      cycleBase64: { type: 'string', minLength: 1, description: 'A base64-encoded WAV holding (or containing) one cycle.' },
      name: { type: 'string', minLength: 1, description: 'Label stored with the cycle (default: the file name).' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const read = readImportBytes(args, { base64Field: 'cycleBase64', kind: 'cycle' });
    const cycle = await decodeCycle(ctx.data, read.bytes);

    const capacity = ex.gs_wavetable_capacity();
    if (cycle.length > capacity) {
      throw fail(
        ERRORS.RANGE,
        `the cycle is ${cycle.length} samples; the core holds at most ${capacity}`,
        {
          field: 'samples',
          value: cycle.length,
          max: capacity,
          hint: 'export a single cycle — this tool refuses rather than truncating',
        },
      );
    }

    const result = runWavetableImport(cycle);
    if (result.code !== 0) {
      throw importRefusal('wavetable', result, { samples: cycle.length });
    }

    const name = args.name ?? read.name;
    ctx.session.wavetable = { name, cycle: new Float32Array(cycle) };
    return {
      ok: true,
      code: 0,
      note: 'ok',
      name,
      source: args.path !== undefined ? 'path' : 'cycleBase64',
      samples: cycle.length,
      capacity,
      seconds: cycle.length / SR,
      installed: 'session wavetable — replayed into every later render/gate',
    };
  },
};
