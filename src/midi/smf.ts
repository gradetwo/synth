/**
 * Standard MIDI File (SMF) reader and writer.
 *
 * Only what a performance player needs: note on/off, tempo meta events and
 * track names. Format 0 and 1 are merged into a single flat note list in
 * seconds, so the player never has to think about ticks, channels or tracks.
 */

import type { MidiClip } from './clips';
import { defaultMap, secondsToBeats, type TempoSegment } from './tempo';

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
  /**
   * Where the tempo and the time signature change (P5.3). Optional: a song with
   * one tempo just has `bpm`, and `tempoMapOf` builds the one-segment map.
   */
  tempoMap?: import('./tempo').TempoSegment[];
  /** Beats per bar of the first segment, for plain readers. */
  beatsPerBar?: number;
  /**
   * The arrangement, when the song has one (P5.2): clips placed and repeated on
   * the timeline. `notes` above is always their expansion, so the player, the
   * exports and the piano roll keep reading one flat list. Optional: a song
   * without clips is a song that is played as written.
   */
  clips?: MidiClip[];
  /**
   * Recorded takes of the layers (P5.4), oldest first. The selected one
   * (`takeId`) is what its layer plays, so `notes` above is again only the
   * expansion and everything downstream keeps reading one flat list. Optional:
   * a song without takes is a song that is played as written.
   */
  takes?: import('./takes').MidiTake[];
  /** Which take is selected, when the song has takes. */
  takeId?: string;
}

/** The layers of a song, with the single-layer fallback for hand-built songs. */
export function songTracks(song: MidiSong): MidiTrack[] {
  return song.tracks && song.tracks.length ? song.tracks : [{ name: 'Track 1', notes: song.notes }];
}

/**
 * Validate a stored note list: junk entries and non-finite values are dropped,
 * the rest is clamped to what the player can schedule.
 *
 * Both user-data readers share it — arrangement clips (P5.2) and recorded takes
 * (P5.4) are the same shape of untrusted JSON — so there is one rule about what
 * a stored note is. `tidy` rounds start and length to the 1/10000 s grid the
 * rest of the model stores.
 */
export function normalizeStoredNotes(raw: unknown, tidy = false): MidiNote[] {
  if (!Array.isArray(raw)) return [];
  const round = tidy ? (v: number) => Math.round(v * 10000) / 10000 : (v: number) => v;
  const out: MidiNote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const note = entry as Partial<MidiNote>;
    if (
      !Number.isFinite(note.note) ||
      !Number.isFinite(note.start) ||
      !Number.isFinite(note.duration) ||
      !Number.isFinite(note.velocity)
    ) {
      continue;
    }
    out.push({
      note: Math.max(0, Math.min(127, Math.round(note.note as number))),
      velocity: Math.max(0.05, Math.min(1, note.velocity as number)),
      start: Math.max(0, round(note.start as number)),
      duration: Math.max(0.01, round(note.duration as number)),
    });
  }
  return out;
}

/**
 * The notes of one layer, in seconds.
 *
 * It lives next to `songTracks` because both are the "what does this song
 * actually contain" half of the format, and because the piano roll, the
 * recorded takes and the exporter all need the same answer: a song without an
 * explicit track list has exactly one layer, which is its flat note list.
 */
export function layerNotes(song: MidiSong, layerIndex: number): MidiNote[] {
  return songTracks(song)[layerIndex]?.notes ?? [];
}

const DEFAULT_TEMPO = 500_000; // 120 BPM in µs per quarter note

