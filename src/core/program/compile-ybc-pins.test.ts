import { describe, expect, it } from 'vitest';
import { boardTargetOf, noBoardTarget, type BoardTarget } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { add, cmp, ifThen, num, print, program, setVar, text, wait, whileLoop, type Json } from './__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from './__fixtures__/ybc-pin-blocks';

// The compiler for the header pins (YB-4, contract C-23, C-24, C-25): Blockly JSON to IR, with the static types
// the dialect is defined by, the pin and level domain, and the board it compiles for (plan §10: a block that
// needs what the board lacks is refused at compile time). It never throws.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const ybcBoard = registry.get('ybc-board');
const target = boardTargetOf(ybcBoard, capabilitiesOf(ybcBoard));

const compile = (blocks: unknown, forBoard: BoardTarget = target) => compileYbcProgram(blocks, exposed, undefined, forBoard);
const compileStatements = (...statements: Json[]) => compile(program(statements));
const failures = (result: ReturnType<typeof compile>) => (result.ok ? [] : result.diagnostics.map((d) => `${d.code}@${d.blockId ?? '-'}`));
const lit = (value: number, blockId: string) => ({ blockId, type: 'int', kind: 'int', value });

describe('what the pin blocks compile to', () => {
  it('"set pin P1 to ON" is a digital.write call with the pin and the level as literals', () => {
    const block = pinWrite('P1', true);
    const result = compileStatements(block);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.ir.onStart).toEqual([
      { kind: 'call', op: 'digital.write', args: [lit(1, block.id as string), lit(1, block.id as string)], blockId: block.id },
    ]);
  });

  it('"OFF" is the level 0, and every pin of the contract compiles', () => {
    for (const [name, pin] of [['P0', 0], ['P1', 1], ['P2', 2]] as const) {
      const block = pinWrite(name, false);
      const result = compileStatements(block);
      expect(result.ok && result.ir.onStart[0], name).toMatchObject({ kind: 'call', op: 'digital.write', args: [{ value: pin }, { value: 0 }] });
    }
  });

  it('"digital read" is a bool read and "analog read" an int read, each with the pin as its one argument', () => {
    const digital = pinRead('P2');
    const analog = pinAnalog('P0');
    const result = compileStatements(print(digital), print(analog));
    expect(result.ok && result.ir.onStart).toEqual([
      { kind: 'print', blockId: expect.any(String), value: { blockId: digital.id, type: 'bool', kind: 'read', op: 'digital.read', args: [lit(2, digital.id as string)] } },
      { kind: 'print', blockId: expect.any(String), value: { blockId: analog.id, type: 'int', kind: 'read', op: 'analogIn.read', args: [lit(0, analog.id as string)] } },
    ]);
  });

  it('joins the language: a read in a condition, a comparison, a variable, a join, a loop, inside forever too', () => {
    const blocks = program(
      [setVar('x', add(pinAnalog('P1'), num(1))), whileLoop(pinRead('P0'), [pinWrite('P2', true), wait(num(10))])],
      [ifThen(cmp('GT', pinAnalog('P1'), num(2048)), [pinWrite('P0', true)], [pinWrite('P0', false)])],
    );
    const result = compile(blocks);
    expect(result.ok).toBe(true);
    expect(result.ok && result.ir.forever).toHaveLength(1);
  });
});

describe('static types (no coercion, no truthiness)', () => {
  it('refuses a digital read where a number is wanted, and an analog read where a condition is wanted', () => {
    expect(failures(compileStatements(setVar('x', pinRead('P0'))))).toEqual([expect.stringMatching(/^type-mismatch@/)]);
    expect(failures(compileStatements(ifThen(pinAnalog('P0'), [print(text('x'))])))).toEqual([expect.stringMatching(/^invalid-condition@/)]);
    expect(failures(compileStatements(whileLoop(pinAnalog('P1'), [])))).toEqual([expect.stringMatching(/^invalid-condition@/)]);
  });

  it('refuses to compare a bool read with a number, or to add a bool read', () => {
    expect(failures(compileStatements(print(cmp('EQ', pinRead('P0'), num(1)))))).toEqual([expect.stringMatching(/^type-mismatch@/)]);
    expect(failures(compileStatements(print(add(pinRead('P0'), num(1)))))).toEqual([expect.stringMatching(/^type-mismatch@/)]);
  });

  it('refuses a statement block used as a value and a value block used as a statement', () => {
    const write = pinWrite('P0', true);
    expect(failures(compileStatements(print(write)))).toEqual([`unsupported-construct@${write.id}`]);
    const read = pinRead('P0');
    expect(failures(compileStatements(read))).toEqual([`unsupported-construct@${read.id}`]);
  });
});

