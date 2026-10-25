import type { Capabilities, ModuleIO } from '../capabilities/io';
import { allUses, clampTo, CLOCK_ROLE, driveDirections, DRIVE_ROLE, drivers, MILLIS_OP, moduleUses, roleOps, runSetup, type DriverOp, type ModuleUse } from './drivers';
import { kitPort, type Kit, type KitPort } from './kit';
import type { PinMode, VirtualUno } from './virtual-uno';

// The module binding (N18 R1.4, robot plan §4.3): the `modules` capability of a robot program. `call(role, op, args)` and
// `read(role, op)` take the IR's module ops (plan §4.4: `motor.set`, `servo.set`, `led.set`, `buzzer.tone`, `buzzer.stop`,
// `ultrasonic.cm`, `line.dark`, `line.raw`, `button.pressed`, and `drive.move` / `drive.stop` on the role `drive`) to the
// kit's driver for the role, on the virtual UNO's pins; N18 R2.2 adds the board's `time.millis` on the role `clock`. An argument
// outside its range is clamped with a value-clamped warning, once per role per run (contract §0.5); the driver clamps again, as
// its C++ helper does. (A program's interpreter clamps first and warns with the block, constructs/uno.run.ts, so a program's
// calls reach this one in range.)
//
// Creating the binding is the start of setup(): it runs the setup steps of the ops the program uses, in kit port order, as
// the generated sketch does (contract §2.1; the interpreter's Serial.begin is not a pin step). Without `uses`, every op of
// the kit is set up. A role or op the kit lacks is refused by the compiler (capability-unavailable); reaching one here is a
// programmer error and throws.

/** The arguments of a read (N18 P1: one array for every read, never written). */
const NO_ARGS: readonly number[] = Object.freeze([]);

export type ModuleBinding = ModuleIO & {
  /** The module uses this binding set up. */
  readonly uses: readonly ModuleUse[];
};

