import { describe, expect, it } from 'vitest';
import { HardwareDataError, loadBoard } from './board-schema';
import { TCS34725_ADDRESS } from './devices/tcs34725';
import { driverIds, driverPortSpecs, moduleKinds, robotRoles, roleKinds, type Kit } from './kit';
import { gripperJawsCm, mechanicsIssues, modulesOfKind, robotMechanics } from './kit-mechanics';
import { loadKit } from './kit-schema';
import refUnoGripperJson from './kits/ref-uno-gripper.kit.json';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import { kitBoardTarget } from './board-target';
import { checkKit, rawPinCheck } from './pin-rules';
import { productionKits } from './catalog';
import { robotKits, robotKitVersionOf } from '../../samples/robot-keys';
import unoR3Json from './uno-r3.board.json';

// N19 A2 (plan §4.1, §4.2, §4.6): the gripper car as a second kit, ref-uno-gripper@0, next to the rover. Its numbers are PLACEHOLDERs
// until a vendor's kit is measured (plan §3, VG); the kit rules it brings: I²C ports on the board's SDA/SCL and one device an address,
// modules on the gripper only when they are its sensors, jaws above the floor at lift 0°, and a whole-car mass that covers the arm.

const board = loadBoard(unoR3Json);
const kit = loadKit(refUnoGripperJson, board);
const rover = loadKit(refUnoRoverJson, board);

type RawPort = { id: string; driver: string; pins: Record<string, string>; params?: Record<string, unknown> };
type RawModule = { role: string; kind: string; port: string; mount: { posCm: number[]; yawDeg: number; on?: string }; spec: Record<string, unknown> };
type RawKit = { chassis: Record<string, unknown>; ports: RawPort[]; modules: RawModule[] };
const raw = (): RawKit => structuredClone(refUnoGripperJson) as unknown as RawKit;
const portOf = (kit: RawKit, id: string) => kit.ports.find((port) => port.id === id) as RawPort;
const moduleOf = (kit: RawKit, role: string) => kit.modules.find((module) => module.role === role) as RawModule;