describe('the domain: the pin and the level (R5: a stored program is checked like a new one)', () => {
  it.each(['P3', 'P4', 'P10', 'P19', 'P20'])('refuses %s: the contract opens P0, P1 and P2 only', (pin) => {
    for (const block of [pinWrite(pin, true), pinRead(pin), pinAnalog(pin)]) {
      expect(failures(compileStatements(print(block.type === 'ybc_pin_write' ? num(0) : block), ...(block.type === 'ybc_pin_write' ? [block] : []))), `${pin}/${String(block.type)}`).toEqual([
        `value-out-of-range@${block.id}`,
      ]);
    }
  });

  it.each(['p1', 'P', 'P01', 'P-1', 'PIN1', '1', ''])('refuses %j: not a pin name', (pin) => {
    const block = pinWrite(pin, true);
    expect(failures(compileStatements(block))).toEqual([`value-out-of-range@${block.id}`]);
  });

  it('refuses a pin that is missing or is not text, and a level that is missing or not text', () => {
    const noPin = { type: 'ybc_pin_write', id: 'w1', fields: { LEVEL: '1' } };
    expect(failures(compileStatements(noPin))).toEqual(['malformed-program@w1']);
    const numberPin = { type: 'ybc_pin_read', id: 'r1', fields: { PIN: 1 } };
    expect(failures(compileStatements(print(numberPin)))).toEqual(['malformed-program@r1']);
    const noLevel = { type: 'ybc_pin_write', id: 'w2', fields: { PIN: 'P0' } };
    expect(failures(compileStatements(noLevel))).toEqual(['malformed-program@w2']);
    const numberLevel = { type: 'ybc_pin_write', id: 'w3', fields: { PIN: 'P0', LEVEL: 1 } };
    expect(failures(compileStatements(numberLevel))).toEqual(['malformed-program@w3']);
    const noFields = { type: 'ybc_pin_analog', id: 'a1' };
    expect(failures(compileStatements(print(noFields)))).toEqual(['malformed-program@a1']);
  });

  it.each(['2', '-1', '01', '1.0', 'ON', 'on', ' 1', '', '10'])('refuses the level %j: a pin is ON (1) or OFF (0)', (level) => {
    const block = { type: 'ybc_pin_write', id: 'w', fields: { PIN: 'P0', LEVEL: level } };
    expect(failures(compileStatements(block))).toEqual(['value-out-of-range@w']);
  });

  it('reports both problems of one block, and compiles nothing', () => {
    const block = { type: 'ybc_pin_write', id: 'w', fields: { PIN: 'P9', LEVEL: '7' } };
    expect(failures(compileStatements(block))).toEqual(['value-out-of-range@w', 'value-out-of-range@w']);
  });
});

