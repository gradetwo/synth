import { useEffect, useMemo, useRef, useState } from 'react';
import { getLang, t } from '@/i18n';
import { noteName } from '@/audio/noteBus';
import { toast } from './Toast';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { midiPlayer, type PlayerState } from '@/midi/player';
import { recorder, type RecorderState } from '@/midi/recorder';
import { parseMidi, songTracks, type MidiNote } from '@/midi/smf';
import {
  EDGE_PX,
  dragSeconds,
  gridSeconds,
  hitNote,
  layoutNotes,
  moveNote,
  playheadPercent,
  resizeNote,
} from '@/midi/timeline';
import { MIN_LENGTH, removeNote, rollToSeconds, updateNote, type RollDoc } from '@/midi/roll';
import { clipsDuration, clipsOf, clipsOfLayer, expandClips } from '@/midi/clips';
import { barBeatAt, secondsToBeats, tempoMapOf, withTempoMap, type TempoSegment } from '@/midi/tempo';
import { rollSession, useRollSession } from '@/state/roll';
import { midiLibrary, trackTitle, type TrackGroup } from '@/midi/library';

import { activeTakeOfLayer, layerFoldedIntoClips, takesOf, takesOfLayer } from '@/midi/take-edit';
import type { MidiTake } from '@/midi/takes';
import {
  deleteTake,
  finishRecording,
  mergeLayerTakes,
  recordingLayer,
  renameTake,
  selectTake,
} from '@/state/recording';
import { store } from '@/state/store';
import { exportSongMidi, exportSongMp3, exportSongWav } from '@/midi/export';
import { QUANTISE_GRIDS, quantiseLabel } from '@/midi/quantise';
import { TransportIcon } from './TransportIcon';

/** Bar.beat at a time, through a tempo map — shown next to the clock (P5.3). */
const barLabelOf = (map: TempoSegment[], time: number): string => {
  const where = barBeatAt(map, secondsToBeats(map, time));
  return `${where.bar}.${where.beat}`;
};

const fmtTime = (s: number) => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Run a rendering export with playback paused.
 *
 * An export renders the song again, offline, at 32 voices; leaving the live
 * transport running means two engines competing for the same CPU, and the
 * user hears the render they are waiting for as stutter. Playback is restored
 * afterwards if it was running, so the button behaves like a pause rather than
 * a stop.
 */
async function withPlaybackPaused<T>(run: () => Promise<T>): Promise<T> {
  const wasPlaying = midiPlayer.getState().playing;
  if (wasPlaying) midiPlayer.pause();
  try {
    return await run();
  } finally {
    if (wasPlaying) midiPlayer.play();
  }
}

