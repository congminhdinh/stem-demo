import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { robotModel } from './robot-model';
import { createGripperTopView, gripperTopViewInto, heldRingRadiusCm, HELD_RING_GAP_CM, jawCornersCm, objectMarks } from './top-view-gripper';
import type { MovingBody } from './top-view-math';
import { markPattern, OBJECT_PATTERN_MARGIN_CM, patternDots, patternInk, patternSegments, type ZonePatternSpec } from './zone-pattern';

// N19 E4: the gripper car on the 2D map, in the robot's frame (cm, x forward, y left), as the world builds it (world/robot/gripper.ts, ADR 0004
// §2; gripper-pose.ts in the 3D view): the boom from its pivot at the mount, as long from above as its length times the cosine of its
// elevation (boomElevationAtLift0Deg + lift: −40° down, 0° at lift 40, the farthest reach, 50° up); the carriage at its tip; the fingers at
// their hinges, turned out by β = 12 − 0.445·claw (12° open, −23.6° at the jaws' 80°). The held object gets a ring round it, and an object
// of a palette colour its colour's mark.

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const gripper = robotModel(kit, unoR3Board).gripper!;
const view = (clawDeg: number, liftDeg: number) => gripperTopViewInto(createGripperTopView(), gripper, { clawDeg, liftDeg });
const round = (values: readonly number[], digits = 6) => values.map((value) => Math.round(value * 10 ** digits) / 10 ** digits);

describe('the gripper from above (N19 E4)', () => {
  it('lowered and open: the boom reaches 5·cos 40° = 3.83 cm past the pivot, the jaws from x 8.83, turned out 12°', () => {
    const top = view(0, 0);
    expect(round([top.pivotXCm, top.reachCm, top.tipXCm, top.hingeXCm, top.hingeYCm, top.leftDeg, top.rightDeg])).toEqual([4.5, 3.830222, 8.330222, 8.830222, 2.2, 12, -12]);
    // The left finger from its hinge, 5 cm long and 0.4 cm thick, turned out 12°: its tip at 13.72 cm, 3.24 cm left of the middle.
    const left = jawCornersCm(top, gripper, 1);
    expect(round(left.flat(), 4)).toEqual(round([8.830222 - 0.2 * Math.sin((12 * Math.PI) / 180), 2.2 + 0.2 * Math.cos((12 * Math.PI) / 180), 8.830222 + 0.2 * Math.sin((12 * Math.PI) / 180), 2.2 - 0.2 * Math.cos((12 * Math.PI) / 180), 13.720960 + 0.2 * Math.sin((12 * Math.PI) / 180), 3.239558 - 0.2 * Math.cos((12 * Math.PI) / 180), 13.720960 - 0.2 * Math.sin((12 * Math.PI) / 180), 3.239558 + 0.2 * Math.cos((12 * Math.PI) / 180)], 4));
    // The two jaws are mirror images across the robot's middle.
    const right = jawCornersCm(top, gripper, -1);
    expect(round(right.map(([x, y]) => [x, -y]).flat(), 9)).toEqual(round([left[1]!, left[0]!, left[3]!, left[2]!].flat(), 9));
  });

  it('shortens the reach by the cosine of the boom’s elevation: the most at lift 40 (level, 5 cm), 5·cos 50° raised', () => {
    expect(round([view(0, 40).reachCm, view(0, 40).tipXCm])).toEqual([5, 9.5]);
    expect(round([view(0, 90).reachCm, view(0, 90).tipXCm])).toEqual([3.213938, 7.713938]);
    expect(round([view(0, 20).reachCm])).toEqual(round([5 * Math.cos((20 * Math.PI) / 180)]));
  });

  it('turns the fingers in as the claw closes: β = 12 − 0.445·claw, to −23.6° at 80°, never past', () => {
    expect(round([view(80, 0).leftDeg, view(80, 0).rightDeg])).toEqual([-23.6, 23.6]);
    expect(round([view(90, 0).leftDeg])).toEqual([-23.6]);
    // Clamped on a 4 cm cube (B2, measured): the fingers nearly straight.
    expect(round([view(26.473, 0).leftDeg], 4)).toEqual([0.2195]);
  });
});

describe('the ring round the held object (N19 E4)', () => {
  it('is HELD_RING_GAP_CM clear of the object’s corners from above: a box’s half diagonal, a cylinder’s radius', () => {
    expect(HELD_RING_GAP_CM).toBe(0.8);
    const cube: MovingBody = { id: 'cube', shape: 'box', widthCm: 4, depthCm: 4, colorKey: 'object' };
    const can: MovingBody = { id: 'can', shape: 'cylinder', radiusCm: 2, colorKey: 'object' };
    expect(heldRingRadiusCm(cube)).toBeCloseTo(2 * Math.SQRT2 + 0.8, 12);
    expect(heldRingRadiusCm(can)).toBe(2.8);
  });
});

describe('an object’s colour mark on the map (N19 E4)', () => {
  const cube = (fill?: string): MovingBody => ({ id: 'cube', shape: 'box', widthCm: 4, depthCm: 4, colorKey: 'object', ...(fill === undefined ? {} : { fill }) });
  const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const;

  it('is its colour’s pattern in the object’s own frame, kept clear of its edge, in the 2D map’s ink (3:1 on the fill)', () => {
    const red = objectMarks(cube(bodyPalette.red))!;
    expect(red).toEqual({ mark: 'stripes', kind: 'lines', ink: patternInk(bodyPalette.red, 'screen'), widthCm: 0.3, segments: patternSegments(square, markPattern('stripes', 'object') as Extract<ZonePatternSpec, { kind: 'hatch' }>, OBJECT_PATTERN_MARGIN_CM), dots: [] });
    expect(red.segments).toHaveLength(3);
    const green = objectMarks(cube(bodyPalette.green))!;
    expect([green.mark, green.kind, green.segments.length]).toEqual(['grid', 'lines', 6]);
    const blue = objectMarks(cube(bodyPalette.blue))!;
    expect(blue).toMatchObject({ mark: 'dots', kind: 'dots', ink: patternInk(bodyPalette.blue, 'screen'), widthCm: 0.76, segments: [] });
    expect(blue.dots).toEqual(patternDots(square, markPattern('dots', 'object') as Extract<ZonePatternSpec, { kind: 'dots' }>, OBJECT_PATTERN_MARGIN_CM));
    expect(blue.dots).toHaveLength(7);
  });

  it('is none for yellow, another colour, an object without one, and a body of the arena that is no object', () => {
    expect(objectMarks(cube(bodyPalette.yellow))).toBeNull();
    expect(objectMarks(cube('#8e24aa'))).toBeNull();
    expect(objectMarks(cube())).toBeNull();
    expect(objectMarks({ id: '#box-0', shape: 'box', widthCm: 4, depthCm: 4, colorKey: 'box' })).toBeNull();
  });

  it('fits a cylinder: its pattern cut to the disc', () => {
    const can = objectMarks({ id: 'can', shape: 'cylinder', radiusCm: 2, colorKey: 'object', fill: bodyPalette.red })!;
    expect(can.kind).toBe('lines');
    for (const [x0, y0, x1, y1] of can.segments) {
      expect(Math.hypot(x0, y0)).toBeLessThanOrEqual(2 - OBJECT_PATTERN_MARGIN_CM + 0.05);
      expect(Math.hypot(x1, y1)).toBeLessThanOrEqual(2 - OBJECT_PATTERN_MARGIN_CM + 0.05);
    }
    expect(can.segments).toHaveLength(3);
  });
});
