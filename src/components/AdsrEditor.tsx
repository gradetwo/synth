import { useRef } from 'react';
import { store } from '@/state/store';
import { useSynth } from '@/hooks/useSynth';
import { Param, clamp, fmt } from '@/audio/params';

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

export function AdsrEditor() {
  useSynth();
  const a = store.getParam(Param.ENV_ATTACK);
  const d = store.getParam(Param.ENV_DECAY);
  const s = store.getParam(Param.ENV_SUSTAIN);
  const r = store.getParam(Param.ENV_RELEASE);

  const ax = clamp(fromTime.a(a), 10, 82);
  const dx = clamp(fromTime.d(d), ax + 10, ax + 90);
  const sy = clamp(fromTime.s(s), 15, 86);
  const rpx = clamp(fromTime.r(r), 15, 95);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef<Handle | null>(null);

  const path = `M 8 95 L ${ax} 15 L ${dx} ${sy} L ${GATE} ${sy} L ${GATE + rpx} 95`;
  const pos: Record<Handle, [number, number]> = {
    A: [ax, 15],
    D: [dx, sy],
    S: [GATE - 18, sy],
    R: [GATE + rpx, 95],
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const handle = dragging.current;
    const svg = svgRef.current;
    if (!handle || !svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 300;
    const y = ((e.clientY - rect.top) / rect.height) * 110;
    if (handle === 'A') store.setParam(Param.ENV_ATTACK, toTime.a(clamp(x, 10, 82)));
    if (handle === 'D') store.setParam(Param.ENV_DECAY, toTime.d(clamp(x, ax + 10, ax + 90)));
    if (handle === 'S') store.setParam(Param.ENV_SUSTAIN, clamp(toTime.s(clamp(y, 15, 86)), 0, 1));
    if (handle === 'R') store.setParam(Param.ENV_RELEASE, toTime.r(clamp(x - GATE, 15, 95)));
  };

  return (
    <div className="adsr-wrap">
      <svg
        className="adsr-svg"
        ref={svgRef}
        viewBox="0 0 300 110"
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
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
        <path d={path} fill="none" stroke="var(--env)" strokeWidth="2.2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 5px var(--env))' }} />
        <path d={`${path} L 8 95 Z`} fill="var(--env)" opacity="0.09" />
        {(['A', 'D', 'S', 'R'] as Handle[]).map((h) => (
          <g
            key={h}
            transform={`translate(${pos[h][0]},${pos[h][1]})`}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = h;
              svgRef.current?.setPointerCapture(e.pointerId);
            }}
          >
            <circle r="6.5" fill="#101319" stroke="var(--env)" strokeWidth="1.6" />
            <circle r="2.4" fill="var(--env)" />
          </g>
        ))}
      </svg>
      <div className="adsr-grid">
        <div className="adsr-cell">
          <div className="k">ATTCK</div>
          <div className="v">{fmt.ms(a)}</div>
        </div>
        <div className="adsr-cell">
          <div className="k">DECAY</div>
          <div className="v">{fmt.ms(d)}</div>
        </div>
        <div className="adsr-cell">
          <div className="k">SUST</div>
          <div className="v">{fmt.pct(s)}</div>
        </div>
        <div className="adsr-cell">
          <div className="k">REL</div>
          <div className="v">{fmt.ms(r)}</div>
        </div>
      </div>
    </div>
  );
}
