/**
 * Parser fuzzing.
 *
 * Every parser in the app that reads something the user did not type — a share
 * code, a patch file, a `.gs1song`, a MIDI file, a Scala scale, a WAV, a stored
 * waveform — is a door into the program, and the data behind it arrives from a
 * chat client, a download folder or a phone's storage. The contract each one has
 * to keep is the same, and it is what these tests assert:
 *
 *   **either the input is rejected, or what comes back is a legal object —
 *   and the parser never throws anything it did not document, never hangs.**
 *
 * Inputs are generated from a fixed seed, so a failure prints the seed, the
 * case index and a copy-pasteable sample: the reproduction is the failure
 * message. Three shapes are mixed, because pure noise rarely reaches deep code:
 * random bytes/text, *mutations of a valid file* (truncated, bit-flipped, with
 * lengths rewritten), and adversarial structures (absurd counts, huge keys,
 * deep nesting, repeats).
 *
 * What "legal" means for each parser is checked in `check`, and the checks are
 * deliberately about invariants a *consumer* relies on — finite numbers, in
 * range, inside the caps — not about matching the parser's own code.
 */

import { beforeEach, describe, expect, it, type TaskContext } from 'vitest';
import { DEFAULT_PARAMS } from '@/audio/params';
// P14.2: the budget below is a *timing* gate, so it asks the host the same
// question `scripts/bench.mjs` and `scripts/verify-audio.mjs` ask, through the
// same module. The criteria and the 4000 ms budget are unchanged.
import { timingTrust, PROBE_REFERENCE_US } from '../scripts/lib/host-load.mjs';
import { decodeMidi } from '@/audio/midi';
import { parseInterval, parseScala, type ScalaScale } from '@/audio/scala';
import { decodeSamples16, encodeSamples, parseWav } from '@/audio/wavefile';
import { decodeUserWave, encodeUserWave } from '@/audio/userWave';
import { parseMidi, writeMidi, type MidiSong } from '@/midi/smf';
import { parsePatchFile } from '@/state/patchfile';
import { decodePatch, encodePatch, readShareCode, type PatchPayload } from '@/state/share';
import { unwrap, wrap } from '@/state/persist';

/** Inputs per parser. The plan asks for ten thousand each; all of them run. */
const RUNS = 10_000;
/** A parser taking longer than this on 10k inputs is stuck, not slow. */
const BUDGET_MS = 4000;

/**
 * Timing readings collected by `runFuzz`, judged by `finishTiming`.
 *
 * P14.2: this budget is a wall-clock gate with no load probe until now, and on
 * a busy host it read 4050/4252/6001/7945 ms on code that reads 442/656/452/328
 * ms in a quiet window — a red that looks exactly like a parser regression and
 * is not one. The probe is shared with the other two timing gates now, the
 * reading is printed on the passing path too (the margin is the number the last
 * sweep could not see), and readings are *collected* rather than asserted
 * inline so a busy host does not abort a test halfway through its parsers: the
 * correctness work all runs, then the verdict says the clock was not judged.
 */
const timings: { name: string; runs: number; elapsed: number; budget: number }[] = [];

// ----------------------------------------------------------------- the harness

/** mulberry32: 32-bit state, deterministic on every platform and Node version. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random: () => number, count: number): number => Math.floor(random() * count);

function randomBytes(random: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = pick(random, 256);
  return out;
}

function concatBytes(a: Uint8Array, at: number, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a.subarray(0, at), 0);
  out.set(b, at);
  out.set(a.subarray(at), at + b.length);
  return out;
}

/**
 * A mutation of a real file: a few corruptions, sometimes truncated, sometimes
 * with junk appended. This is where parsers actually fall over, because it is
 * the first input that gets past the format check.
 */
