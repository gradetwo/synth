import { describe, expect, it } from 'vitest';
import { detectChord } from './chords';

const chordOf = (names: number[]) => detectChord(names)?.name ?? null;

describe('chord detection', () => {
  it('needs at least two notes', () => {
    expect(detectChord([])).toBeNull();
    expect(detectChord([60])).toBeNull();
    expect(detectChord([60, 72])).toBeNull(); // same pitch class
  });

  it('recognises the common triads', () => {
    expect(chordOf([60, 64, 67])).toBe('C');
    expect(chordOf([57, 60, 64])).toBe('Am');
    expect(chordOf([62, 65, 69])).toBe('Dm');
    expect(chordOf([55, 59, 62])).toBe('G');
    expect(chordOf([59, 62, 65])).toBe('Bdim');
  });

  it('recognises sevenths and extensions', () => {
    expect(chordOf([55, 59, 62, 65])).toBe('G7');
    expect(chordOf([60, 64, 67, 71])).toBe('Cmaj7');
    expect(chordOf([57, 60, 64, 67])).toBe('Am7');
    expect(chordOf([62, 65, 69, 72])).toBe('Dm7');
    expect(chordOf([60, 64, 67, 74])).toBe('Cadd9');
  });

  it('handles inversions with a slash bass', () => {
    expect(chordOf([64, 67, 72])).toBe('C/E');
    expect(chordOf([55, 60, 64, 67])).toBe('C/G');
  });

  it('is order independent and octave independent', () => {
    expect(chordOf([67, 60, 64])).toBe('C');
    expect(chordOf([48, 64, 55, 72, 79])).toBe('C');
  });

  it('prefers the bass note as root when possible', () => {
    expect(chordOf([52, 55, 59, 64])).toBe('Em'); // E G B E
    expect(chordOf([59, 60, 64, 67])).toBe('Cmaj7/B'); // B C E G
  });

  it('returns null for clusters that match no template', () => {
    expect(chordOf([60, 61])).toBeNull();
  });
});
