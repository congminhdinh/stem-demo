import { describe, expect, it } from 'vitest';
import { generatorAllowlist } from '../../compat/contract-validation';
import { yolobitContract } from '../../compat/yolobit-contract';
import type { Expr, YbcProgramIR } from '../../program/ybc-ir';
import { getVar, num, program, sub, type Json } from '../../program/__fixtures__/ybc-blocks';
import { pinWriteAnalog, servoWrite } from '../../program/__fixtures__/ybc-pin-blocks';
import { compileBlocks } from './__fixtures__/compile-case';
import { generatedConstructs, generateYbcMicroPython } from './generate';

// N17 B5: the Python of "analog write" (C-26) and "servo" (C-27). The calls are the editor's (`pin0.write_analog(512)`,
// `pin1.servo_write(90)`, V·G); what the board does with a value outside the range is not shown, so the generator never sends it
// one: a typed-in value is written clamped, a computed one as `max(0, min(top, v))` (evaluated once), which is what the simulator
// does with it.

const generate = (statements: Json[]) => {
  const generated = generateYbcMicroPython(compileBlocks(program(statements, undefined, ['x'])));
  if (!generated.ok) {
    throw new Error(JSON.stringify(generated.diagnostics));
  }
  return generated.source;
};
const body = (statements: Json[]) =>
  generate(statements)
    .split('\n')
    .filter((line) => line.startsWith('pin'));

describe('the Python of analog write and the servo', () => {
  it('writes the brief\'s lines: pin0.write_analog(512) and pin1.servo_write(90)', () => {
    expect(body([pinWriteAnalog('P0', num(512)), servoWrite('P1', num(90))])).toEqual(['pin0.write_analog(512)', 'pin1.servo_write(90)']);
  });

  it('writes a typed-in value outside the range clamped, as the simulator runs it', () => {
    expect(body([pinWriteAnalog('P2', num(2000)), pinWriteAnalog('P2', num(-5)), servoWrite('P0', num(200)), servoWrite('P0', num(-1))])).toEqual([
      'pin2.write_analog(1023)',
      'pin2.write_analog(0)',
      'pin0.servo_write(180)',
      'pin0.servo_write(0)',
    ]);
    expect(body([pinWriteAnalog('P0', num(0)), pinWriteAnalog('P0', num(1023)), servoWrite('P1', num(0)), servoWrite('P1', num(180))])).toEqual([
      'pin0.write_analog(0)',
      'pin0.write_analog(1023)',
      'pin1.servo_write(0)',
      'pin1.servo_write(180)',
    ]);
  });

  it('writes a computed value inside max(0, min(top, …)), so the board never meets one outside the range', () => {
    expect(body([pinWriteAnalog('P1', getVar('x')), servoWrite('P2', sub(getVar('x'), num(10)))])).toEqual([
      'pin1.write_analog(max(0, min(1023, x)))',
      'pin2.servo_write(max(0, min(180, x - 10)))',
    ]);
  });

  it('needs the yolobit module only: no music, no random', () => {
    const source = generate([pinWriteAnalog('P0', num(512))]);
    expect(source).toContain('from yolobit import *');
    expect(source).not.toMatch(/import music|import random/);
  });

  it('generates C-26 and C-27, and every form it writes is in the contract\'s allowlist', () => {
    expect(generatedConstructs).toEqual(expect.arrayContaining(['C-26', 'C-27']));
    const allowlist = generatorAllowlist(yolobitContract);
    expect(allowlist.forms).toEqual(expect.arrayContaining(['pin<N>.write_analog(<value>)', 'pin<N>.servo_write(<angle>)']));
    expect(allowlist.builtins).toEqual(expect.arrayContaining(['min', 'max']));
  });
});

describe('what it refuses (K4)', () => {
  const lit = (value: number, blockId = 'l'): Expr => ({ type: 'int', kind: 'int', value, blockId });
  const ir = (statement: YbcProgramIR['onStart'][number]): YbcProgramIR => ({ onStart: [statement], forever: null, variables: [{ id: 'x', name: 'x', type: 'int' }] });
  const codes = (program: YbcProgramIR) => {
    const result = generateYbcMicroPython(program);
    return result.ok ? 'ok' : result.diagnostics.map((d) => `${d.code}@${d.blockId}`);
  };
  const variable: Expr = { type: 'int', kind: 'variable', variable: 'x', blockId: 'v' };

  it('a pin outside P0–P2, a pin only known when the program runs, the wrong number of values', () => {
    for (const op of ['pwm.write', 'servo.write'] as const) {
      expect(codes(ir({ kind: 'call', op, args: [lit(3), lit(1)], blockId: 'w' }))).toEqual(['value-out-of-range@w']);
      expect(codes(ir({ kind: 'call', op, args: [variable, lit(1)], blockId: 'w' }))).toEqual(['unsupported-node@w']);
      expect(codes(ir({ kind: 'call', op, args: [lit(0)], blockId: 'w' }))).toEqual(['unsupported-node@w']);
    }
  });

  it('a value that is not a whole number, or a literal outside the safe range', () => {
    const textValue: Expr = { type: 'str', kind: 'str', value: 'a', blockId: 't' };
    expect(codes(ir({ kind: 'call', op: 'pwm.write', args: [lit(0), textValue], blockId: 'w' }))).toEqual(['type-mismatch@t']);
    expect(codes(ir({ kind: 'call', op: 'servo.write', args: [lit(0), lit(1.5, 'f')], blockId: 'w' }))).toEqual(['invalid-literal@f']);
  });
});
