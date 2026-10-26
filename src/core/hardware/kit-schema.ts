import { z } from 'zod';
import { boardPin, type BoardProfile } from './board';
import { HardwareDataError, zodIssues, type DataIssue } from './board-schema';
import { driverIds, driverPortSpecs, moduleKinds, robotRoles, roleKinds, type Kit } from './kit';
import { chassisSchema, mechanicsIssues } from './kit-mechanics';

// Validation of a kit against its board (N18 R1.1, robot plan §4.2, B6): the shape with Zod, then what only the board and the
// drivers know: every driver pin wired once, to a pin of the board that has the capability the driver needs; every module on
// an existing port whose driver drives that kind, one module per port, each role once. Rules that depend on the program
// (timers, Serial) and pins shared between ports are pin-rules.ts's `checkKit`: they are diagnostics, not invalid data.
// The mechanical half (the chassis, each module's spec by kind, the drive geometry) is kit-mechanics.ts's (N18 R3.3).
// N19 A2 adds the two I²C rules: a pin of an I²C line is the board's pin of that line (wrong-i2c-pin), and no two ports' devices answer
// at one address (i2c-address-conflict). The ports of one bus share SDA and SCL, which is not a pin conflict of checkKit.

const finite = z.number().refine(Number.isFinite, 'must be a finite number');

const kitPortSchema = z.strictObject({
  id: z.string().min(1),
  driver: z.enum(driverIds),
  pins: z.record(z.string(), z.string()),
  params: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
});

const kitModuleSchema = z.strictObject({
  role: z.enum(robotRoles),
  kind: z.enum(moduleKinds),
  port: z.string().min(1),
  mount: z.strictObject({ posCm: z.tuple([finite, finite, finite]), yawDeg: finite, on: z.literal('gripper').optional() }),
  spec: z.record(z.string(), z.union([finite, z.boolean(), z.string()])),
});

export const kitSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  board: z.string().min(1),
  chassis: chassisSchema.optional(),
  ports: z.array(kitPortSchema),
  modules: z.array(kitModuleSchema),
});

const hex = (address: number) => `0x${address.toString(16).padStart(2, '0')}`;
const i2cLineNames = { sda: 'data', scl: 'clock' } as const;

function kitRuleIssues(kit: Kit, board: BoardProfile): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (path: string, message: string, code?: DataIssue['code']) => issues.push(code === undefined ? { path, message } : { path, message, code });
  const addresses = new Map<number, string>();
  if (kit.board !== board.id) {
    add('board', `the kit is for ${kit.board}, not ${board.id}`);
  }

  const ports = new Map<string, Kit['ports'][number]>();
  kit.ports.forEach((port, index) => {
    const at = `ports.${String(index)}`;
    if (ports.has(port.id)) {
      add(`${at}.id`, `port ${port.id} is listed twice`);
    }
    ports.set(port.id, port);
    const spec = driverPortSpecs[port.driver];
    for (const [name, pinSpec] of Object.entries(spec.pins)) {
      const pin = port.pins[name];
      if (pin === undefined) {
        add(`${at}.pins.${name}`, `${port.driver} needs pin ${name}`);
      } else if (boardPin(board, pin) === undefined) {
        add(`${at}.pins.${name}`, `${pin} is not a pin of ${board.id}`);
      } else if (pinSpec.i2c !== undefined) {
        // An I²C line is the board's own pin of it (the TWI's), not any pin with the capability.
        const own = board.i2c?.[pinSpec.i2c];
        if (own === undefined) {
          add(`${at}.pins.${name}`, `${board.id} has no I²C for ${name} (wrong-i2c-pin)`, 'wrong-i2c-pin');
        } else if (pin !== own) {
          add(`${at}.pins.${name}`, `${name} is ${board.id}’s I²C ${i2cLineNames[pinSpec.i2c]} pin, ${own}, not ${pin} (wrong-i2c-pin)`, 'wrong-i2c-pin');
        }
      } else if (!boardPin(board, pin)?.caps.includes(pinSpec.needs)) {
        add(`${at}.pins.${name}`, `${pin} has no ${pinSpec.needs}`);
      }
    }
    if (spec.i2cAddress !== undefined) {
      const holder = addresses.get(spec.i2cAddress);
      if (holder !== undefined) {
        add(at, `${port.id} answers at I²C address ${hex(spec.i2cAddress)}, as ${holder} does (i2c-address-conflict)`, 'i2c-address-conflict');
      } else {
        addresses.set(spec.i2cAddress, port.id);
      }
    }
    for (const name of Object.keys(port.pins)) {
      if (!(name in spec.pins)) {
        add(`${at}.pins.${name}`, `${port.driver} has no pin ${name}`);
      }
    }
    for (const [name, value] of Object.entries(port.params ?? {})) {
      const paramSpec = spec.params?.[name];
      if (paramSpec === undefined) {
        add(`${at}.params.${name}`, `${port.driver} has no param ${name}`);
      } else if (typeof value !== paramSpec.type) {
        add(`${at}.params.${name}`, `must be a ${paramSpec.type}`);
      }
    }
  });

  const roles = new Set<string>();
  const holders = new Map<string, string>();
  kit.modules.forEach((module, index) => {
    const at = `modules.${String(index)}`;
    if (roles.has(module.role)) {
      add(`${at}.role`, `role ${module.role} is listed twice`);
    }
    roles.add(module.role);
    if (roleKinds[module.role] !== module.kind) {
      add(`${at}.kind`, `role ${module.role} is a ${roleKinds[module.role]}, not a ${module.kind}`);
    }
    const port = ports.get(module.port);
    if (port === undefined) {
      add(`${at}.port`, `no port ${module.port}`);
      return;
    }
    const driven = driverPortSpecs[port.driver].kind;
    if (driven !== module.kind) {
      add(`${at}.port`, `port ${port.id} drives a ${driven}, not a ${module.kind}`);
    }
    const holder = holders.get(port.id);
    if (holder !== undefined) {
      add(`${at}.port`, `port ${port.id} already holds ${holder}`);
    } else {
      holders.set(port.id, module.role);
    }
  });
  issues.push(...mechanicsIssues(kit));
  return issues;
}

/** Parses a kit and checks it against `board`; throws a HardwareDataError naming the path of every problem. */
export function loadKit(json: unknown, board: BoardProfile): Kit {
  const parsed = kitSchema.safeParse(json);
  if (!parsed.success) {
    throw new HardwareDataError('Kit', zodIssues(parsed.error));
  }
  const kit: Kit = parsed.data;
  const issues = kitRuleIssues(kit, board);
  if (issues.length > 0) {
    throw new HardwareDataError(`Kit "${kit.id}@${kit.version}"`, issues);
  }
  return kit;
}
