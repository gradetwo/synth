/**
 * Patch serialization: file export/import and URL share links.
 *
 * A patch is encoded as a compact base64url JSON payload: values in parameter-id
 * order plus the modulation routes. Version-prefixed so the format can evolve.
 */

import {
  DEFAULT_PARAMS,
  modDstToInt,
  modSrcToInt,
  intToModDst,
  intToModSrc,
  type ModRoute,
  type SynthState,
} from '@/audio/params';
import { SCHEMA_VERSION } from './persist';

const PREFIX = 'gs1.1.';
/**
 * Codes whose payload is deflate-compressed before base64.
 *
 * A share link carrying a whole arrangement is dominated by the MIDI bytes, and
 * base64 makes them a third bigger again; deflating first keeps a five-minute
 * song inside a URL. Only used when the browser has `CompressionStream`
 * (Chrome 80+, Safari 16.4+, Firefox 113+), and the plain format stays readable
 * for ever, so nothing depends on it.
 */
const PREFIX_DEFLATE = 'gs1.2.';

/** The code prefix, for tests that build a historical payload by hand. */
export const PREFIX_FOR_TEST = PREFIX;

function base64UrlEncode(text: string): string {
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let text = '';
  // Chunked so a long song cannot blow the argument limit of `String.fromCharCode`.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return base64UrlEncode(text);
}

function bytesFromBase64Url(code: string): Uint8Array | null {
  const text = base64UrlDecode(code);
  if (text === null) return null;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function base64UrlDecode(code: string): string | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(code.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return null;
  }
}

/**
 * A whole arrangement carried by a share code (B).
 *
 * The notes travel as a real MIDI file — the same writer the export uses — so a
 * share link is decoded by the parser that is already tested rather than by a
 * second format. The layer mix rides alongside because MIDI has nowhere to put
 * "this track is muted here".
 */
export interface SharedSong {
  name: string;
  midi: Uint8Array;
  /** Per layer: [muted, volume, pan, offset]. */
  mix: [boolean, number, number, number][];
}

export interface PatchPayload {
  params: Record<number, number>;
  /** The second layer, when the code carries one that differs from the default. */
  params2: Record<number, number> | null;
  /** Layer / split routing, when the code carries a layer. */
  instanceMode: 'single' | 'layer' | 'split' | null;
  splitNote: number | null;
  routes: ModRoute[];
  /** The arrangement, when the code carries one. */
  song: SharedSong | null;
}

/** Longest share code (and therefore URL) the synth will copy. */
export const MAX_SHARE_CODE = 12000;

/** The JSON payload a share code carries. */
function buildPayload(
  state: SynthState,
  options?: {
    routing?: { mode: 'single' | 'layer' | 'split'; splitNote: number };
    song?: SharedSong;
  },
): Record<string, unknown> {
  const ids = Object.keys(DEFAULT_PARAMS)
    .map(Number)
    .sort((a, b) => a - b);
  const values = ids.map((id) => Math.round((state.params[id] ?? DEFAULT_PARAMS[id]) * 10000) / 10000);
  const routes = state.routes.map((r) => [
    modSrcToInt(r.src),
    modDstToInt(r.dst),
    Math.round(r.amount * 1000) / 1000,
    r.enabled ? 1 : 0,
  ]);
  // The second layer only goes into the code when it is actually used: most
  // patches have no layer, and an extra hundred numbers would double the link
  // for nothing.
  const layered = ids.some(
    (id) => Math.round((state.params2[id] ?? DEFAULT_PARAMS[id]) * 10000) / 10000 !== values[ids.indexOf(id)],
  );
  // The routing travels with the layer, or the recipient gets the sound but
  // plays it as a single instance.
  const route = options?.routing;
  const second = layered
    ? ids.map((id) => Math.round((state.params2[id] ?? DEFAULT_PARAMS[id]) * 10000) / 10000)
    : undefined;
  // `s` is the schema: a code from a newer build is refused rather than decoded
  // positionally into the wrong parameters.
  return {
    s: SCHEMA_VERSION,
    v: values,
    r: routes,
    ...(second ? { p2: second } : {}),
    ...(second && route ? { m: route.mode === 'layer' ? 1 : route.mode === 'split' ? 2 : 0, sn: route.splitNote } : {}),
    // The song: a base64 MIDI file plus the mix that makes it sound the way it
    // does here. Absent unless a code was asked to carry one.
    ...(options?.song
      ? {
          sg: base64UrlFromBytes(options.song.midi),
          sl: options.song.mix.map(([muted, volume, pan, offset]) => [
            muted ? 1 : 0,
            Math.round(volume * 1000) / 1000,
            Math.round(pan * 1000) / 1000,
            Math.round(offset * 100) / 100,
          ]),
          st: options.song.name,
        }
      : {}),
  };
}

/** Encode the current patch into a shareable code. */
export function encodePatch(
  state: SynthState,
  options?: {
    routing?: { mode: 'single' | 'layer' | 'split'; splitNote: number };
    song?: SharedSong;
  },
): string {
  return PREFIX + base64UrlEncode(JSON.stringify(buildPayload(state, options)));
}

function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // A fresh copy keeps the type a plain ArrayBuffer-backed view: the bytes come
  // from base64 and a `Uint8Array` over a larger buffer is not a valid source.
  void writer.write(Uint8Array.from(bytes));
  void writer.close();
  return new TextDecoder().decode(await new Response(stream.readable).arrayBuffer());
}

/**
 * Encode a share code, compressing it when the code carries an arrangement.
 *
 * Patch-only codes are already small and stay in the plain format, so an old
 * build can still read the common case.
 */
