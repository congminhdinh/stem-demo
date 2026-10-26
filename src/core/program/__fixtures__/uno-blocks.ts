import { createKitCatalog, productionKits, referenceKitRef, unoR3Board, type Kit, type KitCatalog } from '../../hardware';
import refUnoRoverJson from '../../hardware/kits/ref-uno-rover.kit.json';
import { localDeviceDefinitions } from '../../devices/local-catalog';
import { createDeviceRegistry } from '../../devices/registry';
import { productionProfiles } from '../../profiles';
import { unoDocument } from '../../profiles/__fixtures__/uno-document';
import { createBlockPackCatalog } from '../block-packs';
import { compileUnoProject, type UnoCompileResult } from '../compile-uno-program';
import { chain, program, type Json } from './ybc-blocks';

// TEST-ONLY: Blockly serialization JSON of the robot's blocks (N18 R2.2), in the shape Blockly saves them
// (tests/uno-blockly-conformance.test.ts checks it against real Blockly), and the compile of a robot project with them.

let counter = 0;
const id = (type: string) => `${type}-${++counter}`;
const input = (value: Json) => ({ block: value });

export const driveMove = (direction: string, speed: Json, blockId = id('drive')): Json => ({
  type: 'uno_drive_move',
  id: blockId,
  fields: { DIRECTION: direction },
  inputs: { SPEED: input(speed) },
});
export const driveStop = (blockId = id('stop')): Json => ({ type: 'uno_drive_stop', id: blockId });
export const motorSet = (role: string, speed: Json, blockId = id('motor')): Json => ({ type: 'uno_motor_set', id: blockId, fields: { ROLE: role }, inputs: { SPEED: input(speed) } });
export const ultrasonic = (blockId = id('ultrasonic')): Json => ({ type: 'uno_ultrasonic_cm', id: blockId });
export const lineDark = (role: string, blockId = id('line')): Json => ({ type: 'uno_line_dark', id: blockId, fields: { ROLE: role } });
export const lineRaw = (role: string, blockId = id('line-raw')): Json => ({ type: 'uno_line_raw', id: blockId, fields: { ROLE: role } });
export const buttonPressed = (blockId = id('button')): Json => ({ type: 'uno_button_pressed', id: blockId });
export const servoSet = (role: string, angle: Json, blockId = id('servo')): Json => ({ type: 'uno_servo_set', id: blockId, fields: { ROLE: role }, inputs: { ANGLE: input(angle) } });
export const led = (state: string, blockId = id('led')): Json => ({ type: 'uno_led_set', id: blockId, fields: { STATE: state } });
export const buzzerTone = (hz: Json, ms: Json, blockId = id('tone')): Json => ({ type: 'uno_buzzer_tone', id: blockId, inputs: { HZ: input(hz), MS: input(ms) } });
export const buzzerStop = (blockId = id('buzzer-stop')): Json => ({ type: 'uno_buzzer_stop', id: blockId });
export const digitalWrite = (pin: string, level: string, blockId = id('digital-write')): Json => ({ type: 'uno_digital_write', id: blockId, fields: { PIN: pin, LEVEL: level } });
export const pwmWrite = (pin: string, value: Json, blockId = id('pwm-write')): Json => ({ type: 'uno_pwm_write', id: blockId, fields: { PIN: pin }, inputs: { VALUE: input(value) } });
export const digitalRead = (pin: string, blockId = id('digital-read')): Json => ({ type: 'uno_digital_read', id: blockId, fields: { PIN: pin } });
export const analogRead = (pin: string, blockId = id('analog-read')): Json => ({ type: 'uno_analog_read', id: blockId, fields: { PIN: pin } });
export const millis = (blockId = id('millis')): Json => ({ type: 'uno_millis', id: blockId });
/** N19 A4: the gripper car's blocks (plan §4.3). */
export const claw = (state: 'OPEN' | 'CLOSE', blockId = id('claw')): Json => ({ type: 'uno_gripper_claw', id: blockId, fields: { STATE: state } });
export const clawAngle = (angle: Json, blockId = id('claw-angle')): Json => ({ type: 'uno_gripper_claw_angle', id: blockId, inputs: { ANGLE: input(angle) } });
export const lift = (state: 'UP' | 'DOWN', blockId = id('lift')): Json => ({ type: 'uno_gripper_lift', id: blockId, fields: { STATE: state } });
export const liftAngle = (angle: Json, blockId = id('lift-angle')): Json => ({ type: 'uno_gripper_lift_angle', id: blockId, inputs: { ANGLE: input(angle) } });
export const irDetect = (blockId = id('ir')): Json => ({ type: 'uno_ir_detect', id: blockId });
export const colorIs = (color: string, blockId = id('color-is')): Json => ({ type: 'uno_color_is', id: blockId, fields: { COLOR: color } });
export const colorRaw = (channel: string, blockId = id('color-raw')): Json => ({ type: 'uno_color_raw', id: blockId, fields: { CHANNEL: channel } });
/** The UNO's division (U-06) and count up (U-14), as their own blocks save them. */
export const unoDivide = (a: Json, b: Json, blockId = id('divide')): Json => ({ type: 'uno_int_divide', id: blockId, inputs: { A: input(a), B: input(b) } });
export const unoCountUp = (variable: string, from: Json, to: Json, body: Json[], blockId = id('count-up')): Json => ({
  type: 'uno_count_up',
  id: blockId,
  fields: { VAR: { id: variable } },
  inputs: { FROM: input(from), TO: input(to), ...(body.length > 0 ? { DO: input(chain(body)) } : {}) },
});

