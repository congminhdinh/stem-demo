import { describe, expect, it } from 'vitest';
import type * as Blockly from 'blockly';
import { fitBlocksIntoView, fittedScale, minFitScale, minRobotFitScale } from './fit';

describe('fittedScale (N8s)', () => {
  it('keeps the scale of a program that fits', () => {
    expect(fittedScale(1, { width: 300, height: 200 }, { width: 500, height: 400 })).toBe(1);
  });

  it('shrinks a program that is wider than the view, leaving a margin', () => {
    expect(fittedScale(1, { width: 468, height: 100 }, { width: 400, height: 400 })).toBeCloseTo(368 / 468);
  });

  it('never goes below the smallest readable scale', () => {
    expect(fittedScale(1, { width: 5000, height: 100 }, { width: 400, height: 400 })).toBe(minFitScale);
  });

  it('never enlarges, and leaves an empty workspace as it is', () => {
    expect(fittedScale(0.8, { width: 10, height: 10 }, { width: 400, height: 400 })).toBe(0.8);
    expect(fittedScale(1, { width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });

  it('takes the smallest scale it may go down to from the lab that asks', () => {
    expect(fittedScale(1, { width: 5000, height: 100 }, { width: 400, height: 400 }, minRobotFitScale)).toBe(minRobotFitScale);
    expect(fittedScale(1, { width: 468, height: 100 }, { width: 400, height: 400 }, minRobotFitScale)).toBeCloseTo(368 / 468);
    // 0.6 stays the other labs' smallest (N8s): a lab that does not say gets it.
    expect(minRobotFitScale).toBeLessThan(minFitScale);
    expect(minFitScale).toBe(0.6);
  });
});

/**
 * A workspace as fitBlocksIntoView reads and moves it: the blocks' box in workspace units, a view of `view` pixels, a scale and a scroll
 * (the workspace point at the view's top-left). `scrollBoundsIntoView` puts the box's top-left a padding inside the view, as Blockly's does
 * when the box is larger than the view.
 */
function fakeWorkspace(box: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number }, scroll = { left: 0, top: 0 }, scale = 1) {
  const state = { scale, scroll: { ...scroll }, setScale: [] as number[], scrolled: [] as { bounds: typeof box; padding: number }[] };
  const workspace = {
    get scale() {
      return state.scale;
    },
    getBlocksBoundingBox: () => box,
    getMetricsManager: () => ({
      getViewMetrics: (inWorkspace = false) =>
        inWorkspace ? { left: state.scroll.left, top: state.scroll.top, width: view.width / state.scale, height: view.height / state.scale } : { left: 0, top: 0, ...view },
    }),
    setScale: (next: number) => {
      state.scale = next;
      state.setScale.push(next);
    },
    scrollBoundsIntoView: (bounds: typeof box, padding: number) => {
      state.scrolled.push({ bounds, padding });
      state.scroll = { left: bounds.left - padding / state.scale, top: bounds.top - padding / state.scale };
    },
  };
  return { workspace: workspace as unknown as Blockly.WorkspaceSvg, state };
}

describe('fitBlocksIntoView (N8s, N18 bt-lab-fix c4)', () => {
  it('leaves a program that fits and is in sight alone: no zoom, no scroll', () => {
    const { workspace, state } = fakeWorkspace({ left: 10, top: 10, right: 210, bottom: 110 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(workspace)).toBe(true);
    expect([state.setScale, state.scrolled]).toEqual([[], []]);
  });

  it('shrinks a program wider than the view to fit, and brings its top-left into sight', () => {
    // 420 units at 1 in a 300 px view: 268 / 420 of it fits with the margin; the box starts left of the view.
    const { workspace, state } = fakeWorkspace({ left: -120, top: 40, right: 300, bottom: 200 }, { width: 300, height: 400 });
    expect(fitBlocksIntoView(workspace)).toBe(true);
    expect(state.scale).toBeCloseTo(268 / 420);
    expect(state.scrolled).toHaveLength(1);
    expect(state.scroll.left).toBeLessThan(-120 + 1);
    expect(state.scroll.top).toBeLessThan(40);
  });

  it('never goes below the smallest scale it is given, and then shows the top-left of the program, the rest being a scroll away', () => {
    const wide = { left: 20, top: 20, right: 1020, bottom: 120 };
    const robot = fakeWorkspace(wide, { width: 300, height: 400 });
    fitBlocksIntoView(robot.workspace, minRobotFitScale);
    expect(robot.state.scale).toBe(minRobotFitScale);
    const other = fakeWorkspace(wide, { width: 300, height: 400 });
    fitBlocksIntoView(other.workspace);
    expect(other.state.scale).toBe(minFitScale);
    // The top-left of the program is in the view (a padding in from its left and top edges), whatever the scale.
    for (const { state } of [robot, other]) {
      expect(state.scroll.left).toBeLessThanOrEqual(wide.left);
      expect(state.scroll.top).toBeLessThanOrEqual(wide.top);
      expect(state.scroll.left + 300 / state.scale).toBeGreaterThan(wide.left);
    }
  });

  it('scrolls a program that fits but sits out of sight (a restored program placed far from the origin) into sight, at the same scale', () => {
    const { workspace, state } = fakeWorkspace({ left: 900, top: 700, right: 1100, bottom: 780 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(workspace)).toBe(true);
    expect(state.setScale).toEqual([]);
    expect(state.scrolled).toHaveLength(1);
    expect(state.scroll.left).toBeLessThan(900);
    expect(state.scroll.top).toBeLessThan(700);
  });

  it('does nothing for an empty workspace, and says it could not measure a view that has no size yet (a hidden tab), changing nothing', () => {
    const empty = fakeWorkspace({ left: 0, top: 0, right: 0, bottom: 0 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(empty.workspace)).toBe(true);
    expect([empty.state.setScale, empty.state.scrolled]).toEqual([[], []]);
    const hidden = fakeWorkspace({ left: 0, top: 0, right: 900, bottom: 200 }, { width: 0, height: 0 });
    expect(fitBlocksIntoView(hidden.workspace)).toBe(false);
    expect([hidden.state.setScale, hidden.state.scrolled, hidden.state.scale]).toEqual([[], [], 1]);
  });
});
