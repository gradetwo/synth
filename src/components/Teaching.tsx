/**
 * Practice panel (P12.1).
 *
 * The panel is the teaching batch's whole UI: pick a root and a scale or chord,
 * see the target notes light up on the performance keyboard, play them, and get
 * the quantified result from `teaching/score.ts`.
 *
 * It is a lazy chunk. The default export is the settings-drawer *row*, so the
 * eager shell knows only "there is a row here" through one `lazy()` — the same
 * arrangement the project manager uses — and neither the panel's code, its
 * stylesheet nor its copy (`src/i18n.teach.ts`, registered by the drop-in
 * import below) is in the first-screen bundle.
 *
 * Two decisions worth recording:
 *
 *   * **It is not a `.drawer`.** A drawer is full-height on the right and would
 *     cover the keyboard the player has to hit, and its mask would swallow the
 *     clicks entirely. This is a non-modal card in the top-left with no mask:
 *     everything stays playable while it is open.
 *   * **The highlight is applied to the DOM, not through React.** The keyboard
 *     is an eager component, so teaching it about targets would put a store, a
 *     hook and a class in the entry chunk — and the first-screen JS budget is
 *     the hard constraint of this batch (0.3 KB of headroom). The panel is the
 *     only thing that ever wants target keys, so it adds a class to the keys it
 *     finds and a `MutationObserver` puts it back when React re-renders a key
 *     (a key press rewrites `className`). All of it lives in this chunk.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { noteBus } from '@/audio/noteBus';
import { t } from '@/i18n';
import { haptic } from '@/hooks/useInputMode';
import {
  CHORDS,
  SCALES,
  buildExercise,
  pitchName,
  type ExerciseKind,
} from '@/teaching/theory';
import { scorePerformance, type PlayedNote, type PracticeResult } from '@/teaching/score';
// Registers the panel's copy as part of loading this chunk (P11.2 pattern).
import { loadTeachStrings } from '@/i18n.teach';
import './teaching.css';

void loadTeachStrings();

/** Count-in before the take starts, so the first note is not a scramble. */
const COUNT_IN_BEATS = 4;

/** Tempos offered; the scorer reads the target's `bpm` for the beat figures. */
const BPM_CHOICES = [60, 72, 80, 90, 100, 120];

/** Roots C3..C4, which is the range the two-octave keyboard shows by default. */
const ROOT_CHOICES = Array.from({ length: 13 }, (_, index) => 48 + index);

type Phase = 'idle' | 'countin' | 'recording' | 'done';

