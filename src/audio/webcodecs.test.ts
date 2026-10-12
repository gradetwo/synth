import { describe, expect, it } from 'vitest';
import {
  computeOggCrc,
  isWebCodecsAudioSupported,
  makeAdtsHeader,
  makeOggPage,
  makeOpusHead,
  makeOpusTags,
} from './webcodecs';

describe('WebCodecs ADTS & Ogg Containers', () => {
  it('generates a valid ADTS 7-byte header for AAC-LC', () => {
    const header = makeAdtsHeader(1024, 48000, 2);
    expect(header.length).toBe(7);
    // Syncword
    expect(header[0]).toBe(0xff);
    expect(header[1] & 0xf0).toBe(0xf0);
    // Layer 00 + no CRC
    expect(header[1] & 0x0f).toBe(0x01);
    // AAC-LC profile is 01 -> (1 << 6)
    expect(header[2] & 0xc0).toBe(0x40);
    // Sample rate index for 48000 is 3 -> (3 << 2) = 12 = 0x0c
    expect(header[2] & 0x3c).toBe(0x0c);
  });

  it('generates a valid OpusHead identification header', () => {
    const head = makeOpusHead(2, 48000);
    expect(head.length).toBe(19);
    const magic = String.fromCharCode(...head.subarray(0, 8));
    expect(magic).toBe('OpusHead');
    expect(head[8]).toBe(1); // Version 1
    expect(head[9]).toBe(2); // 2 channels
  });

  it('generates a valid OpusTags comment header', () => {
    const tags = makeOpusTags('TestVendor');
    const magic = String.fromCharCode(...tags.subarray(0, 8));
    expect(magic).toBe('OpusTags');
    const view = new DataView(tags.buffer);
    const vendorLen = view.getUint32(8, true);
    expect(vendorLen).toBe('TestVendor'.length);
  });

  it('computes valid Ogg CRC and creates standard Ogg page', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const page = makeOggPage(0x02, 0n, 12345, 0, [payload]);
    // Magic "OggS"
    const magic = String.fromCharCode(...page.subarray(0, 4));
    expect(magic).toBe('OggS');
    expect(page[4]).toBe(0); // Version
    expect(page[5]).toBe(0x02); // Header type (BOS)
    // CRC is at offset 22
    const view = new DataView(page.buffer);
    const crc = view.getUint32(22, true);
    // Verify that running computeOggCrc on page with zeroed CRC matches the written CRC
    view.setUint32(22, 0, true);
    expect(computeOggCrc(page)).toBe(crc);
  });

  it('gracefully handles absence of AudioEncoder in Node test environment', async () => {
    const supported = await isWebCodecsAudioSupported('opus');
    expect(typeof supported).toBe('boolean');
  });
});
