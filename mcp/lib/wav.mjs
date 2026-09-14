/**
 * WAV bytes, via the app's own writer and reader.
 *
 * `encodeWavBuffer`/`parseWav` come from `src/audio/render.ts` and
 * `src/audio/wavefile.ts` (bundled in `data.mjs`), so a file this server
 * produces is the same file the download button produces, and a file it reads
 * is read by the same parser the importer uses. No second WAV format lives in
 * `mcp/`.
 */
import { createHash } from 'node:crypto';

/** Encode two float channels as a 16-bit PCM WAV, exactly as the export path does. */
export function encodeWavPair(data, left, right, sampleRate) {
  const source = {
    numberOfChannels: 2,
    length: left.length,
    sampleRate,
    getChannelData: (channel) => (channel === 0 ? left : right),
  };
  const buffer = data.encodeWavBuffer(source);
  return Buffer.from(buffer);
}

/** `parseWav` over a Node Buffer; `null` when the bytes are not RIFF/WAVE PCM. */
export function decodeWavBytes(data, buffer) {
  // `parseWav` wants a standalone ArrayBuffer: a Buffer is a view into a
  // possibly larger pool, so copy the exact range before handing it over.
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return data.parseWav(bytes);
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
