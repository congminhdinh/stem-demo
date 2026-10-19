import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { accelerationType, axisNames, gestureIsType, gestureNames, temperatureType } from '../constructs/ybc.input';
import { boardTargetOf } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import {
  acceleration, cmp, gestureIs, ifThen, num, print, program, scrollNumber, scrollText, temperature, type Json,
} from './__fixtures__/ybc-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import type { YbcRunOutcome } from './ybc-interpreter';
import type { Expr, YbcProgramIR } from './ybc-ir';

// N17 B2: the three sensor blocks of the Advanced board end to end, from the JSON Blockly saves to what the program reads. The
// temperature is whole degrees Celsius, an acceleration whole mg on one axis (x, y or z), a gesture a Boolean. The axis and the
// gesture are fields of the block, so they are operands the compiler checks, never values.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const advanced = packs.typesOf(productionProfiles.get('ybc-advanced')?.blockPacks ?? []);
const basic = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const board = registry.get('ybc-board');
const target = boardTargetOf(board, capabilitiesOf(board));
const compile = (statements: Json[], exposed = advanced, onBoard = target): YbcCompileResult =>
  compileYbcProgram(program(statements, undefined, ['x']), exposed, undefined, onBoard);
const codes = (result: YbcCompileResult) => result.diagnostics.map((diagnostic) => diagnostic.code);

function compiled(statements: Json[]): YbcProgramIR {
  const result = compile(statements);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.ir;
}

/** The value the first statement (a print) prints, as IR. */
const printedExpr = (block: Json): Expr => {
  const [statement] = compiled([print(block)]).onStart;
  if (statement?.kind !== 'print') {
    throw new Error('not a print');
  }
  return statement.value;
};

async function run(ir: YbcProgramIR, capabilities: Capabilities): Promise<{ outcome: YbcRunOutcome; lines: string[] }> {
  const lines: string[] = [];
  const sleep = () => Promise.resolve();
  const outcome = await runYbc(ir, { sleep, console: { write: (line) => void lines.push(line) }, now: () => 0, yieldNow: () => Promise.resolve() }, capabilities).done;
  return { outcome, lines };
}

/** Sensors that answer what they are told. */
const sensors = (degrees: number, axes: Record<'x' | 'y' | 'z', number>, gesture: string | null): Capabilities => ({
  temperature: { temperature: () => degrees },
  motion: { acceleration: (axis) => axes[axis], gesture: () => gesture },
});

describe('the sensor blocks', () => {
  it('are the three of the brief, named as it names them', () => {
    expect([temperatureType, accelerationType, gestureIsType]).toEqual(['ybc_temperature', 'ybc_accel', 'ybc_gesture_is']);
    expect([...axisNames]).toEqual(['x', 'y', 'z']);
    expect([...gestureNames]).toEqual(['shake', 'tilt_left', 'tilt_right', 'face_up', 'face_down', 'logo_up', 'logo_down']);
  });
});

describe('compiling them (C-16, C-17, C-18)', () => {
  it('turns "temperature" into an int read with no operand', () => {
    const block = temperature();
    expect(printedExpr(block)).toEqual({ blockId: block.id, type: 'int', kind: 'read', op: 'temperature.read' });
  });

  it.each(['x', 'y', 'z'])('turns "acceleration %s" into an int read of that axis', (axis) => {
    const block = acceleration(axis);
    expect(printedExpr(block)).toEqual({ blockId: block.id, type: 'int', kind: 'read', op: 'motion.acceleration', operand: { kind: 'axis', axis } });
  });

  it.each(gestureNames.map((name) => [name]))('turns "gesture is %s" into a Boolean read of that gesture', (gesture) => {
    const block = gestureIs(gesture);
    expect(printedExpr(block)).toEqual({ blockId: block.id, type: 'bool', kind: 'read', op: 'motion.isGesture', operand: { kind: 'gesture', gesture } });
  });

  it('lets a gesture be a condition and a reading be a number to compare or scroll', () => {
    expect(compile([ifThen(gestureIs('shake'), [scrollNumber(temperature())])]).ok).toBe(true);
    expect(compile([ifThen(cmp('LT', acceleration('x'), num(-400)), [scrollNumber(acceleration('z'))])]).ok).toBe(true);
  });

  it('refuses a reading where the other type goes: an acceleration is no condition, a gesture no number, a temperature no text', () => {
    expect(codes(compile([ifThen(acceleration('x'), [])]))).toEqual(['invalid-condition']);
    expect(codes(compile([scrollNumber(gestureIs('shake'))]))).toEqual(['type-mismatch']);
    expect(codes(compile([scrollText(temperature())]))).toEqual(['type-mismatch']);
  });

  it.each([['w'], ['X'], [''], ['x ']])('refuses the axis %j: an axis is x, y or z', (axis) => {
    const block = acceleration(axis);
    const result = compile([print(block)]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'value-out-of-range', blockId: block.id })]);
  });

  it.each([['jump'], ['shake '], ['SHAKE'], ['tilt left'], ['freefall'], ['']])('refuses the gesture %j: only the seven of the dropdown', (gesture) => {
    const block = gestureIs(gesture);
    const result = compile([print(block)]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'value-out-of-range', blockId: block.id })]);
  });

  it('refuses a block without its axis or its gesture, or with one that is not a text', () => {
    for (const block of [
      { ...acceleration('x'), fields: {} },
      { ...acceleration('x'), fields: { AXIS: 1 } },
      { ...gestureIs('shake'), fields: {} },
      { ...gestureIs('shake'), fields: { GESTURE: ['shake'] } },
    ]) {
      expect(codes(compile([print(block)])), JSON.stringify(block.fields)).toEqual(['malformed-program']);
    }
  });

  it('refuses each as a statement: it gives a value', () => {
    for (const block of [temperature(), acceleration('x'), gestureIs('shake')]) {
      expect(codes(compile([block])), String(block.type)).toEqual(['unsupported-construct']);
    }
  });

  it('refuses each on a board without the part: capability-unavailable', () => {
    const without = (capability: string) => ({ ...target, capabilities: target.capabilities.filter((name) => name !== capability) });
    expect(codes(compile([print(temperature())], advanced, without('temperature')))).toEqual(['capability-unavailable']);
    expect(codes(compile([print(acceleration('x'))], advanced, without('motion')))).toEqual(['capability-unavailable']);
    expect(codes(compile([print(gestureIs('shake'))], advanced, without('motion')))).toEqual(['capability-unavailable']);
  });

  it('is not in the Basic profile: the compiler of a Basic project does not know them', () => {
    for (const block of [temperature(), acceleration('x'), gestureIs('shake')]) {
      expect(codes(compile([print(block)], basic)), String(block.type)).toEqual(['unknown-block']);
    }
  });
});

