/**
 * Audition gate for the P12.2 showcase patches.
 *
 * `verify-presets` fingerprints what a preset sounds like against a recorded
 * baseline, and `preset-loudness` keeps the bank's levels together. Neither one
 * answers the question this batch asks: does a patch that was written *to
 * demonstrate an engine feature* actually reach that feature and make a sound?
 * A typo in a parameter id, a feature id that needs a second switch, a filter
 * that never opens — all three would still produce a number in the fingerprint
 * file, and a silent patch is within any loudness spread.
 *
 * So for every P12.2 preset this test renders a fixed phrase through the real
 * wasm and asserts:
 *   1. it makes sound (RMS above the floor, peak above the floor);
 *   2. every sample is finite and none reaches the limiter's own ceiling;
 *   3. the capability it exists to show is actually switched on in the patch;
 *   4. switching that capability *off* changes the rendered samples — the id is
 *      in the signal path, not merely set to a value the engine ignores.
 * (4) is the one that matters: it is the difference between "the parameter is
 * 1" and "the 2x path / the crusher / the graph edge is what you are hearing".
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTORY_PRESETS, presetParams, type Preset } from '@/state/presets';
import { Param } from '@/audio/params';

const wasmPath = 'src/generated/synth_core.wasm';
const SR = 48_000;
const BLOCK = 128;
const SECONDS = 1.8;

/**
 * A chord for the pads and keys, a held low note for the basses. The same shape
 * the fingerprint gate uses, so a patch that is audible here is audible there.
 */
const PHRASE: [number, number, number][] = [
  [60, 0.0, 0.7],
  [64, 0.0, 0.7],
  [67, 0.0, 0.7],
  [55, 0.8, 0.9],
];

/** The P12.2 patches and the capability each one is here to demonstrate. */
const SHOWCASE: {
  id: string;
  capability: 'sem' | 'crush' | 'oversample' | 'graph';
  /** What switching the capability off means for this patch. */
  off: Record<number, number>;
}[] = [
  { id: 'semmorph', capability: 'sem', off: { [Param.FILTER_TYPE]: 0, [Param.FILTER2_TYPE]: 0 } },
  { id: 'semparabass', capability: 'sem', off: { [Param.FILTER_TYPE]: 0, [Param.FILTER2_TYPE]: 0 } },
  { id: 'semnotch', capability: 'sem', off: { [Param.FILTER_TYPE]: 0 } },
  { id: 'crushlead', capability: 'crush', off: { [Param.FX_CRUSH_ON]: 0 } },
  { id: 'crushbass', capability: 'crush', off: { [Param.FX_CRUSH_ON]: 0 } },
  { id: 'tapecrush', capability: 'crush', off: { [Param.FX_CRUSH_ON]: 0 } },
  { id: 'osdrive', capability: 'oversample', off: { [Param.OVERSAMPLE]: 0 } },
  { id: 'osbass', capability: 'oversample', off: { [Param.OVERSAMPLE]: 0 } },
  { id: 'graphpump', capability: 'graph', off: { [Param.FX_GRAPH]: 0 } },
  { id: 'graphswell', capability: 'graph', off: { [Param.FX_GRAPH]: 0 } },
];

interface Core {
  memory: WebAssembly.Memory;
  gs_init(sr: number, poly: number): void;
  gs_set_param(id: number, value: number): void;
  gs_note_on(note: number, velocity: number): void;
  gs_note_off(note: number): void;
  gs_process(frames: number): void;
  gs_left_ptr(): number;
  gs_nan_events(): number;
}

interface Audition {
  rms: number;
  db: number;
  peak: number;
  overUnity: number;
  nonFinite: number;
  nan: number;
  out: Float32Array;
}

/** Render `params` through the real core and measure the left channel. */
function render(
  params: Record<number, number>,
  phrase: [number, number, number][] = PHRASE,
  seconds = SECONDS,
  velocity = 0.9,
): Audition {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
    .exports as unknown as Core;
  ex.gs_init(SR, 16);
  for (const [id, value] of Object.entries(params)) ex.gs_set_param(Number(id), value);

  const events: [number, boolean, number][] = [];
  for (const [note, start, length] of phrase) {
    events.push([start * SR, true, note]);
    events.push([(start + length) * SR, false, note]);
  }
  events.sort((a, b) => a[0] - b[0]);

  const frames = Math.round(seconds * SR);
  const out = new Float32Array(frames);
  const left = ex.gs_left_ptr() / 4;
  let cursor = 0;
  let offset = 0;
  for (let block = 0; block * BLOCK < frames; block++) {
    while (cursor < events.length && events[cursor][0] < (block + 1) * BLOCK) {
      const [, on, note] = events[cursor++];
      if (on) ex.gs_note_on(note, velocity);
      else ex.gs_note_off(note);
    }
    ex.gs_process(BLOCK);
    const heap = new Float32Array(ex.memory.buffer);
    const count = Math.min(BLOCK, frames - offset);
    out.set(heap.subarray(left, left + count), offset);
    offset += count;
  }

  let sum = 0;
  let peak = 0;
  let overUnity = 0;
  let nonFinite = 0;
  for (const v of out) {
    if (!Number.isFinite(v)) {
      nonFinite++;
      continue;
    }
    sum += v * v;
    const magnitude = Math.abs(v);
    peak = Math.max(peak, magnitude);
    if (magnitude > 0.99) overUnity++;
  }
  const rms = Math.sqrt(sum / out.length);
  return {
    rms,
    db: 20 * Math.log10(rms + 1e-12),
    peak,
    overUnity,
    nonFinite,
    nan: ex.gs_nan_events(),
    out,
  };
}

