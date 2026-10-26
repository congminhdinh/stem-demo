import { describe, expect, it } from 'vitest';
import { cos, sin } from './dmath';
import { GOAL_GRIPPER_RANGE_DEG, tiltDegOf, toGoalFrame, type GoalFrameExtras } from './goal-frame';
import type { Pose, RobotSnapshot, SnapshotQuat } from './snapshot';
import { degToRad } from './units';

// N19 B4 (plan §4.4, §4.5, D-G10): what the pick-and-place goals read of a gripper car's tick. `GoalFrame.gripper` is the snapshot's
// gripper with its angles snapped to a thousandth of a degree and clamped to 0..90; each arena object gains `zCm` (its middle's height),
// `tiltDeg` (how far it leans off standing on a face: atan2(√(1 − m²), m) through dmath, m the largest |local axis · up| of a box, any face
// down standing; |axis · up| of a cylinder), `held` and `restingOn` (the world's, in the extras). A frame without a gripper has none of them.

/** A rotation of `deg` about the arena axis `axis` (arena frame: x right, y away, z up), as a snapshot writes it. */
function about(axis: 'x' | 'y' | 'z', deg: number): SnapshotQuat {
  const half = degToRad(deg) / 2;
  return { x: axis === 'x' ? sin(half) : 0, y: axis === 'y' ? sin(half) : 0, z: axis === 'z' ? sin(half) : 0, w: cos(half) };
}

/** a then b (b applied first): the Hamilton product. */
function then(a: SnapshotQuat, b: SnapshotQuat): SnapshotQuat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

const pose = (xCm: number, yCm: number, zCm: number, rotation: SnapshotQuat = { x: 0, y: 0, z: 0, w: 1 }): Pose => ({ xCm, yCm, zCm, yawDeg: 0, rotation });

const base: RobotSnapshot = {
  t: 2,
  robot: { ...pose(40, 50, 0), wheelRad: [0, 0], servoDeg: {} },
  objects: [
    { id: 'cube', kind: 'object', pose: pose(60, 50, 9.1) },
    { id: 'base', kind: 'object', pose: pose(80, 50, 2) },
    { id: '#box-0', kind: 'box', pose: pose(10, 10, 5) },
  ],
  sensors: [],
  pins: [],
  leds: {},
  activeBlockId: null,
  status: 'running',
  outOfArena: false,
  score: { points: 0, maxScore: null, goals: [] },
};
const extras: GoalFrameExtras = { contacts: [], speedCmS: 0, footprint: { kind: 'polygon', pointsCm: [] }, servoRangeDeg: {} };
const gripperExtras: GoalFrameExtras = {
  ...extras,
  objects: { cube: { shape: 'box', restingOn: [] }, base: { shape: 'box', restingOn: ['#ground'] } },
};

