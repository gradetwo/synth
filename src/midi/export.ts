/**
 * MIDI / MP3 export helpers.
 *
 * Lives outside the player panel so the piano roll and any future surface can
 * export without importing the panel component (and its React tree).
 */

import { store } from '@/state/store';
import { downloadBlob } from '@/state/share';
import { encodeWav, renderPatchToBuffer, normalizePeak } from '@/audio/render';
import { encodeMp3 } from '@/audio/mp3';
import { writeMidi, type MidiSong } from './smf';

/** Target peak for rendered exports: -1 dBFS, the usual streaming headroom. */
const EXPORT_CEILING = 0.891;

/**
 * MP3 bitrate: the top of MPEG-1 Layer III. The encoder is a pure-JS build of
 * LAME, and synth patches with percussive attacks and long decays are exactly
 * where its noise floor shows; 320 kbps buys a few dB over 256.
 */
const EXPORT_KBPS = 320;

const safeName = (s: string) => s.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48) || 'gs1';

export function exportSongMidi(song: MidiSong, name: string): void {
  const bytes = writeMidi(song.notes, { bpm: song.bpm, name });
  downloadBlob(`${safeName(name)}.mid`, new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }));
}

/** Lossless export: the render as 16-bit WAV, with no encoder in between. */
export async function exportSongWav(song: MidiSong, name: string): Promise<void> {
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
  downloadBlob(`${safeName(name)}.wav`, encodeWav(buffer));
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
