import type { DcMotorSpec } from '../../hardware/kit';
import { cmToM } from '../units';

// A DC gear motor and its wheel, as the robot's drive uses it (N18 R3.3, ADR 0001 §5.3, §7.3). Plain arithmetic, no Rapier:
// the drive (drive.ts) asks it which wheel speed to aim at and which torques the motor can give, then turns those into
// impulses on the chassis.
//
// - The command is what the H-bridge does with the motor: a PWM duty on EN and a direction from IN1/IN2 (R3.6 reads them off
//   the virtual UNO). u = dir × duty/255 is the fraction of the supply the motor sees.
// - The target wheel speed is ω_target = u·ω₀ (ω₀ = maxRpm, the no-load speed at full duty). The speed the drive aims at,
//   the reference, follows it through a first-order lag of `tauS`.
// - The torque the motor gives at wheel speed ω is the DC motor line T = T_s·(u − ω/ω₀): the stall torque T_s·u at rest,
//   nothing at the no-load speed u·ω₀, braking past it. The drive puts any torque between 0 and that line on the wheel
//   (`torqueRange`): enough to hold the reference when the line allows it, never more than the line, never against it.
// - Braking (IN1 = IN2 with EN on) shorts the motor: u = 0 and the reference drops to 0 at once, so the wheel stops as fast
//   as the line −T_s·ω/ω₀ lets it. Coasting (EN off or no direction) also has u = 0, but the reference only decays through
//   the lag. A real gear motor's gearbox stops a coasting rover within a few centimetres; the u = 0 line stands in for that
//   drag (no separate gear-friction constant until the vendor measures one).

/** The highest PWM duty of the UNO (analogWrite 255). */
export const PWM_DUTY_MAX = 255;

/** What the H-bridge does with one motor this tick (R3.6 computes it from the EN, IN1 and IN2 pins). */
export type MotorCommand = {
  /** The PWM duty on EN, 0..255. */
  readonly duty: number;
  /** +1 turns the wheel so the robot drives forward, −1 backward, 0 neither (IN1 = IN2). */
  readonly dir: -1 | 0 | 1;
  /** The motor's terminals are shorted (IN1 = IN2 with EN on): it brakes. Wins over `dir`. */
  readonly brake: boolean;
};

/** No duty, no direction, no brake: the motor coasts. Every motor starts like this. */
export const MOTOR_COAST: MotorCommand = { duty: 0, dir: 0, brake: false };

/** A motor's constants in SI. */
export type DcMotorModel = {
  /** ω₀: the no-load wheel speed at full duty, rad/s. */
  readonly noLoadRadS: number;
  readonly tauS: number;
  /** T_s: the torque at the wheel when stalled at full duty, N·m. */
  readonly stallTorqueNm: number;
  readonly wheelRadiusM: number;
};

export function dcMotorModel(spec: DcMotorSpec): DcMotorModel {
  return { noLoadRadS: (spec.maxRpm * 2 * Math.PI) / 60, tauS: spec.tauS, stallTorqueNm: spec.stallTorqueNm, wheelRadiusM: cmToM(spec.wheelRadiusCm) };
}

/** u: the signed fraction of the supply the motor sees, −1..1. Braking and coasting are both 0. */
export function driveFraction(command: MotorCommand): number {
  return command.brake ? 0 : (command.dir * command.duty) / PWM_DUTY_MAX;
}

/** The DC motor's torque line at drive u and wheel speed ω (rad/s): T = T_s·(u − ω/ω₀), in N·m. */
export function motorTorque(model: DcMotorModel, u: number, omegaRadS: number): number {
  return model.stallTorqueNm * (u - omegaRadS / model.noLoadRadS);
}

/** The torques the drive may put on the wheel at drive u and wheel speed ω: from 0 to the torque line, whichever side it is on. */
export function torqueRange(model: DcMotorModel, u: number, omegaRadS: number): { min: number; max: number } {
  const torque = motorTorque(model, u, omegaRadS);
  return { min: Math.min(0, torque), max: Math.max(0, torque) };
}

/** One motor's state: its command, and the reference speed the drive aims the wheel at. */
export type DcMotor = {
  readonly model: DcMotorModel;
  readonly command: MotorCommand;
  /** u of the current command. */
  readonly drive: number;
  /** ω_target = u·ω₀, rad/s. */
  readonly targetRadS: number;
  /** The speed the drive aims the wheel at, rad/s: ω_target through the lag (0 at once while braking). */
  readonly referenceRadS: number;
  /** Takes a new command; throws a RangeError for one the H-bridge cannot give. */
  setCommand(command: MotorCommand): void;
  /** Moves the reference by one step of `dt` seconds. */
  advance(dt: number): void;
  /** Back to coasting from rest. */
  reset(): void;
};

export function createDcMotor(spec: DcMotorSpec): DcMotor {
  const model = dcMotorModel(spec);
  let command = MOTOR_COAST;
  let drive = 0;
  let reference = 0;
  return {
    model,
    get command() {
      return command;
    },
    get drive() {
      return drive;
    },
    get targetRadS() {
      return drive * model.noLoadRadS;
    },
    get referenceRadS() {
      return reference;
    },
    setCommand(next) {
      if (!(next.duty >= 0 && next.duty <= PWM_DUTY_MAX)) {
        throw new RangeError(`A motor's duty is 0..${PWM_DUTY_MAX}, not ${next.duty}.`);
      }
      if (next.dir !== -1 && next.dir !== 0 && next.dir !== 1) {
        throw new RangeError(`A motor's dir is -1, 0 or 1, not ${String(next.dir)}.`);
      }
      command = { duty: next.duty, dir: next.dir, brake: next.brake };
      drive = driveFraction(command);
    },
    advance(dt) {
      if (command.brake) {
        reference = 0;
        return;
      }
      // Backward Euler of τ·dω/dt = ω_target − ω: stable for any step and exact arithmetic (an exact-decay factor would need
      // exp(), which engines may round differently, D-R12).
      reference += ((drive * model.noLoadRadS - reference) * dt) / (model.tauS + dt);
    },
    reset() {
      command = MOTOR_COAST;
      drive = 0;
      reference = 0;
    },
  };
}
