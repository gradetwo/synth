/**
 * Worklet-level integration test.
 *
 * Runs the real `worklet-processor.js` against the real compiled WASM inside
 * Vitest by faking the three AudioWorklet globals. This catches wiring bugs that
 * neither the Rust tests nor a typecheck can see: descriptor drift, wrong
 * pointer offsets, or a `process()` that never reaches `gs_process`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Param, PARAM_NAMES } from '@/audio/params';
import { FACTORY_PRESETS, presetParams } from '@/state/presets';

const wasmPath = 'src/generated/synth_core.wasm';
const hasWasm = existsSync(wasmPath);

interface Registered {
  name: string;
  ctor: new (options: unknown) => {
    port: { postMessage: (msg: unknown) => void; onmessage: ((e: { data: unknown }) => void) | null };
    process: (
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ) => boolean;
  };
}

const messages: unknown[] = [];
let registered: Registered | null = null;

beforeAll(async () => {
  if (!hasWasm) return;
  class FakeProcessor {
    port = {
      postMessage: (msg: unknown) => messages.push(msg),
      onmessage: null as ((e: { data: unknown }) => void) | null,
    };
  }
  (globalThis as Record<string, unknown>).AudioWorkletProcessor = FakeProcessor;
  (globalThis as Record<string, unknown>).registerProcessor = (name: string, ctor: unknown) => {
    registered = { name, ctor: ctor as Registered['ctor'] };
  };
  (globalThis as Record<string, unknown>).sampleRate = 48000;
  // @ts-expect-error — the worklet is a plain script served as an asset
  await import('./worklet-processor.js');
});

describe.skipIf(!hasWasm)('AudioWorklet processor', () => {
  const instantiate = () => {
    const bytes = new Uint8Array(readFileSync(wasmPath)).buffer;
    return new registered!.ctor({
      processorOptions: { wasmBytes: bytes, sampleRate: 48000, maxPolyphony: 16 },
    });
  };

  /** The worklet instantiates WASM asynchronously; wait for its ready message. */
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      if (messages.some((m) => (m as { type?: string }).type === 'ready')) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error('worklet did not become ready');
  };

  const descriptors = () =>
    (registered!.ctor as unknown as { parameterDescriptors: { name: string; defaultValue: number }[] })
      .parameterDescriptors;

  it('registers under the expected name with all parameter descriptors', () => {
    expect(registered?.name).toBe('gs1-synth-processor');
    const names = descriptors().map((d) => d.name);
    expect(names).toContain('filterCutoff');
    expect(names).toContain('envAttack');
    expect(names).toContain('fxDelayMix');
    expect(new Set(names).size).toBe(names.length);
  });

  it('reports ready and renders audio for a note-on packet', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady();
    expect(messages.some((m) => (m as { type?: string }).type === 'ready')).toBe(true);

    const params: Record<string, Float32Array> = {};
    for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
    params.osc1Wave = new Float32Array([2]);
    params.osc1Level = new Float32Array([0.8]);
    params.filterCutoff = new Float32Array([12000]);

    // Transferable note-on packet.
    const packet = new Uint8Array([0x90, 60, 127]);
    proc.port.onmessage?.({ data: packet.buffer });

    const left = new Float32Array(128);
    const right = new Float32Array(128);
    // Track the peak across every rendered block: the level moves with the
    // envelope, so sampling only the last one is not a level check.
    let peak = 0;
    for (let i = 0; i < 24; i++) {
      proc.process([], [[left, right]], params);
      for (const v of left) peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(left.some((v) => v !== 0)).toBe(true);
  });

  it('emits periodic analysis frames', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    for (let i = 0; i < 12; i++) proc.process([], [[left, right]], params);
    const analysis = messages.find((m) => (m as { type?: string }).type === 'analysis') as
      | { spectrum: Float32Array; voices: number }
      | undefined;
    expect(analysis).toBeTruthy();
    expect(analysis!.spectrum.length).toBe(36);
  });

  it('never calls performance.now() unguarded (Safari worklet scope)', () => {
    const source = readFileSync('src/audio/worklet-processor.js', 'utf8');
    // Only the `nowMs` fallback helper may mention it.
    expect([...source.matchAll(/performance\.now\(/g)]).toHaveLength(1);
  });

  it('monitors load with no performance global', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    try {
      Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      // > 60 blocks reaches the load-monitor branch that used to throw.
      expect(() => {
        for (let i = 0; i < 80; i++) proc.process([], [[left, right]], params);
      }).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'performance', descriptor);
    }
  });

  it('honours the mute message', async () => {
    const proc = instantiate();
    await waitReady();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
    proc.port.onmessage?.({ data: { type: 'mute', value: true } });
    const left = new Float32Array(128).fill(1);
    const right = new Float32Array(128).fill(1);
    proc.process([], [[left, right]], params);
    expect(Array.from(left).every((v) => v === 0)).toBe(true);
  });

  it('renders every factory preset without NaN or silence', async () => {
    const bad: string[] = [];
    const silent: string[] = [];
    const sampleRate = 48000;
    const block = 128;

    for (const preset of FACTORY_PRESETS) {
      const proc = instantiate();
      // Wait on this instance's own ready flag. The shared `messages` queue is
      // fine for the single-processor tests, but with 60+ instances it can
      // report a previous instance's `ready`.
      const state = proc as unknown as { ready: boolean };
      for (let i = 0; i < 200 && !state.ready; i++) {
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(state.ready, preset.id).toBe(true);

      const values = presetParams(preset);
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
      for (const [id, name] of Object.entries(PARAM_NAMES)) {
        if (params[name]) params[name][0] = values[Number(id)];
      }

      const left = new Float32Array(block);
      const right = new Float32Array(block);
      // The host pushes AudioParams every block; do the same before the note
      // so mode/envelope changes are in place (matches the live engine order).
      proc.process([], [[left, right]], params);
      proc.process([], [[left, right]], params);

      proc.port.onmessage?.({ data: new Uint8Array([0x90, 60, 127]).buffer });

      // Render far enough for slow pads and risers to actually open their
      // envelope, but cap the work per preset.
      const attack = values[Param.ENV_ATTACK];
      const decay = values[Param.ENV_DECAY];
      const holdSec = Math.min(attack + Math.max(decay, 0.05), 1.5) + 0.15;
      const blocks = Math.min(Math.ceil((holdSec * sampleRate) / block), 800);

      let peak = 0;
      for (let i = 0; i < blocks; i++) {
        proc.process([], [[left, right]], params);
        for (const v of left) {
          if (!Number.isFinite(v)) bad.push(preset.id);
          peak = Math.max(peak, Math.abs(v));
        }
      }
      if (peak < 0.003) silent.push(`${preset.id}(${peak.toFixed(4)})`);
    }

    expect([...new Set(bad)], `non-finite output: ${[...new Set(bad)].join(', ')}`).toEqual([]);
    expect(silent, `silent presets: ${silent.join(', ')}`).toEqual([]);
  }, 60_000);
});