describe('the N19 fields of a goal frame (N19 B4)', () => {
  it('fills the gripper and each object’s height, tilt, hold and support for a gripper car', () => {
    const snapshot: RobotSnapshot = { ...base, robot: { ...base.robot, gripper: { clawDeg: 19.94321, liftDeg: 90.031, heldId: 'cube' } } };
    const frame = toGoalFrame(snapshot, gripperExtras);
    expect(frame.gripper).toEqual({ clawDeg: 19.943, liftDeg: 90, heldId: 'cube' });
    expect(frame.objects).toEqual({
      cube: { xCm: 60, yCm: 50, yawDeg: 0, zCm: 9.1, tiltDeg: 0, held: true, restingOn: [] },
      base: { xCm: 80, yCm: 50, yawDeg: 0, zCm: 2, tiltDeg: 0, held: false, restingOn: ['#ground'] },
    });
    expect(GOAL_GRIPPER_RANGE_DEG).toEqual([0, 90]);
  });

  it('snaps the gripper’s angles to 0.001° and clamps them to 0..90 (the physics leaves them a hair off and past their ends)', () => {
    const at = (clawDeg: number, liftDeg: number) =>
      toGoalFrame({ ...base, robot: { ...base.robot, gripper: { clawDeg, liftDeg, heldId: null } } }, gripperExtras).gripper;
    expect(at(-0.5, -0.0004)).toEqual({ clawDeg: 0, liftDeg: 0, heldId: null });
    expect(at(80.0004, 89.99951)).toEqual({ clawDeg: 80, liftDeg: 90, heldId: null });
    expect(at(-0.0000001, 45.12345)).toEqual({ clawDeg: 0, liftDeg: 45.123, heldId: null });
    expect(Object.is(at(-0.0000001, 0)!.clawDeg, 0)).toBe(true);
  });

  it('adds none of them without a gripper: absent, not undefined (D-G10, the rover’s frames are byte for byte as before)', () => {
    const frame = toGoalFrame(base, gripperExtras);
    expect('gripper' in frame).toBe(false);
    expect(Object.values(frame.objects).map((object) => Object.keys(object).sort().join(','))).toEqual(['xCm,yCm,yawDeg', 'xCm,yCm,yawDeg']);
  });

  it('tipped cube on its face reads tiltDeg ≈ 0, on an edge ≈ 45', () => {
    const box = (rotation: SnapshotQuat) => tiltDegOf(rotation, 'box');
    expect(box(about('x', 90))).toBeCloseTo(0, 5);
    expect(box(about('y', -90))).toBeCloseTo(0, 5);
    expect(box(about('x', 180))).toBeCloseTo(0, 5);
    expect(box(then(about('z', 37), about('y', 90)))).toBeCloseTo(0, 5);
    expect(box(about('x', 45))).toBeCloseTo(45, 5);
    expect(box(about('y', 135))).toBeCloseTo(45, 5);
    expect(box(about('x', 30))).toBeCloseTo(30, 5);
    expect(box(about('x', 60))).toBeCloseTo(30, 5);
    expect(box(then(about('z', 20), about('x', 12)))).toBeCloseTo(12, 5);
    // On a corner: every axis at 54.7356° from up, the most a box can lean off its nearest face.
    // 54.7356° about the floor's diagonal (1, −1, 0)/√2 turns a box's up axis onto its own (1, 1, 1)/√3.
    const half = degToRad(54.735610317245346) / 2;
    expect(box({ x: sin(half) * Math.SQRT1_2, y: 0 - sin(half) * Math.SQRT1_2, z: 0, w: cos(half) })).toBeCloseTo(54.7356, 3);
    // A cylinder stands on an end only.
    expect(tiltDegOf(about('x', 90), 'cylinder')).toBeCloseTo(90, 6);
    expect(tiltDegOf(about('x', 180), 'cylinder')).toBeCloseTo(0, 5);
    expect(tiltDegOf(about('y', 30), 'cylinder')).toBeCloseTo(30, 5);
    // Upright is exactly 0; a rotation a hair over unit length still reads a number.
    expect(box({ x: 0, y: 0, z: 0, w: 1 })).toBe(0);
    expect(box({ x: 0, y: 0, z: 0, w: 1.0000001 })).toBe(0);
  });

  it('measures each object’s tilt in the frame by its shape', () => {
    const lying = { ...base, robot: { ...base.robot, gripper: { clawDeg: 0, liftDeg: 0, heldId: null } }, objects: [{ id: 'can', kind: 'object' as const, pose: pose(60, 50, 2, about('x', 90)) }] };
    expect(toGoalFrame(lying, { ...extras, objects: { can: { shape: 'cylinder', restingOn: ['#ground'] } } }).objects.can!.tiltDeg).toBeCloseTo(90, 6);
    expect(toGoalFrame(lying, { ...extras, objects: { can: { shape: 'box', restingOn: ['#ground'] } } }).objects.can!.tiltDeg).toBeCloseTo(0, 6);
  });
});
