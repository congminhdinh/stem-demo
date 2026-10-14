import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import {
  add, and, arith, bool, foreignArith, cmp, getVar, idiv, ifThen, mod, mul, not, num, or, print, program, setVar, sub, text,
  type Json,
} from './__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from './block-packs';
import { createDefaultProgram } from './blocks';
import { compileYbcProgram } from './compile-ybc-program';
import { MAX_PROGRAM_BLOCKS, MAX_SAFE_INT, MAX_TEXT_CHARS } from './limits';

// The typed YB-2a language: static types, variables, literals and the integer domain.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const language = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const compile = (blocks: unknown) => compileYbcProgram(blocks, language);
const codes = (blocks: unknown) => compile(blocks).diagnostics.map((d) => d.code);
const main = (...statements: Json[]) => program(statements);

describe('compileYbcProgram: the typed IR', () => {
  it('compiles x = 1; x = x + 2; print(x) with the static type of every expression', () => {
    const result = compile(main(setVar('x', num(1)), setVar('x', add(getVar('x'), num(2))), print(getVar('x'))));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.ir.variables).toEqual([
      { id: 'x', name: 'x', type: 'int' },
      { id: 'y', name: 'y', type: 'int' },
      { id: 'z', name: 'z', type: 'int' },
    ]);
    expect(result.ir.onStart).toMatchObject([
      { kind: 'set', variable: 'x', value: { kind: 'int', type: 'int', value: 1 } },
      {
        kind: 'set',
        variable: 'x',
        value: { kind: 'arith', op: '+', type: 'int', left: { kind: 'variable', type: 'int' }, right: { kind: 'int', value: 2 } },
      },
      { kind: 'print', value: { kind: 'variable', variable: 'x', type: 'int' } },
    ]);
  });

  it('types comparisons and logic as bool, and texts as str', () => {
    const result = compile(main(print(and(cmp('LT', num(1), num(2)), not(bool(false)))), print(text('hi'))));
    expect(result).toMatchObject({
      ok: true,
      ir: {
        onStart: [
          {
            kind: 'print',
            value: { kind: 'logic', op: 'and', type: 'bool', left: { kind: 'compare', op: '<', type: 'bool' }, right: { kind: 'not', type: 'bool' } },
          },
          { kind: 'print', value: { kind: 'str', type: 'str', value: 'hi' } },
        ],
      },
    });
  });

  it.each([
    ['EQ', '=='],
    ['NEQ', '!='],
    ['LT', '<'],
    ['LTE', '<='],
    ['GT', '>'],
    ['GTE', '>='],
  ] as const)('maps the comparison %s to %s', (name, op) => {
    expect(compile(main(print(cmp(name, num(1), num(2)))))).toMatchObject({ ir: { onStart: [{ value: { op } }] } });
  });

  it('maps +, −, ×, // and % to their operators', () => {
    const expressions = [add(num(1), num(2)), sub(num(1), num(2)), mul(num(1), num(2)), idiv(num(1), num(2)), mod(num(1), num(2))];
    const result = compile(main(...expressions.map((expression) => print(expression))));
    expect(result.ok && result.ir.onStart.map((s) => (s.kind === 'print' && s.value.kind === 'arith' ? s.value.op : null))).toEqual([
      '+', '-', '*', '//', '%',
    ]);
  });

  it('compiles if and if / else, and keeps statement order', () => {
    const result = compile(main(print(num(1)), ifThen(bool(true), [print(num(2))], [print(num(3))]), print(num(4))));
    expect(result).toMatchObject({
      ok: true,
      ir: {
        onStart: [
          { kind: 'print' },
          { kind: 'if', branches: [{ body: [{ kind: 'print' }] }], else: [{ kind: 'print' }] },
          { kind: 'print' },
        ],
      },
    });
  });

  it('is plain, serialisable data: no Blockly object, no hidden state', () => {
    const result = compile(main(setVar('x', num(1)), print(getVar('x'))));
    expect(result.ok && JSON.parse(JSON.stringify(result.ir))).toEqual(result.ok && result.ir);
  });

  it('compiles the default program of a new project', () => {
    expect(compile(createDefaultProgram())).toMatchObject({ ok: true, ir: { onStart: [], forever: [], variables: [] } });
  });
});

