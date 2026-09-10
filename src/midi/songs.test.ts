import { describe, expect, it } from 'vitest';
import { DEMO_SONGS, demoSong, midiOf, specToSong } from './songs';

describe('demo playlist', () => {
  it('ships the requested entries with unique ids', () => {
    expect(DEMO_SONGS).toHaveLength(20);
    const ids = DEMO_SONGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(20);
    for (const required of [
      'elise', 'canon', 'moonlight', 'mariage', 'turkish', 'river', 'summer',
      'croatian', 'castle', 'mario', 'got', 'jasmine', 'butterfly', 'seashore',
      'arpeggio', 'scale', 'tetris', 'joy', 'greensleeves', 'furelise-rock',
    ]) {
      expect(ids, required).toContain(required);
    }
  });

  it('is bilingual with a composer line', () => {
    for (const spec of DEMO_SONGS) {
      expect(spec.title[0].length, spec.id).toBeGreaterThan(0);
      expect(spec.title[1].length, spec.id).toBeGreaterThan(0);
      expect(spec.composer.length, spec.id).toBeGreaterThan(0);
    }
  });

  it('converts every entry to playable notes', () => {
    for (const spec of DEMO_SONGS) {
      const song = specToSong(spec);
      expect(song.notes.length, spec.id).toBeGreaterThan(4);
      expect(song.duration, spec.id).toBeGreaterThan(0.5);
      for (const note of song.notes) {
        expect(note.note, spec.id).toBeGreaterThanOrEqual(0);
        expect(note.note, spec.id).toBeLessThanOrEqual(127);
        expect(note.velocity, spec.id).toBeGreaterThan(0);
        expect(note.velocity, spec.id).toBeLessThanOrEqual(1);
        expect(note.duration, spec.id).toBeGreaterThan(0);
        expect(note.start, spec.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ships full-length arrangements, not snippets', () => {
    // Public-domain works are arranged in full; the modern themes stay as
    // longer demonstrations for copyright reasons.
    const publicDomain = ['elise', 'canon', 'moonlight', 'turkish', 'jasmine'];
    // The four fun additions are loops by design (a game theme or a folk tune
    // played through), so they are allowed to be shorter than an arrangement.
    const loops = ['tetris', 'joy', 'greensleeves', 'furelise-rock'];
    for (const spec of DEMO_SONGS) {
      const song = specToSong(spec);
      expect(song.duration, spec.id).toBeGreaterThan(loops.includes(spec.id) ? 25 : 40);
      if (publicDomain.includes(spec.id)) {
        expect(song.duration, spec.id).toBeGreaterThan(60);
        expect(song.notes.length, spec.id).toBeGreaterThan(200);
      }
    }
  });

  it('parses note names with accidentals', () => {
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('A4')).toBe(69);
    expect(midiOf('D#5')).toBe(75);
    expect(midiOf('Bb3')).toBe(58);
    expect(() => midiOf('H4')).toThrow();
  });

  it('exposes songs by id', () => {
    expect(demoSong('elise')?.notes.length).toBeGreaterThan(10);
    expect(demoSong('nope')).toBeNull();
  });
});
