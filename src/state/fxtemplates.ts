/**
 * Effect-graph templates (P7.3).
 *
 * A template is a *routing*: the effect at each of the six chain positions,
 * whether it runs as a send, and the graph that wires the nodes, plus the node
 * gains. It is saved into the workspace (`LayoutState.fxTemplates`, under
 * `gs1:layout:v1`) rather than into the patch, so it belongs to the person's
 * setup and never rides along in a share code.
 *
 * Applying one *does* write patch parameters — the graph is patch data and the
 * DSP reads it from there — but only the ids in `FX_TEMPLATE_PARAM_IDS`. That
 * whitelist is deliberately narrow: `FX_GRAPH`, the six chain positions, the six
 * parallel flags and the 37 graph parameters (`GRAPH_FROM_CHAIN_IDS`). It leaves
 * out everything that is timbre rather than wiring, in particular
 * `FX_REVERB_MODE` / the imported impulse response and every effect's on/off and
 * mix, so a template can never cross the boundary the effect knobs own.
 *
 * Everything read back from storage is clamped id by id and rejected when it is
 * not a shape this build understands (`normalizeFxTemplates`), exactly like the
 * rest of the layout.
 */

import {
  DEFAULT_PARAMS,
  FX_DELAY_INSTANCES,
  FX_KINDS,
  FX_OVR_SLOTS,
  FX_OVR_UNSET,
  FX_SLOTS,
  GRAPH_DRY,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  chainId,
  fxKindToInt,
  graphFromChain,
  graphInGainId,
  graphInId,
  graphOutGainId,
  graphToOutId,
  ovrId,
  parallelId,
  type FxKind,
  type ParamId,
} from '@/audio/params';

export interface FxTemplate {
  id: string;
  /** Label for a saved template; a built-in carries `nameKey` instead. */
  name: string;
  /** i18n key of a built-in's label, so the list follows the language. */
  nameKey?: string;
  /**
   * Whitelisted parameter id → value. Only ids in `FX_TEMPLATE_PARAM_IDS` are
   * ever stored, and every value is clamped on the way in.
   */
  params: Record<number, number>;
}

const clampNum = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const clampInt = (value: number, lo: number, hi: number) => clampNum(Math.round(value), lo, hi);
const switch01 = (value: number) => (value >= 0.5 ? 1 : 0);

/** How one whitelisted id is repaired. A template only ever holds numbers. */
const CLAMPS = new Map<number, (value: number) => number>();
for (let slot = 0; slot < FX_SLOTS; slot++) {
  CLAMPS.set(chainId(slot), (value) => clampInt(value, 0, FX_KINDS.length - 1));
  CLAMPS.set(parallelId(slot), switch01);
  // A source code names nothing, the dry bus, or one of the two nodes before
  // this one; the DSP ignores the rest, so the clamp keeps the shape honest.
  CLAMPS.set(graphInId(slot, 0), (value) => clampInt(value, 0, FX_SLOTS + 1));
  CLAMPS.set(graphInGainId(slot, 0), (value) => clampNum(value, 0, 4));
  CLAMPS.set(graphInId(slot, 1), (value) => clampInt(value, 0, FX_SLOTS + 1));
  CLAMPS.set(graphInGainId(slot, 1), (value) => clampNum(value, 0, 4));
  CLAMPS.set(graphToOutId(slot), switch01);
  CLAMPS.set(graphOutGainId(slot), (value) => clampNum(value, 0, 4));
}
CLAMPS.set(Param.FX_GRAPH, switch01);
// Per-node effect overrides (P9.3): a template carries them, because "node 2 is
// the short slapback, node 4 is the long one" is part of the routing a template
// is for. Every slot is accepted generically — the column means different
// things per kind, and the engine clamps each slot to its kind's own range — but
// the two ids that could cross into timbre territory stay out: `FX_OVR_TARGET`
// and `FX_OVR_DEPTH`, the override modulation bus, are a routing's *modulation*
// rather than its wiring, exactly like the P7.2 in-graph edges below.
for (const node of Array.from({ length: FX_SLOTS }, (_, index) => index)) {
  for (const slot of Array.from({ length: FX_OVR_SLOTS }, (_, index) => index)) {
    CLAMPS.set(ovrId(node, slot), (value) => clampNum(value, FX_OVR_UNSET, 64));
  }
}

