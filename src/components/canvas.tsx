import { useEffect, useRef } from 'react';
import { engine } from '@/audio/engine';
import { analysis } from '@/audio/analysis';
import { subscribeFrame } from '@/audio/animationBus';
import { store } from '@/state/store';
import { useParam } from '@/hooks/useSynth';
import { intToFilter, intToWave, intToLfoWave, type ParamId, type Wave } from '@/audio/params';

const TAU = Math.PI * 2;

/**
 * Shared canvas loop. Sizing is handled by a per-canvas ResizeObserver, but all
 * drawing is multiplexed onto one `requestAnimationFrame` via `subscribeFrame`.
 * Components that read live values do so inside `draw`, so they never re-render
 * React just to animate.
 */
function useRafCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);

  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const unsubscribe = subscribeFrame(() => {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      drawRef.current(ctx, canvas.width / dpr, canvas.height / dpr);
    });
    return () => {
      unsubscribe();
      ro.disconnect();
    };
  }, []);

  return ref;
}

// -------------------------------------------------------------- waveform shape

const noiseTable = Array.from({ length: 256 }, () => Math.random() * 2 - 1);

export function waveShape(type: Wave, p: number): number {
  const t = p - Math.floor(p);
  switch (type) {
    case 'sine':
      return Math.sin(t * TAU);
    case 'triangle':
      return t < 0.25 ? t * 4 : t < 0.75 ? 2 - t * 4 : t * 4 - 4;
    case 'saw':
      return t * 2 - 1;
    case 'square':
      return t < 0.5 ? 1 : -1;
    case 'pulse':
      return t < 0.3 ? 1 : -1;
    case 'noise':
      return noiseTable[(t * 256) | 0];
    default:
      return 0;
  }
}

function lfoShape(type: ReturnType<typeof intToLfoWave>, p: number): number {
  const t = p - Math.floor(p);
  switch (type) {
    case 'triangle':
      return t < 0.25 ? t * 4 : t < 0.75 ? 2 - t * 4 : t * 4 - 4;
    case 'square':
      return t < 0.5 ? 1 : -1;
    case 'saw':
      return t * 2 - 1;
    default:
      return Math.sin(t * TAU);
  }
}

// -------------------------------------------------------------------- scope

export function Scope() {
  const buf = useRef(new Float32Array(1024));
  const ref = useRafCanvas((ctx, w, h) => {
    ctx.fillStyle = 'rgba(11,13,18,.4)';
    ctx.fillRect(0, 0, w, h);
    const data = buf.current;
    if (!engine.getTimeDomain(data)) return;
    ctx.beginPath();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffb340';
    ctx.shadowColor = 'rgba(255,179,64,.7)';
    ctx.shadowBlur = 7;
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h / 2 - data[i] * h * 0.46;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
  return <canvas ref={ref} aria-label="时域波形示波器" />;
}

export function ScopeMeta() {
  const filterType = useParam(13 as ParamId);
  const cutoff = useParam(14 as ParamId);
  const osc2On = useParam(7 as ParamId);
  const filter = intToFilter(filterType).toUpperCase();
  const osc2 = osc2On > 0.5 ? 'OSC×2' : 'OSC×1';
  const text = `${filter} · ${cutoff >= 1000 ? `${(cutoff / 1000).toFixed(2)} kHz` : `${cutoff.toFixed(0)} Hz`} · ${osc2}`;
  return <span className="ph-meta">{text}</span>;
}

// ----------------------------------------------------------------- spectrum

export function Spectrum() {
  const ref = useRafCanvas((ctx, w, h) => {
    ctx.fillStyle = 'rgba(11,13,18,.5)';
    ctx.fillRect(0, 0, w, h);
    const bins = analysis.spectrum;
    const peaks = analysis.peaks;
    const bw = w / bins.length;
    for (let i = 0; i < bins.length; i++) {
      const v = bins[i];
      const bh = v * (h - 8);
      if (bh > 0.5) {
        const x = i * bw + 1.5;
        const wid = Math.max(1, bw - 3);
        const g = ctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, 'rgba(255,179,64,.18)');
        g.addColorStop(1, '#ffb340');
        ctx.fillStyle = g;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, h - bh, wid, bh, [2, 2, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, h - bh, wid, bh);
        }
      }
      if (peaks[i] > 0.01) {
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillRect(i * bw + 1.5, h - peaks[i] * (h - 8) - 1.5, Math.max(1, bw - 3), 1.5);
      }
    }
  });
  return <canvas ref={ref} aria-label="频谱分析" />;
}

