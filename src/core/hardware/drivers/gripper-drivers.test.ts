import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../../capabilities/services';
import { createModuleIO, type ModuleBinding } from '../binding';
import { productionKits, unoR3Board as board } from '../catalog';
import { createTcs34725, TCS_STEP_US, type LightIntegral, type Rgbc } from '../devices/tcs34725';
import type { ColorSensorSpec, Kit, KitPort } from '../kit';
import { createVirtualUno, type I2cDevice, type PinState } from '../virtual-uno';
import { classifyColor, COLOR_NAMES, COLOR_RULES, colorRulesCpp, drivers, kitCpp, runSetup, type ModuleUse } from './index';
import { colorBeginSim, colorFetchSim, colorHelperText, wireLibrary } from './tcs34725';

// N19 A3 (plan §4.1–§4.3, ADR 0004 §11): the gripper car's three drivers on the virtual UNO, through the module binding as a program
// drives them, against their C++ (the forms gripper-forms.ino ran on avr8js, EMU-19) and the board's times (EMU-20).

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const portOf = (id: string) => kit.ports.find((port) => port.id === id) as KitPort;
const colorSpec = kit.modules.find((module) => module.role === 'color1')?.spec as unknown as ColorSensorSpec;

function bench() {
  let us = 0;
  const clock: ProgramClock = { now: () => us / 1000, charge: (by) => void (us += by) };
  const uno = createVirtualUno(board, clock);
  const state = (pin: string) => uno.pins().find((candidate) => candidate.pin === pin) as PinState;
  const charged = (work: () => unknown) => {
    const before = us;
    work();
    return us - before;
  };
  return { uno, state, charged, nowUs: () => us };
}

/** What the TCS34725 sees in front of an object of `hex` (PLACEHOLDER, as the G0.2 spike's: B3 makes the world's): each channel's
 * white counts per second at 1× times the sRGB component / 255, plus the ambient; the clear channel is R + G + B. */
function irradianceOf(hex: string | null, spec: ColorSensorSpec = colorSpec): Rgbc {
  const ambient = spec.ambientPerMs * 1000;
  if (hex === null) {
    return { c: 3 * ambient, r: ambient, g: ambient, b: ambient };
  }
  const component = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const channel = (whitePerMs: number, value: number) => Math.floor((whitePerMs * 1000 * value) / 255) + ambient;
  const r = channel(spec.whiteRPerMs, component(1));
  const g = channel(spec.whiteGPerMs, component(3));
  const b = channel(spec.whiteBPerMs, component(5));
  return { c: r + g + b, r, g, b };
}
/** A light that is `before` until `switchUs`, then `after` (counts per second at 1×), integrated over whole µs. */
function lightOf(before: Rgbc, after: Rgbc = before, switchUs: () => number = () => Number.POSITIVE_INFINITY): LightIntegral {
  return (from, to) => {
    const at = switchUs();
    const spanBefore = Math.max(0, Math.round(Math.min(to, at) - from));
    const spanAfter = Math.max(0, Math.round(to - Math.max(from, at)));
    const of = (key: keyof Rgbc) => before[key] * spanBefore + after[key] * spanAfter;
    return { c: of('c'), r: of('r'), g: of('g'), b: of('b') };
  };
}

/** The module binding of the gripper kit on a fresh virtual UNO, its setup() run for `uses`, with a TCS34725 under `light` (or none). */
function program(uses: readonly ModuleUse[], light: LightIntegral | null = lightOf(irradianceOf('#f5f5f5'))) {
  const parts = bench();
  const device = light === null ? null : createTcs34725(light);
  if (device) {
    parts.uno.attachWireDevice(device.address, device);
  }
  let modules: ModuleBinding | null = null;
  const setupUs = parts.charged(() => (modules = createModuleIO(kit, parts.uno, uses)));
  return { ...parts, device, setupUs, modules: modules as unknown as ModuleBinding };
}