describe('running them', () => {
  it('reads the temperature, each axis and whether the gesture is the one the board makes now', async () => {
    const ir = compiled([
      print(temperature()),
      print(acceleration('x')),
      print(acceleration('y')),
      print(acceleration('z')),
      print(gestureIs('tilt_left')),
      print(gestureIs('shake')),
    ]);
    const { outcome, lines } = await run(ir, sensors(-7, { x: -700, y: 300, z: -685 }, 'tilt_left'));
    expect(outcome).toEqual({ status: 'finished' });
    expect(lines).toEqual(['-7', '-700', '300', '-685', 'True', 'False']);
  });

  it('reads each sensor again at every read, so a new value is seen at once', async () => {
    let degrees = 20;
    let gesture: string | null = 'face_up';
    const capabilities: Capabilities = {
      temperature: { temperature: () => degrees++ },
      motion: { acceleration: () => 0, gesture: () => gesture },
    };
    const ir = compiled([print(temperature()), print(temperature()), print(gestureIs('shake'))]);
    const first = run(ir, capabilities);
    gesture = 'shake';
    expect((await first).lines).toEqual(['20', '21', 'True']);
  });

  it('says no gesture is made when the board makes none', async () => {
    const { lines } = await run(compiled([print(gestureIs('face_up'))]), sensors(25, { x: 0, y: 0, z: 0 }, null));
    expect(lines).toEqual(['False']);
  });

  it.each([
    ['a temperature that is not a whole number', sensors(20.5, { x: 0, y: 0, z: 0 }, null), temperature()],
    ['a temperature above 50', sensors(51, { x: 0, y: 0, z: 0 }, null), temperature()],
    ['a temperature below −10', sensors(-11, { x: 0, y: 0, z: 0 }, null), temperature()],
    ['an acceleration beyond 2048 mg', sensors(25, { x: 2049, y: 0, z: 0 }, null), acceleration('x')],
    ['an acceleration that is not a whole number', sensors(25, { x: 0, y: 0.5, z: 0 }, null), acceleration('y')],
  ])('stops with an internal error, never a crash, on %s from a broken sensor', async (_label, capabilities, block) => {
    const { outcome } = await run(compiled([print(block)]), capabilities);
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error' });
  });

  it('stops with an internal error on a board that cannot say its gesture, or on forged IR', async () => {
    const noGesture: Capabilities = { motion: { acceleration: () => 0 } };
    expect((await run(compiled([print(gestureIs('shake'))]), noGesture)).outcome).toMatchObject({ status: 'error', code: 'internal-error' });

    const forged = (operand: unknown, op: string): YbcProgramIR => ({
      onStart: [{ kind: 'print', blockId: 'p', value: { blockId: 'r', type: op === 'motion.isGesture' ? 'bool' : 'int', kind: 'read', op, operand } as Expr }],
      forever: null,
      variables: [],
    });
    const anything = sensors(25, { x: 0, y: 0, z: 0 }, 'shake');
    expect((await run(forged({ kind: 'axis', axis: 'w' }, 'motion.acceleration'), anything)).outcome).toMatchObject({ status: 'error', code: 'internal-error' });
    expect((await run(forged({ kind: 'gesture', gesture: 'jump' }, 'motion.isGesture'), anything)).outcome).toMatchObject({ status: 'error', code: 'internal-error' });
  });

  it('stops with an internal error, never a crash, on a board without the sensor', async () => {
    expect((await run(compiled([print(temperature())]), {})).outcome).toMatchObject({ status: 'error', code: 'internal-error' });
    expect((await run(compiled([print(acceleration('x'))]), {})).outcome).toMatchObject({ status: 'error', code: 'internal-error' });
  });
});
