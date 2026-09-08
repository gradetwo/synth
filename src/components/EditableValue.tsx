import { useEffect, useRef, useState } from 'react';
import { clamp } from '@/audio/params';

export type EditUnit = 'ms' | 'pct' | 'num';

interface EditableValueProps {
  value: number;
  min: number;
  max: number;
  unit: EditUnit;
  onChange: (value: number) => void;
  ariaLabel: string;
  format?: (value: number) => string;
}

const toEdit = (value: number, unit: EditUnit): string => {
  if (unit === 'ms') return String(Math.round(value * 1000));
  if (unit === 'pct') return String(Math.round(value * 100));
  return String(Number(value.toFixed(3)));
};

const fromEdit = (text: string, unit: EditUnit, min: number, max: number): number | null => {
  const parsed = Number.parseFloat(text.replace(/[^0-9.+-eE]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const value = unit === 'ms' ? parsed / 1000 : unit === 'pct' ? parsed / 100 : parsed;
  return clamp(value, min, max);
};

const display = (value: number, unit: EditUnit, format?: (v: number) => string): string => {
  if (format) return format(value);
  if (unit === 'ms') return value >= 1 ? `${value.toFixed(2)} s` : `${Math.round(value * 1000)} ms`;
  if (unit === 'pct') return `${Math.round(value * 100)} %`;
  return String(Number(value.toFixed(3)));
};

/**
 * A value cell that can be typed into, stepped with the mouse wheel, or nudged
 * with the arrow keys (Shift = fine). Used by the envelope editors so the
 * numbers are directly editable instead of display-only.
 */
export function EditableValue({
  value,
  min,
  max,
  unit,
  onChange,
  ariaLabel,
  format,
}: EditableValueProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const step = (direction: 1 | -1, fine: boolean) => {
    const delta =
      unit === 'ms'
        ? (fine ? 1 : 5) / 1000
        : unit === 'pct'
          ? (fine ? 0.005 : 0.01)
          : fine
            ? 0.001
            : 0.01;
    const next = clamp(value + direction * delta, min, max);
    onChange(next);
    if (editing !== null) setEditing(toEdit(next, unit));
  };

  // React attaches wheel listeners passively, so use a native non-passive one.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      step(event.deltaY < 0 ? 1 : -1, event.shiftKey);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, min, max, unit]);

  const commit = (text: string) => {
    const parsed = fromEdit(text, unit, min, max);
    if (parsed !== null) onChange(parsed);
    setEditing(null);
  };

  return (
    <input
      ref={inputRef}
      className="adsr-input"
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={editing ?? display(value, unit, format)}
      onChange={(event) => setEditing(event.target.value)}
      onFocus={() => {
        setEditing(toEdit(value, unit));
        window.setTimeout(() => inputRef.current?.select(), 0);
      }}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit((event.target as HTMLInputElement).value);
          (event.target as HTMLInputElement).blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(null);
          (event.target as HTMLInputElement).blur();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          step(1, event.shiftKey);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          step(-1, event.shiftKey);
        }
      }}
    />
  );
}
