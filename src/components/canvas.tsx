import { useEffect, useRef } from 'react';
import { engine } from '@/audio/engine';
import { analysis } from '@/audio/analysis';
import { subscribeFrame } from '@/audio/animationBus';
import { store } from '@/state/store';
import { useParam } from '@/hooks/useSynth';
import { intToFilter, intToWave, intToLfoWave, type ParamId, type Wave } from '@/audio/params';
import { meterCaption, meterIsHot, scopeGain, spectrumDisplay, vuDisplay } from '@/audio/meter';
import { t } from '@/i18n';
import { canvasInk } from '@/state/theme';
import { getUserWave } from '@/audio/userWave';
import { getUserSample } from '@/audio/userSample';

const TAU = Math.PI * 2;

/**
 * Shared canvas loop. Sizing is handled by a per-canvas ResizeObserver, but all
 * drawing is multiplexed onto one `requestAnimationFrame` via `subscribeFrame`.
 * Components that read live values do so inside `draw`, so they never re-render
 * React just to animate.
 */
function useRafCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  /**
   * Whether this frame is worth drawing at all.
   *
   * Everything here used to repaint 60 times a second whether or not anything
   * had changed, which on a software-rendered page cost more than the audio
   * (measured: the app page ran at 7.5 fps with the canvases drawing and 58 fps
   * with them hidden). A canvas whose data only moves when the engine sends an
   * analysis frame, or when a parameter changes, says so here.
   */
  dirty?: () => boolean,
) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  const dirtyRef = useRef(dirty);
  const forced = useRef(true);

  useEffect(() => {
    drawRef.current = draw;
    dirtyRef.current = dirty;
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
      // A resize has to repaint, however quiet the data is.
      forced.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const unsubscribe = subscribeFrame(() => {
      if (!forced.current && dirtyRef.current && !dirtyRef.current()) return;
      forced.current = false;
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

/**
 * The imported cycle at `p`, or null when there is none to show. The preview has
 * to draw the same waveform the oscillator plays, otherwise it lies about the
 * one thing the player just imported.
 */
function userWaveShape(p: number): number | null {
  if (store.getParam(79 as ParamId) <= 0.5) return null;
  const cycle = getUserWave()?.cycle;
  if (!cycle || cycle.length === 0) return null;
  const t = ((p % 1) + 1) % 1;
  const position = t * cycle.length;
  const first = Math.floor(position) % cycle.length;
  const second = (first + 1) % cycle.length;
  const fraction = position - Math.floor(position);
  return cycle[first] * (1 - fraction) + cycle[second] * fraction;
}

/**
 * The imported sample at `p`, downsampled to a few hundred points: the preview
 * shows the actual audio rather than an icon.
 */
function sampleShape(p: number): number | null {
  const sample = getUserSample()?.samples;
  if (!sample || sample.length === 0) return null;
  const t = ((p % 1) + 1) % 1;
  return sample[Math.min(sample.length - 1, Math.floor(t * sample.length))];
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
  const gain = useRef(1);
  const seen = useRef(-1);
  const ref = useRafCanvas(
    (ctx, w, h) => {
    const ink = canvasInk();
    ctx.fillStyle = ink.spectrumBg;
    ctx.fillRect(0, 0, w, h);
    const data = buf.current;
    if (!engine.getTimeDomain(data)) return;

    // Auto-gain: fill the display instead of showing a flat line. Fast attack,
    // slow release so the trace stays readable and does not flicker.
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    gain.current = scopeGain(peak, gain.current);
    const g = gain.current;

    ctx.beginPath();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink.accent;
    ctx.shadowColor = ink.accentFade;
    ctx.shadowBlur = 7;
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const v = Math.max(-1.05, Math.min(1.05, data[i] * g));
      const y = h / 2 - v * (h / 2 - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
      ctx.stroke();
      ctx.shadowBlur = 0;
    },
    () => {
      if (seen.current === analysis.frames) return false;
      seen.current = analysis.frames;
      return true;
    },
  );
  return <canvas ref={ref} aria-label={t('canvas.scopeAria')} />;
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
  const seen = useRef(-1);
  // One gradient for the whole panel instead of one per bar per frame: the
  // colour only depends on the panel height, and building 36 of them 60 times a
  // second was most of what this canvas cost.
  const gradient = useRef<{ key: string; value: CanvasGradient } | null>(null);
  const ref = useRafCanvas(
    (ctx, w, h) => {
    const ink = canvasInk();
    ctx.fillStyle = ink.spectrumBg;
    ctx.fillRect(0, 0, w, h);
    const bins = analysis.spectrum;
    const peaks = analysis.peaks;
    const bw = w / bins.length;
    const key = `${h}:${ink.accent}:${ink.accentFade}`;
    if (gradient.current?.key !== key) {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, ink.accentFade);
      g.addColorStop(1, ink.accent);
      gradient.current = { key, value: g };
    }
    // Lift the mid/low bins so a normal patch actually fills the panel.
    for (let i = 0; i < bins.length; i++) {
      const v = spectrumDisplay(bins[i]);
      const pv = spectrumDisplay(peaks[i]);
      const bh = v * (h - 6);
      if (bh > 0.5) {
        const x = i * bw + 1.5;
        const wid = Math.max(1, bw - 3);
        ctx.fillStyle = gradient.current.value;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, h - bh, wid, bh, [2, 2, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, h - bh, wid, bh);
        }
      }
      if (pv > 0.01) {
        ctx.fillStyle = ink.peak;
        ctx.fillRect(i * bw + 1.5, h - pv * (h - 6) - 1.5, Math.max(1, bw - 3), 1.5);
      }
    }
    },
    () => {
      if (seen.current === analysis.frames) return false;
      seen.current = analysis.frames;
      return true;
    },
  );
  return <canvas ref={ref} aria-label={t('canvas.spectrumAria')} />;
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
  const signature = useRef('');
  const ref = useRafCanvas(
    (ctx, w, h) => {
    const on = store.getParam((lfo ? 23 : which === 1 ? 1 : 7) as ParamId) > 0.5;
    const wave = lfo
      ? intToLfoWave(store.getParam(24 as ParamId))
      : intToWave(store.getParam((which === 1 ? 2 : 8) as ParamId));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = on ? color : canvasInk().off;
    ctx.lineWidth = 1.6;
    if (on) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
    }
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1.5) {
      const phase = (x / w) * 2.2;
      const imported = lfo
        ? null
        : wave === 'sample'
          ? sampleShape(phase)
          : userWaveShape(phase);
      const v =
        imported ?? (lfo ? lfoShape(wave as never, phase) : waveShape(wave as Wave, phase));
      const y = h / 2 - v * h * 0.36;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    },
    () => {
      // Nothing here moves on its own: the shape is a function of parameters.
      const next = [
        store.getParam((lfo ? 23 : which === 1 ? 1 : 7) as ParamId) > 0.5 ? 1 : 0,
        store.getParam((lfo ? 24 : which === 1 ? 2 : 8) as ParamId),
        store.getParam(79 as ParamId) > 0.5 ? 1 : 0,
        which,
        lfo ? 1 : 0,
      ].join(':');
      if (signature.current === next) return false;
      signature.current = next;
      return true;
    },
  );
  return <canvas className="mini-canvas" ref={ref} aria-hidden="true" />;
}

export function FilterCurve() {
  const signature = useRef('');
  const ref = useRafCanvas(
    (ctx, w, h) => {
    const type = intToFilter(store.getParam(13 as ParamId));
    const cutoff = store.getParam(14 as ParamId);
    const res = store.getParam(15 as ParamId);
    const morph = store.getParam(145 as ParamId);
    const routing = store.getParam(146 as ParamId);
    const type2 = intToFilter(store.getParam(147 as ParamId));
    const cutoff2 = store.getParam(148 as ParamId);
    const res2 = store.getParam(149 as ParamId);
    ctx.clearRect(0, 0, w, h);
    const fc = (Math.log(cutoff / 40) / Math.log(18000 / 40)) * w;
    const peak = res * (h * 0.38);
    ctx.strokeStyle = '#6ee7a0';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#6ee7a0';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    /** The schematic response of one stage, in pixels (y grows downward). */
    const stageY = (
      kind: ReturnType<typeof intToFilter>,
      morphPos: number,
      d: number,
      peakAmt: number,
    ): number => {
      let y: number;
      if (kind === 'sem') {
        // The same four points the filter walks, drawn as gains so the shape
        // follows the knob: low-pass → band-pass → notch → high-pass. The
        // notch has to *dip* below the flat line, which is why this is built
        // from gains rather than by averaging the other three sketches.
        const span = w * 0.28;
        const gL = d > 0 ? Math.max(0, 1 - d / span) : 1;
        const gH = d < 0 ? Math.max(0, 1 + d / span) : 1;
        const gB = Math.max(0, 1 - Math.abs(d) / (w * 0.35));
        const gN = Math.max(0, Math.min(gL, gH) - Math.max(0, 1 - Math.abs(d) / 6));
        const m = morphPos <= 0 ? 0 : morphPos >= 1 ? 1 : morphPos;
        const wL = m <= 1 / 3 ? 1 - 3 * m : m <= 2 / 3 ? 3 * m - 1 : 1 - (3 * m - 2);
        const wB = m <= 1 / 3 ? 3 * m : m <= 2 / 3 ? 1 - (3 * m - 1) : 0;
        const wH = m <= 1 / 3 ? 0 : m <= 2 / 3 ? 3 * m - 1 : 1;
        const gain = wL * gL + wB * gB + wH * gH + Math.max(0, 1 - Math.abs(wL - wH)) * gN;
        y = h * 0.5 - gain * (h * 0.42) + (Math.abs(d) < 5 ? -peak * (1 - gN) : 0);
      } else if (kind === 'lp') {
        y = h * 0.5 - (d > 0 ? Math.min(d * 1.1, h * 0.46) * Math.min(d * 0.12, 1) : 0) + (Math.abs(d) < 5 ? -peakAmt : 0);
      } else if (kind === 'hp') {
        y = h * 0.5 - (d < 0 ? Math.min(-d * 1.1, h * 0.46) * Math.min(-d * 0.12, 1) : 0) + (Math.abs(d) < 5 ? -peakAmt * 0.6 : 0);
      } else if (kind === 'bp') {
        y = h * 0.5 - Math.max(0, peakAmt * (1 - Math.abs(d) / (w * 0.35))) - 2;
      } else {
        y = h * 0.5 - h * 0.3 + Math.max(0, h * 0.28 * (1 - Math.abs(d) / (w * 0.1)));
      }
      return y;
    };

    const peak2 = res2 * (h * 0.38);
    const fc2 = (Math.log(cutoff2 / 40) / Math.log(18000 / 40)) * w;
    const blend = store.getParam(151 as ParamId);
    const second = routing > 0.5;
    const parallel = routing > 1.5;
    const mid = h * 0.5;
    for (let x = 0; x <= w; x += 2) {
      const first = stageY(type, morph, x - fc, peak);
      let y = first;
      if (second) {
        const other = stageY(type2, morph, x - fc2, peak2);
        // Series is a product of two responses, which on this pixel scale is
        // the sum of the two deviations from the flat line; parallel is the
        // blend of them, exactly like the DSP.
        y = parallel
          ? mid + (1 - blend) * (first - mid) + blend * (other - mid)
          : mid + (first - mid) + (other - mid);
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
    },
    () => {
      const next = [
        store.getParam(13 as ParamId),
        store.getParam(14 as ParamId),
        store.getParam(15 as ParamId),
        store.getParam(145 as ParamId),
        store.getParam(146 as ParamId),
        store.getParam(147 as ParamId),
        store.getParam(148 as ParamId),
        store.getParam(149 as ParamId),
        store.getParam(151 as ParamId),
      ].join(':');
      if (signature.current === next) return false;
      signature.current = next;
      return true;
    },
  );
  return <canvas className="mini-canvas" ref={ref} style={{ height: 40, marginTop: 11 }} aria-hidden="true" />;
}

// -------------------------------------------------------------------- VU

export function VuMeter() {
  const caption = useRef<HTMLSpanElement | null>(null);
  const seen = useRef(-1);
  const lastText = useRef('');
  const lastHot = useRef(false);
  const ref = useRafCanvas(
    (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const segs = 12;
    const gap = 3;
    const sh = (h - gap * (segs - 1)) / segs;
    // dBFS scale (-48..0 dB) so ordinary levels light most of the meter.
    const level = vuDisplay(Math.max(analysis.peakL, analysis.peakR));
    const lit = Math.round(level * segs);
    for (let i = 0; i < segs; i++) {
      const y = h - (i + 1) * sh - i * gap;
      const on = i < lit;
      ctx.fillStyle = on
        ? i < 8
          ? '#6ee7a0'
          : i < 10
            ? '#ffd166'
            : '#ff6b6b'
        : canvasInk().off;
      ctx.fillRect(0, y, w, sh);
    }
    },
    () => {
      if (seen.current === analysis.frames) return false;
      seen.current = analysis.frames;
      return true;
    },
  );
  // Peak / loudness / limiter readout, updated without re-rendering React.
  useEffect(
    () =>
      subscribeFrame(() => {
        const el = caption.current;
        if (!el) return;
        // Peak · loudness · gain reduction · DSP load. Silence reads as a
        // stable dash rather than a parked -60 that twitches at the rounding
        // boundary (see audio/meter for the formatting rules).
        const text = meterCaption(analysis.truePeak, analysis.loudness, analysis.load, analysis.limit);
        if (text !== lastText.current) {
          lastText.current = text;
          el.textContent = text;
        }
        const hot = meterIsHot(analysis.truePeak, analysis.load);
        if (hot !== lastHot.current) {
          lastHot.current = hot;
          el.classList.toggle('hot', hot);
        }
      }),
    [],
  );

  return (
    <div className="vu">
      <div className="vu-track" style={{ padding: 4 }}>
        <canvas ref={ref} style={{ width: '100%', height: '100%' }} aria-label={t('canvas.vuAria')} />
      </div>
      <span className="vu-cap">VU</span>
      <span className="vu-meter" ref={caption} title={t('canvas.meterHint')} />
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
      const lit = on && Math.sin(phase * TAU) > 0;
      if (lit !== el.classList.contains('on')) el.classList.toggle('on', lit);
    });
  }, []);
  return <div className="lfo-led" ref={ref} />;
}

export function LfoRateLabel() {
  const sync = useParam(28 as ParamId) > 0.5;
  const rate = useParam(25 as ParamId);
  return <span className="lm-rate">{sync ? 'SYNC 1/4' : `${rate.toFixed(2)} Hz`}</span>;
}
