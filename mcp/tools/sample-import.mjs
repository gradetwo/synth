/**
 * `gs1.sample.import` — load a recorded sound into the sampler oscillator.
 *
 * `docs/LLM-INTERFACE.md` §4.2's contract, with the two rules P9.8 insists on:
 *
 *   * **no silent truncation** — a file longer than `MAX_BASE_SAMPLES`
 *     (`gs_sample_capacity()`) is an `E_RANGE` naming the limit, not a
 *     `subarray(0, capacity)` that would make the agent measure a different
 *     sound than it handed over;
 *   * **the core's verdict is passed through** — `gs_sample_import`'s
 *     `noRoom = 4` (and 1/2/3) come back as an `E_IMPORT` rejection carrying
 *     `importCode` and `note`, never as a crash and never as a partial load.
 *
 * The active decoder is the app's own (`src/audio/wavefile.ts`), so a WAV this
 * tool accepts is a WAV the file picker accepts and vice versa. The imported
 * sample becomes the session's instrument; every later `render`/`gate` replays
 * it into its fresh engine.
 */
import { ex, arenaFreeBytes } from '../../scripts/lib/render-core.mjs';
import { readImportBytes, decodeSample, runSampleImport, importRefusal } from '../lib/import.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';

export default {
  name: 'gs1.sample.import',
  description:
    'Import a WAV from the repository (`path`) or from base64 (`wavBase64`) into the sampler. Refuses files longer than MAX_BASE_SAMPLES and passes the core\'s P9.8 verdict through (noRoom = 4).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, description: 'A WAV inside the repository.' },
      wavBase64: { type: 'string', minLength: 1, description: 'A base64-encoded WAV (RIFF/WAVE PCM).' },
      name: { type: 'string', minLength: 1, description: 'Label stored with the sample (default: the file name).' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const read = readImportBytes(args, { base64Field: 'wavBase64', kind: 'sample' });
    const decoded = await decodeSample(ctx.data, read.bytes);

    // The limit is the engine's own (`MAX_BASE_SAMPLES` through the ABI), and it
    // is checked *before* staging: the browser would truncate here, an agent
    // must be told instead.
    const capacity = ex.gs_sample_capacity();
    if (decoded.samples.length > capacity) {
      throw fail(
        ERRORS.RANGE,
        `the sample is ${decoded.samples.length} samples; the core holds at most ${capacity} (MAX_BASE_SAMPLES)`,
        {
          field: 'samples',
          value: decoded.samples.length,
          max: capacity,
          sampleRate: decoded.sampleRate,
          hint: 'trim or resample the file — this tool refuses rather than truncating',
        },
      );
    }

    const result = runSampleImport(decoded.samples, decoded.sampleRate);
    if (result.code !== 0) {
      throw importRefusal('sample', result, {
        samples: decoded.samples.length,
        sampleRate: decoded.sampleRate,
        poolBytes: result.poolBytes,
      });
    }

    const name = args.name ?? read.name;
    ctx.session.sample = {
      name,
      samples: new Float32Array(decoded.samples),
      sampleRate: decoded.sampleRate,
      code: 0,
      poolBytes: result.poolBytes,
    };
    return {
      ok: true,
      code: 0,
      note: 'ok',
      name,
      source: args.path !== undefined ? 'path' : 'wavBase64',
      samples: decoded.samples.length,
      sampleRate: decoded.sampleRate,
      seconds: decoded.samples.length / decoded.sampleRate,
      capacity,
      /** Arena bytes this import added; 0 when the pool was already big enough. */
      poolBytes: result.poolBytes,
      arenaFreeBytes: arenaFreeBytes(),
      installed: 'session sample — replayed into every later render/gate',
    };
  },
};
