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
  it('ships the four sections with unique ids', () => {
    expect(GUIDE_SECTIONS.map((s) => s.id)).toEqual(['basics', 'start', 'help', 'build']);
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

  it('covers synthesis, help and a from-scratch walkthrough', () => {
    const basics = GUIDE_SECTIONS.find((s) => s.id === 'basics')!;
    const help = GUIDE_SECTIONS.find((s) => s.id === 'help')!;
    const build = GUIDE_SECTIONS.find((s) => s.id === 'build')!;
    const textOf = (blocks: Block[]) =>
      blocks
        .flatMap(pairsOf)
        .map((p) => p[1])
        .join(' ');

    expect(textOf(basics.blocks)).toMatch(/oscillator/i);
    expect(textOf(basics.blocks)).toMatch(/filter/i);
    expect(textOf(basics.blocks)).toMatch(/envelope/i);
    expect(textOf(help.blocks)).toMatch(/shortcut/i);
    // The walkthrough must include concrete starting recipes.
    expect(textOf(build.blocks)).toMatch(/Pluck Bass/);
    expect(textOf(build.blocks)).toMatch(/Warm Pad/);
    expect(textOf(build.blocks)).toMatch(/Screaming Lead/);
  });
});