/** The issues loadKit refuses `json` with. */
function issues(json: unknown, on = board) {
  try {
    loadKit(json, on);
  } catch (error) {
    if (error instanceof HardwareDataError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('loadKit accepted the kit');
}

describe('the kits of the catalog (N19 A2, D-G1)', () => {
  it('registers ref-uno-gripper@0 in productionKits, as robot-keys.ts lists it, and every kit robot-keys lists at its version', () => {
    expect(productionKits.get({ id: 'ref-uno-gripper', version: '0' })).toEqual(kit);
    expect(productionKits.boardOf({ id: 'ref-uno-gripper', version: '0' })?.id).toBe('uno-r3');
    expect(productionKits.refs()).toEqual(Object.entries(robotKits).map(([id, version]) => ({ id, version })));
    expect(robotKitVersionOf('ref-uno-gripper')).toBe('0');
  });
});

describe('the vocabulary grows by the gripper car’s modules (plan §4.2)', () => {
  it('adds the kinds gripper, ir-obstacle and color-sensor, their drivers and the roles gripper, irClaw and color1 at the end', () => {
    expect(moduleKinds.slice(-3)).toEqual(['gripper', 'ir-obstacle', 'color-sensor']);
    expect(driverIds.slice(-3)).toEqual(['gripper-servo2', 'ir-digital', 'tcs34725-wire']);
    expect(robotRoles.slice(-3)).toEqual(['gripper', 'irClaw', 'color1']);
    expect([roleKinds.gripper, roleKinds.irClaw, roleKinds.color1]).toEqual(['gripper', 'ir-obstacle', 'color-sensor']);
  });

  it('wires the gripper’s two servos on one port (CLAW, LIFT), the IR on one input, the colour sensor on SDA and SCL at 0x29', () => {
    expect(driverPortSpecs['gripper-servo2']).toEqual({
      kind: 'gripper',
      pins: { CLAW: { needs: 'digital', dir: 'out' }, LIFT: { needs: 'digital', dir: 'out' } },
      claims: 'servo',
    });
    expect(driverPortSpecs['ir-digital']).toEqual({ kind: 'ir-obstacle', pins: { PIN: { needs: 'digital', dir: 'in' } }, params: { activeLow: { type: 'boolean', default: true } } });
    expect(driverPortSpecs['tcs34725-wire']).toEqual({
      kind: 'color-sensor',
      pins: { SDA: { needs: 'i2c', dir: 'out', i2c: 'sda' }, SCL: { needs: 'i2c', dir: 'out', i2c: 'scl' } },
      i2cAddress: 0x29,
    });
    expect(driverPortSpecs['tcs34725-wire'].i2cAddress).toBe(TCS34725_ADDRESS);
  });
});

describe('ref-uno-gripper@0 (plan §4.1, PLACEHOLDER)', () => {
  const pinsOf = (role: string) => kit.ports.find((port) => port.id === kit.modules.find((module) => module.role === role)?.port)?.pins;

  it('ref-uno-gripper has no diagnostics: no shared pin, no PWM on a claimed timer, nothing on D0/D1, whatever the program uses', () => {
    for (const servo of [false, true]) {
      for (const tone of [false, true]) {
        for (const serial of [false, true]) {
          expect(checkKit(kit, board, { servo, tone, serial }), JSON.stringify({ servo, tone, serial })).toEqual([]);
        }
      }
    }
    expect(mechanicsIssues(kit)).toEqual([]);
  });

  it('wires the table of §4.1: the rover’s drive, ultrasonic, line, LED and button, the gripper on D9/D10, the IR on A3, the colour sensor on A4/A5', () => {
    expect(kit).toMatchObject({ id: 'ref-uno-gripper', version: '0', board: 'uno-r3' });
    expect(kit.ports.map((port) => [port.id, port.driver, port.pins, port.params ?? null])).toEqual([
      ['M1', 'hbridge-en-in1-in2', { EN: 'D5', IN1: 'D7', IN2: 'D8' }, null],
      ['M2', 'hbridge-en-in1-in2', { EN: 'D6', IN1: 'D4', IN2: 'D2' }, null],
      ['US1', 'hcsr04-pulsein', { TRIG: 'D12', ECHO: 'D11' }, null],
      ['LN1', 'line-digital', { PIN: 'A0' }, { activeLow: false }],
      ['LN2', 'line-digital', { PIN: 'A1' }, { activeLow: false }],
      ['LN3', 'line-digital', { PIN: 'A2' }, { activeLow: false }],
      ['LED1', 'led-digital', { PIN: 'D13' }, null],
      ['BTN1', 'button-pullup', { PIN: 'D3' }, null],
      ['GR1', 'gripper-servo2', { CLAW: 'D9', LIFT: 'D10' }, null],
      ['IR1', 'ir-digital', { PIN: 'A3' }, { activeLow: true }],
      ['CS1', 'tcs34725-wire', { SDA: 'A4', SCL: 'A5' }, null],
    ]);
    expect(kit.modules.map((module) => [module.role, module.port])).toEqual([
      ['motorLeft', 'M1'], ['motorRight', 'M2'], ['ultrasonic', 'US1'], ['lineLeft', 'LN1'], ['lineCenter', 'LN2'], ['lineRight', 'LN3'],
      ['led1', 'LED1'], ['button1', 'BTN1'], ['gripper', 'GR1'], ['irClaw', 'IR1'], ['color1', 'CS1'],
    ]);
    expect([pinsOf('servo1'), pinsOf('buzzer')]).toEqual([undefined, undefined]);
  });

  it('has the rover’s drive under a 460 g car (the whole car, gripper included) with its centre of mass at [-1.2, 0, 3.6] and a 16 cm footprint', () => {
    expect(kit.chassis).toEqual({ ...rover.chassis, massG: 460, comCm: [-1.2, 0, 3.6], footprintRadiusCm: 16 });
    for (const role of ['motorLeft', 'motorRight', 'lineLeft', 'lineCenter', 'lineRight', 'led1', 'button1']) {
      expect(kit.modules.find((module) => module.role === role), role).toEqual(rover.modules.find((module) => module.role === role));
    }
    expect(kit.modules.find((module) => module.role === 'ultrasonic')).toEqual({ ...rover.modules.find((module) => module.role === 'ultrasonic'), mount: { posCm: [7.5, 0, 5], yawDeg: 0 } });
  });

  it('has the GripperSpec of §4.1 and §4.6, the IR and colour specs, and the sensors on the carriage', () => {
    const mechanics = robotMechanics(kit);
    expect(mechanics.gripper?.mount).toEqual({ posCm: [4.5, 0, 4.9], yawDeg: 0 });
    expect(mechanics.gripper?.spec).toEqual({
      liftSPer60Deg: 0.1,
      liftStallTorqueNm: 0.18,
      liftRotorInertiaKgM2: 5e-5,
      boomLengthCm: 5,
      boomHalfSpanCm: 6.6,
      boomMassG: 6,
      boomElevationAtLift0Deg: -40,
      carriageMassG: 22,
      clawSPer60Deg: 0.1,
      clawStallTorqueNm: 0.18,
      jawsMeetDeg: 80,
      fingerOpenDeg: 12,
      fingerDegPerServoDeg: 0.445,
      fingerHingeUCm: 0.5,
      fingerHingeVCm: 2.2,
      fingerLengthCm: 5,
      fingerThicknessCm: 0.4,
      jawHeightCm: 1.2,
      fingerMassG: 3,
      jawFriction: 0.6,
      maxPayloadG: 50,
    });
    expect(mechanics.irSensors.map((module) => [module.role, module.mount, module.spec])).toEqual([
      ['irClaw', { posCm: [0.3, 0.6, 0], yawDeg: 0, on: 'gripper' }, { rangeCm: 2, minReflectance: 0.15 }],
    ]);
    expect(mechanics.colorSensors.map((module) => [module.role, module.mount, module.spec])).toEqual([
      ['color1', { posCm: [0.3, -0.6, 0], yawDeg: 0, on: 'gripper' }, { rangeCm: 4, halfLightCm: 1.5, whiteRPerMs: 48, whiteGPerMs: 44, whiteBPerMs: 36, ambientPerMs: 0.2 }],
    ]);
    expect(mechanics.servos).toEqual([]);
    expect(modulesOfKind(kit, 'gripper').map((module) => module.role)).toEqual(['gripper']);
  });

  it('puts the jaws where §4.1 derives them: lowered, x 8.83–13.83 cm and z 1.09–2.29 cm, the tips 6.08 cm apart open; level at lift 40°', () => {
    const gripper = robotMechanics(kit).gripper!;
    const round = (box: ReturnType<typeof gripperJawsCm>) => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value * 100) / 100]));
    expect(round(gripperJawsCm(gripper, 0))).toEqual({ xMin: 8.83, xMax: 13.83, zMin: 1.09, zMax: 2.29, openTipGapCm: 6.08 });
    expect(round(gripperJawsCm(gripper, 40))).toEqual({ xMin: 10, xMax: 15, zMin: 4.3, zMax: 5.5, openTipGapCm: 6.08 });
  });

  it('gives the rover no gripper and no IR or colour sensor', () => {
    expect(robotMechanics(rover)).toMatchObject({ gripper: null, irSensors: [], colorSensors: [] });
  });
});

