/**
 * Patches, in the format the app already uses.
 *
 * A patch here is **not a new shape**: it is the same base64url payload the
 * share link and `patch.get` carry (`src/state/share.ts`), produced and read by
 * that module's own `encodePatch`/`decodePatch`. `gs1.render` accepts either the
 * code or the decoded payload, and `presetId` as a shorthand.
 *
 * P13.3 adds the write side on top of the same format:
 *
 *   * `encodePayload()` re-encodes a payload into the canonical share code, with
 *     the same rule `presetShareCode` uses for the second layer (absent layer ⇒
 *     the first layer's params, so `buildPayload` does not invent one);
 *   * `applyParams()` resolves caller keys against the worklet's own parameter
 *     table, clamps to the range the browser serves and records every edit;
 *   * `commitPatch()` is the single place the session's patch is written, so
 *     `patch.set`, `patch.random` and `preset.apply` cannot diverge.
 */
import { ERRORS, fail } from './errors.mjs';
import { parameterTable } from './data.mjs';

/** The routing a payload carries, in the form `encodePatch` takes. */
function routingOf(payload) {
  const mode = payload?.instanceMode;
  return mode && mode !== 'single'
    ? { mode, splitNote: payload.splitNote ?? 60 }
    : { mode: 'single', splitNote: 60 };
}

/**
 * Re-encode a payload exactly as the app would.
 *
 * The second-layer rule matters: `buildPayload` decides whether a code carries
 * a layer by comparing `params2` against `params`, and the app passes the first
 * layer's params when there is no second one (`presetShareCode`). Passing
 * `null` here would dereference a null `params2` and, worse, re-encode a
 * layerless patch as a layered one.
 */
export function encodePayload(data, payload) {
  const params = { ...data.DEFAULT_PARAMS, ...payload.params };
  const params2 = payload.params2 ? { ...data.DEFAULT_PARAMS, ...payload.params2 } : params;
  const routes = payload.routes?.length ? payload.routes : data.DEFAULT_ROUTES.map((r) => ({ ...r }));
  return data.encodePatch({ params, params2, routes, power: true }, { routing: routingOf(payload) });
}

/** Build the `SynthState` a preset id stands for, then encode it exactly as the app would. */
export function presetShareCode(data, presetId) {
  const preset = data.FACTORY_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw fail(ERRORS.PATCH, `unknown preset id "${presetId}"`, {
      presetId,
      hint: 'call gs1.presets.list for the factory ids',
    });
  }
  const params = data.presetParams(preset);
  const params2 = preset.params2 ? { ...data.DEFAULT_PARAMS, ...preset.params2 } : null;
  const routes = data.presetRoutes(preset);
  const code = encodePayload(data, { params, params2, routes, instanceMode: preset.instanceMode ?? null, splitNote: preset.splitNote ?? null });
  return { preset, code };
}

/**
 * Resolve whatever the caller passed as `patch` into a normalised payload:
 * `{ params, params2, instanceMode, splitNote, routes, source, presetId?, shareCode }`.
 * Throws `E_PATCH` rather than returning a half-applied patch.
 *
 * When the caller names no patch at all, the **session's current patch** wins
 * if there is one (`gs1.patch.set` ran earlier), and the app's default patch
 * otherwise. That is the whole point of P13.3's state rules: `render` with no
 * patch plays what the session is holding.
 */
