import { useEffect, useMemo, useRef, useState } from 'react';
import { noteBus, noteName } from '@/audio/noteBus';
import { engine } from '@/audio/engine';
import { store } from '@/state/store';
import { Param } from '@/audio/params';
import { velocityFromY } from '@/audio/velocity';
import { useVelocityMode, useHaptics } from '@/hooks/useSynth';
import { t } from '@/i18n';
import { canVibrate, haptic, HAPTIC, useInputMode } from '@/hooks/useInputMode';

const BLACK = new Set([1, 3, 6, 8, 10]);
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14,
};

interface Key {
  midi: number;
  black: boolean;
  left: number;
  width: number;
}

/** Build the absolutely-positioned key layout for `octaves` octaves. */
function buildKeys(baseMidi: number, octaves: number): { keys: Key[]; whiteCount: number } {
  const keys: Key[] = [];
  const whites: number[] = [];
  const total = octaves * 12 + 1;
  for (let i = 0; i < total; i++) {
    const midi = baseMidi + i;
    if (!BLACK.has(midi % 12)) whites.push(midi);
  }
  const nW = whites.length;
  const wW = 100 / nW;
  whites.forEach((midi, i) => keys.push({ midi, black: false, left: i * wW, width: wW }));
  for (let i = 0; i < total; i++) {
    const midi = baseMidi + i;
    if (!BLACK.has(midi % 12)) continue;
    const after = whites.filter((w) => w < midi).length;
    keys.push({ midi, black: true, left: after * wW - wW * 0.31, width: wW * 0.62 });
  }
  return { keys, whiteCount: nW };
}