function mutateBytes(sample: Uint8Array, random: () => number): Uint8Array<ArrayBuffer> {
  let out = Uint8Array.from(sample);
  const ops = 1 + pick(random, 6);
  for (let i = 0; i < ops; i += 1) {
    const kind = pick(random, 7);
    if (out.length === 0) break;
    if (kind === 0) out[pick(random, out.length)] ^= 1 << pick(random, 8);
    else if (kind === 1) out[pick(random, out.length)] = pick(random, 256);
    else if (kind === 2) out[pick(random, out.length)] = 0xff;
    else if (kind === 3) out[pick(random, out.length)] = 0x00;
    else if (kind === 4) out = concatBytes(out, pick(random, out.length + 1), randomBytes(random, 1 + pick(random, 8)));
    else if (kind === 5) {
      // Rewrite a 32-bit big-endian length to something absurd: parsers trust
      // those fields, and a fuzzer that never lies about a length is not trying.
      const at = pick(random, Math.max(1, out.length - 3));
      const huge = [0xff, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff][pick(random, 8)];
      out[at] = huge;
      out[at + 1] = huge;
      out[at + 2] = huge;
      out[at + 3] = huge;
    } else out[pick(random, out.length)] = pick(random, 2) ? 0x80 : 0x7f;
  }
  if (random() < 0.35) out = Uint8Array.from(out.subarray(0, pick(random, out.length + 1)));
  if (random() < 0.15) out = concatBytes(out, out.length, randomBytes(random, 1 + pick(random, 16)));
  return out;
}

const TEXT_ALPHABET = '0123456789.,/!%-+"{}[]:truefalsn\\ \n\r\t=abcXYZ😀\u0000\uD800';

function randomText(random: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += TEXT_ALPHABET[pick(random, TEXT_ALPHABET.length)];
  return out;
}

/** Longest mutated text. Volume is covered by the adversarial builders. */
const MAX_TEXT = 8192;

function mutateText(sample: string, random: () => number): string {
  let out = sample;
  const ops = 1 + pick(random, 5);
  for (let i = 0; i < ops; i += 1) {
    const kind = pick(random, 6);
    if (out.length === 0) {
      out = randomText(random, 1 + pick(random, 8));
      continue;
    }
    const at = pick(random, out.length);
    if (kind === 0) out = out.slice(0, at) + out.slice(at + 1);
    else if (kind === 1) out = out.slice(0, at) + randomText(random, 1) + out.slice(at);
    else if (kind === 2) out = out.replace('"', "'");
    else if (kind === 3) out = out.slice(at);
    else if (kind === 4) out = out + out.slice(at);
    else out = out.slice(0, at) + out.slice(at).toUpperCase();
    if (out.length > MAX_TEXT) out = out.slice(0, MAX_TEXT);
  }
  return out;
}

/** JSON built to break a reader: absurd counts, huge keys, deep nesting. */
function adversarialJson(random: () => number): string {
  const kind = pick(random, 6);
  if (kind === 0) return `{"format":"gs1-preset","params":{"${'9'.repeat(1 + pick(random, 40))}":1}}`;
  if (kind === 1) {
    // Four times the cap on parameters: enough to prove the cap holds without
    // spending the whole budget in `JSON.parse`.
    const entries = Array.from({ length: 600 }, (_, i) => `"${i}":${i}`).join(',');
    return `{"format":"gs1-preset","params":{${entries}}}`;
  }
  if (kind === 2) return `{"format":"gs1-preset","params":${'['.repeat(1 + pick(random, 50))}`;
  if (kind === 3) return `{"format":"gs1-preset","params":{"1":${'1e' + '9'.repeat(1 + pick(random, 400))}}}`;
  if (kind === 4) {
    const routes = Array.from({ length: 300 }, () => '["lfo1","cutoff",0.5,1]').join(',');
    return `{"format":"gs1-preset","params":{"1":0.5},"routes":[${routes}]}`;
  }
  return `{"format":"gs1-song","code":"${'A'.repeat(1 + pick(random, 200_000))}"}`;
}

interface FuzzSpec<T, O> {
  name: string;
  seed: number;
  build: (index: number, random: () => number) => T;
  parse: (input: T) => O;
  /** Errors this parser is allowed to raise; anything else is a crash. */
  allows?: (error: unknown) => boolean;
  check: (input: T, output: O) => void;
  runs?: number;
  budgetMs?: number;
}