describe('compileYbcProgram: static typing', () => {
  it('rejects a condition that is not a bool: if 1 is not true (no truthiness)', () => {
    for (const condition of [num(1), text('yes'), getVar('x'), add(num(1), num(1))]) {
      const result = compile(main(ifThen(condition, [print(num(1))])));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-condition' }));
    }
  });

  it('rejects arithmetic on a bool or a text', () => {
    expect(codes(main(print(add(bool(true), num(1)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(mul(num(2), text('a')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(idiv(text('a'), num(1)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(mod(num(1), bool(false)))))).toEqual(['type-mismatch']);
  });

  it('rejects ordering of non-numbers and equality across types: int < str, 1 == "1", true == 1', () => {
    expect(codes(main(print(cmp('LT', num(1), text('2')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('EQ', num(1), text('1')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('EQ', bool(true), num(1)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('GT', bool(true), bool(false)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('LT', text('a'), text('b')))))).toEqual(['type-mismatch']);
  });

  it('allows equality between two values of one type', () => {
    const equal = main(print(cmp('EQ', text('a'), text('a'))), print(cmp('NEQ', bool(true), bool(false))), print(cmp('EQ', num(1), num(1))));
    expect(compile(equal).ok).toBe(true);
  });

  it('rejects and / or / not on anything but bools', () => {
    expect(codes(main(print(and(num(1), bool(true)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(or(bool(true), text('x')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(not(num(0)))))).toEqual(['type-mismatch']);
  });

  it('rejects assigning a text or a bool to a variable (Basic variables are ints)', () => {
    expect(codes(main(setVar('x', text('hi'))))).toEqual(['type-mismatch']);
    expect(codes(main(setVar('x', bool(true))))).toEqual(['type-mismatch']);
    expect(codes(main(setVar('x', cmp('EQ', num(1), num(1)))))).toEqual(['type-mismatch']);
  });

  it('prints an int, a bool or a text', () => {
    expect(compile(main(print(num(1)), print(bool(true)), print(text('t')))).ok).toBe(true);
  });

  it('does not coerce: an int plus a text is an error', () => {
    expect(codes(main(print(add(text('n='), num(1)))))).toEqual(['type-mismatch']);
  });

  it('reports every mistake, each at the block that is wrong', () => {
    const wrongNot = num(2);
    const wrongAdd = bool(true);
    const result = compile(main(print(not(wrongNot)), print(add(wrongAdd, num(1)))));
    expect(result.diagnostics.map((d) => d.blockId)).toEqual([wrongNot.id, wrongAdd.id]);
  });
});

describe('compileYbcProgram: variables', () => {
  it('reports a variable that does not exist, in a get and in a set', () => {
    expect(codes(main(print(getVar('nope'))))).toEqual(['undefined-variable']);
    expect(codes(main(setVar('nope', num(1))))).toEqual(['undefined-variable']);
  });

  it('needs the variable a get block names', () => {
    expect(codes(main(print({ type: 'variables_get', id: 'g' })))).toEqual(['malformed-program']);
  });

  it('declares every variable of the workspace, also an unused one', () => {
    const result = compile(program([], undefined, ['a b', 'count']));
    expect(result.ok && result.ir.variables.map((v) => v.name)).toEqual(['a b', 'count']);
  });
});

describe('compileYbcProgram: literals and the integer domain', () => {
  it('accepts the whole safe-integer range', () => {
    expect(compile(main(print(num(MAX_SAFE_INT)), print(num(-MAX_SAFE_INT)), print(num(0)))).ok).toBe(true);
  });

  it('rejects a literal outside it', () => {
    expect(codes(main(print(num(MAX_SAFE_INT + 1))))).toEqual(['value-out-of-range']);
    expect(codes(main(print(num(-MAX_SAFE_INT - 1))))).toEqual(['value-out-of-range']);
    expect(codes(main(print(num(1e300))))).toEqual(['value-out-of-range']);
  });

  it('rejects a float literal: 1.5, NaN, Infinity', () => {
    for (const value of [1.5, -0.25, NaN, Infinity]) {
      expect(codes(main(print(num(value)))), String(value)).toEqual(['float-not-supported']);
    }
  });

  it('refuses the foreign Blockly arithmetic block, never reading it as ybc_arith: DIVIDE and POWER are float-not-supported, ADD is unsupported', () => {
    expect(codes(main(print(foreignArith('DIVIDE', num(1), num(2)))))).toEqual(['float-not-supported']);
    expect(codes(main(print(foreignArith('POWER', num(1), num(2)))))).toEqual(['float-not-supported']);
    expect(codes(main(print(foreignArith('ADD', num(1), num(2)))))).toEqual(['unsupported-construct']);
  });

  it('refuses a ybc_arith whose operation is not + − ×, with no silent change to ADD', () => {
    for (const op of ['DIVIDE', 'POWER', 'add', '']) {
      const block = { ...arith('ADD', num(1), num(2)), fields: { OP: op } };
      expect(codes(main(print(block))), op).toEqual(['malformed-program']);
    }
  });

  it('limits a text literal to 1000 characters and refuses control characters', () => {
    expect(compile(main(print(text('a'.repeat(MAX_TEXT_CHARS))))).ok).toBe(true);
    expect(codes(main(print(text('a'.repeat(MAX_TEXT_CHARS + 1)))))).toEqual(['limit-exceeded']);
    expect(codes(main(print(text(`a${String.fromCharCode(0)}b`))))).toEqual(['value-out-of-range']);
    expect(compile(main(print(text('héllo ✓')))).ok).toBe(true);
  });

  it('limits a program to 2000 blocks', () => {
    const many = (count: number) => main(...Array.from({ length: count }, () => print(num(1))));
    // each print is 2 blocks, plus the hat
    expect(compile(many((MAX_PROGRAM_BLOCKS - 2) / 2)).ok).toBe(true);
    expect(codes(many(MAX_PROGRAM_BLOCKS))).toEqual(['program-too-large']);
  });
});

describe('compileYbcProgram: what the dialect does not have', () => {
  it('refuses random, which is excluded (C-40): not-eligible', () => {
    const random = { type: 'math_random_int', id: 'r', inputs: {} };
    expect(compile(main(print(random))).diagnostics).toContainEqual(expect.objectContaining({ code: 'not-eligible', blockId: 'r' }));
  });

  it.each(['controls_whileUntil', 'controls_for', 'controls_forEach', 'controls_flow_statements', 'stem_wait', 'math_change', 'stem_digital_write'])(
    'refuses the block %s',
    (type) => {
      expect(codes(main({ type, id: 'b' }))).toEqual(['unknown-block']);
    },
  );

  it('refuses a value block used as a statement', () => {
    expect(codes(main(num(1)))).toEqual(['unsupported-construct']);
  });

  it('reports a missing input at its owner', () => {
    expect(compile(main({ type: 'text_print', id: 'p' })).diagnostics).toEqual([expect.objectContaining({ code: 'missing-input', blockId: 'p' })]);
    expect(compile(main({ type: 'math_arithmetic', id: 'm', fields: { OP: 'ADD' } })).ok).toBe(false);
  });

  it('follows only the profile: a block type it does not expose is unknown', () => {
    const structureOnly = new Set(['stem_on_start', 'stem_forever']);
    expect(compileYbcProgram(main(print(num(1))), structureOnly).diagnostics.map((d) => d.code)).toEqual(['unknown-block']);
  });

  it('does not follow expressions nested without end', () => {
    let nested: Json = num(1);
    for (let i = 0; i < 150; i++) {
      nested = add(nested, num(1));
    }
    expect(compile(main(print(nested))).diagnostics.some((d) => d.code === 'malformed-program')).toBe(true);
  });
});
