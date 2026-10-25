import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import {
  arenaToThree,
  boxBody,
  cylinderBody,
  dynamicBodyIds,
  fitCameraDistance,
  idleSnapshot,
  quatToThree,
  robotPointToThree,
  sameView,
  servoArmYawRad,
  wallBox,
  wheelSpin,
  writePose,
  yawQuat,
} from './scene-math';

// N18 R4.2: the arithmetic of the 3D view. The world is the physics' (units.ts, snapshot.ts): the arena plane is the floor with arena x
// along +X and arena y along −Z, heights along +Y, in metres; a quaternion of the arena frame (x right, y away, z up) is (x, z, −y, w)
// in three.js. The view must draw what the physics simulates, so these numbers are exact.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const driveToZone = scenarioCatalog.get('rb-drive-to-zone')!;

describe('the frame of the 3D view (N18 R4.2)', () => {
  it('puts an arena point (cm, z up) at (x, z, −y) / 100 m, never at −0', () => {
    expect(arenaToThree(25, 40, 3)).toEqual([0.25, 0.03, -0.4]);
    expect(Object.is(arenaToThree(0, 0, 0)[2], 0)).toBe(true);
    expect(robotPointToThree([7.5, 0, 4])).toEqual([0.075, 0.04, 0]);
    expect(robotPointToThree([-2, 7.5, 3.3])).toEqual([-0.02, 0.033, -0.075]);
  });

  it('turns a quaternion of the arena frame into three’s as (x, z, −y, w), and a yaw into a turn about +Y', () => {
    expect(quatToThree({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 })).toEqual([0.1, 0.3, -0.2, 0.9]);
    const [x, y, z, w] = yawQuat(90);
    expect([x, z]).toEqual([0, 0]);
    expect(y).toBeCloseTo(Math.SQRT1_2, 15);
    expect(w).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it('writes a pose into an object without making anything new (for useFrame)', () => {
    const calls: unknown[] = [];
    const target = { position: { set: (...xyz: number[]) => calls.push(['position', ...xyz]) }, quaternion: { set: (...xyzw: number[]) => calls.push(['quaternion', ...xyzw]) } };
    writePose(target, { xCm: 10, yCm: 20, zCm: 1, yawDeg: 0, rotation: { x: 0, y: 0, z: 0.5, w: 0.8 } });
    expect(calls).toEqual([
      ['position', 0.1, 0.01, -0.2],
      ['quaternion', 0, 0.5, 0, 0.8],
    ]);
  });

  it('spins a wheel about −Z as it rolls forward, and swings a servo arm by the mount’s yaw plus its angle', () => {
    expect(wheelSpin(1.5)).toBe(-1.5);
    expect(servoArmYawRad(-90, 0)).toBeCloseTo(-Math.PI / 2, 15);
    expect(servoArmYawRad(-90, 90)).toBe(0);
    expect(servoArmYawRad(-90, 180)).toBeCloseTo(Math.PI / 2, 15);
  });
});

describe('the arena’s bodies in the 3D view (N18 R4.2)', () => {
  it('builds a wall on its centre line, square ends thickness / 2 past both points', () => {
    expect(wallBox({ fromCm: [0, 1], toCm: [160, 1], thicknessCm: 2, heightCm: 10, tags: [], ultrasonic: true })).toEqual({
      position: [0.8, 0.05, -0.01],
      size: [1.62, 0.1, 0.02],
      yawRad: 0,
    });
    const diagonal = wallBox({ fromCm: [10, 10], toCm: [40, 50], thicknessCm: 4, heightCm: 20, tags: [], ultrasonic: true });
    expect(diagonal.position).toEqual([0.25, 0.1, -0.3]);
    expect(diagonal.size[0]).toBeCloseTo(0.54, 15);
    expect(diagonal.yawRad).toBeCloseTo(Math.atan2(40, 30), 15);
  });

  it('stands a box and a cylinder on the floor: a box sized [x, y, height] is [x, height, y] in three, turned by its yaw', () => {
    expect(boxBody({ centerCm: [50, 30], sizeCm: [10, 6, 8], yawDeg: 30 })).toEqual({ position: [0.5, 0.04, -0.3], size: [0.1, 0.08, 0.06], yawRad: Math.PI / 6 });
    expect(cylinderBody({ centerCm: [20, 70], radiusCm: 3, heightCm: 12 })).toEqual({ position: [0.2, 0.06, -0.7], radiusM: 0.03, heightM: 0.12 });
  });

  it('names the moving bodies as the snapshot does: dynamic boxes, dynamic cylinders, then the objects, an unnamed one by its index', () => {
    expect(
      dynamicBodyIds({
        boxes: [
          { centerCm: [1, 1], sizeCm: [1, 1, 1], yawDeg: 0, body: 'fixed', tags: [], ultrasonic: true },
          { centerCm: [1, 1], sizeCm: [1, 1, 1], yawDeg: 0, body: 'dynamic', massG: 10, tags: [], ultrasonic: true },
          { id: 'crate', centerCm: [1, 1], sizeCm: [1, 1, 1], yawDeg: 0, body: 'dynamic', massG: 10, tags: [], ultrasonic: true },
        ],
        cylinders: [{ centerCm: [1, 1], radiusCm: 1, heightCm: 1, body: 'dynamic', massG: 5, tags: [], ultrasonic: true }],
        objects: [{ shape: 'cylinder', id: 'cone', centerCm: [1, 1], radiusCm: 1, heightCm: 1, massG: 5, tags: [], ultrasonic: true }],
      }),
    ).toEqual(['#box-1', 'crate', '#cylinder-0', 'cone']);
  });

  it('fits the arena’s bounding sphere into the narrower of the two fields of view', () => {
    // r = ½·√(1.6² + 0.8²) = 0.894427…; the vertical 40° is narrower than the horizontal one at 1.5:1, so d = r / sin 20°.
    expect(fitCameraDistance({ widthM: 1.6, depthM: 0.8 }, 40, 1.5)).toBeCloseTo(0.894427191 / Math.sin(Math.PI / 9), 9);
    // At 0.5:1 the horizontal field is the narrower one: 2·atan(tan 20° · 0.5).
    const horizontal = 2 * Math.atan(Math.tan(Math.PI / 9) * 0.5);
    expect(fitCameraDistance({ widthM: 1.6, depthM: 0.8 }, 40, 0.5)).toBeCloseTo(0.894427191 / Math.sin(horizontal / 2), 9);
  });
});

describe('the view before a run (N18 R4.2)', () => {
  it('is the scenario’s start: the robot on the floor at the start pose, its servo at rest, its LEDs off, nothing scored', () => {
    const view = idleSnapshot(driveToZone, kit);
    expect(view.t).toBe(0);
    expect(view.status).toBe('idle');
    expect(view.robot).toEqual({ xCm: 25, yCm: 40, zCm: 0, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheelRad: [0, 0], servoDeg: { servo1: 0 } });
    expect(view.objects).toEqual([]);
    expect(view.leds).toEqual({ led1: false });
    expect(view.activeBlockId).toBeNull();
    expect(view.score).toEqual({ points: 0, maxScore: null, goals: [] });
    expect(Object.isFrozen(view.robot)).toBe(true);
  });

  it('turns the robot by the start’s yaw and stands each object to push where the arena puts it', () => {
    const scenario = { ...driveToZone, start: { xCm: 30, yCm: 40, yawDeg: 90 } };
    const arena = {
      ...driveToZone.arena,
      objects: [{ shape: 'box' as const, id: 'crate', centerCm: [60, 40] as [number, number], sizeCm: [6, 6, 4] as [number, number, number], yawDeg: 0, massG: 50, tags: [], ultrasonic: true }],
    };
    const view = idleSnapshot({ ...scenario, arena }, kit);
    expect(view.robot.yawDeg).toBe(90);
    expect(view.robot.rotation.z).toBeCloseTo(Math.SQRT1_2, 15);
    expect(view.robot.rotation.w).toBeCloseTo(Math.SQRT1_2, 15);
    expect(view.objects).toEqual([{ id: 'crate', kind: 'object', pose: { xCm: 60, yCm: 40, zCm: 2, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 } } }]);
  });
});

describe('whether a new snapshot changes the picture (N18 R4.2)', () => {
  const base = idleSnapshot(driveToZone, kit);
  const moved = (changes: Partial<RobotSnapshot['robot']>): RobotSnapshot => ({ ...base, robot: { ...base.robot, ...changes } });

  it('is the same picture for the same poses, even at another time or score, and for two empty views', () => {
    expect(sameView(base, { ...base, t: 3, score: { points: 30, maxScore: 100, goals: [] } })).toBe(true);
    expect(sameView(null, null)).toBe(true);
    expect(sameView(base, null)).toBe(false);
    expect(sameView(base, moved({ xCm: 25 + 1e-5 }))).toBe(true);
  });

  it('is another picture when the robot, a wheel, the servo, an LED, a line sensor, the buzzer or the button changes', () => {
    expect(sameView(base, moved({ xCm: 25.01 }))).toBe(false);
    expect(sameView(base, moved({ rotation: { x: 0, y: 0, z: 0.01, w: 1 } }))).toBe(false);
    expect(sameView(base, moved({ wheelRad: [0.01, 0] }))).toBe(false);
    expect(sameView(base, moved({ servoDeg: { servo1: 1 } }))).toBe(false);
    expect(sameView(base, { ...base, leds: { led1: true } })).toBe(false);
    const line = { role: 'lineCenter', kind: 'line-sensor' as const, reflectance: 1, dark: false, spotCm: [0, 0] as const };
    expect(sameView({ ...base, sensors: [line] }, { ...base, sensors: [{ ...line, dark: true }] })).toBe(false);
    expect(sameView({ ...base, sensors: [line] }, { ...base, sensors: [{ ...line, reflectance: 0.9 }] })).toBe(true);
    const pin = { pin: 'D10', mode: 'OUTPUT' as const, level: 0 as const, duty: 0, toneHz: null, servoDeg: null };
    expect(sameView({ ...base, pins: [pin] }, { ...base, pins: [{ ...pin, toneHz: 440 }] })).toBe(false);
    expect(sameView({ ...base, pins: [pin] }, { ...base, pins: [{ ...pin, level: 1 }] })).toBe(false);
  });

  it('is another picture when an object moves', () => {
    const object = { id: 'crate', kind: 'object' as const, pose: { xCm: 1, yCm: 1, zCm: 1, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
    expect(sameView({ ...base, objects: [object] }, { ...base, objects: [{ ...object, pose: { ...object.pose, yCm: 1.5 } }] })).toBe(false);
    expect(sameView({ ...base, objects: [object] }, { ...base, objects: [] })).toBe(false);
  });
});
