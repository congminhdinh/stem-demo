import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { ROBOT_FOOTPRINT_RADIUS_CM } from '../../scenario/variants';
import { gripperScene, run, seconds, wait, type GripperScene } from '../__fixtures__/gripper-scene';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { initPhysics } from '../rapier';
import { rotateVector, type Vec3 } from '../units';
import { ARM_SWEEP_STEP_DEG, robotFootprint, startFootprintIssues } from './footprint';
import { conjugate } from './robot-frame';

// N18 R3.5: the robot seen from above, for the start check of createWorld and the footprint of the goal frame.

const kit = productionKits.get(referenceKitRef) as Kit;
const open: ArenaInput = { ground: { sizeCm: [300, 300], color: '#ffffff' } };
const arena = (extra: Partial<ArenaInput>) => parseArena({ ...open, ...extra });
/** A length to the nanometre (cm to 1e-7), so that a sum such as 3.3 − 2 compares with its decimal. */
const nm = (cm: number) => Math.round(cm * 1e7) / 1e7;
const DEG = Math.PI / 180;

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
    // At 90° the arm's tip is 10.5 cm ahead, its corners √(6² + 0.4²) = 6.013 cm from the axis at the farthest: 10.513 cm. The
    // samples are grown to cover the angles between them, by at most 6 · sin ½° (0.52 mm) and 0.1 mm more.
    expect(robotFootprint(protruding).radiusCm).toBeGreaterThan(4.5 + Math.hypot(6, 0.4));
    expect(robotFootprint(protruding).radiusCm).toBeLessThan(4.5 + Math.hypot(6, 0.4) + 6 * Math.sin(Math.PI / 360) + 0.011);
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
    expect(ARM_SWEEP_STEP_DEG).toBe(1);
  });

  it.each([
    [2, 6],
    [4, 6],
    [0.8, 60],
  ])('covers the arm between two sampled angles, whatever its size: a %s cm wide, %s cm long arm', (widthCm, lengthCm) => {
    // A kit whose arm sticks out ahead of the body, and a speck of a cylinder just inside where the arm is at 45.5° and at 90.5°,
    // half-way between two samples: at the tip's corner (what a wide arm's samples miss) and at the middle of its tip (what a long,
    // thin arm's samples miss, between them).
    const wide: Kit = {
      ...kit,
      modules: kit.modules.map((module) =>
        module.role === 'servo1'
          ? { ...module, mount: { ...module.mount, posCm: [4.5, 0, 7] as const }, spec: { ...module.spec, armLengthCm: lengthCm, armWidthCm: widthCm } }
          : module,
      ),
    };
    const inset = 0.001;
    for (const servoDeg of [45.5, 90.5]) {
      const turn = ((-90 + servoDeg) * Math.PI) / 180;
      const along = [Math.cos(turn), Math.sin(turn)] as const;
      const across = [-Math.sin(turn), Math.cos(turn)] as const;
      for (const side of [widthCm / 2 - inset, 0]) {
        const xCm = 150 + 4.5 + (lengthCm - inset) * along[0] + side * across[0];
        const yCm = 150 + (lengthCm - inset) * along[1] + side * across[1];
        const speck = parseArena({ ground: { sizeCm: [300, 300], color: '#ffffff' }, cylinders: [{ centerCm: [xCm, yCm], radiusCm: 0.0001, heightCm: 10 }] });
        expect(startFootprintIssues(speck, wide, { xCm: 150, yCm: 150, yawDeg: 0 }), `${servoDeg}° ${side}`).toEqual([
          { path: 'start', message: 'the robot’s servo arm of servo1 (anywhere from 0° to 180°) overlaps cylinders[0] (#cylinder-0)' },
        ]);
      }
    }
  });

  it('says which variant it is about when it is given one', () => {
    const issues = startFootprintIssues(arena({ walls: [{ id: 'front', fromCm: [108.3, 50], toCm: [108.3, 150] }] }), kit, start, 2);
    expect(issues).toEqual([{ path: 'start', message: 'in variant 2, the robot’s body overlaps walls[0] (front)' }]);
  });
});

