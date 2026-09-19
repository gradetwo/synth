/**
 * The routing graph against the real core (A1).
 *
 * The graph is only worth having if turning it on cannot change the sound of a
 * patch that was written for the chain, and the chain→graph mapping the UI uses
 * is the thing that has to guarantee it. This renders the same patch through the
 * legacy chain and through the mapped graph, in the compiled WASM, and compares
 * them sample for sample.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  FX_KINDS,
  FX_CONV_INSTANCES,
  FX_DELAY_INSTANCES,
  FX_DELAY_MAX_SECONDS,
  FX_MOD_GAIN_TARGETS,
  FX_MOD_SLOTS,
  FX_OVR_MOD_SLOTS,
  FX_OVR_POOL,
  FX_OVR_SLOTS,
  FX_OVR_UNSET,
  FX_SLOTS,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  chainId,
  graphFromChain,
  graphModDepthId,
  graphModDst,
  graphModDstId,
  graphModSrcId,
  graphOutGainId,
  ovrDepthBusId,
  ovrId,
  ovrSlotCode,
  ovrSlotRange,
  ovrTargetBusId,
  ovrTargetSlot,
  ovrUnifyBusEntries,
  parallelId,
} from './params';
import { decodePatch, encodePatch } from '@/state/share';
import {
  FX_TEMPLATE_PARAM_IDS,
  captureFxTemplateParams,
  fxTemplateEntries,
  normalizeTemplateParams,
} from '@/state/fxtemplates';

const wasmPath = 'src/generated/synth_core.wasm';
const SR = 48_000;

/** The eight matrix rows, all disabled: nothing but the in-graph edges. */
const MATRIX_OFF: ([number, number, number, number] | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

interface Core {
  memory: WebAssembly.Memory;
  gs_init(sr: number, poly: number): void;
  gs_set_param(id: number, value: number): void;
  gs_note_on(note: number, velocity: number): void;
  gs_process(frames: number): void;
  gs_left_ptr(): number;
  gs_right_ptr(): number;
  gs_fx_graph_sync(): void;
  gs_ir_import_ptr(): number;
  gs_ir_capacity(): number;
  gs_ir_import(len: number): number;
  gs_delay_pool_capacity(): number;
  gs_delay_pool_used(): number;
  gs_delay_max_seconds(): number;
  gs_conv_pool_capacity(): number;
  gs_conv_pool_used(): number;
  gs_fx_mod_slots(): number;
  gs_set_mod_route(index: number, src: number, dst: number, amount: number, enabled: number): void;
}

/** A patch with every effect running, so the routing is audible. */
function patch(overrides: Record<number, number>): Record<number, number> {
  return {
    ...DEFAULT_PARAMS,
    [Param.OSC1_ON]: 1,
    [Param.OSC1_WAVE]: 2,
    [Param.OSC1_LEVEL]: 0.8,
    [Param.OSC2_ON]: 0,
    [Param.FILTER_CUTOFF]: 16000,
    [Param.FILTER_ENV_AMT]: 0,
    [Param.LFO_ON]: 0,
    [Param.LFO2_ON]: 0,
    [Param.FX_REVERB_ON]: 1,
    [Param.FX_REVERB_MIX]: 0.3,
    [Param.FX_DELAY_ON]: 1,
    [Param.FX_DELAY_MIX]: 0.25,
    [Param.FX_DELAY_FB]: 0.4,
    [Param.FX_CHORUS_ON]: 1,
    [Param.FX_CHORUS_MIX]: 0.5,
    [Param.FX_FLANGER_ON]: 1,
    [Param.FX_FLANGER_MIX]: 0.4,
    [Param.FX_PHASER_ON]: 1,
    [Param.FX_PHASER_MIX]: 0.4,
    [Param.FX_DRIVE_ON]: 1,
    [Param.FX_DRIVE_MIX]: 0.5,
    ...overrides,
  };
}

/** Render a note and return every sample of both channels. */
function render(params: Record<number, number>, syncGraph: boolean): number[] {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
    .exports as unknown as Core;
  ex.gs_init(SR, 16);
  // The chain is written before the mapping is derived, exactly as the UI does.
  for (const [id, value] of Object.entries(params)) ex.gs_set_param(Number(id), value);
  if (syncGraph) {
    const values = graphFromChain((id) => params[id] ?? DEFAULT_PARAMS[id] ?? 0);
    GRAPH_FROM_CHAIN_IDS.forEach((id, index) => ex.gs_set_param(id, values[index]));
  }
  ex.gs_note_on(60, 0.9);
  const out: number[] = [];
  const left = ex.gs_left_ptr() / 4;
  const right = ex.gs_right_ptr() / 4;
  for (let block = 0; block < 30; block++) {
    ex.gs_process(128);
    const heap = new Float32Array(ex.memory.buffer);
    for (let i = 0; i < 128; i++) {
      out.push(heap[left + i], heap[right + i]);
    }
  }
  return out;
}

const chainOf = (kinds: number[]) => Object.fromEntries(kinds.map((kind, slot) => [chainId(slot), kind]));

/**
 * A render with a controllable length and, more importantly, a place to write
 * graph parameters *after* the chain→graph sync. The P7.2 tests need that: the
 * sync owns the node gains and would overwrite a base gain written before it.
 *
 * `routes` clears the eight-slot modulation matrix first (a `null` entry
 * disables a row), so a test can separate the per-voice matrix from the
 * in-graph edges instead of measuring both at once.
 */
function renderFor(
  params: Record<number, number>,
  blocks: number,
  options: {
    syncGraph?: boolean;
    post?: Record<number, number>;
    routes?: ([number, number, number, number] | null)[];
  } = {},
): number[] {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
    .exports as unknown as Core;
  ex.gs_init(SR, 16);
  if (options.routes) {
    options.routes.forEach((route, index) => {
      if (route) ex.gs_set_mod_route(index, route[0], route[1], route[2], route[3]);
      else ex.gs_set_mod_route(index, 0, 0, 0, 0);
    });
  }
  for (const [id, value] of Object.entries(params)) ex.gs_set_param(Number(id), value);
  if (options.syncGraph) {
    const values = graphFromChain((id) => params[id] ?? DEFAULT_PARAMS[id] ?? 0);
    GRAPH_FROM_CHAIN_IDS.forEach((id, index) => ex.gs_set_param(id, values[index]));
  }
  for (const [id, value] of Object.entries(options.post ?? {})) ex.gs_set_param(Number(id), value);
  ex.gs_note_on(60, 0.9);
  const out: number[] = [];
  const left = ex.gs_left_ptr() / 4;
  const right = ex.gs_right_ptr() / 4;
  for (let block = 0; block < blocks; block++) {
    ex.gs_process(128);
    const heap = new Float32Array(ex.memory.buffer);
    for (let i = 0; i < 128; i++) out.push(heap[left + i], heap[right + i]);
  }
  return out;
}

/** Worst absolute difference between two equal-length renders. */
function worstDiff(a: number[], b: number[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

/**
 * A Hann-windowed Goertzel magnitude of one frequency, over the samples after
 * `skipSeconds` (the first blocks hold the gain smoother's ramp and are not
 * steady state). The window keeps the strong carrier from leaking into the
 * sideband bins; `windowSeconds` picks how much of the tail to measure.
 */
function goertzel(
  samples: number[],
  rate: number,
  freq: number,
  skipSeconds = 0,
  windowSeconds?: number,
): number {
  const start = Math.min(samples.length, Math.floor(skipSeconds * rate));
  const end =
    windowSeconds === undefined
      ? samples.length
      : Math.min(samples.length, start + Math.round(windowSeconds * rate));
  const n = end - start;
  const w = (2 * Math.PI * freq) / rate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
    sum += win;
    const s0 = samples[start + i] * win + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return (2 * Math.sqrt(real * real + imag * imag)) / sum;
}

/** The left channel only, so a sideband is not smeared by the stereo pair. */
const leftOnly = (interleaved: number[]) => interleaved.filter((_, i) => i % 2 === 0);


describe.skipIf(!existsSync(wasmPath))('effect routing graph', () => {
  it('reproduces the legacy chain sample for sample', () => {
    const cases: { name: string; params: Record<number, number> }[] = [
      { name: 'default chain', params: patch({}) },
      {
        name: 'reordered with a send',
        params: patch({
          ...chainOf([6, 0, 1, 0, 2, 3]),
          [parallelId(0)]: 1,
        }),
      },
      {
        name: 'one effect, later positions empty',
        params: patch(chainOf([2, 0, 0, 0, 0, 0])),
      },
      {
        name: 'nothing in the chain at all',
        params: patch(chainOf([0, 0, 0, 0, 0, 0])),
      },
    ];
    for (const entry of cases) {
      const legacy = render(entry.params, false);
      const graph = render(entry.params, true);
      expect(legacy.some((v) => Math.abs(v) > 0.01), `${entry.name}: silent`).toBe(true);
      let worst = 0;
      for (let i = 0; i < legacy.length; i++) worst = Math.max(worst, Math.abs(legacy[i] - graph[i]));
      expect(worst, `${entry.name} differs from the chain by ${worst}`).toBe(0);
    }
  });

  it('maps the chain the way the engine does', () => {
    // The engine can derive the graph itself (`gs_fx_graph_sync`); the UI's
    // mirror has to agree with it, or editing the graph would start from a
    // different routing than the one the patch is playing.
    const params = patch({ ...chainOf([4, 0, 6, 0, 1, 0]), [parallelId(2)]: 1 });
    const mirrored = graphFromChain((id) => params[id] ?? DEFAULT_PARAMS[id] ?? 0);

    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
      .exports as unknown as Core;
    ex.gs_init(SR, 16);
    for (const [id, value] of Object.entries(params)) ex.gs_set_param(Number(id), value);
    ex.gs_fx_graph_sync();
    // Render both ways: the mirror's values must give the same audio as the
    // engine's own derivation.
    const fromMirror = render(params, true);
    const ex2 = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
      .exports as unknown as Core;
    ex2.gs_init(SR, 16);
    for (const [id, value] of Object.entries(params)) ex2.gs_set_param(Number(id), value);
    ex2.gs_fx_graph_sync();
    ex2.gs_note_on(60, 0.9);
    const engineValues: number[] = [];
    const left = ex2.gs_left_ptr() / 4;
    const right = ex2.gs_right_ptr() / 4;
    for (let block = 0; block < 30; block++) {
      ex2.gs_process(128);
      const heap = new Float32Array(ex2.memory.buffer);
      for (let i = 0; i < 128; i++) engineValues.push(heap[left + i], heap[right + i]);
    }
    expect(mirrored).toHaveLength(GRAPH_FROM_CHAIN_IDS.length);
    let worst = 0;
    for (let i = 0; i < engineValues.length; i++) {
      worst = Math.max(worst, Math.abs(engineValues[i] - fromMirror[i]));
    }
    expect(worst, `mirror differs from the engine by ${worst}`).toBe(0);
    expect(FX_SLOTS).toBe(6);
  });

  /**
   * P7.1: the pools have to fit a second node of each kind, and the editor's
   * mirrored capacity constants have to be the core's — otherwise the editor
   * would disable (or offer) a node the engine treats differently.
   */
  it('agrees with the editor about the delay and convolution pools', () => {
    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
      .exports as unknown as Core;
    ex.gs_init(SR, 16);
    // The default chain holds one delay and one algorithmic reverb.
    expect(ex.gs_delay_pool_capacity()).toBe(FX_DELAY_INSTANCES);
    expect(ex.gs_conv_pool_capacity()).toBe(FX_CONV_INSTANCES);
    expect(ex.gs_delay_max_seconds()).toBeCloseTo(FX_DELAY_MAX_SECONDS, 5);
    expect(ex.gs_delay_pool_used()).toBe(1);
    expect(ex.gs_conv_pool_used()).toBe(0);

    // A second delay node takes the second line; a third would have to wait.
    ex.gs_set_param(chainId(2), 1);
    expect(ex.gs_delay_pool_used()).toBe(2);
    ex.gs_set_param(chainId(3), 1);
    expect(ex.gs_delay_pool_used()).toBe(FX_DELAY_INSTANCES);

    // Convolution only counts once a response is actually loaded.
    expect(ex.gs_conv_pool_used()).toBe(0);
    const len = 8192;
    const capacity = Math.min(len, ex.gs_ir_capacity());
    const ptr = ex.gs_ir_import_ptr() / 4;
    const heap = new Float32Array(ex.memory.buffer);
    for (let i = 0; i < capacity; i++) heap[ptr + i] = Math.sin(i * 0.01) * Math.exp(-i / 1000);
    expect(ex.gs_ir_import(capacity)).toBe(0);
    ex.gs_set_param(Param.FX_REVERB_MODE, 1);
    expect(ex.gs_conv_pool_used()).toBe(1);
    // Node 3's reverb joins the first one; the pool is what stops the third.
    ex.gs_set_param(chainId(4), 2);
    expect(ex.gs_conv_pool_used()).toBe(FX_CONV_INSTANCES);
  });

  /**
   * P7.2: in-graph modulation.
   *
   * An edge carries `depth * source` on top of one node gain, resolved once per
   * block and written through the same one-pole smoother the host parameters
   * use. Depth 0 has to be *exactly* transparent — that is what lets an edge be
   * drawn without the sound moving until the player turns it up — and the
   * matrix's per-voice routes must keep working either way.
   */
  it('agrees with the core about the in-graph edge count', () => {
    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {})
      .exports as unknown as Core;
    ex.gs_init(SR, 16);
    expect(ex.gs_fx_mod_slots()).toBe(FX_MOD_SLOTS);
    expect(FX_MOD_GAIN_TARGETS).toBe(FX_SLOTS * 3);
  });

  it('is bit for bit transparent at depth 0, with the matrix on and off', () => {
    const base = patch({
      ...chainOf([1, 2, 0, 0, 0, 0]),
      [Param.LFO_ON]: 1,
      [Param.LFO_RATE]: 20,
    });
    const edge = {
      [graphModSrcId(0)]: 1,
      [graphModDstId(0)]: graphModDst(0, 2),
      [graphModDepthId(0)]: 0,
    };
    for (const routes of [undefined, MATRIX_OFF]) {
      const without = renderFor(base, 40, { syncGraph: true, routes });
      const withEdge = renderFor({ ...base, ...edge }, 40, { syncGraph: true, routes });
      expect(without.some((v) => Math.abs(v) > 0.01), 'silent render').toBe(true);
      expect(worstDiff(without, withEdge), 'depth 0 changed the render').toBe(0);
    }
  });

  it('ignores a destination outside the node gains', () => {
    const base = patch({
      ...chainOf([1, 0, 0, 0, 0, 0]),
      [Param.LFO_ON]: 1,
      [Param.LFO_RATE]: 20,
    });
    const outOfRange = {
      ...base,
      [graphModSrcId(0)]: 1,
      [graphModDstId(0)]: FX_MOD_GAIN_TARGETS + 100,
      [graphModDepthId(0)]: 1,
    };
    const plain = renderFor(base, 20, { syncGraph: true, routes: MATRIX_OFF });
    const clamped = renderFor(outOfRange, 20, { syncGraph: true, routes: MATRIX_OFF });
    expect(worstDiff(plain, clamped), 'a bad target must read as no edge').toBe(0);
  });

  it('sums two edges that land on the same gain', () => {
    const base = patch({
      ...chainOf([1, 0, 0, 0, 0, 0]),
      [Param.LFO_ON]: 1,
      [Param.LFO_RATE]: 7,
    });
    const target = graphModDst(0, 2);
    const one = {
      ...base,
      [graphModSrcId(0)]: 1,
      [graphModDstId(0)]: target,
      [graphModDepthId(0)]: 0.5,
    };
    const two = {
      ...base,
      [graphModSrcId(0)]: 1,
      [graphModDstId(0)]: target,
      [graphModDepthId(0)]: 0.3,
      [graphModSrcId(1)]: 1,
      [graphModDstId(1)]: target,
      [graphModDepthId(1)]: 0.2,
    };
    // Same source, same smoother target every block: 0.3 + 0.2 is 0.5 up to the
    // last bit of the f32 sum (the order of the two adds is not the same).
    expect(
      worstDiff(renderFor(one, 60, { syncGraph: true }), renderFor(two, 60, { syncGraph: true })),
    ).toBeLessThan(1e-6);
  });

  it('puts sidebands at the LFO rate on a modulated node gain', () => {
    const f0 = 261.6255653;
    // A rate of f0 / 8 puts f0 and f0 ± lfo on whole-number cycles of the
    // analysis window, so the carrier cannot leak into the sideband bins.
    const lfo = f0 / 8;
    const window = 96 / f0;
    const base = patch({
      ...chainOf([0, 0, 0, 0, 0, 0]),
      [Param.OSC1_WAVE]: 0, // a sine carrier, so the sidebands are unmistakable
      [Param.OSC2_ON]: 0,
      [Param.FILTER_CUTOFF]: 18000,
      [Param.FILTER_ENV_AMT]: 0,
      [Param.LFO_ON]: 1,
      [Param.LFO_WAVE]: 0,
      [Param.LFO_RATE]: lfo,
    });
    // The node's own base gain, set after the chain→graph sync.
    const post = { [graphOutGainId(0)]: 0.5 };
    const flat = leftOnly(renderFor(base, 250, { syncGraph: true, post, routes: MATRIX_OFF }));
    const modulated = leftOnly(
      renderFor(
        {
          ...base,
          [graphModSrcId(0)]: 1,
          [graphModDstId(0)]: graphModDst(0, 2),
          [graphModDepthId(0)]: 0.5,
        },
        250,
        { syncGraph: true, post, routes: MATRIX_OFF },
      ),
    );
    const carrier = goertzel(flat, SR, f0, 0.3, window);
    expect(carrier, 'no carrier to modulate').toBeGreaterThan(0.002);
    // A flat gain has no sideband; the edge puts one at f0 ± 20 whose
    // amplitude is half the carrier for a depth of 0.5 around a base of 0.5.
    const flatSide = goertzel(flat, SR, f0 - lfo, 0.3, window);
    const side = goertzel(modulated, SR, f0 - lfo, 0.3, window);
    expect(flatSide, 'sideband without the edge').toBeLessThan(carrier * 0.02);
    expect(side, 'sideband with the edge').toBeGreaterThan(carrier * 0.05);
    expect(side, 'the carrier must survive').toBeLessThan(carrier);
  });

  it('stays bounded at the deepest edge, positive and negative', () => {
    const base = patch({
      ...chainOf([0, 0, 0, 0, 0, 0]),
      [Param.OSC1_WAVE]: 0,
      [Param.OSC2_ON]: 0,
      [Param.FILTER_CUTOFF]: 18000,
      [Param.FILTER_ENV_AMT]: 0,
      [Param.LFO_ON]: 1,
      [Param.LFO_RATE]: 9,
    });
    for (const depth of [1, -1]) {
      const out = renderFor(
        {
          ...base,
          [graphModSrcId(0)]: 1,
          [graphModDstId(0)]: graphModDst(0, 2),
          [graphModDepthId(0)]: depth,
        },
        120,
        { syncGraph: true, post: { [graphOutGainId(0)]: 0 }, routes: MATRIX_OFF },
      );
      expect(out.every((v) => Number.isFinite(v)), `depth ${depth} produced a non-finite sample`).toBe(true);
      const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, `depth ${depth} peaked at ${peak}`).toBeLessThan(2);
    }
  });

  it('coexists with the matrix, which keeps running per voice', () => {
    const base = patch({
      ...chainOf([0, 0, 0, 0, 0, 0]),
      [Param.OSC1_WAVE]: 0,
      [Param.OSC2_ON]: 0,
      [Param.FILTER_CUTOFF]: 18000,
      [Param.FILTER_ENV_AMT]: 0,
      [Param.LFO_ON]: 1,
      [Param.LFO_RATE]: 20,
    });
    // One live matrix row: LFO 1 -> volume, at control rate and per voice.
    const routes: ([number, number, number, number] | null)[] = [
      [0, 2, 0.5, 1],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const edge = {
      [graphModSrcId(0)]: 1,
      [graphModDstId(0)]: graphModDst(0, 2),
    };
    const matrixOnly = renderFor(base, 60, { syncGraph: true, routes });
    const withZero = renderFor({ ...base, ...edge, [graphModDepthId(0)]: 0 }, 60, {
      syncGraph: true,
      routes,
    });
    const both = renderFor({ ...base, ...edge, [graphModDepthId(0)]: 0.4 }, 60, {
      syncGraph: true,
      routes,
    });
    const flat = renderFor(base, 60, { syncGraph: true, routes: MATRIX_OFF });
    // The matrix is audible on its own, the zero-depth edge does not disturb
    // it, and the live edge changes the result on top of it.
    expect(worstDiff(flat, matrixOnly), 'the matrix row did nothing').toBeGreaterThan(0.001);
    expect(worstDiff(matrixOnly, withZero), 'depth 0 disturbed the matrix').toBe(0);
    expect(worstDiff(matrixOnly, both), 'the edge had no effect').toBeGreaterThan(0.001);
    expect(both.every((v) => Number.isFinite(v))).toBe(true);
  });
  /**
   * Per-node effect parameter overrides (P9.3).
   *
   * The three claims the batch rests on are all bit-level, so they are checked
   * as bits: an unset slot leaves the render *identical* (not close), one
   * node's override leaves a same-kind sibling *identical*, and two overrides
   * differ from each other.
   */
  it('leaves the render bit for bit alone until a slot is overridden', () => {
    const base = patch({
      ...chainOf([1, 1, 0, 0, 0, 0]),
      [Param.FX_DELAY_ON]: 1,
      [Param.FX_DELAY_MIX]: 0.35,
      [Param.FX_DELAY_FB]: 0.4,
    });
    // A patch whose override ids are written with the sentinel is not a
    // different patch: the parameter is stored, and the renderer still reads
    // the kind's own value.
    const withSentinel: Record<number, number> = {
      ...base,
      [ovrId(0, 0)]: FX_OVR_UNSET,
      [ovrId(1, 1)]: FX_OVR_UNSET,
      [Param.FX_OVR_SRC]: 0,
    };
    const plain = renderFor(base, 40, { syncGraph: true });
    const sentinel = renderFor(withSentinel, 40, { syncGraph: true });
    expect(worstDiff(plain, sentinel), 'an unset slot changed the render').toBe(0);
    // ...and the ids really are in the pool, not silently ignored.
    expect(ovrId(0, 0)).toBe(Param.FX_OVR1_1);
    expect(ovrId(FX_SLOTS - 1, FX_OVR_SLOTS - 1)).toBe(Param.FX_OVR6_4);
  });

  it('gives two nodes of the same kind independent parameters', () => {
    const base = patch({
      ...chainOf([1, 1, 0, 0, 0, 0]),
      [Param.FX_DELAY_ON]: 1,
      [Param.FX_DELAY_MIX]: 0.35,
      [Param.FX_DELAY_FB]: 0.4,
    });
    // Node 1 gets its own delay time. 0.5 s of line is longer than a short
    // render, so the window has to outlast the echo: 400 blocks is 1.07 s at
    // 48 kHz, which is why the assertions below would read "no difference" on
    // a 60-block window even with a working override.
    const short = renderFor({ ...base, [ovrId(1, 0)]: 0.05 }, 400, { syncGraph: true });
    const long = renderFor({ ...base, [ovrId(1, 0)]: 0.5 }, 400, { syncGraph: true });
    expect(worstDiff(short, long), 'the delay-time override did nothing').toBeGreaterThan(0.001);
    // Feedback on node 2 alone: its repeats must change.
    const noFb = renderFor({ ...base, [ovrId(1, 1)]: 0.0 }, 400, { syncGraph: true });
    const someFb = renderFor({ ...base, [ovrId(1, 1)]: 0.85 }, 400, { syncGraph: true });
    expect(worstDiff(noFb, someFb), 'the feedback override did nothing').toBeGreaterThan(0.001);
    // Node 1's own parameters are untouched by either write: overriding node
    // 2's feedback leaves a render that only overrides node 1's time bit for
    // bit where node 1's contribution is concerned. The two nodes are in
    // series, so the check is the whole render: node 1's parameters are the
    // only thing the two patches below share.
    const node1Time = renderFor({ ...base, [ovrId(0, 0)]: 0.05 }, 400, { syncGraph: true });
    const node1TimeAgain = renderFor({ ...base, [ovrId(0, 0)]: 0.05 }, 400, { syncGraph: true });
    expect(worstDiff(node1Time, node1TimeAgain)).toBe(0);
    // Node 1's time and node 2's feedback are independently settable: four
    // combinations, all different from each other.
    const combos = [
      renderFor({ ...base, [ovrId(0, 0)]: 0.05, [ovrId(1, 1)]: 0.1 }, 400, { syncGraph: true }),
      renderFor({ ...base, [ovrId(0, 0)]: 0.05, [ovrId(1, 1)]: 0.8 }, 400, { syncGraph: true }),
      renderFor({ ...base, [ovrId(0, 0)]: 0.5, [ovrId(1, 1)]: 0.1 }, 400, { syncGraph: true }),
      renderFor({ ...base, [ovrId(0, 0)]: 0.5, [ovrId(1, 1)]: 0.8 }, 400, { syncGraph: true }),
    ];
    for (let i = 0; i < combos.length; i++) {
      for (let j = i + 1; j < combos.length; j++) {
        expect(
          worstDiff(combos[i], combos[j]),
          `combination ${i} and ${j} are indistinguishable`,
        ).toBeGreaterThan(0.001);
      }
    }
  });

  it('sweeps one override slot without touching the others', () => {
    const base = patch({
      ...chainOf([1, 1, 0, 0, 0, 0]),
      [Param.FX_DELAY_ON]: 1,
      [Param.FX_DELAY_MIX]: 0.35,
    });
    const bus = {
      [ovrTargetBusId(0)]: ovrSlotCode(0, 0),
      [ovrDepthBusId(0)]: 0.4,
    };
    const off = renderFor({ ...base, ...bus, [Param.FX_OVR_SRC]: 0 }, 400, { syncGraph: true });
    const still = renderFor({ ...base, ...bus }, 400, { syncGraph: true });
    const lfo1 = renderFor(
      { ...base, ...bus, [Param.FX_OVR_SRC]: 1, [Param.LFO_ON]: 1, [Param.LFO_RATE]: 2 },
      400,
      { syncGraph: true },
    );
    expect(worstDiff(off, still), 'no source must be exactly no sweep').toBe(0);
    expect(worstDiff(off, lfo1), 'the sweep did nothing').toBeGreaterThan(0.001);
    // A slot that is not named stays put: node 2's delay time is not touched,
    // so its own dry-plus-wet contribution is what it always was. The check is
    // that the bus names exactly the pair it says it does.
    expect(ovrTargetSlot(ovrSlotCode(0, 0))).toEqual({ node: 0, slot: 0 });
    expect(ovrTargetSlot(ovrSlotCode(0, 0))).not.toEqual({ node: 0, slot: 1 });
  });

  /**
   * Every override slot's AudioParam has to accept the widest value any kind
   * can put in it.
   *
   * The engine clamps a slot to its own kind's range, but the browser clamps
   * the AudioParam *first*: a table narrowed to 0..1 would silently turn an EQ
   * corner into 1 Hz and crush bits into 1. The worklet is a standalone asset
   * with no imports, so the table is read as text and checked here.
   */
  it('widens the override AudioParam range to the widest slot', () => {
    const source = readFileSync('src/audio/worklet-processor.js', 'utf8');
    const table = new Map(
      [...source.matchAll(/\['(fxOvr\d+_\d+)',\s*\d+,\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\]/g)].map(
        (m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])]],
      ),
    );
    expect(table.size).toBe(FX_OVR_POOL);
    const widest = Math.max(
      ...FX_KINDS.flatMap((kind) =>
        Array.from({ length: FX_OVR_SLOTS }, (_, slot) => ovrSlotRange(kind, slot)[1]),
      ),
    );
    const lowest = Math.min(
      ...FX_KINDS.flatMap((kind) =>
        Array.from({ length: FX_OVR_SLOTS }, (_, slot) => ovrSlotRange(kind, slot)[0]),
      ),
    );
    for (const [name, [def, min, max]] of table) {
      expect(def, `${name} default must be the sentinel`).toBe(FX_OVR_UNSET);
      // The sentinel is the lowest value an AudioParam ever has to carry, and
      // it is below every legal range (the lowest is -18 dB on an EQ band).
      expect(min, `${name} min must carry the sentinel`).toBeLessThanOrEqual(FX_OVR_UNSET);
      expect(max, `${name} max must reach ${widest}`).toBeGreaterThanOrEqual(widest);
    }
    expect(widest).toBe(8000);
    expect(lowest).toBe(-18);
  });

  it('keeps the pool, the slot ranges and the bus inside their budgets', () => {
    // Four columns per node, six nodes, shared by every kind: 24 values, 24
    // ids, and nothing that scales with kind.
    expect(FX_OVR_POOL).toBe(24);
    expect(ovrId(FX_SLOTS - 1, FX_OVR_SLOTS - 1)).toBe(Param.FX_OVR1_1 + FX_OVR_POOL - 1);
    // Ranges are per (kind, column): delay time is seconds, crush is 4..16
    // bits, an EQ band is -18..18 dB.
    expect(ovrSlotRange('delay', 0)).toEqual([0.001, FX_DELAY_MAX_SECONDS]);
    expect(ovrSlotRange('crush', 0)).toEqual([4, 16]);
    expect(ovrSlotRange('eq', 0)).toEqual([-18, 18]);
    expect(ovrSlotRange('eq', 3)).toEqual([200, 8000]);
    // A target past the pool reads as "off" rather than wrapping onto another
    // node's slot; the engine clamps it, the model mirrors it.
    expect(ovrTargetSlot(0)).toBeNull();
    expect(ovrTargetSlot(FX_OVR_POOL + 1)).toBeNull();
    expect(ovrTargetSlot(FX_OVR_POOL)).toEqual({ node: 5, slot: 3 });
    // The bus holds eight entries, and its ids sit after the pool.
    expect(FX_OVR_MOD_SLOTS).toBe(8);
    expect(ovrTargetBusId(0)).toBe(Param.FX_OVR1_1 + FX_OVR_POOL);
    expect(ovrDepthBusId(0)).toBe(ovrTargetBusId(FX_OVR_MOD_SLOTS - 1) + 1);
    expect(Param.FX_OVR_SRC).toBe(ovrDepthBusId(FX_OVR_MOD_SLOTS - 1) + 1);
  });

  it('carries overrides through a share code round trip', () => {
    const params: Record<number, number> = {
      ...DEFAULT_PARAMS,
      ...chainOf([1, 1, 0, 0, 0, 0]),
      [ovrId(0, 0)]: 0.375,
      [ovrId(1, 3)]: 0.8,
      [ovrId(4, 1)]: 0.25,
      [ovrTargetBusId(2)]: ovrSlotCode(1, 0),
      [ovrDepthBusId(2)]: -0.5,
      [Param.FX_OVR_SRC]: 2,
    };
    const state = { params, params2: { ...params }, routes: [], power: true };
    const code = encodePatch(state);
    const decoded = decodePatch(code);
    expect(decoded).not.toBeNull();
    for (const id of [
      ovrId(0, 0),
      ovrId(1, 3),
      ovrId(4, 1),
      ovrTargetBusId(2),
      ovrDepthBusId(2),
      Param.FX_OVR_SRC,
    ]) {
      expect(decoded!.params[id], `id ${id} did not survive`).toBe(params[id]);
    }
    // The sentinel travels too: an unset slot comes back unset, not zero.
    expect(decoded!.params[ovrId(2, 2)]).toBe(FX_OVR_UNSET);
    // And a code written before the feature still decodes: the payload is
    // positional, so an old array simply stops at the old length.
    const oldIds = Object.keys(DEFAULT_PARAMS)
      .map(Number)
      .filter((id) => id < Param.FX_OVR1_1)
      .sort((a, b) => a - b);
    const oldPayload = JSON.stringify({ s: 1, v: oldIds.map((id) => DEFAULT_PARAMS[id]), r: [] });
    const oldCode = `gs1.1.${Buffer.from(oldPayload, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}`;
    const oldDecoded = decodePatch(oldCode);
    expect(oldDecoded).not.toBeNull();
    expect(oldDecoded!.params[Param.FX_DELAY_FB]).toBe(DEFAULT_PARAMS[Param.FX_DELAY_FB]);
    expect(oldDecoded!.params[ovrId(0, 0)]).toBe(FX_OVR_UNSET);
  });

  it('carries overrides through a graph template', () => {
    const params: Record<number, number> = {
      ...DEFAULT_PARAMS,
      ...chainOf([1, 2, 0, 0, 0, 0]),
      [ovrId(0, 0)]: 0.125,
      [ovrId(0, 1)]: 0.6,
      [ovrId(1, 0)]: 0.9,
    };
    expect(FX_TEMPLATE_PARAM_IDS).toContain(ovrId(1, 0));
    expect(FX_TEMPLATE_PARAM_IDS).not.toContain(ovrTargetBusId(0));
    expect(FX_TEMPLATE_PARAM_IDS).not.toContain(Param.FX_OVR_SRC);
    // The reverb mode and the impulse response still cannot ride in a template.
    expect(FX_TEMPLATE_PARAM_IDS).not.toContain(Param.FX_REVERB_MODE);
    expect(FX_TEMPLATE_PARAM_IDS).not.toContain(Param.FX_CONV_TRIM);
    const body = captureFxTemplateParams((id) => params[id] ?? DEFAULT_PARAMS[id] ?? 0);
    expect(body[ovrId(0, 0)]).toBe(0.125);
    expect(body[ovrId(1, 0)]).toBe(0.9);
    const stored = JSON.parse(JSON.stringify(body));
    const clean = normalizeTemplateParams(stored);
    expect(clean).not.toBeNull();
    expect(clean![ovrId(0, 0)]).toBe(0.125);
    expect(clean![ovrId(0, 1)]).toBe(0.6);
    // Applying writes exactly the whitelisted ids, overrides included.
    const entries = fxTemplateEntries({ id: 'x', name: 'x', params: clean! });
    expect(entries.every(([id]) => FX_TEMPLATE_PARAM_IDS.includes(id))).toBe(true);
    expect(entries.find(([id]) => id === ovrId(1, 0))?.[1]).toBe(0.9);
    // Junk is clamped, not trusted: a slot far out of range comes back as the
    // sentinel-free bound rather than as a wild number.
    const junk = normalizeTemplateParams({ [ovrId(0, 1)]: 999, [ovrId(0, 0)]: -50 });
    expect(junk![ovrId(0, 1)]).toBe(64);
    expect(junk![ovrId(0, 0)]).toBe(FX_OVR_UNSET);
  });

  /**
   * A node's slot values survive a change of kind (P9.3).
   *
   * The columns are a shared pool, so column 1 means "this node's column 1",
   * read through whatever effect the node runs now: the value is kept and
   * reinterpreted, never cleared. That is the only rule that does not silently
   * destroy work when a player auditions a different effect in the same node,
   * and it is what makes a share code or a template unambiguous — they carry
   * the numbers, and the kind that is stored with them says how to read them.
   */
  it('keeps a node\'s slots when its kind changes, and says how to read them', () => {
    const delay: Record<number, number> = {
      ...DEFAULT_PARAMS,
      ...chainOf([1, 0, 0, 0, 0, 0]),
      [ovrId(0, 0)]: 0.4,
      [ovrId(0, 1)]: 0.8,
    };
    const reverb: Record<number, number> = {
      ...delay,
      [Param.FX_CHAIN1]: 2,
    };
    // The numbers are untouched by the change of kind...
    expect(reverb[ovrId(0, 0)]).toBe(0.4);
    expect(reverb[ovrId(0, 1)]).toBe(0.8);
    // ...and what they *mean* comes from the kind the file stores alongside.
    const delayCode = decodePatch(encodePatch({ params: delay, params2: { ...delay }, routes: [], power: true }));
    const reverbCode = decodePatch(
      encodePatch({ params: reverb, params2: { ...reverb }, routes: [], power: true }),
    );
    expect(delayCode!.params[Param.FX_CHAIN1]).toBe(1);
    expect(reverbCode!.params[Param.FX_CHAIN1]).toBe(2);
    for (const id of [ovrId(0, 0), ovrId(0, 1)]) {
      expect(delayCode!.params[id]).toBe(delay[id]);
      expect(reverbCode!.params[id]).toBe(reverb[id]);
    }
    // A template carries the same pair, so applying it cannot read 0.4 as
    // anything but that node's delay time (or its size, with the kind that
    // travels beside it).
    const body = captureFxTemplateParams((id) => reverb[id] ?? DEFAULT_PARAMS[id] ?? 0);
    expect(body[Param.FX_CHAIN1]).toBe(2);
    expect(body[ovrId(0, 0)]).toBe(0.4);
    expect(normalizeTemplateParams(JSON.parse(JSON.stringify(body)))?.[ovrId(0, 0)]).toBe(0.4);
    // Switching back gives the delay settings again: nothing was cleared.
    const back = normalizeTemplateParams(
      JSON.parse(JSON.stringify(captureFxTemplateParams((id) => delay[id] ?? DEFAULT_PARAMS[id] ?? 0))),
    );
    expect(back![ovrId(0, 0)]).toBe(0.4);
    expect(back![ovrId(0, 1)]).toBe(0.8);
  });

  /**
   * Pointing a node's bus row at a new slot moves the pair (P9.3).
   *
   * The core stores eight independent rows, but the editor shows one per node.
   * Without this rule, changing the slot a node's row sweeps would leave the
   * *old* slot still being swept by a row the player can no longer see.
   */
  it('moves a node\'s modulation with it when the row changes slot', () => {
    const params: Record<number, number> = {
      ...DEFAULT_PARAMS,
      [ovrTargetBusId(0)]: ovrSlotCode(0, 0),
      [ovrDepthBusId(0)]: 0.5,
      [Param.FX_OVR_SRC]: 1,
    };
    const moved = Object.fromEntries(ovrUnifyBusEntries(params, 0, 1, FX_OVR_MOD_SLOTS));
    // The row now names column 1, the amount came along, and no other row was
    // disturbed.
    let target = 0;
    let depth = 0;
    for (let bus = 0; bus < FX_OVR_MOD_SLOTS; bus += 1) {
      if ((moved[ovrTargetBusId(bus)] ?? 0) !== 0) {
        target = moved[ovrTargetBusId(bus)];
        depth = moved[ovrDepthBusId(bus)];
      }
    }
    expect(target).toBe(ovrSlotCode(0, 1));
    expect(depth).toBe(0.5);
    // The old slot is no longer named by anything.
    const codes = Array.from({ length: FX_OVR_MOD_SLOTS }, (_, bus) =>
      moved[ovrTargetBusId(bus)] ?? 0,
    );
    expect(codes).not.toContain(ovrSlotCode(0, 0));
    // A row that is turned off keeps a depth of zero, so nothing is hidden.
    const off = Object.fromEntries(ovrUnifyBusEntries(params, 0, 1, FX_OVR_MOD_SLOTS));
    expect(Object.values(off)).not.toContain(ovrSlotCode(0, 0));
  });
});
