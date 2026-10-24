// The capability interfaces of the Yolo:Bit-compatible runtime (YB plan §10, YB-CP deliverable 1).
// A program reaches hardware only through these, composed per board and profile; there is no
// monolithic HardwareIO. This file is TYPES ONLY: no peripheral model exists at YB-CP. YB-3 and
// YB-4 add implementations (models, constructs, renderers) behind these shapes and must not
// change them except through a contract amendment (plan, YB-CP "Quyền sở hữu file").
//
// Nothing here is a learner-visible capability: what a profile exposes is decided by the contract
// (exposure gate), not by an interface existing.
//
// Amendment N18 R2.1 (robot plan §2, recorded in docs/stem-demo-implementation-plan.md §5.1): the UNO-compatible
// family adds, as types only, `modules` (a program's module-level ops, `motor.set(motorLeft, 50)`, which the kit maps
// role → port → driver) to `Capabilities` and `capabilityKeys`, `WireIO` (I²C at the transaction level) and `UnoPinIO`
// (what a driver writes on the virtual UNO, plan §4.3). The virtual UNO (R1) and the drivers implement them.

import type { Frame } from './frame';

export type ButtonId = 'a' | 'b';

/** Today's `HardwareIO` of the generic board; the legacy interpreter's type is an alias of this. */
export interface DigitalIO {
  digitalWrite(pin: string, level: 0 | 1): void;
  /** The level of the net on the pin right now (floating reads 0 on the generic board). */
  digitalRead(pin: string): 0 | 1;
}

/** The native scale of the board: 0..4095 on the Yolo:Bit-compatible one (contract C-25, C-Q6 = Option A), 0..1023 on UNO (N18). */
export interface AnalogInIO {
  analogRead(pin: string): number;
}

/**
 * N17 B5: `write_analog`, a PWM duty 0..1023 on a header pin (contract C-26); run/ybc-pin-io.ts implements it. On UNO (N18) the
 * duty is `analogWrite`'s 0..255. The scale is the board's (`boardScaleOf`).
 */
export interface PwmIO {
  pwmWrite(pin: string, value: number): void;
}

export interface DisplayIO {
  setFrame(frame: Frame): void;
  setBrightness?(level: number): void;
}

export interface ButtonIO {
  isPressed(id: ButtonId): boolean;
  takePresses?(id: ButtonId): number;
}

export interface SoundIO {
  startTone(hz: number): void;
  stopTone(): void;
}

export interface LightIO {
  lightLevel(): number;
}

export interface TemperatureIO {
  temperature(): number;
}

export interface MotionIO {
  acceleration(axis: 'x' | 'y' | 'z'): number;
  gesture?(): string | null;
}

/** N17 B5: `servo_write`, a 180° servo's angle 0..180 on a header pin (contract C-27); run/ybc-pin-io.ts implements it. */
export interface ServoIO {
  servoWrite(pin: string, angle: number): void;
}

export interface PulseIO {
  pulseIn(pin: string, level: 0 | 1, timeoutUs: number): number;
}

/**
 * N18 R2.1: the module-level ops of a robot program (plan §4.4), addressed by the kit's role (`motorLeft`, `ultrasonic`, …).
 * `call` is a statement (`motor.set`, `drive.move`, `servo.set`, …), `read` an expression (`ultrasonic.cm`, `line.dark`, …).
 */
export interface ModuleIO {
  call(role: string, op: string, args: readonly number[]): void;
  read(role: string, op: string): number | boolean;
}

/** N18 R2.1: I²C at the transaction level (plan §4.3, D-R5); a device model answers at its address. */
export interface WireIO {
  write(addr: number, bytes: readonly number[]): void;
  read(addr: number, count: number): number[];
}

/** N18 R2.1: what a driver drives on the virtual UNO (plan §4.3): the pin capabilities above, plus the Arduino calls they lack. */
export type UnoPinIO = DigitalIO &
  AnalogInIO &
  PwmIO &
  ServoIO &
  PulseIO & {
    pinMode(pin: string, mode: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'): void;
    /** `tone(pin, hz)`, or `tone(pin, hz, ms)` for a tone that ends by itself. */
    tone(pin: string, hz: number, ms?: number): void;
    noTone(pin: string): void;
    wire: WireIO;
  };

/** What a board provides to programs. A board implements only the capabilities it really has. */
export type Capabilities = {
  digital?: DigitalIO;
  analogIn?: AnalogInIO;
  pwm?: PwmIO;
  display?: DisplayIO;
  buttons?: ButtonIO;
  sound?: SoundIO;
  light?: LightIO;
  temperature?: TemperatureIO;
  motion?: MotionIO;
  servo?: ServoIO;
  pulse?: PulseIO;
  /** N18 R2.1 amendment: the robot's modules, by kit role. */
  modules?: ModuleIO;
};

export type CapabilityKey = keyof Capabilities;

/**
 * Every key of `Capabilities`, in the order of the plan. The board data (`onboard[].capability`, pin
 * `capabilities`) uses exactly these ids, so a `CapabilitySet` from the board context is a set of them.
 */
export const capabilityKeys = [
  'digital', 'analogIn', 'pwm', 'display', 'buttons', 'sound', 'light', 'temperature', 'motion', 'servo', 'pulse', 'modules',
] as const satisfies readonly CapabilityKey[];
