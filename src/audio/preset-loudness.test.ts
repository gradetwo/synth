import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTORY_PRESETS, presetParams } from '@/state/presets';

const wasmPath = 'src/generated/synth_core.wasm';
const SR = 48_000;

/** A fixed phrase: a chord, four single notes, then a held note. */
const PHRASE: [number, number, number][] = [
  [48, 0.0, 0.9], [55, 0.0, 0.9], [60, 0.0, 0.9], [64, 0.0, 0.9],
  [67, 1.0, 0.4], [65, 1.5, 0.4], [64, 1.9, 0.4], [62, 2.3, 0.4],
  [60, 2.8, 1.4],
];

interface Core {
  memory: WebAssembly.Memory;
  gs_init(sr: number, poly: number): void;
  gs_set_param(id: number, value: number): void;
  gs_note_on(note: number, velocity: number): void;
  gs_note_off(note: number): void;
  gs_process(frames: number): void;
  gs_left_ptr(): number;
}

/** RMS of the phrase, in dBFS — a cheap stand-in for perceived loudness. */
function phraseLoudness(params: Record<number, number>): { db: number; peak: number } {
  const ex = new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(wasmPath)),
    {},
  ).exports as unknown as Core;
  ex.gs_init(SR, 16);
  for (const [id, value] of Object.entries(params)) ex.gs_set_param(Number(id), value);
  const events: [number, boolean, number][] = [];
  for (const [note, start, length] of PHRASE) {
    events.push([start * SR, true, note]);
    events.push([(start + length) * SR, false, note]);
  }
  events.sort((a, b) => a[0] - b[0]);
  const blocks = Math.ceil((5 * SR) / 128);
  const left = ex.gs_left_ptr() / 4;
  let cursor = 0;
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (let block = 0; block < blocks; block++) {
    while (cursor < events.length && events[cursor][0] < (block + 1) * 128) {
      const [, on, note] = events[cursor++];
      if (on) ex.gs_note_on(note, 0.9);
      else ex.gs_note_off(note);
    }
    ex.gs_process(128);
    const heap = new Float32Array(ex.memory.buffer);
    for (let i = 0; i < 128; i++) {
      const v = heap[left + i];
      sum += v * v;
      count++;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return { db: 20 * Math.log10(Math.sqrt(sum / count) + 1e-12), peak };
}

// Every factory preset is rendered through WASM in one synchronous pass, so the
// event loop never gets a turn and a timeout cannot preempt it — vitest 4
// measures the elapsed time anyway, and that pass runs past the 30 s default
// (vitest.config.ts). The suite says its own budget out loud instead of
// loosening the global one for every test.
describe.skipIf(!existsSync(wasmPath))('preset loudness', { timeout: 120_000 }, () => {
  it('keeps every factory preset within a few dB of the others', () => {
    const levels = FACTORY_PRESETS.map((preset) => {
      const measured = phraseLoudness(presetParams(preset));
      return { id: preset.id, db: measured.db, peak: measured.peak };
    });
    const sorted = [...levels].sort((a, b) => a.db - b.db);
    const quietest = sorted[0];
    const loudest = sorted[sorted.length - 1];
    const spread = loudest.db - quietest.db;
    // Printed so a failing run says which patch to trim.
    const report = sorted
      .map((entry) => `${entry.id} ${entry.db.toFixed(1)}`)
      .join(' · ');
    console.log(`[loudness] spread ${spread.toFixed(1)} dB — ${report}`);
    if (process.env.TRIM_DUMP) {
      writeFileSync(
        '.tmp/loudness.json',
        JSON.stringify(levels, null, 1),
      );
    }
    // Achieved 8.1 dB after the +6 dB pass (docs/notes/loudness.md); the 6.0 dB
    // this comment used to quote was an earlier snapshot, and before the pass the
    // spread was 47 dB. The gate allows a little slack so ordinary patch edits do
    // not fail the build, while still catching a jump.
    expect(spread).toBeLessThan(9.0);
  });
});
