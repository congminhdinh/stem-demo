import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { Arena } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotModel } from './robot-model';
import { idleSnapshot } from './scene-math';
import { fitTopView, movingBodies, NO_ECHO_RAY_CM, rayLengthCm, robotPartCm, sameTopView, scaleBar, treadOffsetCm, wheelRadIndex } from './top-view-math';

// N18 R4.6: the arithmetic of the 2D top view. It draws in the arena's own units: the stage shows the arena with x to the right and y up
// the screen (centimetres), the robot's parts sit at their kit mounts (x forward, y left), and a turn of yawDeg is counter-clockwise on
// screen. Nothing here imports Konva: these are plain numbers, tested exactly.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);

describe('fitTopView (N18 R4.6)', () => {
  const margins = { left: 16, right: 16, top: 16, bottom: 30 };

  it('scales the arena to the widest it can be in the room the margins leave, and centres it', () => {
    // 120 × 80 cm in 660 × 500 px: the room is 628 × 454, the width limits (5.2333 px/cm), the height has 17.67 px to spare each side.
    const fit = fitTopView([120, 80], { width: 660, height: 500 }, margins);
    expect(fit.scale).toBeCloseTo(628 / 120, 9);
    expect(fit.originX).toBeCloseTo(16, 9);
    // The arena's y = 0 edge is its bottom on screen.
    expect(fit.originY).toBeCloseTo(16 + (454 - 80 * fit.scale) / 2 + 80 * fit.scale, 9);
  });

  it('is limited by the height in a tall, narrow stage, and centres across the width', () => {
    const fit = fitTopView([100, 100], { width: 600, height: 300 }, margins);
    expect(fit.scale).toBeCloseTo((300 - 16 - 30) / 100, 9);
    expect(fit.originX).toBeCloseTo(16 + (568 - 100 * fit.scale) / 2, 9);
    expect(fit.originY).toBeCloseTo(300 - 30, 9);
  });

  it('keeps a positive scale in a stage the margins leave no room in', () => {
    const fit = fitTopView([120, 80], { width: 20, height: 20 }, margins);
    expect(fit.scale).toBeGreaterThan(0);
    expect(Number.isFinite(fit.originX) && Number.isFinite(fit.originY)).toBe(true);
  });
});

describe('the scale bar (N18 R4.6)', () => {
  it('is 10 cm long on the stage', () => {
    expect(scaleBar(5.2333)).toEqual({ cm: 10, lengthPx: 52.333 });
    expect(scaleBar(2)).toEqual({ cm: 10, lengthPx: 20 });
  });
});

describe('the robot’s parts in the top view (N18 R4.6)', () => {
  it('reads a part’s place in the robot frame (x forward, y left, cm) from the model’s three.js position', () => {
    // The left line sensor is 7 cm ahead and 1.5 cm to the left; the model keeps it as [0.07, 0.01, -0.015] m (three: +Z is right).
    const [x, y] = robotPartCm([0.07, 0.01, -0.015]);
    expect(x).toBeCloseTo(7, 12);
    expect(y).toBeCloseTo(1.5, 12);
    const right = robotPartCm(model.lineSensors[2]!.position);
    expect([right[0], right[1]]).toEqual([expect.closeTo(7, 12), expect.closeTo(-1.5, 12)]);
    expect(robotPartCm([0, 0.02, 0])).toEqual([0, 0]);
    expect(Object.is(robotPartCm([0, 0, 0])[1], -0)).toBe(false);
  });

  it('turns a wheel’s marker with the wheel: the left wheel is the snapshot’s wheelRad[0], the right one [1]', () => {
    expect(model.wheels.map((wheel) => [wheel.role, wheelRadIndex(wheel)])).toEqual([
      ['motorLeft', 0],
      ['motorRight', 1],
    ]);
    // A mark on the rim seen from above sits at r sin(angle) along the wheel's length, and moves forward as the wheel rolls forward.
    expect(treadOffsetCm(3.3, 0)).toBe(0);
    expect(treadOffsetCm(3.3, Math.PI / 2)).toBeCloseTo(3.3, 12);
    expect(treadOffsetCm(3.3, -Math.PI / 2)).toBeCloseTo(-3.3, 12);
  });
});