// ---------------------------------------------------------------- mini waves

export function MiniWave({
  which,
  color,
  lfo = false,
}: {
  which: 1 | 2;
  color: string;
  lfo?: boolean;
}) {
  const ref = useRafCanvas((ctx, w, h) => {
    const on = store.getParam((lfo ? 23 : which === 1 ? 1 : 7) as ParamId) > 0.5;
    const wave = lfo
      ? intToLfoWave(store.getParam(24 as ParamId))
      : intToWave(store.getParam((which === 1 ? 2 : 8) as ParamId));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = on ? color : '#333a48';
    ctx.lineWidth = 1.6;
    if (on) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
    }
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1.5) {
      const v = lfo ? lfoShape(wave as never, (x / w) * 2.2) : waveShape(wave as Wave, (x / w) * 2.2);
      const y = h / 2 - v * h * 0.36;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
  return <canvas className="mini-canvas" ref={ref} aria-hidden="true" />;
}

export function FilterCurve() {
  const ref = useRafCanvas((ctx, w, h) => {
    const type = intToFilter(store.getParam(13 as ParamId));
    const cutoff = store.getParam(14 as ParamId);
    const res = store.getParam(15 as ParamId);
    ctx.clearRect(0, 0, w, h);
    const fc = (Math.log(cutoff / 40) / Math.log(18000 / 40)) * w;
    const peak = res * (h * 0.38);
    ctx.strokeStyle = '#6ee7a0';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#6ee7a0';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const d = x - fc;
      let y: number;
      if (type === 'lp') {
        y = h * 0.5 - (d > 0 ? Math.min(d * 1.1, h * 0.46) * Math.min(d * 0.12, 1) : 0) + (Math.abs(d) < 5 ? -peak : 0);
      } else if (type === 'hp') {
        y = h * 0.5 - (d < 0 ? Math.min(-d * 1.1, h * 0.46) * Math.min(-d * 0.12, 1) : 0) + (Math.abs(d) < 5 ? -peak * 0.6 : 0);
      } else if (type === 'bp') {
        y = h * 0.5 - Math.max(0, peak * (1 - Math.abs(d) / (w * 0.35))) - 2;
      } else {
        y = h * 0.5 - h * 0.3 + Math.max(0, h * 0.28 * (1 - Math.abs(d) / (w * 0.1)));
      }
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(110,231,160,.35)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(fc, 2);
    ctx.lineTo(fc, h - 2);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  return <canvas className="mini-canvas" ref={ref} style={{ height: 40, marginTop: 11 }} aria-hidden="true" />;
}

// -------------------------------------------------------------------- VU

export function VuMeter() {
  const ref = useRafCanvas((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const segs = 12;
    const gap = 3;
    const sh = (h - gap * (segs - 1)) / segs;
    const level = Math.min(1, Math.max(analysis.peakL, analysis.peakR));
    const lit = Math.round(level * segs);
    for (let i = 0; i < segs; i++) {
      const y = h - (i + 1) * sh - i * gap;
      const on = i < lit;
      ctx.fillStyle = on ? (i < 8 ? '#6ee7a0' : i < 10 ? '#ffd166' : '#ff6b6b') : '#1c2029';
      ctx.fillRect(0, y, w, sh);
    }
  });
  return (
    <div className="vu">
      <div className="vu-track" style={{ padding: 4 }}>
        <canvas ref={ref} style={{ width: '100%', height: '100%' }} aria-label="输出电平" />
      </div>
      <span className="vu-cap">VU</span>
    </div>
  );
}

export function LfoLed() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const start = performance.now();
    return subscribeFrame((now) => {
      const el = ref.current;
      if (!el) return;
      const on = store.getParam(23 as ParamId) > 0.5;
      const sync = store.getParam(28 as ParamId) > 0.5;
      const rate = sync ? store.getParam(37 as ParamId) / 60 : store.getParam(25 as ParamId);
      const phase = (((now - start) / 1000) * rate) % 1;
      el.classList.toggle('on', on && Math.sin(phase * TAU) > 0);
    });
  }, []);
  return <div className="lfo-led" ref={ref} />;
}

export function LfoRateLabel() {
  const sync = useParam(28 as ParamId) > 0.5;
  const rate = useParam(25 as ParamId);
  return <span className="lm-rate">{sync ? 'SYNC 1/4' : `${rate.toFixed(2)} Hz`}</span>;
}
