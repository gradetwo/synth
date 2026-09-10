/**
 * Song-level audio quality check.
 *
 * Renders a real factory patch playing a real built-in song through the WASM
 * core and looks for the things a listener would call "crackle": hard clipping,
 * the limiter working constantly, sample-to-sample steps far larger than the
 * signal's own slope, intermittent high-frequency bursts, or NaN events.
 *
 * This is the harness behind the "Digital Bell + Für Elise" report: the render
 * itself was always clean, but the voice ceiling the load monitor asked for was
 * being undone by the parameter flood, so a device that needed to drop to four
 * voices kept running sixteen and missed its deadlines — which is what a
 * listener hears as crackle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTORY_PRESETS, presetParams } from '@/state/presets';
import { demoSong } from '@/midi/songs';

const wasmPath = 'src/generated/synth_core.wasm';
const hasWasm = existsSync(wasmPath);
const SR = 48_000;
const BLOCK = 128;
/** The soft limiter is transparent below this (see dsp/util.rs). */
const KNEE = 0.82;

/** A 3 kHz sine at 0.5 amplitude steps by ~0.2 between samples. */
const STEP_LIMIT = 0.35;

interface Report {
  costMean: number;
  costPeak: number;
  maxVoices: number;
  meanVoices: number;
  silentBlocks: number;
  fullBlocks: number;
  steals: number;
  peak: number;
  overKnee: number;
  overUnity: number;
  minGain: number;
  meanGain: number;
  maxStep: number;
  bigSteps: number;
  hfMean: number;
  hfPeak: number;
  nan: number;
  allocs: number;
  seconds: number;
}

/** The subset of the core ABI this harness drives. */
interface Core {
  memory: WebAssembly.Memory;
  gs_init(sampleRate: number, polyphony: number): void;
  gs_set_param(id: number, value: number): void;
  gs_note_on(note: number, velocity: number): void;
  gs_note_off(note: number): void;
  gs_process(frames: number): void;
  gs_left_ptr(): number;
  gs_active_voices(): number;
  gs_silent_voice_blocks(): number;
  gs_limit_reduction(): number;
  gs_nan_events(): number;
  gs_alloc_violations(): number;
}

function renderSong(presetId: string, songId: string, poly = 16, sr = SR): Report {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
    .exports as unknown as Core;
  ex.gs_init(sr, poly);
  const preset = FACTORY_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`unknown preset ${presetId}`);
  for (const [id, value] of Object.entries(presetParams(preset))) {
    ex.gs_set_param(Number(id), value);
  }
  const song = demoSong(songId);
  if (!song) throw new Error(`unknown song ${songId}`);

  // Note events in sample order.
  type Ev = { at: number; on: boolean; note: number; velocity: number };
  const events: Ev[] = [];
  for (const note of song.notes) {
    events.push({ at: note.start * sr, on: true, note: note.note, velocity: note.velocity });
    events.push({
      at: (note.start + note.duration) * sr,
      on: false,
      note: note.note,
      velocity: note.velocity,
    });
  }
  events.sort((a, b) => a.at - b.at);

  const leftPtr = ex.gs_left_ptr() / 4;
  const total = Math.ceil((song.duration + 1.5) * sr);
  const blocks = Math.ceil(total / BLOCK);
  // Round up to whole blocks so `set` never runs past the end.
  const out = new Float32Array(blocks * BLOCK);
  let cursor = 0;
  let minGain = 1;
  let gainSum = 0;
  let maxVoices = 0;
  let voiceSum = 0;
  let fullBlocks = 0;
  let steals = 0;
  let prevNotes = new Set<number>();
  let costSum = 0;
  let costPeak = 0;
  let hfMean = 0;
  let hfPeak = 0;
  let blocksMeasured = 0;
  let prev = 0;
  let hf = 0;

  for (let b = 0; b < blocks; b++) {
    while (cursor < events.length && events[cursor].at < (b + 1) * BLOCK) {
      const ev = events[cursor++];
      if (ev.on) ex.gs_note_on(ev.note, ev.velocity);
      else ex.gs_note_off(ev.note);
    }
    const t0 = process.hrtime.bigint();
    ex.gs_process(BLOCK);
    const cost = Number(process.hrtime.bigint() - t0) / 1000;
    costSum += cost;
    costPeak = Math.max(costPeak, cost);
    const heap = new Float32Array(ex.memory.buffer);
    const chunk = heap.subarray(leftPtr, leftPtr + BLOCK);
    out.set(chunk, b * BLOCK);
    // High-frequency energy: a one-pole high-pass at ~8 kHz, tracked per block
    // so an intermittent burst shows up as a spike rather than an average.
    let hfSum = 0;
    for (let i = 0; i < BLOCK; i++) {
      hf += (chunk[i] - hf) * 0.65;
      hfSum += hf * hf;
    }
    const hfBlock = Math.sqrt(hfSum / BLOCK);
    hfMean += hfBlock;
    hfPeak = Math.max(hfPeak, hfBlock);
    blocksMeasured++;
    const gain = ex.gs_limit_reduction();
    minGain = Math.min(minGain, gain);
    gainSum += gain;
    const voices = ex.gs_active_voices();
    maxVoices = Math.max(maxVoices, voices);
    voiceSum += voices;
    if (voices >= poly) fullBlocks++;
    const held = new Set<number>();
    for (const ev of events) {
      if (ev.at <= (b + 1) * BLOCK) {
        if (ev.on) held.add(ev.note);
        else held.delete(ev.note);
      }
    }
    for (const note of held) if (!prevNotes.has(note)) steals++;
    prevNotes = held;
  }

  let peak = 0;
  let overKnee = 0;
  let overUnity = 0;
  let maxStep = 0;
  let bigSteps = 0;
  const measured = blocks * BLOCK;
  for (let i = 0; i < measured; i++) {
    const v = Math.abs(out[i]);
    if (!Number.isFinite(out[i])) continue;
    peak = Math.max(peak, v);
    if (v > KNEE) overKnee++;
    if (v > 0.99) overUnity++;
    if (i > 0) {
      const step = Math.abs(out[i] - prev);
      maxStep = Math.max(maxStep, step);
      // A 3 kHz sine at 0.5 amplitude steps by ~0.2 between samples; anything
      // past 0.35 is a discontinuity, not signal.
      if (step > 0.35) bigSteps++;
    }
    prev = out[i];
  }

  return {
    costMean: costSum / Math.max(1, blocks),
    costPeak,
    maxVoices,
    meanVoices: voiceSum / Math.max(1, blocksMeasured),
    fullBlocks: fullBlocks / Math.max(1, blocksMeasured),
    silentBlocks: ex.gs_silent_voice_blocks(),
    steals,
    peak,
    overKnee: overKnee / measured,
    overUnity: overUnity / measured,
    minGain,
    meanGain: gainSum / Math.max(1, blocksMeasured),
    maxStep,
    bigSteps,
    hfMean: hfMean / Math.max(1, blocksMeasured),
    hfPeak,
    nan: ex.gs_nan_events(),
    allocs: ex.gs_alloc_violations(),
    seconds: total / sr,
  };
}

