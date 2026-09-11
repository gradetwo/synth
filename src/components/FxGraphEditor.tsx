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
  FX_KIND_LABELS,
  FX_KINDS,
  FX_SLOTS,
  GRAPH_DRY,
  GRAPH_FROM_CHAIN_IDS,
  Param,
  fxKindCanBeParallel,
  fxKindToInt,
  graphFromChain,
  graphInGainId,
  graphInId,
  graphNodeSrc,
  graphOutGainId,
  graphToOutId,
  intToFxKind,
  type FxKind,
  type ParamId,
} from '@/audio/params';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { useViewport } from '@/hooks/useViewport';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { t } from '@/i18n';
import { toast } from './Toast';

/* Card geometry (px). The canvas scrolls when the screen is narrower. */
const CARD_W = 208;
const CARD_H = 132;
const CARD_GAP = 14;
const DRY_W = 176;
const COL_X = [12, 292, 572];
const PAD = 14;

/** Vertical offset of the two input ports inside a card. */
const IN_PORT_Y = [64, 92];
const OUT_PORT_Y = CARD_H / 2;

const NODES_H = FX_SLOTS * (CARD_H + CARD_GAP) - CARD_GAP;

/** Where a card sits when the user has never moved it. */
function defaultPos(key: string): [number, number] {
  if (key === 'dry') return [COL_X[0], 12];
  if (key === 'out') return [COL_X[2], 12 + Math.round((NODES_H - CARD_H) / 2)];
  const slot = Number(key.slice(4)) - 1;
  return [COL_X[1], 12 + (Number.isFinite(slot) ? slot : 0) * (CARD_H + CARD_GAP)];
}

const isDry = (key: string) => key === 'dry';
const cardWidth = (key: string) => (isDry(key) ? DRY_W : CARD_W);

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

/** Which mix parameter belongs to each effect kind. */
const MIX_PARAM: Partial<Record<FxKind, ParamId>> = {
  delay: Param.FX_DELAY_MIX,
  reverb: Param.FX_REVERB_MIX,
  chorus: Param.FX_CHORUS_MIX,
  flanger: Param.FX_FLANGER_MIX,
  phaser: Param.FX_PHASER_MIX,
  drive: Param.FX_DRIVE_MIX,
};

const ON_PARAM: Partial<Record<FxKind, ParamId>> = {
  delay: Param.FX_DELAY_ON,
  reverb: Param.FX_REVERB_ON,
  chorus: Param.FX_CHORUS_ON,
  flanger: Param.FX_FLANGER_ON,
  phaser: Param.FX_PHASER_ON,
  drive: Param.FX_DRIVE_ON,
};

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
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const graphOn = (params[Param.FX_GRAPH] ?? 0) >= 0.5;
  const savedPos = snapshot.layout.fxGraphPos;
  const posOf = useCallback(
    (key: string): [number, number] => savedPos[key] ?? defaultPos(key),
    [savedPos],
  );
  /** The board grows with the cards, so a dragged card is never out of reach. */
  const canvasSize = useMemo(() => {
    let w = 720;
    let h = 420;
    for (const key of ['dry', 'out', ...Array.from({ length: FX_SLOTS }, (_, i) => `node${i + 1}`)]) {
      const [x, y] = posOf(key);
      w = Math.max(w, x + cardWidth(key) + PAD);
      h = Math.max(h, y + CARD_H + PAD);
    }
    return { w, h };
  }, [posOf]);
  const nodes = useMemo(
    () =>
      Array.from({ length: FX_SLOTS }, (_, slot) => ({
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
      })),
    [params],
  );

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

  const releasePointer = (event: React.PointerEvent) => {
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
            {FX_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {FX_KIND_LABELS[kind]}
              </option>
            ))}
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
        return { key: `${node.slot}-${which}`, fromX, fromY, toX, toY, src: input.src, slot: node.slot, which };
      }),
  );

  const wirePath = (fromX: number, fromY: number, toX: number, toY: number) => {
    const bend = Math.max(28, Math.abs(toX - fromX) * 0.45);
    return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
  };

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
                    className="fxg-wire"
                    data-wire={`${wire.slot}:${wire.which}`}
                    d={wirePath(wire.fromX, wire.fromY, wire.toX, wire.toY)}
                    onClick={() => disconnect(wire.slot, wire.which as 0 | 1)}
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
                />
              </div>

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
                    />
                  ))}
                  <button
                    type="button"
                    className={`fxg-port out${pending === graphNodeSrc(node.slot) ? ' pending' : ''}`}
                    style={{ right: -9, top: OUT_PORT_Y - 9 }}
                    data-act="port-out"
                    data-node={node.slot}
                    aria-label={`${t('fxg.node')} ${node.slot + 1} ${t('fxg.output')}`}
                    onPointerDown={startFrom(graphNodeSrc(node.slot))}
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
