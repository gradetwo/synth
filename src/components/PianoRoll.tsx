/**
 * Piano-roll editor.
 *
 * Opened from the top bar or the player panel, it edits the current library
 * track as a beat-based `RollDoc` and previews through the shared MIDI player.
 * Notes can be drawn, dragged, resized and deleted; the on-screen keyboard
 * strip, the computer keyboard and external MIDI gear all step-enter notes
 * while the input toggle is armed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { toast } from './Toast';
import { haptic, HAPTIC, useInputMode } from '@/hooks/useInputMode';
import { midiPlayer, type PlayerState } from '@/midi/player';
import { midi } from '@/audio/midi';
import { noteBus, noteName } from '@/audio/noteBus';
import { midiLibrary, trackTitle, type Track } from '@/midi/library';
import { useResolvedTheme } from '@/state/theme';
import { exportSongMidi } from '@/midi/export';
import {
  addNote,
  clamp,
  clearNotes,
  isBlackKey,
  MIN_LENGTH,
  pitchRange,
  quantizeDoc,
  removeNote,
  resolveOverlaps,
  rollToSong,
  secondsPerBeat,
  setBpm,
  setLengthBeats,
  SNAP_OPTIONS,
  snapBeat,
  songToRoll,
  transposeDoc,
  updateNote,
  type RollDoc,
  type RollNote,
} from '@/midi/roll';
import { Keyboard } from './Keyboard';
import { TransportIcon } from './TransportIcon';

/** Pixels per semitone; the grid scrolls vertically. */
const ROW_H = 20;
/** Horizontal zoom steps, in pixels per beat. */
const ZOOMS = [24, 36, 48, 64, 88, 120, 160];

const emptyDoc = (): RollDoc => ({ name: '', bpm: 120, beats: 4, notes: [] });

const snapLabel = (beats: number): string =>
  ({ 0.125: '1/32', 0.25: '1/16', 0.5: '1/8', 1: '1/4' })[beats] ?? `${beats}`;

/** Blue for low notes through orange for high ones. */
const noteColor = (note: number, low: number, high: number, light = false): string => {
  const ratio = high === low ? 0.5 : (note - low) / (high - low);
  return light
    ? `hsl(${Math.round(205 - ratio * 165)} 68% 44%)`
    : `hsl(${Math.round(205 - ratio * 165)} 82% 56%)`;
};

type Gesture =
  | { kind: 'tap'; x: number; y: number }
  | {
      kind: 'note' | 'resize';
      /** Which edge is being dragged, for resize gestures. */
      edge?: 'l' | 'r';
      id: string;
      orig: RollNote;
      x: number;
      y: number;
      moved: boolean;
    };