class Reader {
  private view: DataView;
  private length: number;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.byteLength;
  }

  get remaining(): number {
    return this.length - this.offset;
  }

  /**
   * Every read is total: past the end it returns 0 and stays put instead of
   * throwing. A truncated or lying MIDI file is a file to salvage, and the
   * parser around this reader decides what is playable — a `RangeError` from a
   * byte read would escape as a crash on a file the user simply downloaded.
   */
  u8(): number {
    if (this.offset >= this.length) return 0;
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const v = this.remaining >= 2 ? this.view.getUint16(this.offset) : (this.u8() << 8) | this.u8();
    if (this.remaining >= 2) this.offset += 2;
    return v;
  }

  u32(): number {
    if (this.remaining >= 4) {
      const v = this.view.getUint32(this.offset);
      this.offset += 4;
      return v;
    }
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  ascii(len: number): string {
    const count = Math.max(0, Math.min(len, this.remaining));
    let out = '';
    for (let i = 0; i < count; i++) out += String.fromCharCode(this.view.getUint8(this.offset + i));
    this.offset += count;
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
    // Clamped both ways: a negative or absurd length must not move the cursor
    // outside the file, where the next read would be a different kind of wrong.
    this.offset = Math.max(0, Math.min(this.length, this.offset + len));
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
  /**
   * Stereo position, written as a CC10 at the start of the track so a DAW
   * imports the arrangement with the balance it had here.
   */
  pan?: number;
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

/**
 * Does this buffer begin with a standard MIDI file header?
 *
 * A file's name is a hint, not its format: the export button hands the browser
 * a download, a share sheet can drop the extension, and a temporary path can
 * have no last segment at all. Import therefore asks the bytes — the same four
 * bytes `parseMidi` trusts below — instead of dispatching on `File.name`.
 */
export function looksLikeMidi(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x68 &&
    bytes[3] === 0x64
  );
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
  /** Beats-per-bar changes, keyed by tick (P5.3). */
  const signatures = new Map<number, number>();
  const trackNames: string[] = [];
  let title = '';

  for (let track = 0; track < trackCount && reader.remaining >= 8; track++) {
    if (reader.ascii(4) !== 'MTrk') break;
    const length = reader.u32();
    // A track that claims to be longer than the file ends at the file: the
    // bytes are simply not there.
    const end = Math.min(bytes.byteLength, reader.offset + length);
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
          const usPerQuarter = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8();
          // Zero microseconds per quarter note is not a tempo: keeping it would
          // divide by zero into an infinite BPM. The clock then falls back to
          // the default, exactly as it does for a file with no tempo event.
          if (usPerQuarter > 0) tempos.push({ tick, usPerQuarter });
        } else if (type === 0x58 && size >= 2) {
          // Time signature: numerator, denominator as a power of two, then
          // clocks-per-click and 32nds-per-quarter, which a player does not need.
          const numerator = reader.u8();
          reader.u8();
          if (numerator >= 1 && numerator <= 16) signatures.set(tick, numerator);
          reader.skip(size - 2);
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
        // A data byte is 7 bits by definition; a file that says otherwise is
        // corrupt, and a note number of 200 would follow us into the player.
        const note = Math.min(127, reader.u8());
        const velocity = Math.min(127, reader.u8());
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
  // Sparse on purpose: `trackCount` is a claim in the header, and a 50-byte file
  // is free to claim 65 535 tracks. Allocating a list per claimed track made a
  // corrupt file allocate megabytes; layers are created when a note lands in
  // one, and `map`/`filter` below skip the holes.
  const layered: MidiNote[][] = [];
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
    const played = {
      note: Math.max(0, Math.min(127, note)),
      velocity: held.velocity,
      start: held.start,
      duration: 0.5,
    };
    notes.push(played);
    // The leftover note has no track tag beyond the map it came from; it lands
    // in the first layer, which is where a single-track file belongs anyway.
    (layered[0] ??= []).push(played);
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

  const divisionOrDefault = division || 480;
  const beatsOf = (tick: number): number => tick / divisionOrDefault;
  const tempoMap = buildTempoMap(tempos, signatures, beatsOf);
  const firstSignature = tempoMap.length ? tempoMap[0].beatsPerBar : (signatures.get(0) ?? 4);
  return {
    name: title || name,
    bpm: Math.round(60_000_000 / firstTempo),
    // Only a song that actually changes tempo or signature carries a map; a
    // plain one keeps the flat BPM every reader already understands.
    ...(tempoMap.length ? { tempoMap } : {}),
    beatsPerBar: firstSignature,
    duration: Math.max(duration, 0.5),
    notes,
    tracks: tracks.length ? tracks : [{ name: 'Track 1', notes }],
  };
}

/**
 * Turn the tempo and time-signature events into segments, or an empty list when
 * the song has one tempo and a plain 4/4 signature.
 */
function buildTempoMap(
  tempos: TempoEvent[],
  signatures: Map<number, number>,
  beatsOf: (tick: number) => number,
): TempoSegment[] {
  const changes: { beat: number; bpm?: number; beatsPerBar?: number }[] = [];
  const sortedTempos = [...tempos].sort((a, b) => a.tick - b.tick);
  for (const tempo of sortedTempos) {
    changes.push({ beat: tidyBeats(beatsOf(tempo.tick)), bpm: Math.round(60_000_000 / tempo.usPerQuarter) });
  }
  for (const [tick, numerator] of [...signatures.entries()].sort((a, b) => a[0] - b[0])) {
    changes.push({ beat: tidyBeats(beatsOf(tick)), beatsPerBar: numerator });
  }
  changes.sort((a, b) => a.beat - b.beat);
  if (changes.length === 0) return [];

  const firstBpm = changes.find((change) => change.bpm !== undefined)?.bpm ?? 120;
  const firstBar = changes.find((change) => change.beatsPerBar !== undefined)?.beatsPerBar ?? 4;
  const segments: TempoSegment[] = [];
  let bpm = firstBpm;
  let beatsPerBar = firstBar;
  let start = 0;
  for (const change of changes) {
    if (change.beat > start + 1e-9 && (change.bpm !== undefined || change.beatsPerBar !== undefined)) {
      segments.push({ bpm, beats: tidyBeats(change.beat - start), beatsPerBar });
      start = change.beat;
    }
    if (change.bpm !== undefined) bpm = change.bpm;
    if (change.beatsPerBar !== undefined) beatsPerBar = change.beatsPerBar;
  }
  segments.push({ bpm, beats: Number.POSITIVE_INFINITY, beatsPerBar });
  // One tempo, one signature, nothing before it: not a map, just a song.
  const trivial = segments.length === 1 && segments[0].beatsPerBar === 4 && signatures.size <= 1;
  return trivial ? [] : segments;
}

const tidyBeats = (v: number): number => Math.round(v * 1000) / 1000;

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
  options: {
    bpm?: number;
    division?: number;
    name?: string;
    tracks?: MidiTrack[];
    /** Where the tempo and the signature change (P5.3); one segment otherwise. */
    tempoMap?: TempoSegment[];
    beatsPerBar?: number;
    /** Stereo position for a format-0 file (a layered export carries it per track). */
    pan?: number;
  } = {},
): Uint8Array {
  const bpm = Math.max(20, Math.min(300, options.bpm ?? 120));
  const division = options.division ?? 480;
  const map = options.tempoMap && options.tempoMap.length ? options.tempoMap : defaultMap(bpm, options.beatsPerBar ?? 4);
  // A note's position is musical, so it goes through the map: seconds -> beats
  // -> ticks. With one tempo this is the same arithmetic as before, which is why
  // a plain song exports byte for byte as it always did.
  const tickOf = (seconds: number) => Math.max(0, Math.round(secondsToBeats(map, seconds) * division));
  /** One MTrk body: an optional tempo, an optional name, then the notes. */
  const encodeTrack = (
    list: MidiNote[],
    trackName: string | undefined,
    withTempo: boolean,
    pan?: number,
  ): number[] => {
    const events: { tick: number; order: number; bytes: number[] }[] = [];
    for (const n of list) {
      const note = Math.max(0, Math.min(127, Math.round(n.note)));
      const velocity = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
      const start = tickOf(n.start);
      const endTick = Math.max(start + 1, tickOf(n.start + n.duration));
      events.push({ tick: start, order: 0, bytes: [0x90, note, velocity] });
      events.push({ tick: endTick, order: 1, bytes: [0x80, note, 0] });
    }
    // The tempo map goes into the stream at its own ticks, so a file that changes
    // tempo says so where it does. A song with one tempo and 4/4 emits exactly
    // the single tempo event it always did — the signature only appears when it
    // is not 4/4, which is what keeps every existing export byte for byte the
    // same.
    if (withTempo) {
      const trivial = map.length === 1 && (map[0].beatsPerBar ?? 4) === 4;
      let beat = 0;
      for (const segment of map) {
        const at = Math.max(0, Math.round(beat * division));
        const us = Math.round(60_000_000 / Math.max(20, Math.min(300, segment.bpm)));
        events.push({
          tick: at,
          order: -2,
          bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
        });
        if (!trivial) {
          events.push({
            tick: at,
            order: -1,
            bytes: [0xff, 0x58, 0x04, Math.max(1, Math.round(segment.beatsPerBar)), 0x02, 0x18, 0x08],
          });
        }
        if (!Number.isFinite(segment.beats)) break;
        beat += segment.beats;
      }
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const track: number[] = [];
    if (trackName) {
      const text = [...trackName].slice(0, 60).map((c) => c.charCodeAt(0) & 0x7f);
      track.push(0x00, 0xff, 0x03, ...writeVlq(text.length), ...text);
    }
    // CC10 pan sits at the head of the track: 0 is hard left, 64 centre.
    if (pan !== undefined && Math.abs(pan) > 0.005) {
      const value = Math.max(0, Math.min(127, Math.round(((pan + 1) / 2) * 127)));
      track.push(0x00, 0xb0, 10, value);
    }
    let last = 0;
    for (const event of events) {
      track.push(...writeVlq(event.tick - last), ...event.bytes);
      last = event.tick;
    }
    track.push(0x00, 0xff, 0x2f, 0x00);
    return track;
  };

  const chunk = (body: number[]): number[] => [
    0x4d, 0x54, 0x72, 0x6b,
    (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff,
    ...body,
  ];

  // A multi-layer song exports as format 1: a conductor track carrying tempo and
  // title, then one track per layer — which is what a DAW expects to import as
  // separate tracks rather than one merged blob.
  const layers = options.tracks && options.tracks.length > 1 ? options.tracks : null;
  const bodies = layers
    ? [
        encodeTrack([], options.name, true),
        ...layers.map((layer) => encodeTrack(layer.notes, layer.name, false, layer.pan)),
      ]
    : [encodeTrack(notes, options.name, true, options.pan)];

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    ((layers ? 1 : 0) >> 8) & 0xff, (layers ? 1 : 0) & 0xff, // format 1 when layered, else 0
    (bodies.length >> 8) & 0xff, bodies.length & 0xff,
    (division >> 8) & 0xff, division & 0xff,
  ];
  return new Uint8Array([...header, ...bodies.flatMap(chunk)]);
}

/** Total length of a note list in seconds. */
export function notesDuration(notes: MidiNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.duration);
  return end;
}
