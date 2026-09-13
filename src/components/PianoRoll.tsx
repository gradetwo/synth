/**
 * Piano-roll editor.
 *
 * Opened from the top bar or the player panel, it edits the current library
 * track as a beat-based `RollDoc` and previews through the shared MIDI player.
 * Notes can be drawn, dragged, resized and deleted; the on-screen keyboard
 * strip, the computer keyboard and external MIDI gear all step-enter notes
 * while the input toggle is armed.
 *
 * Since P10.1 the editor works on a *selection set* rather than one note: a
 * marquee, Ctrl/Cmd-click and Shift-click build it, and the batch edits (move,
 * copy, paste, delete, resize, quantise, velocity) each land as exactly one undo
 * step. The rules live in `midi/selection.ts` and are unit-tested there, so this
 * file stays about gestures and pixels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
// Register this panel's copy at module scope (P11.2); see `i18n.ts`.
import { loadRollStrings } from '@/i18n-panels';
void loadRollStrings();
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
  MAX_NOTE,
  MIN_LENGTH,
  MIN_NOTE,
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
  transposeDoc,
  updateNote,
  type RollDoc,
  type RollNote,
} from '@/midi/roll';
import {
  clampSelectionDelta,
  copySelection,
  isSelected,
  marqueeSelected,
  moveSelection,
  pasteCollides,
  pasteSelection,
  pruneSelection,
  quantizeSelection,
  rangeSelected,
  removeSelection,
  scaleSelection,
  selectAll,
  selectOnly,
  selectedNotes,
  setSelectionVelocity,
  toggleSelected,
  type NoteClipboard,
} from '@/midi/selection';
import { rollSession, useRollSession } from '@/state/roll';
import { songTracks } from '@/midi/smf';
import { clipsOf, clipsOfLayer } from '@/midi/clips';
import { Keyboard } from './Keyboard';
import { TransportIcon } from './TransportIcon';

/** Pixels per semitone; the grid scrolls vertically. */
const ROW_H = 20;
/** Horizontal zoom steps, in pixels per beat. */
const ZOOMS = [24, 36, 48, 64, 88, 120, 160];
/** How far a note must move before a press counts as a drag. */
const DRAG_SLOP = 4;
/** Vertical step of a Shift+arrow, and of the Ctrl/Cmd fine step, in semitones. */
const OCTAVE = 12;
/** How far a drag must travel vertically before the cross-layer refusal shows. */
const CROSS_LAYER_SLOP = ROW_H * 2;
/** Where a paste lands when the playhead is at the very top of the clip. */
const PASTE_FALLBACK_BEATS = 1.25;

const snapLabel = (beats: number): string =>
  ({ 0.125: '1/32', 0.25: '1/16', 0.5: '1/8', 1: '1/4' })[beats] ?? `${beats}`;

/** Blue for low notes through orange for high ones. */
const noteColor = (note: number, low: number, high: number, light = false): string => {
  const ratio = high === low ? 0.5 : (note - low) / (high - low);
  return light
    ? `hsl(${Math.round(205 - ratio * 165)} 68% 44%)`
    : `hsl(${Math.round(205 - ratio * 165)} 82% 56%)`;
};

/** A rectangle on the grid, in beats and semitones. */
type GridRect = { beat0: number; beat1: number; pitch0: number; pitch1: number };

type Gesture =
  | {
      kind: 'tap';
      x: number;
      y: number;
      /** Grid position of the press, captured so a grid that scrolls
       *  mid-gesture still draws the note where the pointer went down. */
      beat: number;
      pitch: number;
    }
  | {
      kind: 'note';
      /** Which edge the gesture took hold of; `undefined` moves the note. */
      edge?: 'l' | 'r';
      id: string;
      /** The note under the pointer plus every note that moves with it. */
      group: RollNote[];
      blocked: boolean;
      x: number;
      y: number;
      moved: boolean;
    };

/** What a finished gesture produced, so pointerup can record exactly one step. */
type GestureResult = { doc: RollDoc; selection?: string[] } | null;