describe('the board the program is for (plan §10)', () => {
  const withoutAnalog: BoardTarget = { ...target, capabilities: target.capabilities.filter((id) => id !== 'analogIn') };
  const withoutDigital: BoardTarget = { ...target, capabilities: target.capabilities.filter((id) => id !== 'digital') };

  it('refuses a digital block when the board has no digital capability, and an analog one when it has no analogIn', () => {
    const write = pinWrite('P0', true);
    const analog = pinAnalog('P1');
    expect(failures(compile(program([write]), withoutDigital))).toEqual([`capability-unavailable@${write.id}`]);
    expect(failures(compile(program([print(pinRead('P0'))]), withoutDigital))).toEqual([expect.stringMatching(/^capability-unavailable@/)]);
    expect(failures(compile(program([print(analog)]), withoutAnalog))).toEqual([`capability-unavailable@${analog.id}`]);
    // Each capability is its own: digital blocks still compile where only analog input is missing.
    expect(compile(program([pinWrite('P0', true), print(pinRead('P1'))]), withoutAnalog).ok).toBe(true);
  });

  it('compiles nothing for a program with no board to compile for: every pin block is capability-unavailable', () => {
    const write = pinWrite('P0', true);
    expect(failures(compile(program([write]), noBoardTarget))).toEqual([`capability-unavailable@${write.id}`]);
    expect(failures(compileYbcProgram(program([write]), exposed))).toEqual([`capability-unavailable@${write.id}`]);
    // The language alone needs no capability.
    expect(compileYbcProgram(program([print(num(1))]), exposed).ok).toBe(true);
  });

  it('refuses a pin the board reserves or does not offer for that capability (reserved pins are unusable)', () => {
    const reservedP2: BoardTarget = { ...target, pins: { ...target.pins, digital: ['P0', 'P1'], analogIn: ['P0', 'P1'] } };
    const write = pinWrite('P2', true);
    const read = pinRead('P2');
    const analog = pinAnalog('P2');
    expect(failures(compile(program([write, print(read), print(analog)]), reservedP2))).toEqual([
      `value-out-of-range@${write.id}`,
      `value-out-of-range@${read.id}`,
      `value-out-of-range@${analog.id}`,
    ]);
    expect(compile(program([pinWrite('P1', true)]), reservedP2).ok).toBe(true);
    // A pin that has digital but not analogIn is refused by the analog block only.
    const digitalOnly: BoardTarget = { ...target, pins: { ...target.pins, analogIn: ['P0', 'P2'] } };
    expect(failures(compile(program([print(pinAnalog('P1'))]), digitalOnly))).toEqual([expect.stringMatching(/^value-out-of-range@/)]);
    expect(compile(program([pinWrite('P1', true), print(pinRead('P1'))]), digitalOnly).ok).toBe(true);
  });

  it('says why in words a learner can read, without the block type or any raw text', () => {
    const result = compile(program([pinWrite('P0', true)]), noBoardTarget);
    const messages = result.ok ? [] : result.diagnostics.map((d) => d.message);
    expect(messages).toEqual(['This board has no digital pin, so this block cannot be used.']);
    expect(messages.join()).not.toMatch(/ybc_|Error|undefined|\[object/);
  });
});

describe('a pin block is only compiled where the profile shows it', () => {
  it('is unknown to a profile whose packs do not list ybc.pins (the exposure comes from the pack, not from the compiler)', () => {
    const withoutPins = packs.typesOf(['ybc.structure', 'lang.text']);
    const block = pinWrite('P0', true);
    const result = compileYbcProgram(program([block]), withoutPins, undefined, target);
    expect(failures(result)).toEqual([`unknown-block@${block.id}`]);
  });

  it('compiles for both profiles alike', () => {
    for (const id of ['ybc-basic', 'ybc-advanced']) {
      const types = packs.typesOf(productionProfiles.get(id)?.blockPacks ?? []);
      expect(compileYbcProgram(program([pinWrite('P0', true), print(pinAnalog('P1'))]), types, undefined, target).ok, id).toBe(true);
    }
  });
});

describe('a stored program that is not what the editor saves', () => {
  it('skips a disabled pin block, like any disabled statement, and refuses one plugged into a disabled input', () => {
    const disabled = { ...pinWrite('P0', true), disabledReasons: ['manual'] };
    const result = compile(program([disabled, print(text('after'))]));
    expect(result.ok && result.ir.onStart).toHaveLength(1);
    const disabledRead = { ...pinRead('P0'), disabledReasons: ['manual'] };
    expect(failures(compileStatements(ifThen(disabledRead, [])))).toEqual([expect.stringMatching(/^missing-input@/)]);
  });

  it('does not throw, whatever the fields hold', () => {
    const junk: unknown[] = [null, 0, 'P0', [], {}, { PIN: {} }, { PIN: ['P0'] }, { PIN: 'P0', LEVEL: {} }, { PIN: 'P0', LEVEL: ['1'] }, { PIN: null, LEVEL: null }];
    for (const fields of junk) {
      for (const type of ['ybc_pin_write', 'ybc_pin_read', 'ybc_pin_analog']) {
        const block = { type, id: 'j', ...(fields === undefined ? {} : { fields }) };
        const statement = type === 'ybc_pin_write' ? [block] : [print(block)];
        expect(() => compileStatements(...statement), `${type}/${JSON.stringify(fields)}`).not.toThrow();
      }
    }
  });
});
