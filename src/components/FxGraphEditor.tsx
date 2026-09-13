/**
 * Effect routing graph editor (A1/A2).
 *
 * The six effect positions are drawn as nodes between a DRY source and the OUT
 * bus. Two views edit the same parameters: a canvas where you drag (or tap) from
 * a source to an input, and a list where every connection is a select — the same
 * state, reachable without a pointer, which is what phones and screen readers
 * get by default.
 *
 * The geometry is fixed rather than measured: the cards are absolutely
 * positioned at the constants below, so a wire's endpoints are arithmetic and
 * cannot drift from the DOM. Everything that varies with language is clipped
 * with an ellipsis instead of changing a card's size.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FX_CONV_INSTANCES,
  FX_DELAY_INSTANCES,
  FX_DELAY_MAX_SECONDS,
  FX_KIND_LABELS,
  FX_KINDS,
  FX_MOD_SLOTS,
  FX_MOD_SOURCES,
  FX_MOD_SRC_LABELS,
  FX_OVR_MOD_SLOTS,
  FX_OVR_SLOTS,
  FX_OVR_UNSET,
  FX_SLOTS,
  GRAPH_DRY,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  fxKindCanBeParallel,
  fxKindToInt,
  graphFromChain,
  graphInGainId,
  graphInId,
  graphModDepthId,
  graphModDst,
  graphModDstId,
  graphModSrcId,
  graphModTarget,
  graphNodeSrc,
  graphOutGainId,
  graphToOutId,
  intToFxKind,
  ovrDepthBusId,
  ovrId,
  FX_OVR_SLOTS_BY_KIND,
  ovrSlotCode,
  ovrSlotFormat,
  ovrSlotLabel,
  ovrSlotParam,
  ovrSlotRange,
  ovrTargetBusId,
  ovrUnifyBusEntries,
  type FxKind,
  type FxModSrc,
  type ParamId,
} from '@/audio/params';
import { getUserIr } from '@/audio/ir';
import { BUILTIN_FX_TEMPLATES, type FxTemplate } from '@/state/fxtemplates';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { useViewport } from '@/hooks/useViewport';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { t } from '@/i18n';
// Register this panel's copy at module scope (P11.2): the import is awaited by
// `App.tsx` before the component module resolves, so the first render already
// has real strings. Idempotent, and normally already done by the idle preload.
import { loadFxStrings } from '@/i18n-panels';
void loadFxStrings();
import { toast } from './Toast';

/* Card geometry (px). The canvas scrolls when the screen is narrower. */
const CARD_W = 208;
const CARD_H = 218;
const CARD_GAP = 14;
const DRY_W = 176;
const COL_X = [12, 292, 572];
const PAD = 14;

/** Vertical offset of the two input ports inside a card. */
const IN_PORT_Y = [64, 92];
const OUT_PORT_Y = CARD_H / 2;

const NODES_H = FX_SLOTS * (CARD_H + CARD_GAP) - CARD_GAP;

/**
 * The modulation sources that live in the graph (P7.2). They have no audio
 * output: their card's port is the start of a modulation wire, and the depth
 * is stored on the edge it lands on.
 */
const MOD_CARDS: { key: string; src: FxModSrc; label: string }[] = [
  { key: 'lfo1', src: 1, label: 'LFO 1' },
  { key: 'lfo2', src: 2, label: 'LFO 2' },
  { key: 'env', src: 3, label: 'ENV' },
];

/** Where a card sits when the user has never moved it. */
function defaultPos(key: string): [number, number] {
  if (key === 'dry') return [COL_X[0], 12];
  if (key === 'out') return [COL_X[2], 12 + Math.round((NODES_H - CARD_H) / 2)];
  // The modulation sources stack under the dry card, so they do not move any
  // card an existing workspace has already arranged.
  const mod = MOD_CARDS.findIndex((card) => card.key === key);
  if (mod !== -1) return [COL_X[0], 12 + (mod + 1) * (CARD_H + CARD_GAP)];
  const slot = Number(key.slice(4)) - 1;
  return [COL_X[1], 12 + (Number.isFinite(slot) ? slot : 0) * (CARD_H + CARD_GAP)];
}

const isDry = (key: string) => key === 'dry';
const cardWidth = (key: string) =>
  isDry(key) || MOD_CARDS.some((card) => card.key === key) ? DRY_W : CARD_W;

/** A source code that can feed an input: the dry bus, or an earlier node. */
function sourcesFor(slot: number): number[] {
  const out = [GRAPH_DRY];
  for (let earlier = 0; earlier < slot; earlier++) out.push(graphNodeSrc(earlier));
  return out;
}

/** The canvas an event happened in, found from the event rather than a ref so
 * nothing has to read a ref during render. */
function canvasOf(event: React.PointerEvent): HTMLElement | null {
  return (event.currentTarget as Element | null)?.closest?.('.fxg-canvas') as HTMLElement | null;
}

