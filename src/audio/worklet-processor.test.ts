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

  /**
   * The worklet instantiates WASM asynchronously. Wait on *this* instance's own
   * ready flag rather than on the shared message queue: with many instances in
   * one file a stale message from an earlier one would let a test proceed
   * before its own core exists, and anything it then sends is dropped.
   */
  const waitReady = async (proc: ReturnType<typeof instantiate>) => {
    for (let i = 0; i < 200; i++) {
      if ((proc as unknown as { ready: boolean }).ready) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error('worklet did not become ready');
  };

  /** Wait for a specific message, so a reply cannot be confused with an old one. */
  const waitFor = async <T,>(predicate: (message: { type?: string; request?: number }) => boolean, what: string) => {
    for (let i = 0; i < 200; i++) {
      const found = messages.find((m) => predicate(m as { type?: string; request?: number }));
      if (found) return found as T;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(`no ${what} message arrived`);
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

  /**
   * Drive one render block with a chosen cost, by faking the clock the monitor
   * reads. `cost` is what the board measures for this block, in ms.
   */
  const tick = (processor: ReturnType<typeof instantiate>, cost: number) => {
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    let clock = 0;
    const realNow = performance.now.bind(performance);
    (performance as unknown as { now: () => number }).now = () => {
      clock += cost;
      return clock;
    };
    try {
      processor.process([], outputs, {});
    } finally {
      (performance as unknown as { now: () => number }).now = realNow;
    }
  };

  it('does not shed voices for warm-up spikes or a single slow block', async () => {
    messages.length = 0;
    const processor = instantiate();
    await waitReady(processor);
    const budget = (128 / 48000) * 1000;
    // Startup: blocks that cost several times the budget while the core is
    // still warming up (400 blocks ≈ 1.1 s of audio, inside the 2 s window).
    // The reported bug was a downgrade toast at 4% load on the first key press.
    for (let i = 0; i < 400; i++) tick(processor, budget * 6);
    // The app settles — this is the comfortable machine the screenshot showed.
    for (let i = 0; i < 430; i++) tick(processor, budget * 0.1);
    tick(processor, budget * 8);
    tick(processor, budget * 0.1);
    tick(processor, budget * 8);
    // Recovery bumps are fine; shedding voices for a spike is not.
    const shed = messages.filter(
      (m) => (m as { reason?: string }).reason === 'overload',
    );
    expect(shed).toEqual([]);
  });

  it('sheds voices once deadlines are actually being missed', async () => {
    messages.length = 0;
    const processor = instantiate();
    await waitReady(processor);
    const budget = (128 / 48000) * 1000;
    for (let i = 0; i < 900; i++) tick(processor, budget * 0.2);
    // Sustained: every block over the threshold for a stretch.
    for (let i = 0; i < 20; i++) tick(processor, budget * 4);
    const shed = messages.filter((m) => (m as { type?: string }).type === 'polyphony');
    expect(shed.length).toBeGreaterThan(0);
    expect(shed[0]).toMatchObject({ reason: 'overload' });
  });

  it('reports ready and renders audio for a note-on packet', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady(proc);
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
    // A plain note through the default patch: the low-pass now has a unity
    // passband (the vendored ladder it replaced ran a little hot), so anything
    // clearly above the noise floor counts as "audio came out".
    expect(peak).toBeGreaterThan(0.02);
    expect(left.some((v) => v !== 0)).toBe(true);
  });

  it('emits periodic analysis frames', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady(proc);
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
    await waitReady(proc);
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
    await waitReady(proc);
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

  /** Single-bin magnitude of a rendered buffer (windowed, so leakage is low). */
  const magnitude = (samples: Float32Array, freq: number, sr = 48000) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < samples.length; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / samples.length);
      const v = samples[i] * win;
      re += v * Math.cos((2 * Math.PI * freq * i) / sr);
      im -= v * Math.sin((2 * Math.PI * freq * i) / sr);
    }
    return (Math.hypot(re, im) / samples.length) * 2;
  };

  it('imports a single cycle and plays it as the wavetable', async () => {
    // One cycle of a sine: after import the wavetable wave must be a sine, and
    // the factory bank at the same knob position is not.
    const cycle = new Float32Array(2048).map((_, i) => Math.sin((2 * Math.PI * i) / 2048));

    /**
     * A fresh core per case. Reusing one would let the previous note's release
     * tail ring into the next measurement, which is exactly the fundamental
     * being compared against.
     */
    const play = async (
      wtUser: number,
      { importCycle = true, clear = false }: { importCycle?: boolean; clear?: boolean } = {},
    ) => {
      const proc = instantiate();
      await waitReady(proc);
      if (importCycle) {
        proc.port.onmessage?.({ data: { type: 'wavetable', request: 7, samples: cycle } });
        const reply = await waitFor<{ code: number; has: boolean; request: number }>(
          (m) => m.type === 'wavetable' && m.request === 7,
          'wavetable',
        );
        expect(reply).toMatchObject({ code: 0, has: true });
      }
      if (clear) proc.port.onmessage?.({ data: { type: 'wavetableClear', request: 8 } });
      const values: Record<string, number> = {
        osc1On: 1,
        osc1Wave: 8,
        osc1Level: 0.9,
        osc1Pw: 1,
        // The descriptor default detunes osc 1 by 7 cents; measure the pitch
        // the note is actually at, or the bin magnitudes are off-peak readings.
        osc1Detune: 0,
        osc2Detune: 0,
        osc2On: 0,
        osc2Level: 0,
        filterCutoff: 18000,
        filterDrive: 0,
        filterEnvAmt: 0,
        envAttack: 0.001,
        envSustain: 1,
        lfoOn: 0,
        fxReverbOn: 0,
        fxDelayOn: 0,
        wtUser,
      };
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([values[d.name] ?? d.defaultValue]);
      for (let i = 0; i < 40; i++) proc.process([], [[new Float32Array(128), new Float32Array(128)]], params);
      proc.port.onmessage?.({ data: new Uint8Array([0x90, 69, 127]).buffer });
      const out: number[] = [];
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      for (let i = 0; i < 100; i++) {
        proc.process([], [[left, right]], params);
        if (i >= 20) out.push(...left);
      }
      return Float32Array.from(out);
    };

    const imported = await play(1);
    const factory = await play(0);
    const fifth = (buffer: Float32Array) => magnitude(buffer, 2200);
    expect(magnitude(imported, 440)).toBeGreaterThan(0.01);
    expect(20 * Math.log10(fifth(imported) / magnitude(imported, 440))).toBeLessThan(-60);
    expect(fifth(factory)).toBeGreaterThan(magnitude(factory, 440) * 0.05);

    // Clearing it must not silence a patch that asks for it.
    const afterClear = await play(1, { clear: true });
    expect(magnitude(afterClear, 440)).toBeGreaterThan(0.005);
  });

  it('takes the imported cycle from the scratch buffer, not from JS memory', async () => {
    messages.length = 0;
    const proc = instantiate();
    await waitReady(proc);
    // Too short: the core must refuse and say why, rather than installing a
    // half-analysed table.
    proc.port.onmessage?.({ data: { type: 'wavetable', request: 1, samples: new Float32Array(4) } });
    const short = await waitFor<{ code: number; has: boolean }>(
      (m) => m.type === 'wavetable' && m.request === 1,
      'short-cycle',
    );
    expect(short).toMatchObject({ code: 1, has: false });

    proc.port.onmessage?.({
      data: { type: 'wavetable', request: 2, samples: new Float32Array(2048) },
    });
    const silent = await waitFor<{ code: number; has: boolean }>(
      (m) => m.type === 'wavetable' && m.request === 2,
      'silent-cycle',
    );
    expect(silent).toMatchObject({ code: 2, has: false });
  });
});
