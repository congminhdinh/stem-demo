import type { DcMotorSpec } from '../../hardware/kit';
import { cmToM } from '../units';

// A DC gear motor and its wheel, as the robot's drive uses it (N18 R3.3, ADR 0001 §5.3, §7.3). Plain arithmetic, no Rapier:
// the drive (drive.ts) asks it which wheel speed to aim at and which torques the motor can give, then turns those into a
// push on the chassis.
//
// - The command is what the H-bridge does with the motor: a PWM duty on EN and a direction from IN1/IN2 (R3.6 reads them off
//   the virtual UNO). u = dir × duty/255 is the fraction of the supply the motor sees.
// - The target wheel speed is ω_target = u·ω₀ (ω₀ = maxRpm, the no-load speed of the torque line at full duty). The speed
//   the drive aims at, the reference, follows it through a first-order lag of `tauS`.
// - The torque the motor gives at wheel speed ω is the DC motor line T = T_s·(u − ω/ω₀): the stall torque T_s·u at rest,
//   nothing at u·ω₀, braking past it. The drive puts any torque between 0 and that line on the wheel (`torqueRange`):
//   enough to hold the reference when the line allows it, never more than the line, never against it.
// - The gearbox's Coulomb friction T_f (`gearFrictionNm`) resists the wheel turning either way and holds a wheel at rest
//   until more than T_f turns it. It is not the drive's: assembly.ts gives each wheel's floor support the friction that
//   makes T_f at the wheel, so the physics solver applies it within the step, against the drive and against anything that
//   pushes the robot. Hence a running wheel settles where the line meets the friction, T_s·(u − ω/ω₀) = T_f: unloaded at
//   ω₀·(u − T_f/T_s), under ω₀·u; a duty below T_f/T_s · 255 does not start the robot.
// - Braking (IN1 = IN2 with EN on) shorts the motor: u = 0 and the reference drops to 0 at once, so the wheel slows as fast
//   as the line −T_s·ω/ω₀ (proportional to its speed) plus the friction let it, and at rest the friction holds it. Coasting
//   (EN off or no direction) also has u = 0, but the reference only decays through the lag.

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
  /** T_f: the gearbox's Coulomb friction at the wheel, N·m (applied by the solver at the wheel's support, assembly.ts). */
  readonly gearFrictionNm: number;
  readonly wheelRadiusM: number;
};

export function dcMotorModel(spec: DcMotorSpec): DcMotorModel {
  return {
    noLoadRadS: (spec.maxRpm * 2 * Math.PI) / 60,
    tauS: spec.tauS,
    stallTorqueNm: spec.stallTorqueNm,
    gearFrictionNm: spec.gearFrictionNm,
    wheelRadiusM: cmToM(spec.wheelRadiusCm),
  };
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

/** Throws a RangeError for a command the H-bridge cannot give (duty outside 0..255 or not a number, dir not −1, 0 or 1). */
export function checkMotorCommand(command: MotorCommand): void {
  if (!(command.duty >= 0 && command.duty <= PWM_DUTY_MAX)) {
    throw new RangeError(`A motor's duty is 0..${PWM_DUTY_MAX}, not ${command.duty}.`);
  }
  if (command.dir !== -1 && command.dir !== 0 && command.dir !== 1) {
    throw new RangeError(`A motor's dir is -1, 0 or 1, not ${String(command.dir)}.`);
  }
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
      checkMotorCommand(next);
      command = { duty: next.duty, dir: next.dir, brake: next.brake };
      drive = driveFraction(command);
    },
    advance(dt) {
      if (command.brake) {
        reference = 0;
        return;
      }
      // Tustin (bilinear) form of τ·dω/dt = ω_target − ω: 1 − ((2τ − dt)/(2τ + dt))ⁿ after n steps, 63.3 % after τ at
      // 120 Hz and τ = 50 ms, close to the continuous 1 − 1/e. Exact arithmetic (an exact-decay factor would need exp(), which
      // engines may round differently, D-R12). Below τ = dt/2 the factor passes 1 and would overshoot: follow at once.
      const factor = (2 * dt) / (2 * model.tauS + dt);
      reference += (drive * model.noLoadRadS - reference) * Math.min(1, factor);
    },
    reset() {
      command = MOTOR_COAST;
      drive = 0;
      reference = 0;
    },
  };
}
