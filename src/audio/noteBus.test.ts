import { describe, expect, it } from 'vitest';
import { noteBus, noteName, noteToHz } from './noteBus';

describe('note bus', () => {
  it('formats note names and frequencies', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(61)).toBe('C#4');
    expect(noteToHz(69)).toBeCloseTo(440, 5);
    expect(noteToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it('tracks held notes without duplicates', () => {
    noteBus.allOff();
    noteBus.noteOn(60, 0.8);
    noteBus.noteOn(64, 0.8);
    noteBus.noteOn(60, 0.8);
    expect(noteBus.heldNotes().sort((a, b) => a - b)).toEqual([60, 64]);
    noteBus.noteOff(60);
    expect(noteBus.heldNotes()).toEqual([64]);
    noteBus.allOff();
    expect(noteBus.heldNotes()).toEqual([]);
  });

  it('notifies subscribers with the newest note', () => {
    noteBus.allOff();
    const seen: (number | null)[] = [];
    const off = noteBus.subscribe((info) => seen.push(info.note));
    noteBus.noteOn(72, 1);
    noteBus.noteOff(72);
    off();
    expect(seen).toEqual([null, 72, null]);
  });
});
