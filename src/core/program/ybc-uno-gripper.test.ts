import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { generateUnoSketch } from '../codegen/arduino/generate';
import { runModuleCall, runModuleRead, type UnoClamp } from '../constructs/uno.run';
import { createProgramIO, createVirtualUno, productionKits, unoR3Board as board, type ColorSensorSpec, type I2cDevice, type Kit, type PinState, type VirtualUno } from '../hardware';
import { createTcs34725, type LightIntegral, type Rgbc } from '../hardware/devices/tcs34725';
import { COLOR_CHANNELS, COLOR_NAMES, COLOR_RAW_MAX, type ColorChannel, type ColorName } from '../hardware/drivers';
import { startVirtualRun } from '../run/__fixtures__/virtual-run';
import { WORLD_TICK_MS } from '../run/virtual-clock';
import { unoUsesOf } from './uno-uses';
import { int, bool } from './values';
import type { Expr, ModuleReadExpr, YbcProgramIR, YbcStatement } from './ybc-ir';

// N19 A4 (plan §4.3, rows U-35…U-39): the gripper car's ops of a uno program as IR, through the interpreter, the module binding, the
// virtual UNO and the TCS34725 register model (A3), and to C++. The blocks that compile to them are tested with the blocks.

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const colorSpec = kit.modules.find((module) => module.role === 'color1')?.spec as unknown as ColorSensorSpec;
const dt = WORLD_TICK_MS;

const lit = (value: number): Expr => ({ blockId: `n${String(value)}`, type: 'int', kind: 'int', value });
const plus = (left: Expr, right: Expr): Expr => ({ blockId: 'plus', type: 'int', kind: 'arith', op: '+', left, right });
const get = (variable: string): Expr => ({ blockId: `get-${variable}`, type: 'int', kind: 'variable', variable });
const set = (variable: string, value: Expr, blockId = `set-${variable}`): YbcStatement => ({ kind: 'set', variable, value, blockId });
const claw = (angle: Expr, blockId: string): YbcStatement => ({ kind: 'call', op: 'gripper.claw', operand: { kind: 'role', role: 'gripper' }, args: [angle], blockId });
const lift = (angle: Expr, blockId: string): YbcStatement => ({ kind: 'call', op: 'gripper.lift', operand: { kind: 'role', role: 'gripper' }, args: [angle], blockId });
const irDetect = (blockId = 'ir'): Expr & ModuleReadExpr => ({ blockId, type: 'bool', kind: 'read', op: 'ir.detect', operand: { kind: 'role', role: 'irClaw' } });
const colorIs = (color: ColorName, blockId = `is-${color}`): Expr & ModuleReadExpr & { op: 'color.is' } => ({ blockId, type: 'bool', kind: 'read', op: 'color.is', operand: { kind: 'role', role: 'color1' }, color });
const colorRaw = (channel: ColorChannel, blockId = `raw-${channel}`): Expr & ModuleReadExpr & { op: 'color.raw' } => ({ blockId, type: 'int', kind: 'read', op: 'color.raw', operand: { kind: 'role', role: 'color1' }, channel });
const print = (value: Expr, blockId: string): YbcStatement => ({ kind: 'print', value, blockId });
const ir = (onStart: YbcStatement[], forever: YbcStatement[] | null = null): YbcProgramIR => ({
  onStart,
  forever,
  variables: [{ id: 'x', name: 'x', type: 'int' }],
  numeric: 'cxx-int32',
  loopPauseUs: 0,
});

/** What the TCS34725 sees in front of an object of `hex` (PLACEHOLDER, A3's: B3 makes the world's), counts per second at 1×. */
function irradianceOf(hex: string): Rgbc {
  const ambient = colorSpec.ambientPerMs * 1000;
  const component = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const channel = (whitePerMs: number, value: number) => Math.floor((whitePerMs * 1000 * value) / 255) + ambient;
  const r = channel(colorSpec.whiteRPerMs, component(1));
  const g = channel(colorSpec.whiteGPerMs, component(3));
  const b = channel(colorSpec.whiteBPerMs, component(5));
  return { c: r + g + b, r, g, b };
}
const steady =
  (light: Rgbc): LightIntegral =>
  (from, to) => {
    const span = Math.round(to - from);
    return { c: light.c * span, r: light.r * span, g: light.g * span, b: light.b * span };
  };

