/**
 * The semantic macro layer: "warmer", "more air", "brighter".
 *
 * A caller who asks for those words through the raw parameter surface has to
 * translate them into a dozen numbers, and the translation is knowledge about
 * synthesis rather than about this repository's parameter ids. So it lives here,
 * in one explicit table, instead of in a prompt or in the caller's head.
 *
 * Each attribute is a short list of **moves**, and each move says how its
 * parameter responds to `amount`, which runs -1..1:
 *
 *   * `add`     — raw units. For the 0..1 mixes and depths, where a step is a
 *                 step.
 *   * `octaves` — multiply by `2 ** (octaves x amount)`. Frequencies **and
 *                 times**: a cutoff and an attack are heard logarithmically, so a
 *                 linear nudge is inaudible at the top of the range and violent
 *                 at the bottom.
 *   * `db`      — multiply by `10 ** (dB x amount / 20)`. Gains, so make-up for a
 *                 drive change is a single number a mixing engineer recognises.
 *
 * The lists are deliberately short. A macro that silently touches fifteen
 * parameters is a macro nobody can predict, and the point of naming the attribute
 * is that the caller can predict it.
 *
 * Clamping is **not** done here: the edits go through `applyParams`, which clamps
 * to the range the browser actually serves and reports every value it moved —
 * the same contract `gs1.patch.set` has. A parameter whose key has left the
 * table is skipped rather than fatal, so this file cannot take the tool down.
 */
import { ERRORS, fail } from './errors.mjs';
import { paramIndex } from './patch.mjs';

/**
 * The vocabulary, in the words a musician would use. `moves[i].key` is a
 * parameter key from `gs1.params.list`.
 */
export const MORPH_ATTRIBUTES = {
  warmth: {
    label: { zh: '温暖', en: 'warmth' },
    summary: {
      zh: '暗一点、带一点饱和与合唱的黏合',
      en: 'a little darker, with gentle saturation and chorus glue',
    },
    moves: [
      { key: 'filterCutoff', octaves: -0.35 },
      { key: 'filterDrive', add: 0.18 },
      { key: 'fxChorusMix', add: 0.08 },
      { key: 'patchGain', db: 0.8 },
    ],
  },
  air: {
    label: { zh: '空气感', en: 'air' },
    summary: {
      zh: '打开高频、把空间铺开',
      en: 'open the top end and spread the room',
    },
    moves: [
      { key: 'filterCutoff', octaves: 0.4 },
      { key: 'fxReverbMix', add: 0.1 },
      { key: 'fxReverbSize', add: 0.08 },
      { key: 'osc1Spread', add: 0.12 },
    ],
  },
  brightness: {
    label: { zh: '清脆', en: 'brightness' },
    summary: {
      zh: '提截止与共振，并让滤波器包络更明显',
      en: 'lift the cutoff and resonance, and give the filter envelope more travel',
    },
    moves: [
      { key: 'filterCutoff', octaves: 0.55 },
      { key: 'filterRes', add: 0.08 },
      { key: 'filterEnvAmt', add: 0.12 },
    ],
  },
  width: {
    label: { zh: '宽度', en: 'width' },
    summary: {
      zh: '加宽立体声：展开振荡器与合唱',
      en: 'widen the stereo image: oscillator spread and chorus',
    },
    moves: [
      { key: 'osc1Spread', add: 0.3 },
      { key: 'fxChorusMix', add: 0.15 },
      { key: 'fxReverbMix', add: 0.05 },
    ],
  },
  softness: {
    label: { zh: '柔和', en: 'softness' },
    summary: {
      zh: '收掉边缘：慢起音、慢释放、少一点驱动',
      en: 'round the edges off: slower attack and release, less drive',
    },
    moves: [
      { key: 'filterCutoff', octaves: -0.5 },
      { key: 'filterDrive', add: -0.15 },
      { key: 'envAttack', octaves: 1.0 },
      { key: 'envRelease', octaves: 0.7 },
    ],
  },
};

/** The attribute names, in table order — what `inputSchema.enum` publishes. */
export const MORPH_NAMES = Object.keys(MORPH_ATTRIBUTES);

/**
 * Turn `(attribute, amount)` into a `{ key: value }` edit against `baseParams`.
 *
 * @returns {{ spec: object, edits: Record<string, number>,
 *             moved: { key: string, id: number, before: number, after: number, kind: string }[] }}
 */
export function morphEdits(data, baseParams, attribute, amount) {
  const spec = MORPH_ATTRIBUTES[attribute];
  if (!spec) {
    throw fail(ERRORS.SCHEMA, `unknown attribute "${attribute}"`, {
      field: 'attribute',
      value: attribute ?? null,
      allowed: MORPH_NAMES,
    });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -1 || amount > 1) {
    throw fail(ERRORS.RANGE, 'amount must be a number between -1 and 1', {
      field: 'amount',
      value: amount ?? null,
      min: -1,
      max: 1,
    });
  }

  const index = paramIndex(data);
  const edits = {};
  const moved = [];
  for (const move of spec.moves) {
    const entry = index.get(move.key.toLowerCase());
    if (!entry) continue;
    const kind = move.add !== undefined ? 'add' : move.octaves !== undefined ? 'octaves' : 'db';
    const per = move.add ?? move.octaves ?? move.db ?? 0;
    const before = baseParams?.[entry.id] ?? entry.default;
    const after =
      kind === 'add'
        ? before + per * amount
        : kind === 'octaves'
          ? before * 2 ** (per * amount)
          : before * 10 ** ((per * amount) / 20);
    edits[entry.key] = after;
    moved.push({ key: entry.key, id: entry.id, before, after, kind, per });
  }
  return { spec, edits, moved };
}