/** Render an input for the failure message: enough to reproduce it by hand. */
function describeInput<T>(input: T): string {
  if (input instanceof Uint8Array) {
    return `${input.length} bytes: ${Array.from(input.slice(0, 64))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (typeof input === 'string') {
    return `${input.length} chars: ${JSON.stringify(input.slice(0, 160))}`;
  }
  return JSON.stringify(input)?.slice(0, 200) ?? String(input);
}

function runFuzz<T, O>(spec: FuzzSpec<T, O>): void {
  const runs = spec.runs ?? RUNS;
  const random = makeRandom(spec.seed);
  const started = Date.now();
  for (let index = 0; index < runs; index += 1) {
    const input = spec.build(index, random);
    let output: O;
    try {
      output = spec.parse(input);
    } catch (error) {
      if (spec.allows?.(error)) continue;
      throw new Error(
        `${spec.name}: threw where it documented nothing (seed ${spec.seed}, case ${index})\n` +
          `  ${describeInput(input)}`,
        { cause: error },
      );
    }
    try {
      spec.check(input, output);
    } catch (error) {
      throw new Error(
        `${spec.name}: produced an illegal object (seed ${spec.seed}, case ${index})\n` +
          `  ${describeInput(input)}\n  ${(error as Error)?.message ?? error}`,
        { cause: error },
      );
    }
  }
  const elapsed = Date.now() - started;
  const budget = spec.budgetMs ?? BUDGET_MS;
  // Always, pass or fail: a green with no visible margin is how a budget that
  // was one hiccup from red looks fine, and a red with no number is how three
  // agents read a busy host as a regression.
  console.log(
    `[fuzz] ${spec.name}: ${runs} inputs in ${elapsed} ms of ${budget} ms budget ` +
      `(${(((budget - elapsed) / budget) * 100).toFixed(1)}% headroom)`,
  );
  timings.push({ name: spec.name, runs, elapsed, budget });
}

/**
 * Judge the timing readings this test collected — or say, visibly, why the host
 * cannot. Called at the end of every `it`, after all of its parsers have run.
 */
function finishTiming(ctx: TaskContext): void {
  const collected = timings.splice(0, timings.length);
  if (collected.length === 0) return;
  const host = timingTrust();
  if (!host.trusted) {
    console.warn(
      `[fuzz] timing not judged — ${host.reason} ` +
        `(load ${host.load.toFixed(1)} on ${host.cpus} cpus, cpu probe ${host.probeUs.toFixed(0)} µs ` +
        `vs ${PROBE_REFERENCE_US} µs idle); readings: ` +
        collected.map((t) => `${t.name} ${t.elapsed} ms/${t.budget} ms`).join(', '),
    );
    // Vitest 2.1.9 has the runtime skip, and a skip is a *visible* state in the
    // summary — which is the point: `passed` would hide that the budget was
    // never judged. If this ever stops working, fall back to the warning above
    // plus skipping only this assertion (never a red).
    ctx.skip();
  }
  for (const t of collected) {
    expect(
      t.elapsed,
      `${t.name}: ${t.runs} inputs took ${t.elapsed} ms (budget ${t.budget} ms)`,
    ).toBeLessThan(t.budget);
  }
}

/** `it` for a parser test: the timing verdict is part of every one of them. */
function itFuzz(name: string, body: () => void): void {
  it(name, (ctx) => {
    body();
    finishTiming(ctx);
  });
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Checks run once per generated input, sometimes per element of one, so they
 * throw plain errors instead of going through `expect`: the harness turns any
 * throw into a reproduction, and a matcher call per sample would cost more than
 * every parser put together.
 */
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// ------------------------------------------------------------------- corpora

const song: MidiSong = {
  name: 'fuzz',
  bpm: 120,
  duration: 2.4,
  notes: [
    { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
    { note: 64, velocity: 0.6, start: 0.5, duration: 0.5 },
    { note: 67, velocity: 0.9, start: 1.5, duration: 1 },
  ],
};

const validMidiBytes = writeMidi(song.notes, { bpm: song.bpm, name: song.name });
const validMidi = (): Uint8Array => validMidiBytes;

/** A minimal 16-bit mono PCM WAV, built here so the fuzzer has a real file. */
function validWav(): Uint8Array {
  const frames = 512;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) {
    view.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 20000), true);
  }
  return bytes;
}

const validScala = ['! fuzz.scl', 'Fuzz scale', ' 5', ' 100.0', ' 3/2', ' 700.0 cents', ' 2/1', ''].join('\n');
const validCycle = new Float32Array(2048).map((_, i) => Math.sin((i / 2048) * Math.PI * 2));
/** Big enough to pass the `CYCLE_LENGTH` check, so accepted cases are real. */
const validWaveJson = encodeUserWave({ name: 'fuzz', cycle: validCycle });
/** A short one: the sample-blob parser has no length floor. */
const shortSamples = encodeSamples(new Float32Array(32).map((_, i) => Math.sin(i)));

const fakeState = {
  params: { ...DEFAULT_PARAMS },
  params2: { ...DEFAULT_PARAMS },
  routes: [],
} as unknown as Parameters<typeof encodePatch>[0];

const validCode = (): string =>
  encodePatch(fakeState, {
    routing: { mode: 'layer', splitNote: 60 },
    song: { name: 'fuzz', midi: validMidi(), mix: [[false, 0.8, -0.5, 1.5]] },
  });

const validPatchFile = (): string =>
  JSON.stringify({
    format: 'gs1-preset',
    name: 'Imported',
    params: { '1': 1, '2': 3, '14': 440, '999': 0.5 },
    routes: [{ src: 'lfo1', dst: 'cutoff', amount: 0.5, enabled: true }],
    params2: { '1': 1 },
    instanceMode: 'layer',
    splitNote: 60,
  });

const validSongFile = (): string => JSON.stringify({ format: 'gs1-song', schema: 2, code: validCode() });

// --------------------------------------------------------------- the parsers

describe('parser fuzzing', () => {
  // A test that threw a correctness error never reached its verdict; do not
  // let its readings leak into the next test's judgement.
  beforeEach(() => {
    timings.length = 0;
  });
  itFuzz('share codes: decodePatch and readShareCode', () => {
    const code = validCode();
    const urls = [
      `https://synth.wangda.today/#p=${code}`,
      `#p=${code}`,
      code,
      `https://example.test/?x=1#p=${code}&y=2`,
      `HTTPS://SYNTH.WANGDA.TODAY/#P=${code}`,
    ];
    runFuzz<string, PatchPayload | null>({
      name: 'decodePatch',
      seed: 0x5eed_0001,
      build: (index, random) => {
        const kind = index % 5;
        if (kind === 0) return mutateText(code, random);
        if (kind === 1) return `gs1.1.${randomText(random, 1 + pick(random, 400))}`;
        if (kind === 2) return `gs1.2.${randomText(random, 1 + pick(random, 400))}`;
        if (kind === 3) return code.slice(0, pick(random, code.length + 1)) + randomText(random, pick(random, 32));
        return randomText(random, 1 + pick(random, 200));
      },
      parse: (input) => decodePatch(input),
      check: (_input, payload) => {
        if (payload === null) return;
        for (const [id, value] of Object.entries(payload.params)) {
          assert(finite(Number(id)), `param id ${id} is not a number`);
          assert(finite(value), `param ${id} = ${value} is not finite`);
        }
        for (const route of payload.routes) {
          assert(typeof route.src === 'string', 'route source is not a string');
          assert(typeof route.dst === 'string', 'route target is not a string');
          assert(Math.abs(route.amount) <= 1, `route amount ${route.amount} is out of range`);
        }
        if (payload.instanceMode !== null) {
          assert(['single', 'layer', 'split'].includes(payload.instanceMode), 'unknown layer mode');
        }
        if (payload.song) {
          // A song that survives the share-code parser must survive the MIDI
          // parser: the two are one pipeline and neither may throw.
          const parsed = parseMidi(payload.song.midi);
          for (const note of parsed.notes) {
            assert(finite(note.start) && finite(note.duration), 'shared song note has no time');
          }
          assert(typeof payload.song.name === 'string', 'shared song name is not a string');
        }
      },
    });

    runFuzz<string, string | null>({
      name: 'readShareCode',
      seed: 0x5eed_0002,
      build: (index, random) => {
        const kind = index % 4;
        if (kind === 0) return mutateText(urls[pick(random, urls.length)], random);
        if (kind === 1) return randomText(random, pick(random, 64));
        if (kind === 2) return `https://synth.wangda.today/#p=${mutateText(code, random)}`;
        return randomText(random, 200) + code;
      },
      parse: (input) => readShareCode(input),
      check: (_input, found) => {
        if (found === null) return;
        // Whatever it hands on has to be something decodePatch understands.
        assert(
          typeof found === 'string' && (found.startsWith('gs1.1.') || found.startsWith('gs1.2.')),
          `not a share code: ${String(found).slice(0, 40)}`,
        );
      },
    });
  });

  itFuzz('patch files: parsePatchFile', () => {
    const preset = validPatchFile();
    const arrangement = validSongFile();
    runFuzz<string, ReturnType<typeof parsePatchFile>>({
      name: 'parsePatchFile',
      seed: 0x5eed_0003,
      build: (index, random) => {
        const kind = index % 6;
        if (kind === 0) return mutateText(preset, random);
        if (kind === 1) return mutateText(arrangement, random);
        if (kind === 2) return adversarialJson(random);
        if (kind === 3) return randomText(random, pick(random, 400));
        if (kind === 4) {
          return JSON.stringify({ format: 'gs1-preset', params: { '1': random() * 10 ** pick(random, 8) } });
        }
        return `${preset}${randomText(random, pick(random, 32))}`;
      },
      parse: (input) => parsePatchFile(input),
      check: (_input, file) => {
        if (file === null) return;
        if (file.kind === 'song') {
          assert(typeof file.code === 'string', 'song file without a code');
          assert(file.code.length <= 200_000, `code of ${file.code.length} chars passed the cap`);
          return;
        }
        const { preset: parsed } = file;
        assert(parsed.tag === 'IMPORTED', `unexpected tag ${parsed.tag}`);
        assert(parsed.name.length > 0, 'empty preset name');
        assert(parsed.name.length <= 120, `name of ${parsed.name.length} chars passed the cap`);
        for (const value of Object.values(parsed.params)) assert(finite(value), 'param is not finite');
        const cap = 512 + Object.keys(DEFAULT_PARAMS).length;
        assert(Object.keys(parsed.params).length <= cap, 'more parameters than the cap allows');
        const routes = parsed.routes ?? [];
        assert(Array.isArray(routes), 'routes is not a list');
        assert(routes.length <= 64, `${routes.length} routes passed the cap`);
        for (const route of routes) {
          assert(typeof route.src === 'string', 'route source is not a string');
          assert(typeof route.dst === 'string', 'route target is not a string');
          assert(Math.abs(route.amount) <= 1, `route amount ${route.amount} is out of range`);
        }
        if (parsed.params2) {
          for (const value of Object.values(parsed.params2)) assert(finite(value), 'layer param is not finite');
        }
        if (parsed.splitNote !== undefined) {
          assert(Number.isInteger(parsed.splitNote), 'split note is not an integer');
          assert(parsed.splitNote >= 0 && parsed.splitNote <= 127, `split note ${parsed.splitNote}`);
        }
      },
    });
  });

  itFuzz('MIDI files: parseMidi', () => {
    const midi = validMidi();
    runFuzz<Uint8Array, MidiSong>({
      name: 'parseMidi',
      seed: 0x5eed_0004,
      build: (index, random) => {
        const kind = index % 4;
        if (kind === 0) return mutateBytes(midi, random);
        if (kind === 1) return randomBytes(random, pick(random, 200));
        if (kind === 2) return midi.slice(0, pick(random, midi.length + 1));
        // A header that promises far more tracks than the file holds.
        const lying = midi.slice();
        if (lying.length > 12) {
          lying[10] = 0xff;
          lying[11] = 0xff;
        }
        return lying;
      },
      parse: (input) => parseMidi(input),
      allows: (error) =>
        error instanceof Error && ['not a MIDI file', 'SMPTE time division is not supported'].includes(error.message),
      check: (_input, parsed) => {
        assert(finite(parsed.bpm), `bpm is ${parsed.bpm}`);
        assert(parsed.bpm > 0, `bpm is ${parsed.bpm}`);
        assert(finite(parsed.duration), `duration is ${parsed.duration}`);
        assert(parsed.duration >= 0, 'negative duration');
        for (const note of parsed.notes) {
          assert(finite(note.note) && note.note >= 0 && note.note <= 127, `note number ${note.note}`);
          assert(
            finite(note.velocity) && note.velocity >= 0 && note.velocity <= 1,
            `velocity ${note.velocity}`,
          );
          assert(finite(note.start), `start ${note.start}`);
          assert(finite(note.duration) && note.duration >= 0, `duration ${note.duration}`);
        }
        for (const track of parsed.tracks ?? []) {
          assert(typeof track.name === 'string', 'track name is not a string');
          for (const note of track.notes) assert(note.note <= 127, `layer note ${note.note}`);
        }
      },
    });
  });

  itFuzz('Scala scale files: parseScala and parseInterval', () => {
    runFuzz<string, ScalaScale>({
      name: 'parseScala',
      seed: 0x5eed_0005,
      build: (index, random) => {
        const kind = index % 5;
        if (kind === 0) return mutateText(validScala, random);
        if (kind === 1) return randomText(random, pick(random, 300));
        if (kind === 2) return `! c\nname\n${pick(random, 1000)}\n${randomText(random, pick(random, 40))}`;
        if (kind === 3) return `${validScala}\n${Array.from({ length: 200 }, () => randomText(random, 6)).join('\n')}`;
        return validScala.slice(0, pick(random, validScala.length + 1));
      },
      parse: (input) => parseScala(input),
      allows: (error) => error instanceof Error && error.message.startsWith('scala.'),
      check: (_input, scale) => {
        assert(scale.degrees.length >= 1 && scale.degrees.length <= 128, `${scale.degrees.length} degrees`);
        for (const degree of scale.degrees) assert(finite(degree), `degree ${degree}`);
        assert(finite(scale.period) && scale.period > 0, `period ${scale.period}`);
        assert(typeof scale.name === 'string', 'scale name is not a string');
      },
    });

    runFuzz<string, number>({
      name: 'parseInterval',
      seed: 0x5eed_0006,
      build: (index, random) => {
        if (index % 3 === 0) return randomText(random, pick(random, 40));
        if (index % 3 === 1) return `${randomText(random, pick(random, 8))}/${randomText(random, pick(random, 8))}`;
        return `${pick(random, 10 ** 6)}.${pick(random, 1000)} cents`;
      },
      parse: (input) => parseInterval(input),
      allows: (error) => error instanceof Error && error.message.startsWith('scala.'),
      check: (_input, cents) => assert(finite(cents), `interval is ${cents}`),
    });
  });

  itFuzz('WAV files: parseWav', () => {
    const wav = validWav();
    runFuzz<ArrayBuffer, ReturnType<typeof parseWav>>({
      name: 'parseWav',
      seed: 0x5eed_0007,
      build: (index, random) => {
        const kind = index % 4;
        const bytes =
          kind === 0
            ? mutateBytes(wav, random)
            : kind === 1
              ? randomBytes(random, pick(random, 400))
              : kind === 2
                ? wav.slice(0, pick(random, wav.length + 1))
                : mutateBytes(randomBytes(random, 44 + pick(random, 600)), random);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
      parse: (input) => parseWav(input),
      check: (_input, decoded) => {
        if (decoded === null) return;
        // Floating-point samples may legitimately be infinite here: it is the
        // importer, one layer up, that rejects those, so only the shape is a
        // promise of this parser.
        assert(decoded.samples instanceof Float32Array, 'samples are not a Float32Array');
        assert(finite(decoded.sampleRate) && decoded.sampleRate >= 1000, `rate ${decoded.sampleRate}`);
      },
    });

    runFuzz<string, Float32Array | null>({
      name: 'decodeSamples16',
      seed: 0x5eed_0008,
      build: (index, random) => {
        if (index % 3 === 0) return mutateText(shortSamples, random);
        if (index % 3 === 1) return randomText(random, pick(random, 300));
        return shortSamples.slice(0, pick(random, shortSamples.length + 1));
      },
      parse: (input) => decodeSamples16(input),
      check: (_input, samples) => {
        if (samples === null) return;
        assert(samples instanceof Float32Array, 'samples are not a Float32Array');
        for (const value of samples) assert(finite(value), `sample ${value}`);
      },
    });
  });

  itFuzz('stored waveforms and envelopes: decodeUserWave, unwrap', () => {
    runFuzz<string, ReturnType<typeof decodeUserWave>>({
      name: 'decodeUserWave',
      seed: 0x5eed_0009,
      build: (index, random) => {
        const kind = index % 4;
        if (kind === 0) return mutateText(validWaveJson, random);
        if (kind === 1) return randomText(random, pick(random, 300));
        if (kind === 2) return JSON.stringify({ schema: 99, name: 'x', samples: randomText(random, 40) });
        return validWaveJson.slice(0, pick(random, validWaveJson.length + 1));
      },
      parse: (input) => decodeUserWave(input),
      check: (_input, wave) => {
        if (wave === null) return;
        assert(typeof wave.name === 'string', 'wave name is not a string');
        assert(wave.cycle instanceof Float32Array, 'cycle is not a Float32Array');
        assert(wave.cycle.length > 0, 'empty cycle');
        for (const value of wave.cycle) assert(finite(value), `cycle sample ${value}`);
      },
    });

    runFuzz<unknown, ReturnType<typeof unwrap>>({
      name: 'unwrap',
      seed: 0x5eed_000a,
      build: (index, random) => {
        const kind = index % 5;
        if (kind === 0) return wrap({ a: 1, b: [1, 2, 3] });
        if (kind === 1) return { schema: pick(random, 6), data: randomText(random, pick(random, 20)) };
        if (kind === 2) return random();
        if (kind === 3) return [randomText(random, pick(random, 10)), pick(random, 100)];
        return { schema: 'nope', data: null };
      },
      parse: (input) => unwrap(input),
      check: (_input, result) => {
        if (result === null) return;
        assert(finite(result.schema), `schema ${result.schema}`);
        assert('data' in result, 'unwrapped payload has no data');
      },
    });
  });

  itFuzz('Web MIDI messages: decodeMidi', () => {
    const messages: number[][] = [
      [0x90, 60, 100],
      [0x80, 60, 0],
      [0xb0, 1, 64],
      [0xb0, 64, 127],
      [0xb0, 123, 0],
      [0xa0, 60, 40],
      [0xd0, 40],
      [0xe0, 0, 64],
      [0xf8],
      [0x90, 60],
      [0x90, 60, 100, 5],
      [0x00, 0x00],
    ];
    runFuzz<number[], ReturnType<typeof decodeMidi>>({
      name: 'decodeMidi',
      seed: 0x5eed_000b,
      build: (index, random) => {
        const kind = index % 4;
        if (kind === 0) return messages[pick(random, messages.length)].slice();
        if (kind === 1) return Array.from(randomBytes(random, pick(random, 6)));
        if (kind === 2) {
          // The declared type is `ArrayLike<number>`, and a device driver that
          // hands over a hole or a string is still this function's input.
          const weird = messages[pick(random, messages.length)].slice();
          const at = pick(random, weird.length);
          weird[at] = [NaN, Infinity, -1, 300, 1e9, undefined as unknown as number, 'x' as unknown as number][
            pick(random, 7)
          ];
          return weird;
        }
        const base = messages[pick(random, messages.length)].slice();
        return base.map((byte) => byte ^ (1 << pick(random, 8)));
      },
      parse: (input) => decodeMidi(input),
      check: (_input, action) => {
        if (action === null) return;
        if ('note' in action) {
          assert(Number.isInteger(action.note) && action.note >= 0 && action.note <= 127, `note ${action.note}`);
        }
        if ('channel' in action) {
          assert(
            Number.isInteger(action.channel) && action.channel >= 0 && action.channel <= 15,
            `channel ${action.channel}`,
          );
        }
        if ('value' in action) {
          assert(finite(action.value) && Math.abs(action.value) <= 1, `value ${action.value}`);
          if (action.type === 'cc') {
            assert(Math.abs(action.value) <= 1, `cc value ${action.value}`);
          }
        }
        if (action.type === 'cc') {
          assert(
            Number.isInteger(action.controller) && action.controller >= 0 && action.controller <= 127,
            `controller ${action.controller}`,
          );
        }
      },
    });
  });
});