// N19 B5 (plan D-G8, §7 B5): the gripper car's footprint sweeps its gripper at every lift and claw angle, each part above its own bottom.
// The proof is against the world's own colliders: the arm posed at angles between the footprint's samples, every corner of every gripper
// collider must lie in a sample of the gripper's part whose bottom is at or under it.
describe('robotFootprint of the gripper car (N19 B5)', () => {
  beforeAll(() => initPhysics(), 30_000);
  const gripper = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
  const NAME = 'gripper (lift anywhere from 0° to 90°, claw anywhere from 0° to 90°)';
  const START = { xCm: 100, yCm: 100, yawDeg: 0 } as const;
  const gripperPart = () => robotFootprint(gripper).parts.find((part) => part.name === NAME)!;

  /** The corners of every gripper collider, in the robot frame (cm), each moved `insetCm` towards its collider's centre. */
  function gripperCorners(scene: GripperScene, insetCm: number): { x: number; y: number; z: number }[] {
    const origin = scene.robot.chassis.translation();
    const unturn = conjugate(scene.robot.chassis.rotation());
    const toRobot = (p: Vec3) => {
      const local = rotateVector(unturn, { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z });
      return { x: local.x * 100, y: -local.z * 100, z: local.y * 100 };
    };
    const corners: { x: number; y: number; z: number }[] = [];
    for (const collider of scene.gripper.colliders) {
      const half = collider.halfExtents()!;
      const centre = collider.translation();
      const turn = collider.rotation();
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const inset = (h: number) => Math.max(0, h - insetCm / 100);
            const offset = rotateVector(turn, { x: sx * inset(half.x), y: sy * inset(half.y), z: sz * inset(half.z) });
            corners.push(toRobot({ x: centre.x + offset.x, y: centre.y + offset.y, z: centre.z + offset.z }));
          }
        }
      }
    }
    return corners;
  }

  /** Whether a point of the robot frame lies in a rectangle of the footprint (seen from above) whose bottom is at or under its height. */
  function covered(point: { x: number; y: number; z: number }): boolean {
    return gripperPart().shapes.some((shape) => {
      if (shape.kind !== 'rect' || (shape.bottomCm ?? Infinity) > point.z) return false;
      const c = Math.cos((shape.yawDeg * Math.PI) / 180);
      const s = Math.sin((shape.yawDeg * Math.PI) / 180);
      const dx = point.x - shape.x;
      const dy = point.y - shape.y;
      return Math.abs(dx * c + dy * s) <= shape.hx && Math.abs(dy * c - dx * s) <= shape.hy;
    });
  }

  function posed(liftDeg: number, clawDeg: number): GripperScene {
    const scene = gripperScene({ ground: { sizeCm: [200, 200], color: '#ffffff' } }, START);
    scene.set({ liftDeg, clawDeg });
    run(scene, wait(seconds(0.6)), seconds(0.6));
    return scene;
  }

  it('reaches farthest at lift 40° with the claw open, 15.24 cm, inside the kit’s 16 cm radius', () => {
    const reach = (liftDeg: number, clawDeg: number) => {
      const scene = posed(liftDeg, clawDeg);
      try {
        return Math.max(...gripperCorners(scene, 0).map(({ x, y }) => Math.hypot(x, y)));
      } finally {
        scene.dispose();
      }
    };
    // The world's colliders: the left finger's outer tip corner, 4.5 + 5 + 0.5 + 5·cos 12° − 0.2·sin 12° = 14.85 cm ahead and
    // 2.2 + 5·sin 12° + 0.2·cos 12° = 3.43 cm aside.
    const byLift = [0, 20, 30, 40, 50, 60, 90].map((liftDeg) => reach(liftDeg, 0));
    expect(byLift.indexOf(Math.max(...byLift))).toBe(3);
    expect(byLift[3]).toBeCloseTo(15.24, 1);
    expect(reach(40, 26.97)).toBeLessThan(byLift[3]!);
    // The footprint covers it, by at most what its samples are grown by (lift and claw ½° each way, a tenth of a millimetre), and the kit's
    // 16 cm clears it.
    const radius = robotFootprint(gripper).radiusCm;
    expect(radius).toBeGreaterThanOrEqual(byLift[3]!);
    expect(radius).toBeLessThan(byLift[3]! + 0.1);
    expect(gripper.chassis?.footprintRadiusCm).toBe(16);
    expect(radius).toBeLessThan(16);
    // What stands on the floor is the rover's: body and wheels.
    expect(robotFootprint(gripper).outlineCm).toEqual(robotFootprint(kit).outlineCm);
  }, 60_000);

  it('covers every gripper collider at angles between its samples, each corner above the bottom of a sample that holds it', () => {
    let checked = 0;
    const missed: string[] = [];
    for (const liftDeg of [0, 0.5, 9.5, 23.5, 39.5, 40.5, 55.5, 71.5, 89.5, 90]) {
      for (const clawDeg of [0, 13.25, 26.97, 51.5, 80]) {
        const scene = posed(liftDeg, clawDeg);
        try {
          for (const corner of gripperCorners(scene, 0.005)) {
            checked += 1;
            if (!covered(corner)) missed.push(`lift ${liftDeg} claw ${clawDeg}: ${corner.x.toFixed(3)}, ${corner.y.toFixed(3)}, ${corner.z.toFixed(3)}`);
          }
        } finally {
          scene.dispose();
        }
      }
    }
    expect(missed).toEqual([]);
    // 10 × 5 poses, 7 colliders (2 boom plates, the cross bar, the carriage, the claw servo's case, 2 fingers), 8 corners each.
    expect(checked).toBe(10 * 5 * 7 * 8);
  }, 120_000);

  it('names the gripper in a start that overlaps where it can reach, by height: low things under the raised arm’s reach are clear', () => {
    const speck = (dx: number, dy: number, heightCm: number) =>
      parseArena({ ground: { sizeCm: [300, 300], color: '#ffffff' }, cylinders: [{ centerCm: [START.xCm + dx, START.yCm + dy], radiusCm: 0.0001, heightCm }] });
    const issue = [{ path: 'start', message: `the robot’s ${NAME} overlaps cylinders[0] (#cylinder-0)` }];
    // Just inside the open fingertip at lift 40° (its farthest), and just past it.
    const tip = { x: 4.5 + 5 + 0.5 + 5 * Math.cos(12 * DEG) - 0.2 * Math.sin(12 * DEG), y: 2.2 + 5 * Math.sin(12 * DEG) + 0.2 * Math.cos(12 * DEG) };
    const along = Math.hypot(tip.x, tip.y);
    expect(startFootprintIssues(speck((tip.x * (along - 0.01)) / along, (tip.y * (along - 0.01)) / along, 10), gripper, START)).toEqual(issue);
    expect(startFootprintIssues(speck((tip.x * (along + 0.1)) / along, (tip.y * (along + 0.1)) / along, 10), gripper, START)).toEqual([]);
    // 15.19 cm out along the open fingertip's direction: only lifts from about 25° to 55° reach that far, where the jaws' bottom is at least
    // 3.05 cm up (z 4.9 + 5·sin(lift − 40°) − 0.6): a 2.5 cm thing there is clear, a 3.5 cm one is not. At lift 0° the jaws end at 13.83 cm.
    const far = (heightCm: number) => speck((tip.x * 15.19) / along, (tip.y * 15.19) / along, heightCm);
    expect(startFootprintIssues(far(2.5), gripper, START)).toEqual([]);
    expect(startFootprintIssues(far(3.5), gripper, START)).toEqual(issue);
    // Under the open left finger lowered (z 1.09–2.29 at lift 0°, its lowest), 3 cm along it from its hinge: 1 cm is clear, 1.2 cm is not.
    const onFinger = { x: 4.5 + 5 * Math.cos(-40 * DEG) + 0.5 + 3 * Math.cos(12 * DEG), y: 2.2 + 3 * Math.sin(12 * DEG) };
    expect(startFootprintIssues(speck(onFinger.x, onFinger.y, 1), gripper, START)).toEqual([]);
    expect(startFootprintIssues(speck(onFinger.x, onFinger.y, 1.2), gripper, START)).toEqual(issue);
    // Between the open jaws, 12 cm ahead, no finger ever comes (closed, their faces meet only near the tips): clear at any height.
    expect(startFootprintIssues(speck(12, 0, 10), gripper, START)).toEqual([]);
    // The rover reaches nothing there.
    expect(startFootprintIssues(speck(onFinger.x, onFinger.y, 10), kit, START)).toEqual([]);
  });

  it('takes an object in its reach as one to pick, not an obstacle: a cube between the open jaws is a clear start, a box there is not', () => {
    // The teleop sandbox's cube (robot-run-session.teleop-gripper.test.ts, e2e/robot-lab-gripper-ui.entry.ts): 4.5 cm past the lowered
    // carriage's origin, where the open claw comes down round it. As an object it is clear: the world builds the arm as setup() leaves it,
    // up and open, and it moves only when told. As a box, an obstacle, the whole sweep counts.
    const ahead = 4.5 + 5 * Math.cos(-40 * DEG) + 4.5;
    const ground = { sizeCm: [300, 300] as [number, number], color: '#ffffff' };
    const cube = parseArena({ ground, objects: [{ id: 'cube', shape: 'box', centerCm: [START.xCm + ahead, START.yCm], sizeCm: [4, 4, 4], massG: 15 }] });
    expect(startFootprintIssues(cube, gripper, START)).toEqual([]);
    const box = parseArena({ ground, boxes: [{ centerCm: [START.xCm + ahead, START.yCm], sizeCm: [4, 4, 4] }] });
    expect(startFootprintIssues(box, gripper, START)).toEqual([{ path: 'start', message: `the robot’s ${NAME} overlaps boxes[0] (#box-0)` }]);
    // Under the arm as setup() leaves it (lift 90°: the open left finger 3 cm from its hinge is at 11.14, 2.82, its bottom 8.13 cm up), a
    // 10 cm object is in it, a 5 cm one is not.
    const raised = { x: 4.5 + 5 * Math.cos(50 * DEG) + 0.5 + 3 * Math.cos(12 * DEG), y: 2.2 + 3 * Math.sin(12 * DEG) };
    const post = (heightCm: number) =>
      parseArena({ ground, objects: [{ id: 'post', shape: 'cylinder', centerCm: [START.xCm + raised.x, START.yCm + raised.y], radiusCm: 0.2, heightCm, massG: 30 }] });
    expect(startFootprintIssues(post(10), gripper, START)).toEqual([
      { path: 'start', message: 'the robot’s gripper (as setup() leaves it: lift 90°, claw 0°) overlaps objects[0] (post)' },
    ]);
    expect(startFootprintIssues(post(5), gripper, START)).toEqual([]);
    expect(robotFootprint(gripper).parts.map((part) => part.name)).toEqual([
      'body',
      'left wheel',
      'right wheel',
      'caster',
      NAME,
      'gripper (as setup() leaves it: lift 90°, claw 0°)',
    ]);
  });
});