/** The program's capabilities on the gripper car: a virtual UNO on the run's clock, the TCS34725 under `light` (none: no sensor). */
function onGripper(program: YbcProgramIR, light: LightIntegral | null, watch?: (device: I2cDevice) => I2cDevice, ir: () => 0 | 1 = () => 1) {
  let uno: VirtualUno | undefined;
  const run = startVirtualRun(program, {
    scheduler: { delayOverheadUs: board.costsUs.delayOverhead },
    capabilities: ({ scheduler }): Capabilities => {
      uno = createVirtualUno(board, scheduler.programClock);
      uno.attachDigitalSource('A3', ir);
      if (light !== null) {
        const device = createTcs34725(light);
        uno.attachWireDevice(device.address, watch ? watch(device) : device);
      }
      return createProgramIO(kit, uno, unoUsesOf(program, kit));
    },
  });
  const pin = (id: string) => uno?.pins().find((state) => state.pin === id) as PinState;
  return { run, pin };
}

describe('the claw and the lift (U-35, U-36)', () => {
  it('claw 120 clamps to 90 and warns once', async () => {
    const program = ir([set('x', plus(lit(120), lit(0))), claw(get('x'), 'claw-1'), claw(get('x'), 'claw-2'), lift(get('x'), 'lift-1')]);
    const { run, pin } = onGripper(program, null);
    expect(await run.runUntilDone(50)).not.toBeNull();
    expect(run.outcome()).toEqual({ status: 'finished' });
    // Once per role per run (contract §0.5): the claw and the lift are the one role `gripper`.
    expect(run.warnings).toEqual([{ code: 'value-clamped', message: 'The angle 120 for the gripper is outside 0 to 90, so it is clamped to 90.', blockId: 'claw-1' }]);
    expect([pin('D9').servoDeg, pin('D10').servoDeg]).toEqual([90, 90]);
  });

  it('turns the claw on D9 and the lift on D10 to the angle, -5 to 0; setup() wrote claw 0, lift 90', () => {
    const calls: [string, string, readonly number[]][] = [];
    const clamps: UnoClamp[] = [];
    const capabilities: Capabilities = { modules: { call: (role, op, args) => void calls.push([role, op, args]), read: () => 0 } };
    runModuleCall({ kind: 'call', op: 'gripper.claw', operand: { kind: 'role', role: 'gripper' }, args: [lit(0)], blockId: 'c' }, [int(80)], capabilities, (clamp) => clamps.push(clamp));
    runModuleCall({ kind: 'call', op: 'gripper.lift', operand: { kind: 'role', role: 'gripper' }, args: [lit(0)], blockId: 'l' }, [int(-5)], capabilities, (clamp) => clamps.push(clamp));
    expect(calls).toEqual([
      ['gripper', 'gripper.claw', [80]],
      ['gripper', 'gripper.lift', [0]],
    ]);
    expect(clamps).toEqual([{ key: 'gripper', warning: { code: 'value-clamped', message: 'The angle -5 for the gripper is outside 0 to 90, so it is clamped to 0.' } }]);
  });
});

