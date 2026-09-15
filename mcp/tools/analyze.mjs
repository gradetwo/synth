/**
 * `gs1.analyze` — measure a render (or a WAV on disk) with the repository's own
 * rulers.
 *
 * Both rulers are `scripts/lib/audio-ruler.mjs`, the modules `verify:audio`
 * asserts with:
 *
 *   * `bh7` — a 7-term Blackman-Harris transform over the whole buffer, ±`bins`
 *     bins excluded around every harmonic (`offGridFloor`);
 *   * `hann-goertzel` — a single-frequency Hann read at caller-chosen probe
 *     frequencies, reported relative to the fundamental (`binMagHann`).
 *
 * Every number in the result is labelled with the ruler that produced it, and
 * `nonFinite`/`allocViolations` are always present (`docs/LLM-INTERFACE.md`
 * §4.3). `allocViolations` is `null` for a `wavPath` source, because a file on
 * disk carries no engine to ask.
 */
import { readFileSync } from 'node:fs';
import { decodeWavBytes } from '../lib/wav.mjs';
import { validateRenderSpec, renderChannels, noteHz } from '../lib/render.mjs';
import { resolvePatch } from '../lib/patch.mjs';
import { resolveReadPath, repoPath } from '../lib/paths.mjs';
import { bh7Floor, hannProbes, thd, interHarmonic, BH7, HANN, DEFAULT_PROBES, distinctNotes, RULER_SAMPLE_RATE } from '../lib/measure.mjs';
import { BLOCK } from '../../scripts/lib/render-core.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';

const countNonFinite = (samples) => {
  let bad = 0;
  for (let i = 0; i < samples.length; i++) if (!Number.isFinite(samples[i])) bad += 1;
  return bad;
};

export default {
  name: 'gs1.analyze',
  description:
    'Measure a render spec or an existing WAV: time-domain peak/rms/maxStep, the BH-7 off-grid floor and the Hann gap ruler, each labelled with the ruler that produced it, plus nonFinite and allocViolations.',
  inputSchema: {
    type: 'object',
    properties: {
      wavPath: { type: 'string', description: 'A WAV inside the repository (e.g. one gs1.render just wrote).' },
      render: {
        type: 'object',
        description: 'The same spec gs1.render takes; analyzed in memory without touching disk.',
      },
      f0: { type: 'number', minimum: 1, maximum: 24000, description: 'Fundamental in Hz for the rulers.' },
      note: { type: 'integer', minimum: 0, maximum: 127, description: 'Alternative to f0: the MIDI note whose f0 to use.' },
      bins: { type: 'integer', minimum: 0, maximum: 64, description: 'BH-7 exclusion half-width in bins (default 8, the gate\'s).' },
      probes: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: { type: 'number', minimum: 1, maximum: 24000 },
        description: 'Hann probe frequencies; defaults to the gate\'s C7 set [9000, 9200, 9500].',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const hasFile = args?.wavPath !== undefined;
    const hasRender = args?.render !== undefined;
    if (hasFile === hasRender) {
      throw fail(ERRORS.SCHEMA, 'provide exactly one of `wavPath` or `render`', {
        wavPath: hasFile,
        render: hasRender,
      });
    }

    let samples;
    let source;
    let engineViolations;
    let blocks;
    let spec = null;

    if (hasRender) {
      spec = validateRenderSpec(args.render);
      const payload = await resolvePatch(ctx.data, args.render, ctx.session);
      const channels = renderChannels(ctx.data, spec, payload, ctx.session);
      samples = channels.left;
      source = 'render';
      blocks = channels.blocks;
      engineViolations = channels.allocViolations;
    } else {
      const absolute = resolveReadPath(args.wavPath);
      let file;
      try {
        file = readFileSync(absolute);
      } catch (error) {
        throw fail(ERRORS.WAV, `cannot read WAV: ${error?.message ?? error}`, { wavPath: args.wavPath });
      }
      const decoded = decodeWavBytes(ctx.data, file);
      if (!decoded) throw fail(ERRORS.WAV, 'file is not a RIFF/WAVE PCM file this repo can read', { wavPath: args.wavPath });
      if (decoded.sampleRate !== RULER_SAMPLE_RATE) {
        throw fail(ERRORS.SAMPLE_RATE, `WAV is ${decoded.sampleRate} Hz; the rulers are calibrated at 48 kHz`, {
          wavPath: args.wavPath,
          sampleRate: decoded.sampleRate,
        });
      }
      samples = decoded.samples;
      source = `wav:${repoPath(absolute)}`;
      blocks = Math.floor(samples.length / BLOCK);
      engineViolations = null;
    }

    const specNotes = spec ? distinctNotes(spec.notes) : [];
    const primaryF0 =
      args.f0 ??
      (args.note !== undefined ? noteHz(args.note) : undefined) ??
      (specNotes.length ? noteHz(specNotes[0]) : undefined) ??
      null;
    if (!(primaryF0 > 0)) {
      throw fail(ERRORS.SCHEMA, 'a fundamental is required for a WAV source: pass `f0` or `note`', {
        field: 'f0',
      });
    }

    const bins = args.bins ?? 8;
    const noteList = hasRender ? specNotes : [args.note ?? null];
    const perNote = noteList.map((note) => {
      const f0 = note === null ? primaryF0 : noteHz(note);
      return { note, f0, floorDb: bh7Floor(samples, f0, bins).floorDb };
    });
    const second = hannProbes(samples, primaryF0, args.probes ?? DEFAULT_PROBES);

    return {
      ok: true,
      source,
      sampleRate: RULER_SAMPLE_RATE,
      seconds: samples.length / RULER_SAMPLE_RATE,
      blocks,
      frames: samples.length,
      time: {
        ruler: 'time-domain-float',
        peak: samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
        rms: Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(samples.length, 1)),
        maxStep: samples.reduce((max, value, index) => (index ? Math.max(max, Math.abs(value - samples[index - 1])) : max), 0),
      },
      aliasing: {
        ...BH7,
        bins,
        perNote,
        worstDb: Math.max(...perNote.map((entry) => entry.floorDb)),
      },
      secondRuler: second,
      thd: thd(samples, primaryF0),
      interHarmonic: interHarmonic(samples, primaryF0),
      /** Present once, so a client can tell which ruler the two blocks above are. */
      rulers: { bh7: BH7, second: HANN },
      nonFinite: countNonFinite(samples),
      allocViolations: engineViolations,
    };
  },
};
