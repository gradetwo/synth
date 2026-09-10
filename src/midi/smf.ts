/**
 * Standard MIDI File (SMF) reader and writer.
 *
 * Only what a performance player needs: note on/off, tempo meta events and
 * track names. Format 0 and 1 are merged into a single flat note list in
 * seconds, so the player never has to think about ticks, channels or tracks.
 */

export interface MidiNote {
  /** MIDI note number, 0–127. */
  note: number;
  /** Normalised velocity, 0–1. */
  velocity: number;
  /** Start time in seconds. */
  start: number;
  /** Length in seconds. */
  duration: number;
}

export interface MidiSong {
  name: string;
  /** Beats per minute derived from the first tempo event. */
  bpm: number;
  /** Total length in seconds. */
  duration: number;
  /** Every note, in time order — what the piano roll edits. */
  notes: MidiNote[];
  /**
   * The same notes split by file track, in file order. A format-1 file keeps its
   * layers here; a format-0 file (or a demo song) has exactly one. Optional so
   * hand-built songs (a recording, a demo, a test fixture) stay valid.
   */
  tracks?: MidiTrack[];
}

/** The layers of a song, with the single-layer fallback for hand-built songs. */
export function songTracks(song: MidiSong): MidiTrack[] {
  return song.tracks && song.tracks.length ? song.tracks : [{ name: 'Track 1', notes: song.notes }];
}

const DEFAULT_TEMPO = 500_000; // 120 BPM in µs per quarter note

class Reader {
  private view: DataView;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }

  ascii(len: number): string {
    let out = '';
    for (let i = 0; i < len; i++) out += String.fromCharCode(this.u8());
    return out;
  }

  /** Variable-length quantity (7 bits per byte, high bit = continue). */
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value >>> 0;
  }

  skip(len: number): void {
    this.offset += len;
  }
}

interface RawNote {
  tick: number;
  note: number;
  velocity: number;
  on: boolean;
  /** Which MTrk chunk it came from, so a format-1 file keeps its layers. */
  track: number;
}

/** One track of a multi-track file, as it will be played or exported. */
export interface MidiTrack {
  name: string;
  notes: MidiNote[];
}

interface TempoEvent {
  tick: number;
  usPerQuarter: number;
}

/** Convert a tick position to seconds given a sorted tempo map. */
function makeTickClock(tempos: TempoEvent[], division: number) {
  const map = [...tempos].sort((a, b) => a.tick - b.tick);
  if (map.length === 0 || map[0].tick > 0) map.unshift({ tick: 0, usPerQuarter: DEFAULT_TEMPO });
  const cumulative: number[] = [0];
  for (let i = 1; i < map.length; i++) {
    const dt = map[i].tick - map[i - 1].tick;
    cumulative[i] = cumulative[i - 1] + (dt * map[i - 1].usPerQuarter) / (division * 1_000_000);
  }
  return (tick: number): number => {
    let i = map.length - 1;
    while (i > 0 && map[i].tick > tick) i--;
    const dt = tick - map[i].tick;
    return cumulative[i] + (dt * map[i].usPerQuarter) / (division * 1_000_000);
  };
}