export async function encodePatchAsync(
  state: SynthState,
  options?: {
    routing?: { mode: 'single' | 'layer' | 'split'; splitNote: number };
    song?: SharedSong;
  },
): Promise<string> {
  const json = JSON.stringify(buildPayload(state, options));
  if (!options?.song || !canCompress()) return PREFIX + base64UrlEncode(json);
  try {
    return PREFIX_DEFLATE + base64UrlFromBytes(await deflate(json));
  } catch {
    // A browser that advertises the API but fails on the call still gets a link.
    return PREFIX + base64UrlEncode(json);
  }
}

/**
 * Decode a share code, inflating it first when it is a compressed one.
 *
 * Compressed codes are the ones that carry an arrangement, and nothing else can
 * produce them, so an old build reading a new link sees a code it does not
 * recognise rather than a patch decoded wrongly.
 */
export async function decodePatchAsync(code: string): Promise<PatchPayload | null> {
  if (!code.startsWith(PREFIX_DEFLATE)) return decodePatch(code);
  const bytes = bytesFromBase64Url(code.slice(PREFIX_DEFLATE.length));
  if (!bytes) return null;
  try {
    return parsePayload(await inflate(bytes));
  } catch {
    return null;
  }
}

export function decodePatch(code: string): PatchPayload | null {
  if (!code.startsWith(PREFIX)) return null;
  const json = base64UrlDecode(code.slice(PREFIX.length));
  if (!json) return null;
  return parsePayload(json);
}

/** Shared payload parsing, for both the plain and the compressed form. */
function parsePayload(json: string): PatchPayload | null {
  let parsed: {
    s?: unknown;
    v?: unknown;
    r?: unknown;
    p2?: unknown;
    m?: unknown;
    sn?: unknown;
    sg?: unknown;
    sl?: unknown;
    st?: unknown;
  };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.v)) return null;
  // Codes written before versioning carry no `s`; they are schema 1.
  const schema = typeof parsed.s === 'number' ? parsed.s : 1;
  if (schema > SCHEMA_VERSION) return null;

  // Parameter ids are append-only, and the values are stored in ascending id
  // order, so a code written before a parameter existed still lines up with the
  // parameters it did carry.
  const ids = Object.keys(DEFAULT_PARAMS)
    .map(Number)
    .sort((a, b) => a - b);
  const params: Record<number, number> = { ...DEFAULT_PARAMS };
  parsed.v.forEach((value, index) => {
    if (typeof value === 'number' && Number.isFinite(value)) params[ids[index]] = value;
  });

  // The second layer travels positionally just like the first; a code without
  // one leaves the receiver's own layer alone (null), which is the difference
  // between "this patch has no layer" and "this patch has the default layer".
  let params2: Record<number, number> | null = null;
  if (Array.isArray(parsed.p2)) {
    params2 = { ...DEFAULT_PARAMS };
    parsed.p2.forEach((value, index) => {
      if (typeof value === 'number' && Number.isFinite(value)) params2![ids[index]] = value;
    });
  }

  const routes: ModRoute[] = [];
  if (Array.isArray(parsed.r)) {
    for (const entry of parsed.r) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      routes.push({
        src: intToModSrc(Number(entry[0])),
        dst: intToModDst(Number(entry[1])),
        amount: Math.max(-1, Math.min(1, Number(entry[2]) || 0)),
        enabled: Boolean(entry[3]),
      });
    }
  }
  const mode = parsed.m === 1 ? 'layer' : parsed.m === 2 ? 'split' : parsed.m === 0 ? 'single' : null;
  const splitNote =
    typeof parsed.sn === 'number' && parsed.sn >= 0 && parsed.sn <= 127 ? Math.round(parsed.sn) : null;

  // The song is optional and self-validating: bytes that do not parse as MIDI
  // are dropped here rather than handed to the player.
  let song: SharedSong | null = null;
  if (typeof parsed.sg === 'string') {
    const midi = bytesFromBase64Url(parsed.sg);
    const mix = Array.isArray(parsed.sl)
      ? parsed.sl
          .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 4)
          .map((row) => [
            Number(row[0]) >= 0.5,
            Math.max(0, Math.min(1, Number(row[1]) || 0)),
            Math.max(-1, Math.min(1, Number(row[2]) || 0)),
            Math.max(-60, Math.min(60, Number(row[3]) || 0)),
          ] as [boolean, number, number, number])
      : [];
    if (midi && midi.length > 0) {
      song = { name: typeof parsed.st === 'string' ? parsed.st : 'Shared Song', midi, mix };
    }
  }

  return {
    params,
    params2,
    instanceMode: params2 ? mode : null,
    splitNote: params2 ? splitNote : null,
    routes,
    song,
  };
}

/** Full share URL for the current page. */
export function shareUrl(code: string): string {
  if (typeof window === 'undefined') return `#p=${code}`;
  const url = new URL(window.location.href);
  url.hash = `p=${code}`;
  return url.toString();
}

/** Read a `#p=...` code from the current location, if present. */
export function readShareCode(href?: string): string | null {
  const raw = href ?? (typeof window !== 'undefined' ? window.location.hash : '');
  // Accept a bare hash, a `#p=...` string or a whole URL: the callers pass
  // `location.hash`, but a link copied out of a chat is the whole thing.
  const afterHash = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const hash = afterHash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const code = params.get('p');
  // Both forms are share codes: the plain one and the deflated one an
  // arrangement travels in.
  return code && (code.startsWith(PREFIX) || code.startsWith(PREFIX_DEFLATE)) ? code : null;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  downloadBlob(filename, new Blob([text], { type }));
}