export function Keyboard() {
  const [octave, setOctave] = useState(0);
  const [pressed, setPressed] = useState<Set<number>>(new Set());
  const [octaves, setOctaves] = useState(2);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Every active pointer (finger/pen/mouse) owns one note, so three fingers can
  // hold a triad. `holdCount` keeps a note alive while any pointer holds it.
  const pointerNotes = useRef<Map<number, number>>(new Map());
  const holdCount = useRef<Map<number, number>>(new Map());
  const touch = useInputMode() === 'touch';
  const velocityMode = useVelocityMode();
  const hapticsOn = useHaptics();
  const vibrate = canVibrate();

  // One octave on phones, two on tablets/desktop.
  useEffect(() => {
    const update = () => setOctaves(window.innerWidth < 620 ? 1 : 2);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const baseMidi = 48 + octave * 12;
  const { keys } = useMemo(() => buildKeys(baseMidi, octaves), [baseMidi, octaves]);

  const refresh = () => setPressed(new Set(noteBus.heldNotes()));

  const startNote = (midi: number, velocity = 0.9) => {
    const count = holdCount.current.get(midi) ?? 0;
    holdCount.current.set(midi, count + 1);
    if (count > 0) return; // already sounding
    // iOS may suspend the AudioContext when the page is backgrounded; any key
    // press is a valid gesture to bring it back.
    void engine.resumeIfSuspended();
    // Haptic strength follows velocity, so touch dynamics are felt as well.
    haptic(Math.round(HAPTIC.light + velocity * HAPTIC.light));
    noteBus.noteOn(midi, velocity);
    refresh();
  };
  const endNote = (midi: number) => {
    const count = holdCount.current.get(midi) ?? 0;
    if (count === 0) return;
    if (count > 1) {
      holdCount.current.set(midi, count - 1);
      return;
    }
    holdCount.current.delete(midi);
    noteBus.noteOff(midi);
    refresh();
  };

  const startPointer = (pointerId: number, midi: number, keyEl: HTMLElement | null, clientY: number) => {
    pointerNotes.current.set(pointerId, midi);
    startNote(midi, velocityAt(clientY, keyEl));
  };
  const endPointer = (pointerId: number) => {
    const midi = pointerNotes.current.get(pointerId);
    if (midi === undefined) return;
    pointerNotes.current.delete(pointerId);
    endNote(midi);
  };
  const allPointersOff = () => {
    for (const midi of pointerNotes.current.values()) endNote(midi);
    pointerNotes.current.clear();
  };

  /** Velocity from where the key was struck: lower on the key = louder. */
  const velocityAt = (clientY: number, keyEl: HTMLElement | null): number => {
    if (!keyEl) return velocityFromY(0, 0, 0, velocityMode);
    const rect = keyEl.getBoundingClientRect();
    return velocityFromY(clientY, rect.top, rect.height, velocityMode);
  };

  // Computer keyboard (desktop convenience).
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const offset = KEY_MAP[e.key.toLowerCase()];
      if (offset === undefined) return;
      e.preventDefault();
      startNote(baseMidi + offset);
    };
    const up = (e: KeyboardEvent) => {
      const offset = KEY_MAP[e.key.toLowerCase()];
      if (offset === undefined) return;
      endNote(baseMidi + offset);
    };
    const blur = () => {
      allPointersOff();
      holdCount.current.clear();
      noteBus.allOff();
      refresh();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMidi]);

  const keyAt = (clientX: number, clientY: number): HTMLElement | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    return (el?.closest('[data-midi]') as HTMLElement | null) ?? null;
  };

  return (
    <div className="keyboard-wrap">
      <div className="keyboard-head">
        <button type="button" className="oct-btn" onClick={() => { haptic(); setOctave((o) => Math.max(-2, o - 1)); }} aria-label={t('kbd.octDown')}>
          −
        </button>
        <span className="oct-label">OCT {octave >= 0 ? `+${octave}` : octave}</span>
        <button type="button" className="oct-btn" onClick={() => { haptic(); setOctave((o) => Math.min(3, o + 1)); }} aria-label={t('kbd.octUp')}>
          ＋
        </button>
        {touch ? (
          <>
            <button
              type="button"
              className={`vel-btn${velocityMode === 'touch' ? ' on' : ''}`}
              onClick={() => { haptic(); store.toggleVelocityMode(); }}
              aria-pressed={velocityMode === 'touch'}
              title={t('kbd.velocityHint')}
            >
              {t('kbd.velocity')}
            </button>
            {vibrate ? (
              <button
                type="button"
                className={`vel-btn${hapticsOn ? ' on' : ''}`}
                onClick={() => { haptic(HAPTIC.medium); store.toggleHaptics(); }}
                aria-pressed={hapticsOn}
                title={t('kbd.hapticsHint')}
              >
                {t('kbd.haptics')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div
        className="keyboard"
        ref={containerRef}
        onPointerDown={(e) => {
          e.preventDefault();
          // Trigger the note first: on iOS `setPointerCapture` can throw, and a
          // throw here would silently swallow the key press.
          const target =
            ((e.target as HTMLElement | null)?.closest('[data-midi]') as HTMLElement | null) ??
            keyAt(e.clientX, e.clientY);
          const midi = target ? Number(target.dataset.midi) : null;
          if (midi !== null && !Number.isNaN(midi)) startPointer(e.pointerId, midi, target, e.clientY);
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            /* capture is an enhancement; the note already started */
          }
        }}
        onPointerMove={(e) => {
          // A mouse only plays while a button is held; touch/pen only report
          // moves while in contact anyway.
          if (e.pointerType === 'mouse' && e.buttons === 0) return;
          const target = keyAt(e.clientX, e.clientY);
          const midi = target ? Number(target.dataset.midi) : null;
          const previous = pointerNotes.current.get(e.pointerId);
          if (midi === previous) return;
          if (previous !== undefined) endPointer(e.pointerId);
          if (midi !== null && !Number.isNaN(midi)) startPointer(e.pointerId, midi, target, e.clientY);
        }}
        onPointerUp={(e) => endPointer(e.pointerId)}
        onPointerCancel={(e) => endPointer(e.pointerId)}
        onLostPointerCapture={(e) => endPointer(e.pointerId)}
      >
        {keys.map((k) => (
          <div
            key={k.midi}
            data-midi={k.midi}
            className={`${k.black ? 'bkey' : 'wkey'}${pressed.has(k.midi) ? ' down' : ''}`}
            style={{ left: `${k.left}%`, width: `${k.width}%` }}
            title={noteName(k.midi)}
          >
            {!k.black && k.midi % 12 === 0 ? <span className="kn">C{Math.floor(k.midi / 12) - 1}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- pitch / mod

export function Wheels() {
  const pitchRef = useRef<HTMLDivElement | null>(null);
  const modRef = useRef<HTMLDivElement | null>(null);
  const [mod, setMod] = useState(0);
  const pitch = useRef(0);
  const drag = useRef<'pitch' | 'mod' | null>(null);
  const lastY = useRef(0);

  const applyPitch = (bend: number) => {
    pitch.current = Math.max(-1, Math.min(1, bend));
    const notch = pitchRef.current?.querySelector('.wheel-notch') as HTMLElement | null;
    if (notch) notch.style.top = `calc(50% - 2px + ${pitch.current * 14}px)`;
    engine.pitchBend(pitch.current * store.getParam(Param.PITCH_BEND_RANGE));
  };

  const endPitch = () => {
    drag.current = null;
    const back = () => {
      if (Math.abs(pitch.current) < 0.02) {
        applyPitch(0);
        return;
      }
      applyPitch(pitch.current * 0.85);
      requestAnimationFrame(back);
    };
    requestAnimationFrame(back);
  };

  return (
    <div className="wheels">
      <div className="wheel-wrap">
        <div
          className="wheel"
          ref={pitchRef}
          role="slider"
          aria-label={t('kbd.pitch')}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={0}
          onPointerDown={(e) => {
            e.preventDefault();
            drag.current = 'pitch';
            lastY.current = e.clientY;
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* non-fatal */
            }
          }}
          onPointerMove={(e) => {
            if (drag.current !== 'pitch') return;
            applyPitch(pitch.current - (e.clientY - lastY.current) * 0.02);
            lastY.current = e.clientY;
          }}
          onPointerUp={endPitch}
          onPointerCancel={endPitch}
        >
          <div className="wheel-notch" />
        </div>
        <span>PITCH</span>
      </div>
      <div className="wheel-wrap">
        <div
          className="wheel"
          ref={modRef}
          role="slider"
          aria-label={t('kbd.mod')}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={mod}
          onPointerDown={(e) => {
            e.preventDefault();
            drag.current = 'mod';
            lastY.current = e.clientY;
            try {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            } catch {
              /* non-fatal */
            }
          }}
          onPointerMove={(e) => {
            if (drag.current !== 'mod') return;
            const next = Math.max(0, Math.min(1, mod - (e.clientY - lastY.current) * 0.01));
            lastY.current = e.clientY;
            setMod(next);
            const notch = modRef.current?.querySelector('.wheel-notch') as HTMLElement | null;
            if (notch) notch.style.top = `calc(50% - 2px - ${(next - 0.5) * 26}px)`;
            engine.modWheel(next);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <div className="wheel-notch" />
        </div>
        <span>MOD</span>
      </div>
    </div>
  );
}