export function createModuleIO(kit: Kit, uno: VirtualUno, uses: readonly ModuleUse[] = allUses(kit, uno.board)): ModuleBinding {
  if (kit.board !== uno.board.id) {
    throw new Error(`Kit ${kit.id}@${kit.version} is for ${kit.board}, not ${uno.board.id}`);
  }
  const io = uno.io;

  /** role → its port and the ops it offers, resolved once: a call or read in a tight loop only looks them up. */
  const offered = new Map<string, { port: KitPort; ops: ReadonlySet<string> }>(
    kit.modules.flatMap((module) => {
      const port = kitPort(kit, module.port);
      return port ? [[module.role, { port, ops: new Set(roleOps(kit, uno.board, module.role)) }] as const] : [];
    }),
  );
  /** The port of `role` and the ops it offers; throws for a role the kit lacks. (N18 P1: a call or read allocates nothing here.) */
  const entryOf = (role: string): { port: KitPort; ops: ReadonlySet<string> } => {
    const entry = offered.get(role);
    if (!entry) {
      throw new Error(`Kit ${kit.id}@${kit.version} has no ${role}`);
    }
    return entry;
  };
  /** The driver op `op` of `role` (its `entry`), of `kind`; throws for an op the role lacks or of another kind. */
  const driverOpOf = (role: string, entry: { port: KitPort; ops: ReadonlySet<string> }, op: string, kind: DriverOp['kind']): DriverOp => {
    const { port } = entry;
    const driverOp = drivers[port.driver].ops[op];
    if (!driverOp || !entry.ops.has(op)) {
      throw new Error(`${role} (${port.driver}) has no op ${op}`);
    }
    if (driverOp.kind !== kind) {
      throw new Error(`${op} is a ${driverOp.kind}, not a ${kind}`);
    }
    return driverOp;
  };

  /** Whether `args` are what `clampArgs` would give: one per argument, each a truth value or a whole number within its range. */
  const inRange = (driverOp: DriverOp, args: readonly number[]): boolean => {
    if (args.length !== driverOp.args.length) {
      return false;
    }
    for (let index = 0; index < args.length; index++) {
      const range = driverOp.args[index];
      const value = args[index];
      if (typeof value !== 'number' || (range !== null && range !== undefined && clampTo(range, value) !== value)) {
        return false;
      }
    }
    return true;
  };

  /**
   * The arguments clamped to their ranges, a warning for each one that had to be; `args` itself when none has to be (N18 P1, and the
   * clamping is a function of its own: a function with a closure over its parameters gets a context on every call).
   */
  const clampArgs = (role: string, op: string, driverOp: DriverOp, args: readonly number[]): readonly number[] =>
    inRange(driverOp, args) ? args : clampedArgs(role, op, driverOp, args);
  const clampedArgs = (role: string, op: string, driverOp: DriverOp, args: readonly number[]): number[] =>
    driverOp.args.map((range, index) => {
      const value = args[index] ?? 0;
      if (range === null) {
        return value;
      }
      const clamped = clampTo(range, value);
      if (clamped !== Math.trunc(value)) {
        uno.report({
          severity: 'warning',
          code: 'value-clamped',
          role,
          message: `${op} on ${role}: ${range.name} ${String(value)} is outside ${String(range.min)}..${String(range.max)}, so ${String(clamped)} is used.`,
        });
      }
      return clamped;
    });

  const callOp = (role: string, op: string, args: readonly number[]) => {
    const entry = entryOf(role);
    const driverOp = driverOpOf(role, entry, op, 'call');
    driverOp.sim(io, entry.port, clampArgs(role, op, driverOp, args));
  };

  const drive = (op: string, args: readonly number[]) => {
    if (!roleOps(kit, uno.board, DRIVE_ROLE).includes(op)) {
      throw new Error(`Kit ${kit.id}@${kit.version} has no ${op}: the drive needs motorLeft and motorRight`);
    }
    if (op === 'drive.stop') {
      callOp('motorLeft', 'motor.set', [0]);
      callOp('motorRight', 'motor.set', [0]);
      return;
    }
    const direction = driveDirections[args[0] ?? -1];
    if (direction === undefined) {
      throw new Error(`drive.move has no direction ${String(args[0])}`);
    }
    // The speed is evaluated once (`_s`); −s wraps like neg32, then each motor clamps its own (contract U-21).
    const s = (args[1] ?? 0) | 0;
    const minus = -s | 0;
    const sides: Readonly<Record<(typeof driveDirections)[number], readonly [number, number]>> = {
      forward: [s, s],
      backward: [minus, minus],
      spinLeft: [minus, s],
      spinRight: [s, minus],
    };
    const [left, right] = sides[direction];
    callOp('motorLeft', 'motor.set', [left]);
    callOp('motorRight', 'motor.set', [right]);
  };

  // setup(): the steps of the used ops, port by port in kit order, each step once.
  for (const use of uses) {
    if (!roleOps(kit, uno.board, use.role).includes(use.op)) {
      throw new Error(`Kit ${kit.id}@${kit.version} has no ${use.op} on ${use.role}`);
    }
  }
  const used = new Set(moduleUses(uses).map((use) => `${use.role} ${use.op}`));
  for (const port of kit.ports) {
    const module = kit.modules.find((candidate) => candidate.port === port.id);
    if (!module) {
      continue;
    }
    const done = new Set<string>();
    for (const [name, op] of Object.entries(drivers[port.driver].ops)) {
      if (!used.has(`${module.role} ${name}`)) {
        continue;
      }
      const steps = op.setup.filter((step) => !done.has(JSON.stringify(step)));
      steps.forEach((step) => done.add(JSON.stringify(step)));
      runSetup(io, port, steps);
    }
  }

  return {
    uses: [...uses],
    call(role, op, args) {
      if (role === DRIVE_ROLE) {
        drive(op, args);
        return;
      }
      callOp(role, op, args);
    },
    read(role, op) {
      if (role === CLOCK_ROLE && op === MILLIS_OP) {
        return uno.millis();
      }
      const entry = entryOf(role);
      const driverOp = driverOpOf(role, entry, op, 'read');
      const value = driverOp.sim(io, entry.port, NO_ARGS);
      if (typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`${op} on ${role} gave no value`);
      }
      return value;
    },
  };
}

/**
 * N18 R2.2: the capabilities of a uno program on the virtual UNO. Its module ops go through the binding (whose creation is the start
 * of setup(): the setup steps of `uses.modules`), its raw pins through the virtual UNO's pins (UnoPinIO as `digital`, `pwm`,
 * `analogIn`, contract UNO §9). Then setup() goes on with the raw pins, in the order the program meets them: each module-wired pin
 * a raw digital read names gets the pinMode its driver gives it (`pinMode(<pin>, <mode>);`, U-33: a released button reads HIGH
 * through its INPUT_PULLUP), then each pin a digital write sets is made OUTPUT (`pinMode(<pin>, OUTPUT);`, U-31).
 */
export function createProgramIO(
  kit: Kit,
  uno: VirtualUno,
  uses: {
    readonly modules: readonly ModuleUse[];
    readonly inputPins: readonly { readonly pin: string; readonly mode: PinMode }[];
    readonly outputPins: readonly string[];
  },
): Capabilities & { modules: ModuleBinding } {
  const modules = createModuleIO(kit, uno, uses.modules);
  for (const { pin, mode } of uses.inputPins) {
    uno.io.pinMode(pin, mode);
  }
  for (const pin of uses.outputPins) {
    uno.io.pinMode(pin, 'OUTPUT');
  }
  return { modules, digital: uno.io, pwm: uno.io, analogIn: uno.io };
}
