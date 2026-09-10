/**
 * Versioned persistence (schema 2).
 *
 * Every document the app keeps — the autosaved patch, the workspace layout, user
 * presets, scenes, share links, the imported waveform and impulse response — is
 * written with the schema it was produced under, and read through a migration.
 *
 * The point is not the current shape: it is that the shape is going to keep
 * growing (instances, tracks, sample import), and the two failure modes that
 * come with growth are both silent. A payload from a *newer* build read by an
 * older one loses whatever it does not understand, and a payload from an older
 * build read by a newer one is missing whatever was added. Refusing the first
 * and merging over the defaults for the second is what these helpers do.
 */

/** Bump when a stored document changes shape in a way a merge cannot fix. */
export const SCHEMA_VERSION = 2;

export interface Envelope {
  schema: number;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Envelope).schema === 'number' &&
    'data' in (value as Envelope)
  );
}

/** Wrap a document in its schema envelope before storing it. */
export function wrap(data: unknown): Envelope {
  return { schema: SCHEMA_VERSION, data };
}

/**
 * Unwrap a stored payload.
 *
 * Returns `null` when there is nothing to read, or when the payload was written
 * by a newer build — loading that would drop fields this build does not know
 * about, and the player would rather be told than lose half a patch.
 *
 * A payload written before versioning existed reads as schema 0.
 */
export function unwrap(raw: unknown): { schema: number; data: unknown } | null {
  if (raw === null || raw === undefined) return null;
  if (isEnvelope(raw)) {
    if (raw.schema > SCHEMA_VERSION) return null;
    return { schema: raw.schema, data: raw.data };
  }
  return { schema: 0, data: raw };
}

/**
 * Merge a stored record over the defaults, keeping only known keys.
 *
 * This is the whole migration for a schema that has only ever grown: anything
 * added since is already in `defaults`, anything removed is dropped, and keys
 * whose type changed are ignored rather than trusted (a string where a list
 * belongs is a corrupted document, not a new field).
 */
export function mergeKnown<T extends object>(defaults: T, stored: unknown): T {
  if (typeof stored !== 'object' || stored === null) return defaults;
  const source = stored as Record<string, unknown>;
  const out = { ...(defaults as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const value = source[key];
    if (value === undefined) continue;
    const fallback = out[key];
    const bothObjects =
      typeof value === 'object' && typeof fallback === 'object' && Array.isArray(value) === Array.isArray(fallback);
    if (typeof value !== typeof fallback && !bothObjects) continue;
    out[key] = value;
  }
  return out as T;
}

/** Whether `schema` predates versioning (a bare payload from an older build). */
export function isLegacy(schema: number): boolean {
  return schema < SCHEMA_VERSION;
}
