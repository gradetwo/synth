/**
 * MIDI / MP3 export helpers.
 *
 * Lives outside the player panel so the piano roll and any future surface can
 * export without importing the panel component (and its React tree).
 */

import { store } from '@/state/store';
import { downloadBlob } from '@/state/share';
import { renderPatchToBuffer, normalizePeak } from '@/audio/render';
import { encodeMp3 } from '@/audio/mp3';
import { writeMidi, type MidiSong } from './smf';

/** Target peak for rendered exports: -1 dBFS, the usual streaming headroom. */
const EXPORT_CEILING = 0.891;

/**
 * MP3 bitrate. 192 kbps is the streaming default, but the export is a synth
 * patch with sharp attacks, where a little extra headroom in the encoder keeps
 * pre-echo away; the file is still a few MB.
 */
const EXPORT_KBPS = 256;

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
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  normalizePeak(channels, EXPORT_CEILING);
  const blob = await encodeMp3(buffer, EXPORT_KBPS);
  downloadBlob(`${safeName(name)}.mp3`, blob);
}
