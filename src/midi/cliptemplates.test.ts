/**
 * Clip templates (P10.2).
 *
 * The model claims two things worth pinning down: a stored template is repaired
 * rather than trusted (it lives in localStorage next to everything else the user
 * can hand-edit), and applying one hands out a clip that *owns* its notes — so
 * editing the applied clip, or another clip applied from the same template,
 * cannot reach back into either.
 */
import { describe, expect, it } from 'vitest';
import { expandClips, makeClip, type MidiClip } from './clips';
import {
  clipFromTemplate,
  clipTemplateFromClip,
  findClipTemplate,
  normalizeClipTemplates,
  type ClipTemplate,
} from './cliptemplates';

const note = (n: number, start: number, duration = 0.5, velocity = 0.8) => ({ note: n, velocity, start, duration });

const clip = (): MidiClip => makeClip('Verse', [note(60, 0, 0.5), note(64, 0.5, 0.5)], { start: 1, length: 2, repeat: 2 });

describe('clip templates', () => {
  it('captures the figure, not the placement', () => {
    const source = clip();
    const template = clipTemplateFromClip(source, 'tpl1');
    expect(template.id).toBe('tpl1');
    expect(template.name).toBe('Verse');
    expect(template.notes).toEqual(source.notes);
    // A rename does not rename the template; the material is the same object
    // graph-wise, but not by reference.
    expect(template.notes).not.toBe(source.notes);
    expect(template.notes[0]).not.toBe(source.notes[0]);
  });

  it('applies onto any layer, with its own notes and a legal window', () => {
    const template = clipTemplateFromClip(clip(), 'tpl1');
    const onBass = clipFromTemplate(template, { layer: 1, bpm: 120 });
    expect(onBass.layer).toBe(1);
    expect(onBass.notes).toEqual(template.notes);
    expect(onBass.length).toBeGreaterThan(0);
    // The same figure expands the same way wherever it lands.
    expect(expandClips([onBass]).notes).toEqual(expandClips([{ ...onBass, layer: 0 }]).notes);
  });

  it('never shares state with the template it came from', () => {
    const template = clipTemplateFromClip(clip(), 'tpl1');
    const first = clipFromTemplate(template, { layer: 0, bpm: 120 });
    const second = clipFromTemplate(template, { layer: 1, bpm: 120 });

    // Three independent note arrays, three independent note objects.
    expect(first.notes).not.toBe(template.notes);
    expect(second.notes).not.toBe(template.notes);
    expect(second.notes).not.toBe(first.notes);
    expect(first.notes[0]).not.toBe(template.notes[0]);
    expect(second.notes[0]).not.toBe(first.notes[0]);

    // Mutating one copy in place must not be visible anywhere else — the
    // strongest form of "no shared state", and the one a shallow copy fails.
    const before = { template: template.notes.map((n) => ({ ...n })), second: second.notes.map((n) => ({ ...n })) };
    first.notes[0].note = 36;
    first.notes[0].start = 9;
    expect(template.notes).toEqual(before.template);
    expect(second.notes).toEqual(before.second);
    // …and the other direction.
    second.notes[0].note = 72;
    expect(first.notes[0].note).toBe(36);
    expect(template.notes[0].note).toBe(60);
  });

  it('normalizes the clips a template is built from without trusting them', () => {
    const bad: unknown = [
      { id: 'ok', name: 'Good', notes: [note(60, 0, 0.5), { note: 61 } as unknown, note(62, 1, 0.5)] },
      null,
      { id: '', name: 'no id', notes: [note(60, 0)] },
      { id: 'noname', notes: [note(60, 0)] },
      { id: 'ok', name: 'duplicate', notes: [note(64, 0)] },
      { id: 'empty', name: 'nothing', notes: [] },
      { id: 'clamped', name: '  loud  ', notes: [note(999, -4, 0.5, 9)] },
    ];
    const templates = normalizeClipTemplates(bad);
    expect(templates.map((t) => t.id)).toEqual(['ok', 'clamped']);
    // The broken note is dropped, the good ones are kept and repaired.
    expect(templates[0].notes.map((n) => n.note)).toEqual([60, 62]);
    expect(templates[1].name).toBe('loud');
    expect(templates[1].notes[0]).toEqual({ note: 127, velocity: 1, start: 0, duration: 0.5 });
  });

  it('finds a saved template by id and ignores the rest', () => {
    const list: ClipTemplate[] = [clipTemplateFromClip(clip(), 'a', 'A')];
    expect(findClipTemplate(list, 'a')?.name).toBe('A');
    expect(findClipTemplate(list, 'b')).toBeNull();
  });
});
