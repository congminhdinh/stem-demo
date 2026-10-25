import { describe, expect, it } from 'vitest';
import type { DcMotorSpec } from '../../hardware/kit';
import { createDcMotor, dcMotorModel, driveFraction, motorTorque, torqueRange, type MotorCommand } from './dc-motor';

// N18 R3.3: a DC gear motor as the world drives it. Torque line T = T_s·(u − ω/ω₀) (ADR 0001 §7.3), target wheel speed
// ω_target = duty/255 × ω₀ × dir, reached through a first-order lag of tauS.

const spec: DcMotorSpec = { maxRpm: 200, tauS: 0.05, stallTorqueNm: 0.15, wheelRadiusCm: 3.3, wheelWidthCm: 2.6 };
const model = dcMotorModel(spec);
const DT = 1 / 120;
const omega0 = (200 * 2 * Math.PI) / 60;
const forward = (duty: number): MotorCommand => ({ duty, dir: 1, brake: false });

describe('dcMotorModel', () => {
  it('turns the spec into SI: ω₀ from rpm, the wheel radius in metres', () => {
    expect(model).toEqual({ noLoadRadS: omega0, tauS: 0.05, stallTorqueNm: 0.15, wheelRadiusM: 0.033 });
    expect(model.noLoadRadS).toBeCloseTo(20.943951, 6);
  });
});

describe('the torque curve T = T_s·(u − ω/ω₀)', () => {
  it('gives the stall torque T_s·u at ω = 0 and nothing at the no-load speed u·ω₀', () => {
    expect(motorTorque(model, 1, 0)).toBe(0.15);
    expect(motorTorque(model, 0.5, 0)).toBe(0.075);
    expect(motorTorque(model, -1, 0)).toBe(-0.15);
    expect(motorTorque(model, 1, omega0)).toBe(0);
    expect(motorTorque(model, 0.5, omega0 / 2)).toBe(0);
    expect(motorTorque(model, -0.5, -omega0 / 2)).toBe(0);
  });

  it('is a straight line between them, and brakes past the no-load speed', () => {
    expect(motorTorque(model, 1, omega0 / 4)).toBeCloseTo(0.1125, 12);
    expect(motorTorque(model, 0.5, omega0)).toBeCloseTo(-0.075, 12);
    // u = 0 is the shorted motor: the back-EMF brakes in proportion to the speed.
    expect(motorTorque(model, 0, omega0)).toBe(-0.15);
    expect(motorTorque(model, 0, -omega0 / 2)).toBe(0.075);
  });

  it('lets the drive put any torque between 0 and the curve on the wheel', () => {
    expect(torqueRange(model, 1, 0)).toEqual({ min: 0, max: 0.15 });
    expect(torqueRange(model, -1, 0)).toEqual({ min: -0.15, max: 0 });
    expect(torqueRange(model, 0, omega0)).toEqual({ min: -0.15, max: 0 });
    expect(torqueRange(model, 1, omega0)).toEqual({ min: 0, max: 0 });
  });
});

describe('driveFraction (u)', () => {
  it('is dir × duty / 255, and 0 when the motor brakes or has no direction', () => {
    expect(driveFraction(forward(255))).toBe(1);
    expect(driveFraction({ duty: 51, dir: -1, brake: false })).toBe(-0.2);
    expect(driveFraction({ duty: 255, dir: 0, brake: false })).toBe(0);
    expect(driveFraction({ duty: 255, dir: 1, brake: true })).toBe(0);
  });
});

describe('createDcMotor', () => {
  it('aims at ω_target = duty/255 × ω₀ × dir', () => {
    const motor = createDcMotor(spec);
    motor.setCommand(forward(128));
    expect(motor.targetRadS).toBe((128 / 255) * omega0);
    motor.setCommand({ duty: 255, dir: -1, brake: false });
    expect(motor.targetRadS).toBe(-omega0);
  });

  it('reaches the target through a first-order lag: about 63 % after tauS, 99 % after 5 tauS', () => {
    const motor = createDcMotor(spec);
    motor.setCommand(forward(255));
    // Backward Euler, ref += (target − ref) · dt / (tauS + dt): exact arithmetic, no exp().
    motor.advance(DT);
    expect(motor.referenceRadS).toBe((omega0 * DT) / (0.05 + DT));
    for (let tick = 1; tick < 6; tick++) motor.advance(DT);
    expect(motor.referenceRadS / omega0).toBeCloseTo(1 - (6 / 7) ** 6, 12);
    expect(motor.referenceRadS / omega0).toBeCloseTo(0.6034, 4);
    for (let tick = 6; tick < 36; tick++) motor.advance(DT);
    expect(motor.referenceRadS / omega0).toBeGreaterThan(0.99);
  });

  it('follows at once when tauS is 0', () => {
    const motor = createDcMotor({ ...spec, tauS: 0 });
    motor.setCommand(forward(255));
    motor.advance(DT);
    expect(motor.referenceRadS).toBe(omega0);
  });

  it('coasts down through the lag, but drops its reference to 0 at once when it brakes', () => {
    const coasting = createDcMotor(spec);
    const braking = createDcMotor(spec);
    for (const motor of [coasting, braking]) {
      motor.setCommand(forward(255));
      for (let tick = 0; tick < 120; tick++) motor.advance(DT);
    }
    coasting.setCommand({ duty: 0, dir: 0, brake: false });
    braking.setCommand({ duty: 255, dir: 0, brake: true });
    coasting.advance(DT);
    braking.advance(DT);
    expect(coasting.drive).toBe(0);
    expect(coasting.referenceRadS).toBeGreaterThan(0.85 * omega0);
    expect(braking.drive).toBe(0);
    expect(braking.referenceRadS).toBe(0);
  });

  it('starts stopped and goes back to that on reset', () => {
    const motor = createDcMotor(spec);
    expect(motor.command).toEqual({ duty: 0, dir: 0, brake: false });
    motor.setCommand(forward(200));
    motor.advance(DT);
    motor.reset();
    expect([motor.command, motor.referenceRadS, motor.targetRadS]).toEqual([{ duty: 0, dir: 0, brake: false }, 0, 0]);
  });

  it('refuses a command it cannot be given', () => {
    const motor = createDcMotor(spec);
    expect(() => motor.setCommand(forward(256))).toThrow(/duty is 0\.\.255, not 256/);
    expect(() => motor.setCommand(forward(-1))).toThrow(/duty is 0\.\.255, not -1/);
    expect(() => motor.setCommand(forward(Number.NaN))).toThrow(/duty is 0\.\.255, not NaN/);
    expect(() => motor.setCommand({ duty: 10, dir: 2 as 1, brake: false })).toThrow(/dir is -1, 0 or 1, not 2/);
  });
});
