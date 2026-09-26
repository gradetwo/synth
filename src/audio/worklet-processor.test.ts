/**
 * Worklet-level integration test.
 *
 * Runs the real `worklet-processor.js` against the real compiled WASM inside
 * Vitest by faking the three AudioWorklet globals. This catches wiring bugs that
 * neither the Rust tests nor a typecheck can see: descriptor drift, wrong
 * pointer offsets, or a `process()` that never reaches `gs_process`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

/**
 * The worklet is a plain JS asset, so the two internals the queue tests read — a `port` that is null until the core
 * wires it, and the scheduled queue itself — have no declaration to import. One cast names them, the same way the
 * other queue tests already reach in.
 */
type QueueInternals = {
  port: { onmessage: (e: { data: unknown }) => void };
  scheduledNotes: { off: boolean; note: number; frame: number }[];
};

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

  /**
   * The artifact that actually ships.
   *
   * Every other test in this file has to import the *readable* source (it is the
   * single truth for the protocol), but the source is not what a visitor
   * downloads: the build minifies it (`scripts/worklet-min.ts`) and `engine.ts`
   * loads that copy with `?url`. A minifier that dropped or renamed a binding
   * would leave every test above green and break the app, so the same harness is
   * run once against the generated asset here.
   */
  it('renders audio from the minified worklet the build emits', async () => {
    const minPath = 'src/generated/worklet-processor.min.js';
    expect(existsSync(minPath), 'the build must have generated the minified worklet').toBe(true);
    const min = readFileSync(minPath, 'utf8');
    const source = readFileSync('src/audio/worklet-processor.js', 'utf8');
    // The build really compressed it: pointing the bundle back at the source (or
    // turning minification off) fails here, not only in `verify-dist`/budget.
    expect(min.length, 'the shipped worklet must be minified, not the source').toBeLessThan(
      source.length * 0.6,
    );

    // Register the minified copy under a capture of its own, so the source
    // registration the tests above share is left exactly as it was.
    const g = globalThis as Record<string, unknown>;
    const originalRegister = g.registerProcessor;
    const shipped: { current: Registered | null } = { current: null };
    g.registerProcessor = (name: string, ctor: unknown) => {
      shipped.current = { name, ctor: ctor as Registered['ctor'] };
    };
    try {
      // Load the built file itself, not a copy: a native `import()` of its real
      // path runs the exact bytes `dist/assets/worklet-processor.min-*.js`
      // carries, without letting the test transform stand in for the build.
      await import(/* @vite-ignore */ pathToFileURL(resolve(minPath)).href);
    } finally {
      g.registerProcessor = originalRegister;
    }
    expect(shipped.current).not.toBeNull();
    expect(shipped.current!.name).toBe('gs1-synth-processor');

    messages.length = 0;
    const proc = new shipped.current!.ctor({
      processorOptions: {
        wasmBytes: new Uint8Array(readFileSync(wasmPath)).buffer,
        sampleRate: 48000,
        maxPolyphony: 16,
      },
    });
    await waitReady(proc);
    expect(messages.some((m) => (m as { type?: string }).type === 'ready')).toBe(true);

    const params: Record<string, Float32Array> = {};
    const shippedDescriptors = (
      shipped.current!.ctor as unknown as {
        parameterDescriptors: { name: string; defaultValue: number }[];
      }
    ).parameterDescriptors;
    for (const d of shippedDescriptors) {
      params[d.name] = new Float32Array([d.defaultValue]);
    }
    params.osc1Wave = new Float32Array([2]);
    params.osc1Level = new Float32Array([0.8]);
    params.filterCutoff = new Float32Array([12000]);

    proc.port.onmessage?.({ data: new Uint8Array([0x90, 60, 127]).buffer });
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    let peak = 0;
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      proc.process([], [[left, right]], params);
      for (const v of left) {
        samples.push(v);
        peak = Math.max(peak, Math.abs(v));
      }
    }
    expect(samples.every(Number.isFinite), 'the minified processor must not emit NaN').toBe(true);
    // Same bar as the source note-on test above: clearly above the noise floor.
    expect(peak).toBeGreaterThan(0.02);
  });

  it('plays a second instance, layered and split', async () => {
    // Instance A: a sine. Instance B: a square. Layering must put the square's
    // odd harmonics into the output, and a split must keep them to the high half
    // of the keyboard.
    const play = async (mode: number, note: number) => {
      const proc = instantiate();
      await waitReady(proc);
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
      params.osc1On = new Float32Array([1]);
      params.osc1Wave = new Float32Array([0]);
      params.osc1Level = new Float32Array([0.7]);
      params.osc2On = new Float32Array([0]);
      params.osc2Level = new Float32Array([0]);
      params.filterCutoff = new Float32Array([18000]);
      params.filterEnvAmt = new Float32Array([0]);
      params.envAttack = new Float32Array([0.001]);
      params.envSustain = new Float32Array([1]);
      params.lfoOn = new Float32Array([0]);
      params.fxReverbOn = new Float32Array([0]);
      params.fxDelayOn = new Float32Array([0]);
      params.masterVolume = new Float32Array([1]);
      params.osc1Detune = new Float32Array([0]);
      params.masterTune = new Float32Array([0]);
      // Instance B: the same patch shape, but a square.
      for (const [id, value] of Object.entries({
        1: 1, 2: 3, 5: 0.6, 7: 0, 11: 0, 14: 18000, 17: 0, 19: 0.001, 21: 1, 23: 0, 29: 0, 32: 0, 0: 1,
      })) {
        proc.port.onmessage?.({ data: { type: 'paramB', id: Number(id), value } });
      }
      proc.port.onmessage?.({
        data: { type: 'instanceRoute', mode, splitNote: 60, aLo: 0, aHi: 1, bLo: 0, bHi: 1 },
      });
      for (let i = 0; i < 20; i++) proc.process([], [[new Float32Array(128), new Float32Array(128)]], params);
      proc.port.onmessage?.({ data: { type: 'noteOn', note, velocity: 1 } });
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      const out: number[] = [];
      for (let i = 0; i < 120; i++) {
        proc.process([], [[left, right]], params);
        if (i >= 20) out.push(...left);
      }
      return Float32Array.from(out);
    };

    const f0 = 440;
    const single = await play(0, 69);
    const layered = await play(1, 69);
    const splitHigh = await play(2, 72);
    const splitLow = await play(2, 48);
    const third = (buffer: Float32Array, base: number) => magnitude(buffer, base * 3);
    const fundamental = (buffer: Float32Array, base: number) => magnitude(buffer, base);

    // Single: a sine, so no third harmonic. Layered: the square's third.
    // A sine through the filter is never mathematically pure (the ladder's soft
    // clip leaves a little third harmonic), so the bar is "the layering clearly
    // adds the square's harmonics", not "the sine is perfect".
    const singleRatio = third(single, f0) / fundamental(single, f0);
    const layeredRatio = third(layered, f0) / fundamental(layered, f0);
    expect(singleRatio).toBeLessThan(0.05);
    expect(layeredRatio).toBeGreaterThan(singleRatio * 4);

    // Split: the high note is the square, the low one the sine.
    const highF0 = 440 * Math.pow(2, 3 / 12);
    const lowThird = third(splitLow, f0) / fundamental(splitLow, f0);
    const highThird = third(splitHigh, highF0) / fundamental(splitHigh, highF0);
    expect(lowThird).toBeLessThan(0.05);
    expect(highThird).toBeGreaterThan(lowThird * 4);
  });

  it('places a note-on message in the stereo image', async () => {
    // Pan is a per-note property (the player pans each song layer), so it rides
    // on its own message; a centred note keeps the raw-MIDI fast path.
    const render = async (pan: number | null) => {
      const proc = instantiate();
      await waitReady(proc);
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
      params.osc1On = new Float32Array([1]);
      params.osc1Wave = new Float32Array([2]);
      params.osc1Level = new Float32Array([0.8]);
      params.osc2On = new Float32Array([0]);
      params.osc2Level = new Float32Array([0]);
      params.osc1Pan = new Float32Array([0]);
      params.filterCutoff = new Float32Array([16000]);
      params.filterEnvAmt = new Float32Array([0]);
      params.envAttack = new Float32Array([0.001]);
      params.envSustain = new Float32Array([1]);
      params.lfoOn = new Float32Array([0]);
      params.fxReverbOn = new Float32Array([0]);
      params.fxDelayOn = new Float32Array([0]);
      params.fxChorusOn = new Float32Array([0]);
      params.fxPhaserOn = new Float32Array([0]);
      params.fxDriveOn = new Float32Array([0]);
      params.masterVolume = new Float32Array([1]);
      for (let i = 0; i < 10; i++) {
        proc.process([], [[new Float32Array(128), new Float32Array(128)]], params);
      }
      if (pan === null) {
        const packet = new Uint8Array([0x90, 60, 127]);
        proc.port.onmessage?.({ data: packet.buffer });
      } else {
        proc.port.onmessage?.({ data: { type: 'noteOnPan', note: 60, velocity: 1, pan } });
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < 60; i++) {
        proc.process([], [[left, right]], params);
        if (i < 10) continue;
        for (let s = 0; s < 128; s++) {
          sumL += left[s] * left[s];
          sumR += right[s] * right[s];
        }
      }
      return { l: Math.sqrt(sumL), r: Math.sqrt(sumR) };
    };

    const centre = await render(null);
    expect(centre.l).toBeGreaterThan(0);
    // A raw MIDI note keeps the patch's own position: dead centre here.
    expect(centre.l / centre.r).toBeGreaterThan(0.9);
    expect(centre.l / centre.r).toBeLessThan(1.1);

    const left = await render(-0.9);
    expect(left.l).toBeGreaterThan(left.r * 3);
    const right = await render(0.9);
    expect(right.r).toBeGreaterThan(right.l * 3);
  });

  /**
   * Frame-addressed events (`noteAt` / `noteOffAt`).
   *
   * These are what let a lookahead scheduler drive this engine at all: without them a host can
   * only say "now", so it either posts early (by its whole lookahead) or from a timer (and
   * inherits main-thread jitter). The tests below pin the two properties that matter — the event
   * lands on the frame it names, and it survives being scheduled far ahead of the block that
   * needs it.
   */
  describe('frame-addressed note events', () => {
    /**
     * The core is not bit-silent: an idle block carries a residual around 1e-15 (denormal
     * flush and the master limiter's DC path). "Silent" therefore means "below this", and the
     * threshold is stated rather than tuned per assertion.
     */
    const SILENT = 1e-9;

    /**
     * A full, audible parameter set.
     *
     * `process([], outputs, {})` — what the load-monitor tests use — deliberately pushes *no*
     * parameters, so the core keeps whatever its own defaults are and a note can be silent. Any
     * test that asserts audio has to hand over the descriptors, exactly like the note-on test.
     */
    const audibleParams = () => {
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
      params.osc1Wave = new Float32Array([2]);
      params.osc1Level = new Float32Array([0.8]);
      params.filterCutoff = new Float32Array([12000]);
      params.envAttack = new Float32Array([0.002]);
      params.envDecay = new Float32Array([0.3]);
      params.envSustain = new Float32Array([0.7]);
      return params;
    };

    /** Render one block and return the loudest sample in it. */
    const renderBlock = (processor: ReturnType<typeof instantiate>) => {
      const outputs = [[new Float32Array(128), new Float32Array(128)]];
      processor.process([], outputs, audibleParams());
      let peak = 0;
      for (const channel of outputs[0]) {
        for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
      }
      return peak;
    };

    /**
     * Render `blocks` blocks and return everything an input-guard test needs: every sample (so
     * "no NaN" can be asserted directly rather than inferred from a peak), the loudest sample, and
     * per-channel RMS (for "did it sound" and "is it centred").
     */
    const renderAll = (processor: ReturnType<typeof instantiate>, blocks: number) => {
      const samples: number[] = [];
      let sumL = 0;
      let sumR = 0;
      for (let b = 0; b < blocks; b++) {
        const outputs = [[new Float32Array(128), new Float32Array(128)]];
        processor.process([], outputs, audibleParams());
        const [left, right] = outputs[0];
        for (let i = 0; i < 128; i++) {
          samples.push(left[i], right[i]);
          sumL += left[i] * left[i];
          sumR += right[i] * right[i];
        }
      }
      return {
        samples,
        peak: samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0),
        l: Math.sqrt(sumL),
        r: Math.sqrt(sumR),
      };
    };

    /** A ready processor that has already received `data`. */
    const processorFor = async (data: unknown) => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      (processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } }).port.onmessage({
        data,
      });
      return processor;
    };

    /**
     * The core's own NaN counter. The output stage replaces a NaN sample with 0 and bumps this
     * count, so "the note is silent but `nan_events` is non-zero" is exactly what a NaN reaching
     * the core looks like from outside — the peak alone cannot tell it from a legitimately quiet
     * note.
     */
    const nanEvents = (processor: ReturnType<typeof instantiate>) =>
      (processor as unknown as { wasm: { gs_nan_events: () => number } }).wasm.gs_nan_events();


    /** First frame whose absolute sample value exceeds the audibility threshold. */
    const firstAudibleFrame = (processor: ReturnType<typeof instantiate>, blocks: number) => {
      for (let block = 0; block < blocks; block++) {
        const outputs = [[new Float32Array(128), new Float32Array(128)]];
        processor.process([], outputs, audibleParams());
        for (let i = 0; i < 128; i++) {
          if (Math.abs(outputs[0][0][i]) > 1e-6) return block * 128 + i;
        }
      }
      return -1;
    };

    it('honours the exact frame, with a constant one-block voice-start latency', async () => {
      /**
       * Two claims, both measured rather than assumed:
       *
       *  1. the *voice start* is `atFrame + 128` for every `atFrame`, no matter where inside the
       *     block the event falls — a block-granular implementation would snap all four values in
       *     the same block to one onset, so the offsets below would differ;
       *  2. the first *measurable* sample is a little later, by however long the patch's attack
       *     takes to exceed the threshold, which is a property of the envelope and not of the
       *     scheduler. Asserting a fixed onset frame here would encode the test's own attack time.
       */
      const frames = [0, 100, 128, 200, 384, 500];
      const offsets: number[] = [];
      for (const atFrame of frames) {
        messages.length = 0;
        const processor = instantiate();
        await waitReady(processor);
        const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
        w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.9, atFrame } });
        const onset = firstAudibleFrame(processor, 12);
        expect(onset, `atFrame ${atFrame} must sound`).toBeGreaterThan(0);
        offsets.push(onset - atFrame);
      }
      // Constant offset: the scheduler adds latency, never jitter. The few-frame wobble is the
      // *envelope* crossing the threshold relative to the oscillator's phase, not the scheduler —
      // which is why the voice-start frame is asserted in the comment below rather than here.
      const spread = Math.max(...offsets) - Math.min(...offsets);
      expect(spread, `offsets differ by ${spread}: ${offsets.join(', ')}`).toBeLessThanOrEqual(8);
      // …and the latency is one render quantum, plus at most one block of envelope rise.
      expect(offsets[0]).toBeGreaterThanOrEqual(128);
      expect(offsets[0]).toBeLessThanOrEqual(256);
      // In-block positions survive: 100 frames apart in, within the same tolerance out.
      expect(Math.abs(offsets[1] - offsets[0])).toBeLessThanOrEqual(8);
    });


    it('keeps a note scheduled many blocks ahead in the queue', async () => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      // ~100 ms ahead: 38 blocks at 48 kHz. A host with a 200 ms lookahead does exactly this.
      w.port.onmessage({ data: { type: 'noteAt', note: 64, velocity: 0.9, atFrame: 4800 } });
      for (let i = 0; i < 38; i++) {
        expect(renderBlock(processor), `block ${i} must be silent`).toBeLessThan(SILENT);
      }
      // Voice start is frame 4800 + 128 = block 38; the envelope needs a little of itself to
      // become measurable, so allow the following three blocks.
      let peak = 0;
      for (let i = 0; i < 3; i++) peak = Math.max(peak, renderBlock(processor));
      expect(peak, 'a note queued 100 ms ahead must still arrive').toBeGreaterThan(SILENT);
    });

    it('queues a valid event with exactly the shape the old path produced', async () => {
      /**
       * The guards must be invisible to valid input. This asserts the queued event field-for-field:
       * the frame is still `Math.round(atFrame)` (300.7 → 301, the same value the old
       * `Math.round(Number(atFrame))` produced for a number), and `note` / `velocity` / `pan` are
       * passed through untouched — nothing is coerced, clamped or defaulted on this path.
       */
      const processor = await processorFor({ type: 'noteAt', note: 60, velocity: 0.25, pan: -0.5, atFrame: 300.7 });
      const internals = processor as unknown as { scheduledNotes: unknown[] };
      expect(internals.scheduledNotes).toEqual([
        { frame: 301, off: false, note: 60, velocity: 0.25, pan: -0.5 },
      ]);
    });

    it('applies a late event immediately instead of dropping it', async () => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      renderBlock(processor); // one block of real time passes
      w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.9, atFrame: 0 } });
      // A past-dated event is applied as soon as possible: the voice starts in the next block and
      // needs part of its envelope to be measurable.
      let peak = 0;
      for (let i = 0; i < 4; i++) peak = Math.max(peak, renderBlock(processor));
      expect(peak, 'a late note plays late, not never').toBeGreaterThan(SILENT);
    });
    it('ignores a malformed frame instead of treating it as zero', async () => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.9, atFrame: 'not-a-frame' } });
      expect(renderBlock(processor), 'a malformed event must not sound').toBeLessThan(SILENT);
    });

    it('applies a note-on with no velocity at full velocity, never NaN', async () => {
      /**
       * `{ type: 'noteAt', note, atFrame }` with no `velocity` handed `undefined` across the wasm
       * boundary, where it became `NaN`; the core's `clamp(0, 1)` cannot clamp NaN (every
       * comparison against it is false), so the voice gain was NaN and the note was silent with a
       * `nan_events` count. The contract now reads a missing velocity as MIDI's implicit *full*
       * velocity — the host's most likely intent — and never puts NaN on the wire.
       */
      const implicit = await processorFor({ type: 'noteAt', note: 60, atFrame: 0 });
      const out = renderAll(implicit, 12);
      // `soft` so a regression reports *both* symptoms at once: the note is silent (the output
      // stage replaces NaN with 0) and the core's own NaN counter says why.
      expect.soft(nanEvents(implicit), 'a missing velocity must not reach the core as NaN').toBe(0);
      expect.soft(out.peak, 'the implicit velocity must be audible').toBeGreaterThan(SILENT);
      expect(out.samples.every(Number.isFinite), 'a missing velocity must not put NaN on the wire').toBe(true);

      // Full, not merely non-zero: the same note with an explicit `velocity: 1` reaches the same
      // level. RMS is phase-independent, so this compares across cores without asserting the
      // oscillator's start phase sample-by-sample.
      const full = renderAll(await processorFor({ type: 'noteAt', note: 60, velocity: 1, atFrame: 0 }), 12);
      expect(out.l / full.l).toBeGreaterThan(0.95);
      expect(out.l / full.l).toBeLessThan(1.05);
    });

    it('rejects a non-number atFrame instead of coercing it to frame 0', async () => {
      /**
       * `Number(null)` and `Number('')` are both `0` — a finite frame — so the old
       * `Number.isFinite(Math.round(Number(x)))` guard let them through and they sounded at frame
       * 0 immediately, exactly the "malformed ⇒ treat as 0" the handler's comment promises not to
       * do. `false` coerces the same way. The guard is a raw type check now.
       */
      for (const bad of [null, '', false]) {
        const processor = await processorFor({ type: 'noteAt', note: 60, velocity: 0.9, atFrame: bad });
        expect(
          renderAll(processor, 4).peak,
          `atFrame ${JSON.stringify(bad)} must not sound at frame 0`,
        ).toBeLessThan(SILENT);
      }
    });

    it('rejects a velocity that was given but is not a finite number', async () => {
      // "Omitted" and "given, but garbage" are different: only the former gets the MIDI default.
      // `'0.5'` and `{}` would otherwise reach wasm as a coerced `f32` (0.5 and NaN respectively).
      for (const bad of [NaN, Infinity, '0.5', null, {}]) {
        const processor = await processorFor({ type: 'noteAt', note: 60, velocity: bad, atFrame: 0 });
        const out = renderAll(processor, 4);
        // The counter is bumped inside `gs_process`, so it has to be read after rendering.
        expect(nanEvents(processor), `velocity ${String(bad)} must not reach the core as NaN`).toBe(0);
        expect(out.peak, `velocity ${String(bad)} must be rejected`).toBeLessThan(SILENT);
      }
    });

    it('rejects a note that is not a finite number', async () => {
      // A `null` note coerces to MIDI 0 and `'60'` to 60; neither is a number this protocol ever
      // promised, and a `NaN` note would reach the core as NaN.
      for (const bad of [NaN, Infinity, null, '60']) {
        const processor = await processorFor({ type: 'noteAt', note: bad, velocity: 0.9, atFrame: 0 });
        const out = renderAll(processor, 4);
        expect(nanEvents(processor), `note ${String(bad)} must not reach the core as NaN`).toBe(0);
        expect(out.peak, `note ${String(bad)} must be rejected`).toBeLessThan(SILENT);
      }
    });

    it('keeps a non-finite pan out of the core without losing the note', async () => {
      /**
       * `pan: NaN` used to go straight into `gs_note_on_pan` (the branch only checked
       * `!== undefined`), so NaN reached the core. The contract now drops a non-finite pan and
       * plays the note centred — the same path as an omitted pan — because pan is decoration:
       * losing a correctly pitched, correctly timed note to it would be the worse failure.
       */
      const badProcessor = await processorFor({ type: 'noteAt', note: 60, velocity: 0.9, pan: NaN, atFrame: 0 });
      const bad = renderAll(badProcessor, 12);
      expect.soft(nanEvents(badProcessor), 'a non-finite pan must not reach the core as NaN').toBe(0);
      expect.soft(bad.peak, 'the note itself must survive a bad pan').toBeGreaterThan(SILENT);
      expect(bad.samples.every(Number.isFinite), 'a non-finite pan must not reach the core').toBe(true);

      const ref = renderAll(await processorFor({ type: 'noteAt', note: 60, velocity: 0.9, atFrame: 0 }), 12);
      expect(bad.l / bad.r).toBeGreaterThan((ref.l / ref.r) * 0.95);
      expect(bad.l / bad.r).toBeLessThan((ref.l / ref.r) * 1.05);
    });

    it('drops pending events on panic', async () => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.9, atFrame: 256 } });
      w.port.onmessage({ data: { type: 'panic' } });
      // Five blocks, not three: a voice needs one more quantum (128 frames) before it is
      // measurable, so an event at frame 256 that panic *didn't* cancel only becomes audible in
      // block 3 (frames 384+). Checking three blocks let that mutation pass — measured, see the
      // groove track's self-proof log.
      for (let i = 0; i < 5; i++) {
        expect(renderBlock(processor), `block ${i} must stay silent after panic`).toBeLessThan(SILENT);
      }
    });

    it('keeps the frame cursor advancing while muted', async () => {
      /**
       * Events are addressed in *absolute* frames, so a mute must not stop the frame counter: if
       * `process()` froze it while muted, every queued event would be applied late by exactly
       * however long the mute lasted — the host would look correct and the music would drift.
       * The same test pins the other half of the documented `mute` semantics (it does not clear
       * the queue): the event queued below survives four muted blocks and still fires on its own
       * frame once sound returns.
       */
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      // Frame 512 is the first sample of block 4, i.e. four blocks of mute away.
      w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.9, atFrame: 512 } });
      w.port.onmessage({ data: { type: 'mute', value: true } });
      for (let i = 0; i < 4; i++) {
        expect(renderBlock(processor), `muted block ${i} must be silent`).toBeLessThan(SILENT);
      }
      w.port.onmessage({ data: { type: 'mute', value: false } });
      // With the cursor advancing, these blocks cover frames 512..1023 and the note (voice start
      // 512 + 128) is audible. With the cursor frozen at 0 they cover frames 0..511 instead, the
      // event is never due, and every one of them is silent.
      let peak = 0;
      for (let i = 0; i < 4; i++) peak = Math.max(peak, renderBlock(processor));
      expect(peak, 'the mute must not delay a queued event by the mute duration').toBeGreaterThan(SILENT);
    });

    it('bounds the queue so a leaking host cannot grow it without limit', async () => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      const internals = processor as unknown as { scheduledNotes: unknown[] };
      for (let i = 0; i < 2000; i++) {
        w.port.onmessage({ data: { type: 'noteAt', note: 60, velocity: 0.5, atFrame: 1_000_000 + i } });
      }
      expect(internals.scheduledNotes.length).toBeLessThanOrEqual(1024);
    });
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

  /**
   * Offline export prefill (`processorOptions.notes`).
   *
   * The offline export cannot rely on `OfflineAudioContext.suspend` (Firefox has none), so it hands
   * the whole song over in `processorOptions.notes` and the processor turns each note into a
   * frame-addressed note-on/note-off. These tests pin that the prefill channel builds exactly the
   * queue the documented `noteAt` / `noteOffAt` messages build — same validator, same fields — so
   * the fallback is not a second, weaker scheduling path.
   */
  describe('a new note-on supersedes an earlier queued release', () => {
    /**
     * The defect this holds shut: retriggering a key before its release left the *old* release in the queue, where it
     * fired after the new note-on and released the new voice — a lane that goes silent or fragments when a preview
     * button is tapped twice. A keyboard's rule is the fix: the key was let go and pressed again, so only the new
     * press is still owed a release.
     */
    it('drops the superseded note-off and keeps the new one', async () => {
      const processor = instantiate();
      // The processor drops messages until its core reports ready; every test that inspects the queue waits first.
      await waitReady(processor);
      const internals = processor as unknown as QueueInternals;
      internals.port.onmessage({ data: { type: 'noteOnAt', atFrame: 0, note: 60, velocity: 1 } });
      internals.port.onmessage({ data: { type: 'noteOffAt', atFrame: 1000, note: 60 } });
      // The retrigger lands before the first release, and asks for its own, later one.
      internals.port.onmessage({ data: { type: 'noteOnAt', atFrame: 400, note: 60, velocity: 1 } });
      internals.port.onmessage({ data: { type: 'noteOffAt', atFrame: 1400, note: 60 } });

      const queue = internals.scheduledNotes;
      const offs = queue.filter((e: { off: boolean; note: number }) => e.off && e.note === 60);
      expect(offs.map((e: { frame: number }) => e.frame), 'only the new release survives').toEqual([1400]);
      // …and the two note-ons are both still there: superseding a *release* must not swallow a press.
      expect(queue.filter((e: { off: boolean }) => !e.off)).toHaveLength(2);
    });

    it('leaves releases on other keys alone', async () => {
      const processor = instantiate();
      await waitReady(processor);
      const internals = processor as unknown as QueueInternals;
      internals.port.onmessage({ data: { type: 'noteOnAt', atFrame: 0, note: 60 } });
      internals.port.onmessage({ data: { type: 'noteOffAt', atFrame: 1000, note: 60 } });
      internals.port.onmessage({ data: { type: 'noteOnAt', atFrame: 0, note: 64 } });
      internals.port.onmessage({ data: { type: 'noteOffAt', atFrame: 1000, note: 64 } });
      internals.port.onmessage({ data: { type: 'noteOnAt', atFrame: 400, note: 60 } });

      const queue = internals.scheduledNotes;
      expect(queue.filter((e: { off: boolean; note: number }) => e.off && e.note === 64)).toHaveLength(1);
      expect(queue.filter((e: { off: boolean; note: number }) => e.off && e.note === 60)).toHaveLength(0);
    });
  });

  describe('offline prefill (processorOptions.notes)', () => {
    const prefill = (notes: unknown[]) => {
      const bytes = new Uint8Array(readFileSync(wasmPath)).buffer;
      return new registered!.ctor({
        processorOptions: { wasmBytes: bytes, sampleRate: 48000, maxPolyphony: 16, notes },
      });
    };

    /** The queue an equivalent run of frame-addressed messages builds, in arrival order. */
    const messageQueue = async (
      messagesToSend: { type: string; atFrame: number; note: number; velocity?: number; pan?: number }[],
    ) => {
      messages.length = 0;
      const processor = instantiate();
      await waitReady(processor);
      const w = processor as unknown as { port: { onmessage: (e: { data: unknown }) => void } };
      for (const data of messagesToSend) w.port.onmessage({ data });
      return (processor as unknown as { scheduledNotes: unknown[] }).scheduledNotes;
    };

    it('builds the same queue the noteOnAt/noteOffAt messages build', async () => {
      const notes = [
        { note: 60, onFrame: 100, offFrame: 200, velocity: 0.9, pan: -0.5 },
        { note: 64, onFrame: 300, offFrame: 400, velocity: 1 },
      ];
      const prefilled = (prefill(notes) as unknown as { scheduledNotes: unknown[] }).scheduledNotes;
      const fromMessages = await messageQueue([
        { type: 'noteOnAt', atFrame: 100, note: 60, velocity: 0.9, pan: -0.5 },
        { type: 'noteOffAt', atFrame: 200, note: 60 },
        { type: 'noteOnAt', atFrame: 300, note: 64, velocity: 1 },
        { type: 'noteOffAt', atFrame: 400, note: 64 },
      ]);
      expect(prefilled).toEqual(fromMessages);
    });

    it('validates each prefill event with the message path rule', async () => {
      /**
       * On and off are separate events on the live path, and the prefill keeps that: each one is
       * validated on its own. A malformed note-on is therefore dropped while its (valid) note-off
       * is still queued — a `gs_note_off` for a voice that never started, which the core ignores —
       * exactly as a stray `noteOffAt` message would be. Pan is the documented exception: a
       * non-finite pan keeps the note and centres it.
       */
      const notes = [
        { note: 60, onFrame: '100', offFrame: 200, velocity: 0.9 },
        { note: null, onFrame: 300, offFrame: 400, velocity: 0.9 },
        { note: 62, onFrame: 500, offFrame: 600, velocity: 'loud' },
        { note: 67, onFrame: 700, offFrame: 800, velocity: 0.8, pan: NaN },
      ];
      const prefilled = (prefill(notes) as unknown as { scheduledNotes: unknown[] }).scheduledNotes;
      expect(prefilled).toEqual([
        { frame: 200, off: true, note: 60, velocity: 0, pan: undefined },
        { frame: 600, off: true, note: 62, velocity: 0, pan: undefined },
        { frame: 700, off: false, note: 67, velocity: 0.8, pan: undefined },
        { frame: 800, off: true, note: 67, velocity: 0, pan: undefined },
      ]);
    });

    it('keeps the whole song, past the live queue bound', () => {
      /**
       * The prefill deliberately skips `scheduleTimedNote`'s `MAX_SCHEDULED_EVENTS` bound: that
       * bound is for a live host leaking events, while this list is the finite song being exported.
       * Truncating it would silently cut the opening bars out of the file. 600 notes is 1200 events
       * — past 1024 — and every one must survive, sorted.
       */
      const notes = Array.from({ length: 600 }, (_, i) => ({
        note: 60 + (i % 12),
        onFrame: 1000 + i * 200,
        offFrame: 1100 + i * 200,
        velocity: 0.8,
      }));
      const queue = (prefill(notes) as unknown as { scheduledNotes: { frame: number }[] }).scheduledNotes;
      expect(queue).toHaveLength(1200);
      expect(queue[0].frame).toBe(1000);
      expect(queue[queue.length - 1].frame).toBe(1100 + 599 * 200);
      for (let i = 1; i < queue.length; i++) {
        expect(queue[i].frame).toBeGreaterThanOrEqual(queue[i - 1].frame);
      }
    });

    it('sounds a prefilled note on its exact frame', async () => {
      // atFrame 4800 is block 37 at 48 kHz; the voice starts one quantum later (4800 + 128) and
      // needs part of its envelope before it crosses the audibility threshold.
      const proc = prefill([{ note: 60, onFrame: 4800, offFrame: 4800 + 24000, velocity: 1 }]);
      await waitReady(proc);
      const params: Record<string, Float32Array> = {};
      for (const d of descriptors()) params[d.name] = new Float32Array([d.defaultValue]);
      params.osc1Wave = new Float32Array([2]);
      params.osc1Level = new Float32Array([0.8]);
      params.filterCutoff = new Float32Array([12000]);
      const renderBlock = () => {
        const outputs = [[new Float32Array(128), new Float32Array(128)]];
        proc.process([], outputs, params);
        let peak = 0;
        for (const channel of outputs[0]) for (const v of channel) peak = Math.max(peak, Math.abs(v));
        return peak;
      };
      for (let i = 0; i < 37; i++) expect(renderBlock(), `block ${i} must be silent`).toBeLessThan(1e-9);
      let peak = 0;
      for (let i = 0; i < 3; i++) peak = Math.max(peak, renderBlock());
      expect(peak, 'the prefilled note must arrive').toBeGreaterThan(1e-9);
    });
  });
});
