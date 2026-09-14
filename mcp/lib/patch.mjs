/**
 * Patches, in the format the app already uses.
 *
 * A patch here is **not a new shape**: it is the same base64url payload the
 * share link and `patch.get` carry (`src/state/share.ts`), produced and read by
 * that module's own `encodePatch`/`decodePatch`. `gs1.render` accepts either the
 * code or the decoded payload, and `presetId` as a shorthand.
 */
import { ERRORS, fail } from './errors.mjs';

/** Build the `SynthState` a preset id stands for, then encode it exactly as the app would. */
export function presetShareCode(data, presetId) {
  const preset = data.FACTORY_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw fail(ERRORS.PATCH, `unknown preset id "${presetId}"`, {
      presetId,
      hint: 'call gs1.presets.list for the 91 factory ids',
    });
  }
  const params = data.presetParams(preset);
  const params2 = preset.params2 ? { ...data.DEFAULT_PARAMS, ...preset.params2 } : params;
  const routes = data.presetRoutes(preset);
  const routing =
    preset.instanceMode && preset.instanceMode !== 'single'
      ? { mode: preset.instanceMode, splitNote: preset.splitNote ?? 60 }
      : { mode: 'single', splitNote: 60 };
  const code = data.encodePatch({ params, params2, routes, power: true }, { routing });
  return { preset, code };
}

/**
 * Resolve whatever the caller passed as `patch` into a normalised payload:
 * `{ params, params2, instanceMode, splitNote, routes, source, presetId?, shareCode }`.
 * Throws `E_PATCH` rather than returning a half-applied patch.
 */
export async function resolvePatch(data, spec) {
  if (spec?.presetId !== undefined) {
    const { preset, code } = presetShareCode(data, spec.presetId);
    const decoded = await data.decodePatchAsync(code);
    if (!decoded) throw fail(ERRORS.PATCH, `preset "${spec.presetId}" encoded to a code that will not decode`);
    return { ...decoded, source: 'preset', presetId: preset.id, shareCode: code };
  }

  const patch = spec?.patch;
  if (patch === undefined) {
    // No patch at all: the app's default patch, so a render is still a real,
    // reproducible sound rather than silence.
    const code = data.encodePatch(
      {
        params: { ...data.DEFAULT_PARAMS },
        params2: { ...data.DEFAULT_PARAMS },
        routes: data.DEFAULT_ROUTES.map((r) => ({ ...r })),
        power: true,
      },
      { routing: { mode: 'single', splitNote: 60 } },
    );
    const decoded = await data.decodePatchAsync(code);
    return { ...decoded, source: 'default', shareCode: code };
  }

  if (typeof patch === 'string') {
    const decoded = await data.decodePatchAsync(patch);
    if (!decoded) {
      throw fail(ERRORS.PATCH, 'patch is not a decodable gs1 share code', {
        hint: 'expected a "gs1.1."/"gs1.2." code; call gs1.patch.get to obtain one',
        prefix: patch.slice(0, 12),
      });
    }
    return { ...decoded, source: 'shareCode', shareCode: patch };
  }

  if (patch !== null && typeof patch === 'object') {
    if (patch.params === null || typeof patch.params !== 'object') {
      throw fail(ERRORS.PATCH, 'patch object has no `params` record');
    }
    const params = normaliseParams(data, patch.params);
    const routes = normaliseRoutes(patch.routes);
    return {
      params,
      params2: patch.params2 ? normaliseParams(data, patch.params2) : null,
      instanceMode: patch.instanceMode ?? null,
      splitNote: patch.splitNote ?? null,
      routes,
      source: 'object',
    };
  }

  throw fail(ERRORS.PATCH, `patch must be a share code, an object or omitted, got ${typeof patch}`);
}

/** A params record with every id the engine knows, defaulted and finite. */
function normaliseParams(data, record) {
  const params = { ...data.DEFAULT_PARAMS };
  for (const [rawId, rawValue] of Object.entries(record)) {
    const id = Number(rawId);
    const value = Number(rawValue);
    if (!Number.isInteger(id) || id < 0 || id >= Object.keys(data.DEFAULT_PARAMS).length) continue;
    if (!Number.isFinite(value)) continue;
    params[id] = value;
  }
  return params;
}

function normaliseRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  return routes
    .filter((route) => route && typeof route === 'object')
    .map((route) => ({
      src: route.src,
      dst: route.dst,
      amount: Number.isFinite(Number(route.amount)) ? Number(route.amount) : 0,
      enabled: Boolean(route.enabled),
    }));
}

/** `[[id, value], …]` in ascending id order — the form `engine()` takes. */
export function paramPairs(params) {
  return Object.keys(params)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => [id, params[id]]);
}

/** Write a payload's modulation routes into the core exactly as the gate does. */
export function applyRoutes(data, ex, routes) {
  for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
  routes.slice(0, 8).forEach((route, index) => {
    ex.gs_set_mod_route(
      index,
      data.modSrcToInt(route.src),
      data.modDstToInt(route.dst),
      route.amount,
      route.enabled ? 1 : 0,
    );
  });
}

/** A patch summary for tool output, without the 224-value payload. */
export function patchSummary(payload) {
  const changed = Object.entries(payload.params).filter(
    ([id, value]) => value !== undefined && Number(id) !== undefined,
  );
  return {
    source: payload.source,
    presetId: payload.presetId ?? null,
    instanceMode: payload.instanceMode ?? 'single',
    splitNote: payload.splitNote ?? null,
    routeCount: payload.routes.length,
    paramCount: changed.length,
    shareCode: payload.shareCode ?? null,
  };
}