describe('the ultrasonic ray (N18 R4.6)', () => {
  it('is drawn to its hit point, and for 40 cm when there is no echo (the 400 cm range would cross the arena)', () => {
    expect(rayLengthCm(37.5, true)).toBe(37.5);
    expect(rayLengthCm(400, true)).toBe(400);
    expect(rayLengthCm(400, false)).toBe(NO_ECHO_RAY_CM);
    expect(NO_ECHO_RAY_CM).toBe(40);
    expect(rayLengthCm(0, true)).toBe(0);
  });
});

describe('the bodies that move (N18 R4.6)', () => {
  const arena: Arena = {
    ground: { sizeCm: [100, 100], color: '#ffffff' },
    paint: { lines: [], zones: [] },
    walls: [],
    boxes: [
      { id: 'fixed', centerCm: [10, 10], sizeCm: [5, 5, 5], yawDeg: 0, body: 'fixed', tags: [], ultrasonic: true },
      { centerCm: [20, 20], sizeCm: [6, 4, 3], yawDeg: 30, body: 'dynamic', massG: 50, tags: [], ultrasonic: true },
    ],
    cylinders: [{ centerCm: [30, 30], radiusCm: 2, heightCm: 5, body: 'dynamic', massG: 40, tags: [], ultrasonic: true }],
    objects: [
      { shape: 'box', id: 'crate', centerCm: [40, 40], sizeCm: [4, 4, 4], yawDeg: 0, massG: 30, tags: [], ultrasonic: true },
      { shape: 'cylinder', id: 'can', centerCm: [50, 50], radiusCm: 3, heightCm: 6, massG: 30, tags: [], ultrasonic: true },
    ],
  };

  it('lists the dynamic boxes, the dynamic cylinders, then the objects, with the ids a snapshot gives them', () => {
    expect(movingBodies(arena)).toEqual([
      { id: '#box-1', shape: 'box', widthCm: 6, depthCm: 4, colorKey: 'box' },
      { id: '#cylinder-0', shape: 'cylinder', radiusCm: 2, colorKey: 'cylinder' },
      { id: 'crate', shape: 'box', widthCm: 4, depthCm: 4, colorKey: 'object' },
      { id: 'can', shape: 'cylinder', radiusCm: 3, colorKey: 'object' },
    ]);
  });
});

describe('sameTopView (N18 R4.6)', () => {
  const scenario = scenarioCatalog.get('rb-stop-at-wall')!;
  const idle = idleSnapshot(scenario, kit);
  const ultrasonic = (cm: number, hitId: string | null = null): SensorReadout => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
  const world = (changes: Partial<RobotSnapshot>): RobotSnapshot => ({ ...idle, status: 'running', ...changes });

  it('is the 3D view’s sameView: a robot at rest, a new time and score draw nothing', () => {
    expect(sameTopView(idle, idle)).toBe(true);
    expect(sameTopView(world({ t: 1, sensors: [ultrasonic(40)] }), world({ t: 2, sensors: [ultrasonic(40)] }))).toBe(true);
    expect(sameTopView(null, null)).toBe(true);
    expect(sameTopView(idle, null)).toBe(false);
    expect(sameTopView(idle, world({ robot: { ...idle.robot, xCm: idle.robot.xCm + 1 } }))).toBe(false);
  });

  it('also sees the ultrasonic ray change: 0.05 cm of distance, or a different thing hit', () => {
    expect(sameTopView(world({ sensors: [ultrasonic(40)] }), world({ sensors: [ultrasonic(40.04)] }))).toBe(true);
    expect(sameTopView(world({ sensors: [ultrasonic(40)] }), world({ sensors: [ultrasonic(40.06)] }))).toBe(false);
    expect(sameTopView(world({ sensors: [ultrasonic(40, 'wall')] }), world({ sensors: [ultrasonic(40, 'crate')] }))).toBe(false);
    expect(sameTopView(world({ sensors: [ultrasonic(40)] }), world({ sensors: [ultrasonic(400)] }))).toBe(false);
  });
});
