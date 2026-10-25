import type { UnoLineRange } from '../../core/codegen/arduino/generate';

// The lines of the C++ tab (N18 R4.5): the sketch as lines, which of them a block's code takes (C1's `lineMap`: each IR block id to the
// lines it writes, 1-based and inclusive), and where to scroll so that the running block's lines and the selected block's are in sight.
// Plain arithmetic, so a test reads it exactly; the tab only draws it.

/** A sketch as its lines. The newline that ends the sketch does not start another. */
export function sketchLines(source: string): string[] {
  return source === '' ? [] : source.replace(/\n$/, '').split('\n');
}

export type LineRange = { from: number; to: number };

/** The lines the code of `blockId` takes; null for a block with no code of its own (a number typed into a block, a block of another program). */
export function rangeOf(lineMap: readonly UnoLineRange[], blockId: string | null): LineRange | null {
  if (blockId === null) return null;
  let range: LineRange | null = null;
  for (const entry of lineMap) {
    if (entry.blockId === blockId) {
      range = range === null ? { from: entry.from, to: entry.to } : { from: Math.min(range.from, entry.from), to: Math.max(range.to, entry.to) };
    }
  }
  return range;
}

export type Highlights = { running: LineRange | null; selected: LineRange | null };

/**
 * The marks of the tab: the lines of the block the robot is in, and of the block the learner selected. `selection` is the selected block
 * and then the blocks around it, innermost first (a number typed into a drive block selects the drive block's lines): the first that has
 * code is the one shown.
 */
export function highlightedLines(lineMap: readonly UnoLineRange[], runningId: string | null, selection: readonly string[]): Highlights {
  let selected: LineRange | null = null;
  for (const id of selection) {
    selected = rangeOf(lineMap, id);
    if (selected !== null) break;
  }
  return { running: rangeOf(lineMap, runningId), selected };
}

/**
 * The scroll position that brings `target` into sight in a view, or null when it already is. Positions are in the scrolled content's own
 * coordinates; `margin` is the room left over or under the lines. Lines taller than the view show their start.
 */
export function revealScrollTop(view: { scrollTop: number; clientHeight: number }, target: { top: number; height: number }, margin: number): number | null {
  const bottom = target.top + target.height;
  if (target.top < view.scrollTop + margin) {
    return Math.max(0, target.top - margin);
  }
  if (bottom > view.scrollTop + view.clientHeight - margin) {
    return target.height > view.clientHeight - 2 * margin ? target.top - margin : bottom - view.clientHeight + margin;
  }
  return null;
}
