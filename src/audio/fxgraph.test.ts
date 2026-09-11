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
  FX_SLOTS,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  chainId,
  graphFromChain,
  parallelId,
} from './params';

const wasmPath = 'src/generated/synth_core.wasm';
const SR = 48_000;

interface Core {
  memory: WebAssembly.Memory;
  gs_init(sr: number, poly: number): void;
  gs_set_param(id: number, value: number): void;
  gs_note_on(note: number, velocity: number): void;
  gs_process(frames: number): void;
  gs_left_ptr(): number;
  gs_right_ptr(): number;
  gs_fx_graph_sync(): void;
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
});
