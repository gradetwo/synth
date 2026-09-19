/**
 * MP3 encoding.
 *
 * `lamejs` is imported lazily so the encoder (~90 KB) never lands in the main
 * bundle; it is only fetched when the user actually exports an MP3.
 */

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export async function encodeMp3(buffer: AudioBuffer, kbps = 192): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);
  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;

  const parts: ArrayBuffer[] = [];
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const r = right ? right.subarray(i, i + block) : undefined;
    const chunk = encoder.encodeBuffer(l, r);
    if (chunk.length > 0) parts.push(chunk.buffer as ArrayBuffer);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail.buffer as ArrayBuffer);
  return new Blob(parts, { type: 'audio/mpeg' });
}
