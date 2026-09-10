import { useEffect, useRef, useState } from 'react';
import { store } from '@/state/store';
import { useFlowHidden, useFlowPos, useKeyboardVisible, useSynth } from '@/hooks/useSynth';
import { useViewport } from '@/hooks/useViewport';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { t } from '@/i18n';
import type { ModuleId } from '@/state/layout';
import { Param, type ModRoute } from '@/audio/params';
import { engine } from '@/audio/engine';
import { analysis } from '@/audio/analysis';
import { midiPlayer, type PlayerState } from '@/midi/player';
import { recorder, type RecorderState } from '@/midi/recorder';
import { midiLibrary, trackTitle } from '@/midi/library';
import { ModuleFor } from '@/panels/modules';
import { PlainModules } from '@/components/Module';
import { toast } from './Toast';
import { Transport } from './PlayerPanel';

type NodeType = 'source' | 'filter' | 'mod' | 'effect' | 'output';

interface FlowNodeDef {
  id: string;
  module?: ModuleId;
  type: NodeType;
  title: string;
  color: string;
  /** Params that switch this unit on/off; empty = always on. */
  enabledParams: number[];
  /** Params shown as a compact readout. */
  readout: number[];
}

/**
 * Canvas cannot parse CSS custom properties (`var(--x)`), so node colours are
 * mirrored here as concrete hex values for the 2D context. Keep in sync with
 * the `--osc1 … --accent` variables in gs1.css.
 */
const C = {
  osc1: '#4da3ff',
  osc2: '#35d0c5',
  filter: '#6ee7a0',
  env: '#f472b6',
  lfo: '#fb923c',
  matrix: '#facc15',
  fx: '#a78bfa',
  accent: '#ffb340',
};

const NODES: FlowNodeDef[] = [
  { id: 'osc1', module: 'osc1', type: 'source', title: 'OSC 1', color: C.osc1, enabledParams: [Param.OSC1_ON], readout: [Param.OSC1_WAVE, Param.OSC1_LEVEL] },
  { id: 'osc2', module: 'osc2', type: 'source', title: 'OSC 2', color: C.osc2, enabledParams: [Param.OSC2_ON], readout: [Param.OSC2_WAVE, Param.OSC2_LEVEL] },
  { id: 'filter', module: 'filter', type: 'filter', title: 'FILTER', color: C.filter, enabledParams: [], readout: [Param.FILTER_CUTOFF, Param.FILTER_RES] },
  { id: 'env', module: 'env', type: 'mod', title: 'AMP ENV', color: C.env, enabledParams: [], readout: [Param.ENV_ATTACK, Param.ENV_RELEASE] },
  { id: 'lfo', module: 'lfo', type: 'mod', title: 'LFO', color: C.lfo, enabledParams: [Param.LFO_ON], readout: [Param.LFO_RATE, Param.LFO_DEPTH] },
  { id: 'lfo2', module: 'lfo', type: 'mod', title: 'LFO 2', color: C.lfo, enabledParams: [Param.LFO2_ON], readout: [Param.LFO2_RATE, Param.LFO2_DEPTH] },
  { id: 'matrix', module: 'matrix', type: 'mod', title: 'MATRIX', color: C.matrix, enabledParams: [], readout: [] },
  { id: 'fx', module: 'fx', type: 'effect', title: 'FX', color: C.fx, enabledParams: [Param.FX_REVERB_ON, Param.FX_DELAY_ON], readout: [Param.FX_REVERB_MIX, Param.FX_DELAY_MIX] },
  { id: 'fx2', module: 'fx2', type: 'effect', title: 'FX 2', color: C.fx, enabledParams: [Param.FX_CHORUS_ON, Param.FX_FLANGER_ON, Param.FX_PHASER_ON, Param.FX_DRIVE_ON], readout: [Param.FX_CHORUS_MIX, Param.FX_DRIVE_MIX] },
  { id: 'out', type: 'output', title: 'OUT', color: C.accent, enabledParams: [], readout: [Param.MASTER_VOLUME] },
];

