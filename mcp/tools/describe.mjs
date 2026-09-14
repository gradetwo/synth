/**
 * `gs1.describe` — what this synthesizer is, from the core itself.
 *
 * The counts and limits come from the running wasm (`gs_abi_version`,
 * `gs_max_block_size`, `gs_sample_capacity`, `gs_arena_free_bytes`) and from
 * the Rust constants for the two things wasm does not export (the 12 MiB arena
 * size and `MAX_BASE_SAMPLES`); the enums come from `src/audio/params.ts`. None
 * of it is a hand-written list in `mcp/`.
 */
import {
  initCore, ex, SR, BLOCK, arenaFreeBytes, allocViolations,
} from '../../scripts/lib/render-core.mjs';
import { parameterTable, packageVersion, rustConst } from '../lib/data.mjs';

export default {
  name: 'gs1.describe',
  description:
    'Report the engine build: version, ABI, parameter count, sample rate, arena headroom and every enum an agent needs to build a patch.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (_args, ctx) => {
    const { data } = ctx;
    initCore();
    const params = parameterTable(data);
    const arenaCapacity = rustConst('crates/synth-core/src/alloc_arena.rs', 'ARENA_SIZE');
    const maxBaseSamples = rustConst('crates/synth-core/src/dsp/sampler.rs', 'MAX_BASE_SAMPLES');
    return {
      name: 'GS-1',
      version: packageVersion(),
      abi: ex.gs_abi_version(),
      paramCount: params.length,
      sampleRate: SR,
      blockSize: BLOCK,
      maxBlockSize: ex.gs_max_block_size(),
      maxVoices: ex.gs_max_voices(),
      arena: {
        capacityBytes: arenaCapacity,
        freeBytes: arenaFreeBytes(),
        allocViolations: allocViolations(),
      },
      sampler: {
        maxBaseSamples,
        importCapacity: ex.gs_sample_capacity(),
        /** P9.8 import return codes, surfaced unchanged. */
        importCodes: { ok: 0, short: 1, silent: 2, notFinite: 3, noRoom: 4 },
      },
      enums: {
        waves: data.WAVES,
        waveNamesZh: data.WAVE_CN,
        filterTypes: data.FILTER_TYPES,
        lfoWaves: data.LFO_WAVES,
        lfoTargets: data.LFO_TARGETS,
        delaySyncs: data.DELAY_SYNCS,
        fxKinds: data.FX_KINDS,
        fxSlots: data.FX_SLOTS,
        fxModSlots: data.FX_MOD_SLOTS,
        modSources: data.MOD_SOURCES,
        modDests: data.MOD_DESTS,
      },
      presets: { count: data.FACTORY_PRESETS.length, categories: data.PRESET_CATEGORIES },
      /** Which layer a render happens at, stated in the result so no caller has to guess. */
      layer: {
        render: 'wasm core in Node (scripts/lib/render-core.mjs)',
        rulers: 'scripts/lib/audio-ruler.mjs',
        excludes:
          'AudioWorklet, AudioParam automation and the Web Audio graph — those are the browser layer, ' +
          'a separate entry point ("npm run mcp:ui", tools in mcp/ui/tools/, port 4796)',
      },
    };
  },
};
