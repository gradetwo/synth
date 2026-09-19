/**
 * Tempo map: where the tempo and the time signature change (P5.3).
 *
 * A song is not one tempo any more than it is one chord. A map is a list of
 * segments, each with a tempo and a time signature, covering a number of beats;
 * everything that has to know where "now" is musically — the metronome, the
 * count-in, the quantise grid, the bar display and the MIDI export — asks this
 * module instead of dividing by one BPM.
 *
 * The segment boundaries live in *beats*, not seconds, because that is what a
 * tempo change is: "the tempo changes after bar 8". Seconds are derived, and the
 * derivation is exact at the boundaries (a beat inside a segment is a plain
 * multiplication; the seconds before a segment are the sum of the previous ones).
 *
 * The notes of a song stay in seconds — they are a performance, and re-timing a
 * performance is a different feature. What follows the map is the *grid*, the
 * clicks, the readout and the file.
 */

import { songTracks, type MidiSong } from './smf';

export interface TempoSegment {
  bpm: number;
  /** How many beats this segment covers. The last segment ignores it (∞). */
  beats: number;
  /** Beats per bar for the accent pattern and the grid. */
  beatsPerBar: number;
}

export const MIN_BPM = 20;
export const MAX_BPM = 300;
export const MIN_BEATS_PER_BAR = 1;
export const MAX_BEATS_PER_BAR = 16;
/** Most segments a map may hold: a song that changes tempo more than this is a
 * mistake, and every lookup walks the list. */
export const MAX_TEMPO_SEGMENTS = 64;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const tidy = (v: number): number => Math.round(v * 100000) / 100000;

/** A single segment covering everything, from a plain `song.bpm`. */
export function defaultMap(bpm: number, beatsPerBar = 4): TempoSegment[] {
  return [
    {
      bpm: clamp(Math.round(bpm || 120), MIN_BPM, MAX_BPM),
      beats: Number.POSITIVE_INFINITY,
      beatsPerBar: clamp(Math.round(beatsPerBar || 4), MIN_BEATS_PER_BAR, MAX_BEATS_PER_BAR),
    },
  ];
}

/** The map of a song: its own, or one segment built from its BPM. */
export function tempoMapOf(song: MidiSong | null | undefined): TempoSegment[] {
  if (song?.tempoMap && song.tempoMap.length) return song.tempoMap;
  return defaultMap(song?.bpm ?? 120, song?.beatsPerBar ?? 4);
}

/** Read a stored map without trusting its shape. */
export function normalizeTempoMap(raw: unknown, fallbackBpm = 120): TempoSegment[] {
  if (!Array.isArray(raw)) return defaultMap(fallbackBpm);
  const out: TempoSegment[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_TEMPO_SEGMENTS) break;
    if (!entry || typeof entry !== 'object') continue;
    const segment = entry as Partial<TempoSegment>;
    if (typeof segment.bpm !== 'number' || !Number.isFinite(segment.bpm)) continue;
    out.push({
      bpm: clamp(Math.round(segment.bpm), MIN_BPM, MAX_BPM),
      beats:
        typeof segment.beats === 'number' && Number.isFinite(segment.beats) && segment.beats > 0
          ? tidy(segment.beats)
          : Number.POSITIVE_INFINITY,
      beatsPerBar: clamp(Math.round(segment.beatsPerBar ?? 4), MIN_BEATS_PER_BAR, MAX_BEATS_PER_BAR),
    });
  }
  return out.length ? out : defaultMap(fallbackBpm);
}

/** Beats a segment covers: the stored length, or the rest of the song. */
function span(segment: TempoSegment): number {
  return Number.isFinite(segment.beats) && segment.beats > 0 ? segment.beats : Number.POSITIVE_INFINITY;
}

/** Cumulative start of every segment, in beats. */
export function segmentStarts(map: TempoSegment[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const segment of map) {
    starts.push(at);
    const length = span(segment);
    at = Number.isFinite(length) ? at + length : Number.POSITIVE_INFINITY;
  }
  return starts;
}

/** The segment covering a beat position, with where it starts. */
export function segmentAtBeat(
  map: TempoSegment[],
  beat: number,
): { index: number; startBeat: number; segment: TempoSegment } {
  const starts = segmentStarts(map);
  let index = 0;
  for (let i = 0; i < map.length; i += 1) {
    if (beat + 1e-9 >= starts[i]) index = i;
    else break;
  }
  return { index, startBeat: starts[index] ?? 0, segment: map[index] };
}

/** Seconds at a beat position. Exact at segment boundaries. */
export function beatsToSeconds(map: TempoSegment[], beat: number): number {
  const target = Math.max(0, beat);
  let seconds = 0;
  let at = 0;
  for (const segment of map) {
    const length = span(segment);
    const beatSeconds = 60 / clamp(segment.bpm, MIN_BPM, MAX_BPM);
    const inside = Number.isFinite(length) ? Math.min(target - at, length) : target - at;
    if (inside > 0) seconds += inside * beatSeconds;
    if (!Number.isFinite(length) || target <= at + length) break;
    at += length;
  }
  return tidy(seconds);
}

