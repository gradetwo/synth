import { useEffect, useRef, useState } from 'react';
import { store } from '@/state/store';
import { useFlowHidden, useFlowPos, useSynth } from '@/hooks/useSynth';
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
import { toast } from './Toast';
import { Transport, exportSongMidi, exportSongMp3 } from './PlayerPanel';

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

const NODES: FlowNodeDef[] = [
  { id: 'osc1', module: 'osc1', type: 'source', title: 'OSC 1', color: 'var(--osc1)', enabledParams: [Param.OSC1_ON], readout: [Param.OSC1_WAVE, Param.OSC1_LEVEL] },
  { id: 'osc2', module: 'osc2', type: 'source', title: 'OSC 2', color: 'var(--osc2)', enabledParams: [Param.OSC2_ON], readout: [Param.OSC2_WAVE, Param.OSC2_LEVEL] },
  { id: 'filter', module: 'filter', type: 'filter', title: 'FILTER', color: 'var(--filter)', enabledParams: [], readout: [Param.FILTER_CUTOFF, Param.FILTER_RES] },
  { id: 'env', module: 'env', type: 'mod', title: 'AMP ENV', color: 'var(--env)', enabledParams: [], readout: [Param.ENV_ATTACK, Param.ENV_RELEASE] },
  { id: 'lfo', module: 'lfo', type: 'mod', title: 'LFO', color: 'var(--lfo)', enabledParams: [Param.LFO_ON], readout: [Param.LFO_RATE, Param.LFO_DEPTH] },
  { id: 'lfo2', module: 'lfo', type: 'mod', title: 'LFO 2', color: 'var(--lfo)', enabledParams: [Param.LFO2_ON], readout: [Param.LFO2_RATE, Param.LFO2_DEPTH] },
  { id: 'matrix', module: 'matrix', type: 'mod', title: 'MATRIX', color: 'var(--matrix)', enabledParams: [], readout: [] },
  { id: 'fx', module: 'fx', type: 'effect', title: 'FX', color: 'var(--fx)', enabledParams: [Param.FX_REVERB_ON, Param.FX_DELAY_ON], readout: [Param.FX_REVERB_MIX, Param.FX_DELAY_MIX] },
  { id: 'fx2', module: 'fx2', type: 'effect', title: 'FX 2', color: 'var(--fx)', enabledParams: [Param.FX_CHORUS_ON, Param.FX_FLANGER_ON, Param.FX_PHASER_ON, Param.FX_DRIVE_ON], readout: [Param.FX_CHORUS_MIX, Param.FX_DRIVE_MIX] },
  { id: 'out', type: 'output', title: 'OUT', color: 'var(--accent)', enabledParams: [], readout: [Param.MASTER_VOLUME] },
];

const NODE_W = 158;
const NODE_H = 92;

