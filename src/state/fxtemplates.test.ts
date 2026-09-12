/**
 * Effect-graph templates (P7.3).
 *
 * Two things are worth pinning here: that a template can only ever carry the
 * routing ids (never a timbre parameter or a share-code field), and that a
 * corrupt stored body is clamped into a routing the renderer actually runs
 * instead of being trusted.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FX_TEMPLATES,
  FX_TEMPLATE_PARAM_IDS,
  captureFxTemplateParams,
  findFxTemplate,
  fxTemplateEntries,
  isFxTemplateParam,
  normalizeFxTemplates,
  normalizeTemplateParams,
  type FxTemplate,
} from './fxtemplates';
import {
  DEFAULT_PARAMS,
  FX_CONV_INSTANCES,
  FX_DELAY_INSTANCES,
  FX_KINDS,
  FX_SLOTS,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  chainId,
  fxKindToInt,
  graphNodeSrc,
  parallelId,
  type ParamId,
} from '@/audio/params';

describe('effect-graph templates', () => {
  it('only ever carries the routing ids', () => {
    for (const id of GRAPH_FROM_CHAIN_IDS) expect(FX_TEMPLATE_PARAM_IDS).toContain(id);
    for (let slot = 0; slot < FX_SLOTS; slot++) {
      expect(FX_TEMPLATE_PARAM_IDS).toContain(chainId(slot));
      expect(FX_TEMPLATE_PARAM_IDS).toContain(parallelId(slot));
    }
    // No id is listed twice (the apply order is the write order).
    expect(new Set(FX_TEMPLATE_PARAM_IDS).size).toBe(FX_TEMPLATE_PARAM_IDS.length);
    // Timbre, the IR switch and the modulation edges are outside the boundary.
    for (const id of [
      Param.FX_REVERB_MODE,
      Param.FX_REVERB_MIX,
      Param.FX_DELAY_MIX,
      Param.FX_DELAY_ON,
      Param.FX_DRIVE_ON,
      Param.FX_MOD1_SRC,
      Param.OSC1_LEVEL,
      Param.FILTER_CUTOFF,
    ]) {
      expect(isFxTemplateParam(id), `id ${id} must not travel in a template`).toBe(false);
    }
  });

  it('drops unknown ids and clamps every known one', () => {
    const body = normalizeTemplateParams({
      [Param.FX_REVERB_MODE]: 1,
      [Param.FX_DELAY_MIX]: 0.9,
      [Param.FX_CHAIN1]: 99,
      [Param.FX_PARALLEL1]: 0.2,
      [Param.FX_PARALLEL2]: 0.9,
      [Param.FX_GRAPH]: 2,
      [Param.FX_NODE1_IN1_GAIN]: 50,
      [Param.FX_NODE6_OUT_GAIN]: -3,
    })!;
    expect(Param.FX_REVERB_MODE in body).toBe(false);
    expect(Param.FX_DELAY_MIX in body).toBe(false);
    expect(body[Param.FX_CHAIN1]).toBe(FX_KINDS.length - 1);
    expect(body[Param.FX_PARALLEL1]).toBe(0);
    expect(body[Param.FX_PARALLEL2]).toBe(1);
    expect(body[Param.FX_GRAPH]).toBe(1);
    expect(body[Param.FX_NODE1_IN1_GAIN]).toBe(4);
    expect(body[Param.FX_NODE6_OUT_GAIN]).toBe(0);
  });

  it('reads a forward or self edge as not connected', () => {
    const body = normalizeTemplateParams({
      // Node 1 reading node 6: a forward edge the renderer ignores.
      [Param.FX_NODE1_IN1]: graphNodeSrc(5),
      // Node 2 reading its own output.
      [Param.FX_NODE2_IN1]: graphNodeSrc(1),
      // Node 3 reading node 2 is the only kind of edge the graph allows.
      [Param.FX_NODE3_IN1]: graphNodeSrc(1),
      [Param.FX_NODE3_IN2]: 1,
    })!;
    expect(body[Param.FX_NODE1_IN1]).toBe(0);
    expect(body[Param.FX_NODE2_IN1]).toBe(0);
    expect(body[Param.FX_NODE3_IN1]).toBe(graphNodeSrc(1));
    expect(body[Param.FX_NODE3_IN2]).toBe(1);
  });

  it('caps the delay nodes at the pool', () => {
    const body = normalizeTemplateParams({
      [Param.FX_CHAIN1]: 1,
      [Param.FX_CHAIN2]: 1,
      [Param.FX_CHAIN3]: 1,
      [Param.FX_CHAIN4]: 1,
    })!;
    expect(FX_DELAY_INSTANCES).toBe(2);
    expect(body[Param.FX_CHAIN1]).toBe(1);
    expect(body[Param.FX_CHAIN2]).toBe(1);
    // A third and fourth delay line do not exist, so they read as nothing.
    expect(body[Param.FX_CHAIN3]).toBe(0);
    expect(body[Param.FX_CHAIN4]).toBe(0);
  });

  it('refuses a body with nothing recognisable', () => {
    expect(normalizeTemplateParams(null)).toBeNull();
    expect(normalizeTemplateParams({})).toBeNull();
    expect(
      normalizeTemplateParams({ [Param.FX_REVERB_MODE]: 1, [Param.FILTER_CUTOFF]: 900 }),
    ).toBeNull();
    expect(normalizeTemplateParams({ [Param.FX_CHAIN1]: 'loud' })).toBeNull();
    expect(normalizeTemplateParams({ [Param.FX_CHAIN1]: Number.NaN })).toBeNull();
  });

  it('validates a stored template list and drops the rest', () => {
    const good = { id: 'a', name: 'A', params: { [Param.FX_CHAIN1]: 1 } };
    const list = normalizeFxTemplates([
      good,
      good, // duplicate id
      { id: 'b', name: 'B', params: { [Param.OSC1_LEVEL]: 1 } }, // nothing whitelisted
      { id: '', name: 'x', params: { [Param.FX_CHAIN1]: 1 } },
      { id: 'c', params: { [Param.FX_CHAIN1]: 1 } },
      'nope',
      // A saved entry must not shadow a built-in one.
      { id: BUILTIN_FX_TEMPLATES[0].id, name: 'shadow', params: { [Param.FX_CHAIN1]: 1 } },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
    expect(normalizeFxTemplates('nope')).toEqual([]);
    expect(normalizeFxTemplates(null)).toEqual([]);
  });

  it('captures every whitelisted id and nothing else', () => {
    const read = (id: ParamId) => (id === Param.FX_CHAIN3 ? 7 : id === Param.FX_NODE2_IN2_GAIN ? 3 : 0);
    const body = captureFxTemplateParams(read);
    expect(Object.keys(body).map(Number).sort((a, b) => a - b)).toEqual(
      [...FX_TEMPLATE_PARAM_IDS].sort((a, b) => a - b),
    );
    expect(Object.keys(body)).toHaveLength(FX_TEMPLATE_PARAM_IDS.length);
    expect(body[Param.FX_CHAIN3]).toBe(7);
    expect(body[Param.FX_NODE2_IN2_GAIN]).toBe(3);
  });

  it('fills a missing id from the defaults when applying', () => {
    const template: FxTemplate = { id: 'x', name: 'X', params: { [Param.FX_CHAIN1]: 6 } };
    const entries = fxTemplateEntries(template);
    expect(entries).toHaveLength(FX_TEMPLATE_PARAM_IDS.length);
    const values = new Map(entries);
    expect(values.get(Param.FX_CHAIN1)).toBe(6);
    expect(values.get(Param.FX_CHAIN2)).toBe(DEFAULT_PARAMS[Param.FX_CHAIN2]);
    expect(values.get(Param.FX_GRAPH)).toBe(DEFAULT_PARAMS[Param.FX_GRAPH]);
  });

  it('finds built-ins and saved templates by id', () => {
    expect(findFxTemplate([], BUILTIN_FX_TEMPLATES[0].id)).toBe(BUILTIN_FX_TEMPLATES[0]);
    const user: FxTemplate = { id: 'u', name: 'U', params: {} };
    expect(findFxTemplate([user], 'u')).toBe(user);
    expect(findFxTemplate([user], 'nope')).toBeNull();
  });

  it('ships 3 to 5 examples that survive their own validation', () => {
    expect(BUILTIN_FX_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_FX_TEMPLATES.length).toBeLessThanOrEqual(5);
    const ids = BUILTIN_FX_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of BUILTIN_FX_TEMPLATES) {
      // Already valid: normalizing one changes nothing.
      expect(normalizeTemplateParams(template.params), template.id).toEqual(template.params);
      expect(template.nameKey, template.id).toBeTruthy();
      expect(template.params[Param.FX_GRAPH], template.id).toBe(1);
      const kinds = Array.from({ length: FX_SLOTS }, (_, slot) => template.params[chainId(slot)]);
      // The examples never ask for more instances than the pools hold, so they
      // behave the same before and after an impulse response is imported.
      expect(kinds.filter((kind) => kind === fxKindToInt('delay')).length).toBeLessThanOrEqual(
        FX_DELAY_INSTANCES,
      );
      expect(kinds.filter((kind) => kind === fxKindToInt('reverb')).length).toBeLessThanOrEqual(
        FX_CONV_INSTANCES,
      );
    }
  });
});