/** Transport + playlist modal, replacing the old DEMO button. */
export function PlayerPanel({
  open,
  onClose,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [, bump] = useState(0);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [layers, setLayers] = useState(midiPlayer.getLayers());
  const [rec, setRec] = useState<RecorderState>(recorder.getState());
  const roll = useRollSession();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** Which note of the edited layer is selected, so the nudge bar can act on it. */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Whether the strip edits notes or arranges the layer.
   *
   * A strip is a few pixels tall and a busy song covers all of it, so one
   * gesture cannot mean both "move this layer" and "move this note". Arrange is
   * the default — it is what the strip always did — and note editing is one tap
   * away, with the nudge bar as the touch-friendly half of it.
   */
  const [editNotes, setEditNotes] = useState(false);
  /**
   * Arrangement work that names a destination or a saved figure (P10.2): the
   * layer a clip is copied to, and the clip template picked to apply or delete.
   * Both are kept as choices so the buttons line up with what the user sees,
   * exactly like the effect graph's template select (P7.3).
   */
  const [copyLayer, setCopyLayer] = useState('');
  const [template, setTemplate] = useState('');
  /**
   * The take whose name is being edited inline (P10.3), and the draft. Renaming
   * is one undo step on Enter; Escape and the ✕ put the old name back.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /**
   * A/B audition (P10.3): the two takes being compared, or null. `a` is the
   * take the user was on when the comparison started — every exit puts the
   * layer back on it, so "I auditioned one" cannot be mistaken for "I switched
   * take". The pair is dropped when either take is deleted or selected away.
   */
  const [ab, setAb] = useState<{ a: string; b: string } | null>(null);
  /** In-flight drag on a layer's mini timeline (the layer itself). */
  const drag = useRef<{ x: number; offset: number; width: number; duration: number; moved: boolean } | null>(
    null,
  );
  /**
   * In-flight drag on a single note. The document the gesture started from is
   * kept whole: every pointermove recomputes from it, so a drag is absolute and
   * cannot accumulate rounding, and `settle` can record exactly one undo step.
   */
  const noteDrag = useRef<{
    id: string;
    kind: 'move' | 'tail';
    x: number;
    width: number;
    duration: number;
    snap: number;
    /** Seconds per beat of the document the gesture started from. */
    spb: number;
    from: RollDoc;
    moved: boolean;
  } | null>(null);
  // Timestamp of the last track *change*, so a double-click on a new track does
  // not immediately pause the playback it just started.
  const lastSelect = useRef(0);

  useEffect(
    () =>
      midiLibrary.subscribe(() => {
        bump((v) => v + 1);
        setLayers(midiPlayer.getLayers());
      }),
    [],
  );
  useEffect(() => midiPlayer.subscribe(setPlayer), []);
  useEffect(() => recorder.subscribe(setRec), []);
  // Clip templates live in the workspace layout, so saving or deleting one has
  // to redraw the strip; nothing else about the store is read here.
  useEffect(() => store.subscribe(() => bump((v) => v + 1)), []);

  // An edit to a built-in demo becomes a copy; say so once, because the track
  // list switching under the user's finger is otherwise a mystery.
  useEffect(() => {
    if (!roll.justCopied) return;
    toast(t('layer.copied', { name: roll.copiedName }));
    rollSession.acknowledgeCopy();
  }, [roll.justCopied, roll.copiedName]);

  // Keyboard transport while the panel is open: Space toggles, Esc closes.
  // While an A/B comparison is running, A and B jump between the two takes and
  // Esc ends the comparison instead of closing the panel (P10.3).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const pair = abApi.current.ab;
      if (pair && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        abApi.current.audition('a');
      } else if (pair && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault();
        abApi.current.audition('b');
      } else if (event.key === 'Escape') {
        if (pair) {
          event.preventDefault();
          abApi.current.stopAb();
        } else {
          onClose();
        }
      } else if (event.key === ' ') {
        event.preventDefault();
        if (player.playing) midiPlayer.pause();
        else midiPlayer.play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, player.playing]);

  const tracks = midiLibrary.getTracks();
  const current = midiLibrary.getCurrent();
  /** True when the editing session is looking at this track's layer `index`. */
  const editingLayer = (index: number): boolean =>
    roll.trackId !== null && roll.trackId === current?.id && roll.layerIndex === index;
  const spb = 60 / (roll.doc.bpm || 120);
  // Note geometry per layer. The layer being edited reads from the session, not
  // from the library, because a drag updates the working copy long before it is
  // written out; every other layer is read straight from the song.
  const maps = useMemo(() => {
    const song = current?.song ?? null;
    if (!song) return [];
    // The layer being edited reads from the session — a drag updates the working
    // copy long before it is written out — and when that layer is arranged, what
    // it draws is the *arrangement* of the clip being edited, so the loops are
    // visible while they are being shaped.
    let worked: (MidiNote & { id: string })[] | null = null;
    if (roll.trackId === current?.id) {
      if (roll.clipId) {
        const clips = clipsOf(song).map((clip) =>
          clip.id === roll.clipId ? { ...clip, notes: rollToSeconds(roll.doc) } : clip,
        );
        // The looped view: an id is only used as the block key in the strip, and
        // the expansion is what the lane above is showing.
        worked = expandClips(clipsOfLayer(clips, roll.layerIndex)).notes.map((note, i) => ({
          ...note,
          id: `x${i}`,
        }));
      } else {
        worked = rollToSeconds(roll.doc);
      }
    }
    return songTracks(song).map((track, index) =>
      layoutNotes(
        worked && index === roll.layerIndex ? worked : track.notes,
        song.duration,
        layers[index]?.offset ?? 0,
      ),
    );
  }, [current, layers, roll]);

  /** The clips that arrange each layer, and the scale the lane is drawn on. */
  const clipRows = useMemo(() => {
    const song = current?.song ?? null;
    if (!song) return { rows: [] as ReturnType<typeof clipsOfLayer>[], scale: 1 };
    const all = clipsOf(song);
    return {
      rows: songTracks(song).map((_track, index) => clipsOfLayer(all, index)),
      scale: Math.max(song.duration, clipsDuration(all), 1),
    };
  }, [current]);
  const selectedClip = roll.clipId ? rollSession.clip(roll.clipId) : undefined;
  /**
   * The clip templates saved in the workspace (P10.2). They live in the layout,
   * next to the effect-graph templates, so the strip has to follow the store as
   * well as the library: saving one does not touch the song.
   */
  const clipTemplates = store.getSnapshot().layout.clipTemplates;
  const chosenTemplate = clipTemplates.find((entry) => entry.id === template) ?? null;
  /**
   * Where a cross-layer copy of the selected clip would land: the layer picked
   * in the strip, so "copy to another layer" is a two-click move without a
   * dialog. The picker is only shown when the song actually has one.
   */
  const copyTarget = copyLayer === '' ? null : Number(copyLayer);
  const copyTargetValid =
    copyTarget !== null &&
    copyTarget >= 0 &&
    copyTarget < layers.length &&
    selectedClip !== undefined &&
    selectedClip.layer !== copyTarget;

  const applyClipTemplate = (id: string) => {
    setTemplate(id);
    const entry = clipTemplates.find((item) => item.id === id);
    if (!entry) return;
    haptic(HAPTIC.light);
    if (rollSession.applyTemplate(entry, roll.layerIndex)) toast(t('clip.tplApplied', { name: entry.name }));
  };

  const saveClipTemplate = () => {
    if (!selectedClip) return;
    haptic();
    const saved = store.saveClipTemplate(selectedClip, selectedClip.name);
    setTemplate(saved.id);
    toast(t('clip.tplSavedToast', { name: saved.name }));
  };

  const deleteClipTemplate = () => {
    if (!chosenTemplate) return;
    haptic(HAPTIC.medium);
    if (store.deleteClipTemplate(chosenTemplate.id)) {
      setTemplate('');
      toast(t('clip.tplDeleted'));
    }
  };

  const copyClipToLayer = () => {
    if (!selectedClip || copyTarget === null || !copyTargetValid) return;
    haptic();
    const made = rollSession.copyToLayer(selectedClip.id, copyTarget);
    if (made) {
      toast(t('clip.copyLayerDone', { name: selectedClip.name, n: copyTarget + 1 }));
      setCopyLayer('');
    }
  };

  /**
   * The takes of the layer a recording would land on (P5.4). Only that layer's
   * are shown: a take belongs to one layer, and the strip is already a
   * per-layer view, so mixing the layers' alternates into one row would make
   * the chips mean two different things.
   */
  const takeLayer = recordingLayer();
  const layerTakes = current ? takesOfLayer(takesOf(current.song), takeLayer) : [];
  const takeId = current ? activeTakeOfLayer(current.song, takeLayer)?.id : undefined;
  /**
   * A folded layer plays its clips, not its take (P10.3): `withTakes` expands
   * the clips last, so selecting a take there would be silently inaudible. The
   * row says so and the switch/merge controls refuse, instead of pretending.
   */
  const layerArranged = current ? layerFoldedIntoClips(current.song, takeLayer) : false;
  const takeName = (id: string | undefined): string =>
    layerTakes.find((take) => take.id === id)?.name ?? '—';

  const startRename = (take: MidiTake) => {
    haptic();
    setRenaming(take.id);
    setRenameDraft(take.name);
  };

  const commitRename = () => {
    if (renaming) renameTake(renaming, renameDraft);
    setRenaming(null);
    setAb(null);
  };

  /**
   * Audition a take without moving the playhead: `selectTake` reloads the
   * transport keeping the listener's place, so A and B are heard from the same
   * point — which is the only way two passes can actually be compared.
   */
  const audition = (which: 'a' | 'b') => {
    const take = ab ? (which === 'a' ? ab.a : ab.b) : null;
    if (!take || !layerTakes.some((entry) => entry.id === take)) {
      setAb(null);
      return;
    }
    haptic();
    selectTake(take);
  };

  const startAb = () => {
    if (layerArranged || layerTakes.length < 2) return;
    haptic();
    const first = takeId && layerTakes.some((take) => take.id === takeId)
      ? takeId
      : layerTakes[layerTakes.length - 1].id;
    const second = layerTakes.find((take) => take.id !== first)?.id;
    if (!second) return;
    setAb({ a: first, b: second });
    selectTake(second);
    if (!midiPlayer.getState().playing) midiPlayer.play();
  };

  /**
   * End the comparison and put the layer back on A, with the reason on screen.
   * Stopping the transport counts as ending it, so the user is never left on
   * the alternate take wondering whether they changed the song.
   */
  const stopAb = () => {
    const pair = abApi.current.ab;
    if (!pair) return;
    setAb(null);
    const back = layerTakes.find((take) => take.id === pair.a);
    if (back && selectTake(pair.a)) toast(t('take.abBack', { name: back.name }));
  };

  // The keyboard handler and the transport-stop effect live outside the render
  // that owns the pair; both read the newest closure through this ref, so the
  // key bindings cannot go stale between renders.
  const abApi = useRef({ ab, audition, stopAb });
  abApi.current = { ab, audition, stopAb };
  /** False until the comparison has actually been playing once. */
  const abArmed = useRef(false);
  abArmed.current = ab ? abArmed.current : false;

  useEffect(() => {
    if (ab && player.playing) abArmed.current = true;
    else if (ab && abArmed.current && !player.playing) abApi.current.stopAb();
  }, [ab, player.playing]);

  /** Width of the resize handle in bar-percent units, from the pixel width. */
  const edgePercent = (width: number): number => Math.min(12, (EDGE_PX / Math.max(1, width)) * 100);

  const selectedNote = roll.doc.notes.find((n) => n.id === selected) ?? null;

  /**
   * The nudge bar: a move or resize of one grid step per press. Drags are the
   * fast path on a desktop, but a phone has no hover and no precise pointer, so
   * the same edit has to be reachable by tapping buttons.
   */
  const nudgeSelected = (kind: 'start' | 'length', steps: number) => {
    const note = rollSession.getDoc().notes.find((n) => n.id === selected);
    if (!note) return;
    haptic();
    if (kind === 'length') {
      rollSession.nudge(note.id, { length: Math.max(MIN_LENGTH, note.length + steps * roll.snap) });
      return;
    }
    // Moving stops at the song's edges: the strip is a whole-song view, so a
    // note pushed past the end would simply leave the picture.
    const longest = Math.max(0, (current?.song.duration ?? 0) - note.length * spb) / spb;
    rollSession.nudge(note.id, {
      start: Math.min(Math.max(0, note.start + steps * roll.snap), longest),
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? tracks.filter((tr) => `${trackTitle(tr)} ${tr.composer}`.toLowerCase().includes(q))
      : tracks;
  }, [tracks, query]);

  const importFile = async (file: File) => {
    try {
      const song = parseMidi(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.midi?$/i, ''));
      if (song.notes.length === 0) throw new Error(t('player.emptyFile'));
      const title = song.name || file.name;
      midiLibrary.put({
        id: `file:${file.name}:${Date.now()}`,
        title: [title, title],
        composer: t('player.importedBy'),
        song,
        group: 'imported',
      })
      store.mark();
      toast(t('player.imported', { name: title, n: song.notes.length }));
    } catch (err) {
      toast(t('player.importFailed', { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const toggleRecord = () => {
    haptic(HAPTIC.medium);
    if (rec.recording) {
      const clip = recorder.stop();
      // The finished pass becomes a take over the current one: nothing that was
      // already there is lost, and the pass before it stays in the list (P5.4).
      if (clip) finishRecording(clip);
      return;
    }
    midiPlayer.stop();
    recorder.start();
  };

  const groups: { key: TrackGroup; label: string }[] = [
    { key: 'clip', label: t('player.groupClip') },
    { key: 'imported', label: t('player.groupImported') },
    { key: 'builtin', label: t('player.groupBuiltin') },
  ];

  return (
    <>
      <div className={`player-mask${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`player${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('player.title')}
        aria-hidden={!open}
      >
        <header className="player-head">
          <span className="player-title">{t('player.title')}</span>
          <button type="button" className="d-close" onClick={onClose} aria-label={t('drawer.close')}>
            ✕
          </button>
        </header>

        <Transport player={player} rec={rec} onRecord={toggleRecord} />

        <div className="player-actions">
          <button type="button" className="player-btn wide" onClick={() => fileRef.current?.click()}>
            {t('player.import')}
          </button>
          <button
            type="button"
            className="player-btn wide"
            onClick={() => current && exportSongMidi(current.song, trackTitle(current))}
            disabled={!current}
          >
            {t('player.exportMidi')}
          </button>
          <button
            type="button"
            className="player-btn wide"
            disabled={!current}
            onClick={() => {
              haptic();
              onEdit();
            }}
          >
            {t('roll.edit')}
          </button>
          <button
            type="button"
            className="player-btn wide primary"
            disabled={!current || busy}
            onClick={async () => {
              if (!current) return;
              setBusy(true);
              try {
                await withPlaybackPaused(() => exportSongMp3(current.song, trackTitle(current)));
                toast(t('player.mp3Saved', { name: trackTitle(current) }));
              } catch (err) {
                toast(t('player.mp3Failed', { msg: err instanceof Error ? err.message : String(err) }));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('player.rendering') : t('player.exportMp3')}
          </button>
          <button
            type="button"
            className="player-btn wide"
            disabled={!current || busy}
            title={t('player.wavHint')}
            onClick={async () => {
              if (!current) return;
              setBusy(true);
              try {
                await withPlaybackPaused(() => exportSongWav(current.song, trackTitle(current)));
                toast(t('player.wavSaved', { name: trackTitle(current) }));
              } catch (err) {
                toast(t('player.mp3Failed', { msg: err instanceof Error ? err.message : String(err) }));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('player.exportWav')}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />

        <div className="player-search">
          <input
            type="search"
            value={query}
            placeholder={t('player.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {/* One row per layer: the arrangement at a glance, and a place to edit a
            note without opening the piano roll. Edits go through the shared
            editing session, so this strip and the roll are one document and one
            undo history — a note moved here is moved there. */}
        {current ? (
          <>
            <div className="layer-tools">
              <button
                type="button"
                className="layer-mode"
                data-act="clip-fold"
                title={t('clip.foldHint')}
                onClick={() => {
                  haptic();
                  rollSession.fold(roll.layerIndex, trackTitle(current));
                  setSelected(null);
                }}
              >
                {t('clip.fold')}
              </button>
              {selectedClip ? (
                <>
                  <span className="clip-info" data-act="clip-info">
                    {selectedClip.name} · {selectedClip.repeat}×
                  </span>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-earlier"
                    aria-label={t('clip.moveEarlier')}
                    title={t('clip.moveEarlier')}
                    onClick={() => rollSession.nudgeClip(selectedClip.id, -selectedClip.length)}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-later"
                    aria-label={t('clip.moveLater')}
                    title={t('clip.moveLater')}
                    onClick={() => rollSession.nudgeClip(selectedClip.id, selectedClip.length)}
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-copy"
                    aria-label={t('clip.copy')}
                    title={t('clip.copy')}
                    onClick={() => {
                      haptic();
                      rollSession.copy(selectedClip.id);
                    }}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-shorter"
                    aria-label={t('clip.windowShorter')}
                    title={t('clip.windowShorter')}
                    onClick={() => rollSession.resize(selectedClip.id, -selectedClip.length / 4)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-longer"
                    aria-label={t('clip.windowLonger')}
                    title={t('clip.windowLonger')}
                    onClick={() => rollSession.resize(selectedClip.id, selectedClip.length / 4)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-fewer"
                    aria-label={t('clip.repeatLess')}
                    title={t('clip.repeatLess')}
                    onClick={() => rollSession.repeat(selectedClip.id, -1)}
                  >
                    ×−
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn"
                    data-act="clip-more"
                    aria-label={t('clip.repeatMore')}
                    title={t('clip.repeatMore')}
                    onClick={() => rollSession.repeat(selectedClip.id, 1)}
                  >
                    ×+
                  </button>
                  <button
                    type="button"
                    className="layer-edit-btn del"
                    data-act="clip-delete"
                    aria-label={t('clip.delete')}
                    title={t('clip.delete')}
                    onClick={() => {
                      haptic(HAPTIC.medium);
                      rollSession.remove(selectedClip.id);
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={`layer-mode${editNotes ? ' on' : ''}`}
                data-act="strip-mode"
                aria-pressed={editNotes}
                title={editNotes ? t('layer.modeHintNote') : t('layer.modeHintArrange')}
                onClick={() => {
                  haptic();
                  setEditNotes((was) => {
                    if (was) setSelected(null);
                    return !was;
                  });
                }}
              >
                {editNotes ? t('layer.modeNote') : t('layer.modeArrange')}
              </button>
            </div>
            {/* The figure across layers and songs (P10.2): copy the selected
                clip onto another layer as it is, or keep its notes as a named
                workspace template and drop them on any layer. Both build a
                *fresh* clip through the same core the arrangement uses, so a
                copy never aliases the original. The row only exists once a
                layer is arranged — a song without clips has no figure to move,
                and the strip must not grow a control row for it. */}
            {clipRows.rows[roll.layerIndex]?.length ? (
              <div className="clip-tools" data-act="clip-tools" role="group" aria-label={t('clip.tpl')}>
                <span className="clip-tools-title">{t('clip.tpl')}</span>
                <label className="clip-field" title={t('clip.copyLayerHint')}>
                  <span className="clip-field-label">{t('clip.copyLayer')}</span>
                  <select
                    className="clip-select"
                    data-act="clip-copy-target"
                    aria-label={t('clip.copyLayer')}
                    value={copyLayer}
                    onChange={(event) => setCopyLayer(event.target.value)}
                  >
                    <option value="">—</option>
                    {layers.map((layer, index) => (
                      <option key={`${layer.name}-${index}`} value={index}>
                        {index + 1} · {layer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="take-btn"
                  data-act="clip-copy-layer"
                  disabled={!copyTargetValid}
                  title={t('clip.copyLayerHint')}
                  onClick={copyClipToLayer}
                >
                  {t('clip.copyLayerShort')}
                </button>
                <span className="clip-tools-sep" aria-hidden="true" />
                <select
                  className="clip-select"
                  data-act="clip-template"
                  aria-label={t('clip.tpl')}
                  value={template}
                  onChange={(event) => applyClipTemplate(event.target.value)}
                >
                  <option value="">{t('clip.tplPick')}</option>
                  {clipTemplates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="take-btn"
                  data-act="clip-template-save"
                  disabled={!selectedClip}
                  title={t('clip.tplSaveHint')}
                  onClick={saveClipTemplate}
                >
                  {t('clip.tplSave')}
                </button>
                <button
                  type="button"
                  className="take-btn del"
                  data-act="clip-template-delete"
                  disabled={!chosenTemplate}
                  aria-label={t('clip.tplDelete')}
                  title={t('clip.tplDelete')}
                  onClick={deleteClipTemplate}
                >
                  ✕
                </button>
              </div>
            ) : null}
            {/* Takes (P5.4, P10.3): the performance that is playing, the
                alternates kept beside it, rename, A/B audition and the two
                merge trades. A chip is a tap target, not a hover target,
                because recording is what a phone is good at. */}
            <div className="take-tools" data-act="take-tools" role="group" aria-label={t('take.title')}>
              <span className="take-title">{t('take.title')}</span>
              {layerTakes.map((take) =>
                renaming === take.id ? (
                  <span className="take-edit" key={take.id}>
                    <input
                      className="take-rename"
                      data-act="take-rename-input"
                      value={renameDraft}
                      autoFocus
                      maxLength={60}
                      aria-label={t('take.rename')}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setRenaming(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="take-btn ok"
                      data-act="take-rename-save"
                      aria-label={t('take.rename')}
                      title={t('take.renameHint')}
                      onClick={commitRename}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="take-btn del"
                      data-act="take-rename-cancel"
                      aria-label={t('take.renameCancel')}
                      title={t('take.renameCancel')}
                      onClick={() => setRenaming(null)}
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    key={take.id}
                    type="button"
                    className={`take-chip${take.id === takeId ? ' on' : ''}`}
                    data-act="take"
                    data-take={take.id}
                    data-blocked={layerArranged ? 'true' : undefined}
                    aria-pressed={take.id === takeId}
                    title={`${take.name} · ${take.notes.length} ${t('player.notes')}`}
                    onClick={() => {
                      haptic();
                      // A folded layer plays its clips; a take switch there is
                      // refused with the reason rather than performed silently.
                      if (layerArranged) {
                        toast(t('take.foldedHint'));
                        return;
                      }
                      setAb(null);
                      // Selecting *is* auditioning: the take is loaded and plays
                      // from the top, which is the only way to hear a difference
                      // between two passes without reading note counts.
                      if (take.id !== takeId) selectTake(take.id);
                      midiPlayer.seek(0);
                      midiPlayer.play();
                    }}
                    onDoubleClick={() => startRename(take)}
                  >
                    <span className="take-name">{take.name}</span>
                    <span className="take-notes">{take.notes.length}</span>
                  </button>
                ),
              )}
              {!renaming && layerTakes.length ? (
                <button
                  type="button"
                  className="take-btn"
                  data-act="take-rename"
                  aria-label={t('take.rename')}
                  title={t('take.renameHint')}
                  onClick={() => {
                    const target = layerTakes.find((take) => take.id === takeId) ?? layerTakes[layerTakes.length - 1];
                    if (target) startRename(target);
                  }}
                >
                  {t('take.rename')}
                </button>
              ) : null}
              <button
                type="button"
                className={`take-btn${ab ? ' on' : ''}`}
                data-act="take-ab"
                disabled={layerArranged || layerTakes.length < 2}
                aria-pressed={Boolean(ab)}
                aria-label={t('take.ab')}
                title={layerArranged ? t('take.foldedHint') : t('take.abHint')}
                onClick={() => (ab ? stopAb() : startAb())}
              >
                {t('take.ab')}
              </button>
              {ab ? (
                <span className="take-ab" data-act="take-ab-pair" role="group" aria-label={t('take.abHint')}>
                  <span className="take-ab-label" data-act="take-ab-label">
                    {t('take.abOn', { a: takeName(ab.a), b: takeName(ab.b) })}
                  </span>
                  <button
                    type="button"
                    className={`take-btn${takeId === ab.a ? ' on' : ''}`}
                    data-act="take-ab-a"
                    aria-pressed={takeId === ab.a}
                    title={t('take.abHint')}
                    onClick={() => audition('a')}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className={`take-btn${takeId === ab.b ? ' on' : ''}`}
                    data-act="take-ab-b"
                    aria-pressed={takeId === ab.b}
                    title={t('take.abHint')}
                    onClick={() => audition('b')}
                  >
                    B
                  </button>
                </span>
              ) : null}
              <button
                type="button"
                className="take-btn"
                data-act="take-merge"
                disabled={layerArranged || layerTakes.length < 2}
                aria-label={t('take.mergeUnion')}
                title={layerArranged ? t('take.foldedHint') : t('take.mergeUnionHint')}
                onClick={() => {
                  haptic();
                  mergeLayerTakes('union');
                }}
              >
                {t('take.mergeUnion')}
              </button>
              <button
                type="button"
                className="take-btn"
                data-act="take-merge-overwrite"
                disabled={layerArranged || layerTakes.length < 2}
                aria-label={t('take.mergeOverwrite')}
                title={layerArranged ? t('take.foldedHint') : t('take.mergeOverwriteHint')}
                onClick={() => {
                  haptic();
                  mergeLayerTakes('overwrite');
                }}
              >
                {t('take.mergeOverwrite')}
              </button>
              <button
                type="button"
                className="take-btn del"
                data-act="take-delete"
                disabled={!takeId}
                aria-label={t('layer.delete')}
                title={t('layer.delete')}
                onClick={() => {
                  haptic(HAPTIC.medium);
                  setAb(null);
                  if (takeId) deleteTake(takeId);
                }}
              >
                ✕
              </button>
            </div>
            {layerArranged ? (
              <div className="take-note" data-act="take-folded-hint" role="status">
                {t('take.foldedHint')}
              </div>
            ) : null}
            {ab ? (
              <div className="take-note" data-act="take-ab-hint" role="status">
                {t('take.abHint')}
              </div>
            ) : null}
            <div className="layer-strip" data-layers={layers.length} data-mode={editNotes ? 'notes' : 'arrange'}>
              {layers.map((layer, index) => (
              <div className="layer-row" key={`${layer.name}-${index}`} data-layer={index}>
                {/* Arrangement lane: the layer's clips, placed and repeated.
                    A clip is a window over its own material, so its block is as
                    wide as the whole arrangement it plays, with a tick at every
                    loop point. */}
                {(clipRows.rows[index] ?? []).length ? (
                  <div className="clip-lane" data-act="clips" aria-label={t('clip.lane')}>
                    {(clipRows.rows[index] ?? []).map((clip) => (
                      <button
                        key={clip.id}
                        type="button"
                        className={`clip-block${clip.id === roll.clipId ? ' sel' : ''}`}
                        data-act="clip"
                        data-clip={clip.id}
                        style={{
                          left: `${(clip.start / clipRows.scale) * 100}%`,
                          width: `${Math.max(2, ((clip.length * clip.repeat) / clipRows.scale) * 100)}%`,
                        }}
                        title={`${clip.name} · ${clip.repeat}×`}
                        onClick={() => {
                          haptic();
                          // The lane a block is drawn in is the layer it belongs
                          // to, so selecting one switches the session to that
                          // layer as well as to the clip — P10.2 copies a clip
                          // onto another layer and expects to edit it right
                          // there, and a session on the wrong layer would draw
                          // the new clip's notes against the old layer's rows.
                          rollSession.setClip(clip.id, clip.layer ?? 0);
                          setSelected(null);
                        }}
                      >
                        <span className="clip-name">{clip.name}</span>
                        {Array.from({ length: Math.min(clip.repeat, 32) - 1 }, (_, mark) => (
                          <span
                            key={mark}
                            className="clip-loop"
                            style={{ left: `${((mark + 1) / clip.repeat) * 100}%` }}
                          />
                        ))}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* The layer's notes as a bar. Drag a note to move it, drag its
                    right edge to resize, double-click to delete; drag the
                    background to move the whole layer, tap it to scrub. */}
                <div
                  className={`layer-map${editNotes ? ' notes' : ''}${editingLayer(index) ? ' editing' : ''}`}
                  data-act="map"
                  role="group"
                  aria-label={`${t('layer.map')} ${layer.name}`}
                  title={editNotes ? t('layer.modeHintNote') : t('layer.mapHint')}
                  onPointerDown={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const width = Math.max(1, rect.width);
                    const fraction = (event.clientX - rect.left) / width;
                    const hit = editNotes
                      ? hitNote(maps[index] ?? [], fraction * 100, edgePercent(width))
                      : null;
                    if (hit) {
                      // Editing a row means editing that layer: point the session
                      // at it first, then act on the note that was grabbed. The
                      // note order is the same in both, so the index survives.
                      if (!editingLayer(index)) {
                        rollSession.setCopyTitle(t('roll.copyOf', { name: trackTitle(current) }));
                        rollSession.open(index);
                      }
                      const note = rollSession.getDoc().notes[hit.index];
                      if (!note) return;
                      setSelected(note.id);
                      noteDrag.current = {
                        id: note.id,
                        kind: hit.edge === 'tail' ? 'tail' : 'move',
                        x: event.clientX,
                        width,
                        duration: current.song.duration,
                        snap: gridSeconds(roll.snap, roll.doc.bpm),
                        spb: 60 / (roll.doc.bpm || 120),
                        from: rollSession.getDoc(),
                        moved: false,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                      haptic();
                      return;
                    }
                    drag.current = {
                      x: event.clientX,
                      offset: layer.offset,
                      width,
                      duration: player.duration || 1,
                      moved: false,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const nd = noteDrag.current;
                    if (nd) {
                      const dx = event.clientX - nd.x;
                      if (Math.abs(dx) < 3) return;
                      nd.moved = true;
                      const original = nd.from.notes.find((n) => n.id === nd.id);
                      if (!original) return;
                      // The drag is measured in seconds, the document in beats.
                      const seconds = {
                        note: original.note,
                        velocity: original.velocity,
                        start: original.start * nd.spb,
                        duration: original.length * nd.spb,
                      };
                      const delta = dragSeconds(dx, nd.width, nd.duration);
                      const edit =
                        nd.kind === 'tail'
                          ? resizeNote(seconds, delta, nd.snap, nd.duration)
                          : moveNote(seconds, delta, nd.snap, nd.duration);
                      rollSession.live(
                        updateNote(nd.from, nd.id, {
                          start: edit.start / nd.spb,
                          length: edit.duration / nd.spb,
                        }),
                      );
                      return;
                    }
                    const d = drag.current;
                    if (!d) return;
                    const dx = event.clientX - d.x;
                    if (Math.abs(dx) < 4) return;
                    d.moved = true;
                    midiPlayer.setLayer(index, { offset: d.offset + (dx / d.width) * d.duration });
                    setLayers(midiPlayer.getLayers());
                  }}
                  onPointerUp={(event) => {
                    const nd = noteDrag.current;
                    if (nd) {
                      noteDrag.current = null;
                      // One gesture, one undo step: the drags in between only
                      // updated the working copy.
                      if (nd.moved) {
                        rollSession.settle(nd.from);
                        haptic(HAPTIC.medium);
                      }
                      return;
                    }
                    const d = drag.current;
                    drag.current = null;
                    if (!d) return;
                    if (d.moved) {
                      // A drag is an arrangement change: keep it with the song.
                      midiLibrary.saveMix();
                      return;
                    }
                    // A tap on the background is a scrub: jump the transport there.
                    setSelected(null);
                    const rect = event.currentTarget.getBoundingClientRect();
                    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
                    midiPlayer.seek(Math.max(0, Math.min(1, fraction)) * (player.duration || 0));
                  }}
                  onDoubleClick={(event) => {
                    if (!editNotes || !editingLayer(index)) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
                    const hit = hitNote(maps[index] ?? [], fraction * 100, edgePercent(rect.width));
                    if (!hit) return;
                    const note = rollSession.getDoc().notes[hit.index];
                    if (!note) return;
                    rollSession.commit(removeNote(rollSession.getDoc(), note.id), { sync: true });
                    setSelected(null);
                    haptic(HAPTIC.medium);
                  }}
                >
                  {(maps[index] ?? []).map((block, blockIndex) => {
                    const id = editingLayer(index) ? roll.doc.notes[block.index]?.id : null;
                    return (
                      <span
                        key={id ?? `${index}-${blockIndex}`}
                        className={`layer-note${id && id === selected ? ' selected' : ''}`}
                        data-act="note"
                        style={{ left: `${block.left}%`, width: `${block.width}%` }}
                      />
                    );
                  })}
                  <span
                    className="layer-playhead"
                    style={{ left: `${playheadPercent(player.time, player.duration)}%` }}
                  />
                </div>
                <span className="layer-name">{layer.name}</span>
                <input
                  type="range"
                  className="layer-vol"
                  min={0}
                  max={100}
                  value={Math.round(layer.volume * 100)}
                  aria-label={`${t('layer.volume')} ${layer.name}`}
                  onChange={(event) => {
                    midiPlayer.setLayer(index, { volume: Number(event.target.value) / 100 });
                    midiLibrary.saveMix();
                    setLayers(midiPlayer.getLayers());
                  }}
                />
                <input
                  type="range"
                  className="layer-pan"
                  data-act="pan"
                  min={-100}
                  max={100}
                  value={Math.round(layer.pan * 100)}
                  aria-label={`${t('layer.pan')} ${layer.name}`}
                  title={`${t('layer.pan')}: ${Math.round(layer.pan * 100)}`}
                  onChange={(event) => {
                    midiPlayer.setLayer(index, { pan: Number(event.target.value) / 100 });
                    midiLibrary.saveMix();
                    setLayers(midiPlayer.getLayers());
                  }}
                />
                <button
                  type="button"
                  className={`layer-btn${layer.muted ? ' on' : ''}`}
                  data-act="mute"
                  aria-pressed={layer.muted}
                  aria-label={`${t('layer.mute')} ${layer.name}`}
                  onClick={() => {
                    haptic();
                    midiPlayer.setLayer(index, { muted: !layer.muted });
                    midiLibrary.saveMix();
                    setLayers(midiPlayer.getLayers());
                  }}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`layer-btn${layer.soloed ? ' on' : ''}`}
                  data-act="solo"
                  aria-pressed={layer.soloed}
                  aria-label={`${t('layer.solo')} ${layer.name}`}
                  onClick={() => {
                    haptic();
                    midiPlayer.setLayer(index, { soloed: !layer.soloed });
                    midiLibrary.saveMix();
                    setLayers(midiPlayer.getLayers());
                  }}
                >
                  S
                </button>
              </div>
                ))}
            </div>
          </>
        ) : null}

        {/* Only shown with a note selected: nothing to nudge otherwise. */}
        {editNotes && selectedNote ? (
          <div
            className="layer-edit"
            data-act="note-edit"
            role="group"
            aria-label={t('layer.editHint')}
          >
            <span className="layer-edit-sel" data-act="note-info">
              {t('layer.selected', {
                note: noteName(selectedNote.note),
                start: (selectedNote.start * spb).toFixed(2),
                length: (selectedNote.length * spb).toFixed(2),
              })}
            </span>
            <button
              type="button"
              className="layer-edit-btn"
              data-act="note-earlier"
              aria-label={t('layer.earlier')}
              title={t('layer.earlier')}
              onClick={() => nudgeSelected('start', -1)}
            >
              ◀
            </button>
            <button
              type="button"
              className="layer-edit-btn"
              data-act="note-later"
              aria-label={t('layer.later')}
              title={t('layer.later')}
              onClick={() => nudgeSelected('start', 1)}
            >
              ▶
            </button>
            <button
              type="button"
              className="layer-edit-btn"
              data-act="note-shorter"
              aria-label={t('layer.shorter')}
              title={t('layer.shorter')}
              onClick={() => nudgeSelected('length', -1)}
            >
              −
            </button>
            <button
              type="button"
              className="layer-edit-btn"
              data-act="note-longer"
              aria-label={t('layer.longer')}
              title={t('layer.longer')}
              onClick={() => nudgeSelected('length', 1)}
            >
              +
            </button>
            <button
              type="button"
              className="layer-edit-btn del"
              data-act="note-delete"
              aria-label={t('layer.delete')}
              title={t('layer.delete')}
              onClick={() => {
                rollSession.commit(removeNote(rollSession.getDoc(), selectedNote.id), { sync: true });
                setSelected(null);
                haptic(HAPTIC.medium);
              }}
            >
              ✕
            </button>
          </div>
        ) : null}

        <div className="player-list">
          {groups.map((group) => {
            const items = filtered.filter((tr) => tr.group === group.key);
            if (items.length === 0) return null;
            return (
              <div className="player-group" key={group.key}>
                <div className="player-group-title">{group.label}</div>
                {items.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    className={`player-track${track.id === midiLibrary.getCurrentId() ? ' current' : ''}`}
                    onClick={() => {
                      haptic();
                      if (track.id !== midiLibrary.getCurrentId()) {
                        lastSelect.current = performance.now();
                        midiLibrary.setCurrent(track.id);
                      }
                    }}
                    onDoubleClick={() => {
                      // Double-click on the already-selected track toggles play/pause.
                      if (performance.now() - lastSelect.current < 450) return;
                      haptic();
                      if (midiPlayer.getState().playing) midiPlayer.pause();
                      else midiPlayer.play();
                    }}
                  >
                    <span className="pt-title">
                      {trackTitle(track)}
                      {track.id === midiLibrary.getCurrentId() && player.playing ? (
                        <span className="pt-bars" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null}
                    </span>
                    <span className="pt-meta">
                      {track.composer} · {track.song.notes.length} {t('player.notes')} ·{' '}
                      {fmtTime(track.song.duration)}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <footer className="player-foot">{t('player.copyright')}</footer>
      </aside>
    </>
  );
}

/** Transport controls shared by the player panel and the performance bar. */
export function Transport({
  player,
  rec,
  onRecord,
  compact,
}: {
  player: PlayerState;
  rec: RecorderState;
  onRecord: () => void;
  compact?: boolean;
}) {
  /**
   * The tempo map lives with the song, so the transport reads it from the
   * library and writes it back through the same path a preset edit takes: saved
   * with the track, one undo step, and the player reloaded so the metronome and
   * the readout follow (P5.3).
   */
  const song = midiLibrary.getCurrent()?.song ?? null;
  const tempoMap = tempoMapOf(song);
  const writeTempoMap = (next: TempoSegment[]) => {
    const current = midiLibrary.getCurrent();
    if (!current) return;
    const written = withTempoMap(current.song, next);
    midiLibrary.putSong(written);
    store.mark();
    const state = midiPlayer.getState();
    midiPlayer.load(written, { keepMix: true });
    if (state.time > 0) midiPlayer.seek(Math.min(state.time, midiPlayer.getState().duration));
    if (state.playing) midiPlayer.play();
  };
  const editSegment = (index: number, patch: Partial<TempoSegment>) => {
    writeTempoMap(tempoMap.map((segment, i) => (i === index ? { ...segment, ...patch } : segment)));
  };
  return (
    <div className={`player-transport${compact ? ' compact' : ''}`}>
      <button
        type="button"
        className={`player-play${player.playing ? ' on' : ''}`}
        onClick={() => {
          haptic();
          if (player.playing) midiPlayer.pause();
          else midiPlayer.play();
        }}
        aria-label={player.playing ? t('player.pause') : t('player.play')}
      >
        <TransportIcon name={player.playing ? 'pause' : 'play'} />
      </button>
      <button type="button" className="player-btn" onClick={() => { haptic(); midiPlayer.stop(); }} aria-label={t('player.stop')}>
        <TransportIcon name="stop" />
      </button>
      <button
        type="button"
        className={`player-btn${player.loop ? ' on' : ''}`}
        onClick={() => { haptic(); midiPlayer.setLoop(!player.loop); }}
        aria-label={t('player.loop')}
        aria-pressed={player.loop}
      >
        <TransportIcon name="loop" />
      </button>
      <button
        type="button"
        className={`player-btn${rec.recording ? ' rec' : ''}`}
        onClick={onRecord}
        aria-label={rec.recording ? t('player.stopRec') : t('player.record')}
      >
        <TransportIcon name={rec.recording ? 'stop' : 'record'} />
      </button>
      <label className="player-quantise" title={t('player.quantiseHint')}>
        <span>{t('player.quantise')}</span>
        <select
          value={store.getSnapshot().layout.recordQuantise}
          onChange={(event) => {
            haptic();
            store.setRecordQuantise(event.target.value);
          }}
        >
          {QUANTISE_GRIDS.map((grid) => (
            <option key={grid.id} value={grid.id}>
              {quantiseLabel(grid.id, getLang())}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={`player-btn${player.metronome ? ' on' : ''}`}
        onClick={() => { haptic(); midiPlayer.setMetronome(!player.metronome); }}
        aria-label={t('player.metronome')}
        aria-pressed={player.metronome}
      >
        <TransportIcon name="metronome" />
      </button>
      {/* Tempo map: where the tempo and the signature change (P5.3). The edits
          are written with the song, so a reload keeps them. Only in the full
          transport: on a phone this row is the compact strip above the modules,
          and a detail editor there would push the whole view down. */}
      {!compact ? (
      <span className="tempo-map" data-act="tempo-map" title={t('player.tempoMapHint')}>
        {tempoMap.map((segment, index) => (
          <span className="tempo-seg" key={index}>
            <input
              type="number"
              className="tempo-bpm"
              min={20}
              max={300}
              value={segment.bpm}
              data-act={`tempo-bpm-${index}`}
              aria-label={`${t('player.tempoBpm')} ${index + 1}`}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 20 && value <= 300) editSegment(index, { bpm: value });
              }}
            />
            <select
              className="tempo-bar"
              value={segment.beatsPerBar}
              data-act={`tempo-bar-${index}`}
              aria-label={`${t('player.tempoBar')} ${index + 1}`}
              onChange={(event) => editSegment(index, { beatsPerBar: Number(event.target.value) })}
            >
              {[2, 3, 4, 5, 6, 7].map((beats) => (
                <option key={beats} value={beats}>
                  {beats}/4
                </option>
              ))}
            </select>
            {Number.isFinite(segment.beats) ? (
              <span className="tempo-bars">{Math.round(segment.beats / segment.beatsPerBar)}</span>
            ) : null}
          </span>
        ))}
        <button
          type="button"
          className="player-btn"
          data-act="tempo-add"
          title={t('player.tempoAdd')}
          aria-label={t('player.tempoAdd')}
          onClick={() => {
            haptic();
            // A new section starts where the last one ends, two bars long, at
            // the same tempo: something to then edit, not a surprise.
            const last = tempoMap[tempoMap.length - 1];
            const beats = last.beatsPerBar * 2;
            const next = tempoMap.map((segment, index) =>
              index === tempoMap.length - 1 ? { ...segment, beats } : segment,
            );
            writeTempoMap([...next, { bpm: last.bpm, beats: Number.POSITIVE_INFINITY, beatsPerBar: last.beatsPerBar }]);
          }}
        >
          +
        </button>
        {tempoMap.length > 1 ? (
          <button
            type="button"
            className="player-btn"
            data-act="tempo-remove"
            title={t('player.tempoRemove')}
            aria-label={t('player.tempoRemove')}
            onClick={() => {
              haptic();
              writeTempoMap(tempoMap.slice(0, -1));
            }}
          >
            −
          </button>
        ) : null}
      </span>
      ) : null}
      {!compact && player.metronome ? (
        <button
          type="button"
          className={`player-btn ab${player.countIn ? ' on' : ''}`}
          onClick={() => { haptic(); midiPlayer.setCountIn(!player.countIn); }}
          aria-label={t('player.countIn')}
          aria-pressed={player.countIn}
          title={t('player.countIn')}
        >
          1·2
        </button>
      ) : null}
      {!compact ? (
        <>
          <button
            type="button"
            className={`player-btn ab${player.loopStart != null ? ' on' : ''}`}
            onClick={() => { haptic(); midiPlayer.setLoopRegion(player.time, player.loopEnd); }}
            aria-label={t('player.setA')}
            title={t('player.setA')}
          >
            A
          </button>
          <button
            type="button"
            className={`player-btn ab${player.loopEnd != null ? ' on' : ''}`}
            onClick={() => { haptic(); midiPlayer.setLoopRegion(player.loopStart, player.time); }}
            aria-label={t('player.setB')}
            title={t('player.setB')}
          >
            B
          </button>
          <button
            type="button"
            className={`player-btn ab${player.loopStart != null && player.loopEnd != null ? ' on' : ''}`}
            onClick={() => { haptic(); midiPlayer.setLoopRegion(null, null); }}
            aria-label={t('player.clearAB')}
            title={t('player.clearAB')}
          >
            AB
          </button>
        </>
      ) : null}
      <input
        className="player-seek"
        type="range"
        min={0}
        max={Math.max(0.1, player.duration)}
        step={0.01}
        value={Math.min(player.time, player.duration)}
        style={
          {
            ['--lo' as string]: `${((player.loopStart ?? 0) / Math.max(0.1, player.duration)) * 100}%`,
            ['--hi' as string]: `${((player.loopEnd ?? player.duration) / Math.max(0.1, player.duration)) * 100}%`,
          } as React.CSSProperties
        }
        onChange={(event) => midiPlayer.seek(Number(event.target.value))}
        aria-label={t('player.seek')}
      />
      <span className="player-time" data-act="bar-beat">
        {rec.recording
          ? `${rec.elapsed.toFixed(1)}s`
          : `${fmtTime(player.time)} / ${fmtTime(player.duration)} · ${barLabelOf(midiPlayer.getTempoMap(), player.time)}`}
      </span>
    </div>
  );
}
