import { useRef, useState } from 'react';
import { store } from '@/state/store';
import { useParam } from '@/hooks/useSynth';
import { useInputMode } from '@/hooks/useInputMode';
import { Param, SPEC_BY_ID, clamp, fmt, type ParamId } from '@/audio/params';
import { EditableValue } from './EditableValue';

const GATE = 190;

const toTime = {
  a: (x: number) => 0.001 * (2000 / 0.001) ** ((x - 10) / 70),
  d: (x: number) => 0.01 * (2000 / 0.01) ** (clamp(x - 22 - 10, 0, 80) / 80),
  s: (y: number) => 1 - (y - 15) / 70,
  r: (x: number) => 0.01 * (4000 / 0.01) ** ((x - 15) / 80),
};

const fromTime = {
  a: (v: number) => 10 + (70 * Math.log(clamp(v, 0.001, 2) / 0.001)) / Math.log(2000 / 0.001),
  d: (v: number) => 22 + 10 + (80 * Math.log(clamp(v, 0.01, 2) / 0.01)) / Math.log(2000 / 0.01),
  s: (v: number) => 15 + 70 * (1 - clamp(v, 0, 1)),
  r: (v: number) => 15 + (80 * Math.log(clamp(v, 0.01, 4) / 0.01)) / Math.log(4000 / 0.01),
};

type Handle = 'A' | 'D' | 'S' | 'R';

export type AdsrIds = [number, number, number, number];

const AMP_IDS: AdsrIds = [Param.ENV_ATTACK, Param.ENV_DECAY, Param.ENV_SUSTAIN, Param.ENV_RELEASE];

