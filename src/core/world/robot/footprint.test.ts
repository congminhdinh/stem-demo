import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { ROBOT_FOOTPRINT_RADIUS_CM } from '../../scenario/variants';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { ARM_SWEEP_STEP_DEG, robotFootprint, startFootprintIssues } from './footprint';

// N18 R3.5: the robot seen from above, for the start check of createWorld and the footprint of the goal frame.

const kit = productionKits.get(referenceKitRef) as Kit;
const open: ArenaInput = { ground: { sizeCm: [300, 300], color: '#ffffff' } };
const arena = (extra: Partial<ArenaInput>) => parseArena({ ...open, ...extra });
/** A length to the nanometre (cm to 1e-7), so that a sum such as 3.3 − 2 compares with its decimal. */
const nm = (cm: number) => Math.round(cm * 1e7) / 1e7;

/** The reference kit with its servo where R3.3 had it: 4.5 cm ahead of the centre, a 6 cm arm reaching 3 cm past the body. */
const protruding: Kit = {
  ...kit,
  modules: kit.modules.map((module) =>
    module.role === 'servo1'
      ? { ...module, mount: { ...module.mount, posCm: [4.5, 0, 7] as const }, spec: { ...module.spec, armLengthCm: 6 } }
      : module,
  ),
};

describe('robotFootprint', () => {
  it('outlines ref-uno-rover@0 as the hull of its body and wheels, and reaches 10.27 cm from the centre at a wheel corner', () => {
    const footprint = robotFootprint(kit);
    // Body 15 × 12 cm; wheels 6.6 cm across and 2.6 cm wide on an axle 2 cm back, centres 7.5 cm out: x −5.3..1.3, |y| 6.2..8.8.
    // Counter-clockwise from the back right corner (3.3 − 2 is 1.2999999999999998 in doubles: compared to a nanometre).
    expect(footprint.outlineCm.map(([x, y]) => [nm(x), nm(y)])).toEqual([
      [-7.5, -6],
      [-5.3, -8.8],
      [1.3, -8.8],
      [7.5, -6],
      [7.5, 6],
      [1.3, 8.8],
      [-5.3, 8.8],
      [-7.5, 6],
    ]);
    expect(footprint.radiusCm).toBeCloseTo(Math.hypot(5.3, 8.8), 9);
  });

  it('fits in the circle the scenario variants keep clear (ROBOT_FOOTPRINT_RADIUS_CM), servo arm included', () => {
    expect(robotFootprint(kit).radiusCm).toBeLessThanOrEqual(ROBOT_FOOTPRINT_RADIUS_CM);
  });

  it('counts a servo arm that sticks out: R3.3’s 6 cm arm 4.5 cm ahead reaches 10.51 cm forward', () => {
    // At 90° the arm's tip is 10.5 cm ahead, its corners √(6² + 0.4²) = 6.013 cm from the axis at the farthest.
    expect(robotFootprint(protruding).radiusCm).toBeGreaterThan(10.51);
    expect(robotFootprint(protruding).radiusCm).toBeLessThan(10.53);
    // The outline is what stands on the floor: the arm, 6.25 cm up, is not part of it.
    expect(robotFootprint(protruding).outlineCm).toEqual(robotFootprint(kit).outlineCm);
  });
});