/** The beat position at a time in seconds: the inverse of `beatsToSeconds`. */
export function secondsToBeats(map: TempoSegment[], seconds: number): number {
  const target = Math.max(0, seconds);
  let at = 0;
  let beats = 0;
  for (const segment of map) {
    const length = span(segment);
    const beatSeconds = 60 / clamp(segment.bpm, MIN_BPM, MAX_BPM);
    const available = Number.isFinite(length) ? length * beatSeconds : Number.POSITIVE_INFINITY;
    if (target < at + available || !Number.isFinite(available)) {
      return tidy(beats + (target - at) / beatSeconds);
    }
    at += available;
    beats += length;
  }
  return tidy(beats);
}

/** Seconds one beat lasts at a position — the metronome's step. */
export function beatSecondsAt(map: TempoSegment[], beat: number): number {
  return 60 / clamp(segmentAtBeat(map, beat).segment.bpm, MIN_BPM, MAX_BPM);
}

/** The bar/beat a position falls on, for the transport readout. */
export function barBeatAt(
  map: TempoSegment[],
  beat: number,
): { bar: number; beat: number; beatsPerBar: number } {
  const { startBeat, segment } = segmentAtBeat(map, beat);
  const beatsPerBar = clamp(segment.beatsPerBar, MIN_BEATS_PER_BAR, MAX_BEATS_PER_BAR);
  // Bars are counted from the start of the *song*, but the pattern restarts with
  // each segment: a 3/4 section after a 4/4 one starts a new bar, which is what
  // a player expects to see.
  const intoSegment = Math.max(0, beat - startBeat);
  const barsBefore = barsUpTo(map, startBeat);
  return {
    bar: barsBefore + Math.floor(intoSegment / beatsPerBar) + 1,
    beat: Math.floor(intoSegment % beatsPerBar) + 1,
    beatsPerBar,
  };
}

/** Whole bars before a beat position, following every segment's signature. */
export function barsUpTo(map: TempoSegment[], beat: number): number {
  const starts = segmentStarts(map);
  let bars = 0;
  for (let i = 0; i < map.length; i += 1) {
    const from = starts[i];
    if (beat <= from + 1e-9) break;
    const length = span(map[i]);
    const to = Number.isFinite(length) ? Math.min(beat, from + length) : beat;
    bars += Math.floor((to - from) / clamp(map[i].beatsPerBar, MIN_BEATS_PER_BAR, MAX_BEATS_PER_BAR));
  }
  return bars;
}

/**
 * The grid step at a position, in beats.
 *
 * `grid` is the editor's unit in beats (1/16 note = 0.25), but a *bar* grid
 * follows the signature: asking for a bar in 3/4 has to give 3 beats, not 4.
 */
export function gridStepAt(map: TempoSegment[], beat: number, grid: number): number {
  if (!(grid > 0)) return 0;
  const beatsPerBar = clamp(segmentAtBeat(map, beat).segment.beatsPerBar, MIN_BEATS_PER_BAR, MAX_BEATS_PER_BAR);
  return grid >= 4 ? beatsPerBar : grid;
}

/** Total beats the song's notes cover, in this map. */
export function beatsInSong(song: MidiSong): number {
  const map = tempoMapOf(song);
  const seconds = Math.max(0, song.duration);
  return secondsToBeats(map, seconds);
}

/** Write a map (and a matching flat BPM) back into a song. */
export function withTempoMap(song: MidiSong, map: TempoSegment[]): MidiSong {
  const clean = normalizeTempoMap(map, song.bpm);
  return { ...song, tempoMap: clean, bpm: clean[0].bpm, beatsPerBar: clean[0].beatsPerBar };
}

/** A readable summary for the UI and the tests. */
export function tempoSummary(map: TempoSegment[]): string {
  return map
    .map((segment, index) => {
      const bars = Number.isFinite(segment.beats) ? `${segment.beats / segment.beatsPerBar} bars` : 'to the end';
      return `${index + 1}: ${segment.bpm} BPM ${segment.beatsPerBar}/4 · ${bars}`;
    })
    .join(' · ');
}

/** True when the song's layers are all in one tempo (the common case). */
export function isUniform(map: TempoSegment[]): boolean {
  return map.length <= 1 || map.every((segment) => segment.bpm === map[0].bpm && segment.beatsPerBar === map[0].beatsPerBar);
}

/** The song's own note list, for callers that need both halves. */
export function songNotes(song: MidiSong): number {
  return songTracks(song).reduce((sum, track) => sum + track.notes.length, 0);
}
