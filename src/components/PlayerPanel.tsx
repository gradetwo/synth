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
import { store } from '@/state/store';
import { exportSongMidi, exportSongMp3, exportSongWav } from '@/midi/export';
import { QUANTISE_GRIDS, quantiseLabel, quantiseNotes, type QuantiseGrid } from '@/midi/quantise';
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

  // An edit to a built-in demo becomes a copy; say so once, because the track
  // list switching under the user's finger is otherwise a mystery.
  useEffect(() => {
    if (!roll.justCopied) return;
    toast(t('layer.copied', { name: roll.copiedName }));
    rollSession.acknowledgeCopy();
  }, [roll.justCopied, roll.copiedName]);

  // Keyboard transport while the panel is open: Space toggles, Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === 'Escape') {
        onClose();
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
      if (clip) {
        // Quantising is a per-recording decision, applied as the take is saved.
        const grid = store.getSnapshot().layout.recordQuantise as QuantiseGrid;
        const quantised = grid === 'off' ? clip : { ...clip, notes: quantiseNotes(clip.notes, grid, clip.bpm) };
        midiLibrary.put({
          id: 'clip',
          title: [t('player.recordingName'), t('player.recordingName')],
          composer: t('player.recordedBy'),
          song: quantised,
          group: 'clip',
        })
      store.mark();
        toast(
          t(grid === 'off' ? 'player.clipSaved' : 'player.clipSavedQuantised', {
            n: String(quantised.notes.length),
            grid: quantiseLabel(grid, getLang()),
          }),
        );
      }
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
                          rollSession.setClip(clip.id);
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
