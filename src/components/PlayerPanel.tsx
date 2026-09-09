import { useEffect, useMemo, useRef, useState } from 'react';
import { store } from '@/state/store';
import { t } from '@/i18n';
import { toast } from './Toast';
import { downloadBlob } from '@/state/share';
import { haptic, HAPTIC } from '@/hooks/useInputMode';
import { renderPatchToBuffer } from '@/audio/render';
import { encodeMp3 } from '@/audio/mp3';
import { midiPlayer, type PlayerState } from '@/midi/player';
import { recorder, type RecorderState } from '@/midi/recorder';
import { parseMidi, writeMidi, type MidiSong } from '@/midi/smf';
import { midiLibrary, trackTitle, type TrackGroup } from '@/midi/library';

const fmtTime = (s: number) => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const safeName = (s: string) => s.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48) || 'gs1';

export function exportSongMidi(song: MidiSong, name: string): void {
  const bytes = writeMidi(song.notes, { bpm: song.bpm, name });
  downloadBlob(`${safeName(name)}.mid`, new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }));
}

export async function exportSongMp3(song: MidiSong, name: string): Promise<void> {
  const notes = song.notes.map(
    (n) => [n.note, n.start, n.duration, n.velocity] as [number, number, number, number],
  );
  const buffer = await renderPatchToBuffer(store.getSnapshot().state, {
    notes,
    seconds: song.duration + 1.6,
  });
  const blob = await encodeMp3(buffer);
  downloadBlob(`${safeName(name)}.mp3`, blob);
}

/** Transport + playlist modal, replacing the old DEMO button. */
export function PlayerPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, bump] = useState(0);
  const [player, setPlayer] = useState<PlayerState>(midiPlayer.getState());
  const [rec, setRec] = useState<RecorderState>(recorder.getState());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Timestamp of the last track *change*, so a double-click on a new track does
  // not immediately pause the playback it just started.
  const lastSelect = useRef(0);

  useEffect(() => midiLibrary.subscribe(() => bump((v) => v + 1)), []);
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
      });
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
        midiLibrary.put({
          id: 'clip',
          title: [t('player.recordingName'), t('player.recordingName')],
          composer: t('player.recordedBy'),
          song: clip,
          group: 'clip',
        });
        toast(t('player.clipSaved', { n: clip.notes.length }));
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
            className="player-btn wide primary"
            disabled={!current || busy}
            onClick={async () => {
              if (!current) return;
              setBusy(true);
              try {
                await exportSongMp3(current.song, trackTitle(current));
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

/** Stroke-based icons matching the rest of the chrome (no font glyphs). */
function TransportIcon({ name }: { name: 'play' | 'pause' | 'stop' | 'loop' | 'record' }) {
  const stroke = {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const filled = { ...stroke, fill: 'currentColor', stroke: 'none' };
  switch (name) {
    case 'play':
      return (
        <svg {...filled}>
          <path d="M8 5.4v13.2L19 12z" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...filled}>
          <rect x="7" y="5" width="3.6" height="14" rx="1.4" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.4" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...filled}>
          <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.2" />
        </svg>
      );
    case 'record':
      return (
        <svg {...filled}>
          <circle cx="12" cy="12" r="5.8" />
        </svg>
      );
    case 'loop':
      return (
        <svg {...stroke}>
          <polyline points="17 2 21 6 17 10" />
          <path d="M3 12v-1a4 4 0 0 1 4-4h14" />
          <polyline points="7 22 3 18 7 14" />
          <path d="M21 12v1a4 4 0 0 1-4 4H3" />
        </svg>
      );
  }
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
      <input
        className="player-seek"
        type="range"
        min={0}
        max={Math.max(0.1, player.duration)}
        step={0.01}
        value={Math.min(player.time, player.duration)}
        onChange={(event) => midiPlayer.seek(Number(event.target.value))}
        aria-label={t('player.seek')}
      />
      <span className="player-time">
        {rec.recording ? `${rec.elapsed.toFixed(1)}s` : `${fmtTime(player.time)} / ${fmtTime(player.duration)}`}
      </span>
    </div>
  );
}