describe('the I²C rules of a kit', () => {
  it('i2c port on non-SDA pin → wrong-i2c-pin: SDA and SCL are the board’s own pins', () => {
    const swapped = raw();
    portOf(swapped, 'CS1').pins = { SDA: 'A5', SCL: 'A4' };
    expect(issues(swapped)).toEqual([
      { path: 'ports.10.pins.SDA', code: 'wrong-i2c-pin', message: 'SDA is uno-r3’s I²C data pin, A4, not A5 (wrong-i2c-pin)' },
      { path: 'ports.10.pins.SCL', code: 'wrong-i2c-pin', message: 'SCL is uno-r3’s I²C clock pin, A5, not A4 (wrong-i2c-pin)' },
    ]);
    const elsewhere = raw();
    portOf(elsewhere, 'CS1').pins.SDA = 'D7';
    expect(issues(elsewhere)).toEqual([{ path: 'ports.10.pins.SDA', code: 'wrong-i2c-pin', message: 'SDA is uno-r3’s I²C data pin, A4, not D7 (wrong-i2c-pin)' }]);
    const { i2c: _none, ...noBus } = unoR3Json;
    expect(_none).toBeDefined();
    expect(issues(raw(), loadBoard(noBus)).filter((issue) => issue.code === 'wrong-i2c-pin').map((issue) => [issue.path, issue.message])).toEqual([
      ['ports.10.pins.SDA', 'uno-r3 has no I²C for SDA (wrong-i2c-pin)'],
      ['ports.10.pins.SCL', 'uno-r3 has no I²C for SCL (wrong-i2c-pin)'],
    ]);
  });

  it('lets the devices of one bus share SDA and SCL (no pin-conflict), and still refuses an I²C pin another module uses', () => {
    const bus: Kit = { ...kit, ports: [...kit.ports, { id: 'CS2', driver: 'tcs34725-wire', pins: { SDA: 'A4', SCL: 'A5' } }] };
    expect(checkKit(bus, board, { servo: true, tone: true, serial: true })).toEqual([]);
    const taken: Kit = { ...kit, ports: kit.ports.map((port) => (port.id === 'IR1' ? { ...port, pins: { PIN: 'A4' } } : port)) };
    expect(checkKit(taken, board, { servo: false, tone: false, serial: false }).map((diagnostic) => [diagnostic.code, diagnostic.pin, diagnostic.ports])).toEqual([
      ['pin-conflict', 'A4', ['IR1', 'CS1']],
    ]);
  });

  it('keeps the raw pin ops off SDA and SCL: Wire owns A4 and A5, so a raw write, read or analog read there is pin-unavailable (review M7)', () => {
    const target = kitBoardTarget(kit, board);
    const usage = { servo: true, tone: false, serial: false };
    for (const pin of ['A4', 'A5']) {
      expect(target.usedBy[pin], pin).toBe('CS1');
      for (const op of ['digital.write', 'pwm.write', 'digital.read', 'analogIn.read'] as const) {
        expect(rawPinCheck(target, op, pin, usage)?.code, `${op} ${pin}`).toBe('pin-unavailable');
      }
    }
    expect([target.raw.read.includes('A4'), target.raw.analogRead.includes('A4'), target.raw.read.includes('A3')]).toEqual([false, false, true]);
  });

  it('two devices at 0x29 → i2c-address-conflict, on the second port', () => {
    const two = raw();
    two.ports.push({ id: 'CS2', driver: 'tcs34725-wire', pins: { SDA: 'A4', SCL: 'A5' } });
    expect(issues(two)).toEqual([{ path: 'ports.11', code: 'i2c-address-conflict', message: 'CS2 answers at I²C address 0x29, as CS1 does (i2c-address-conflict)' }]);
  });
});