/**
 * The ids a template is allowed to carry, in the order it writes them.
 *
 * The list is the boundary: anything outside it — the reverb's algorithmic /
 * impulse-response switch, the imported response, an effect's on/off or mix,
 * the in-graph modulation edges — is not saved and not applied.
 */
export const FX_TEMPLATE_PARAM_IDS: ParamId[] = [
  ...Array.from({ length: FX_SLOTS }, (_, slot) => chainId(slot)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => parallelId(slot)),
  ...GRAPH_FROM_CHAIN_IDS,
  // The per-node override pool (P9.3). The modulation bus is deliberately not
  // here: a template sets routing, not modulation.
  ...Array.from({ length: FX_SLOTS }, (_, node) =>
    Array.from({ length: FX_OVR_SLOTS }, (_, slot) => ovrId(node, slot)),
  ).flat(),
];

/** Whether an id may travel in a template. */
export function isFxTemplateParam(id: number): boolean {
  return CLAMPS.has(id);
}

/** Read the current routing as a template body, clamped like stored data. */
export function captureFxTemplateParams(read: (id: ParamId) => number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const id of FX_TEMPLATE_PARAM_IDS) out[id] = CLAMPS.get(id)!(read(id));
  return out;
}

/**
 * Accept a stored template body without trusting it: unknown ids (including
 * every non-whitelisted parameter) are dropped, known ones are clamped, and a
 * body with nothing recognisable is refused.
 */
export function normalizeTemplateParams(raw: unknown): Record<number, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const out: Record<number, number> = {};
  let found = false;
  for (const id of FX_TEMPLATE_PARAM_IDS) {
    const value = source[String(id)];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[id] = CLAMPS.get(id)!(value);
    found = true;
  }
  if (!found) return null;
  return repairParams(out);
}

/**
 * Structural repair after the per-id clamp.
 *
 * A stored body can still describe a graph the renderer would silently ignore:
 * a forward edge (a node reading itself or a later one), or a third delay node
 * when the pool holds two. Both read as the closest legal routing instead. A
 * reverb is not capped here: the algorithmic reverb is not pooled, and in
 * impulse-response mode the core already gives the nodes past the pool no tail.
 */
function repairParams(params: Record<number, number>): Record<number, number> {
  for (let slot = 0; slot < FX_SLOTS; slot++) {
    const last = slot + 1;
    for (const which of [0, 1] as const) {
      const id = graphInId(slot, which);
      const src = params[id];
      if (src === undefined) continue;
      if (src === 0 || src === GRAPH_DRY || (src >= 2 && src <= last)) continue;
      params[id] = 0;
    }
  }
  let delays = 0;
  for (let slot = 0; slot < FX_SLOTS; slot++) {
    const id = chainId(slot);
    if (params[id] !== 1) continue;
    delays += 1;
    if (delays > FX_DELAY_INSTANCES) params[id] = 0;
  }
  return params;
}

/** Accept a stored template list: junk entries are dropped, not loaded. */
export function normalizeFxTemplates(raw: unknown): FxTemplate[] {
  if (!Array.isArray(raw)) return [];
  const builtinIds = new Set(BUILTIN_FX_TEMPLATES.map((template) => template.id));
  const out: FxTemplate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, params } = entry as Partial<FxTemplate>;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) continue;
    if (typeof name !== 'string') continue;
    // A saved entry must not shadow a built-in one.
    if (builtinIds.has(id)) continue;
    if (out.some((template) => template.id === id)) continue;
    const clean = normalizeTemplateParams(params);
    if (!clean) continue;
    out.push({ id, name: name.slice(0, 60), params: clean });
  }
  return out;
}

/** The parameters applying a template writes, in one batch. */
export function fxTemplateEntries(template: FxTemplate): [ParamId, number][] {
  return FX_TEMPLATE_PARAM_IDS.map((id) => [
    id,
    template.params[id] ?? DEFAULT_PARAMS[id] ?? 0,
  ]);
}