export async function resolvePatch(data, spec, session = null) {
  if (spec?.presetId !== undefined) {
    const { preset, code } = presetShareCode(data, spec.presetId);
    const decoded = await data.decodePatchAsync(code);
    if (!decoded) throw fail(ERRORS.PATCH, `preset "${spec.presetId}" encoded to a code that will not decode`);
    return { ...decoded, source: 'preset', presetId: preset.id, shareCode: code };
  }

  const patch = spec?.patch;
  if (patch === undefined) {
    if (session?.patch) return { ...session.patch, source: 'session' };
    // No patch at all: the app's default patch, so a render is still a real,
    // reproducible sound rather than silence.
    const code = encodePayload(data, {
      params: data.DEFAULT_PARAMS,
      params2: null,
      routes: data.DEFAULT_ROUTES,
      instanceMode: 'single',
      splitNote: 60,
    });
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
    const routes = normaliseRoutes(data, patch.routes);
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

/** Route rows with the names the share format uses; no routing means the default matrix. */
function normaliseRoutes(data, routes) {
  if (!Array.isArray(routes)) return data.DEFAULT_ROUTES.map((route) => ({ ...route }));
  const rows = routes
    .filter((route) => route && typeof route === 'object')
    .map((route) => ({
      src: route.src,
      dst: route.dst,
      amount: Number.isFinite(Number(route.amount)) ? Number(route.amount) : 0,
      enabled: Boolean(route.enabled),
    }));
  // A patch always has a routing, exactly as `parsePatchFile` decides.
  return rows.length ? rows : data.DEFAULT_ROUTES.map((route) => ({ ...route }));
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
  return {
    source: payload.source,
    presetId: payload.presetId ?? null,
    instanceMode: payload.instanceMode ?? 'single',
    splitNote: payload.splitNote ?? null,
    routeCount: payload.routes.length,
    paramCount: Object.keys(payload.params).length,
    shareCode: payload.shareCode ?? null,
  };
}

/**
 * The parameter table indexed by every name a caller may use: the `key` from
 * `PARAM_NAMES`, the display label from `PARAM_SPECS`, and the numeric id.
 * Built from `parameterTable`, so a worklet range change is picked up here.
 */
export function paramIndex(data) {
  const index = new Map();
  for (const entry of parameterTable(data)) {
    index.set(entry.key.toLowerCase(), entry);
    index.set(String(entry.id), entry);
    if (entry.nameEn) index.set(entry.nameEn.toLowerCase(), entry);
  }
  return index;
}

/**
 * Apply `{ key: value }` to a parameter record, clamping to the range the
 * browser serves and rounding stepped parameters.
 *
 * Nothing is silent: `clamped` lists every value this function changed, with
 * both the number the caller asked for and the one that was applied. A value
 * the engine would have accepted unchanged never appears there.
 */
export function applyParams(data, baseParams, params) {
  const index = paramIndex(data);
  const next = { ...baseParams };
  const clamped = [];
  for (const [rawKey, rawValue] of Object.entries(params ?? {})) {
    const entry = index.get(String(rawKey).toLowerCase());
    if (!entry) {
      throw fail(ERRORS.PARAM, `unknown parameter "${rawKey}"`, {
        field: `params.${rawKey}`,
        hint: 'call gs1.params.list for the 224 ids and keys',
      });
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw fail(ERRORS.PARAM, `parameter "${entry.key}" must be a finite number`, {
        field: `params.${rawKey}`,
        value: rawValue ?? null,
      });
    }
    let got = rawValue;
    let reason = null;
    if (got < entry.min) {
      got = entry.min;
      reason = 'min';
    } else if (got > entry.max) {
      got = entry.max;
      reason = 'max';
    }
    if (entry.discrete && !Number.isInteger(got)) {
      got = Math.round(got);
      reason = reason ?? 'discrete';
    }
    if (reason) clamped.push({ key: entry.key, asked: rawValue, got, reason });
    next[entry.id] = got;
  }
  return { params: next, clamped };
}

/**
 * Write a payload into the session as the current patch and describe the result.
 *
 * The single write path for `patch.set`, `patch.random` and `preset.apply`: the
 * canonical share code is computed here, so whatever `patch.get` returns next is
 * the code the app itself would produce for these parameters.
 */
export function commitPatch(ctx, payload, meta = {}) {
  const { data } = ctx;
  const params = { ...data.DEFAULT_PARAMS, ...(payload.params ?? {}) };
  const full = {
    params,
    params2: payload.params2 ? { ...data.DEFAULT_PARAMS, ...payload.params2 } : null,
    instanceMode: payload.instanceMode ?? null,
    splitNote: payload.splitNote ?? null,
    routes: normaliseRoutes(data, payload.routes),
    presetId: payload.presetId ?? null,
  };
  const shareCode = encodePayload(data, full);
  const clamped = meta.clamped ?? [];
  ctx.session.patch = { ...full, shareCode };
  return {
    ok: true,
    applied: meta.applied ?? 'patch',
    partial: Boolean(meta.partial),
    source: 'session',
    presetId: full.presetId,
    shareCode,
    summary: patchSummary({ ...full, shareCode }),
    clamped,
    clampedCount: clamped.length,
    patch: {
      params: full.params,
      params2: full.params2,
      instanceMode: full.instanceMode,
      splitNote: full.splitNote,
      routes: full.routes,
    },
  };
}

/**
 * The `.gs1.json` payload `preset.save` writes — the same object the store's
 * `exportCurrentPreset()` hands to `downloadText`, including its rule that a
 * layer travels only when the patch actually uses one.
 */
export function patchFileFromPayload(data, payload, name) {
  const params = { ...data.DEFAULT_PARAMS, ...payload.params };
  const params2 = payload.params2 ? { ...data.DEFAULT_PARAMS, ...payload.params2 } : null;
  const layered =
    (payload.instanceMode != null && payload.instanceMode !== 'single') ||
    (params2 !== null && Object.keys(params).some((id) => params2[id] !== params[id]));
  return {
    format: 'gs1-preset',
    version: 1,
    name,
    params,
    routes: payload.routes.map((route) => ({ ...route })),
    ...(layered
      ? {
          ...(params2 ? { params2 } : {}),
          instanceMode: payload.instanceMode ?? 'single',
          splitNote: payload.splitNote ?? 60,
        }
      : {}),
  };
}

/** A file name that survives a filesystem: no separators, no surprises. */
export function safeFileName(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 80);
  return cleaned || 'gs1-patch';
}
