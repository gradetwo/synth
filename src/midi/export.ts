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
import { mixedNotes, mixedTracks, midiPlayer } from './player';
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
  // The export is the mix, not the raw file: muted layers are gone, levels are
  // baked into velocities, nudged layers keep their timing and pan goes out as
  // CC10 — so what a DAW imports is what the player sounds like.
  const tracks = mixedTracks(song, midiPlayer.getLayers());
  // Layers go out as separate tracks (format 1); after the mix, a single layer
  // left audible stays format 0 exactly as before — with the mix applied, not
  // the raw file, so a muted layer does not reappear in the export.
  const flat = tracks
    .flatMap((track) => track.notes)
    .sort((a, b) => a.start - b.start || a.note - b.note);
  const bytes = writeMidi(flat, {
    bpm: song.bpm,
    name,
    tracks: tracks.length > 1 ? tracks : undefined,
    pan: tracks.length === 1 ? tracks[0].pan : undefined,
  });
  downloadBlob(`${safeName(name)}.mid`, new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }));
}

/** Lossless export: the render as 16-bit WAV, with no encoder in between. */
export async function exportSongWav(song: MidiSong, name: string): Promise<void> {
  // The render applies the layer mix (mute/solo/level/pan/offset), so an
  // exported file is the arrangement you hear rather than the raw file.
  const notes = mixedNotes(song, midiPlayer.getLayers());
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
  const notes = mixedNotes(song, midiPlayer.getLayers());
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

/**
 * Fast, hardware-accelerated compressed export via WebCodecs (Opus/AAC) with transparent
 * fallback to pure-JS LAME MP3.
 *
 * `preferMp3` skips the WebCodecs probe and always runs the LAME path. The
 * "导出 MP3" button uses it: Chromium's Media Foundation Opus encoder is a
 * software encoder whose output for this content measured ~50 KB for a render
 * that is ~1 MB as MP3 — so small that the e2e byte floor failed — and the
 * browser then renames a `.mp3`-named download to `.opus` from the sniffed
 * container type. Safari/Firefox have no MP3 encoder at all, so those builds
 * leave the flag off and keep the fast native Opus/AAC path.
 */
export async function exportSongCompressed(
  song: MidiSong,
  name: string,
  opts: { preferMp3?: boolean } = {},
): Promise<{ codec: 'opus' | 'aac' | 'mp3'; ext: string }> {
  const notes = mixedNotes(song, midiPlayer.getLayers());
  const buffer = await renderPatchToBuffer(store.getSnapshot().state, {
    notes,
    seconds: song.duration + 1.6,
  });
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  normalizePeak(channels, EXPORT_CEILING);

  const { encodeCompressedAudio } = await import('@/audio/webcodecs');
  let result: Awaited<ReturnType<typeof encodeCompressedAudio>>;
  if (opts.preferMp3) {
    // The one place that promises an actual MP3 file: the LAME encoder, no
    // WebCodecs probe. Kept out of `encodeCompressedAudio` so its fallback
    // chain stays honest — a probe failure there is still "no WebCodecs".
    const { encodeMp3 } = await import('@/audio/mp3');
    const blob = await encodeMp3(buffer, EXPORT_KBPS);
    result = { blob, codec: 'mp3' as const, ext: 'mp3', bitrateKbps: EXPORT_KBPS };
  } else {
    result = await encodeCompressedAudio(buffer, { bitrateKbps: EXPORT_KBPS });
  }
  downloadBlob(`${safeName(name)}.${result.ext}`, result.blob);
  return { codec: result.codec, ext: result.ext };
}
