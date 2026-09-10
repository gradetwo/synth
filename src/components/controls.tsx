import { useRef, useState } from 'react';
import { store } from '@/state/store';
import { useParam } from '@/hooks/useSynth';
import { haptic } from '@/hooks/useInputMode';
import { t as tr } from '@/i18n';
import { type ParamId, type ParamSpec, type Wave, clamp } from '@/audio/params';

// ---------------------------------------------------------------- knob

/** Hold a finger still this long to enter touch fine-tune mode. */
const FINE_HOLD_MS = 600;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(a: number, b: number, r: number): string {
  if (b - a < 0.5) return '';
  const [x1, y1] = polar(50, 50, r, a);
  const [x2, y2] = polar(50, 50, r, b);
  const large = b - a > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface KnobProps {
  spec: ParamSpec;
  big?: boolean;
  title?: string;
}

export function Knob({ spec, big }: KnobProps) {
  const value = useParam(spec.id);
  const norm = (v: number): number => {
    const c = clamp(v, spec.min, spec.max);
    return spec.curve === 'log'
      ? Math.log(c / spec.min) / Math.log(spec.max / spec.min)
      : (c - spec.min) / (spec.max - spec.min);
  };
  const real = (t: number): number => {
    const tt = clamp(t, 0, 1);
    return spec.curve === 'log'
      ? spec.min * (spec.max / spec.min) ** tt
      : spec.min + tt * (spec.max - spec.min);
  };

  const t = norm(value);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const hold = useRef<number | null>(null);
  const [fine, setFine] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const clearHold = () => {
    if (hold.current !== null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { y: e.clientY, t };
    setDragging(true);
    setTip({ x: e.clientX, y: e.clientY });
    // Touch has no Shift key: holding the finger still for a moment drops into
    // a fine mode, mirroring Shift+drag on the desktop.
    if (e.pointerType === 'touch') {
      clearHold();
      hold.current = window.setTimeout(() => {
        hold.current = null;
        setFine(true);
        haptic(8);
      }, FINE_HOLD_MS);
    }
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* dragging still works without capture */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    // Fingers are far less precise than a mouse: slow the travel right down.
    // Shift (desktop) or long-press (touch) makes the travel even finer.
    const scale =
      e.pointerType === 'touch'
        ? fine
          ? 1500
          : 420
        : e.shiftKey
          ? 900
          : 190;
    const next = clamp(drag.current.t + (drag.current.y - e.clientY) / scale, 0, 1);
    store.setParam(spec.id, real(next));
    setTip({ x: e.clientX, y: e.clientY });
  };
  const endDrag = () => {
    clearHold();
    drag.current = null;
    setDragging(false);
    setFine(false);
    setTip(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = clamp(t - e.deltaY * 0.0008, 0, 1);
    store.setParam(spec.id, real(next));
  };
  const reset = () => {
    haptic(12);
    store.setParam(spec.id, spec.def);
  };

  const rot = -135 + t * 270;
  // Arc/needle live in one SVG so they can never drift apart from the dial.
  // The halo is a wider translucent stroke rather than `filter: drop-shadow()`,
  // which Safari renders inconsistently (WebKit #261442).
  const radius = big ? 43 : 42;
  const valPath = arcPath(225, 225 + t * 270, radius);
  return (
    <div className={`knob${big ? ' big' : ''}${dragging ? ' dragging' : ''}${fine ? ' fine' : ''}`}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={spec.format(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onDoubleClick={reset}
        onKeyDown={(e) => {
          const step = (spec.max - spec.min) / 100;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            store.setParam(spec.id, clamp(value + step, spec.min, spec.max));
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            store.setParam(spec.id, clamp(value - step, spec.min, spec.max));
          } else if (e.key === 'Home') {
            store.setParam(spec.id, spec.def);
          }
        }}
      >
        <svg
          className="knob-ring"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <path className="arc-bg" d={arcPath(225, 495, radius)} />
          {valPath ? <path className="arc-halo" d={valPath} /> : null}
          {valPath ? <path className="arc-val" d={valPath} /> : null}
          <g transform={`rotate(${rot} 50 50)`}>
            <line className="needle-halo" x1="50" y1="20" x2="50" y2="40" />
            <line className="needle-core" x1="50" y1="20" x2="50" y2="40" />
          </g>
        </svg>
      </div>
      <div className="knob-label">{spec.label}</div>
      <div className="knob-value">{spec.format(value)}</div>
      {tip ? (
        <div className="knob-tip" style={{ left: tip.x, top: tip.y }}>
          {spec.label} {spec.format(value)}
          {fine ? <b className="knob-tip-fine"> {tr('knob.fine')}</b> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- LED switch

interface LedProps {
  on: boolean;
  onToggle: (next: boolean) => void;
  label?: string;
  color?: string;
}

export function Led({ on, onToggle, label, color }: LedProps) {
  return (
    <button
      type="button"
      className={`led${on ? ' on' : ''}`}
      style={color ? ({ ['--mc' as string]: color } as React.CSSProperties) : undefined}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => {
        haptic();
        onToggle(!on);
      }}
    />
  );
}

/** LED bound directly to a parameter id. */
export function ParamLed({ id, label, color }: { id: number; label?: string; color?: string }) {
  const on = useParam(id as ParamId) > 0.5;
  return (
    <Led
      on={on}
      onToggle={(v) => store.setParam(id as never, v ? 1 : 0, { immediate: true })}
      label={label}
      color={color}
    />
  );
}

// ---------------------------------------------------------------- segmented

interface SegmentProps {
  value: number;
  options: { label: string; value: number; title?: string }[];
  onChange: (value: number) => void;
  colorful?: boolean;
  label?: string;
}

export function Segment({ value, options, onChange, colorful, label }: SegmentProps) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${o.value === value ? 'active' : ''}${colorful ? ' seg-on' : ''}`}
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => {
            haptic();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- waveform

const WAVE_ICONS: Record<Wave, string> = {
  sine: 'M2 10 C 5 2, 7 2, 10 10 S 15 18, 18 10',
  triangle: 'M2 10 L7 3 L13 17 L18 10',
  saw: 'M2 17 L10 3 L10 17 L18 3',
  square: 'M2 16 L2 4 L10 4 L10 16 L18 16 L18 4',
  pulse: 'M2 16 L2 4 L6 4 L6 16 L18 16 L18 4',
  // White noise is a jagged line; the coloured noises get progressively
  // smoother glyphs, which is what they sound like.
  noise: 'M2 10 L4.5 4 L7 14 L10 3 L12.5 16 L15 6 L18 11',
  pink: 'M2 8 L5 5 L7 12 L10 7 L13 14 L15 9 L18 11',
  brown: 'M2 12 C 5 4, 8 16, 11 8 S 16 12, 18 10',
  // A stepped, table-like shape.
  wavetable: 'M2 15 L5 5 L5 15 L9 5 L9 15 L13 5 L13 15 L18 5',
};

export function WaveSelect({
  value,
  waves,
  onChange,
}: {
  value: number;
  waves: Wave[];
  onChange: (index: number) => void;
}) {
  return (
    <div className="wave-select">
      {waves.map((w, i) => (
        <button
          key={w}
          type="button"
          className={`wave-btn${i === value ? ' active' : ''}`}
          title={tr(`wave.${w}`)}
          aria-pressed={i === value}
          onClick={() => {
            haptic();
            onChange(i);
          }}
        >
          <svg
            width="26"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={WAVE_ICONS[w]} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function WaveIcon({ wave, size = 16 }: { wave: Wave; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={WAVE_ICONS[wave]} />
    </svg>
  );
}

// ---------------------------------------------------------------- toggle cell

export function ToggleCell({ id, label }: { id: number; label: string }) {
  return (
    <div className="toggle-cell">
      <span className="lbl">{label}</span>
      <ParamLed id={id} label={label} />
    </div>
  );
}