/** A built-in first, then a saved template of the same id (which cannot exist). */
export function findFxTemplate(user: FxTemplate[], id: string): FxTemplate | null {
  return BUILTIN_FX_TEMPLATES.find((template) => template.id === id) ?? user.find((t) => t.id === id) ?? null;
}

/**
 * The graph a chain is equivalent to, as a template body. This is the same
 * `graphFromChain` mapping the editor seeds from, so "classic serial" is exactly
 * what turning the graph on after the default chain gives.
 */
function fromChain(chain: FxKind[], parallel: boolean[] = []): Record<number, number> {
  const kinds = chain.map(fxKindToInt);
  const params: Record<number, number> = {};
  for (let slot = 0; slot < FX_SLOTS; slot++) {
    params[chainId(slot)] = kinds[slot] ?? 0;
    params[parallelId(slot)] = parallel[slot] ? 1 : 0;
  }
  const values = graphFromChain((id) => {
    for (let slot = 0; slot < FX_SLOTS; slot++) if (id === chainId(slot)) return kinds[slot] ?? 0;
    return 0;
  });
  GRAPH_FROM_CHAIN_IDS.forEach((id, index) => {
    params[id] = values[index];
  });
  return params;
}

/** Build a template body and leave every node after `last` unwired. */
function baseTemplate(chain: FxKind[], last: number): Record<number, number> {
  const params = fromChain(chain);
  for (let slot = last + 1; slot < FX_SLOTS; slot++) {
    params[graphInId(slot, 0)] = 0;
    params[graphInId(slot, 1)] = 0;
    params[graphToOutId(slot)] = 0;
  }
  return params;
}

function builtin(id: string, name: string, nameKey: string, params: Record<number, number>): FxTemplate {
  return { id, name, nameKey, params };
}

// Two delay nodes, both reading the dry bus and both reaching the output: the
// P7.1 pool holds exactly two, which is why the list tops out here.
const dualDelay = baseTemplate(['delay', 'delay', 'none', 'none', 'none', 'none'], 1);
dualDelay[graphInId(1, 0)] = GRAPH_DRY;
dualDelay[graphToOutId(0)] = 1;
dualDelay[graphToOutId(1)] = 1;

// Two rooms side by side. Algorithmic on purpose: a template never sets
// FX_REVERB_MODE, so it does not depend on an imported impulse response.
const parallelReverb = baseTemplate(['reverb', 'reverb', 'none', 'none', 'none', 'none'], 1);
parallelReverb[graphInId(1, 0)] = GRAPH_DRY;
parallelReverb[graphToOutId(0)] = 1;
parallelReverb[graphToOutId(1)] = 1;

// The drive as a send: the dry path keeps running through the node while the
// distortion is added on top, which is what the ∥ switch does in the chain.
const driveSplit = baseTemplate(['drive', 'none', 'none', 'none', 'none', 'none'], 0);
driveSplit[parallelId(0)] = 1;
driveSplit[graphToOutId(0)] = 1;

// A clean slate that still passes the dry signal, so applying it can never
// silence the synth: only node 1 is wired, from the dry bus to the output.
const empty = baseTemplate(['none', 'none', 'none', 'none', 'none', 'none'], 0);
empty[graphToOutId(0)] = 1;

/** The examples that ship with the app, always available, never deleted. */
export const BUILTIN_FX_TEMPLATES: FxTemplate[] = [
  builtin(
    'fxg:serial',
    '经典串联',
    'fxg.tpl.serial',
    baseTemplate(['delay', 'reverb', 'chorus', 'flanger', 'phaser', 'drive'], 5),
  ),
  builtin('fxg:dual-delay', '双延迟', 'fxg.tpl.dualDelay', dualDelay),
  builtin('fxg:parallel-reverb', '并行混响', 'fxg.tpl.parallelReverb', parallelReverb),
  builtin('fxg:drive-split', '失真分路', 'fxg.tpl.driveSplit', driveSplit),
  builtin('fxg:empty', '空图（仅干声）', 'fxg.tpl.empty', empty),
];
