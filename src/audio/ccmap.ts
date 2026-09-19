/**
 * MIDI CC → parameter mappings.
 *
 * Pure functions on a plain list, so binding, scaling and lookup are all
 * testable without a MIDI device; the store persists the list and the MIDI
 * manager drives it.
 */

import { SPEC_BY_ID } from './params';

export interface CcBinding {
  /** Parameter id (see `Param`). */
  param: number;
  /** MIDI continuous controller number. */
  cc: number;
}

/** Value of a parameter from a 0..1 controller position, honouring its curve. */
export function ccToParamValue(param: number, value01: number): number | null {
  const spec = SPEC_BY_ID[param];
  if (!spec) return null;
  const t = Math.min(1, Math.max(0, value01));
  const raw =
    spec.curve === 'log'
      ? spec.min * (spec.max / spec.min) ** t
      : spec.min + t * (spec.max - spec.min);
  // Discrete parameters (switches, enums) must land on a whole step, or the
  // engine sees 0.4 of a waveform.
  return spec.discrete ? Math.round(raw) : raw;
}

/** Bind `cc` to `param`, replacing whatever either side was bound to. */
export function bindCc(bindings: CcBinding[], param: number, cc: number): CcBinding[] {
  const next = bindings.filter((b) => b.param !== param && b.cc !== cc);
  next.push({ param, cc });
  next.sort((a, b) => a.param - b.param);
  return next;
}

export function unbindParam(bindings: CcBinding[], param: number): CcBinding[] {
  return bindings.filter((b) => b.param !== param);
}

export function paramForCc(bindings: CcBinding[], cc: number): number | null {
  return bindings.find((b) => b.cc === cc)?.param ?? null;
}

export function ccForParam(bindings: CcBinding[], param: number): number | null {
  return bindings.find((b) => b.param === param)?.cc ?? null;
}

/** Accept a value from persisted storage without trusting its shape. */
export function normalizeBindings(raw: unknown): CcBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: CcBinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { param, cc } = entry as { param?: unknown; cc?: unknown };
    if (typeof param !== 'number' || typeof cc !== 'number') continue;
    if (!Number.isInteger(param) || !Number.isInteger(cc)) continue;
    if (cc < 0 || cc > 127 || !SPEC_BY_ID[param]) continue;
    if (out.some((b) => b.param === param || b.cc === cc)) continue;
    out.push({ param, cc });
  }
  return out;
}