/** The C++ table of the helper read back from its text, and a reading classified by it with the C++'s unsigned long arithmetic. */
function cppClassify(text: string, reading: Rgbc): number {
  const rows = [...text.matchAll(/^ {2}\{([\d, ]+)\},$/gm)].map((match) => (match[1] ?? '').split(', ').map(Number));
  const count = Number(/#define COLOR_RULE_COUNT (\d+)/.exec(text)?.[1]);
  const sum = reading.r + reading.g + reading.b;
  const share = (value: number) => (sum === 0 ? 0 : Math.trunc((value * 1000) / sum));
  const [r, g, b] = [share(reading.r), share(reading.g), share(reading.b)];
  for (const rule of rows.slice(0, count)) {
    const [colour, cMin, cMax, rMin, rMax, gMin, gMax, bMin, bMax] = rule as [number, number, number, number, number, number, number, number, number];
    if (reading.c >= cMin && reading.c <= cMax && r >= rMin && r <= rMax && g >= gMin && g <= gMax && b >= bMin && b <= bMax) {
      return colour;
    }
  }
  return Number(/ {2}return (\d+);\n\}\nbool colorIs/.exec(text)?.[1]);
}

const PALETTE = { red: '#d32f2f', green: '#388e3c', blue: '#1976d2', yellow: '#fbc02d', white: '#f5f5f5', black: '#212121' } as const;
const COLOR_USES: ModuleUse[] = [
  { role: 'color1', op: 'color.is' },
  { role: 'color1', op: 'color.raw' },
];

