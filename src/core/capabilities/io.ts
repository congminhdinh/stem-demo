// The capability interfaces of the Yolo:Bit-compatible runtime (YB plan §10, YB-CP deliverable 1).
// A program reaches hardware only through these, composed per board and profile; there is no
// monolithic HardwareIO. This file is TYPES ONLY: no peripheral model exists at YB-CP. YB-3 and
// YB-4 add implementations (models, constructs, renderers) behind these shapes and must not
// change them except through a contract amendment (plan, YB-CP "Quyền sở hữu file").
//
// Nothing here is a learner-visible capability: what a profile exposes is decided by the contract
// (exposure gate), not by an interface existing.

import type { Frame } from './frame';

export type ButtonId = 'a' | 'b';

/** Today's `HardwareIO` of the generic board; the legacy interpreter's type is an alias of this. */
export interface DigitalIO {
  digitalWrite(pin: string, level: 0 | 1): void;
  /** The level of the net on the pin right now (floating reads 0 on the generic board). */
  digitalRead(pin: string): 0 | 1;
}

/** 0..4095, the native scale of the board (contract C-25, C-Q6 = Option A). */
export interface AnalogInIO {
  analogRead(pin: string): number;
}

/** Declared by the plan; PWM / analog write is EXCLUDED (contract C-26), so nothing implements it. */
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

export interface ServoIO {
  servoWrite(pin: string, angle: number): void;
}

export interface PulseIO {
  pulseIn(pin: string, level: 0 | 1, timeoutUs: number): number;
}

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
};

export type CapabilityKey = keyof Capabilities;

/**
 * Every key of `Capabilities`, in the order of the plan. The board data (`onboard[].capability`, pin
 * `capabilities`) uses exactly these ids, so a `CapabilitySet` from the board context is a set of them.
 */
export const capabilityKeys = [
  'digital', 'analogIn', 'pwm', 'display', 'buttons', 'sound', 'light', 'temperature', 'motion', 'servo', 'pulse',
] as const satisfies readonly CapabilityKey[];