describe('startFootprintIssues', () => {
  const start = { xCm: 100, yCm: 100, yawDeg: 0 };

  it('finds nothing in the open, nor for things the robot only touches', () => {
    expect(startFootprintIssues(arena({}), kit, start)).toEqual([]);
    // A wall whose face is the body's front (x 107.5), a box against its right side past the wheel (y 94), a cylinder at the back.
    const touching = arena({
      walls: [{ fromCm: [108.5, 50], toCm: [108.5, 150] }],
      boxes: [{ centerCm: [104, 92], sizeCm: [4, 4, 4] }],
      cylinders: [{ centerCm: [90.5, 100], radiusCm: 2, heightCm: 5 }],
    });
    expect(startFootprintIssues(touching, kit, start)).toEqual([]);
  });

  it('names the overlapped thing by its arena path and id, and the parts of the robot in it', () => {
    const issues = startFootprintIssues(arena({ walls: [{ id: 'front', fromCm: [108.3, 50], toCm: [108.3, 150] }] }), kit, start);
    expect(issues).toEqual([{ path: 'start', message: 'the robot’s body overlaps walls[0] (front)' }]);
    const corner = arena({ boxes: [{ centerCm: [96, 107], sizeCm: [4, 4, 4] }] });
    expect(startFootprintIssues(corner, kit, start)).toEqual([{ path: 'start', message: 'the robot’s body and left wheel overlap boxes[0] (#box-0)' }]);
    const many = arena({
      cylinders: [{ centerCm: [100, 100], radiusCm: 1, heightCm: 10 }],
      objects: [{ id: 'crate', shape: 'box', centerCm: [98, 93], sizeCm: [4, 4, 4], massG: 50 }],
    });
    expect(startFootprintIssues(many, kit, start)).toEqual([
      { path: 'start', message: 'the robot’s body overlaps cylinders[0] (#cylinder-0)' },
      { path: 'start', message: 'the robot’s body and right wheel overlap objects[0] (crate)' },
    ]);
  });

  it('turns the robot by its yaw: a box beside the body at yaw 0 is in front of it at yaw 90', () => {
    const side = arena({ boxes: [{ centerCm: [105, 110], sizeCm: [6, 6, 6] }] });
    expect(startFootprintIssues(side, kit, start)).toEqual([]);
    expect(startFootprintIssues(side, kit, { ...start, yawDeg: 90 })).toEqual([{ path: 'start', message: 'the robot’s body overlaps boxes[0] (#box-0)' }]);
  });

  it('goes by height: a strip lower than the body’s clearance may lie under it, not under a wheel', () => {
    // 1.5 cm of clearance under the body; the wheels and the caster stand on the floor.
    const under = arena({ boxes: [{ centerCm: [102, 100], sizeCm: [4, 6, 1] }] });
    expect(startFootprintIssues(under, kit, start)).toEqual([]);
    const thick = arena({ boxes: [{ centerCm: [102, 100], sizeCm: [4, 6, 1.6] }] });
    expect(startFootprintIssues(thick, kit, start)).toEqual([{ path: 'start', message: 'the robot’s body overlaps boxes[0] (#box-0)' }]);
    const wheel = arena({ boxes: [{ centerCm: [98, 92.5], sizeCm: [4, 1, 0.2] }] });
    expect(startFootprintIssues(wheel, kit, start)).toEqual([{ path: 'start', message: 'the robot’s right wheel overlaps boxes[0] (#box-0)' }]);
  });

  it('counts the servo arm at every angle it can turn to, not only where it rests', () => {
    // The reference kit's arm never leaves the body's footprint: a box against the body's front is clear of it at every angle.
    const ahead = arena({ boxes: [{ centerCm: [110, 100], sizeCm: [5, 5, 10] }] });
    expect(startFootprintIssues(ahead, kit, start)).toEqual([]);
    // R3.3's arm rests folded (0°: pointing right) but reaches 10.5 cm ahead at 90°: the same box is in its sweep.
    expect(startFootprintIssues(ahead, protruding, start)).toEqual([
      { path: 'start', message: 'the robot’s servo arm of servo1 (anywhere from 0° to 180°) overlaps boxes[0] (#box-0)' },
    ]);
    // Lower than the arm (6.25 cm up), it is clear.
    const low = arena({ boxes: [{ centerCm: [110, 100], sizeCm: [5, 5, 6] }] });
    expect(startFootprintIssues(low, protruding, start)).toEqual([]);
    // Between two of the sampled angles the arm sweeps no more than the samples are grown by.
    expect(ARM_SWEEP_STEP_DEG).toBe(1);
  });

  it('says which variant it is about when it is given one', () => {
    const issues = startFootprintIssues(arena({ walls: [{ id: 'front', fromCm: [108.3, 50], toCm: [108.3, 150] }] }), kit, start, 2);
    expect(issues).toEqual([{ path: 'start', message: 'in variant 2, the robot’s body overlaps walls[0] (front)' }]);
  });
});
