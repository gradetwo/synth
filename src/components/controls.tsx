import { useRef, useState } from 'react';
import { store } from '@/state/store';
import { useParam } from '@/hooks/useSynth';
import { t } from '@/i18n';
import { type ParamId, type ParamSpec, type Wave, clamp } from '@/audio/params';

// ---------------------------------------------------------------- knob

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
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { y: e.clientY, t };
    setDragging(true);
    setTip({ x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* dragging still works without capture */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    // Fingers are far less precise than a mouse: slow the travel right down.
    const scale = e.pointerType === 'touch' ? 420 : e.shiftKey ? 900 : 190;
    const next = clamp(drag.current.t + (drag.current.y - e.clientY) / scale, 0, 1);
    store.setParam(spec.id, real(next));
    setTip({ x: e.clientX, y: e.clientY });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
    setTip(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = clamp(t - e.deltaY * 0.0008, 0, 1);
    store.setParam(spec.id, real(next));
  };
  const reset = () => {
    store.setParam(spec.id, spec.def);
  };

  const rot = -135 + t * 270;
  return (
    <div className={`knob${big ? ' big' : ''}${dragging ? ' dragging' : ''}`}>
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
        <svg className="arc" viewBox="0 0 100 100" aria-hidden="true">
          <path className="arc-bg" d={arcPath(225, 495, 42)} />
          <path className="arc-val" d={arcPath(225, 225 + t * 270, 42)} />
        </svg>
        <div className="knob-rot" style={{ ['--rot' as string]: `${rot}deg` }} />
      </div>
      <div className="knob-label">{spec.label}</div>
      <div className="knob-value">{spec.format(value)}</div>
      {tip ? (
        <div className="knob-tip" style={{ left: tip.x, top: tip.y }}>
          {spec.label} {spec.format(value)}
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
      onClick={() => onToggle(!on)}
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
          onClick={() => onChange(o.value)}
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
  noise: 'M2 10 L4.5 4 L7 14 L10 3 L12.5 16 L15 6 L18 11',
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
          title={t(`wave.${w}`)}
          aria-pressed={i === value}
          onClick={() => onChange(i)}
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
