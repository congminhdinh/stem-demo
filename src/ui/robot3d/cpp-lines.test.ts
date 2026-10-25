import { describe, expect, it } from 'vitest';
import { highlightedLines, rangeOf, revealScrollTop, sketchLines } from './cpp-lines';

// N18 R4.5: the C++ tab's lines, which of them the running block and the selected block take (C1's lineMap), and where to scroll to show them.

const lineMap = [
  { blockId: 'on-start', from: 20, to: 30 },
  { blockId: 'go', from: 22, to: 25 },
  { blockId: 'go-speed', from: 22, to: 22 },
  { blockId: 'wait', from: 26, to: 26 },
  { blockId: 'stop', from: 27, to: 29 },
];

describe('sketchLines', () => {
  it('splits a sketch into its lines, dropping the empty one a final newline leaves', () => {
    expect(sketchLines('a\nb\n\nc\n')).toEqual(['a', 'b', '', 'c']);
    expect(sketchLines('')).toEqual([]);
    expect(sketchLines('only')).toEqual(['only']);
  });
});

describe('rangeOf', () => {
  it('is the lines a block’s code takes, 1-based and inclusive', () => {
    expect(rangeOf(lineMap, 'go')).toEqual({ from: 22, to: 25 });
    expect(rangeOf(lineMap, 'wait')).toEqual({ from: 26, to: 26 });
  });

  it('is nothing for a block with no code (a block of no code, or none at all)', () => {
    expect(rangeOf(lineMap, 'shadow-number')).toBeNull();
    expect(rangeOf(lineMap, null)).toBeNull();
  });

  it('spans every entry a block has, should the map name one twice', () => {
    expect(rangeOf([{ blockId: 'x', from: 4, to: 5 }, { blockId: 'x', from: 9, to: 12 }], 'x')).toEqual({ from: 4, to: 12 });
  });
});

describe('highlightedLines', () => {
  it('lights the running block’s lines and the selected block’s, each as its own mark', () => {
    expect(highlightedLines(lineMap, 'wait', ['go'])).toEqual({ running: { from: 26, to: 26 }, selected: { from: 22, to: 25 } });
  });

  it('takes the selection’s first block that has code: a number inside a block selects that block’s code', () => {
    // [the selected block, its parent, …]: the shadow number has no code of its own, its block has.
    expect(highlightedLines(lineMap, null, ['unmapped-shadow', 'go', 'on-start']).selected).toEqual({ from: 22, to: 25 });
    expect(highlightedLines(lineMap, null, ['unmapped-shadow', 'unmapped-parent']).selected).toBeNull();
    expect(highlightedLines(lineMap, null, []).selected).toBeNull();
  });

  it('is nothing for a run that is in no block of this program', () => {
    expect(highlightedLines(lineMap, 'deleted-block', [])).toEqual({ running: null, selected: null });
    expect(highlightedLines([], 'go', ['go'])).toEqual({ running: null, selected: null });
  });
});

describe('revealScrollTop', () => {
  const view = { scrollTop: 100, clientHeight: 200 };

  it('leaves the scroll alone when the lines are already in sight', () => {
    expect(revealScrollTop(view, { top: 150, height: 40 }, 20)).toBeNull();
    expect(revealScrollTop(view, { top: 120, height: 40 }, 20)).toBeNull();
  });

  it('scrolls up to a line above the view, leaving the margin over it', () => {
    expect(revealScrollTop(view, { top: 60, height: 20 }, 20)).toBe(40);
    expect(revealScrollTop(view, { top: 10, height: 20 }, 20)).toBe(0);
    expect(revealScrollTop(view, { top: 105, height: 20 }, 20)).toBe(85);
  });

  it('scrolls down to a line below the view, leaving the margin under it', () => {
    expect(revealScrollTop(view, { top: 400, height: 20 }, 20)).toBe(240);
    expect(revealScrollTop(view, { top: 270, height: 20 }, 20)).toBe(110);
  });

  it('shows the start of lines taller than the view', () => {
    expect(revealScrollTop(view, { top: 500, height: 300 }, 20)).toBe(480);
  });
});
