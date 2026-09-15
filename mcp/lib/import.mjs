/**
 * Importing a sample or a wave cycle: decode, stage, ask the core, report.
 *
 * The three decisions this module makes, and why:
 *
 *   * **The app decodes, not `mcp/`.** `data.decodeSampleFile` and
 *     `data.decodeCycle` are `src/audio/wavefile.ts` — the same RIFF reader the
 *     file pickers use, including the cycle analysis (autocorrelation, a few
 *     cycles averaged). `mcp/` only turns bytes into a `Blob` and turns the
 *     decoder's refusal into a structured error.
 *   * **Over-capacity is refused, never truncated.** The browser's own
 *     `importUserSample` does `samples.subarray(0, SAMPLE_CAPACITY)`, which is
 *     fine for a person watching a knob move and wrong for an agent: it would
 *     silently measure a different file than the one it handed over. So the
 *     decoded length is checked against `gs_sample_capacity()` before staging,
 *     and a longer file is an `E_RANGE` naming the limit.
 *   * **The core's verdict is passed through, not re-derived.** `gs_sample_import`
 *     answers 0/1/2/3/4 (P9.8) and that number travels in the rejection as
 *     `importCode` with its name (`short`, `silent`, `notFinite`, `noRoom`).
 *     The tool never decides for itself that a file is silent or unloadable.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ERRORS, fail } from './errors.mjs';
import { resolveReadPath } from './paths.mjs';
import { arenaFreeBytes, ex, importSample, importWavetableCycle } from '../../scripts/lib/render-core.mjs';
import { codeName } from './session.mjs';

/** Read the bytes of the one source field the caller gave (`path` or the base64 one). */
export function readImportBytes(args, { pathField = 'path', base64Field, kind = 'file' } = {}) {
  const hasPath = args?.[pathField] !== undefined;
  const hasBase64 = args?.[base64Field] !== undefined;
  if (hasPath === hasBase64) {
    throw fail(ERRORS.SCHEMA, `provide exactly one of \`${pathField}\` or \`${base64Field}\``, {
      [pathField]: hasPath,
      [base64Field]: hasBase64,
    });
  }
  if (hasPath) {
    const path = args[pathField];
    if (typeof path !== 'string' || path.length === 0) {
      throw fail(ERRORS.SCHEMA, `\`${pathField}\` must be a non-empty string`, { field: pathField });
    }
    const absolute = resolveReadPath(path, pathField);
    try {
      return { name: basename(path), bytes: readFileSync(absolute) };
    } catch (error) {
      throw fail(ERRORS.WAV, `cannot read file: ${error?.message ?? error}`, { field: pathField, path });
    }
  }
  const text = args[base64Field];
  if (typeof text !== 'string' || text.length === 0) {
    throw fail(ERRORS.SCHEMA, `\`${base64Field}\` must be a non-empty base64 string`, { field: base64Field });
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length === 0) {
    throw fail(ERRORS.SCHEMA, `\`${base64Field}\` did not decode to any bytes`, { field: base64Field, kind });
  }
  return { name: `${kind}.wav`, bytes };
}

/** Decode a WAV (or anything the decoder knows) into `{ samples, sampleRate }`. */
export async function decodeSample(data, bytes) {
  try {
    return await data.decodeSampleFile(new Blob([bytes]));
  } catch (error) {
    throw decodeFailure(error, 'sample');
  }
}

/** Decode a file down to one cycle, using the app's own cycle analysis. */
export async function decodeCycle(data, bytes) {
  try {
    return await data.decodeCycle(new Blob([bytes]));
  } catch (error) {
    throw decodeFailure(error, 'wavetable');
  }
}

/**
 * A decoder refusal, structured.
 *
 * `decode` means "not a file this reader understands" (the WAV header is wrong
 * or the bytes are not audio) and is an `E_WAV`; the content refusals the cycle
 * analyser raises (`short`, `silent`, `notFinite`) are `E_IMPORT`, the same
 * vocabulary the core's own codes use.
 */
function decodeFailure(error, kind) {
  const name = error?.name === 'WaveImportError' ? error.code ?? 'decode' : 'decode';
  if (name === 'decode') {
    return fail(ERRORS.WAV, `the ${kind} is not a WAV (RIFF/WAVE PCM) file this repo can read`, {
      note: 'decode',
      source: 'decoder',
    });
  }
  return fail(ERRORS.IMPORT, `the ${kind} was refused by the decoder: ${name}`, {
    note: name,
    source: 'decoder',
  });
}

/**
 * Stage `samples` into the core's sampler and return its verdict.
 *
 * `importInto` is injectable for one reason: `noRoom` (code 4) cannot be
 * reached through the shipped 12 MiB arena — the repository's own Rust test
 * `the_longest_mipmap_fits_the_arena` asserts a 4-second import needs less than
 * half of it, and a direct probe (a 4 s sample plus a maximum-length IR) still
 * leaves ~7.9 MB free. The test that must exercise the refusal path therefore
 * replaces the single call that decides the verdict; everything else below (the
 * staging buffer, the arena measurement, the capacity check) is the real thing.
 */
export function runSampleImport(samples, rate, importInto = importSample) {
  const capacity = ex.gs_sample_capacity();
  // Create the staging buffer before reading the arena, so `poolBytes` is the
  // mipmap's own cost and not the one-time 768 KB scratch.
  ex.gs_sample_import_ptr();
  const before = arenaFreeBytes();
  const code = importInto(samples, rate);
  return { code, capacity, count: Math.min(samples.length, capacity), poolBytes: before - arenaFreeBytes() };
}

/** Stage one cycle into the core's wavetable bank and return its verdict. */
export function runWavetableImport(cycle, importInto = importWavetableCycle) {
  const capacity = ex.gs_wavetable_capacity();
  const code = importInto(cycle);
  return { code, capacity, count: cycle.length };
}

/** The structured rejection for a non-zero core import code. */
export function importRefusal(kind, result, detail = {}) {
  const note = codeName(result.code);
  return fail(ERRORS.IMPORT, `the core refused the ${kind}: ${note}`, {
    note,
    importCode: result.code,
    source: 'core',
    ...detail,
  });
}
