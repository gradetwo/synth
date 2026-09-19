import { describe, expect, it } from 'vitest';
import { GUIDE_SECTIONS, type Bi, type Block } from './content';

function pairsOf(block: Block): Bi[] {
  switch (block.kind) {
    case 'p':
    case 'h':
    case 'tip':
      return [block.text];
    case 'ul':
    case 'ol':
      return block.items;
    case 'table':
      return [...block.head, ...block.rows.flat()];
    case 'steps':
      return block.items.flatMap((s) => [s.title, s.body]);
    default:
      return [];
  }
}

describe('guide content', () => {
  it('ships the eight sections with unique ids', () => {
    expect(GUIDE_SECTIONS.map((s) => s.id)).toEqual([
      'basics',
      'history',
      'types',
      'modules',
      'start',
      'help',
      'tools',
      'build',
    ]);
    expect(new Set(GUIDE_SECTIONS.map((s) => s.id)).size).toBe(GUIDE_SECTIONS.length);
  });

  it('has a title, intro and at least one block per section', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.title[0].length, section.id).toBeGreaterThan(0);
      expect(section.title[1].length, section.id).toBeGreaterThan(0);
      expect(section.intro[0].length, section.id).toBeGreaterThan(0);
      expect(section.intro[1].length, section.id).toBeGreaterThan(0);
      expect(section.blocks.length, section.id).toBeGreaterThan(0);
    }
  });

  it('is fully bilingual with no empty strings', () => {
    for (const section of GUIDE_SECTIONS) {
      const pairs = [section.title, section.intro, ...section.blocks.flatMap(pairsOf)];
      for (const [zh, en] of pairs) {
        expect(zh.trim().length, section.id).toBeGreaterThan(0);
        expect(en.trim().length, section.id).toBeGreaterThan(0);
      }
    }
  });

  it('covers theory, history, taxonomy, module internals, help and a walkthrough', () => {
    const byId = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)!;
    const textOf = (id: string) =>
      byId(id)
        .blocks.flatMap(pairsOf)
        .map((p) => p[1])
        .join(' ');

    // Theory: harmonics, sampling/aliasing and subtractive synthesis.
    const basics = textOf('basics');
    expect(basics).toMatch(/Fourier/);
    expect(basics).toMatch(/Nyquist|aliasing/i);
    expect(basics).toMatch(/subtractive/i);

    // History and taxonomy.
    const history = textOf('history');
    expect(history).toMatch(/Moog/);
    expect(history).toMatch(/DX7/);
    expect(history).toMatch(/MIDI/);
    const types = textOf('types');
    expect(types).toMatch(/Subtractive/);
    expect(types).toMatch(/Wavetable/);
    expect(types).toMatch(/Physical modelling/i);

    // Module internals describe the real implementation.
    const modules = textOf('modules');
    expect(modules).toMatch(/polyBLEP/);
    expect(modules).toMatch(/Huovilainen|ladder/i);
    expect(modules).toMatch(/reverbsc/);
    expect(modules).toMatch(/AudioWorklet/);

    // Player, signal flow and chord recognition.
    const tools = textOf('tools');
    expect(tools).toMatch(/MIDI/);
    expect(tools).toMatch(/MP3/);
    expect(tools).toMatch(/BYPASS/);
    expect(tools).toMatch(/CHORD/);

    // Help and the walkthrough.
    expect(textOf('help')).toMatch(/shortcut/i);
    expect(textOf('build')).toMatch(/Pluck Bass/);
    expect(textOf('build')).toMatch(/Warm Pad/);
    expect(textOf('build')).toMatch(/Screaming Lead/);
  });
});