describe('gripper-servo2 (U-35, U-36)', () => {
  it('attaches both servos in setup(), claw 0° (open) and lift 90° (up), whichever op the program uses, and takes Timer1', () => {
    for (const op of ['gripper.claw', 'gripper.lift']) {
      const { state, setupUs } = program([{ role: 'gripper', op }], null);
      expect([state('D9').servoDeg, state('D10').servoDeg, state('D9').mode, state('D10').mode], op).toEqual([0, 90, 'OUTPUT', 'OUTPUT']);
      expect(setupUs, op).toBe(2 * board.costsUs.servoWrite);
    }
  });

  it('turns the claw on D9 and the lift on D10, each call gripperSet’s 51.625 µs', () => {
    const { modules, state, charged } = program([{ role: 'gripper', op: 'gripper.claw' }, { role: 'gripper', op: 'gripper.lift' }], null);
    expect(charged(() => modules.call('gripper', 'gripper.claw', [80]))).toBe(51.625);
    expect(charged(() => modules.call('gripper', 'gripper.lift', [0]))).toBe(51.625);
    expect([state('D9').servoDeg, state('D10').servoDeg]).toEqual([80, 0]);
  });

  it('the gripper.claw(120) sim clamps to 90 and warns once per role per run (a lift of -5 is 0, and no second warning)', () => {
    const { modules, state, uno } = program([{ role: 'gripper', op: 'gripper.claw' }, { role: 'gripper', op: 'gripper.lift' }], null);
    modules.call('gripper', 'gripper.claw', [120]);
    modules.call('gripper', 'gripper.lift', [-5]);
    modules.call('gripper', 'gripper.claw', [200]);
    expect([state('D9').servoDeg, state('D10').servoDeg]).toEqual([90, 0]);
    expect(uno.diagnostics()).toEqual([
      { severity: 'warning', code: 'value-clamped', role: 'gripper', message: 'gripper.claw on gripper: angle 120 is outside 0..90, so 90 is used.' },
    ]);
    // The driver clamps again, as gripperSet does: a value past 90 never reaches Servo.write.
    const raw = bench();
    drivers['gripper-servo2'].ops['gripper.claw']?.sim(raw.uno.io, portOf('GR1'), [150]);
    expect(raw.state('D9').servoDeg).toBe(90);
  });

  it('writes the C++ of plan §4.3: two Servo globals, gripperSet, attach and write in setup(), Servo 1.3.0', () => {
    const cpp = kitCpp(kit, [{ role: 'gripper', op: 'gripper.lift' }]);
    expect(cpp).toEqual({
      libraries: [
        { name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' },
        { name: 'Servo', version: '1.3.0', license: 'LGPL-2.1' },
      ],
      includes: ['#include <Servo.h>'],
      defines: ['#define GRIPPER_CLAW 9', '#define GRIPPER_LIFT 10'],
      globals: ['Servo gripperClaw;', 'Servo gripperLift;'],
      helpers: [{ id: 'gripper-servo2', text: 'void gripperSet(Servo &servo, long angle) {\n  if (angle < 0L) angle = 0L;\n  if (angle > 90L) angle = 90L;\n  servo.write((int)angle);\n}' }],
      setup: ['gripperClaw.attach(GRIPPER_CLAW);', 'gripperClaw.write(0);', 'gripperLift.attach(GRIPPER_LIFT);', 'gripperLift.write(90);'],
    });
    const ops = drivers['gripper-servo2'].ops;
    expect([ops['gripper.claw']?.cpp.call(portOf('GR1'), 'gripper', ['80L']), ops['gripper.lift']?.cpp.call(portOf('GR1'), 'gripper', ['90L'])]).toEqual([
      'gripperSet(gripperClaw, 80L);',
      'gripperSet(gripperLift, 90L);',
    ]);
    expect([ops['gripper.claw']?.claims, ops['gripper.lift']?.claims]).toEqual(['servo', 'servo']);
  });
});

describe('ir-digital (U-37)', () => {
  it('sees an object while A3 reads LOW (activeLow), sets A3 up as an INPUT, and costs one digitalRead', () => {
    let level: 0 | 1 = 1;
    const { modules, uno, state, charged } = program([{ role: 'irClaw', op: 'ir.detect' }], null);
    uno.attachDigitalSource('A3', () => level);
    expect(state('A3').mode).toBe('INPUT');
    let seen: number | boolean = true;
    expect(charged(() => (seen = modules.read('irClaw', 'ir.detect')))).toBe(3.9375);
    expect(seen).toBe(false);
    level = 0;
    expect(modules.read('irClaw', 'ir.detect')).toBe(true);
    expect(drivers['ir-digital'].ops['ir.detect']?.cpp.call(portOf('IR1'), 'irClaw', [])).toBe('(digitalRead(IR_CLAW_PIN) == LOW)');
  });

  it('honours a kit that says the sensor is not active-low: HIGH is an object', () => {
    const port: KitPort = { ...portOf('IR1'), params: { activeLow: false } };
    const { uno } = bench();
    uno.attachDigitalSource('A3', () => 1);
    expect(drivers['ir-digital'].ops['ir.detect']?.sim(uno.io, port, [])).toBe(true);
    expect(drivers['ir-digital'].ops['ir.detect']?.cpp.call(port, 'irClaw', [])).toBe('(digitalRead(IR_CLAW_PIN) == HIGH)');
  });
});

describe('tcs34725-wire (U-38, U-39): the C++', () => {
  it('writes its helper from COLOR_RULES: the table rows are the rules, and the generated text is the driver golden’s', () => {
    const text = colorHelperText();
    expect(text).toContain(colorRulesCpp());
    expect([...text.matchAll(/^ {2}\{([\d, ]+)\},$/gm)].map((match) => (match[1] ?? '').split(', ').map(Number))).toEqual(COLOR_RULES.map((rule) => [...rule]));
    expect(drivers['tcs34725-wire'].ops['color.is']?.cpp.helper).toEqual({ id: 'tcs34725-wire', text });
    // drivers-cpp.test.ts snapshots the driver (C1 reuses it): the helper is in it as generated.
    expect(readFileSync(join(process.cwd(), 'src/core/hardware/drivers/__golden__/tcs34725-wire.cpp'), 'utf8')).toContain(`\n${text}\n`);
  });

  it('is the code gripper-forms.ino ran on avr8js (EMU-19), comment lines aside, with gripperSet before it', () => {
    const sketch = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/gripper-forms/gripper-forms.ino'), 'utf8');
    const block = sketch.slice(sketch.indexOf('// GRIPPER HELPERS begin'), sketch.indexOf('// GRIPPER HELPERS end'));
    const code = (text: string) => text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('//'));
    const gripperSet = drivers['gripper-servo2'].ops['gripper.claw']?.cpp.helper?.text ?? '';
    const [addressLine, ...colour] = code(colorHelperText());
    expect(addressLine).toBe('#define COLOR_ADDR 0x29');
    expect(code(block)).toEqual([...code(gripperSet), ...colour]);
    expect(sketch).toContain('#define COLOR_ADDR 0x29\n');
    expect(drivers['tcs34725-wire'].ops['color.raw']?.cpp.globals(portOf('CS1'), 'color1').every((line) => sketch.includes(`\n${line}\n`))).toBe(true);
  });

  it('includes Wire.h and declares Wire 1.0 (LGPL-2.1), calls colorBegin() in setup() and colorIs(n) / colorRaw(k)', () => {
    const cpp = kitCpp(kit, COLOR_USES);
    expect(cpp.libraries).toEqual([{ name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' }, wireLibrary]);
    expect(wireLibrary).toEqual({ name: 'Wire', version: '1.0', license: 'LGPL-2.1' });
    expect([cpp.includes, cpp.defines, cpp.setup, cpp.helpers.map((helper) => helper.id)]).toEqual([['#include <Wire.h>'], ['#define COLOR1_SDA A4', '#define COLOR1_SCL A5'], ['colorBegin();'], ['tcs34725-wire']]);
    expect(cpp.globals).toEqual(['uint16_t colorC = 0;', 'uint16_t colorR = 0;', 'uint16_t colorG = 0;', 'uint16_t colorB = 0;']);
    const ops = drivers['tcs34725-wire'].ops;
    expect([ops['color.is']?.cpp.call(portOf('CS1'), 'color1', ['3L']), ops['color.raw']?.cpp.call(portOf('CS1'), 'color1', ['0L'])]).toEqual(['colorIs(3L)', 'colorRaw(0L)']);
    expect([ops['color.is']?.claims, ops['color.raw']?.claims]).toEqual([undefined, undefined]);
  });
});

describe('tcs34725-wire (U-38, U-39): on the virtual UNO with the TCS34725 model', () => {
  it('every palette colour (#d32f2f, #388e3c, #1976d2, #fbc02d, #f5f5f5, #212121) classifies the same in the TS rules and in the C++ table text', () => {
    const text = colorHelperText();
    for (const [name, hex] of Object.entries(PALETTE)) {
      const { modules } = program(COLOR_USES, lightOf(irradianceOf(hex)));
      const reading = { r: modules.read('color1', 'color.raw', [0]), g: modules.read('color1', 'color.raw', [1]), b: modules.read('color1', 'color.raw', [2]), c: modules.read('color1', 'color.raw', [3]) } as Rgbc;
      const index = COLOR_NAMES.indexOf(name as (typeof COLOR_NAMES)[number]);
      expect([classifyColor(reading), cppClassify(text, reading)], `${name} ${JSON.stringify(reading)}`).toEqual([index, index]);
      expect(COLOR_NAMES.map((_, n) => modules.read('color1', 'color.is', [n])), name).toEqual(COLOR_NAMES.map((_, n) => n === index));
    }
    // The readings the G0.2 runs printed from the HEX for the palette (white there was #ffffff, which saturates C as #f5f5f5 does).
    const { modules } = program(COLOR_USES, lightOf(irradianceOf('#d32f2f')));
    expect([3, 0, 1, 2].map((k) => modules.read('color1', 'color.raw', [k]))).toEqual([11100, 8047, 1675, 1377]);
  });

  it('first integration ready 2.4 ms + 50.4 ms after the AEN byte (the 52.8 ms cycle of §11): after setup() a read has the first window', () => {
    const windows: [number, number][] = [];
    const light = lightOf(irradianceOf('#d32f2f'));
    const { modules, device, uno, nowUs, setupUs } = program(COLOR_USES, (from, to) => (windows.push([from, to]), light(from, to)));
    // colorBegin's writes with their bus times: the ENABLE byte with AEN ends 4331.625 µs into setup() (4336 on the board, EMU-20).
    expect(setupUs).toBe(board.costsUs.colorBegin + 57_000 + 2 * board.costsUs.delayOverhead);
    expect(setupUs).toBe(58_367.6875);
    const aenUs = 4331.625;
    expect(device?.peek(nowUs())).toMatchObject({ enable: 0x03, atime: 0xeb, control: 0x01, nextWindowEndUs: aenUs + 2 * 52_800 });
    expect(modules.read('color1', 'color.raw', [3])).toBe(11_100);
    expect(windows).toEqual([[aenUs + TCS_STEP_US, aenUs + 52_800]]);
    expect(uno.diagnostics()).toEqual([]);
  });

  it('NACK gives zeros, which classify as không rõ (unknown): setup() and each read take their NACK times and warn wire-nack once', () => {
    const { modules, uno, charged, setupUs } = program(COLOR_USES, null);
    expect(setupUs).toBe(589.4375 + 57_017.125);
    let value: number | boolean = -1;
    expect(charged(() => (value = modules.read('color1', 'color.raw', [3])))).toBe(146.0625);
    expect(value).toBe(0);
    expect([0, 1, 2].map((k) => modules.read('color1', 'color.raw', [k]))).toEqual([0, 0, 0]);
    expect(charged(() => (value = modules.read('color1', 'color.is', [6])))).toBe(146.0625 + 12.5625);
    expect(value).toBe(true);
    expect(COLOR_NAMES[classifyColor({ c: 0, r: 0, g: 0, b: 0 })]).toBe('unknown');
    expect([0, 1, 2, 3, 4, 5].map((n) => modules.read('color1', 'color.is', [n]))).toEqual([false, false, false, false, false, false]);
    expect(uno.diagnostics()).toEqual([{ severity: 'warning', code: 'wire-nack', address: 0x29, message: 'No I²C device answers at address 0x29: the write is not acknowledged.' }]);
  });

  it('charges colorFetch (1158.5 µs) for a raw read and colorClassify for color.is: the longest rule, or the no-division path on zeros', () => {
    const lit = program(COLOR_USES);
    expect(lit.charged(() => lit.modules.read('color1', 'color.raw', [0]))).toBe(1158.5);
    expect(lit.charged(() => lit.modules.read('color1', 'color.is', [4]))).toBe(1158.5 + 147.25);
    const dark = program(COLOR_USES, lightOf({ c: 0, r: 0, g: 0, b: 0 }));
    expect(dark.charged(() => expect(dark.modules.read('color1', 'color.is', [6])).toBe(true))).toBe(1158.5 + 12.5625);
  });

  it('clamps a colour index or a channel outside its range, with one value-clamped warning for the role', () => {
    const { modules, uno } = program(COLOR_USES, lightOf({ c: 0, r: 0, g: 0, b: 0 }));
    expect(modules.read('color1', 'color.is', [9])).toBe(true);
    expect(modules.read('color1', 'color.raw', [-1])).toBe(0);
    expect(uno.diagnostics()).toEqual([{ severity: 'warning', code: 'value-clamped', role: 'color1', message: 'color.is on color1: colour 9 is outside 0..6, so 6 is used.' }]);
  });

  it('a window ending mid-read gives the board’s result: C (read first) from the window before, R, G, B from the window after', () => {
    let switchUs = Number.POSITIVE_INFINITY;
    const { uno, device, nowUs } = program(COLOR_USES, lightOf(irradianceOf('#d32f2f'), irradianceOf('#1976d2'), () => switchUs));
    const second = device?.peek(nowUs()).nextWindowEndUs ?? 0;
    // Blue from the second window's RGBC Init on, so the second window is blue and the first red; the read starts so that the second
    // window ends 495 µs in: after C's two bytes (354.31 and 449.25 µs in; 353.31 and 448.25 on the board), before R's (544.19; 543.31).
    switchUs = second - 52_800 + 1000;
    uno.io.compute(second - 495 - nowUs());
    const reading = colorFetchSim(uno.io);
    expect(reading).toEqual({ c: 11_100, r: 988, g: 4144, b: 6017 });
    expect(COLOR_NAMES[classifyColor(reading)]).toBe('blue');
    // The next read is the second window whole.
    expect(colorFetchSim(uno.io)).toEqual({ c: 11_150, r: 988, g: 4144, b: 6017 });
  });
});

describe('tcs34725-wire: where the bus events fall, against the board (spikes/avr8js/out/gripper-timeline.json, EMU-20)', () => {
  type Timeline = { totalUs: number; deviceCalls: { kind: string; atUs: number; byte?: number; read?: boolean }[] };
  const measured = JSON.parse(readFileSync(join(process.cwd(), 'spikes/avr8js/out/gripper-timeline.json'), 'utf8')) as { withDevice: Record<string, Timeline> };

  /** The calls the bus makes on the model while `run` runs, µs from its start. */
  function recorded(run: (io: ReturnType<typeof bench>['uno']['io']) => void) {
    const { uno, nowUs, charged } = bench();
    const model = createTcs34725(lightOf(irradianceOf('#f5f5f5')));
    const calls: { kind: string; atUs: number; byte?: number; read?: boolean }[] = [];
    let startUs = 0;
    const logged: I2cDevice = {
      connect: (now, read) => (calls.push({ kind: 'connect', atUs: now - startUs, read }), model.connect(now, read)),
      write: (now, byte) => (calls.push({ kind: 'write', atUs: now - startUs, byte }), model.write(now, byte)),
      read: (now) => {
        const byte = model.read(now);
        calls.push({ kind: 'read', atUs: now - startUs, byte });
        return byte;
      },
      stop: (now) => void (calls.push({ kind: 'stop', atUs: now - startUs }), model.stop(now)),
    };
    uno.attachWireDevice(0x29, logged);
    const prepare = () => colorBeginSim(uno.io);
    return { calls, uno, nowUs, charged, logged, prepare, setStart: (us: number) => void (startUs = us), run: () => charged(() => run(uno.io)) };
  }

  it('colorBegin: every event within 5 µs of the board’s (its own statements are split by the two measured totals), the total exact', () => {
    const { calls, run } = recorded((io) => runSetup(io, portOf('CS1'), [{ kind: 'helper', name: 'colorBegin' }], drivers['tcs34725-wire'].setupHelpers));
    const board = measured.withDevice.colorBegin as Timeline;
    expect(run()).toBe(board.totalUs);
    expect(calls.map(({ kind, byte, read }) => [kind, byte, read])).toEqual(board.deviceCalls.map(({ kind, byte, read }) => [kind, byte, read]));
    const worst = Math.max(...calls.map((call, index) => Math.abs(call.atUs - (board.deviceCalls[index]?.atUs ?? Number.NaN))));
    expect(worst).toBeLessThanOrEqual(5);
  });

  it('colorFetch: every event within 1.25 µs of the board’s, the eight bytes one by one, the total exact', () => {
    const { calls, prepare, setStart, nowUs, run } = recorded((io) => void colorFetchSim(io));
    prepare();
    calls.length = 0;
    setStart(nowUs());
    const board = measured.withDevice['colorFetch, servos detached'] as Timeline;
    expect(run()).toBe(board.totalUs);
    expect(calls.map(({ kind, read }) => [kind, read])).toEqual(board.deviceCalls.map(({ kind, read }) => [kind, read]));
    const offsets = calls.map((call, index) => call.atUs - (board.deviceCalls[index]?.atUs ?? Number.NaN));
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(1.25);
  });
});