const NODE_W = 158;
const NODE_H = 92;
const NODE_GAP_X = 26;
const NODE_GAP_Y = 18;
const NODE_PAD = 14;
/** Chain order used by every generated layout. */
const CHAIN_ORDER = ['osc1', 'osc2', 'filter', 'env', 'lfo', 'lfo2', 'matrix', 'fx', 'fx2', 'out'];

/**
 * `columns === 0` selects the hand-tuned wide desktop arrangement; 1–3 build a
 * row-major grid so phones get a compact two-column canvas.
 */
function defaultPositions(columns: number): Record<string, [number, number]> {
  if (columns === 0) {
    return {
      osc1: [24, 36], osc2: [24, 168],
      filter: [232, 102],
      env: [444, 16], lfo: [444, 150], lfo2: [444, 284],
      matrix: [654, 150],
      fx: [864, 36], fx2: [864, 168],
      out: [1074, 102],
    };
  }
  const colW = NODE_W + NODE_GAP_X;
  return Object.fromEntries(
    CHAIN_ORDER.map((id, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      return [id, [NODE_PAD + col * colW, NODE_PAD + row * (NODE_H + NODE_GAP_Y)]];
    }),
  );
}

// ------------------------------------------------------------------ drawing

const WAVE_LABEL = ['SIN', 'TRI', 'SAW', 'SQR', 'PLS', 'NSE'];

interface LiveData {
  /** Seconds since the view mounted. */
  t: number;
  /** Master time-domain samples (256), or null before audio starts. */
  wave: Float32Array | null;
  spectrum: Float32Array;
  /** 0..1 peak level of the master bus. */
  level: number;
  voices: number;
}

function waveSample(wave: number, phase: number, rnd: () => number): number {
  switch (wave) {
    case 0: return Math.sin(phase * Math.PI * 2);
    case 1: return 1 - 4 * Math.abs(Math.round(phase) - phase);
    case 2: return 2 * (phase - Math.floor(phase + 0.5));
    case 3: return phase % 1 < 0.5 ? 1 : -1;
    case 4: return phase % 1 < 0.3 ? 1 : -1;
    default: return rnd() * 2 - 1;
  }
}

