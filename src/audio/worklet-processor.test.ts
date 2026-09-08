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
    const module = new WebAssembly.Module(readFileSync(wasmPath));
    const proc = new registered!.ctor({
      processorOptions: { wasmModule: module, sampleRate: 48000, maxPolyphony: 16 },
    });
    return proc;
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

  it('reports ready and renders audio for a note-on packet', () => {
    messages.length = 0;
    const proc = instantiate();
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
    for (let i = 0; i < 24; i++) {
      proc.process([], [[left, right]], params);
    }
    let peak = 0;
    for (const v of left) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.05);
    expect(left.some((v) => v !== 0)).toBe(true);
  });

  it('emits periodic analysis frames', () => {
    messages.length = 0;
    const proc = instantiate();
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

  it('honours the mute message', () => {
    const proc = instantiate();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
    proc.port.onmessage?.({ data: { type: 'mute', value: true } });
    const left = new Float32Array(128).fill(1);
    const right = new Float32Array(128).fill(1);
    proc.process([], [[left, right]], params);
    expect(Array.from(left).every((v) => v === 0)).toBe(true);
  });
});
