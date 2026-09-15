/**
 * The node-parameter id block, and the host paths that read it.
 *
 * `graph_param_field` (crates/synth-core/src/params.rs) decodes a node field as
 * `base <= id < base + FX_SLOTS`, with the six field bases `101 / 107 / 113 /
 * 119 / 125 / 131` and `FX_SLOTS = 6`. Those six half-open ranges tile
 * `[101, 137)` exactly — adjacent, pairwise disjoint, no gap — so each id is
 * claimed by exactly one field and always lands on a node inside `0..FX_SLOTS`.
 * NEXT-PLAN-2 §一.11 reported the block as colliding with the parameters
 * appended after it (`FX_NODE_OUT_GAIN+1 == FX_DELAY_MIX`, ...); measured, that
 * arithmetic is wrong and the ids it names are not in the block at all.
 *
 * These tests pin what is actually true, because it decides whether a
 * renumbering (a compatibility red line) buys anything:
 *
 *   1. the block is one contiguous run of 36 ids and no ordinary parameter's id
 *      lies inside it — it ends at 136 and the parameter appended after it is
 *      137 (`OSC_FM`);
 *   2. every one of the 36 node field ids reaches its own node (0..5), so the
 *      host can configure all six nodes;
 *   3. the values the host writes for the six nodes are named in the worklet
 *      descriptor table, so they reach the engine every block.
 *
 * They are the JS mirror of the Rust tests next to `graph_param_field` in
 * `params.rs`; both sides have to agree, so a change to the block has to be
 * intentional on both.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  FX_SLOTS,
  PARAM_NAMES,
  Param,
  graphInGainId,
  graphInId,
  graphOutGainId,
  graphToOutId,
  type ParamId,
} from './params';

/** Every node field the host can address, as (field name, id getter, node count). */
const NODE_FIELDS: { field: string; ids: ParamId[] }[] = [
  { field: 'IN1', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphInId(s, 0)) },
  { field: 'IN1_GAIN', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphInGainId(s, 0)) },
  { field: 'IN2', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphInId(s, 1)) },
  { field: 'IN2_GAIN', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphInGainId(s, 1)) },
  { field: 'TO_OUT', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphToOutId(s)) },
  { field: 'OUT_GAIN', ids: Array.from({ length: FX_SLOTS }, (_, s) => graphOutGainId(s)) },
];

/** The ids the block owns, in ascending order. */
const BLOCK_IDS = NODE_FIELDS.flatMap((f) => f.ids).sort((a, b) => a - b);

describe('the node parameter id block', () => {
  it('is one contiguous run of 36 ids, six per field', () => {
    expect(BLOCK_IDS).toHaveLength(FX_SLOTS * NODE_FIELDS.length);
    expect(BLOCK_IDS[0]).toBe(Param.FX_NODE1_IN1);
    expect(BLOCK_IDS[BLOCK_IDS.length - 1]).toBe(Param.FX_NODE6_OUT_GAIN);
    for (let i = 1; i < BLOCK_IDS.length; i++) {
      expect(BLOCK_IDS[i], `gap in the block at ${BLOCK_IDS[i - 1]} -> ${BLOCK_IDS[i]}`).toBe(
        BLOCK_IDS[i - 1] + 1,
      );
    }
  });

  it('contains no ordinary parameter id', () => {
    // The block is [101, 137); the parameter appended after it is 137.
    expect(Param.FX_NODE6_OUT_GAIN + 1).toBe(Param.OSC_FM);
    // Every id in the block belongs to the block, and the ids at both ends are
    // not node fields.
    const block = new Set<number>(BLOCK_IDS);
    for (const id of BLOCK_IDS) expect(block.has(id)).toBe(true);
    expect(block.has(Param.FX_GRAPH)).toBe(false);
    expect(block.has(Param.OSC_FM)).toBe(false);
    // The block is one unbroken run, so the ids just past its end are outside
    // it — 132..136 are the node-out gains themselves, and 138..142 are regular
    // parameters that no node field claims.
    for (let id = Param.FX_NODE2_OUT_GAIN; id <= Param.FX_NODE6_OUT_GAIN; id++) {
      expect(block.has(id), `${id} is a node id`).toBe(true);
      expect(block.has(id + FX_SLOTS), `${id + FX_SLOTS} is outside the block`).toBe(false);
    }
  });

  it('tiles [FX_NODE1_IN1, OSC_FM) with the six field ranges, with no overlap', () => {
    // The engine's decoder is `base <= id < base + FX_SLOTS` over these six
    // bases, in this order. Each range starts exactly where the previous one
    // ends, so no id is claimed twice and none is left unclaimed.
    const BASES = [
      Param.FX_NODE1_IN1,
      Param.FX_NODE1_IN1_GAIN,
      Param.FX_NODE1_IN2,
      Param.FX_NODE1_IN2_GAIN,
      Param.FX_NODE1_TO_OUT,
      Param.FX_NODE1_OUT_GAIN,
    ];
    for (let i = 1; i < BASES.length; i++) {
      expect(BASES[i], `field ${i} must start where field ${i - 1} ends`).toBe(
        BASES[i - 1] + FX_SLOTS,
      );
    }
    expect(BASES[BASES.length - 1] + FX_SLOTS).toBe(Param.OSC_FM);
    const claims = new Map<number, number>();
    for (const base of BASES) {
      for (let id = base; id < base + FX_SLOTS; id++) {
        claims.set(id, (claims.get(id) ?? 0) + 1);
      }
    }
    expect(claims.size).toBe(BASES.length * FX_SLOTS);
    for (const [id, count] of claims) {
      expect(count, `id ${id} must be claimed by exactly one field`).toBe(1);
    }
  });

  it('has a name and a default for every node id, so the host pushes all six', () => {
    for (const { field, ids } of NODE_FIELDS) {
      for (const [slot, id] of ids.entries()) {
        expect(
          PARAM_NAMES[id as ParamId],
          `${field} node ${slot + 1} (id ${id}) has no AudioParam name`,
        ).toBeTruthy();
        expect(
          Object.prototype.hasOwnProperty.call(DEFAULT_PARAMS, id),
          `${field} node ${slot + 1} (id ${id}) has no default`,
        ).toBe(true);
        expect(Number.isFinite(DEFAULT_PARAMS[id]), `${field} node ${slot + 1} default`).toBe(true);
      }
    }
  });

  it('keeps the host-side id helpers inside the block', () => {
    for (let slot = 0; slot < FX_SLOTS; slot++) {
      for (const id of [
        graphInId(slot, 0),
        graphInGainId(slot, 0),
        graphInId(slot, 1),
        graphInGainId(slot, 1),
        graphToOutId(slot),
        graphOutGainId(slot),
      ]) {
        expect(id, `slot ${slot}`).toBeGreaterThanOrEqual(Param.FX_NODE1_IN1);
        expect(id, `slot ${slot}`).toBeLessThan(Param.OSC_FM);
      }
    }
  });
});