describe('modules on the gripper (mount.on)', () => {
  it('on:gripper only for ir/color: a line sensor or a servo on the carriage is refused', () => {
    const line = raw();
    moduleOf(line, 'lineLeft').mount.on = 'gripper';
    expect(issues(line)).toEqual([{ path: 'modules.3.mount.on', message: 'only an IR or a colour sensor rides on the gripper, not a line-sensor' }]);
    expect(() => loadKit(raw(), board)).not.toThrow();
  });

  it('refuses a sensor on the gripper of a kit that has none, and a place other than the gripper', () => {
    const bare = raw();
    bare.ports = bare.ports.filter((port) => port.id !== 'GR1');
    bare.modules = bare.modules.filter((module) => module.role !== 'gripper');
    expect(issues(bare)).toEqual([
      { path: 'modules.8.mount.on', message: 'the kit has no gripper for irClaw to ride on' },
      { path: 'modules.9.mount.on', message: 'the kit has no gripper for color1 to ride on' },
    ]);
    const roof = raw();
    moduleOf(roof, 'irClaw').mount.on = 'roof';
    expect(issues(roof).map((issue) => issue.path)).toEqual(['modules.9.mount.on']);
  });
});

describe('the gripper’s mechanics', () => {
  it('keeps the jaws above the floor at lift 0°: lowered, the jaw’s bottom is above z = 0', () => {
    const low = raw();
    moduleOf(low, 'gripper').mount.posCm = [4.5, 0, 3.8];
    expect(issues(low)).toEqual([
      { path: 'modules.8.mount.posCm.2', message: 'the jaws clear the floor at lift 0°: their bottom is at z = 0 cm or below (-0.01 cm), so the mount is higher' },
    ]);
  });

  it('counts the gripper’s moving mass in the whole car: boom, carriage and two fingers, 34 g', () => {
    const light = raw();
    light.chassis.massG = 34;
    expect(issues(light)).toEqual([{ path: 'chassis.massG', message: 'the whole robot (34 g) weighs more than its servo arms and its gripper’s moving parts (34 g)' }]);
    light.chassis.massG = 35;
    expect(() => loadKit(light, board)).not.toThrow();
  });

  it('refuses a gripper spec with a missing key, a lift whose lowest point is not lift 0°, or jaws that meet past 90°', () => {
    const missing = raw();
    delete moduleOf(missing, 'gripper').spec.maxPayloadG;
    expect(issues(missing).map((issue) => issue.path)).toEqual(['modules.8.spec.maxPayloadG']);
    const up = raw();
    moduleOf(up, 'gripper').spec.boomElevationAtLift0Deg = 10;
    expect(issues(up).map((issue) => issue.path)).toEqual(['modules.8.spec.boomElevationAtLift0Deg']);
    const far = raw();
    moduleOf(far, 'gripper').spec.jawsMeetDeg = 95;
    expect(issues(far).map((issue) => issue.path)).toEqual(['modules.8.spec.jawsMeetDeg']);
    const blind = raw();
    moduleOf(blind, 'irClaw').spec.minReflectance = 0;
    expect(issues(blind).map((issue) => issue.path)).toEqual(['modules.9.spec.minReflectance']);
  });

  it('is what robotMechanics types for the world (a kit without a gripper has none)', () => {
    expect(robotMechanics(kit as Kit).gripper?.role).toBe('gripper');
  });
});