function drawNode(canvas: HTMLCanvasElement, node: FlowNodeDef, enabled: boolean, live: LiveData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const get = (id: number) => store.getParam(id as never) as number;
  const active = enabled && (live.voices > 0 || live.level > 0.004);
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = enabled ? node.color : '#8a93a7';
  ctx.fillStyle = enabled ? node.color : '#8a93a7';
  ctx.shadowColor = enabled ? node.color : 'transparent';
  ctx.shadowBlur = enabled ? 7 : 0;
  ctx.globalAlpha = 1;
  ctx.beginPath();

  switch (node.type) {
    case 'source': {
      const wave = get(node.id === 'osc1' ? Param.OSC1_WAVE : Param.OSC2_WAVE);
      const level = get(node.id === 'osc1' ? Param.OSC1_LEVEL : Param.OSC2_LEVEL);
      // Animated phase: idles slowly, speeds up while notes sound.
      const speed = 0.35 + live.level * 2.4;
      const offset = live.t * speed;
      let rnd = 0;
      const amp = (0.35 + level * 0.65) * (active ? 1 : 0.55);
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const v = waveSample(wave, (x / w) * 2.5 + offset, () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280);
        const y = h / 2 - v * (h / 2 - 3) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (active) {
        ctx.globalAlpha = 0.18;
        ctx.lineTo(w, h / 2);
        ctx.lineTo(0, h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'filter': {
      const type = get(Param.FILTER_TYPE);
      const cutoff = get(Param.FILTER_CUTOFF);
      const res = get(Param.FILTER_RES);
      const norm = Math.log2(Math.max(40, cutoff) / 40) / Math.log2(18000 / 40);

      // Live spectrum behind the curve.
      const bins = live.spectrum.length;
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < bins; i++) {
        const x = (i / bins) * w;
        const v = Math.min(1, live.spectrum[i] * 3);
        ctx.fillRect(x, h - 1 - v * (h - 4), w / bins - 1, v * (h - 4));
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = enabled ? 7 : 0;

      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const t0 = x / w;
        let mag: number;
        if (type === 1) mag = 1 / (1 + Math.exp(-(t0 - norm) * 14));
        else if (type === 2) mag = Math.exp(-Math.abs(t0 - norm) * 9);
        else if (type === 3) mag = 1 - Math.exp(-Math.abs(t0 - norm) * 12) * 0.85;
        else mag = 1 / (1 + Math.exp((t0 - norm) * 14));
        const peak = Math.exp(-Math.abs(t0 - norm) * 40) * res * 0.7;
        const y = h - 2 - Math.min(1, mag + peak) * (h - 6);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Cutoff marker pulses with the output level.
      const fx = norm * w;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(fx, 0);
      ctx.lineTo(fx, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(fx, h / 2, 1.6 + live.level * 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mod': {
      if (node.id === 'env') {
        const a = get(Param.ENV_ATTACK);
        const d = get(Param.ENV_DECAY);
        const s = get(Param.ENV_SUSTAIN);
        const r = get(Param.ENV_RELEASE);
        const total = a + d + 0.35 + r;
        const xa = (a / total) * w;
        const xd = xa + (d / total) * w;
        const xs = xd + (0.35 / total) * w;
        const xr = xs + (r / total) * w;
        const levelAt = (x: number): number => {
          if (x <= xa) return xa > 0 ? x / xa : 1;
          if (x <= xd) return 1 - (1 - s) * ((x - xa) / Math.max(1, xd - xa));
          if (x <= xs) return s;
          return s * (1 - (x - xs) / Math.max(1, xr - xs));
        };
        // Looping playhead while notes are held.
        const head = active ? (live.t * 0.55) % 1 : 1;
        const hx = head * w;
        ctx.beginPath();
        ctx.moveTo(0, h - 2);
        for (let x = 0; x <= hx; x += 1) ctx.lineTo(x, h - 2 - levelAt(x) * (h - 4));
        ctx.stroke();
        ctx.globalAlpha = 0.16;
        ctx.lineTo(hx, h - 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        // Faint full curve.
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(0, h - 2);
        ctx.lineTo(xa, 2);
        ctx.lineTo(xd, h - 2 - s * (h - 4));
        ctx.lineTo(xs, h - 2 - s * (h - 4));
        ctx.lineTo(xr, h - 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (active) {
          ctx.beginPath();
          ctx.arc(hx, h - 2 - levelAt(hx) * (h - 4), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (node.id === 'lfo' || node.id === 'lfo2') {
        const wave = get(node.id === 'lfo' ? Param.LFO_WAVE : Param.LFO2_WAVE);
        const rate = get(node.id === 'lfo' ? Param.LFO_RATE : Param.LFO2_RATE);
        const cycles = Math.max(1, Math.min(4, Math.round(rate / 2)));
        const offset = live.t * Math.min(3, rate) * 0.5;
        ctx.beginPath();
        for (let x = 0; x <= w; x++) {
          const v = waveSample(wave, (x / w) * cycles + offset, () => 0);
          const y = h / 2 - v * (h / 2 - 3);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (enabled) {
          const hv = waveSample(wave, cycles + offset, () => 0);
          ctx.beginPath();
          ctx.arc(w - 2, h / 2 - hv * (h / 2 - 3), 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const routes = store.getSnapshot().state.routes;
        routes.slice(0, 4).forEach((route: ModRoute, i) => {
          const y = 6 + i * ((h - 8) / 4);
          ctx.globalAlpha = route.enabled ? 1 : 0.25;
          ctx.beginPath();
          ctx.arc(8, y, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(14, y);
          const len = route.amount * (w - 20);
          ctx.lineTo(14 + len, y);
          ctx.stroke();
          if (route.enabled && len > 4) {
            const pos = 14 + ((live.t * 0.9 + i * 0.23) % 1) * len;
            ctx.beginPath();
            ctx.arc(pos, y, 1.7, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'effect': {
      const wet = node.readout.reduce((sum, id) => sum + get(id), 0) / Math.max(1, node.readout.length);
      const taps = 5;
      for (let tap = 0; tap < taps; tap++) {
        const x = 6 + tap * ((w - 12) / taps);
        const base = Math.pow(Math.max(0, 0.9 - tap * 0.18), 1 + wet * 2);
        // Echoes re-fire while playing; idle keeps a gentle breathing decay.
        const cycle = active ? 1 : 3;
        const phase = ((live.t * (active ? 0.75 : 0.22) + tap * 0.14) % cycle) / cycle;
        const amp = base * (active ? 1 - phase : 0.5 + 0.32 * Math.sin(live.t * 1.2 + tap));
        ctx.globalAlpha = 0.2 + Math.max(0, amp) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, h / 2);
        ctx.lineTo(x, h / 2 - Math.max(0, amp) * (h / 2 - 3));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, h / 2);
        ctx.lineTo(x, h / 2 + Math.max(0, amp) * (h / 2 - 3));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'output': {
      // Real master waveform, then a level meter.
      if (live.wave) {
        const n = live.wave.length;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const v = live.wave[Math.floor((x / w) * n)] * 1.8;
          const y = h / 2 - Math.max(-1, Math.min(1, v)) * (h / 2 - 4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const vol = get(Param.MASTER_VOLUME);
      const meter = Math.min(1, live.level * 1.6);
      ctx.globalAlpha = 0.2;
      ctx.fillRect(2, h - 4, w - 4, 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = meter > 0.92 ? '#f87171' : node.color;
      ctx.fillRect(2, h - 4, (w - 4) * meter, 3);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(2, h - 8, (w - 4) * vol, 2);
      ctx.globalAlpha = 1;
      break;
    }
  }
}

function NodeView({
  node,
  position,
  enabled,
  zoom,
  registerCanvas,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onSelect,
  onToggle,
  onRemove,
}: {
  node: FlowNodeDef;
  position: [number, number];
  enabled: boolean;
  zoom: number;
  registerCanvas: (id: string, el: HTMLCanvasElement | null) => void;
  onDragMove: (pos: [number, number]) => void;
  onDragEnd: (pos: [number, number]) => void;
  onDragCancel: () => void;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ startX: number; startY: number; base: [number, number]; moved: boolean } | null>(null);

  return (
    <div
      className={`flow-node ${node.type}${enabled ? '' : ' off'}`}
      style={{ left: position[0], top: position[1], width: NODE_W, height: NODE_H, ['--mc' as string]: node.color }}
      data-node={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${node.title} — ${t('flow.expand')}`}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 12;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        if (delta[event.key]) {
          event.preventDefault();
          onDragEnd([position[0] + delta[event.key][0], position[1] + delta[event.key][1]]);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        drag.current = {
          startX: event.clientX,
          startY: event.clientY,
          base: position,
          moved: false,
        };
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          /* capture is optional */
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        // Screen delta → stage delta (the canvas may be zoomed).
        const next: [number, number] = [
          state.base[0] + (event.clientX - state.startX) / zoom,
          state.base[1] + (event.clientY - state.startY) / zoom,
        ];
        if (Math.abs(next[0] - position[0]) + Math.abs(next[1] - position[1]) > 2) state.moved = true;
        // Report every move so the wires follow the node in real time.
        onDragMove(next);
      }}
      onPointerUp={() => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        if (state.moved) {
          haptic();
          onDragEnd(position);
        } else {
          onSelect();
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        onDragCancel();
      }}
    >
      <div className="flow-node-head">
        <span className={`flow-dot${enabled ? ' on' : ''}`} />
        <span className="flow-node-title">{node.title}</span>
        {node.enabledParams.length > 0 ? (
          <button
            type="button"
            className={`flow-icon${enabled ? ' on' : ''}`}
            title={enabled ? t('flow.disable') : t('flow.enable')}
            aria-pressed={enabled}
            onClick={() => {
              haptic();
              onToggle();
            }}
          >
            ⏻
          </button>
        ) : null}
        <button
          type="button"
          className="flow-icon"
          title={t('flow.expand')}
          onClick={() => {
            haptic();
            onSelect();
          }}
        >
          ⤢
        </button>
        <button
          type="button"
          className="flow-icon"
          title={t('flow.remove')}
          onClick={() => {
            haptic();
            onRemove();
          }}
        >
          ✕
        </button>
      </div>
      <canvas
        ref={(el) => registerCanvas(node.id, el)}
        className="flow-canvas"
        width={NODE_W - 22}
        height={34}
      />
      <div className="flow-readout">
        {node.readout.length === 0
          ? t('flow.always')
          : node.readout
              .map((id) => `${shortParam(id)} ${formatParam(id, store.getParam(id as never) as number)}`)
              .join('  ')}
      </div>
      {!enabled ? <span className="flow-bypass">BYPASS</span> : null}
    </div>
  );
}

function shortParam(id: number): string {
  const names: Record<number, string> = {
    [Param.OSC1_WAVE]: 'WAVE', [Param.OSC1_LEVEL]: 'LVL',
    [Param.OSC2_WAVE]: 'WAVE', [Param.OSC2_LEVEL]: 'LVL',
    [Param.FILTER_CUTOFF]: 'CUT', [Param.FILTER_RES]: 'RES',
    [Param.ENV_ATTACK]: 'A', [Param.ENV_RELEASE]: 'R',
    [Param.LFO_RATE]: 'RATE', [Param.LFO_DEPTH]: 'DEP',
    [Param.LFO2_RATE]: 'RATE', [Param.LFO2_DEPTH]: 'DEP',
    [Param.FX_REVERB_MIX]: 'REV', [Param.FX_DELAY_MIX]: 'DLY',
    [Param.FX_CHORUS_MIX]: 'CHR', [Param.FX_DRIVE_MIX]: 'DRV',
    [Param.MASTER_VOLUME]: 'VOL',
  };
  return names[id] ?? '';
}

function formatParam(id: number, value: number): string {
  if (id === Param.OSC1_WAVE || id === Param.OSC2_WAVE) return WAVE_LABEL[Math.round(value)] ?? '—';
  if (id === Param.FILTER_CUTOFF) return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  if (id === Param.LFO_RATE || id === Param.LFO2_RATE) return `${value.toFixed(1)}Hz`;
  if (id === Param.ENV_ATTACK || id === Param.ENV_RELEASE) return value >= 1 ? `${value.toFixed(1)}s` : `${Math.round(value * 1000)}m`;
  return `${Math.round(value * 100)}%`;
}

/** Signal-flow canvas: draggable nodes, live mini-visuals and a performance bar. */
export function SignalFlow() {
  useSynth(); // re-render readouts when parameters change
  const positions = useFlowPos();
  const hidden = useFlowHidden();
  const [selected, setSelected] = useState<FlowNodeDef | null>(null);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [rec, setRec] = useState<RecorderState>(recorder.getState());
  const [tracksVersion, setTracksVersion] = useState(0);
  const viewport = useViewport();
  const keyboardVisible = useKeyboardVisible();
  // 0 = hand-tuned desktop layout. Every other class gets a grid tuned to its
  // screen shape: phones stack two columns in portrait and five across (two
  // rows) in landscape; tablets use three columns in portrait and five in
  // landscape so the graph fills the canvas instead of leaving dead space.
  const landscape = viewport.width > viewport.height;
  const flowCols =
    viewport.device === 'desktop'
      ? 0
      : viewport.device === 'tablet'
        ? landscape
          ? 5
          : 3
        : landscape && viewport.width >= 660
          ? 5
          : 2;
  const [zoom, setZoom] = useState(1);
  // Live drag position, lifted here so the wires follow the node while moving.
  const [drag, setDrag] = useState<{ id: string; pos: [number, number] } | null>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(true);
  const reduceMotionRef = useRef(false);
  const contentSizeRef = useRef({ w: 1260, h: 420 });
  const autoFitRef = useRef(true);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
      },
      { rootMargin: '140px' },
    );
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const zoomBy = (delta: number) => {
    autoFitRef.current = false;
    setZoom((z) => Math.min(2.5, Math.max(0.25, z + delta)));
  };

  // Ctrl/Cmd + wheel (trackpad pinch) zooms the canvas.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      autoFitRef.current = false;
      setZoom((z) => Math.min(2.5, Math.max(0.25, z * Math.exp(-event.deltaY * 0.0016))));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the selected node on screen (and away from the detail card).
  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(`.flow-node[data-node="${selected.id}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [selected]);

  useEffect(() => midiPlayer.subscribe(setPlayer), []);
  useEffect(() => recorder.subscribe(setRec), []);
  useEffect(() => midiLibrary.subscribe(() => setTracksVersion((v) => v + 1)), []);

  // Continuous animation loop: reads the live analyser and redraws every node.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const wave = new Float32Array(256);
    const spectrum = new Float32Array(36);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 30) return;
      last = now;
      // Pause the canvases while the stage is scrolled out of view.
      if (!visibleRef.current) return;
      const hasWave = engine.getTimeDomain(wave);
      spectrum.set(analysis.spectrum);
      const level = Math.max(analysis.peakL, analysis.peakR);
      const live: LiveData = {
        // Reduced motion: freeze the animation but keep reflecting parameters.
        t: reduceMotionRef.current ? 0 : (now - start) / 1000,
        wave: hasWave ? wave : null,
        spectrum,
        level,
        voices: analysis.voices,
      };
      const hiddenSet = new Set(store.getSnapshot().layout.flowHidden);
      for (const node of NODES) {
        if (hiddenSet.has(node.id)) continue;
        const canvas = canvasRefs.current.get(node.id);
        if (!canvas) continue;
        const on =
          node.enabledParams.length === 0 ||
          node.enabledParams.some((id) => store.getParam(id as never) > 0.5);
        drawNode(canvas, node, on, live);
      }
      const stage = stageRef.current;
      if (stage) {
        const isActive = level > 0.006 || analysis.voices > 0;
        if (stage.classList.contains('active') !== isActive) {
          stage.classList.toggle('active', isActive);
          stage.style.setProperty('--flow-speed', isActive ? '0.4s' : '1.2s');
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const defaults = defaultPositions(flowCols);
  const visible = NODES.filter((node) => !hidden.includes(node.id));
  const removed = NODES.filter((node) => hidden.includes(node.id));

  /** Node position including the in-flight drag, so wires track in real time. */
  const nodePos = (id: string): [number, number] =>
    drag?.id === id ? drag.pos : (positions[id] ?? defaults[id] ?? [0, 0]);

  // Signal-chain edges (osc → osc → filter → env → matrix → fx → fx2 → out).
  const CHAIN = ['osc1', 'osc2', 'filter', 'env', 'matrix', 'fx', 'fx2', 'out'];
  const edges = CHAIN.slice(0, -1).flatMap((id, i) => {
    const target = CHAIN[i + 1];
    if (hidden.includes(id) || hidden.includes(target)) return [];
    const from = nodePos(id);
    const to = nodePos(target);
    const source = NODES.find((n) => n.id === id);
    const dest = NODES.find((n) => n.id === target);
    return [
      {
        id,
        from,
        to,
        color: source?.color ?? C.accent,
        toColor: dest?.color ?? C.accent,
      },
    ];
  });

  const openNode = (node: FlowNodeDef) =>
    setSelected((prev) => (prev?.id === node.id ? null : node));

  // The stage grows with the nodes so a dragged node is never clipped.
  const allPos = NODES.map((node) => nodePos(node.id));
  const contentW = Math.max(flowCols === 0 ? 1260 : 0, ...allPos.map(([x]) => x + NODE_W + 28));
  const contentH = Math.max(flowCols === 0 ? 320 : 240, ...allPos.map(([, y]) => y + NODE_H + 44));
  // Committed bounds (ignoring the in-flight drag) drive the auto-fit so the
  // canvas does not zoom while a node is being moved.
  const committedW = Math.max(
    flowCols === 0 ? 1260 : 0,
    ...NODES.map((node) => (positions[node.id] ?? defaults[node.id] ?? [0, 0])[0] + NODE_W + 28),
  );
  const committedH = Math.max(
    flowCols === 0 ? 320 : 240,
    ...NODES.map((node) => (positions[node.id] ?? defaults[node.id] ?? [0, 0])[1] + NODE_H + 44),
  );
  useEffect(() => {
    contentSizeRef.current = { w: contentW, h: contentH };
  }, [contentW, contentH]);

  const hudHeight = () => hudRef.current?.getBoundingClientRect().height ?? 0;

  /** Size the canvas to the space left below the chrome. */
  const sizeWrap = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // Document-relative top keeps the math stable while the page scroll
    // position settles after a rotation, and the dock height keeps the canvas
    // clear of the keyboard whenever it is visible.
    const dockH =
      (document.querySelector('.dock-spacer') as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    wrap.style.height = `${Math.max(180, Math.round(window.innerHeight - top - dockH - 14))}px`;
    // Reserve the top-left corner for the zoom/reset HUD so the graph never
    // hides underneath it.
    wrap.style.paddingTop = `${Math.round(hudHeight() + 8)}px`;
  };

  /** Fit every committed node inside the visible canvas. */
  const applyFit = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    sizeWrap();
    const widthFit = (wrap.clientWidth - 28) / committedW;
    const heightFit = (wrap.clientHeight - 28 - hudHeight()) / committedH;
    // Prefer filling the width. When the graph is only a little taller than the
    // width-fit allows, shrink just enough to land on one screen; a genuinely
    // tall graph keeps up to ~60% scrolling so its nodes stay readable instead
    // of collapsing to unreadable dots.
    const slack = heightFit > widthFit * 0.75 ? 1.05 : 1.6;
    const z = Math.min(1.3, widthFit, heightFit * slack);
    setZoom(Math.max(0.32, z));
  };

  // Re-fit on rotation/resize; the wrap always resizes so showing the keyboard
  // never overlaps the graph, even after a manual zoom.
  useEffect(() => {
    sizeWrap();
    if (autoFitRef.current) applyFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, flowCols, committedW, committedH, keyboardVisible]);

  const isEnabled = (node: FlowNodeDef) =>
    node.enabledParams.length === 0 || node.enabledParams.some((id) => store.getParam(id as never) > 0.5);

  const toggleNode = (node: FlowNodeDef) => {
    const on = isEnabled(node);
    for (const id of node.enabledParams) store.setParam(id as never, on ? 0 : 1, { immediate: true });
  };

  const registerCanvas = (id: string, el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(id, el);
    else canvasRefs.current.delete(id);
  };

  const toggleRecord = () => {
    haptic(HAPTIC.medium);
    if (rec.recording) {
      const clip = recorder.stop();
      if (clip) {
        midiLibrary.put({
          id: 'clip',
          title: [t('player.recordingName'), t('player.recordingName')],
          composer: t('player.recordedBy'),
          song: clip,
          group: 'clip',
        })
      store.mark();
        toast(t('player.clipSaved', { n: clip.notes.length }));
      }
      return;
    }
    midiPlayer.stop();
    recorder.start();
  };

  return (
    <section className="flow-view">
      <div className="flow-bar">
        <span className="flow-badge">PERFORM</span>
        <select
          className="flow-select"
          value={midiLibrary.getCurrentId()}
          onChange={(event) => midiLibrary.setCurrent(event.target.value)}
          aria-label={t('player.track')}
          key={tracksVersion}
        >
          {midiLibrary.getTracks().map((track) => (
            <option key={track.id} value={track.id}>
              {trackTitle(track)}
            </option>
          ))}
        </select>
        <Transport player={player} rec={rec} onRecord={toggleRecord} compact />
        {removed.length > 0 ? (
          <div className="flow-palette" role="group" aria-label={t('flow.removed')}>
            <span className="flow-palette-label">{t('flow.removed')}</span>
            {removed.map((node) => (
              <button
                key={node.id}
                type="button"
                className="flow-chip"
                style={{ ['--mc' as string]: node.color }}
                onClick={() => store.toggleFlowHidden(node.id)}
              >
                + {node.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flow-canvas-shell">
        {/* Canvas controls live on the board itself so the performance bar can
            stay a single clean transport row on phones. */}
        <div className="flow-hud" ref={hudRef}>
          <div className="flow-zoom" role="group" aria-label={t('flow.zoom')}>
            <button
              type="button"
              className="flow-bar-btn"
              aria-label={t('flow.zoomOut')}
              title={t('flow.zoomOut')}
              onClick={() => zoomBy(-0.15)}
            >
              −
            </button>
            <span className="flow-zoom-val">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="flow-bar-btn"
              aria-label={t('flow.zoomIn')}
              title={t('flow.zoomIn')}
              onClick={() => zoomBy(0.15)}
            >
              +
            </button>
            <button
              type="button"
              className="flow-bar-btn"
              aria-label={t('flow.fit')}
              title={t('flow.fit')}
              onClick={() => {
                autoFitRef.current = true;
                applyFit();
              }}
            >
              ⤢
            </button>
          </div>
          <button
            type="button"
            className="flow-bar-btn flow-reset"
            aria-label={t('flow.reset')}
            title={t('flow.reset')}
            onClick={() => {
              haptic();
              store.resetFlow();
            }}
          >
            ⟲
          </button>
        </div>
      <div className="flow-canvas-wrap" ref={wrapRef}>
        <div
          className="flow-scale"
          style={{ width: contentW * zoom, height: contentH * zoom }}
        >
          <div
            className="flow-stage"
            ref={stageRef}
            style={{
              width: contentW,
              height: contentH,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              ['--flow-speed' as string]: '1.2s',
            }}
            onClick={(event) => {
              // Tapping empty canvas dismisses the detail card.
              if (!(event.target as HTMLElement).closest('.flow-node, .flow-palette')) setSelected(null);
            }}
          >
          <svg className="flow-wires" aria-hidden="true">
            <defs>
              {edges.map((edge) => {
                const x1 = edge.from[0] + NODE_W;
                const y1 = edge.from[1] + NODE_H / 2;
                const x2 = edge.to[0];
                const y2 = edge.to[1] + NODE_H / 2;
                return (
                  <linearGradient
                    key={edge.id}
                    id={`wire-${edge.id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                  >
                    <stop offset="0%" stopColor={edge.color} stopOpacity="0.9" />
                    <stop offset="55%" stopColor={edge.color} stopOpacity="0.55" />
                    <stop offset="100%" stopColor={edge.toColor} stopOpacity="0.35" />
                  </linearGradient>
                );
              })}
            </defs>
            {edges.map((edge) => {
              const x1 = edge.from[0] + NODE_W;
              const y1 = edge.from[1] + NODE_H / 2;
              const x2 = edge.to[0];
              const y2 = edge.to[1] + NODE_H / 2;
              const d = `M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`;
              return (
                <g key={edge.id} className="flow-edge" data-edge={edge.id}>
                  <path className="flow-wire base" d={d} stroke={`url(#wire-${edge.id})`} />
                  <path className="flow-wire halo" d={d} stroke={edge.color} />
                  <path className="flow-wire flow" d={d} stroke={edge.color} />
                </g>
              );
            })}
          </svg>

          {visible.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              position={nodePos(node.id)}
              enabled={isEnabled(node)}
              zoom={zoom}
              registerCanvas={registerCanvas}
              onDragMove={(pos) =>
                setDrag({ id: node.id, pos: [Math.max(0, pos[0]), Math.max(0, pos[1])] })
              }
              onDragEnd={(pos) => {
                store.setFlowPosition(node.id, pos);
                setDrag(null);
              }}
              onDragCancel={() => setDrag(null)}
              onSelect={() => openNode(node)}
              onToggle={() => toggleNode(node)}
              onRemove={() => store.toggleFlowHidden(node.id)}
            />
          ))}
          </div>
        </div>
      </div>
      </div>

      {selected ? (
        <>
          <div
            className="flow-params-mask"
            onClick={() => setSelected(null)}
            aria-hidden="true"
          />
          <aside className="flow-params" role="dialog" aria-label={selected.title}>
            <button
              type="button"
              className="flow-params-close"
              onClick={() => setSelected(null)}
              aria-label={t('drawer.close')}
            >
              ✕
            </button>
            <div className="flow-params-scroll">
            {selected.module ? (
              <PlainModules>
                <ModuleFor id={selected.module} />
              </PlainModules>
            ) : (
              <div className="flow-out-panel">
                <div className="fp-simple-head">
                  <span className="fp-dot" style={{ background: selected.color }} />
                  <span className="fp-title" style={{ color: selected.color }}>
                    {selected.title}
                  </span>
                </div>
                <label className="player-field">
                  <span>{t('flow.master')}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={store.getParam(Param.MASTER_VOLUME)}
                    onChange={(event) => store.setParam(Param.MASTER_VOLUME, Number(event.target.value))}
                  />
                  <em>{Math.round(store.getParam(Param.MASTER_VOLUME) * 100)}%</em>
                </label>
              </div>
            )}
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}