describe('the IR sensor and the colour sensor (U-37…U-39)', () => {
  it('reads the IR sensor on A3: true while the module pulls it LOW (activeLow), false while it is HIGH', async () => {
    const levels: (0 | 1)[] = [0, 1, 0];
    const program = ir([print(irDetect('ir-1'), 'p1'), print(irDetect('ir-2'), 'p2'), print(irDetect('ir-3'), 'p3')]);
    const { run, pin } = onGripper(program, null, undefined, () => levels.shift() ?? 1);
    expect(await run.runUntilDone(5)).not.toBeNull();
    expect(run.lines()).toEqual(['1', '0', '1']);
    expect(pin('A3').mode).toBe('INPUT');
  });

  it('color.is red true for the red palette window', async () => {
    const program = ir([print(colorIs('red', 'r'), 'p-red'), print(colorIs('green', 'g'), 'p-green'), print(colorIs('unknown', 'u'), 'p-unknown')]);
    const { run } = onGripper(program, steady(irradianceOf('#d32f2f')));
    expect(await run.runUntilDone(20)).not.toBeNull();
    expect(run.outcome()).toEqual({ status: 'finished' });
    expect(run.lines()).toEqual(['1', '0', '0']);
  });

  it('color.raw c in 0..21504: a light that saturates the window reads 21504, no sensor reads 0 and is unknown', async () => {
    expect(COLOR_RAW_MAX).toBe(21504);
    const program = ir([print(colorRaw('clear'), 'p-c'), print(colorRaw('red'), 'p-r'), print(colorIs('unknown'), 'p-u')]);
    const bright = onGripper(program, steady({ c: 3_000_000, r: 1_000_000, g: 1_000_000, b: 1_000_000 }));
    expect(await bright.run.runUntilDone(20)).not.toBeNull();
    expect(bright.run.lines()).toEqual(['21504', '21504', '0']);
    const none = onGripper(program, null);
    expect(await none.run.runUntilDone(20)).not.toBeNull();
    expect(none.run.lines()).toEqual(['0', '0', '1']);
  });

  it('asks the board with the colour’s index and the channel’s, and refuses an answer outside the row’s domain', () => {
    const reads: [string, string, readonly number[] | undefined][] = [];
    let answer: number | boolean = true;
    const capabilities: Capabilities = { modules: { call: () => undefined, read: (role, op, args) => (reads.push([role, op, args]), answer) } };
    expect(COLOR_NAMES).toEqual(['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown']);
    expect(COLOR_CHANNELS).toEqual(['red', 'green', 'blue', 'clear']);
    expect(COLOR_NAMES.map((name) => runModuleRead(colorIs(name), capabilities))).toEqual(COLOR_NAMES.map(() => bool(true)));
    answer = 21504;
    expect(COLOR_CHANNELS.map((channel) => runModuleRead(colorRaw(channel), capabilities))).toEqual(COLOR_CHANNELS.map(() => int(21504)));
    expect(reads).toEqual([
      ...COLOR_NAMES.map((_, index) => ['color1', 'color.is', [index]]),
      ...COLOR_CHANNELS.map((_, index) => ['color1', 'color.raw', [index]]),
    ]);
    answer = 21505;
    expect(() => runModuleRead(colorRaw('clear'), capabilities)).toThrow('The raw colour value is not a whole number from 0 to 21504.');
    expect(() => runModuleRead(colorIs('red'), capabilities)).toThrow('A sensor gave no true / false value.');
    answer = false;
    expect(runModuleRead(irDetect(), capabilities)).toEqual(bool(false));
    expect(() => runModuleRead({ ...colorIs('red'), color: 'purple' as ColorName }, capabilities)).toThrow('A colour block names a colour that does not exist.');
    expect(() => runModuleRead({ ...colorRaw('red'), channel: 'alpha' as ColorChannel }, capabilities)).toThrow('A colour block names a channel that does not exist.');
  });

  it('a color.is read never leads the world by more than one tick: every bus event within [world.t, world.t + dt + 1123.8125 µs)', async () => {
    const events: { us: number; worldMs: number }[] = [];
    const light: { to: number; worldMs: number }[] = [];
    let worldMs = (): number => 0;
    const program = ir([], [print(colorIs('red', 'is-red'), 'p')]);
    const integral = steady(irradianceOf('#d32f2f'));
    const watched = onGripper(
      program,
      (from, to) => {
        light.push({ to, worldMs: worldMs() });
        return integral(from, to);
      },
      (device) => ({
        connect: (us, read) => (events.push({ us, worldMs: worldMs() }), device.connect(us, read)),
        write: (us, byte) => (events.push({ us, worldMs: worldMs() }), device.write(us, byte)),
        read: (us) => (events.push({ us, worldMs: worldMs() }), device.read(us)),
        stop: (us) => (events.push({ us, worldMs: worldMs() }), device.stop(us)),
      }),
    );
    worldMs = () => watched.run.worldMs();
    for (let k = 0; k < 240; k++) {
      await watched.run.tick(k);
    }
    watched.run.stop();
    const bound = (at: { worldMs: number }) => at.worldMs * 1000 + dt * 1000 + 1123.8125;
    // setup()'s colorBegin, then about one read per 1.3 ms of the program clock: 2 s of it.
    expect(events.length).toBeGreaterThan(10 * 1000);
    expect(events.filter((event) => !(event.worldMs * 1000 <= event.us && event.us < bound(event)))).toEqual([]);
    expect(light.filter((ask) => !(ask.to < bound(ask)))).toEqual([]);
    expect(new Set(watched.run.lines())).toEqual(new Set(['1']));
  });
});

