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

function base64UrlEncode(text: string): string {
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(code: string): string | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(code.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return null;
  }
}

export interface PatchPayload {
  params: Record<number, number>;
  /** The second layer, when the code carries one that differs from the default. */
  params2: Record<number, number> | null;
  routes: ModRoute[];
}

/** Encode the current patch into a shareable code. */
export function encodePatch(state: SynthState): string {
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
  const second = layered
    ? ids.map((id) => Math.round((state.params2[id] ?? DEFAULT_PARAMS[id]) * 10000) / 10000)
    : undefined;
  // `s` is the schema: a code from a newer build is refused rather than decoded
  // positionally into the wrong parameters.
  return PREFIX + base64UrlEncode(
    JSON.stringify({ s: SCHEMA_VERSION, v: values, r: routes, ...(second ? { p2: second } : {}) }),
  );
}

/** Decode a share code; returns null for anything malformed. */
export function decodePatch(code: string): PatchPayload | null {
  if (!code.startsWith(PREFIX)) return null;
  const json = base64UrlDecode(code.slice(PREFIX.length));
  if (!json) return null;
  let parsed: { s?: unknown; v?: unknown; r?: unknown; p2?: unknown };
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
  return { params, params2, routes };
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
  const hash = (href ?? (typeof window !== 'undefined' ? window.location.hash : '')).replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const code = params.get('p');
  return code && code.startsWith(PREFIX) ? code : null;
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
