import { describe, expect, it } from 'vitest';
import type { DcMotorSpec } from '../../hardware/kit';
import { cos, sin } from '../dmath';
import { degToRad, yawToQuaternion, type Vec3 } from '../units';
import { dcMotorModel } from './dc-motor';
import { driveImpulse, groundFrame, type DriveGeometry, type WheelDrive } from './drive';

// N18 R3.3, ADR 0001 §5.3 model (c): each tick the drive gives the dynamic chassis the impulse that brings it to the
// diff-drive velocity of its wheel references, each wheel's share held between 0 and the motor's torque line and within its
// grip, and cancels side slip at the axle. Pure arithmetic: these cases need no physics world.

const spec: DcMotorSpec = { maxRpm: 200, tauS: 0.05, stallTorqueNm: 0.15, wheelRadiusCm: 3.3, wheelWidthCm: 2.6 };
const motor = dcMotorModel(spec);
const DT = 1 / 120;
const r = 0.033;
const omega0 = motor.noLoadRadS;
const geometry: DriveGeometry = { massKg: 0.4, yawInertia: 0.002, halfTrackM: 0.075, comAheadOfAxleM: 0.015, gripForceN: [1.5, 1.5] };
const wheel = (drive: number, referenceRadS: number, grounded = true): WheelDrive => ({ motor, drive, referenceRadS, grounded });
const facingX = groundFrame(yawToQuaternion(0))!;
const still: Vec3 = { x: 0, y: 0, z: 0 };

function close(actual: Vec3, expected: Vec3) {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBe(0);
  expect(actual.z).toBeCloseTo(expected.z, 12);
}

describe('groundFrame', () => {
  it('is the chassis forward axis laid flat on the floor, unit length', () => {
    const frame = groundFrame(yawToQuaternion(degToRad(30)))!;
    expect(frame.fx).toBeCloseTo(cos(degToRad(30)), 15);
    expect(frame.fz).toBeCloseTo(-sin(degToRad(30)), 15);
    // Pitched 30° nose-up, the forward axis still lies along +X on the floor.
    const pitched = groundFrame({ x: 0, y: 0, z: sin(degToRad(15)), w: cos(degToRad(15)) })!;
    expect(pitched.fx).toBeCloseTo(1, 15);
    expect(pitched.fz).toBeCloseTo(0, 15);
  });

  it('is null for a chassis standing on its tail: no wheel touches the floor the way it drives', () => {
    expect(groundFrame({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })).toBeNull();
  });
});

describe('driveImpulse', () => {
  it('does nothing to a chassis at rest whose wheels aim at rest', () => {
    const impulse = driveImpulse(geometry, facingX, still, 0, wheel(0, 0), wheel(0, 0), DT);
    expect(impulse).toEqual({ linear: { x: 0, y: 0, z: 0 }, yaw: 0, wheelSpeedsRadS: [0, 0] });
  });

  it('brings the chassis to the references in one tick when the torque line and grip allow it, along its heading', () => {
    const frame = groundFrame(yawToQuaternion(degToRad(30)))!;
    const impulse = driveImpulse(geometry, frame, still, 0, wheel(1, 1), wheel(1, 1), DT);
    // vt = r·ω_ref = 0.033 m/s; m·vt = 0.0132 N·s, 0.0066 per wheel: under the grip (1.5 N · dt = 0.0125) and the line.
    close(impulse.linear, { x: 0.0132 * frame.fx, y: 0, z: 0.0132 * frame.fz });
    expect(impulse.yaw).toBe(0);
  });

  it('holds each wheel to the torque line T_s·(u − ω/ω₀) at the speed it rolls at', () => {
    // u = 0.25, the chassis already rolls at 0.2·ω₀: the line leaves T_s·0.05 = 0.0075 N·m per wheel.
    const rolling: Vec3 = { x: 0.2 * omega0 * r, y: 0, z: 0 };
    const impulse = driveImpulse(geometry, facingX, rolling, 0, wheel(0.25, omega0), wheel(0.25, omega0), DT);
    const perWheel = ((0.15 * (0.25 - 0.2)) / r) * DT;
    close(impulse.linear, { x: 2 * perWheel, y: 0, z: 0 });
    expect(impulse.wheelSpeedsRadS[0]).toBeCloseTo(0.2 * omega0, 12);
    expect(impulse.wheelSpeedsRadS[1]).toBeCloseTo(0.2 * omega0, 12);
  });

  it('never pushes harder than the tyre grips, μ·N·dt per wheel', () => {
    const impulse = driveImpulse(geometry, facingX, still, 0, wheel(1, omega0), wheel(1, omega0), DT);
    close(impulse.linear, { x: 2 * 1.5 * DT, y: 0, z: 0 });
  });

  it('never drives against the torque line: a wheel faster than u·ω₀ only brakes', () => {
    // u = 0.9 but the chassis rolls at ω₀: the line is −T_s/10, so the drive may only slow it, by at most that per wheel.
    const fast: Vec3 = { x: omega0 * r, y: 0, z: 0 };
    const impulse = driveImpulse(geometry, facingX, fast, 0, wheel(0.9, 0.9 * omega0), wheel(0.9, 0.9 * omega0), DT);
    close(impulse.linear, { x: -2 * ((0.015 / r) * DT), y: 0, z: 0 });
  });

  it('spins in place on opposite references: yaw impulse I·Δω, no forward push', () => {
    const impulse = driveImpulse(geometry, facingX, still, 0, wheel(-1, -1), wheel(1, 1), DT);
    const yawRate = r / 0.075;
    const jYaw = (0.002 * yawRate) / 0.075;
    expect(impulse.yaw).toBeCloseTo(0.075 * jYaw, 15);
    // The centre of mass, 1.5 cm ahead of the axle, swings left at ω·d: the side impulse gives it that speed.
    expect(impulse.linear.x).toBeCloseTo(0, 15);
    expect(impulse.linear.z).toBeCloseTo(-0.4 * yawRate * 0.015, 15);
  });

  it('cancels side slip at the axle, within the grip of both wheels', () => {
    const sliding: Vec3 = { x: 0, y: 0, z: -0.01 }; // 1 cm/s to the left (−Z when facing +X)
    const impulse = driveImpulse(geometry, facingX, sliding, 0, wheel(0, 0), wheel(0, 0), DT);
    close(impulse.linear, { x: 0, y: 0, z: 0.4 * 0.01 });
    const fast: Vec3 = { x: 0, y: 0, z: -1 };
    close(driveImpulse(geometry, facingX, fast, 0, wheel(0, 0), wheel(0, 0), DT).linear, { x: 0, y: 0, z: 3 * DT });
  });

  it('gets no push from a wheel off the floor, and nothing at all when both are off', () => {
    const one = driveImpulse(geometry, facingX, still, 0, wheel(1, 1, false), wheel(1, 1), DT);
    expect(one.linear.x).toBeCloseTo(0.0066, 15);
    // The right wheel alone pushes: the robot turns left.
    expect(one.yaw).toBeCloseTo(0.075 * 0.0066, 15);
    const lifted = driveImpulse(geometry, facingX, { x: 0.1, y: 0, z: 0.1 }, 0.5, wheel(1, omega0, false), wheel(1, omega0, false), DT);
    expect([lifted.linear, lifted.yaw]).toEqual([{ x: 0, y: 0, z: 0 }, 0]);
  });
});