export function AdsrEditor({ title = 'AMP ENV', ids = AMP_IDS }: { title?: string; ids?: AdsrIds }) {
  const a = useParam(ids[0] as ParamId);
  const d = useParam(ids[1] as ParamId);
  const s = useParam(ids[2] as ParamId);
  const r = useParam(ids[3] as ParamId);

  const ax = clamp(fromTime.a(a), 10, 82);
  const dx = clamp(fromTime.d(d), ax + 10, ax + 90);
  const sy = clamp(fromTime.s(s), 15, 86);
  const rpx = clamp(fromTime.r(r), 15, 95);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ handle: Handle; originX: number; originY: number; base: [number, number] } | null>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const touch = useInputMode() === 'touch';
  const handleScale = touch ? 1.35 : 1;
  // A finger needs a much larger grab radius than a mouse cursor.
  const grabRadius = touch ? 48 : 26;

  const path = `M 8 95 L ${ax} 15 L ${dx} ${sy} L ${GATE} ${sy} L ${GATE + rpx} 95`;
  const pos: Record<Handle, [number, number]> = {
    A: [ax, 15],
    D: [dx, sy],
    S: [GATE - 18, sy],
    R: [GATE + rpx, 95],
  };

  /** Convert a pointer event to the SVG's 300×110 user space. */
  const svgPoint = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 300, ((e.clientY - rect.top) / rect.height) * 110];
  };

  const applyHandle = (handle: Handle, x: number, y: number) => {
    if (handle === 'A') store.setParam(ids[0] as ParamId, toTime.a(clamp(x, 10, 82)));
    if (handle === 'D') store.setParam(ids[1] as ParamId, toTime.d(clamp(x, ax + 10, ax + 90)));
    if (handle === 'S') store.setParam(ids[2] as ParamId, clamp(toTime.s(clamp(y, 15, 86)), 0, 1));
    if (handle === 'R') store.setParam(ids[3] as ParamId, toTime.r(clamp(x - GATE, 15, 95)));
  };

  /**
   * Grab the nearest handle within the grab radius. Hit-testing the tiny circles
   * directly is hopeless with a finger, so the whole plot acts as the target.
   * Dragging is delta-based: the handle keeps its offset from the touch point.
   */
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const [x, y] = svgPoint(e);
    let best: Handle | null = null;
    let bestDist = Infinity;
    for (const h of ['A', 'D', 'S', 'R'] as Handle[]) {
      const dist = Math.hypot(pos[h][0] - x, pos[h][1] - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = h;
      }
    }
    if (!best || bestDist > grabRadius) return;
    dragRef.current = { handle: best, originX: x, originY: y, base: pos[best] };
    setActive(best);
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an enhancement */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [x, y] = svgPoint(e);
    applyHandle(drag.handle, drag.base[0] + (x - drag.originX), drag.base[1] + (y - drag.originY));
  };

  const endDrag = () => {
    dragRef.current = null;
    setActive(null);
  };

  return (
    <div className="adsr-wrap">
      {title ? <div className="adsr-title">{title}</div> : null}
      <svg
        className="adsr-svg"
        ref={svgRef}
        viewBox="0 0 300 110"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <defs>
          <pattern id="gs1-adsr-grid" width="30" height="26" patternUnits="userSpaceOnUse">
            <path d="M30 0H0V26" fill="none" stroke="#1a1e28" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="300" height="110" fill="url(#gs1-adsr-grid)" />
        <line x1="0" y1="95" x2="300" y2="95" stroke="#252b38" strokeWidth="1" />
        <line x1={GATE} y1="6" x2={GATE} y2="105" stroke="#2c3242" strokeWidth="1" strokeDasharray="3 4" />
        <text x={GATE + 5} y="14" fill="#59607a" fontSize="7.5" fontFamily="IBM Plex Mono" letterSpacing="1">
          GATE
        </text>
        {/* Halo is a wider translucent stroke: Safari renders SVG
            `filter: drop-shadow()` inconsistently (WebKit #261442). */}
        <path d={path} fill="none" stroke="var(--env)" strokeWidth="7" strokeLinejoin="round" opacity="0.16" />
        <path d={path} fill="none" stroke="var(--env)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d={`${path} L 8 95 Z`} fill="var(--env)" opacity="0.09" />
        {(['A', 'D', 'S', 'R'] as Handle[]).map((h) => (
          <g
            key={h}
            transform={`translate(${pos[h][0]},${pos[h][1]})`}
            className={`adsr-handle${active === h ? ' active' : ''}`}
          >
            <circle r={6.5 * handleScale} fill="#101319" stroke="var(--env)" strokeWidth={1.6 * handleScale} />
            <circle r={2.4 * handleScale} fill="var(--env)" />
          </g>
        ))}
      </svg>
      <div className="adsr-grid">
        <div className="adsr-cell">
          <div className="k">ATTCK</div>
          <EditableValue
            value={a}
            min={SPEC_BY_ID[ids[0]]?.min ?? 0.0005}
            max={SPEC_BY_ID[ids[0]]?.max ?? 8}
            unit="ms"
            format={fmt.ms}
            ariaLabel="Attack time"
            onChange={(v) => store.setParam(ids[0] as ParamId, v)}
          />
        </div>
        <div className="adsr-cell">
          <div className="k">DECAY</div>
          <EditableValue
            value={d}
            min={SPEC_BY_ID[ids[1]]?.min ?? 0.001}
            max={SPEC_BY_ID[ids[1]]?.max ?? 12}
            unit="ms"
            format={fmt.ms}
            ariaLabel="Decay time"
            onChange={(v) => store.setParam(ids[1] as ParamId, v)}
          />
        </div>
        <div className="adsr-cell">
          <div className="k">SUST</div>
          <EditableValue
            value={s}
            min={0}
            max={1}
            unit="pct"
            format={fmt.pct}
            ariaLabel="Sustain level"
            onChange={(v) => store.setParam(ids[2] as ParamId, v)}
          />
        </div>
        <div className="adsr-cell">
          <div className="k">REL</div>
          <EditableValue
            value={r}
            min={SPEC_BY_ID[ids[3]]?.min ?? 0.005}
            max={SPEC_BY_ID[ids[3]]?.max ?? 16}
            unit="ms"
            format={fmt.ms}
            ariaLabel="Release time"
            onChange={(v) => store.setParam(ids[3] as ParamId, v)}
          />
        </div>
      </div>
    </div>
  );
}