export function PianoRoll({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [doc, setDoc] = useState<RollDoc>(emptyDoc);
  const [track, setTrack] = useState<Track | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(0.25);
  const [zoom, setZoom] = useState(88);
  const [input, setInput] = useState(true);
  const [velocity, setVelocity] = useState(0.85);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [midiState, setMidiState] = useState(midi.snapshot());
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [pending, setPending] = useState<{ note: number; start: number } | null>(null);
  const [keysOpen, setKeysOpen] = useState(true);

  const docRef = useRef(doc);
  const snapRef = useRef(snap);
  const zoomRef = useRef(zoom);
  const velocityRef = useRef(velocity);
  const selectedRef = useRef<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPitch = useRef<number | null>(null);
  const past = useRef<RollDoc[]>([]);
  const future = useRef<RollDoc[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const auditionTimer = useRef(0);
  /** Notes started for an audition, so they can always be released again. */
  const auditionNotes = useRef<number[]>([]);
  /** The note we are currently auditioning, so step input ignores its echo. */
  const auditionRef = useRef<{ note: number; until: number } | null>(null);
  /** Notes currently held on an input source, waiting for note-off to size them. */
  const heldInput = useRef(new Map<number, { start: number; velocity: number; wall: number }>());

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => midiPlayer.subscribe(setPlayer), []);
  useEffect(() => midi.subscribe(() => setMidiState(midi.snapshot())), []);

  const [low, high] = useMemo(() => pitchRange(doc), [doc]);
  const gridH = (high - low + 1) * ROW_H;
  const gridW = Math.max(4, doc.beats) * zoom;
  const playBeats = player.time / secondsPerBeat(doc.bpm);
  const selectedNote = doc.notes.find((n) => n.id === selected) ?? null;

  const markHistory = useCallback(() => {
    setHistory({ undo: past.current.length > 0, redo: future.current.length > 0 });
  }, []);

  /** Replace the document and (optionally) record it for undo. */
  const commit = useCallback(
    (next: RollDoc, record = true) => {
      if (next === docRef.current) return;
      if (record) {
        past.current.push(docRef.current);
        if (past.current.length > 80) past.current.shift();
        future.current = [];
      }
      docRef.current = next;
      setDoc(next);
      markHistory();
    },
    [markHistory],
  );

  /** Live drag update: no history entry (pointerup commits one). */
  const commitLive = useCallback((next: RollDoc) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  const syncPlayer = useCallback((next: RollDoc, seekBeats?: number) => {
    const state = midiPlayer.getState();
    const wasPlaying = state.playing;
    const time = seekBeats === undefined ? state.time : seekBeats * secondsPerBeat(next.bpm);
    midiPlayer.load(rollToSong(next));
    const duration = midiPlayer.getState().duration;
    if (time > 0) midiPlayer.seek(Math.min(time, duration));
    if (wasPlaying) midiPlayer.play();
  }, []);

  /** Scroll a freshly written note into view (step input can land off-screen). */
  const revealNote = useCallback((pitch: number, beat: number) => {
    // Wait for the inspector row and the new note to be laid out first.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const [, hi] = pitchRange(docRef.current);
      const y = (hi - pitch) * ROW_H;
      if (y < el.scrollTop + 8 || y + ROW_H > el.scrollTop + el.clientHeight - 8) {
        el.scrollTop = Math.max(0, y - el.clientHeight / 2 + ROW_H / 2);
      }
      const x = beat * zoomRef.current;
      if (x < el.scrollLeft + 8 || x > el.scrollLeft + el.clientWidth - 48) {
        el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
      }
    });
  }, []);

  /** Release every note the editor is auditioning. Safe to call at any time. */
  const stopAudition = useCallback(() => {
    window.clearTimeout(auditionTimer.current);
    for (const held of auditionNotes.current) noteBus.noteOff(held);
    auditionNotes.current = [];
    auditionRef.current = null;
  }, []);

  /** Audition a drawn, selected or dragged note. Goes through the note bus so
   *  the monitor and VU react, but step input ignores the echo of that pitch. */
  const audition = useCallback(
    (note: number, vel: number) => {
      // Release the previous audition *before* starting the new one: cancelling
      // its note-off timer alone left every pitch dragged through sounding
      // forever.
      stopAudition();
      auditionNotes.current = [note];
      auditionRef.current = { note, until: performance.now() + 240 };
      noteBus.noteOn(note, vel);
      auditionTimer.current = window.setTimeout(stopAudition, 240);
    },
    [stopAudition],
  );

  // Never leave a note sounding when the editor closes or unmounts.
  useEffect(() => stopAudition, [stopAudition]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    docRef.current = prev;
    setDoc(prev);
    markHistory();
    haptic();
  }, [markHistory]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    docRef.current = next;
    setDoc(next);
    markHistory();
    haptic();
  }, [markHistory]);

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    commit(removeNote(docRef.current, id));
    setSelected(null);
    haptic();
  }, [commit]);

  /** Load the current library track as a fresh document (called on open). */
  const loadCurrent = useCallback(() => {
    const current = midiLibrary.getCurrent();
    setTrack(current);
    const next = current ? { ...songToRoll(current.song), name: trackTitle(current) } : emptyDoc();
    past.current = [];
    future.current = [];
    docRef.current = next;
    setDoc(next);
    setSelected(null);
    setInput(true);
    markHistory();
    midiPlayer.load(rollToSong(next));
  }, [markHistory]);

  const save = useCallback(() => {
    if (!track) return;
    const next = docRef.current;
    const builtin = track.id.startsWith('demo:');
    const name = builtin ? t('roll.copyOf', { name: next.name || t('roll.title') }) : next.name;
    const song = rollToSong({ ...next, name });
    midiLibrary.put({
      id: builtin ? `clip:${Date.now()}` : track.id,
      title: [name, name],
      composer: builtin ? t('player.recordedBy') : track.composer,
      song,
      group: 'clip',
    });
    setTrack(midiLibrary.getCurrent());
    toast(t('roll.saved', { name, n: song.notes.length }));
    haptic(HAPTIC.medium);
  }, [track]);

  useEffect(() => {
    if (!open) return;
    // Loading the document when the modal opens is the point of the effect;
    // the state it sets is the editor's working copy, not derived render data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCurrent();
  }, [open, loadCurrent]);

  // Debounced preview refresh: one reload after a drag settles, not one per
  // pointermove.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => syncPlayer(docRef.current), 140);
    return () => window.clearTimeout(id);
  }, [doc, open, syncPlayer]);

  // Centre the notes the first time the editor opens on a clip.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const notes = docRef.current.notes;
    const [lo, hi] = pitchRange(docRef.current);
    const target = notes.length ? notes.reduce((sum, n) => sum + n.note, 0) / notes.length : (lo + hi) / 2;
    el.scrollTop = Math.max(0, (hi - target) * ROW_H - el.clientHeight / 2 + ROW_H);
    el.scrollLeft = 0;
  }, [open]);

  // Keep the playhead in view while the preview runs.
  useEffect(() => {
    if (!player.playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = playBeats * zoom;
    if (x < el.scrollLeft + 48 || x > el.scrollLeft + el.clientWidth - 96) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [player.playing, player.time, playBeats, zoom]);

  // Capture-phase shortcuts so Ctrl/Cmd+Z undoes the clip, not the patch.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        event.stopPropagation();
        redo();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === ' ') {
        event.preventDefault();
        if (midiPlayer.getState().playing) midiPlayer.pause();
        else midiPlayer.play();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, undo, redo, deleteSelected]);

  // Step input: notes played on the keyboard strip, the computer keyboard or
  // external MIDI land at the playhead while the transport is stopped, and the
  // note's length follows how long the key was actually held.
  useEffect(() => {
    if (!open || !input) return;
    const held = heldInput.current;
    const off = noteBus.subscribeEvents((event) => {
      if (midiPlayer.getState().playing) return;
      // Ignore the audition echo from a note the editor just played.
      const auditioned = auditionRef.current;
      if (event.on && auditioned?.note === event.note && performance.now() < auditioned.until) return;
      const bpm = docRef.current.bpm;
      if (event.on) {
        const beats = midiPlayer.getState().time / secondsPerBeat(bpm);
        const start = snapBeat(beats, snapRef.current);
        held.set(event.note, { start, velocity: event.velocity, wall: performance.now() });
        setPending({ note: event.note, start });
        return;
      }
      const open_ = held.get(event.note);
      if (!open_) return;
      held.delete(event.note);
      setPending(null);
      const heldBeats = (performance.now() - open_.wall) / 1000 / secondsPerBeat(bpm);
      const length = Math.max(MIN_LENGTH, heldBeats);
      const added = addNote(docRef.current, event.note, open_.start, length, open_.velocity);
      const next = resolveOverlaps(added.doc, added.id);
      const id = added.id;
      commit(next);
      setSelected(id);
      revealNote(event.note, open_.start);
      // Step forward past the written note.
      syncPlayer(next, open_.start + length);
    });
    return () => {
      off();
      held.clear();
      setPending(null);
    };
  }, [open, input, commit, syncPlayer, revealNote]);

  const beatAt = (clientX: number): number => {
    const el = gridRef.current;
    if (!el) return 0;
    return Math.max(0, (clientX - el.getBoundingClientRect().left) / zoom);
  };
  const pitchAt = (clientY: number): number => {
    const el = gridRef.current;
    if (!el) return high;
    const row = Math.floor((clientY - el.getBoundingClientRect().top) / ROW_H);
    return clamp(high - row, 0, 127);
  };

  const onGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const noteEl = (event.target as HTMLElement).closest('.roll-note') as HTMLElement | null;
    if (noteEl?.dataset.note) {
      const orig = docRef.current.notes.find((n) => n.id === noteEl.dataset.note);
      if (!orig) return;
      const handle = (event.target as HTMLElement).dataset.handle;
      setSelected(orig.id);
      lastPitch.current = orig.note;
      gesture.current = {
        kind: handle ? 'resize' : 'note',
        edge: handle === 'l' ? 'l' : 'r',
        id: orig.id,
        orig,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    gesture.current = { kind: 'tap', x: event.clientX, y: event.clientY };
  };

  const onGridPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.kind === 'tap') return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    g.moved = true;
    if (g.kind === 'note') {
      // Values always derive from the pre-drag snapshot, so a long drag never
      // accumulates rounding error.
      const pitch = g.orig.note - Math.round(dy / ROW_H);
      if (pitch !== lastPitch.current) {
        lastPitch.current = pitch;
        audition(pitch, g.orig.velocity);
      }
      commitLive(
        resolveOverlaps(
          updateNote(docRef.current, g.id, {
            start: snapBeat(g.orig.start + dx / zoom, snap),
            note: pitch,
          }),
          g.id,
        ),
      );
    } else if (g.edge === 'l') {
      // Dragging the left edge moves the start and keeps the end put.
      const latest = Math.max(0, g.orig.start + g.orig.length - MIN_LENGTH);
      const start = Math.min(latest, snapBeat(g.orig.start + dx / zoom, snap));
      commitLive(
        resolveOverlaps(
          updateNote(docRef.current, g.id, {
            start,
            length: g.orig.length + (g.orig.start - start),
          }),
          g.id,
        ),
      );
    } else {
      const snapped = snapBeat(g.orig.length + dx / zoom, snap);
      commitLive(
        resolveOverlaps(
          updateNote(docRef.current, g.id, { length: Math.max(MIN_LENGTH, snapped) }),
          g.id,
        ),
      );
    }
  };

  const onGridPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'tap') {
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 8) return;
      if (!input) {
        setSelected(null);
        return;
      }
      const start = snapBeat(beatAt(event.clientX), snap);
      const note = pitchAt(event.clientY);
      const added = addNote(docRef.current, note, start, snap, velocityRef.current);
      const next = resolveOverlaps(added.doc, added.id);
      const id = added.id;
      commit(next);
      setSelected(id);
      revealNote(note, start);
      audition(note, velocityRef.current);
      return;
    }
    if (!g.moved) {
      // A plain click on a note selects it and plays its pitch, so you can hear
      // what you are about to edit.
      if (g.kind === 'note') {
        setSelected(g.id);
        audition(g.orig.note, g.orig.velocity);
      }
      return;
    }
    // The drag always derived from `g.orig`, so that is the pre-drag document.
    past.current.push({
      ...docRef.current,
      notes: docRef.current.notes.map((n) => (n.id === g.id ? g.orig : n)),
    });
    if (past.current.length > 80) past.current.shift();
    future.current = [];
    markHistory();
    syncPlayer(docRef.current);
  };

  const zoomBy = (dir: number) => {
    const index = ZOOMS.indexOf(zoom);
    setZoom(ZOOMS[clamp(index + dir, 0, ZOOMS.length - 1)]);
  };

  const bars = Math.max(1, Math.round(doc.beats / 4));
  const touch = useInputMode() === 'touch';
  const light = useResolvedTheme() === 'light';

  return (
    <>
      <div className={`roll-mask${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`roll${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('roll.title')}
        aria-hidden={!open}
      >
        <header className="roll-head">
          <span className="roll-title">{t('roll.title')}</span>
          <span className="roll-track">
            {track ? trackTitle(track) : ''}
            {track?.id.startsWith('demo:') ? (
              <em className="roll-hint"> · {t('roll.builtinHint')}</em>
            ) : null}
          </span>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </header>

        <div className="roll-tools">
          <div className="roll-group">
            <button
              type="button"
              className={`roll-btn play${player.playing ? ' on' : ''}`}
              onClick={() => {
                haptic();
                if (player.playing) midiPlayer.pause();
                else midiPlayer.play();
              }}
              aria-label={player.playing ? t('player.pause') : t('player.play')}
            >
              <TransportIcon name={player.playing ? 'pause' : 'play'} />
            </button>
            <button
              type="button"
              className="roll-btn"
              onClick={() => {
                haptic();
                midiPlayer.stop();
              }}
              aria-label={t('player.stop')}
            >
              <TransportIcon name="stop" />
            </button>
            <button
              type="button"
              className={`roll-btn${player.loop ? ' on' : ''}`}
              aria-pressed={player.loop}
              onClick={() => {
                haptic();
                midiPlayer.setLoop(!player.loop);
              }}
              aria-label={t('player.loop')}
            >
              <TransportIcon name="loop" />
            </button>
            <span className="roll-pos">
              {playBeats.toFixed(2)} / {Math.max(4, doc.beats)} {t('roll.beats')}
            </span>
          </div>

          <label className="roll-field">
            {t('roll.bpm')}
            <input
              type="number"
              min={40}
              max={240}
              value={doc.bpm}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) commit(setBpm(docRef.current, value));
              }}
            />
          </label>
          <label className="roll-field">
            {t('roll.snap')}
            <select value={snap} onChange={(event) => setSnap(Number(event.target.value))}>
              {SNAP_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {snapLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="roll-field">
            {t('roll.length')}
            <input
              type="number"
              min={1}
              max={256}
              value={bars}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1) {
                  commit(setLengthBeats(docRef.current, Math.max(1, value) * 4));
                }
              }}
            />
          </label>

          <div className="roll-group">
            <button
              type="button"
              className="roll-btn wide"
              onClick={() => {
                haptic();
                commit(quantizeDoc(docRef.current, snap));
                syncPlayer(docRef.current);
              }}
              title={t('roll.quantize')}
            >
              {t('roll.quantize')}
            </button>
            <button
              type="button"
              className="roll-btn"
              title={t('roll.octaveDown')}
              aria-label={t('roll.octaveDown')}
              onClick={() => {
                haptic();
                commit(transposeDoc(docRef.current, -12));
                syncPlayer(docRef.current);
              }}
            >
              −12
            </button>
            <button
              type="button"
              className="roll-btn"
              title={t('roll.octaveUp')}
              aria-label={t('roll.octaveUp')}
              onClick={() => {
                haptic();
                commit(transposeDoc(docRef.current, 12));
                syncPlayer(docRef.current);
              }}
            >
              +12
            </button>
          </div>

          <label className="roll-field vel" title={t('roll.holdHint')}>
            {t('roll.velocity')}
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={velocity}
              onChange={(event) => setVelocity(Number(event.target.value))}
            />
          </label>

          <button
            type="button"
            className={`roll-btn wide${input ? ' on' : ''}`}
            aria-pressed={input}
            title={input ? t('roll.inputOn') : t('roll.inputOff')}
            onClick={() => {
              haptic();
              setInput((v) => !v);
            }}
          >
            ● {t('roll.input')}
          </button>

          <button
            type="button"
            className={`roll-btn wide${keysOpen ? ' on' : ''}`}
            aria-pressed={keysOpen}
            title={keysOpen ? t('top.keyboardHide') : t('top.keyboardShow')}
            onClick={() => {
              haptic();
              setKeysOpen((v) => !v);
            }}
          >
            ⌨ {t('roll.keyboard')}
          </button>

          {!midiState.supported ? (
            <span className="roll-midi" title={t('roll.midiUnsupported')}>
              MIDI —
            </span>
          ) : midiState.enabled ? (
            <span className="roll-midi on">
              {t('roll.midiDevices', { n: midiState.devices.length })}
            </span>
          ) : (
            <button type="button" className="roll-btn wide" onClick={() => void midi.enable()}>
              {t('roll.midiConnect')}
            </button>
          )}

          <span className="roll-gap" />

          <div className="roll-group">
            <button
              type="button"
              className="roll-btn"
              disabled={!history.undo}
              onClick={undo}
              aria-label={t('roll.undo')}
              title={t('roll.undo')}
            >
              ↶
            </button>
            <button
              type="button"
              className="roll-btn"
              disabled={!history.redo}
              onClick={redo}
              aria-label={t('roll.redo')}
              title={t('roll.redo')}
            >
              ↷
            </button>
            <button
              type="button"
              className="roll-btn"
              disabled={!selectedNote}
              onClick={deleteSelected}
              aria-label={t('roll.delete')}
              title={t('roll.delete')}
            >
              ⌫
            </button>
            <button
              type="button"
              className="roll-btn wide"
              onClick={() => {
                haptic(HAPTIC.medium);
                commit(clearNotes(docRef.current));
                setSelected(null);
                syncPlayer(docRef.current);
              }}
            >
              {t('roll.clear')}
            </button>
          </div>

          <div className="roll-group">
            <button
              type="button"
              className="roll-btn"
              onClick={() => zoomBy(-1)}
              aria-label={t('flow.zoomOut')}
              title={t('flow.zoomOut')}
            >
              −
            </button>
            <button
              type="button"
              className="roll-btn"
              onClick={() => zoomBy(1)}
              aria-label={t('flow.zoomIn')}
              title={t('flow.zoomIn')}
            >
              ＋
            </button>
          </div>

          <div className="roll-group">
            <button
              type="button"
              className="roll-btn wide"
              disabled={!track}
              onClick={() => {
                if (track) exportSongMidi(rollToSong(docRef.current), trackTitle(track));
              }}
            >
              {t('player.exportMidi')}
            </button>
            <button type="button" className="roll-btn wide primary" onClick={save}>
              {t('roll.save')}
            </button>
          </div>
        </div>

        {selectedNote ? (
          <div className="roll-inspector">
            <span className="ri-pitch">{noteName(selectedNote.note)}</span>
            <label className="roll-field">
              {t('roll.start')}
              <input
                type="number"
                min={0}
                step={snap}
                value={selectedNote.start}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    commit(updateNote(docRef.current, selectedNote.id, { start: Math.max(0, value) }));
                  }
                }}
              />
            </label>
            <label className="roll-field">
              {t('roll.duration')}
              <input
                type="number"
                min={MIN_LENGTH}
                step={snap}
                value={selectedNote.length}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    commit(updateNote(docRef.current, selectedNote.id, { length: Math.max(MIN_LENGTH, value) }));
                  }
                }}
              />
            </label>
            <label className="roll-field vel">
              {t('roll.velocity')}
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={selectedNote.velocity}
                onChange={(event) =>
                  commit(
                    updateNote(docRef.current, selectedNote.id, { velocity: Number(event.target.value) }),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="roll-btn"
              onClick={deleteSelected}
              aria-label={t('roll.delete')}
              title={t('roll.delete')}
            >
              ⌫
            </button>
          </div>
        ) : null}

        <div className="roll-scroll" ref={scrollRef}>
          <div className="roll-gutter" style={{ width: 56 }}>
            <div className="roll-corner" />
            <div className="roll-keys">
              {Array.from({ length: high - low + 1 }, (_, i) => {
                const note = high - i;
                return (
                  <div
                    key={note}
                    className={`roll-key${isBlackKey(note) ? ' black' : ''}`}
                    style={{ height: ROW_H }}
                  >
                    {note % 12 === 0 || note === high ? noteName(note) : ''}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="roll-lanes" style={{ minWidth: gridW }}>
            <div
              className="roll-ruler"
              onPointerDown={(event) => {
                const beats = beatAt(event.clientX);
                midiPlayer.seek(beats * secondsPerBeat(docRef.current.bpm));
              }}
              role="slider"
              aria-label={t('roll.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.max(4, doc.beats)}
              aria-valuenow={Number(playBeats.toFixed(2))}
              tabIndex={0}
            >
              {Array.from({ length: Math.ceil(Math.max(4, doc.beats) / 4) }, (_, bar) => (
                <span key={bar} className="roll-bar" style={{ left: bar * 4 * zoom }}>
                  {bar + 1}
                </span>
              ))}
            </div>

            <div
              className="roll-grid"
              ref={gridRef}
              style={{
                minWidth: gridW,
                height: gridH,
                ['--ppb' as string]: `${zoom}px`,
              }}
              onPointerDown={onGridPointerDown}
              onPointerMove={onGridPointerMove}
              onPointerUp={onGridPointerUp}
              onPointerCancel={() => {
                gesture.current = null;
              }}
            >
              {Array.from({ length: high - low + 1 }, (_, i) => {
                const note = high - i;
                return (
                  <div
                    key={note}
                    className={`roll-row${isBlackKey(note) ? ' black' : ''}`}
                    style={{ top: i * ROW_H, height: ROW_H }}
                  />
                );
              })}

              {doc.notes.map((note) => {
                const width = Math.max(12, note.length * zoom - 2);
                return (
                  <div
                    key={note.id}
                    className={`roll-note${selected === note.id ? ' sel' : ''}`}
                    data-note={note.id}
                    style={{
                      left: note.start * zoom,
                      top: (high - note.note) * ROW_H + 1,
                      width,
                      height: ROW_H - 2,
                      background: noteColor(note.note, low, high, light),
                      opacity: 0.45 + note.velocity * 0.55,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${noteName(note.note)} · ${note.start.toFixed(2)}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(note.id);
                      } else if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        commit(removeNote(docRef.current, note.id));
                      }
                    }}
                    onDoubleClick={() => commit(removeNote(docRef.current, note.id))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      commit(removeNote(docRef.current, note.id));
                    }}
                    title={`${noteName(note.note)} · ${note.length.toFixed(2)} ${t('roll.beats')}`}
                  >
                    {width >= (touch ? 44 : 30) ? (
                      <span className="rn-handle left" data-handle="l" />
                    ) : null}
                    <span className="rn-handle" data-handle="r" />
                  </div>
                );
              })}

              {pending ? (
                <div
                  className="roll-note pending"
                  style={{
                    left: pending.start * zoom,
                    top: (high - pending.note) * ROW_H + 1,
                    width: Math.max(12, snap * zoom - 2),
                    height: ROW_H - 2,
                    background: noteColor(pending.note, low, high, light),
                  }}
                />
              ) : null}

              {doc.notes.length === 0 ? <div className="roll-empty">{t('roll.empty')}</div> : null}

              <div className="roll-playhead" style={{ left: playBeats * zoom }} />
            </div>
          </div>
        </div>

        {open && keysOpen ? (
          <div className="roll-kbd">
            <div className="roll-kbd-head">
              <span className="roll-kbd-label">{t('roll.keyboard')}</span>
              <button
                type="button"
                className="roll-kbd-toggle"
                aria-label={t('top.keyboardHide')}
                title={t('top.keyboardHide')}
                onClick={() => {
                  haptic();
                  setKeysOpen(false);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 4.5 L6 8.5 L10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <Keyboard />
          </div>
        ) : null}
      </aside>
    </>
  );
}