function expectClean(report: Report) {
  expect(report.nan).toBe(0);
  expect(report.allocs).toBe(0);
  expect(report.peak).toBeLessThanOrEqual(1.0);
  expect(report.overUnity).toBe(0);
  expect(report.bigSteps).toBe(0);
  expect(report.maxStep).toBeLessThan(STEP_LIMIT);
}

const fmt = (r: Report) =>
  [
    `peak ${r.peak.toFixed(3)}`,
    `>knee ${(r.overKnee * 100).toFixed(2)}%`,
    `>1.0 ${(r.overUnity * 100).toFixed(3)}%`,
    `limiter ${r.minGain.toFixed(3)}/${r.meanGain.toFixed(3)}`,
    `maxStep ${r.maxStep.toFixed(3)} (${r.bigSteps})`,
    `hf ${r.hfMean.toFixed(4)}/${r.hfPeak.toFixed(4)}`,
    `voices ${r.meanVoices.toFixed(1)}/${r.maxVoices} full ${(r.fullBlocks * 100).toFixed(0)}% silent ${r.silentBlocks}`,
    `cpu ${((r.costMean / 2667) * 100).toFixed(0)}% avg / ${((r.costPeak / 2667) * 100).toFixed(0)}% peak`,
    `nan ${r.nan}`,
    `allocs ${r.allocs}`,
  ].join(' · ');

describe.skipIf(!hasWasm)('song audio quality', () => {
  it('renders Für Elise on Digital Bell without crackle', () => {
    const report = renderSong('bell', 'elise');
    console.log('[song] bell + elise →', fmt(report));
    expect(report.nan).toBe(0);
    expect(report.peak).toBeLessThanOrEqual(1.0);
    expect(report.overUnity).toBe(0);
    // The patch is four sine oscillators: it has no business producing
    // sample-level discontinuities.
    expect(report.bigSteps).toBe(0);
    expect(report.maxStep).toBeLessThan(0.35);
  });

  it('honours the polyphony a slow device falls back to', () => {
    // The bell patch has a 1.6 s release, so four voices means almost every
    // note steals a slot that is still ringing — the stressed case a phone
    // lands in. The ceiling must actually hold: a parameter flood used to
    // restore sixteen voices behind the load monitor's back.
    for (const poly of [8, 4]) {
      const report = renderSong('bell', 'elise', poly);
      console.log(`[song] bell + elise @${poly} voices →`, fmt(report));
      expect(report.nan).toBe(0);
      expect(report.peak).toBeLessThanOrEqual(1.0);
      expect(report.bigSteps).toBe(0);
      expect(report.maxStep).toBeLessThan(0.35);
      expect(report.maxVoices).toBeLessThanOrEqual(poly);
    }
  });

  it('renders the electric pianos without crackle', () => {
    // Both EP patches have a long release, so Elise keeps the voice pool full
    // and every new note steals a ringing one. That tail is also where the
    // silent-tail fast path earns its keep: without it these patches cost more
    // than twice as much to render (24-27% of a phone's budget in Chromium,
    // 11% with it), which is exactly the margin that decides whether a slow
    // device crackles.
    for (const id of ['epiano', 'rhodes', 'wurli']) {
      const report = renderSong(id, 'elise');
      console.log(`[song] ${id} + elise →`, fmt(report));
      expectClean(report);
      expect(report.silentBlocks).toBeGreaterThan(100);
    }
  });

  it('renders the same patch at 44.1 kHz', () => {
    const report = renderSong('bell', 'elise', 16, 44_100);
    console.log('[song] bell + elise @44.1k →', fmt(report));
    expect(report.nan).toBe(0);
    expect(report.bigSteps).toBe(0);
  });

  it('keeps the densest song clean on the default patch', () => {
    const report = renderSong('pluck', 'moonlight');
    console.log('[song] pluck + moonlight →', fmt(report));
    expect(report.nan).toBe(0);
    expect(report.peak).toBeLessThanOrEqual(1.0);
    expect(report.overUnity).toBe(0);
    expect(report.bigSteps).toBe(0);
  });
});
