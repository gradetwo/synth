/**
 * `.gs1.json` patch files and `.gs1song` arrangement files.
 *
 * Both are JSON on disk, and both come from *outside* — downloaded, mailed,
 * pasted from a forum — so this parser is written as a total function of its
 * text: junk in, `null` out, never a throw, never an allocation that the input
 * did not earn. Everything it returns is either a share code for the existing
 * importer to validate or a `Preset` built from validated fields.
 *
 * It lives apart from the store because parsing and *applying* are separate
 * concerns: the store owns the engine, this owns the format.
 */

import { DEFAULT_PARAMS, DEFAULT_ROUTES, clamp, intToWave, type ModRoute } from '@/audio/params';
import type { Preset } from './presets';

export type PatchFile =
  /** A share code in a box; the caller decodes it like any other code. */
  | { kind: 'song'; code: string }
  | { kind: 'preset'; preset: Preset };

/**
 * Caps on what a file may contain. The patch itself has 137 parameters and the
 * routing matrix a handful of rows, so a file claiming ten thousand of either is
 * not a file this app wrote: it is junk, or an attempt to make the importer
 * allocate until it falls over.
 */
const MAX_PARAM_ENTRIES = 512;
const MAX_ROUTES = 64;
const MAX_NAME_LENGTH = 120;
const MAX_CODE_LENGTH = 200_000;

/** Read a `{ "3": 0.5 }` parameter map, ignoring anything that is not a number. */
function readParams(raw: unknown): { params: Record<number, number>; count: number } {
  const params: Record<number, number> = { ...DEFAULT_PARAMS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { params, count: 0 };
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_PARAM_ENTRIES) break;
    const id = Number(key);
    if (!Number.isFinite(id) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    params[id] = value;
    count += 1;
  }
  return { params, count };
}

/** Read the routing rows, keeping only the ones with a source and a target. */
function readRoutes(raw: unknown): ModRoute[] {
  const fallback = () => DEFAULT_ROUTES.map((r) => ({ ...r }));
  if (!Array.isArray(raw)) return fallback();
  const routes: ModRoute[] = [];
  for (const entry of raw) {
    if (routes.length >= MAX_ROUTES) break;
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { src?: unknown; dst?: unknown; amount?: unknown; enabled?: unknown };
    if (typeof row.src !== 'string' || typeof row.dst !== 'string') continue;
    routes.push({
      src: row.src as ModRoute['src'],
      dst: row.dst as ModRoute['dst'],
      amount: clamp(Number(row.amount) || 0, -1, 1),
      enabled: Boolean(row.enabled),
    });
  }
  // A file whose routing does not survive validation gets the default matrix,
  // exactly as an absent one does: a patch must always have a routing.
  return routes.length ? routes : fallback();
}

/**
 * Parse a patch or song file.
 *
 * Returns null for everything that is not one of the two formats, including
 * text that is not JSON at all.
 */
export function parsePatchFile(text: string): PatchFile | null {
  if (typeof text !== 'string') return null;
  let parsed: {
    format?: unknown;
    code?: unknown;
    name?: unknown;
    params?: unknown;
    routes?: unknown;
    params2?: unknown;
    instanceMode?: unknown;
    splitNote?: unknown;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  // A `.gs1song` file is a share code in a box: an arrangement too long for a
  // URL travels this way and lands in the same place. The code is validated by
  // the share-code reader, so this only has to hand it over.
  if (parsed.format === 'gs1-song') {
    if (typeof parsed.code !== 'string' || parsed.code.length > MAX_CODE_LENGTH) return null;
    return { kind: 'song', code: parsed.code };
  }
  if (parsed.format !== 'gs1-preset') return null;
  if (!parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)) return null;

  const first = readParams(parsed.params);
  const second = readParams(parsed.params2);
  const layered = second.count > 0;
  const instanceMode =
    parsed.instanceMode === 'layer' || parsed.instanceMode === 'split' ? parsed.instanceMode : undefined;
  const splitNote =
    typeof parsed.splitNote === 'number' && parsed.splitNote >= 0 && parsed.splitNote <= 127
      ? Math.round(parsed.splitNote)
      : undefined;
  const name =
    typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim().slice(0, MAX_NAME_LENGTH)
      : 'Imported Patch · 导入音色';

  const preset: Preset = {
    id: `file-${Date.now()}`,
    name,
    tag: 'IMPORTED',
    cat: 'USER',
    wave: intToWave(first.params[2] ?? 0),
    params: first.params,
    routes: readRoutes(parsed.routes),
    ...(layered ? { params2: second.params, instanceMode, splitNote } : {}),
  };
  return { kind: 'preset', preset };
}