export const registry = createDeviceRegistry(localDeviceDefinitions);
export const packs = createBlockPackCatalog(registry);
export const rover = productionKits.get(referenceKitRef) as Kit;
/** N19 A4: the gripper car, ref-uno-gripper@0, as a project names it and with the catalog that has it. */
export const gripperKitRef = { id: 'ref-uno-gripper', version: '0' } as const;
export const gripperKit = productionKits.get(gripperKitRef) as Kit;
export const onGripper = { ref: gripperKitRef, kits: productionKits };

/** The kit JSON as a test edits it. */
type RawKit = Omit<typeof refUnoRoverJson, 'ports'> & { ports: { id: string; driver: string; pins: Record<string, string>; params?: Record<string, boolean> }[] };

/** A kit derived from ref-uno-rover@0 (test data): `change` edits a deep copy of its JSON; its id is `id`. */
export function derivedKit(kitId: string, change: (kit: RawKit) => void): { ref: { id: string; version: string }; kits: KitCatalog } {
  const raw = structuredClone(refUnoRoverJson) as unknown as RawKit;
  raw.id = kitId;
  change(raw);
  return { ref: { id: kitId, version: raw.version }, kits: createKitCatalog([refUnoRoverJson, raw], [unoR3Board]) };
}

/**
 * ref-uno-rover@0 without the module of `role` (and its port). A kit with a chassis must drive on both motors (R3.3), so a
 * kit without a drive motor is a bench kit: it loses its chassis too.
 */
export function kitWithout(role: string): { ref: { id: string; version: string }; kits: KitCatalog } {
  return derivedKit(`test-rover-without-${role}`, (kit) => {
    const port = kit.modules.find((module) => module.role === role)?.port;
    kit.modules = kit.modules.filter((module) => module.role !== role);
    kit.ports = kit.ports.filter((candidate) => candidate.id !== port);
    if (role === 'motorLeft' || role === 'motorRight') {
      delete (kit as { chassis?: unknown }).chassis;
    }
  });
}

/** Compiles a robot project of `profile` with these hats, for the reference kit or the one given. */
export function compileRobot(
  onStart: Json[],
  forever?: Json[],
  options: { profile?: 'uno-basic' | 'uno-advanced'; kit?: { ref: { id: string; version: string }; kits: KitCatalog }; variables?: string[] } = {},
): UnoCompileResult {
  const document = unoDocument(options.profile ?? 'uno-advanced', {
    program: { blocks: program(onStart, forever, options.variables ?? ['x']) },
    ...(options.kit ? { kit: options.kit.ref } : {}),
  });
  return compileUnoProject(document, { registry, profiles: productionProfiles, packs, kits: options.kit?.kits ?? productionKits });
}