export function parseMidi(bytes: Uint8Array, name = 'MIDI'): MidiSong {
  const reader = new Reader(bytes);
  if (reader.remaining < 14 || reader.ascii(4) !== 'MThd') throw new Error('not a MIDI file');
  const headerLength = reader.u32();
  reader.u16(); // format (0/1 merged, 2 treated the same)
  const trackCount = reader.u16();
  const division = reader.u16();
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  reader.skip(Math.max(0, headerLength - 6));

  const rawNotes: RawNote[] = [];
  const tempos: TempoEvent[] = [];
  const trackNames: string[] = [];
  let title = '';

  for (let track = 0; track < trackCount && reader.remaining >= 8; track++) {
    if (reader.ascii(4) !== 'MTrk') break;
    const length = reader.u32();
    const end = reader.offset + length;
    let tick = 0;
    let running = 0;

    while (reader.offset < end && reader.remaining > 0) {
      tick += reader.vlq();
      let status = reader.u8();
      if (status < 0x80) {
        // Running status: reuse the previous status byte.
        reader.offset -= 1;
        status = running;
      } else {
        running = status;
      }

      if (status === 0xff) {
        const type = reader.u8();
        const size = reader.vlq();
        if (type === 0x51 && size === 3) {
          tempos.push({ tick, usPerQuarter: (reader.u8() << 16) | (reader.u8() << 8) | reader.u8() });
        } else if (type === 0x03) {
          // A track name is a layer name; the file title is the first one.
          const text = reader.ascii(size).trim();
          if (!title) title = text;
          if (!trackNames[track]) trackNames[track] = text;
        } else if (type === 0x2f) {
          reader.skip(size);
          break;
        } else {
          reader.skip(size);
        }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        reader.skip(reader.vlq());
        continue;
      }

      const kind = status & 0xf0;
      if (kind === 0x90 || kind === 0x80) {
        const note = reader.u8();
        const velocity = reader.u8();
        const on = kind === 0x90 && velocity > 0;
        rawNotes.push({ tick, note, velocity: velocity / 127, on, track });
      } else if (kind === 0xc0 || kind === 0xd0) {
        reader.u8();
      } else {
        reader.u8();
        reader.u8();
      }
    }
    reader.offset = end;
  }

  const toSeconds = makeTickClock(tempos, division || 480);
  const open = new Map<number, { start: number; velocity: number }>();
  const notes: MidiNote[] = [];
  const layered: MidiNote[][] = Array.from({ length: Math.max(1, trackCount) }, () => []);
  let duration = 0;

  for (const raw of rawNotes) {
    const time = toSeconds(raw.tick);
    if (raw.on) {
      open.set(raw.note, { start: time, velocity: raw.velocity });
    } else {
      const held = open.get(raw.note);
      if (!held) continue;
      open.delete(raw.note);
      const length = Math.max(0.02, time - held.start);
      const played = { note: raw.note, velocity: held.velocity, start: held.start, duration: length };
      notes.push(played);
      (layered[raw.track] ??= []).push(played);
      duration = Math.max(duration, held.start + length);
    }
  }
  for (const [note, held] of open) {
    const played = { note, velocity: held.velocity, start: held.start, duration: 0.5 };
    notes.push(played);
    // The leftover note has no track tag beyond the map it came from; it lands
    // in the first layer, which is where a single-track file belongs anyway.
    layered[0].push(played);
    duration = Math.max(duration, held.start + 0.5);
  }

  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  const firstTempo = tempos.find((t) => t.tick === 0)?.usPerQuarter ?? DEFAULT_TEMPO;
  // Layers, in file order, without the empty ones (a format-1 file usually has
  // a conductor track that holds only tempo and names).
  const tracks: MidiTrack[] = layered
    .map((list, index) => ({ name: trackNames[index] ?? '', notes: list }))
    .filter((layer) => layer.notes.length > 0)
    .map((layer, index) => ({ name: layer.name || `Track ${index + 1}`, notes: layer.notes }));

  return {
    name: title || name,
    bpm: Math.round(60_000_000 / firstTempo),
    duration: Math.max(duration, 0.5),
    notes,
    tracks: tracks.length ? tracks : [{ name: 'Track 1', notes }],
  };
}

function writeVlq(value: number): number[] {
  const out = [value & 0x7f];
  value >>>= 7;
  while (value > 0) {
    out.unshift((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  return out;
}

/** Encode a flat note list as a format-0 SMF. */
export function writeMidi(
  notes: MidiNote[],
  options: { bpm?: number; division?: number; name?: string } = {},
): Uint8Array {
  const bpm = Math.max(20, Math.min(300, options.bpm ?? 120));
  const division = options.division ?? 480;
  const usPerQuarter = Math.round(60_000_000 / bpm);
  const tickOf = (seconds: number) => Math.max(0, Math.round((seconds * division * bpm) / 60));

  const events: { tick: number; order: number; bytes: number[] }[] = [];
  for (const n of notes) {
    const note = Math.max(0, Math.min(127, Math.round(n.note)));
    const velocity = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    const start = tickOf(n.start);
    const end = Math.max(start + 1, tickOf(n.start + n.duration));
    events.push({ tick: start, order: 0, bytes: [0x90, note, velocity] });
    events.push({ tick: end, order: 1, bytes: [0x80, note, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  // Tempo meta.
  track.push(0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  if (options.name) {
    const text = [...options.name].slice(0, 60).map((c) => c.charCodeAt(0) & 0x7f);
    track.push(0x00, 0xff, 0x03, ...writeVlq(text.length), ...text);
  }
  let last = 0;
  for (const event of events) {
    track.push(...writeVlq(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const out: number[] = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    (0 >> 8) & 0xff, 0 & 0xff, // format 0
    (1 >> 8) & 0xff, 1 & 0xff, // one track
    (division >> 8) & 0xff, division & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
  return new Uint8Array(out);
}

/** Total length of a note list in seconds. */
export function notesDuration(notes: MidiNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.duration);
  return end;
}
