import { describe, expect, it } from 'vitest';
import type * as Blockly from 'blockly';
import { fitBlocksIntoView, fittedScale, minFitScale, minRobotFitScale, robotFit } from './fit';

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

describe('fitBlocksIntoView for the robot lab (N18 bt-lab-fix, c4)', () => {
  it('leaves a program that fits and is in sight alone: no zoom, no scroll', () => {
    const { workspace, state } = fakeWorkspace({ left: 10, top: 10, right: 210, bottom: 110 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(workspace, robotFit)).toBe(true);
    expect([state.setScale, state.scrolled]).toEqual([[], []]);
  });

  it('shrinks a program wider than the view to fit, and brings its top-left into sight', () => {
    // 420 units at 1 in a 300 px view: 268 / 420 of it fits with the margin; the box starts left of the view.
    const { workspace, state } = fakeWorkspace({ left: -120, top: 40, right: 300, bottom: 200 }, { width: 300, height: 400 });
    expect(fitBlocksIntoView(workspace, robotFit)).toBe(true);
    expect(state.scale).toBeCloseTo(268 / 420);
    expect(state.scrolled).toHaveLength(1);
    expect(state.scroll.left).toBeLessThan(-120 + 1);
    expect(state.scroll.top).toBeLessThan(40);
  });

  it('never goes below its smallest scale (0.5), and then shows the top-left of the program, the rest being a scroll away', () => {
    const wide = { left: 20, top: 20, right: 1020, bottom: 120 };
    const robot = fakeWorkspace(wide, { width: 300, height: 400 });
    fitBlocksIntoView(robot.workspace, robotFit);
    expect(robot.state.scale).toBe(minRobotFitScale);
    // The top-left of the program is in the view (a padding in from its left and top edges).
    expect(robot.state.scroll.left).toBeLessThanOrEqual(wide.left);
    expect(robot.state.scroll.top).toBeLessThanOrEqual(wide.top);
    expect(robot.state.scroll.left + 300 / robot.state.scale).toBeGreaterThan(wide.left);
  });

  it('scrolls a program that fits but sits out of sight (a restored program placed far from the origin) into sight, at the same scale', () => {
    const { workspace, state } = fakeWorkspace({ left: 900, top: 700, right: 1100, bottom: 780 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(workspace, robotFit)).toBe(true);
    expect(state.setScale).toEqual([]);
    expect(state.scrolled).toHaveLength(1);
    expect(state.scroll.left).toBeLessThan(900);
    expect(state.scroll.top).toBeLessThan(700);
  });

  it('does nothing for an empty workspace, and says it could not measure a view that has no size yet (a hidden frame), changing nothing', () => {
    const empty = fakeWorkspace({ left: 0, top: 0, right: 0, bottom: 0 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(empty.workspace, robotFit)).toBe(true);
    expect([empty.state.setScale, empty.state.scrolled]).toEqual([[], []]);
    const hidden = fakeWorkspace({ left: 0, top: 0, right: 900, bottom: 200 }, { width: 0, height: 0 });
    expect(fitBlocksIntoView(hidden.workspace, robotFit)).toBe(false);
    expect([hidden.state.setScale, hidden.state.scrolled, hidden.state.scale]).toEqual([[], [], 1]);
    const unmeasurable = fakeWorkspace({ left: 0, top: 0, right: 900, bottom: 200 }, { width: Number.NaN, height: Number.NaN });
    expect(fitBlocksIntoView(unmeasurable.workspace, robotFit)).toBe(false);
    expect([unmeasurable.state.setScale, unmeasurable.state.scrolled]).toEqual([[], []]);
  });
});

/** a257eb6's `fitBlocksIntoView` (N8s), as it was before the robot lab's changes: what the Blockly and Yolo:Bit labs must still get. */
function n8sFit(workspace: Blockly.WorkspaceSvg): void {
  const margin = 16;
  const box = workspace.getBlocksBoundingBox();
  const content = { width: box.right - box.left, height: box.bottom - box.top };
  const view = workspace.getMetricsManager().getViewMetrics();
  const scale = fittedScale(workspace.scale, content, view);
  const fits = content.width * workspace.scale + 2 * margin <= view.width && content.height * workspace.scale + 2 * margin <= view.height;
  if (fits || content.width <= 0) {
    return;
  }
  workspace.setScale(scale);
  workspace.scrollBoundsIntoView(box, margin);
}

describe('fitBlocksIntoView for the other labs: as N8s made it (N18 bt-lab-fix, c4)', () => {
  it('leaves a program that fits alone even when it sits out of sight, and says nothing of a view that has no size', () => {
    const away = fakeWorkspace({ left: 900, top: 700, right: 1100, bottom: 780 }, { width: 400, height: 300 });
    expect(fitBlocksIntoView(away.workspace)).toBe(true);
    expect([away.state.setScale, away.state.scrolled, away.state.scroll]).toEqual([[], [], { left: 0, top: 0 }]);
    const hidden = fakeWorkspace({ left: 0, top: 0, right: 900, bottom: 200 }, { width: 0, height: 0 });
    expect(fitBlocksIntoView(hidden.workspace)).toBe(true);
  });

  it('does exactly what a257eb6 did on every program and view of a grid: the same zoom and the same scroll, call for call', () => {
    const boxes = [
      { left: 0, top: 0, right: 0, bottom: 0 },
      { left: 0, top: 0, right: 200, bottom: 100 },
      { left: 10, top: 10, right: 210, bottom: 110 },
      { left: -120, top: 40, right: 300, bottom: 200 },
      { left: 20, top: 20, right: 1020, bottom: 120 },
      { left: 20, top: 20, right: 320, bottom: 1500 },
      { left: 900, top: 700, right: 1100, bottom: 780 },
      { left: -900, top: -700, right: -300, bottom: -500 },
      { left: 0, top: 0, right: 520, bottom: 330 },
    ];
    const views = [
      { width: 0, height: 0 },
      { width: 120, height: 90 },
      { width: 231, height: 300 },
      { width: 300, height: 400 },
      { width: 400, height: 300 },
      { width: 1000, height: 800 },
    ];
    const scrolls = [{ left: 0, top: 0 }, { left: 400, top: -250 }];
    let compared = 0;
    for (const box of boxes) {
      for (const view of views) {
        for (const scroll of scrolls) {
          for (const scale of [1, 0.8]) {
            const before = fakeWorkspace(box, view, scroll, scale);
            const now = fakeWorkspace(box, view, scroll, scale);
            n8sFit(before.workspace);
            expect(fitBlocksIntoView(now.workspace)).toBe(true);
            expect(now.state).toEqual(before.state);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(boxes.length * views.length * scrolls.length * 2);
  });

  it('keeps 0.6 as its smallest scale: the robot lab’s 0.5 is not theirs', () => {
    const wide = { left: 20, top: 20, right: 1020, bottom: 120 };
    const other = fakeWorkspace(wide, { width: 300, height: 400 });
    fitBlocksIntoView(other.workspace);
    expect(other.state.scale).toBe(minFitScale);
    expect(minFitScale).toBe(0.6);
  });
});