function TeachingPanel({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ExerciseKind>('scale');
  const [root, setRoot] = useState(48);
  const [setId, setSetId] = useState(SCALES[0].id);
  const [octaves, setOctaves] = useState(1);
  const [bpm, setBpm] = useState(90);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<PracticeResult | null>(null);

  // The take, in seconds from `startedAt`. `noteBus` publishes one event per
  // note-on/off whatever the source, so the screen keyboard, the computer
  // keyboard and MIDI input all record through the same subscription. A note is
  // appended when it *ends* (with its measured duration); the scorer sorts by
  // onset anyway, so the order they arrive in does not matter.
  const take = useRef<PlayedNote[]>([]);
  const held = useRef(new Map<number, number>());
  const startedAt = useRef(0);
  // The event callback runs outside React's render, so the phase it reads has
  // to be a ref rather than the state value captured when it subscribed.
  const phaseRef = useRef<Phase>('idle');

  const target = useMemo(
    () => buildExercise({ kind, root, id: setId, octaves, bpm }),
    [kind, root, setId, octaves, bpm],
  );

  const movePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTake = useCallback(() => {
    take.current = [];
    held.current.clear();
  }, []);

  /**
   * A new exercise invalidates the take in flight: grading the old notes against
   * the new target would be meaningless, and the highlight has already moved.
   * Called from the controls that change the exercise rather than from an effect
   * on `target`, so a selection is not a state update in a render's wake.
   */
  const invalidate = useCallback(() => {
    setResult(null);
    clearTake();
    movePhase('idle');
  }, [clearTake, movePhase]);

  useEffect(
    () =>
      noteBus.subscribeEvents((event) => {
        if (phaseRef.current !== 'recording') return;
        const at = (performance.now() - startedAt.current) / 1000;
        if (event.on) {
          held.current.set(event.note, at);
        } else {
          const start = held.current.get(event.note);
          if (start === undefined) return;
          held.current.delete(event.note);
          take.current.push({ note: event.note, start, duration: Math.max(0, at - start) });
        }
      }),
    [],
  );

  // Count-in, then start the clock. Timers are cleaned up on unmount and when
  // the exercise changes, so a closed panel cannot start a take.
  useEffect(() => {
    if (phase !== 'countin') return;
    const timer = window.setTimeout(() => {
      startedAt.current = performance.now();
      clearTake();
      movePhase('recording');
    }, (COUNT_IN_BEATS * 60000) / bpm);
    return () => window.clearTimeout(timer);
  }, [phase, bpm, clearTake, movePhase]);

  /**
   * Paint the target pitches onto the keyboard keys and keep them painted.
   *
   * React owns `className` on those keys and rewrites it on every key press, so
   * observing the board and re-applying is what makes the highlight survive
   * playing. Each pass writes only when something differs, which is what stops
   * the observer from feeding itself.
   */
  useEffect(() => {
    const clear = () => {
      for (const key of document.querySelectorAll<HTMLElement>('.keyboard [data-midi].teach-target')) {
        key.classList.remove('teach-target');
        delete key.dataset.teachRoot;
      }
    };
    const board = document.querySelector('.keyboard');
    if (!board) return clear;

    const wanted = new Set(target.pitches);
    const rootClass = target.root % 12;
    const apply = () => {
      for (const key of document.querySelectorAll<HTMLElement>('.keyboard [data-midi]')) {
        const midi = Number(key.dataset.midi);
        const on = wanted.has(midi);
        if (on !== key.classList.contains('teach-target')) key.classList.toggle('teach-target', on);
        const isRoot = on && midi % 12 === rootClass;
        if (isRoot && key.dataset.teachRoot !== '1') key.dataset.teachRoot = '1';
        else if (!isRoot && key.dataset.teachRoot) delete key.dataset.teachRoot;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(board, { childList: true, subtree: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      clear();
    };
  }, [target]);

  const pickKind = (next: ExerciseKind) => {
    if (next === kind) return;
    haptic();
    setKind(next);
    setSetId((next === 'chord' ? CHORDS : SCALES)[0].id);
    invalidate();
  };

  const start = () => {
    haptic();
    setResult(null);
    clearTake();
    movePhase('countin');
  };

  const stop = () => {
    if (phaseRef.current !== 'recording') return;
    haptic();
    // A key still down when the player stops still gets a duration up to now.
    const at = (performance.now() - startedAt.current) / 1000;
    for (const [note, start] of held.current) {
      take.current.push({ note, start, duration: Math.max(0, at - start) });
    }
    held.current.clear();
    movePhase('done');
    setResult(scorePerformance(target, take.current));
  };

  const reset = () => {
    haptic();
    invalidate();
  };

  const status =
    phase === 'countin'
      ? t('teach.countIn')
      : phase === 'recording'
        ? t('teach.recording')
        : phase === 'done'
          ? t('teach.done')
          : t('teach.ready');

  return (
    <aside
      className="teach-panel"
      aria-label={t('teach.title')}
      data-role="teach-panel"
      data-state={phase}
    >
      <div className="drawer-head">
        <span className="d-title">{t('teach.title')}</span>
        <button type="button" className="d-close" onClick={onClose} aria-label={t('teach.close')}>
          ✕
        </button>
      </div>
      <div className="d-body">
        <div className="teach-body">
          <p className="teach-hint">{t('teach.hint')}</p>

          <div className="teach-row">
            <span className="settings-label">{t('teach.kind')}</span>
            <div className="seg" role="group" aria-label={t('teach.kind')} data-role="teach-kind">
              {(['scale', 'chord'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={kind === option ? 'active' : ''}
                  aria-pressed={kind === option}
                  data-kind={option}
                  onClick={() => pickKind(option)}
                >
                  {t(option === 'scale' ? 'teach.kind.scale' : 'teach.kind.chord')}
                </button>
              ))}
            </div>
          </div>

          <div className="teach-row">
            <span className="settings-label">{t('teach.root')}</span>
            <select
              aria-label={t('teach.root')}
              data-role="teach-root"
              value={root}
              onChange={(event) => {
                setRoot(Number(event.target.value));
                invalidate();
              }}
            >
              {ROOT_CHOICES.map((note) => (
                <option key={note} value={note}>
                  {pitchName(note)}
                </option>
              ))}
            </select>
            <select
              aria-label={kind === 'chord' ? t('teach.kind.chord') : t('teach.kind.scale')}
              data-role="teach-set"
              value={setId}
              onChange={(event) => {
                setSetId(event.target.value);
                invalidate();
              }}
            >
              {(kind === 'chord' ? CHORDS : SCALES).map((set) => (
                <option key={set.id} value={set.id}>
                  {t(`teach.${kind}.${set.id}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="teach-row">
            <span className="settings-label">{t('teach.octaves')}</span>
            <select
              aria-label={t('teach.octaves')}
              data-role="teach-octaves"
              value={octaves}
              onChange={(event) => {
                setOctaves(Number(event.target.value));
                invalidate();
              }}
            >
              {[1, 2, 3].map((span) => (
                <option key={span} value={span}>
                  {span}
                </option>
              ))}
            </select>
            <span className="settings-label">{t('teach.bpm')}</span>
            <select
              aria-label={t('teach.bpm')}
              data-role="teach-bpm"
              value={bpm}
              onChange={(event) => {
                setBpm(Number(event.target.value));
                invalidate();
              }}
            >
              {BPM_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="teach-target" data-role="teach-target">
            {target.pitches.map((pitch) => pitchName(pitch)).join(' · ')}
            <em> · {t('teach.targetCount', { n: target.pitches.length })}</em>
          </div>

          <div className="teach-actions">
            <button
              type="button"
              className="roll-btn on"
              data-act="teach-start"
              disabled={phase === 'countin' || phase === 'recording'}
              onClick={start}
            >
              {t('teach.start')}
            </button>
            <button
              type="button"
              className="roll-btn"
              data-act="teach-stop"
              disabled={phase !== 'recording'}
              onClick={stop}
            >
              {t('teach.stop')}
            </button>
            <button
              type="button"
              className="roll-btn"
              data-act="teach-reset"
              disabled={phase === 'idle' && !result}
              onClick={reset}
            >
              {t('teach.reset')}
            </button>
          </div>

          <div className="teach-status" data-role="teach-status" data-state={phase}>
            {status}
          </div>

          {result ? (
            <div
              className="teach-result"
              data-role="teach-result"
              data-score={result.score}
              data-hit-rate={result.hitRate}
              data-missed={result.missed}
              data-extra={result.extra}
              data-mean-error={result.intonation.meanError}
              data-mean-ms={result.timing.meanAbsMs}
            >
              <div className="teach-total">
                <b data-role="teach-score">{result.score}</b>
                <span>{t('teach.score')}</span>
              </div>
              <dl className="teach-metrics">
                <dt>{t('teach.hitRate')}</dt>
                <dd data-role="teach-hit-rate">
                  {Math.round(result.hitRate * 100)}% ·{' '}
                  {t('teach.hits', { hit: result.matched, expected: result.expected })}
                </dd>
                <dt>{t('teach.missed')}</dt>
                <dd data-role="teach-missed">{result.missed}</dd>
                <dt>{t('teach.extra')}</dt>
                <dd data-role="teach-extra">{result.extra}</dd>
                <dt>{t('teach.intonation')}</dt>
                <dd>
                  {t('teach.meanError', { n: result.intonation.meanError })} ·{' '}
                  {t('teach.maxError', { n: result.intonation.maxError })}
                </dd>
                <dt>{t('teach.timing')}</dt>
                <dd>
                  {t('teach.meanTiming', {
                    n: result.timing.meanAbsMs,
                    beats: result.timing.meanAbsBeats,
                  })}{' '}
                  · {t('teach.maxTiming', { n: result.timing.maxAbsMs })} ·{' '}
                  {t('teach.earlyLate', { early: result.timing.early, late: result.timing.late })}
                </dd>
              </dl>
              <div className="teach-pitches" data-role="teach-pitches">
                {result.pitches.map((tally) => (
                  <span
                    key={tally.pitch}
                    className={tally.matched === tally.expected ? 'ok' : 'miss'}
                  >
                    {pitchName(tally.pitch)} {tally.matched}/{tally.expected}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="teach-status" data-role="teach-empty">
              {t('teach.noResult')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * The settings-drawer row that opens the panel.
 *
 * This default export is the chunk's whole entry point: `SettingsDrawer` knows
 * only "there is a row here", so the row's copy and the panel's code stay out of
 * the first screen. `onOpen` closes the settings drawer first, the way the
 * project row does.
 */
export default function TeachingRow({ onOpen }: { onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="settings-row" data-setting="teaching">
        <span className="settings-label">{t('teach.title')}</span>
        <button
          type="button"
          className="roll-btn"
          data-act="teach-open"
          onClick={() => {
            haptic();
            onOpen();
            setOpen(true);
          }}
        >
          {t('teach.open')}
        </button>
      </div>
      {open ? createPortal(<TeachingPanel onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
