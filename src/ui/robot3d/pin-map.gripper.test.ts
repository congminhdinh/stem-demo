import { describe, expect, it } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import { createTcs34725, type LightIntegral, type Rgbc } from '../../core/hardware/devices/tcs34725';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno, type PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { hubCards, hubMap, hubValues, type ModuleView } from './pin-map';
import { robotModel } from './robot-model';
import { idleSnapshot } from './scene-math';

// N19 E2: what the "Cổng & chân" tab works out for the gripper car: the gripper's two servos (the snapshot's `robot.gripper`, as the 3D view
// draws them), the IR sensor between its jaws (its pin and `activeLow`), and the colour sensor on A4 and A5 (its raw R G B C and the colour
// the program's `color.is` would name, from the same COLOR_RULES). The IR and colour entries of `sensors` (B3/B4) are read only when they are
// there: before that the IR comes from the pin, and the colour has no reading to show.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get(referenceKitRef) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const map = hubMap(gripperKit, unoR3Board);

/** A virtual UNO with the gripper kit's drivers set up, to take its pins from. */
function robot() {
  let us = 0;
  const uno = createVirtualUno(unoR3Board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  const modules = createModuleIO(gripperKit, uno);
  return { uno, modules };
}

/** The world of a run at some moment on the gripper kit. */
function worldOf(pins: readonly PinState[], changes: Partial<RobotSnapshot> = {}): RobotSnapshot {
  return { ...idleSnapshot(scenario, gripperKit), t: 1, status: 'running', pins, ...changes };
}
const withGripper = (clawDeg: number, liftDeg: number, heldId: string | null = null) => {
  const base = idleSnapshot(scenario, gripperKit);
  return { robot: { ...base.robot, gripper: { clawDeg, liftDeg, heldId } } };
};
/** What the program’s `colorBegin` leaves in the TCS34725's data registers after its first window, for a steady light (counts per second). */
function counts(perS: Rgbc): Rgbc {
  const light: LightIntegral = (from, to) => {
    const span = Math.round(to - from);
    return { c: perS.c * span, r: perS.r * span, g: perS.g * span, b: perS.b * span };
  };
  const device = createTcs34725(light);
  const write = (t: number, bytes: number[]) => {
    device.connect(t, false);
    for (const byte of bytes) device.write(t, byte);
    device.stop(t);
  };
  write(0, [0x81, 0xeb]);
  write(0, [0x8f, 0x01]);
  write(0, [0x80, 0x01]);
  write(3000, [0x80, 0x03]);
  return device.peek(3000 + 52_800).data;
}
/** A snapshot entry of the colour sensor, as the world gives it (B4), with the counts the sensor registers hold. */
const colorEntry = (rgbc: Rgbc | null, hitId: string | null = 'cube') => ({ role: 'color1', kind: 'color-sensor', hitId, distanceCm: hitId === null ? null : 1, ...(rgbc === null ? {} : { rgbc }) }) as unknown as RobotSnapshot['sensors'][number];
const irEntry = (detected: boolean) => ({ role: 'irClaw', kind: 'ir-obstacle', detected, hitId: detected ? 'cube' : null }) as unknown as RobotSnapshot['sensors'][number];
/** The kit's sensors in kit order: the ultrasonic, three line sensors, then the IR and the colour sensor. */
const sensorsOf = (...tail: RobotSnapshot['sensors'][number][]): RobotSnapshot['sensors'] => [
  { role: 'ultrasonic', kind: 'ultrasonic', cm: 400, hitId: null },
  ...['lineLeft', 'lineCenter', 'lineRight'].map((role) => ({ role, kind: 'line-sensor' as const, reflectance: 0.9, dark: false, spotCm: [10, 10] as const })),
  ...tail,
];
const viewOf = (world: RobotSnapshot, role: string): ModuleView | undefined => hubValues(map, world).modules[role];

describe('hubMap of the gripper car (N19 E2)', () => {
  it('lists the gripper, the IR sensor and the colour sensor after the button, each with its port, driver and pins', () => {
    expect(map.modules.slice(-3).map((module) => [module.role, module.kind, module.port, module.driver, module.pins.map((pin) => `${pin.name}=${pin.pin}:${pin.dir}`)])).toEqual([
      ['gripper', 'gripper', 'GR1', 'gripper-servo2', ['CLAW=D9:out', 'LIFT=D10:out']],
      ['irClaw', 'ir-obstacle', 'IR1', 'ir-digital', ['PIN=A3:in']],
      ['color1', 'color-sensor', 'CS1', 'tcs34725-wire', ['SDA=A4:out', 'SCL=A5:out']],
    ]);
  });

  it('knows the part and signal behind D9, D10, A3, A4 and A5', () => {
    expect(map.owners.get('D9')).toEqual({ role: 'gripper', port: 'GR1', signal: 'CLAW', portPins: 2 });
    expect(map.owners.get('D10')).toEqual({ role: 'gripper', port: 'GR1', signal: 'LIFT', portPins: 2 });
    expect(map.owners.get('A3')).toEqual({ role: 'irClaw', port: 'IR1', signal: 'PIN', portPins: 1 });
    expect(map.owners.get('A4')).toEqual({ role: 'color1', port: 'CS1', signal: 'SDA', portPins: 2 });
    expect(map.owners.get('A5')).toEqual({ role: 'color1', port: 'CS1', signal: 'SCL', portPins: 2 });
  });

  it('puts the IR and colour sensors after the line sensors among the snapshot’s sensors, and keeps the active level of the IR', () => {
    const byRole = (role: string) => map.modules.find((module) => module.role === role)!;
    expect([byRole('ultrasonic'), byRole('lineLeft'), byRole('lineRight'), byRole('irClaw'), byRole('color1'), byRole('gripper')].map((module) => module.sensorIndex)).toEqual([0, 1, 3, 4, 5, -1]);
    expect(map.modules.map((module) => [module.role, module.activeLow]).filter(([, low]) => low !== null)).toEqual([['irClaw', true]]);
    const rover_ = hubMap(rover, unoR3Board);
    expect(rover_.modules.every((module) => module.activeLow === null)).toBe(true);
  });

  it('takes the IR’s active level from the port, or the driver’s default when the kit says none (what ir.detect does)', () => {
    const withParams = (params: Record<string, boolean> | undefined): Kit => ({
      ...gripperKit,
      ports: gripperKit.ports.map((port) => {
        if (port.id !== 'IR1') return port;
        const bare = { id: port.id, driver: port.driver, pins: port.pins };
        return params === undefined ? bare : { ...bare, params };
      }),
    });
    const activeLow = (kit: Kit) => hubMap(kit, unoR3Board).modules.find((module) => module.role === 'irClaw')!.activeLow;
    expect([activeLow(withParams(undefined)), activeLow(withParams({ activeLow: true })), activeLow(withParams({ activeLow: false }))]).toEqual([true, true, false]);
  });

  it('gives one card each to the gripper, the IR and the colour sensor, in kit order after the line sensors’ one', () => {
    expect(hubCards(map).map((card) => [card.id, card.kind])).toEqual([
      ['motorLeft', 'dc-motor'],
      ['motorRight', 'dc-motor'],
      ['ultrasonic', 'ultrasonic'],
      ['line', 'line-sensor'],
      ['led1', 'led'],
      ['button1', 'button'],
      ['gripper', 'gripper'],
      ['irClaw', 'ir-obstacle'],
      ['color1', 'color-sensor'],
    ]);
  });
});

describe('hubValues of the gripper (N19 E2)', () => {
  it('reads the claw’s and the arm’s angles off the snapshot’s robot.gripper, in whole degrees', () => {
    const { uno } = robot();
    expect(viewOf(worldOf(uno.pins(), withGripper(26.97, 44.6, 'cube')), 'gripper')).toEqual({ kind: 'gripper', clawDeg: 27, liftDeg: 45 });
    expect(viewOf(worldOf(uno.pins(), withGripper(80, 90)), 'gripper')).toEqual({ kind: 'gripper', clawDeg: 80, liftDeg: 90 });
    // A hair below 0 is 0, never −0.
    const folded = viewOf(worldOf(uno.pins(), withGripper(-1.2e-6, 0.0004)), 'gripper') as { clawDeg: number; liftDeg: number };
    expect([Object.is(folded.clawDeg, 0), Object.is(folded.liftDeg, 0)]).toEqual([true, true]);
  });

  it('has no angle to show when the snapshot has no gripper, and says what the servos are told on the pins D9 and D10', () => {
    const { uno, modules } = robot();
    modules.call('gripper', 'gripper.claw', [80]);
    modules.call('gripper', 'gripper.lift', [15]);
    const world = worldOf(uno.pins());
    expect(viewOf(world, 'gripper')).toEqual({ kind: 'gripper', clawDeg: null, liftDeg: null });
    const { pins } = hubValues(map, world);
    expect([pins.D9, pins.D10]).toEqual([
      { reading: { kind: 'servo', deg: 80 }, input: false },
      { reading: { kind: 'servo', deg: 15 }, input: false },
    ]);
  });
});

describe('hubValues of the IR sensor (N19 E2)', () => {
  const at = (level: 0 | 1, pins: readonly PinState[]) => pins.map((pin) => (pin.pin === 'A3' ? { ...pin, level } : pin));

  it('is the level of A3 and whether that means an object: LOW while it sees one, as the kit says activeLow', () => {
    const { uno } = robot();
    expect(viewOf(worldOf(at(0, uno.pins())), 'irClaw')).toEqual({ kind: 'ir-obstacle', level: 'low', detected: true });
    expect(viewOf(worldOf(at(1, uno.pins())), 'irClaw')).toEqual({ kind: 'ir-obstacle', level: 'high', detected: false });
    expect(hubValues(map, worldOf(at(0, uno.pins()))).pins.A3).toEqual({ reading: { kind: 'low' }, input: true });
  });

  it('reads the pin, not the snapshot’s entry, so it is the level a program’s ir.detect reads (the entry agrees when the world has it)', () => {
    const { uno } = robot();
    const world = worldOf(at(0, uno.pins()), { sensors: sensorsOf(irEntry(true), colorEntry(null)) });
    expect(viewOf(world, 'irClaw')).toEqual({ kind: 'ir-obstacle', level: 'low', detected: true });
    // The kit's activeLow false would make HIGH the object.
    const high = hubMap({ ...gripperKit, ports: gripperKit.ports.map((port) => (port.id === 'IR1' ? { ...port, params: { activeLow: false } } : port)) }, unoR3Board);
    expect(hubValues(high, worldOf(at(1, uno.pins()))).modules.irClaw).toEqual({ kind: 'ir-obstacle', level: 'high', detected: true });
  });
});

describe('hubValues of the colour sensor (N19 E2)', () => {
  const red = counts({ c: 47_600, r: 39_917, g: 8_316, b: 6_856 });
  const green = counts({ c: 36_000, r: 6_000, g: 24_000, b: 6_000 });
  const blue = counts({ c: 40_000, r: 5_000, g: 10_000, b: 25_000 });
  const yellow = counts({ c: 45_000, r: 22_000, g: 19_000, b: 4_000 });

  it('has no raw reading until the world gives one (no entry, or an entry without counts), and then names no colour', () => {
    const { uno } = robot();
    expect(viewOf(worldOf(uno.pins()), 'color1')).toEqual({ kind: 'color-sensor', rgbc: null, color: null });
    expect(viewOf(worldOf(uno.pins(), { sensors: sensorsOf(irEntry(false), colorEntry(null)) }), 'color1')).toEqual({ kind: 'color-sensor', rgbc: null, color: null });
  });

  it('shows the raw R G B C of the entry and the colour COLOR_RULES makes of them, the one color.is would answer', () => {
    const { uno } = robot();
    const world = (rgbc: Rgbc) => worldOf(uno.pins(), { sensors: sensorsOf(irEntry(true), colorEntry(rgbc)) });
    // What the model's first window holds for each steady light (4×, 50.4 ms: counts per second × 0.2016).
    expect([red, green, blue, yellow]).toEqual([
      { c: 9596, r: 8047, g: 1676, b: 1382 },
      { c: 7257, r: 1209, g: 4838, b: 1209 },
      { c: 8064, r: 1008, g: 2016, b: 5040 },
      { c: 9072, r: 4435, g: 3830, b: 806 },
    ]);
    expect([red, green, blue, yellow].map((rgbc) => viewOf(world(rgbc), 'color1'))).toEqual(
      [red, green, blue, yellow].map((rgbc, index) => ({ kind: 'color-sensor', rgbc: { r: rgbc.r, g: rgbc.g, b: rgbc.b, c: rgbc.c }, color: ['red', 'green', 'blue', 'yellow'][index] })),
    );
  });

  it('names too little light “unknown” and white and black as the rules do', () => {
    const { uno } = robot();
    const world = (rgbc: Rgbc) => worldOf(uno.pins(), { sensors: sensorsOf(irEntry(false), colorEntry(rgbc, null)) });
    expect((viewOf(world({ c: 0, r: 0, g: 0, b: 0 }), 'color1') as { color: string }).color).toBe('unknown');
    expect((viewOf(world({ c: 15_000, r: 5_000, g: 5_000, b: 5_000 }), 'color1') as { color: string }).color).toBe('white');
    expect((viewOf(world({ c: 3_000, r: 1_000, g: 1_000, b: 1_000 }), 'color1') as { color: string }).color).toBe('black');
  });

  it('leaves the I²C pins to the table: A4 and A5 as the pins say (pulled up once Wire has begun)', () => {
    const { uno } = robot();
    const pins = uno.pins().map((pin) => (pin.pin === 'A4' || pin.pin === 'A5' ? { ...pin, mode: 'INPUT_PULLUP' as const, level: 1 as const } : pin));
    const values = hubValues(map, worldOf(pins));
    expect([values.pins.A4, values.pins.A5]).toEqual([
      { reading: { kind: 'high' }, input: true },
      { reading: { kind: 'high' }, input: true },
    ]);
  });
});

describe('the rover’s tab is as it was (N19 E2)', () => {
  it('a rover world has no gripper, IR or colour view, and its sensor indices are the kit’s', () => {
    const roverMap = hubMap(rover, unoR3Board);
    const { modules } = hubValues(roverMap, { ...idleSnapshot(scenario, rover), t: 1, status: 'running', pins: createVirtualUno(unoR3Board, { now: () => 0, charge: () => {} }).pins() });
    expect(Object.keys(modules).sort()).toEqual(['buzzer', 'button1', 'led1', 'motorLeft', 'motorRight', 'servo1'].sort());
    expect(roverMap.modules.map((module) => module.sensorIndex)).toEqual([-1, -1, 0, 1, 2, 3, -1, -1, -1, -1]);
  });
});

describe('the same sensor indices as the 3D view, in any order of the kit (N19 E2)', () => {
  /** The kit with its modules in `order` (roles), the way a vendor's file might list them: nothing else changes. */
  const reordered = (order: readonly string[]): Kit => ({ ...gripperKit, modules: order.map((role) => gripperKit.modules.find((module) => module.role === role)!) });
  const roles = gripperKit.modules.map((module) => module.role);
  const orders: Record<string, readonly string[]> = {
    'the kit’s own order': roles,
    'reversed': [...roles].reverse(),
    'the IR and colour sensors first': ['irClaw', 'color1', ...roles.filter((role) => role !== 'irClaw' && role !== 'color1')],
    'the colour sensor between the line sensors': ['motorLeft', 'motorRight', 'ultrasonic', 'lineLeft', 'color1', 'lineCenter', 'irClaw', 'lineRight', 'led1', 'button1', 'gripper'],
  };

  it.each(Object.entries(orders))('counts the ultrasonic, line, IR and colour sensors as robot-model.ts does, %s', (_name, order) => {
    const kit = reordered(order);
    const hub = hubMap(kit, unoR3Board);
    const model = robotModel(kit, unoR3Board);
    const hubIndex = (role: string) => hub.modules.find((module) => module.role === role)!.sensorIndex;
    // Every sensor of the model, by role: the line sensors, and the IR and colour sensors on the gripper.
    const modelled = new Map<string, number>([
      ...model.lineSensors.map((sensor) => [sensor.role, sensor.sensorIndex] as const),
      ...(model.gripper?.ir ? [[model.gripper.ir.role, model.gripper.ir.sensorIndex] as const] : []),
      ...(model.gripper?.color ? [[model.gripper.color.role, model.gripper.color.sensorIndex] as const] : []),
    ]);
    expect([...modelled.keys()].sort()).toEqual(['color1', 'irClaw', 'lineCenter', 'lineLeft', 'lineRight']);
    for (const [role, index] of modelled) expect(hubIndex(role), role).toBe(index);
    // The five sensors and the ultrasonic fill 0..5 once each, and no other part takes a place.
    const sensorRoles = ['ultrasonic', ...modelled.keys()];
    expect(sensorRoles.map(hubIndex).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hub.modules.filter((module) => !sensorRoles.includes(module.role)).map((module) => module.sensorIndex)).toEqual(Array(hub.modules.length - 6).fill(-1));
  });
});