/** The fields a gesture may have changed, keyed by note id. */
const changedNotes = (before: RollDoc, after: RollDoc): Map<string, RollNote> => {
  const out = new Map<string, RollNote>();
  for (const note of after.notes) {
    const old = before.notes.find((n) => n.id === note.id);
    if (!old || old.start !== note.start || old.note !== note.note || old.length !== note.length) {
      out.set(note.id, note);
    }
  }
  return out;
};

/**
 * Replay a gesture on the document as it was before it started.
 *
 * A drag updates the live document on every pointermove, and the pointerup
 * gesture must record exactly one undo step back to the *pre-drag* document —
 * including the other notes `resolveOverlaps` trimmed on the way. Replaying the
 * gesture's own changes solves that in one sentence instead of snapshot
 * bookkeeping: apply what changed, keep the rest as it was.
 */
const settleGesture = (before: RollDoc, after: RollDoc): RollDoc => {
  const changes = changedNotes(before, after);
  if (changes.size === 0) return before;
  const notes = before.notes.map((note) => changes.get(note.id) ?? note);
  return { ...before, notes, beats: after.beats };
};

export function PianoRoll({ open, onClose }: { open: boolean; onClose: () => void }) {
  /**
   * The document and its undo history live in the shared session, not here: the
   * layer strip edits the same song, so both views have to see one document and
   * one history. This component only renders it and forwards gestures.
   */
  const session = useRollSession();
  const doc = session.doc;
  const snap = session.snap;
  const [track, setTrack] = useState<Track | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  /** On a touch screen a plain tap has no modifier, so selection accumulates
   *  while this is on and a tap on empty grid selects instead of drawing. */
  const [multi, setMulti] = useState(false);
  const [zoom, setZoom] = useState(88);
  const [input, setInput] = useState(true);
  const [velocity, setVelocity] = useState(0.85);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [midiState, setMidiState] = useState(midi.snapshot());
  const [pending, setPending] = useState<{ note: number; start: number } | null>(null);
  const [keysOpen, setKeysOpen] = useState(true);
  /** The box the pointer is dragging right now, kept in state so it renders. */
  const [marquee, setMarquee] = useState<GridRect | null>(null);
  /** True once something has been copied, so the paste button can enable.
   *  A ref cannot be read while rendering, and this one bit is all the button
   *  needs to know — the clipboard's contents are read in the handler. */
  const [canPaste, setCanPaste] = useState(false);

  const snapRef = useRef(snap);
  const zoomRef = useRef(zoom);
  const velocityRef = useRef(velocity);
  const selectionRef = useRef<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const multiRef = useRef(false);
  const beforeGesture = useRef<RollDoc | null>(null);
  /**
   * The box being dragged lives here rather than on `gesture`: the gesture is a
   * ref, and a ref does not re-render. The `marquee` state above is what draws
   * it; this is what pointerup reads to tell a box from a tap.
   */
  const marqueeRef = useRef<GridRect | null>(null);
  const clipboard = useRef<NoteClipboard | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPitch = useRef<number | null>(null);
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
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
  useEffect(() => {
    multiRef.current = multi;
  }, [multi]);

  useEffect(() => midiPlayer.subscribe(setPlayer), []);
  useEffect(() => midi.subscribe(() => setMidiState(midi.snapshot())), []);

  const [low, high] = useMemo(() => pitchRange(doc), [doc]);
  const gridH = (high - low + 1) * ROW_H;
  const gridW = Math.max(4, doc.beats) * zoom;
  const playBeats = player.time / secondsPerBeat(doc.bpm);
  const selectedNote = doc.notes.find((n) => n.id === selection.at(-1)) ?? null;

  /**
   * The selection with anything the document no longer has dropped.
   *
   * An undo, a clip switch or a batch delete can remove notes the set still
   * names. Pruning on every document change keeps the set honest, and because
   * pruning preserves order and identity a stale id costs exactly one extra
   * render.
   */
  const liveSelection = useMemo(() => pruneSelection(doc.notes, selection), [doc.notes, selection]);
  useEffect(() => {
    if (liveSelection.length === selection.length && liveSelection.every((id, i) => id === selection[i])) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection(liveSelection);
    if (anchorRef.current && !liveSelection.includes(anchorRef.current)) {
      anchorRef.current = liveSelection.at(-1) ?? null;
      setAnchor(anchorRef.current);
    }
  }, [liveSelection, selection]);

  /**
   * Adopt the library's current track. An editing session that is already on
   * this track is left alone: the layer strip may have edits in it, and those
   * are exactly the undo steps the user expects to still be there.
   */
  useEffect(() => {
    if (!open) return;
    const current = midiLibrary.getCurrent();
    if (current && rollSession.getTrackId() !== current.id) rollSession.open(0);
    // Adopting the track when the editor opens is the point of the effect; the
    // session owns the document itself and syncs the transport on its own.
    /* eslint-disable react-hooks/set-state-in-effect */
    setTrack(current);
    setSelection([]);
    setAnchor(null);
    setInput(true);
    setMulti(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    // The clipboard survives the dialog: closing and reopening the roll with a
    // copied figure still in it is what a user expects from copy/paste.
  }, [open]);

  const save = useCallback(() => {
    if (!track) return;
    const next = rollSession.getDoc();
    const builtin = track.id.startsWith('demo:');
    const name = builtin ? t('roll.copyOf', { name: next.name || t('roll.title') }) : next.name;
    rollSession.setName(name);
    rollSession.saveNow();
    setTrack(midiLibrary.getCurrent());
    toast(t('roll.saved', { name, n: rollSession.getDoc().notes.length }));
    haptic(HAPTIC.medium);
  }, [track]);

  /** Replace the document: one history entry, written out, previewed. */
  const commit = useCallback((next: RollDoc, record = true) => {
    rollSession.commit(next, { record });
  }, []);

  /** Live drag update: no history entry (pointerup records exactly one). */
  const commitLive = useCallback((next: RollDoc) => {
    rollSession.live(next);
  }, []);

  /** Replace the selection, in state and in the ref the handlers read. */
  const applySelection = useCallback((ids: string[], nextAnchor: string | null) => {
    selectionRef.current = ids;
    anchorRef.current = nextAnchor;
    setSelection(ids);
    setAnchor(nextAnchor);
  }, []);

  /** Scroll a freshly written note into view (step input can land off-screen). */
  const revealNote = useCallback((pitch: number, beat: number) => {
    // Wait for the inspector row and the new note to be laid out first.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const [, hi] = pitchRange(rollSession.getDoc());
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
    if (!rollSession.undo()) return;
    haptic();
  }, []);

  const redo = useCallback(() => {
    if (!rollSession.redo()) return;
    haptic();
  }, []);

  /**
   * Delete the whole selection: one document replacement, so one undo step.
   * The set is cleared, because none of it exists any more.
   */
  const deleteSelected = useCallback(() => {
    const ids = selectionRef.current;
    if (ids.length === 0) return;
    commit(removeSelection(rollSession.getDoc(), ids));
    applySelection([], null);
    haptic();
  }, [commit, applySelection]);

  /** Copy the selection to the in-memory clipboard (Ctrl+C, or the phone button). */
  const copySelected = useCallback(() => {
    const clip = copySelection(rollSession.getDoc(), selectionRef.current);
    if (!clip) return false;
    clipboard.current = clip;
    setCanPaste(true);
    haptic();
    return true;
  }, []);

  /**
   * Paste at the playhead. The copies become the selection, so they can be
   * dragged or transposed straight away. A landing spot on top of the notes the
   * copies came from says so in a toast: a paste that silently hides an
   * identical pile under the original is not a result anyone can see.
   */
  const pasteClipboard = useCallback(() => {
    const clip = clipboard.current;
    if (!clip) return false;
    const at = snapBeat(playBeats || PASTE_FALLBACK_BEATS, snap);
    const before = rollSession.getDoc();
    const hidden = pasteCollides(before, clip, at);
    const result = pasteSelection(before, clip, at, () => addNote(before, 0, 0, snap).id);
    if (result.doc === before) return false;
    commit(result.doc);
    applySelection(result.selection, result.selection.at(-1) ?? null);
    haptic();
    if (hidden) toast(t('roll.pasteHidden'));
    return true;
  }, [commit, applySelection, playBeats, snap]);

  /** Select every note of the document (Ctrl/Cmd+A, or the phone button). */
  const selectAllNotes = useCallback(() => {
    const notes = rollSession.getDoc().notes;
    if (notes.length === 0) return;
    const ids = selectAll(notes);
    applySelection(ids, ids.at(-1) ?? null);
    haptic();
  }, [applySelection]);

  const clearSelected = useCallback(() => {
    applySelection([], null);
  }, [applySelection]);

  /**
   * Nudge the selection: one undo step per press, so holding an arrow key gives
   * the user a history they can walk back through one grid step at a time.
   */
  const nudgeSelection = useCallback(
    (beats: number, notes: number) => {
      const ids = selectionRef.current;
      if (ids.length === 0) return;
      const current = rollSession.getDoc();
      const next = moveSelection(current, ids, beats, notes);
      if (next === current) return;
      commit(next);
      haptic();
    },
    [commit],
  );

  /**
   * Every one-shot batch edit goes through here: one call, one commit, one
   * entry in the undo history. `next.selection` may pick a new set, which is how
   * paste hands the copies to the user.
   */
  const runBatch = useCallback(
    (transform: (doc: RollDoc, ids: string[]) => GestureResult) => {
      const ids = selectionRef.current;
      if (ids.length === 0) return;
      const current = rollSession.getDoc();
      const result = transform(current, ids);
      if (!result || result.doc === current) return;
      commit(result.doc);
      if (result.selection) applySelection(result.selection, result.selection.at(-1) ?? null);
      haptic();
    },
    [commit, applySelection],
  );

  // ------------------------------------------------------------ grid geometry

  const gridBox = () => {
    const el = gridRef.current;
    if (!el) return { left: 0, top: 0 };
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  };
  const beatAt = (clientX: number): number => {
    const { left } = gridBox();
    return Math.max(0, (clientX - left) / zoomRef.current);
  };
  const pitchAt = (clientY: number): number => {
    const { top } = gridBox();
    const row = Math.floor((clientY - top) / ROW_H);
    return clamp(high - row, MIN_NOTE, MAX_NOTE);
  };
  // ---------------------------------------------------------------- gestures

  /**
   * Select (or extend to) one note, honouring the modifier that was held.
   *
   * `mod` is deliberately "Ctrl/Cmd *or* multi-select mode": a touch screen has
   * no modifier key, so the mode toggle in the toolbar is what stands in for
   * one, and every place that asks "is this an additive selection?" has to ask
   * the same question.
   */
  const selectOnPress = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const notes = rollSession.getDoc().notes;
    const mod = event.metaKey || event.ctrlKey || multiRef.current;
    if (event.shiftKey) {
      const built = rangeSelected(selectionRef.current, notes, anchorRef.current, id);
      applySelection(built.selection, built.anchor);
      return;
    }
    if (mod) {
      const built = toggleSelected(selectionRef.current, notes, id);
      applySelection(built.selection, built.anchor);
      return;
    }
    if (!isSelected(selectionRef.current, id)) {
      // A plain press on an unselected note selects just it; a press *inside*
      // the current selection keeps the set, which is what makes dragging a
      // marquee-built group possible.
      const built = selectOnly(id);
      applySelection(built.selection, built.anchor);
      return;
    }
    anchorRef.current = id;
    setAnchor(id);
  };

  const onGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    beforeGesture.current = rollSession.getDoc();
    const noteEl = (event.target as HTMLElement).closest('.roll-note') as HTMLElement | null;
    if (noteEl?.dataset.note) {
      const current = rollSession.getDoc().notes.find((n) => n.id === noteEl.dataset.note);
      if (!current) return;
      const handle = (event.target as HTMLElement).dataset.handle;
      selectOnPress(event, current.id);
      // Grabbing the set (rather than a Ctrl/Shift gesture) moves all of it;
      // a resize handle only ever resizes the note it was taken hold of.
      const group = handle
        ? [current]
        : (() => {
            const held = selectedNotes(rollSession.getDoc(), selectionRef.current);
            return held.some((n) => n.id === current.id) ? held : [current];
          })();
      lastPitch.current = current.note;
      gesture.current = {
        kind: 'note',
        edge: handle === 'l' ? 'l' : handle === 'r' ? 'r' : undefined,
        id: current.id,
        group,
        blocked: false,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    gesture.current = {
      kind: 'tap',
      x: event.clientX,
      y: event.clientY,
      beat: beatAt(event.clientX),
      pitch: pitchAt(event.clientY),
    };
  };

  const onGridPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // The selection box is handled first and independently of the gesture: it
    // starts as a `tap`, and clearing the gesture at that moment is what stops
    // the box from being mistaken for a draw. `marqueeRef` is what says "a box
    // is being dragged", for as long as the pointer is down.
    const rect = marqueeRef.current;
    if (rect) {
      const grown: GridRect = {
        beat0: rect.beat0,
        beat1: beatAt(event.clientX),
        pitch0: rect.pitch0,
        pitch1: pitchAt(event.clientY),
      };
      marqueeRef.current = grown;
      setMarquee(grown);
      applySelection(marqueeSelected(rollSession.getDoc().notes, grown), null);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.kind === 'tap') {
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      // Dragging empty grid space draws a selection box. On a touch screen this
      // is also how a selection starts without a modifier key.
      const box: GridRect = {
        beat0: g.beat,
        beat1: beatAt(event.clientX),
        pitch0: g.pitch,
        pitch1: pitchAt(event.clientY),
      };
      gesture.current = null;
      marqueeRef.current = box;
      setMarquee(box);
      applySelection(marqueeSelected(rollSession.getDoc().notes, box), null);
      event.preventDefault();
      return;
    }
    if (!g.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    g.moved = true;

    // The layer strip edits one layer at a time and a clip carries no take link
    // (P10.3), so a note cannot move to another layer without either losing the
    // take semantics or silently rewriting the source. Refuse it *visibly*: the
    // first sustained vertical drag says why and the drag stays on this layer.
    if (!g.blocked && Math.abs(dy) > CROSS_LAYER_SLOP && tracksInSong.length > 1) {
      g.blocked = true;
      toast(t('roll.crossLayerBlocked'));
    }

    {
      const note = g;
      const base = note.group.find((n) => n.id === note.id) ?? note.group[0];
      const delta = clampSelectionDelta(
        note.group,
        snapBeat(base.start + dx / zoom, snap) - base.start,
        -Math.round(dy / ROW_H),
      );
      if (note.edge === undefined) {
        // Move: the whole group travels by one clamped delta, so a chord keeps
        // its shape and an audition follows the note under the pointer.
        if (base.note + delta.notes !== lastPitch.current) {
          lastPitch.current = base.note + delta.notes;
          audition(base.note + delta.notes, base.velocity);
        }
        const moved = note.group.reduce(
          (next, entry) =>
            updateNote(next, entry.id, { start: entry.start + delta.beats, note: entry.note + delta.notes }),
          rollSession.getDoc(),
        );
        commitLive(resolveOverlaps(moved, note.id));
        return;
      }

      // A resize handle: dragging the right edge of any selected note scales the
      // whole group to that end beat, and the left edge moves this note's start.
      if (note.edge === 'l') {
        const latest = Math.max(0, base.start + base.length - MIN_LENGTH);
        const start = Math.min(latest, snapBeat(base.start + dx / zoom, snap));
        commitLive(
          resolveOverlaps(
            updateNote(rollSession.getDoc(), note.id, {
              start,
              length: base.length + (base.start - start),
            }),
            note.id,
          ),
        );
        return;
      }
      const end = Math.max(base.start + MIN_LENGTH, snapBeat(base.start + base.length + dx / zoom, snap));
      commitLive(
        resolveOverlaps(
          scaleSelection(
            rollSession.getDoc(),
            note.group.map((n) => n.id),
            end,
          ),
          note.id,
        ),
      );
    }
  };

  const onGridPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const g: Gesture | null = gesture.current;
    const dragged = marqueeRef.current !== null;
    gesture.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    if (dragged) {
      // The notes under the box were chosen as the pointer moved; letting go
      // simply keeps them. The box itself is a selection gesture, never a draw.
      haptic();
      return;
    }
    if (!g) return;
    if (g.kind === 'tap') {
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 8) return;
      // With the input armed a tap draws; with it off, or in multi-select mode,
      // a tap on empty space is purely a selection gesture.
      if (!input || multi) {
        applySelection([], null);
        return;
      }
      const start = snapBeat(g.beat, snap);
      const note = g.pitch;
      const added = addNote(rollSession.getDoc(), note, start, snap, velocityRef.current);
      const next = resolveOverlaps(added.doc, added.id);
      const id = added.id;
      commit(next);
      applySelection([id], id);
      revealNote(note, start);
      audition(note, velocityRef.current);
      return;
    }
    if (!g.moved) {
      // A plain click on a note selects it and plays its pitch, so you can hear
      // what you are about to edit.
      const note = rollSession.getDoc().notes.find((n) => n.id === g.id);
      if (note) audition(note.note, note.velocity);
      return;
    }
    // A drag edited the live document without history. Settling replays its
    // changes on the pre-drag document, so one undo restores every note of the
    // group — and the notes `resolveOverlaps` trimmed along the way.
    const before = beforeGesture.current;
    if (!before) return;
    rollSession.applyGesture(before, (from) => settleGesture(from, rollSession.getDoc()));
  };

  const zoomBy = (dir: number) => {
    const index = ZOOMS.indexOf(zoom);
    setZoom(ZOOMS[clamp(index + dir, 0, ZOOMS.length - 1)]);
  };

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
      const key = event.key;
      const held = selectionRef.current.length > 0;
      if (mod && key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key.toLowerCase() === 'y') {
        event.preventDefault();
        event.stopPropagation();
        redo();
      } else if (mod && key.toLowerCase() === 'a') {
        // Select all: the whole point is that it is the document, not the layer
        // strip's private idea of one.
        event.preventDefault();
        event.stopPropagation();
        selectAllNotes();
      } else if (mod && key.toLowerCase() === 'c') {
        if (copySelected()) event.preventDefault();
        event.stopPropagation();
      } else if (mod && key.toLowerCase() === 'v') {
        if (pasteClipboard()) event.preventDefault();
        event.stopPropagation();
      } else if (key === 'Escape') {
        event.preventDefault();
        // Esc backs out one level: the selection first, the editor second.
        if (held) clearSelected();
        else onClose();
      } else if (key === ' ') {
        event.preventDefault();
        if (midiPlayer.getState().playing) midiPlayer.pause();
        else midiPlayer.play();
      } else if (key === 'Delete' || key === 'Backspace') {
        if (!held) return;
        event.preventDefault();
        deleteSelected();
      } else if (key.startsWith('Arrow')) {
        if (!held) return;
        event.preventDefault();
        // Plain = one grid step and one semitone; Shift = an octave; Ctrl/Cmd =
        // a sixteenth and one semitone (the fine step, for a group that is not
        // on the grid).
        const fine = mod;
        const beats = fine ? 0.125 : snap;
        const notes = key === 'ArrowUp' || key === 'ArrowDown' ? (event.shiftKey ? OCTAVE : 1) : 0;
        if (key === 'ArrowLeft') nudgeSelection(-beats, 0);
        else if (key === 'ArrowRight') nudgeSelection(beats, 0);
        else if (key === 'ArrowUp') nudgeSelection(0, notes);
        else if (key === 'ArrowDown') nudgeSelection(0, -notes);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    open,
    onClose,
    undo,
    redo,
    deleteSelected,
    selectAllNotes,
    copySelected,
    pasteClipboard,
    clearSelected,
    nudgeSelection,
    snap,
  ]);

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
      const bpm = rollSession.getDoc().bpm;
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
      const added = addNote(rollSession.getDoc(), event.note, open_.start, length, open_.velocity);
      const next = resolveOverlaps(added.doc, added.id);
      const id = added.id;
      applySelection([id], id);
      revealNote(event.note, open_.start);
      // Step forward past the written note.
      rollSession.commit(next, { seekBeats: open_.start + length });
    });
    return () => {
      off();
      held.clear();
      setPending(null);
    };
  }, [open, input, commit, revealNote, applySelection]);

  const bars = Math.max(1, Math.round(doc.beats / 4));
  // Multi-track files are edited one layer at a time, exactly like the strip.
  const tracksInSong = track ? songTracks(track.song) : [];
  // A layer arranged with clips is edited through them (P5.2).
  const layerClips = track ? clipsOfLayer(clipsOf(track.song), session.layerIndex) : [];
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

          {layerClips.length ? (
            <label className="roll-field" title={t('clip.pickHint')}>
              {t('clip.label')}
              <select
                value={session.clipId ?? ''}
                data-act="roll-clip"
                onChange={(event) => {
                  haptic();
                  rollSession.setClip(event.target.value || null);
                  applySelection([], null);
                }}
              >
                {layerClips.map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.name} ×{clip.repeat}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {tracksInSong.length > 1 ? (
            <label className="roll-field" title={t('roll.layerHint')}>
              {t('roll.layer')}
              <select
                value={session.layerIndex}
                data-act="roll-layer"
                onChange={(event) => {
                  haptic();
                  rollSession.setLayer(Number(event.target.value));
                  applySelection([], null);
                }}
              >
                {tracksInSong.map((layer, index) => (
                  <option key={`${layer.name}-${index}`} value={index}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="roll-field">
            {t('roll.bpm')}
            <input
              type="number"
              min={40}
              max={240}
              value={doc.bpm}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) commit(setBpm(rollSession.getDoc(), value));
              }}
            />
          </label>
          <label className="roll-field">
            {t('roll.snap')}
            <select
              value={snap}
              data-act="roll-snap"
              onChange={(event) => rollSession.setSnap(Number(event.target.value))}
            >
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
                  commit(setLengthBeats(rollSession.getDoc(), Math.max(1, value) * 4));
                }
              }}
            />
          </label>

          <div className="roll-group">
            <button
              type="button"
              className="roll-btn wide"
              data-act="roll-quantize"
              onClick={() => {
                haptic();
                commit(quantizeDoc(rollSession.getDoc(), snap));
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
                commit(transposeDoc(rollSession.getDoc(), -12));
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
                commit(transposeDoc(rollSession.getDoc(), 12));
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
            className={`roll-btn${multi ? ' on' : ''}`}
            aria-pressed={multi}
            data-act="roll-multi"
            title={multi ? t('roll.multiOn') : t('roll.multiOff')}
            aria-label={t('roll.multi')}
            onClick={() => {
              haptic();
              setMulti((v) => !v);
            }}
          >
            ⬚ {t('roll.multi')}
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
              disabled={!session.canUndo}
              onClick={undo}
              aria-label={t('roll.undo')}
              title={t('roll.undo')}
            >
              ↶
            </button>
            <button
              type="button"
              className="roll-btn"
              disabled={!session.canRedo}
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
                haptic();
                commit(clearNotes(rollSession.getDoc()));
                applySelection([], null);
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
                if (track) {
                  exportSongMidi(rollSession.getSong() ?? rollToSong(rollSession.getDoc()), trackTitle(track));
                }
              }}
            >
              {t('player.exportMidi')}
            </button>
            <button type="button" className="roll-btn wide primary" onClick={save}>
              {t('roll.save')}
            </button>
          </div>
        </div>

        {liveSelection.length ? (
          <div className="roll-select" data-act="roll-selection">
            <span className="rs-count" aria-live="polite">
              {t('roll.selectedN', { n: liveSelection.length })}
            </span>
            <div className="roll-group">
              <button
                type="button"
                className="roll-btn sel"
                data-act="sel-left"
                title={t('roll.nudgeLeft')}
                aria-label={t('roll.nudgeLeft')}
                onClick={() => nudgeSelection(-snap, 0)}
              >
                ◀
              </button>
              <button
                type="button"
                className="roll-btn sel"
                data-act="sel-right"
                title={t('roll.nudgeRight')}
                aria-label={t('roll.nudgeRight')}
                onClick={() => nudgeSelection(snap, 0)}
              >
                ▶
              </button>
              <button
                type="button"
                className="roll-btn sel"
                data-act="sel-down"
                title={t('roll.nudgeDown')}
                aria-label={t('roll.nudgeDown')}
                onClick={() => nudgeSelection(0, -1)}
              >
                ▼
              </button>
              <button
                type="button"
                className="roll-btn sel"
                data-act="sel-up"
                title={t('roll.nudgeUp')}
                aria-label={t('roll.nudgeUp')}
                onClick={() => nudgeSelection(0, 1)}
              >
                ▲
              </button>
            </div>
            <div className="roll-group">
              <button
                type="button"
                className="roll-btn wide sel"
                data-act="sel-copy"
                title={t('roll.copyHint')}
                onClick={() => copySelected()}
              >
                {t('roll.copy')}
              </button>
              <button
                type="button"
                className="roll-btn wide sel"
                data-act="sel-paste"
                disabled={!canPaste}
                title={t('roll.pasteHint')}
                onClick={() => pasteClipboard()}
              >
                {t('roll.paste')}
              </button>
              <button
                type="button"
                className="roll-btn wide sel"
                data-act="sel-quantize"
                title={t('roll.quantizeSelection')}
                onClick={() => runBatch((current, ids) => ({ doc: quantizeSelection(current, ids, snap) }))}
              >
                {t('roll.quantize')}
              </button>
              <button type="button" className="roll-btn wide sel" data-act="sel-delete" onClick={deleteSelected}>
                ⌫ {t('roll.delete')}
              </button>
              <button type="button" className="roll-btn wide sel" data-act="sel-clear" onClick={clearSelected}>
                {t('roll.deselect')}
              </button>
            </div>
          </div>
        ) : null}

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
                    commit(updateNote(rollSession.getDoc(), selectedNote.id, { start: Math.max(0, value) }));
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
                    commit(updateNote(rollSession.getDoc(), selectedNote.id, { length: Math.max(MIN_LENGTH, value) }));
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
                  // One slider, the whole selection: a velocity edit is a batch
                  // edit too, and it is one undo step.
                  runBatch((current, ids) => ({
                    doc: setSelectionVelocity(current, ids, Number(event.target.value)),
                  }))
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
                midiPlayer.seek(beats * secondsPerBeat(rollSession.getDoc().bpm));
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
                marqueeRef.current = null;
                setMarquee(null);
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
                    className={`roll-note${isSelected(liveSelection, note.id) ? ' sel' : ''}`}
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
                        applySelection([note.id], note.id);
                      } else if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        deleteSelected();
                      }
                    }}
                    onDoubleClick={() => commit(removeNote(rollSession.getDoc(), note.id))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      commit(removeNote(rollSession.getDoc(), note.id));
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

              {marquee ? (
                <div
                  className="roll-marquee"
                  data-act="roll-marquee"
                  style={{
                    left: Math.min(marquee.beat0, marquee.beat1) * zoom,
                    top: (high - Math.max(marquee.pitch0, marquee.pitch1)) * ROW_H,
                    width: Math.max(1, Math.abs(marquee.beat1 - marquee.beat0) * zoom),
                    height: Math.max(
                      ROW_H,
                      (Math.abs(marquee.pitch1 - marquee.pitch0) + 1) * ROW_H,
                    ),
                  }}
                />
              ) : null}

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
