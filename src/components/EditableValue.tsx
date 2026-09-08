import { useEffect, useRef, useState } from 'react';
import { clamp } from '@/audio/params';
import { t } from '@/i18n';

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

/** Long-press threshold before the value enters drag-to-scroll mode. */
const HOLD_MS = 300;
/** Vertical travel that also starts a drag (quick flick). */
const DRAG_SLOP = 6;

/**
 * Value cell with three input modes:
 *   - tap            → focus and type a number (the old value is NOT selected)
 *   - long-press/drag → vertical drag changes the value, no keyboard
 *   - wheel / arrows  → nudge (Shift = fine)
 *
 * Once focused, normal caret placement / text selection is left to the browser.
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
  const press = useRef<{ startY: number; dragging: boolean; timer: number; startValue: number } | null>(
    null,
  );

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

  const beginDrag = () => {
    if (!press.current) return;
    press.current.dragging = true;
    inputRef.current?.blur();
    setEditing(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    // Already editing: let the browser handle caret placement and selection.
    if (document.activeElement === inputRef.current) return;
    // Keep the on-screen keyboard closed until we know it is a tap.
    event.preventDefault();
    const timer = window.setTimeout(beginDrag, HOLD_MS);
    press.current = { startY: event.clientY, dragging: false, timer, startValue: value };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* capture is an enhancement */
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLInputElement>) => {
    const state = press.current;
    if (!state) return;
    const dy = state.startY - event.clientY;
    if (!state.dragging) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      window.clearTimeout(state.timer);
      beginDrag();
    }
    const scale = event.shiftKey ? 4 : 1;
    let next: number;
    if (unit === 'pct') {
      next = clamp(state.startValue + (dy / scale) * 0.005, min, max);
    } else if (unit === 'ms') {
      // Exponential feel: ~50 px doubles the time.
      next = clamp(Math.max(state.startValue, min) * 2 ** (dy / (scale * 50)), min, max);
    } else {
      next = clamp(state.startValue + (dy / scale) * ((max - min) / 200), min, max);
    }
    onChange(next);
  };

  const endPress = (event: React.PointerEvent<HTMLInputElement>) => {
    const state = press.current;
    press.current = null;
    if (!state) return;
    window.clearTimeout(state.timer);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!state.dragging) {
      // Single tap: enter text-input mode with the caret at the end, without
      // selecting the existing value.
      const el = inputRef.current;
      if (el) {
        el.focus();
        setEditing(toEdit(value, unit));
        window.setTimeout(() => el.setSelectionRange(el.value.length, el.value.length), 0);
      }
    }
  };

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
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
      title={t('env.valueHint')}
      value={editing ?? display(value, unit, format)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={cancelPress}
      onChange={(event) => setEditing(event.target.value)}
      onFocus={() => setEditing(toEdit(value, unit))}
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