/** Largest sample-to-sample move between two renders of the same phrase. */
function maxDifference(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

const paramsOf = (id: string): Record<number, number> => {
  const preset = FACTORY_PRESETS.find((p: Preset) => p.id === id);
  if (!preset) throw new Error(`unknown showcase preset ${id}`);
  return presetParams(preset);
};

/**
 * One middle C at full velocity, held for exactly as long as the existing
 * `worklet-processor.test.ts` guard holds it: `min(attack + max(decay, 0.05),
 * 1.5) + 0.15` seconds.
 *
 * This case is the point. The gate used to render a chord plus a low note, and
 * a chord hides a patch that only reaches a usable level when notes stack: the
 * original `crushbass` peaked at 0.088 through the chord but 0.0020 on a single
 * middle C, because a 4-bit crusher's LSB sat above the patch's pre-effect
 * level and quantised the wet path to silence. Same window as the existing
 * guard, so the two gates cannot disagree about what "silent" means.
 */
function singleNote(params: Record<number, number>): Audition {
  const attack = params[Param.ENV_ATTACK] ?? 0;
  const decay = params[Param.ENV_DECAY] ?? 0;
  const seconds = Math.min(attack + Math.max(decay, 0.05), 1.5) + 0.15;
  return render(params, [[60, 0, seconds]], seconds, 1);
}

/**
 * The floor the existing all-preset guard uses on this same single-note case:
 * below it a patch is inaudible on a phone speaker.
 */
const SILENT_PEAK = 0.003;

/**
 * The chord's own RMS floor, raised from 1e-4 (-80 dBFS, which let a -59 dBFS
 * patch through) to 1e-3 (-60 dBFS). That is still ~19 dB below the bank's
 * -40.9 dBFS median, so no healthy patch can trip it, while a patch that is
 * only leaking dry signal is caught.
 */
const SILENT_RMS = 1e-3;

describe.skipIf(!existsSync(wasmPath))('P12.2 preset audition', () => {
  it.each(SHOWCASE)('$id makes a clean sound', ({ id }) => {
    const params = paramsOf(id);
    const chord = render(params);
    const note = singleNote(params);
    console.log(
      `[audition] ${id.padEnd(12)} chord ${chord.db.toFixed(1)} dBFS · peak ${chord.peak.toFixed(3)} · ` +
        `single C peak ${note.peak.toFixed(4)} · >1.0 ${chord.overUnity} · nan ${chord.nan}/${note.nan}`,
    );
    // (1) It really sounds - on a single note as well as on a chord.
    expect(note.peak, `${id} is silent on a single middle C`).toBeGreaterThanOrEqual(SILENT_PEAK);
    expect(note.rms, `${id} is silent on a single middle C`).toBeGreaterThan(SILENT_RMS);
    expect(chord.rms, `${id} is silent`).toBeGreaterThan(SILENT_RMS);
    expect(chord.peak, `${id} has no peak`).toBeGreaterThanOrEqual(SILENT_PEAK);
    // (2) Finite and nowhere near the limiter.
    expect(chord.nan + note.nan, `${id} produced NaN`).toBe(0);
    expect(chord.nonFinite + note.nonFinite, `${id} produced a non-finite sample`).toBe(0);
    expect(chord.overUnity + note.overUnity, `${id} clips`).toBe(0);
    expect(Math.max(chord.peak, note.peak), `${id} peak`).toBeLessThanOrEqual(1.0);
  });

  it.each(SHOWCASE)('$id actually engages $capability', ({ id, capability, off }) => {
    const on = paramsOf(id);
    // (3) The patch carries the switch the capability needs.
    switch (capability) {
      case 'sem':
        expect(on[Param.FILTER_TYPE], `${id} filter type`).toBe(6);
        break;
      case 'crush':
        expect(on[Param.FX_CRUSH_ON], `${id} crush on`).toBe(1);
        break;
      case 'oversample':
        expect(on[Param.OVERSAMPLE], `${id} oversample`).toBe(1);
        break;
      case 'graph':
        expect(on[Param.FX_GRAPH], `${id} graph`).toBe(1);
        expect(
          [0, 1, 2, 3].some(
            (edge) =>
              on[Param.FX_MOD1_SRC + edge * 3] !== 0 &&
              on[Param.FX_MOD1_DST + edge * 3] !== 0 &&
              on[Param.FX_MOD1_DEPTH + edge * 3] !== 0,
          ),
          `${id} has no live in-graph edge`,
        ).toBe(true);
        break;
    }
    // (4) Switching it off changes what comes out: the id is in the signal path.
    const withCapability = render(on);
    const without = render({ ...on, ...off });
    const difference = maxDifference(withCapability.out, without.out);
    console.log(`[audition] ${id.padEnd(12)} ${capability} off -> max sample diff ${difference.toExponential(2)}`);
    expect(difference, `${id}: switching ${capability} off changed nothing`).toBeGreaterThan(1e-4);
  });
});