describe('what a gripper program uses (uno-uses.ts)', () => {
  it('uses each op once, in the order met; the claw or the lift takes the servo claim (its driver’s), the colour reads none', () => {
    const program = ir([print(colorIs('red'), 'p1'), set('x', colorRaw('green')), print(colorIs('blue'), 'p2'), print(irDetect(), 'p3')], [lift(lit(90), 'lift'), claw(lit(0), 'claw')]);
    const uses = unoUsesOf(program, kit);
    expect(uses.modules).toEqual([
      { role: 'color1', op: 'color.is' },
      { role: 'color1', op: 'color.raw' },
      { role: 'irClaw', op: 'ir.detect' },
      { role: 'gripper', op: 'gripper.lift' },
      { role: 'gripper', op: 'gripper.claw' },
    ]);
    expect(uses.usage).toEqual({ servo: true, tone: false, serial: true });
    expect(unoUsesOf(ir([print(colorIs('red'), 'p')]), kit).usage).toEqual({ servo: false, tone: false, serial: true });
    // The colour helper once, colorBegin once in setup(), whichever colour op or both.
    const generated = generateUnoSketch(program, { kit, board });
    expect(generated.ok && generated.source.match(/colorBegin\(\);/g)?.length).toBe(1);
    expect(generated.ok && generated.source.match(/^bool colorIs\(uint8_t n\) \{$/gm)?.length).toBe(1);
  });
});

describe('the gripper car’s ops in C++ (plan §4.3)', () => {
  it('writes gripperSet for the claw and the lift, the IR pin compared LOW, colorIs(n) and colorRaw(k) with the index as a long', () => {
    const program = ir([
      claw(lit(80), 'claw'),
      lift(lit(0), 'lift'),
      set('x', colorRaw('clear', 'raw'), 'set-raw'),
      { kind: 'if', branches: [{ condition: irDetect('ir'), body: [claw(lit(0), 'open')] }], else: [], blockId: 'if-ir' },
      { kind: 'if', branches: [{ condition: colorIs('yellow', 'is'), body: [lift(lit(90), 'up')] }], else: [], blockId: 'if-colour' },
    ]);
    const generated = generateUnoSketch(program, { kit, board });
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    const source = generated.source;
    const lines = source.split('\n');
    const setupBody = lines.slice(lines.indexOf('void setup() {') + 1, lines.indexOf('void loop() {') - 2);
    expect(setupBody.filter((line) => !line.startsWith('    '))).toEqual([
      '  gripperClaw.attach(GRIPPER_CLAW);',
      '  gripperClaw.write(0);',
      '  gripperLift.attach(GRIPPER_LIFT);',
      '  gripperLift.write(90);',
      '  pinMode(IR_CLAW_PIN, INPUT);',
      '  colorBegin();',
      '  gripperSet(gripperClaw, 80L);',
      '  gripperSet(gripperLift, 0L);',
      '  x = colorRaw(3L);',
      '  if ((digitalRead(IR_CLAW_PIN) == LOW)) {',
      '  }',
      '  if (colorIs(3L)) {',
      '  }',
    ]);
    expect(source).toContain('#include <Servo.h>\n#include <Wire.h>');
    expect(source).toContain('#define GRIPPER_CLAW 9\n#define GRIPPER_LIFT 10\n#define IR_CLAW_PIN A3\n#define COLOR1_SDA A4\n#define COLOR1_SCL A5');
    expect(generated.libraries.map((library) => `${library.name}@${library.version}`)).toEqual(['arduino:avr@1.8.8', 'Servo@1.3.0', 'Wire@1.0']);
  });
});