function defaultPositions(narrow: boolean): Record<string, [number, number]> {
  if (narrow) {
    const order = ['osc1', 'osc2', 'filter', 'env', 'lfo', 'lfo2', 'matrix', 'fx', 'fx2', 'out'];
    return Object.fromEntries(order.map((id, i) => [id, [14, 16 + i * (NODE_H + 18)]]));
  }
  return {
    osc1: [24, 36], osc2: [24, 168],
    filter: [232, 102],
    env: [444, 16], lfo: [444, 150], lfo2: [444, 284],
    matrix: [654, 150],
    fx: [864, 36], fx2: [864, 168],
    out: [1074, 102],
  };
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
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = enabled ? node.color : '#4a5060';
  ctx.fillStyle = enabled ? node.color : '#4a5060';
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
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < bins; i++) {
        const x = (i / bins) * w;
        const v = Math.min(1, live.spectrum[i] * 3);
        ctx.fillRect(x, h - 1 - v * (h - 4), w / bins - 1, v * (h - 4));
      }
      ctx.globalAlpha = 1;

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
        const amp = base * (active ? 1 - phase : 0.35 + 0.35 * Math.sin(live.t * 1.2 + tap));
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
  registerCanvas,
  onDragEnd,
  onSelect,
  onToggle,
  onRemove,
}: {
  node: FlowNodeDef;
  position: [number, number];
  enabled: boolean;
  registerCanvas: (id: string, el: HTMLCanvasElement | null) => void;
  onDragEnd: (pos: [number, number]) => void;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<[number, number] | null>(null);

  const pos = live ?? position;
  return (
    <div
      className={`flow-node ${node.type}${enabled ? '' : ' off'}`}
      style={{ left: pos[0], top: pos[1], width: NODE_W, height: NODE_H, ['--mc' as string]: node.color }}
      data-node={node.id}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        drag.current = { dx: event.clientX - pos[0], dy: event.clientY - pos[1], moved: false };
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          /* capture is optional */
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const next: [number, number] = [event.clientX - state.dx, event.clientY - state.dy];
        if (Math.abs(next[0] - pos[0]) + Math.abs(next[1] - pos[1]) > 2) state.moved = true;
        setLive(next);
      }}
      onPointerUp={() => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        if (state.moved && live) {
          haptic();
          onDragEnd(live);
        } else {
          onSelect();
        }
        setLive(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
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
export function SignalFlow({ onOpenPlayer }: { onOpenPlayer: () => void }) {
  useSynth(); // re-render readouts when parameters change
  const positions = useFlowPos();
  const hidden = useFlowHidden();
  const [selected, setSelected] = useState<FlowNodeDef | null>(null);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [rec, setRec] = useState<RecorderState>(recorder.getState());
  const [tracksVersion, setTracksVersion] = useState(0);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => midiPlayer.subscribe(setPlayer), []);
  useEffect(() => recorder.subscribe(setRec), []);
  useEffect(() => midiLibrary.subscribe(() => setTracksVersion((v) => v + 1)), []);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 760);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
      const hasWave = engine.getTimeDomain(wave);
      spectrum.set(analysis.spectrum);
      const level = Math.max(analysis.peakL, analysis.peakR);
      const live: LiveData = {
        t: (now - start) / 1000,
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
      stageRef.current?.classList.toggle('active', level > 0.006 || analysis.voices > 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const defaults = defaultPositions(narrow);
  const visible = NODES.filter((node) => !hidden.includes(node.id));
  const removed = NODES.filter((node) => hidden.includes(node.id));
  const current = midiLibrary.getCurrent();

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
        });
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
        <button type="button" className="flow-bar-btn" onClick={onOpenPlayer}>
          {t('player.title')}
        </button>
        <button
          type="button"
          className="flow-bar-btn"
          disabled={!current}
          onClick={() => current && exportSongMidi(current.song, trackTitle(current))}
        >
          MID
        </button>
        <button
          type="button"
          className="flow-bar-btn"
          disabled={!current}
          onClick={async () => {
            if (!current) return;
            try {
              await exportSongMp3(current.song, trackTitle(current));
              toast(t('player.mp3Saved', { name: trackTitle(current) }));
            } catch (err) {
              toast(t('player.mp3Failed', { msg: err instanceof Error ? err.message : String(err) }));
            }
          }}
        >
          MP3
        </button>
      </div>

      <div className="flow-canvas-wrap">
        <div
          className="flow-stage"
          ref={stageRef}
          style={{ height: narrow ? 16 + NODES.length * (NODE_H + 18) : 420 }}
        >
          <svg className="flow-wires" aria-hidden="true">
            {visible.map((node) => {
              const from = positions[node.id] ?? defaults[node.id] ?? [0, 0];
              const chain = ['osc1', 'osc2', 'filter', 'env', 'matrix', 'fx', 'fx2', 'out'];
              const idx = chain.indexOf(node.id);
              if (idx < 0) return null;
              const next = visible.find((n) => chain.indexOf(n.id) === idx + 1);
              if (!next) return null;
              const to = positions[next.id] ?? defaults[next.id] ?? [0, 0];
              const x1 = from[0] + NODE_W;
              const y1 = from[1] + NODE_H / 2;
              const x2 = to[0];
              const y2 = to[1] + NODE_H / 2;
              return (
                <path
                  key={node.id}
                  d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                  className="flow-wire"
                />
              );
            })}
          </svg>

          {visible.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              position={positions[node.id] ?? defaults[node.id] ?? [0, 0]}
              enabled={isEnabled(node)}
              registerCanvas={registerCanvas}
              onDragEnd={(pos) => store.setFlowPosition(node.id, pos)}
              onSelect={() => setSelected(node)}
              onToggle={() => toggleNode(node)}
              onRemove={() => store.toggleFlowHidden(node.id)}
            />
          ))}

          {removed.length > 0 ? (
            <div className="flow-palette">
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
              <button type="button" className="flow-chip" onClick={() => store.resetFlow()}>
                {t('flow.reset')}
              </button>
            </div>
          ) : (
            <div className="flow-palette">
              <button type="button" className="flow-chip" onClick={() => store.resetFlow()}>
                {t('flow.reset')}
              </button>
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <aside className="flow-params" role="dialog" aria-label={selected.title}>
          <header className="flow-params-head">
            <span style={{ color: selected.color }}>{selected.title}</span>
            <button type="button" className="d-close" onClick={() => setSelected(null)} aria-label={t('drawer.close')}>
              ✕
            </button>
          </header>
          <div className="flow-params-body">
            {selected.module ? (
              <ModuleFor id={selected.module} />
            ) : (
              <div className="flow-out-panel">
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
      ) : null}
    </section>
  );
}
