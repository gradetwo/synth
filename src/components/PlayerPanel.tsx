import { useEffect, useMemo, useRef, useState } from 'react';
import { getLang, t } from '@/i18n';
import { toast } from './Toast';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { midiPlayer, type PlayerState } from '@/midi/player';
import { recorder, type RecorderState } from '@/midi/recorder';
import { parseMidi, songTracks } from '@/midi/smf';
import { layoutNotes, playheadPercent } from '@/midi/timeline';
import { midiLibrary, trackTitle, type TrackGroup } from '@/midi/library';
import { store } from '@/state/store';
import { exportSongMidi, exportSongMp3, exportSongWav } from '@/midi/export';
import { QUANTISE_GRIDS, quantiseLabel, quantiseNotes, type QuantiseGrid } from '@/midi/quantise';
import { TransportIcon } from './TransportIcon';

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
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
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
  // Note geometry per layer, recomputed only when the song changes.
  const maps = useMemo(() => {
    const song = current?.song ?? null;
    if (!song) return [];
    return songTracks(song).map((track) => layoutNotes(track.notes, song.duration));
  }, [current]);

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

        {/* Multi-track songs get a strip: one row per layer with its own mute
            and solo, so a two-track file can be auditioned part by part. */}
        {layers.length > 1 ? (
          <div className="layer-strip" data-layers={layers.length}>
            {layers.map((layer, index) => (
              <div className="layer-row" key={`${layer.name}-${index}`} data-layer={index}>
                {/* The layer's notes as a bar: the arrangement at a glance. */}
                <div className="layer-map" data-act="map" aria-hidden="true">
                  {(maps[index] ?? []).map((block, blockIndex) => (
                    <span
                      key={blockIndex}
                      className="layer-note"
                      style={{ left: `${block.left}%`, width: `${block.width}%` }}
                    />
                  ))}
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
      <span className="player-time">
        {rec.recording ? `${rec.elapsed.toFixed(1)}s` : `${fmtTime(player.time)} / ${fmtTime(player.duration)}`}
      </span>
    </div>
  );
}