/** Pointer position inside an element, or the origin when it is not mounted. */
function pointIn(
  element: HTMLElement | null,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = element?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function sourceLabel(src: number): string {
  if (src === GRAPH_DRY) return t('fxg.dry');
  if (src >= 2 && src < 2 + FX_SLOTS) return `${t('fxg.node')} ${src - 1}`;
  return t('fxg.none');
}

/** The gain a modulation destination code names, as text. */
function modPortLabel(which: 0 | 1 | 2): string {
  if (which === 0) return t('fxg.modPortIn1');
  if (which === 1) return t('fxg.modPortIn2');
  return t('fxg.modPortOut');
}

/** Which mix parameter belongs to each effect kind. */
const MIX_PARAM: Partial<Record<FxKind, ParamId>> = {
  delay: Param.FX_DELAY_MIX,
  reverb: Param.FX_REVERB_MIX,
  chorus: Param.FX_CHORUS_MIX,
  flanger: Param.FX_FLANGER_MIX,
  phaser: Param.FX_PHASER_MIX,
  drive: Param.FX_DRIVE_MIX,
  crush: Param.FX_CRUSH_MIX,
  eq: Param.FX_EQ_MIX,
  transient: Param.FX_TRANSIENT_MIX,
};

const ON_PARAM: Partial<Record<FxKind, ParamId>> = {
  delay: Param.FX_DELAY_ON,
  reverb: Param.FX_REVERB_ON,
  chorus: Param.FX_CHORUS_ON,
  flanger: Param.FX_FLANGER_ON,
  phaser: Param.FX_PHASER_ON,
  drive: Param.FX_DRIVE_ON,
  crush: Param.FX_CRUSH_ON,
  eq: Param.FX_EQ_ON,
  transient: Param.FX_TRANSIENT_ON,
};

/**
 * The value a kind-level parameter holds today (P9.3).
 *
 * An override knob starts from this, and "follows the kind's default" displays
 * it, so the override section reads the same patch the engine would without an
 * override. Delay time has no kind-level id: it is derived from the tempo and
 * the sync division, which is why it is special-cased here the same way
 * `ovr_slot_is_time` does in the core. Both instances share one tempo and one
 * sync, so reading instance 1 is the base for either.
 */
function kindBaseValue(params: Record<number, number>, kind: FxKind, slot: number): number {
  if (kind === 'delay' && slot === 0) {
    const quarter = 60 / Math.max(20, params[Param.TEMPO] ?? 120);
    const sync = Math.round(params[Param.FX_DELAY_SYNC] ?? 2);
    return sync === 0 ? quarter : sync === 1 ? quarter * 0.75 : sync === 2 ? quarter * 0.5 : quarter * 0.25;
  }
  const param = ovrSlotParam(kind, slot);
  return param === null ? 0 : (params[param] ?? 0);
}

export function FxGraphEditor({ onClose }: { onClose: () => void }) {
  const snapshot = useSynth();
  const params = snapshot.state.params;
  const viewport = useViewport();
  /**
   * `null` means "whatever suits this screen": the canvas on a desktop, the
   * list on a phone. Deriving it keeps the choice out of an effect, which would
   * set state during render on the first paint.
   */
  const [viewChoice, setViewChoice] = useState<'canvas' | 'list' | null>(null);
  const view = viewChoice ?? (viewport.device === 'phone' ? 'list' : 'canvas');
  /** A source waiting for an input to be tapped (touch and keyboard path). */
  const [pending, setPending] = useState<number | null>(null);
  /**
   * The pointer gesture in progress. One state covers both gestures: a tap on a
   * port arms a source, and moving the pointer while it is armed turns the same
   * gesture into a wire drag. Keeping them together is what stops a tap from
   * being seen twice (once as a drag, once as a click).
   */
  /** The wire whose gain is being edited, as `slot:which`. */
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  /** The card being moved, and where the pointer grabbed it. */
  const [moving, setMoving] = useState<{
    key: string;
    dx: number;
    dy: number;
  } | null>(null);
  const [armed, setArmed] = useState<{
    src: number;
    x: number;
    y: number;
    fromX: number;
    fromY: number;
    moved: boolean;
  } | null>(null);
  /** The modulation source waiting for a node gain port to be tapped (P7.2). */
  const [armedMod, setArmedMod] = useState<FxModSrc | null>(null);
  /** The modulation edge whose depth is being edited. */
  const [selectedMod, setSelectedMod] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const graphOn = (params[Param.FX_GRAPH] ?? 0) >= 0.5;
  const savedPos = snapshot.layout.fxGraphPos;
  /**
   * Effect-graph templates (P7.3). The list lives in the workspace, the
   * built-ins in code; picking one applies its routing to the patch, and the
   * select keeps whatever was picked last so the save/delete buttons line up.
   */
  const [template, setTemplate] = useState('');
  const userTemplates = snapshot.layout.fxTemplates;
  const chosenTemplate = userTemplates.find((entry) => entry.id === template) ?? null;
  const templateLabel = (entry: FxTemplate) => (entry.nameKey ? t(entry.nameKey) : entry.name);
  const applyTemplate = (id: string) => {
    setTemplate(id);
    const entry = [...BUILTIN_FX_TEMPLATES, ...userTemplates].find((item) => item.id === id);
    if (!entry) return;
    haptic(HAPTIC.light);
    store.applyFxTemplate(id);
    toast(t('fxg.tplApplied', { name: templateLabel(entry) }));
  };
  const posOf = useCallback(
    (key: string): [number, number] => savedPos[key] ?? defaultPos(key),
    [savedPos],
  );
  /** The board grows with the cards, so a dragged card is never out of reach. */
  const canvasSize = useMemo(() => {
    let w = 720;
    let h = 420;
    for (const key of [
      'dry',
      'out',
      ...MOD_CARDS.map((card) => card.key),
      ...Array.from({ length: FX_SLOTS }, (_, i) => `node${i + 1}`),
    ]) {
      const [x, y] = posOf(key);
      w = Math.max(w, x + cardWidth(key) + PAD);
      h = Math.max(h, y + CARD_H + PAD);
    }
    return { w, h };
  }, [posOf]);
  // Derived per render: the compiler memoises this itself, and saying so twice
  // (the manual `useMemo` that was here) is what the lint complains about.
  const nodes = Array.from({ length: FX_SLOTS }, (_, slot) => ({
    slot,
    kind: intToFxKind(params[Param.FX_CHAIN1 + slot] ?? 0),
    parallel: (params[Param.FX_PARALLEL1 + slot] ?? 0) >= 0.5,
    in1: {
      src: Math.round(params[graphInId(slot, 0)] ?? 0),
      gain: params[graphInGainId(slot, 0)] ?? 1,
    },
    in2: {
      src: Math.round(params[graphInId(slot, 1)] ?? 0),
      gain: params[graphInGainId(slot, 1)] ?? 1,
    },
    toOut: (params[graphToOutId(slot)] ?? 0) >= 0.5,
    outGain: params[graphOutGainId(slot)] ?? 1,
  }));

  /**
   * The delay and convolution pools (P7.1).
   *
   * The core holds `FX_DELAY_INSTANCES` delay lines (2 s each) and
   * `FX_CONV_INSTANCES` convolution tails, so a second node of those kinds now
   * has its own state instead of passing through. A node *past* the pool still
   * has none, so the editor disables that choice and says what is left rather
   * than handing out a node that would do nothing.
   */
  const convMode = (params[Param.FX_REVERB_MODE] ?? 0) >= 0.5 && getUserIr() !== null;
  const delayNodes = nodes.filter((node) => node.kind === 'delay').length;
  const convNodes = convMode ? nodes.filter((node) => node.kind === 'reverb').length : 0;
  /** Nodes of a pooled kind other than `except` — what the choice would add to. */
  const usedOther = (kind: FxKind, except: number) =>
    nodes.filter((node) => node.slot !== except && node.kind === kind).length;
  const poolFull = (kind: FxKind, except: number) => {
    if (kind === 'delay') return usedOther('delay', except) >= FX_DELAY_INSTANCES;
    if (kind === 'reverb' && convMode) return usedOther('reverb', except) >= FX_CONV_INSTANCES;
    return false;
  };
  /** The reason a full pool shows on the disabled option. */
  const poolReason = (kind: FxKind) =>
    kind === 'delay'
      ? t('fxg.delayPoolFull', { capacity: FX_DELAY_INSTANCES, seconds: FX_DELAY_MAX_SECONDS })
      : t('fxg.convPoolFull', { capacity: FX_CONV_INSTANCES });
  /** Delay time the pool can still hand to a new node, in seconds. */
  const delaySecondsLeft = Math.max(0, FX_DELAY_INSTANCES - delayNodes) * FX_DELAY_MAX_SECONDS;

  // Escape closes it, like every other overlay. The component is mounted only
  // while it is open, so closing discards the gestures in progress.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Turn the graph on for the first edit, seeded from the chain that is playing
   * now, so the sound does not jump when the editor takes over.
   */
  const ensureGraph = useCallback(() => {
    if (graphOn) return;
    const values = graphFromChain((id) => store.getParam(id as ParamId));
    // One change, not 37: see SynthStore.setParams.
    store.setParams(
      GRAPH_FROM_CHAIN_IDS.map((id, index) => [id, values[index]] as [ParamId, number]),
      { immediate: true },
    );
  }, [graphOn]);

  /**
   * In-graph modulation edges as the patch has them (P7.2). An edge is live
   * when it has a source, a gain target and a non-zero depth; the DSP ignores
   * it otherwise, which is why a fresh patch behaves exactly as it did.
   */
  const modEdges = Array.from({ length: FX_MOD_SLOTS }, (_, edge) => ({
    edge,
    src: Math.round(params[graphModSrcId(edge)] ?? 0) as FxModSrc,
    dst: Math.round(params[graphModDstId(edge)] ?? 0),
    depth: params[graphModDepthId(edge)] ?? 0,
  }));
  const liveMods = modEdges.filter((e) => e.src !== 0 && e.dst !== 0 && e.depth !== 0);

  /** Constant source of the whole override modulation bus: 0 off, 1..3. */
  const ovrModSrc = Math.round(params[Param.FX_OVR_SRC] ?? 0) as FxModSrc;
  /**
   * Which override slot each node's bus row sweeps, and how far (P9.3).
   *
   * The core stores eight independent rows, so any eight of the twenty-four
   * slots can be swept at once; the editor shows one row per node, which is the
   * same shape as the P7.2 edges above and keeps the panel short. Pointing a
   * node's row at a new slot moves the whole pair (`ovrUnifyBusEntries`), so no
   * amount is left sweeping a slot the player can no longer see.
   */
  const ovrModRows = Array.from({ length: FX_SLOTS }, (_, node) => {
    let target = 0;
    let depth = 0;
    let bus = 0;
    let found = false;
    const wanted: number[] = [];
    for (let column = 0; column < FX_OVR_SLOTS; column += 1) {
      if (ovrSlotLabel(nodes[node].kind, column) !== '') wanted.push(ovrSlotCode(node, column));
    }
    for (let index = 0; index < FX_OVR_MOD_SLOTS; index += 1) {
      const code = Math.round(params[ovrTargetBusId(index)] ?? 0);
      if (code === 0 || !wanted.includes(code)) continue;
      if (!found) {
        found = true;
        bus = index;
        target = code;
        depth = params[ovrDepthBusId(index)] ?? 0;
      }
    }
    return { node, bus, target, depth, found };
  });

  const setModEdge = (edge: number, src: number, dst: number, depth: number) => {
    ensureGraph();
    store.setParams(
      [
        [graphModSrcId(edge), src],
        [graphModDstId(edge), dst],
        [graphModDepthId(edge), depth],
      ],
      { immediate: true },
    );
  };

  /** Drop a source onto a node's gain: reuse the edge already there, else a free one. */
  const connectMod = (src: FxModSrc, slot: number, which: 0 | 1 | 2) => {
    haptic(HAPTIC.light);
    const dst = graphModDst(slot, which);
    const existing = modEdges.find((e) => e.dst === dst && e.src !== 0);
    const free = modEdges.find((e) => e.src === 0 || e.dst === 0 || e.depth === 0);
    const edge = existing?.edge ?? free?.edge;
    if (edge === undefined) {
      toast(t('fxg.modFull', { slots: FX_MOD_SLOTS }));
      return;
    }
    const depth = existing && existing.depth !== 0 ? existing.depth : 0.5;
    setModEdge(edge, src, dst, depth);
    setArmedMod(null);
    setPending(null);
  };

  const disconnectMod = (edge: number) => {
    store.setParams(
      [
        [graphModSrcId(edge), 0],
        [graphModDstId(edge), 0],
        [graphModDepthId(edge), 0],
      ],
      { immediate: true },
    );
  };

  const connect = useCallback(
    (slot: number, which: 0 | 1, src: number) => {
      haptic(HAPTIC.light);
      ensureGraph();
      const gainId = graphInGainId(slot, which);
      store.setParam(graphInId(slot, which), src, { immediate: true });
      if ((store.getParam(gainId) ?? 1) < 0.01) store.setParam(gainId, 1, { immediate: true });
      setPending(null);
    },
    [ensureGraph],
  );

  const disconnect = useCallback((slot: number, which: 0 | 1) => {
    haptic(HAPTIC.light);
    store.setParam(graphInId(slot, which), 0, { immediate: true });
    setPending(null);
  }, []);

  const rebuildFromChain = useCallback(() => {
    const values = graphFromChain((id) => store.getParam(id as ParamId));
    store.setParams(
      GRAPH_FROM_CHAIN_IDS.map((id, index) => [id, values[index]] as [ParamId, number]),
      { immediate: true },
    );
    toast(t('fxg.rebuilt'));
  }, []);


  /** Grab a card by its title strip and move it around the board. */
  const dragCard = (key: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasOf(event);
    const point = pointIn(canvas, event);
    const [left, top] = posOf(key);
    setMoving({ key, dx: point.x - left, dy: point.y - top });
    setArmed(null);
    // Capture on the board, so a fast drag that leaves the card (or the board)
    // for a moment keeps arriving here instead of stopping dead.
    canvas?.setPointerCapture?.(event.pointerId);
  };

  const moveCard = (event: React.PointerEvent) => {
    if (!moving) return;
    const point = pointIn(canvasOf(event), event);
    store.setFxGraphPosition(moving.key, [
      Math.round(point.x - moving.dx),
      Math.round(point.y - moving.dy),
    ]);
  };

  /**
   * Pointer down on a source port: tap the armed source again to put it down,
   * otherwise pick it up. Nothing is connected yet — that happens on release,
   * either on an input (a drag) or on the next tap (an input port or its row).
   */
  const armOrDisarm = (src: number) => {
    if (pending === src) {
      setPending(null);
      setArmed(null);
      return;
    }
    setPending(src);
    setArmed(null);
    // One gesture at a time: arming an audio source drops a modulation source.
    setArmedMod(null);
  };

  const startFrom = (src: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    if (pending === src) {
      setPending(null);
      setArmed(null);
      return;
    }
    const point = pointIn(canvasOf(event), event);
    setPending(src);
    setArmed({ src, x: point.x, y: point.y, fromX: point.x, fromY: point.y, moved: false });
    setArmedMod(null);
  };

  /** Which input the pointer is over, if any. */
  const inputUnder = (event: { clientX: number; clientY: number }) => {
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = element?.closest('[data-input]') as HTMLElement | null;
    if (!target) return null;
    const [slot, which] = target.dataset.input!.split(':').map(Number);
    if (!Number.isFinite(slot) || !Number.isFinite(which)) return null;
    return { slot, which: which as 0 | 1 };
  };

  /** Which node gain port the pointer is over, if any (P7.2). */
  const modPortUnder = (event: { clientX: number; clientY: number }) => {
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = element?.closest('[data-mod]') as HTMLElement | null;
    if (!target) return null;
    const [slot, which] = target.dataset.mod!.split(':').map(Number);
    if (!Number.isFinite(slot) || !Number.isFinite(which)) return null;
    return { slot, which: which as 0 | 1 | 2 };
  };

  /** Arm a modulation source: tap its port, then tap a node gain port. */
  const startFromMod = (src: FxModSrc) => (event: React.PointerEvent) => {
    event.preventDefault();
    if (armedMod === src) {
      setArmedMod(null);
      return;
    }
    setArmedMod(src);
    setPending(null);
    setArmed(null);
  };

  const releasePointer = (event: React.PointerEvent) => {
    if (armedMod !== null) {
      const gesture = armedMod;
      setArmedMod(null);
      const target = modPortUnder(event);
      if (target) connectMod(gesture, target.slot, target.which);
      return;
    }
    if (!armed) return;
    const gesture = armed;
    setArmed(null);
    const target = inputUnder(event);
    if (!target) return;
    if (!sourcesFor(target.slot).includes(gesture.src)) return;
    connect(target.slot, target.which, gesture.src);
  };

  /** One input row: source select, gain, and a disconnect button. */
  const inputRow = (slot: number, which: 0 | 1, input: { src: number; gain: number }) => (
    <div className="fxg-row" key={`${slot}-${which}`} data-input={`${slot}:${which}`}>
      <select
        className="fxg-src"
        data-act={`in${which + 1}`}
        data-node={slot}
        aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.input')} ${which + 1} ${t('fxg.source')}`}
        value={input.src}
        onChange={(event) => {
          const src = Number(event.target.value);
          if (src === 0) disconnect(slot, which);
          else connect(slot, which, src);
        }}
      >
        <option value={0}>{t('fxg.none')}</option>
        {sourcesFor(slot).map((src) => (
          <option key={src} value={src}>
            {sourceLabel(src)}
          </option>
        ))}
      </select>
      <input
        type="range"
        className="fxg-gain"
        data-act={`gain${which + 1}`}
        data-node={slot}
        min={0}
        max={200}
        value={Math.round(input.gain * 100)}
        aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.input')} ${which + 1} ${t('fxg.gain')}`}
        onChange={(event) => {
          ensureGraph();
          store.setParam(graphInGainId(slot, which), Number(event.target.value) / 100);
        }}
      />
      <span className="fxg-gain-val">{Math.round(input.gain * 100)}%</span>
    </div>
  );

  /**
   * One node's override slots (P9.3).
   *
   * A slot is either unset — the engine reads the kind's own knob and the
   * editor says so — or an explicit value, and the toggle is what moves it
   * between the two. The controls are full-width range inputs so a phone gets
   * the same 36 px target here as everywhere else in this editor.
   */
  const overrideBlock = (slot: number) => {
    const kind = nodes[slot].kind;
    if (kind === 'none') return null;
    const rows = Array.from({ length: FX_OVR_SLOTS }, (_, column) => {
      const empty = ovrSlotLabel(kind, column) === '';
      if (empty) return null;
      const id = ovrId(slot, column);
      const stored = params[id] ?? FX_OVR_UNSET;
      const on = stored !== FX_OVR_UNSET;
      const base = kindBaseValue(params, kind, column);
      const [min, max] = ovrSlotRange(kind, column);
      const format = ovrSlotFormat(kind, column);
      const value = on ? stored : base;
      return (
        <div className="fxg-ovr-row" key={column} data-ovr-row={`${slot}:${column}`}>
          <button
            type="button"
            className={`fxg-ovr-toggle${on ? ' on' : ''}`}
            data-act="ovr-toggle"
            data-node={slot}
            data-ovr-slot={column}
            aria-pressed={on}
            aria-label={`${t('fxg.node')} ${slot + 1} ${ovrSlotLabel(kind, column)} ${t('fxg.ovr')}`}
            title={on ? t('fxg.ovr') : t('fxg.ovrFollow', { name: FX_KIND_LABELS[kind] })}
            onClick={() => {
              haptic(HAPTIC.light);
              if (on) store.setParam(id, FX_OVR_UNSET);
              else store.setParam(id, kindBaseValue(params, kind, column));
            }}
          >
            {on ? '●' : '○'}
          </button>
          <span className="fxg-mix-label">{ovrSlotLabel(kind, column)}</span>
          <input
            type="range"
            className="fxg-gain"
            data-act="ovr-value"
            data-node={slot}
            data-ovr-slot={column}
            min={min}
            max={max}
            step={(max - min) / 200}
            value={value}
            disabled={!on}
            aria-label={`${t('fxg.node')} ${slot + 1} ${ovrSlotLabel(kind, column)}`}
            onChange={(event) =>
              store.setParam(id, Math.max(min, Math.min(max, Number(event.target.value))))
            }
          />
          <span className={`fxg-gain-val${on ? '' : ' follow'}`}>
            {on ? format(value) : t('fxg.ovrFollowShort')}
          </span>
        </div>
      );
    });
    const used = rows.filter(Boolean).length;
    return (
      <div className="fxg-ovr" data-ovr-node={slot}>
        <div className="fxg-ovr-head">
          <span className="fxg-ovr-title" title={t('fxg.ovrHint')}>
            {t('fxg.ovr')}
          </span>
          <button
            type="button"
            className="fxg-wire-del"
            data-act="ovr-follow"
            data-node={slot}
            aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.ovrClear')}`}
            title={t('fxg.ovrClear')}
            onClick={() => {
              haptic(HAPTIC.light);
              store.setParams(
                Array.from({ length: FX_OVR_SLOTS }, (_, column) => [ovrId(slot, column), FX_OVR_UNSET] as [ParamId, number]),
                { immediate: true },
              );
            }}
          >
            {t('fxg.ovrClear')}
          </button>
        </div>
        {used > 0 ? rows : null}
      </div>
    );
  };

  const cardBody = (slot: number) => {
    const node = nodes[slot];
    const mixParam = MIX_PARAM[node.kind];
    const onParam = ON_PARAM[node.kind];
    return (
      <>
        <div className="fxg-card-head">
          <select
            className="fxg-kind"
            data-act="kind"
            data-node={slot}
            aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.effect')}`}
            value={node.kind}
            onChange={(event) => {
              ensureGraph();
              store.setParam((Param.FX_CHAIN1 + slot) as ParamId, fxKindToInt(event.target.value as FxKind), {
                immediate: true,
              });
            }}
          >
            {FX_KINDS.map((kind) => {
              const taken = kind !== node.kind && poolFull(kind, slot);
              return (
                <option
                  key={kind}
                  value={kind}
                  disabled={taken}
                  title={taken ? poolReason(kind) : undefined}
                >
                  {FX_KIND_LABELS[kind]}
                  {taken ? ` (${t('fxg.poolFull')})` : ''}
                </option>
              );
            })}
          </select>
          {onParam !== undefined ? (
            <button
              type="button"
              className={`fxg-on${(params[onParam] ?? 0) >= 0.5 ? ' on' : ''}`}
              data-act="on"
              data-node={slot}
              aria-pressed={(params[onParam] ?? 0) >= 0.5}
              aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.on')}`}
              onClick={() => {
                const on = (params[onParam] ?? 0) >= 0.5;
                store.setParam(onParam, on ? 0 : 1, { immediate: true });
              }}
            >
              ⏻
            </button>
          ) : null}
          {fxKindCanBeParallel(node.kind) ? (
            <button
              type="button"
              className={`fxg-par${node.parallel ? ' on' : ''}`}
              data-act="parallel"
              data-node={slot}
              aria-pressed={node.parallel}
              aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.parallel')}`}
              title={t('fx.parallelHint')}
              onClick={() =>
                store.setParam((Param.FX_PARALLEL1 + slot) as ParamId, node.parallel ? 0 : 1, { immediate: true })
              }
            >
              ∥
            </button>
          ) : null}
        </div>
        {mixParam !== undefined ? (
          <div className="fxg-mix">
            <span className="fxg-mix-label">{t('fxg.mix')}</span>
            <input
              type="range"
              className="fxg-mix-range"
              data-act="mix"
              data-node={slot}
              min={0}
              max={100}
              value={Math.round((params[mixParam] ?? 0) * 100)}
              aria-label={`${t('fxg.node')} ${slot + 1} ${t('fxg.mix')}`}
              onChange={(event) => store.setParam(mixParam, Number(event.target.value) / 100)}
            />
          </div>
        ) : null}
        <div className="fxg-rows">
          {inputRow(slot, 0, node.in1)}
          {inputRow(slot, 1, node.in2)}
        </div>
        {overrideBlock(slot)}
      </>
    );
  };

  /** Wire geometry: input ports sit on the left edge, outputs on the right. */
  const wires = nodes.flatMap((node) =>
    ([0, 1] as const)
      .map((which) => ({ which, input: which === 0 ? node.in1 : node.in2 }))
      .filter(({ input }) => input.src !== 0)
      .map(({ which, input }) => {
        const fromKey = input.src === GRAPH_DRY ? 'dry' : `node${input.src - 1}`;
        const [fromLeft, fromTop] = posOf(fromKey);
        const [toLeft, toTop] = posOf(`node${node.slot + 1}`);
        const fromX = fromLeft + cardWidth(fromKey);
        const fromY = fromTop + OUT_PORT_Y;
        const toX = toLeft;
        const toY = toTop + IN_PORT_Y[which];
        return {
          key: `${node.slot}-${which}`,
          fromX,
          fromY,
          toX,
          toY,
          src: input.src,
          slot: node.slot,
          which,
          gain: input.gain,
          // Where the label chip sits: the midpoint of the curve, pulled a
          // little towards the source so it does not sit on the input port.
          labelX: (fromX + toX) / 2,
          labelY: (fromY + toY) / 2 - 8,
        };
      }),
  );

  const wirePath = (fromX: number, fromY: number, toX: number, toY: number) => {
    const bend = Math.max(28, Math.abs(toX - fromX) * 0.45);
    return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
  };

  /** The drawn modulation wires (P7.2): one per live edge. */
  const modWires = liveMods.flatMap((edge) => {
    const card = MOD_CARDS.find((entry) => entry.src === edge.src);
    const target = graphModTarget(edge.dst);
    if (!card || !target) return [];
    const [fromLeft, fromTop] = posOf(card.key);
    const [toLeft, toTop] = posOf(`node${target.node + 1}`);
    const fromX = fromLeft + cardWidth(card.key);
    const fromY = fromTop + OUT_PORT_Y;
    const toX = toLeft + 22 + target.which * 30 + 7;
    const toY = toTop + CARD_H - 12 + 7;
    return [
      {
        ...edge,
        card: card.key,
        fromX,
        fromY,
        toX,
        toY,
        labelX: (fromX + toX) / 2,
        labelY: (fromY + toY) / 2 + 16,
      },
    ];
  });

  return (
    <div className="fxg-mask show" data-act="fxg-mask" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="fxg-panel" role="dialog" aria-label={t('fxg.title')}>
        <div className="fxg-head">
          <span className="fxg-title">{t('fxg.title')}</span>
          <div className="seg fxg-view">
            <button
              type="button"
              className={view === 'canvas' ? 'on' : ''}
              data-act="view-canvas"
              onClick={() => setViewChoice('canvas')}
            >
              {t('fxg.canvas')}
            </button>
            <button
              type="button"
              className={view === 'list' ? 'on' : ''}
              data-act="view-list"
              onClick={() => setViewChoice('list')}
            >
              {t('fxg.list')}
            </button>
          </div>
          {/* Templates (P7.3): a routing saved in the workspace, applied to the
              patch in one change. Built-ins first, the player's own after. */}
          <div className="fxg-tpl">
            <select
              className="fxg-tpl-select"
              data-act="template"
              aria-label={t('fxg.tpl')}
              value={template}
              onChange={(event) => applyTemplate(event.target.value)}
            >
              <option value="">{t('fxg.tplPick')}</option>
              <optgroup label={t('fxg.tplBuiltin')}>
                {BUILTIN_FX_TEMPLATES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {templateLabel(entry)}
                  </option>
                ))}
              </optgroup>
              {userTemplates.length ? (
                <optgroup label={t('fxg.tplSaved')}>
                  {userTemplates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <button
              type="button"
              className="fxg-rebuild"
              data-act="template-save"
              title={t('fxg.tplSaveHint')}
              onClick={() => {
                haptic(HAPTIC.light);
                const saved = store.saveFxTemplate(
                  `${t('fxg.tplDefaultName')} ${userTemplates.length + 1}`,
                );
                setTemplate(saved.id);
                toast(t('fxg.tplSavedToast', { name: saved.name }));
              }}
            >
              {t('fxg.tplSave')}
            </button>
            <button
              type="button"
              className="fxg-rebuild"
              data-act="template-delete"
              aria-label={t('fxg.tplDelete')}
              disabled={chosenTemplate === null}
              onClick={() => {
                if (!chosenTemplate) return;
                haptic(HAPTIC.light);
                store.deleteFxTemplate(chosenTemplate.id);
                setTemplate('');
                toast(t('fxg.tplDeleted'));
              }}
            >
              ✕
            </button>
          </div>
          <button type="button" className="fxg-rebuild" data-act="rebuild" onClick={rebuildFromChain}>
            {t('fxg.rebuild')}
          </button>
          {view === 'canvas' ? (
            <button
              type="button"
              className="fxg-rebuild"
              data-act="reset-layout"
              onClick={() => store.resetFxGraphLayout()}
            >
              {t('fxg.resetLayout')}
            </button>
          ) : null}
          <button type="button" className="fxg-close" data-act="close" aria-label={t('fxg.close')} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="fxg-hint">
          {graphOn ? t('fxg.hintOn') : t('fxg.hintOff')}
          {view === 'canvas' ? ` · ${t('fxg.dragHint')}` : ''}
          {` · ${t('fxg.delayPool', {
            used: delayNodes,
            capacity: FX_DELAY_INSTANCES,
            left: delaySecondsLeft,
          })}`}
          {convMode
            ? ` · ${t('fxg.convPool', { used: convNodes, capacity: FX_CONV_INSTANCES })}`
            : ''}
        </div>

        {/*
          In-graph modulation (P7.2), as four rows. The canvas draws the same
          edges as wires; this is the reachable-without-a-pointer path, and it
          is what a phone gets by default.
        */}
        <div className="fxg-mod" data-view="mod">
          <span className="fxg-mod-title" title={t('fxg.modHint')}>
            {t('fxg.mod')}
          </span>
          {modEdges.map((edge) => (
            <div className="fxg-mod-row" key={edge.edge} data-mod-row={edge.edge}>
              <select
                className="fxg-src"
                data-act="mod-src"
                data-mod-row={edge.edge}
                aria-label={`${t('fxg.modSource')} ${edge.edge + 1}`}
                value={edge.src}
                onChange={(event) => {
                  ensureGraph();
                  store.setParams([[graphModSrcId(edge.edge), Number(event.target.value)]], {
                    immediate: true,
                  });
                }}
              >
                {FX_MOD_SOURCES.map((src) => (
                  <option key={src} value={src}>
                    {FX_MOD_SRC_LABELS[src]}
                  </option>
                ))}
              </select>
              <select
                className="fxg-src"
                data-act="mod-dst"
                data-mod-row={edge.edge}
                aria-label={`${t('fxg.modTarget')} ${edge.edge + 1}`}
                value={edge.dst}
                onChange={(event) => {
                  ensureGraph();
                  store.setParams([[graphModDstId(edge.edge), Number(event.target.value)]], {
                    immediate: true,
                  });
                }}
              >
                <option value={0}>{t('fxg.none')}</option>
                {nodes.flatMap((node) =>
                  ([0, 1, 2] as const).map((which) => (
                    <option key={`${node.slot}-${which}`} value={graphModDst(node.slot, which)}>
                      {t('fxg.modTargetLabel', { node: node.slot + 1, port: modPortLabel(which) })}
                    </option>
                  )),
                )}
              </select>
              <input
                type="range"
                className="fxg-gain"
                data-act="mod-depth"
                data-mod-row={edge.edge}
                min={-100}
                max={100}
                value={Math.round(edge.depth * 100)}
                aria-label={`${t('fxg.modDepth')} ${edge.edge + 1}`}
                onChange={(event) =>
                  store.setParam(graphModDepthId(edge.edge), Number(event.target.value) / 100)
                }
              />
              <span className="fxg-gain-val">{Math.round(edge.depth * 100)}%</span>
              <button
                type="button"
                className="fxg-wire-del"
                data-act="mod-del"
                data-mod-row={edge.edge}
                aria-label={`${t('fxg.modDelete')} ${edge.edge + 1}`}
                onClick={() => disconnectMod(edge.edge)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/*
          Per-node parameter overrides (P9.3) can be modulated too, by one
          source bus with an amount per node. The rows follow the same shape as
          the P7.2 edges above: a source, a target and a depth, reachable
          without a pointer, which is what a phone gets.
        */}
        <div className="fxg-mod" data-view="ovr-mod">
          <span className="fxg-mod-title" title={t('fxg.ovrModHint')}>
            {t('fxg.ovrMod')}
          </span>
          <select
            className="fxg-src"
            data-act="ovr-src"
            aria-label={t('fxg.modSource')}
            value={ovrModSrc}
            onChange={(event) =>
              store.setParam(Param.FX_OVR_SRC, Number(event.target.value), { immediate: true })
            }
          >
            {FX_MOD_SOURCES.map((src) => (
              <option key={src} value={src}>
                {FX_MOD_SRC_LABELS[src]}
              </option>
            ))}
          </select>
          {ovrModRows.map((row) => (
            <div className="fxg-mod-row" key={row.node} data-ovr-bus={row.node}>
              <select
                className="fxg-src"
                data-act="ovr-bus-target"
                data-ovr-bus={row.node}
                aria-label={`${t('fxg.ovrModTarget')} ${row.node + 1}`}
                value={row.target}
                onChange={(event) => {
                  ensureGraph();
                  store.setParams(
                    [
                      ...ovrUnifyBusEntries(params, row.node, 0, FX_OVR_MOD_SLOTS),
                      [ovrTargetBusId(ovrModRows[row.node].bus), Number(event.target.value)],
                    ],
                    { immediate: true },
                  );
                  if (Number(event.target.value) !== 0 && ovrModSrc === 0) {
                    store.setParam(Param.FX_OVR_SRC, 1, { immediate: true });
                  }
                }}
              >
                <option value={0}>{t('fxg.none')}</option>
                {FX_OVR_SLOTS_BY_KIND[nodes[row.node].kind].map((_, column) => {
                  const label = ovrSlotLabel(nodes[row.node].kind, column);
                  if (label === '') return null;
                  return (
                    <option key={column} value={ovrSlotCode(row.node, column)}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <input
                type="range"
                className="fxg-gain"
                data-act="ovr-bus-depth"
                data-ovr-bus={row.node}
                min={-100}
                max={100}
                value={Math.round(row.depth * 100)}
                aria-label={`${t('fxg.modDepth')} ${row.node + 1}`}
                onChange={(event) =>
                  store.setParam(
                    ovrDepthBusId(ovrModRows[row.node].bus),
                    Number(event.target.value) / 100,
                  )
                }
              />
              <span className="fxg-gain-val">{Math.round(row.depth * 100)}%</span>
              <button
                type="button"
                className="fxg-wire-del"
                data-act="ovr-bus-del"
                data-ovr-bus={row.node}
                aria-label={`${t('fxg.modDelete')} ${row.node + 1}`}
                onClick={() => {
                  ensureGraph();
                  store.setParams(
                    [
                      ...ovrUnifyBusEntries(params, row.node, 0, FX_OVR_MOD_SLOTS),
                      [ovrTargetBusId(ovrModRows[row.node].bus), 0],
                    ],
                    { immediate: true },
                  );
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {view === 'list' ? (
          <div className="fxg-list" data-view="list">
            {nodes.map((node) => (
              <div className="fxg-list-node" key={node.slot} data-node={node.slot}>
                <div className="fxg-list-title">
                  {t('fxg.node')} {node.slot + 1}
                </div>
                {cardBody(node.slot)}
                <div className="fxg-out-row">
                  <label className="fxg-out-label">
                    <input
                      type="checkbox"
                      data-act="toOut"
                      data-node={node.slot}
                      checked={node.toOut}
                      onChange={() => {
                        ensureGraph();
                        store.setParam(graphToOutId(node.slot), node.toOut ? 0 : 1, { immediate: true });
                      }}
                    />
                    {t('fxg.toOut')}
                  </label>
                  <input
                    type="range"
                    className="fxg-gain"
                    data-act="outGain"
                    data-node={node.slot}
                    min={0}
                    max={200}
                    value={Math.round(node.outGain * 100)}
                    aria-label={`${t('fxg.node')} ${node.slot + 1} ${t('fxg.outGain')}`}
                    onChange={(event) => {
                      ensureGraph();
                      store.setParam(graphOutGainId(node.slot), Number(event.target.value) / 100);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="fxg-scroll">
            <div
              className="fxg-canvas"
              ref={canvasRef}
              style={{ width: canvasSize.w, height: canvasSize.h }}
              data-view="canvas-area"
              onPointerMove={(event) => {
                if (moving) {
                  moveCard(event);
                  return;
                }
                if (!armed) return;
                const point = pointIn(canvasOf(event), event);
                const moved =
                  armed.moved ||
                  Math.hypot(point.x - armed.fromX, point.y - armed.fromY) > 6;
                setArmed({ ...armed, x: point.x, y: point.y, moved });
              }}
              onPointerUp={(event) => {
                if (moving) {
                  moveCard(event);
                  haptic(HAPTIC.light);
                  setMoving(null);
                  return;
                }
                releasePointer(event);
              }}
            >
              <svg className="fxg-wires" width={canvasSize.w} height={canvasSize.h}>
                {wires.map((wire) => (
                  <path
                    key={wire.key}
                    className={`fxg-wire${selectedWire === wire.key ? ' selected' : ''}`}
                    data-wire={`${wire.slot}:${wire.which}`}
                    d={wirePath(wire.fromX, wire.fromY, wire.toX, wire.toY)}
                    // A click picks the connection so its gain can be set here;
                    // the ✕ on the chip is what deletes it, so a stray click
                    // cannot unwire a patch (it used to).
                    onClick={() =>
                      setSelectedWire((current) => (current === wire.key ? null : wire.key))
                    }
                    // A wire is a control, not decoration: it takes focus so a
                    // keyboard user can pick it and then set its gain in the
                    // chip that appears (whose slider is focusable).
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedWire === wire.key}
                    aria-label={`${sourceLabel(wire.src)} → ${t('fxg.node')} ${wire.slot + 1} ${t('fxg.input')} ${wire.which + 1}, ${t('fxg.gain')} ${Math.round(wire.gain * 100)}%`}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSelectedWire((current) => (current === wire.key ? null : wire.key));
                    }}
                  />
                ))}
                {modWires.map((wire) => (
                  <path
                    key={`mod-${wire.edge}`}
                    className={`fxg-wire mod${selectedMod === wire.edge ? ' selected' : ''}`}
                    data-modwire={wire.edge}
                    d={wirePath(wire.fromX, wire.fromY, wire.toX, wire.toY)}
                    // Picking a modulation wire opens its depth chip; a click
                    // never deletes it, like the audio wires.
                    onClick={() =>
                      setSelectedMod((current) => (current === wire.edge ? null : wire.edge))
                    }
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedMod === wire.edge}
                    aria-label={`${FX_MOD_SRC_LABELS[wire.src]} → ${t('fxg.modTargetLabel', {
                      node: (graphModTarget(wire.dst)?.node ?? 0) + 1,
                      port: modPortLabel((graphModTarget(wire.dst)?.which ?? 0) as 0 | 1 | 2),
                    })}, ${t('fxg.modDepth')} ${Math.round(wire.depth * 100)}%`}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSelectedMod((current) => (current === wire.edge ? null : wire.edge));
                    }}
                  />
                ))}
{armed?.moved ? (
                  <path
                    className="fxg-wire ghost"
                    d={(() => {
                      const key = armed.src === GRAPH_DRY ? 'dry' : `node${armed.src - 1}`;
                      const [left, top] = posOf(key);
                      return wirePath(left + cardWidth(key), top + OUT_PORT_Y, armed.x, armed.y);
                    })()}
                  />
                ) : null}
              </svg>

                {wires.map((wire) =>
                  selectedWire === wire.key ? (
                    <div
                      className="fxg-wire-edit"
                      key={`edit-${wire.key}`}
                      style={{ left: wire.labelX - 78, top: wire.labelY - 12 }}
                      data-wire-edit={`${wire.slot}:${wire.which}`}
                    >
                      <input
                        type="range"
                        className="fxg-gain"
                        data-act="wire-gain"
                        min={0}
                        max={200}
                        value={Math.round(wire.gain * 100)}
                        aria-label={`${t('fxg.node')} ${wire.slot + 1} ${t('fxg.input')} ${wire.which + 1} ${t('fxg.gain')}`}
                        onChange={(event) => {
                          ensureGraph();
                          store.setParam(
                            graphInGainId(wire.slot, wire.which as 0 | 1),
                            Number(event.target.value) / 100,
                          );
                        }}
                      />
                      <span className="fxg-wire-val">{Math.round(wire.gain * 100)}%</span>
                      <button
                        type="button"
                        className="fxg-wire-del"
                        data-act="wire-del"
                        aria-label={`${t('fxg.disconnect')} ${t('fxg.node')} ${wire.slot + 1} ${t('fxg.input')} ${wire.which + 1}`}
                        onClick={() => {
                          disconnect(wire.slot, wire.which as 0 | 1);
                          setSelectedWire(null);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : wire.gain !== 1 ? (
                    <button
                      type="button"
                      className="fxg-wire-label"
                      key={`label-${wire.key}`}
                      style={{ left: wire.labelX - 22, top: wire.labelY - 10 }}
                      data-wire-label={`${wire.slot}:${wire.which}`}
                      title={t('fxg.wireHint')}
                      onClick={() => setSelectedWire(wire.key)}
                    >
                      {Math.round(wire.gain * 100)}%
                    </button>
                  ) : null,
                )}
                {/* The depth chip of a picked modulation wire (P7.2). */}
                {modWires.map((wire) =>
                  selectedMod === wire.edge ? (
                    <div
                      className="fxg-wire-edit"
                      key={`mod-edit-${wire.edge}`}
                      style={{ left: wire.labelX - 78, top: wire.labelY - 12 }}
                      data-mod-edit={wire.edge}
                    >
                      <input
                        type="range"
                        className="fxg-gain"
                        data-act="mod-wire-depth"
                        min={-100}
                        max={100}
                        value={Math.round(wire.depth * 100)}
                        aria-label={t('fxg.modDepth')}
                        onChange={(event) =>
                          store.setParam(graphModDepthId(wire.edge), Number(event.target.value) / 100)
                        }
                      />
                      <span className="fxg-wire-val">{Math.round(wire.depth * 100)}%</span>
                      <button
                        type="button"
                        className="fxg-wire-del"
                        data-act="mod-wire-del"
                        aria-label={t('fxg.modDelete')}
                        onClick={() => {
                          disconnectMod(wire.edge);
                          setSelectedMod(null);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : null,
                )}
                

              {/* DRY source */}
              <div
                className={`fxg-card fxg-dry${moving?.key === 'dry' ? ' moving' : ''}`}
                style={{ left: posOf('dry')[0], top: posOf('dry')[1], width: DRY_W, height: CARD_H }}
              >
                <div
                  className="fxg-card-title fxg-drag"
                  data-act="drag-dry"
                  onPointerDown={dragCard('dry')}
                >
                  {t('fxg.dry')}
                </div>
                <div className="fxg-card-sub">{t('fxg.dryHint')}</div>
                <button
                  type="button"
                  className={`fxg-port out${pending === GRAPH_DRY ? ' pending' : ''}`}
                  style={{ right: -9, top: OUT_PORT_Y - 9 }}
                  data-act="port-dry"
                  aria-label={`${t('fxg.dry')} ${t('fxg.output')}`}
                  onPointerDown={startFrom(GRAPH_DRY)}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    armOrDisarm(GRAPH_DRY);
                  }}
                />
              </div>

              {/* Modulation sources (P7.2). Their output only carries a
                  modulation wire; the depth lives on the edge. */}
              {MOD_CARDS.map((card) => (
                <div
                  className={`fxg-card fxg-mod-src${
                    moving?.key === card.key ? ' moving' : ''
                  }`}
                  key={card.key}
                  style={{
                    left: posOf(card.key)[0],
                    top: posOf(card.key)[1],
                    width: DRY_W,
                    height: CARD_H,
                  }}
                >
                  <div
                    className="fxg-card-title fxg-drag"
                    data-act={`drag-${card.key}`}
                    onPointerDown={dragCard(card.key)}
                  >
                    {card.label}
                  </div>
                  <div className="fxg-card-sub">{t('fxg.mod')}</div>
                  <button
                    type="button"
                    className={`fxg-port out mod${armedMod === card.src ? ' pending' : ''}`}
                    style={{ right: -9, top: OUT_PORT_Y - 9 }}
                    data-act="port-mod-src"
                    data-mod-src={card.src}
                    aria-label={`${card.label} ${t('fxg.modSource')}`}
                    onPointerDown={startFromMod(card.src)}
                    onClick={(event) => {
                      // `detail === 0` is the keyboard path, which arms and
                      // disarms exactly like a tap.
                      if (event.detail !== 0) return;
                      setArmedMod((current) => (current === card.src ? null : card.src));
                    }}
                  />
                </div>
              ))}

              {nodes.map((node) => (
                <div
                  className={`fxg-card${pending !== null && !sourcesFor(node.slot).includes(pending) ? ' dim' : ''}${
                    moving?.key === `node${node.slot + 1}` ? ' moving' : ''
                  }`}
                  key={node.slot}
                  data-node={node.slot}
                  style={{
                    left: posOf(`node${node.slot + 1}`)[0],
                    top: posOf(`node${node.slot + 1}`)[1],
                    width: CARD_W,
                    height: CARD_H,
                  }}
                >
                  <div
                    className="fxg-card-title fxg-drag"
                    data-act="drag-node"
                    data-node={node.slot}
                    onPointerDown={dragCard(`node${node.slot + 1}`)}
                  >
                    {t('fxg.node')} {node.slot + 1}
                  </div>
                  {cardBody(node.slot)}
                  {/* Input ports: drop targets for a wire. */}
                  {([0, 1] as const).map((which) => (
                    <button
                      key={which}
                      type="button"
                      className={`fxg-port in${(which === 0 ? node.in1.src : node.in2.src) !== 0 ? ' wired' : ''}${
                        pending !== null && sourcesFor(node.slot).includes(pending) ? ' ready' : ''
                      }`}
                      style={{ left: -9, top: IN_PORT_Y[which] - 9 }}
                      data-input={`${node.slot}:${which}`}
                      data-act={`port-in${which + 1}`}
                      data-node={node.slot}
                      aria-label={`${t('fxg.node')} ${node.slot + 1} ${t('fxg.input')} ${which + 1}`}
                      onPointerDown={(event) => {
                        // The second half of tap-to-connect: a source is armed
                        // and this is where it lands. A plain tap with nothing
                        // armed does nothing, so a stray touch cannot unwire.
                        if (pending === null) return;
                        event.preventDefault();
                        connect(node.slot, which, pending);
                      }}
                      // Keyboard: a button fired by Enter/Space reports
                      // `detail === 0`, which is the whole keyboard path for
                      // arming and connecting without a pointer.
                      onClick={(event) => {
                        if (event.detail !== 0) return;
                        if (pending === null) return;
                        connect(node.slot, which, pending);
                      }}
                    />
                  ))}
                  {/* Modulation targets (P7.2): the three gains an in-graph
                      edge may push, along the bottom edge of the card. */}
                  {([0, 1, 2] as const).map((which) => {
                    const target = graphModDst(node.slot, which);
                    const wired = liveMods.some((edge) => edge.dst === target);
                    const port =
                      which === 0 ? t('fxg.modPortIn1') : which === 1 ? t('fxg.modPortIn2') : t('fxg.modPortOut');
                    return (
                      <button
                        key={`mod${which}`}
                        type="button"
                        className={`fxg-port mod${wired ? ' wired' : ''}${
                          armedMod !== null ? ' ready' : ''
                        }`}
                        style={{ left: 22 + which * 30, top: CARD_H - 12 }}
                        data-mod={`${node.slot}:${which}`}
                        data-act={`port-mod${which}`}
                        data-node={node.slot}
                        aria-label={`${t('fxg.node')} ${node.slot + 1} ${port}`}
                        onPointerDown={(event) => {
                          if (armedMod === null) return;
                          event.preventDefault();
                          connectMod(armedMod, node.slot, which);
                        }}
                        onClick={(event) => {
                          if (event.detail !== 0 || armedMod === null) return;
                          connectMod(armedMod, node.slot, which);
                        }}
                      >
                        {which === 2 ? 'O' : `I${which + 1}`}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`fxg-port out${pending === graphNodeSrc(node.slot) ? ' pending' : ''}`}
                    style={{ right: -9, top: OUT_PORT_Y - 9 }}
                    data-act="port-out"
                    data-node={node.slot}
                    aria-label={`${t('fxg.node')} ${node.slot + 1} ${t('fxg.output')}`}
                    onPointerDown={startFrom(graphNodeSrc(node.slot))}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      armOrDisarm(graphNodeSrc(node.slot));
                    }}
                  />
                </div>
              ))}

              {/* OUT bus */}
              <div
                className={`fxg-card fxg-out${moving?.key === 'out' ? ' moving' : ''}`}
                style={{ left: posOf('out')[0], top: posOf('out')[1], width: DRY_W, height: CARD_H }}
              >
                <div
                  className="fxg-card-title fxg-drag"
                  data-act="drag-out"
                  onPointerDown={dragCard('out')}
                >
                  OUT
                </div>
                <div className="fxg-card-sub">{t('fxg.outHint')}</div>
              </div>

              {/* Output routing: which nodes reach the bus. */}
              <div
                className="fxg-out-list"
                style={{ left: posOf('out')[0], top: posOf('out')[1] + CARD_H + 8 }}
              >
                {nodes.map((node) => (
                  <div className="fxg-out-row" key={node.slot} data-node={node.slot}>
                    <label className="fxg-out-label">
                      <input
                        type="checkbox"
                        data-act="toOut"
                        data-node={node.slot}
                        checked={node.toOut}
                        onChange={() => {
                          ensureGraph();
                          store.setParam(graphToOutId(node.slot), node.toOut ? 0 : 1, { immediate: true });
                        }}
                      />
                      {t('fxg.node')} {node.slot + 1} → OUT
                    </label>
                    <input
                      type="range"
                      className="fxg-gain"
                      data-act="outGain"
                      data-node={node.slot}
                      min={0}
                      max={200}
                      value={Math.round(node.outGain * 100)}
                      aria-label={`${t('fxg.node')} ${node.slot + 1} ${t('fxg.outGain')}`}
                      onChange={(event) => {
                        ensureGraph();
                        store.setParam(graphOutGainId(node.slot), Number(event.target.value) / 100);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
