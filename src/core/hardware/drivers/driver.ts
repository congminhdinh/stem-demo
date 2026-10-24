import type { PinCap } from '../board';
import type { DriverId, KitPort } from '../kit';
import type { DriverIO, PinMode } from '../virtual-uno';

// A driver (N18 R1.4, robot plan §4.3) is reviewed code, written twice: `sim` for the simulator, on the virtual UNO's pins,
// and `cpp` for the generated sketch, as the UNO contract's forms and helper texts (docs/uno-compatibility-contract.md §2.3,
// §6). Both sides must give the same pin levels; tests pin `cpp` to the contract's data and `sim` to its semantics.
//
// §4.3 gives one `sim` and one `cpp.call` per driver. The contract has one row per op, and two drivers have two ops (the
// buzzer's tone and stop, a line sensor's dark and raw), so a driver here holds §4.3's `{ sim, cpp }` once per op, keyed by
// the IR op name (`motor.set`, plan §4.4). The setup lines, globals, includes, libraries and helper are the row's too: the
// generator writes them only for the rows a program uses (contract §2.3).

export type CppLibrary = { readonly name: string; readonly version: string; readonly license: string };

/** The Arduino AVR core and the Servo library, as the contract pins them (§1, §2.2). */
export const arduinoCore: CppLibrary = { name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' };
export const servoLibrary: CppLibrary = { name: 'Servo', version: '1.3.0', license: 'LGPL-2.1' };

/** One line of the generated setup() for a port, and the same step on the virtual UNO. Pins are the driver's pin names. */
export type SetupStep =
  | { readonly kind: 'pinMode'; readonly pin: string; readonly mode: PinMode }
  /** `<role>.attach(<ROLE>_PIN); <role>.write(angle);`: the servo starts at a known angle on both sides (contract D5). */
  | { readonly kind: 'servoAttach'; readonly pin: string; readonly angle: number };

/** The range an op clamps an argument to, warning value-clamped once per role per run (contract §0.5). */
export type ArgRange = { readonly name: string; readonly min: number; readonly max: number };

export type DriverOpCpp = {
  readonly libraries: readonly CppLibrary[];
  readonly includes: readonly string[];
  /** The helper the row writes once per sketch, by the contract's id; null when it writes none. */
  readonly helper: { readonly id: string; readonly text: string } | null;
  globals(port: KitPort, role: string): string[];
  setup(port: KitPort, role: string): string[];
  /** The statement (a call) or expression (a read) for already-written argument expressions. */
  call(port: KitPort, role: string, argExprs: readonly string[]): string;
};

export type DriverOp = {
  readonly kind: 'call' | 'read';
  /** The contract row whose forms and semantics this op has (`U-20`). */
  readonly row: string;
  /** Per argument: its range, or null for a truth value (non-zero is true). */
  readonly args: readonly (ArgRange | null)[];
  /** Present when the op exists only if a pin of the port has a capability (`line.raw` needs an analog pin). */
  readonly requires?: { readonly pin: string; readonly cap: PinCap };
  readonly setup: readonly SetupStep[];
  sim(io: DriverIO, port: KitPort, args: readonly number[]): void | number | boolean;
  readonly cpp: DriverOpCpp;
};

export type Driver = {
  readonly id: DriverId;
  /** By IR op name, in the order the generator and the binding set them up. */
  readonly ops: Readonly<Record<string, DriverOp>>;
  /** Every library the driver's ops may need. */
  readonly libraries: readonly CppLibrary[];
  /** `#define <ROLE>_<PIN> <n>` for each pin of the port (contract §2.1). */
  defines(port: KitPort, role: string): string[];
};

/** `motorLeft` → `MOTOR_LEFT`, `servo1` → `SERVO1`: the `<ROLE>` of the contract's forms. */
export const roleMacro = (role: string): string => role.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/** `MOTOR_LEFT_EN`: the macro of a port pin. */
export const pinMacro = (role: string, pin: string): string => `${roleMacro(role)}_${pin}`;

/** The Arduino pin number of a header pin: `D5` → `5`; the analog pins keep their constant (`A0`). */
export const arduinoPin = (pin: string): string => /^D(\d+)$/.exec(pin)?.[1] ?? pin;

/** The board pin of a port pin (`EN` → `D5`). loadKit made sure it exists. */
export function pinOf(port: KitPort, name: string): string {
  const pin = port.pins[name];
  if (pin === undefined) {
    throw new Error(`Port ${port.id} has no pin ${name}`);
  }
  return pin;
}

/** The setup lines of steps, as C++. */
export function setupLines(steps: readonly SetupStep[], role: string): string[] {
  return steps.flatMap((step) =>
    step.kind === 'pinMode'
      ? [`pinMode(${pinMacro(role, step.pin)}, ${step.mode});`]
      : [`${role}.attach(${pinMacro(role, step.pin)});`, `${role}.write(${String(step.angle)});`],
  );
}

/** Runs setup steps on the virtual UNO. */
export function runSetup(io: DriverIO, port: KitPort, steps: readonly SetupStep[]): void {
  for (const step of steps) {
    if (step.kind === 'pinMode') {
      io.pinMode(pinOf(port, step.pin), step.mode);
    } else {
      io.servoWrite(pinOf(port, step.pin), step.angle);
    }
  }
}

/** Integer clamp, as the helpers do after the (long) argument arrives. */
export const clampTo = (range: ArgRange, value: number): number => Math.min(range.max, Math.max(range.min, Math.trunc(value)));

type OpDefinition = Omit<DriverOp, 'cpp'> & {
  readonly cpp: Omit<DriverOpCpp, 'setup' | 'globals' | 'libraries' | 'includes'> &
    Partial<Pick<DriverOpCpp, 'globals' | 'libraries' | 'includes'>>;
};

/** An op whose C++ setup lines are its setup steps; no globals, no include and the core library unless it says otherwise. */
export function defineOp(op: OpDefinition): DriverOp {
  return {
    ...op,
    cpp: {
      libraries: op.cpp.libraries ?? [arduinoCore],
      includes: op.cpp.includes ?? [],
      helper: op.cpp.helper,
      globals: op.cpp.globals ?? (() => []),
      setup: (_port, role) => setupLines(op.setup, role),
      call: op.cpp.call,
    },
  };
}

export function defineDriver(id: DriverId, ops: Record<string, DriverOp>): Driver {
  const libraries = new Map<string, CppLibrary>();
  for (const op of Object.values(ops)) {
    for (const library of op.cpp.libraries) {
      libraries.set(`${library.name}@${library.version}`, library);
    }
  }
  return {
    id,
    ops,
    libraries: [...libraries.values()],
    defines: (port, role) => Object.entries(port.pins).map(([name, pin]) => `#define ${pinMacro(role, name)} ${arduinoPin(pin)}`),
  };
}
