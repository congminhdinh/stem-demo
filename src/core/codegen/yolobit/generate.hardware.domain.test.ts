import { describe, expect, it } from 'vitest';
import type { Expr, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { compileBlocks } from './__fixtures__/compile-case';
import { hardwareCases } from './__fixtures__/hardware-cases';
import { generateYbcMicroPython, type GenerateResult } from './generate';

// The generator against the domain of the hardware rows (plan §13, contract C-06…C-09, C-12, C-13, C-15, C-50, C-51; plan §6.3
// "Domain guard"): hand-built IR that the compiler would never produce is a diagnostic, never an exception and never a half
// program. A value that is only known at run time (a dynamic text) is the simulator's to refuse, so the generator writes it as it is.

let counter = 0;
const id = () => `h${++counter}`;
const int = (value: number): Expr => ({ type: 'int', kind: 'int', value, blockId: id() });
const bool = (value: boolean): Expr => ({ type: 'bool', kind: 'bool', value, blockId: id() });
const str = (value: string): Expr => ({ type: 'str', kind: 'str', value, blockId: id() });
const get = (variable: string): Expr => ({ type: 'int', kind: 'variable', variable, blockId: id() });
const arith = (left: Expr, right: Expr): Expr => ({ type: 'int', kind: 'arith', op: '+', left, right, blockId: id() });
const join = (...parts: Expr[]): Expr => ({ type: 'str', kind: 'join', parts, blockId: id() });
const print = (value: Expr): YbcStatement => ({ kind: 'print', value, blockId: id() });
const whileLoop = (condition: Expr, body: YbcStatement[]): YbcStatement => ({ kind: 'while', condition, body, blockId: id() });

const light = (): Expr => ({ type: 'int', kind: 'read', op: 'light.level', blockId: id() });
const pressed = (button: unknown): Expr => ({ type: 'bool', kind: 'read', op: 'button.isPressed', operand: { kind: 'button', button }, blockId: id() }) as Expr;
const presses = (button: unknown): Expr => ({ type: 'int', kind: 'read', op: 'button.getPresses', operand: { kind: 'button', button }, blockId: id() }) as Expr;

const pixels = (count: number, cell: unknown = false) => Array.from({ length: count }, () => cell) as boolean[];
const show = (cells: unknown[], overrides: Record<string, unknown> = {}): YbcStatement =>
  ({ kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'custom', pixels: cells, ...overrides } }, blockId: id() }) as unknown as YbcStatement;
const scrollText = (value: Expr): YbcStatement => ({ kind: 'call', op: 'display.scrollText', args: [value], blockId: id() });
const scrollNumber = (value: Expr): YbcStatement => ({ kind: 'call', op: 'display.scrollNumber', args: [value], blockId: id() });
const clear = (): YbcStatement => ({ kind: 'call', op: 'display.clear', blockId: id() });
const note = (name: unknown, ticks: unknown): YbcStatement =>
  ({ kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note: name, ticks }, blockId: id() }) as unknown as YbcStatement;
const rest = (ticks: unknown): YbcStatement => ({ kind: 'call', op: 'sound.rest', operand: { kind: 'rest', ticks }, blockId: id() }) as unknown as YbcStatement;
const unknown = (kind: string, op: string): YbcStatement => ({ kind, op, blockId: id() }) as unknown as YbcStatement;

const variables = (...names: string[]) => names.map((name) => ({ id: name, name, type: 'int' as const }));
const program = (onStart: YbcStatement[], forever: YbcStatement[] | null = null, vars = variables('x', 'y')): YbcProgramIR => ({ onStart, forever, variables: vars });

/** Generates and says it: the call must not throw, and a failure has diagnostics and no source at all. */
function failure(ir: YbcProgramIR) {
  let result: GenerateResult | undefined;
  expect(() => {
    result = generateYbcMicroPython(ir);
  }).not.toThrow();
  if (!result || result.ok) {
    throw new Error(`expected diagnostics, got:\n${result?.ok ? result.source : 'nothing'}`);
  }
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result).not.toHaveProperty('source');
  expect(result).not.toHaveProperty('lineMap');
  expect(result).not.toHaveProperty('names');
  return result;
}
const source = (ir: YbcProgramIR): string => {
  const result = generateYbcMicroPython(ir);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.source;
};
const codes = (ir: YbcProgramIR) => failure(ir).diagnostics.map((diagnostic) => diagnostic.code);

describe('a note and a rest outside the domain of C-50 and C-51 are refused, with the block, and no source', () => {
  it.each([
    ['C6 (above C5)', 'C6'],
    ['C2 (below C3)', 'C2'],
    ['an Object.prototype member', 'constructor'],
    ['__proto__', '__proto__'],
    ['a flat note', 'DB4'],
    ['a sharp note', 'C#4'],
    ['lower case', 'c4'],
    ['the empty name', ''],
    ['a number', 440],
    ['null', null],
    ['undefined', undefined],
  ])('refuses the note %s', (_label, name) => {
    const bad = note(name, 4);
    const result = failure(program([bad]));
    expect(result.diagnostics).toEqual([{ severity: 'error', code: 'value-out-of-range', message: expect.any(String), blockId: bad.blockId }]);
  });

  it.each([
    ['3', 3],
    ['0', 0],
    ['8 (the editor’s inconsistent :8)', 8],
    ['-1', -1],
    ['1.5', 1.5],
    ['0.5', 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['the text "4"', '4'],
    ['null', null],
    ['undefined', undefined],
  ])('refuses a note of %s ticks, and a rest of the same length', (_label, ticks) => {
    const badNote = note('C4', ticks);
    const badRest = rest(ticks);
    expect(failure(program([badNote])).diagnostics).toEqual([{ severity: 'error', code: 'value-out-of-range', message: expect.any(String), blockId: badNote.blockId }]);
    expect(failure(program([badRest])).diagnostics).toEqual([{ severity: 'error', code: 'value-out-of-range', message: expect.any(String), blockId: badRest.blockId }]);
  });

  it('reports every bad note, each on its own block, and still no source', () => {
    const first = note('C6', 4);
    const second = rest(3);
    const third = note('E4', 8);
    expect(failure(program([first, note('C4', 4), second, third])).diagnostics.map((diagnostic) => diagnostic.blockId)).toEqual([first.blockId, second.blockId, third.blockId]);
  });

  it('accepts every note of the domain with every length, and the three rests, at the edges too', () => {
    for (const name of ['C3', 'C5', 'A4']) {
      for (const ticks of [1, 2, 4]) {
        expect(source(program([note(name, ticks)]))).toContain(`music.play(['${name}:${ticks}'], wait=True)\n`);
      }
    }
    for (const ticks of [1, 2, 4]) {
      expect(source(program([rest(ticks)]))).toContain(`music.play(['R:${ticks}'], wait=True)\n`);
    }
  });
});

describe('a button other than A or B is refused (A+B is EXCLUDED, C-47)', () => {
  it.each([
    ['AB', 'AB'],
    ['A+B', 'A+B'],
    ['lower case a', 'a'],
    ['C', 'C'],
    ['the empty name', ''],
    ['an Object.prototype member', 'constructor'],
    ['a number', 0],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s, for a check and for a count', (_label, button) => {
    const check = pressed(button);
    const count = presses(button);
    expect(failure(program([print(check)])).diagnostics).toEqual([{ severity: 'error', code: 'unsupported-node', message: expect.any(String), blockId: check.blockId }]);
    expect(failure(program([print(count)])).diagnostics).toEqual([{ severity: 'error', code: 'unsupported-node', message: expect.any(String), blockId: count.blockId }]);
  });

  it('refuses it inside a condition and an expression too, not only as a statement', () => {
    const bad = pressed('AB');
    expect(codes(program([whileLoop(bad, [])]))).toEqual(['unsupported-node']);
    expect(failure(program([], [print(arith(presses('A'), presses('AB')))])).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-node']);
  });

  it('refuses a check that claims to be an int and a count that claims to be a bool (the type is the op’s)', () => {
    const wrongCheck = { ...pressed('A'), type: 'int' } as Expr;
    const wrongCount = { ...presses('A'), type: 'bool' } as Expr;
    expect(codes(program([print(wrongCheck)]))).toEqual(['type-mismatch']);
    expect(codes(program([print(wrongCount)]))).toEqual(['type-mismatch']);
    expect(codes(program([print({ ...light(), type: 'str' } as Expr)]))).toEqual(['type-mismatch']);
  });
});

describe('a picture that is not 5 × 5 squares, each lit or not, is refused (C-06)', () => {
  it.each([
    ['24 cells', pixels(24)],
    ['26 cells', pixels(26)],
    ['no cell', pixels(0)],
    ['a single cell', pixels(1)],
    ['50 cells', pixels(50)],
    ['a number in a cell (1)', [...pixels(24), 1]],
    ['a number in a cell (0)', [0, ...pixels(24)]],
    ['a text in a cell', [...pixels(24), 'true']],
    ['null in a cell', [...pixels(24), null]],
    ['undefined in a cell', [...pixels(24), undefined]],
    ['a hole in the list', Array.from({ length: 25 }) as unknown[]],
  ])('refuses %s', (_label, cells) => {
    const bad = show(cells as unknown[]);
    expect(failure(program([bad])).diagnostics).toEqual([{ severity: 'error', code: 'unsupported-node', message: expect.any(String), blockId: bad.blockId }]);
  });

  it('refuses a picture that is not the learner’s own (a built-in image is EXCLUDED), and an operand that is not an image', () => {
    expect(codes(program([show(pixels(25), { source: 'builtin' })]))).toEqual(['unsupported-node']);
    const notImage = { kind: 'call', op: 'display.show', operand: { kind: 'note', image: { source: 'custom', pixels: pixels(25) } }, blockId: id() } as unknown as YbcStatement;
    expect(codes(program([notImage]))).toEqual(['unsupported-node']);
  });

  it('writes a picture of exactly 25 booleans, as five rows of five digits from the top, 1 for a lit square', () => {
    // Not symmetric: a lit square at column 3 of row 1 and one at column 0 of row 4, so rows and columns swapped would show.
    const cells = Array.from({ length: 25 }, (_, index) => index === 1 * 5 + 3 || index === 4 * 5 + 0);
    expect(source(program([show(cells)]))).toContain('display.show(Image("00000:00010:00000:00000:10000"))\n');
    const diagonal = Array.from({ length: 25 }, (_, index) => index % 6 === 0);
    expect(source(program([show(diagonal)]))).toContain('display.show(Image("10000:01000:00100:00010:00001"))\n');
    expect(source(program([show(pixels(25, true))]))).toContain('display.show(Image("11111:11111:11111:11111:11111"))\n');
    expect(source(program([show(pixels(25, false))]))).toContain('display.show(Image("00000:00000:00000:00000:00000"))\n');
  });
});

describe('a typed-in scroll text outside the characters of the display is refused (C-07)', () => {
  it.each([
    ['an accented letter', 'é'],
    ['a Vietnamese letter', 'ư'],
    ['a letter beyond the BMP', '😀'],
    ['a tab', 'a\tb'],
    ['a new line', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['NUL', 'a\u0000b'],
    ['BEL', 'a\u0007'],
    ['DEL (0x7F)', 'a\u007f'],
    ['a no-break space (0xA0)', 'a b'],
    ['a lone surrogate', 'a\ud83db'],
    ['a text mixing good and bad characters', 'Hello, wörld'],
  ])('refuses %s', (_label, text) => {
    const bad = str(text);
    const result = failure(program([scrollText(bad)]));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('value-out-of-range');
    expect(result.diagnostics.every((diagnostic) => diagnostic.blockId === bad.blockId)).toBe(true);
  });

  it('accepts the whole range from space (0x20) to ~ (0x7E), and the empty text, and exactly 1000 characters', () => {
    const all = Array.from({ length: 0x7e - 0x20 + 1 }, (_, index) => String.fromCharCode(0x20 + index)).join('');
    expect(all).toHaveLength(95);
    // As a Python text: the backslash and the quote are escaped, everything else (space to ~) is written as it is.
    const literal = all.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    expect(source(program([scrollText(str(all))]))).toContain(`display.scroll('${literal}')\n`);
    expect(source(program([scrollText(str(''))]))).toContain("display.scroll('')\n");
    expect(source(program([scrollText(str('a'.repeat(1000)))]))).toContain(`display.scroll('${'a'.repeat(1000)}')\n`);
    expect(codes(program([scrollText(str('a'.repeat(1001)))]))).toContain('limit-exceeded');
  });

  it('writes the quote, the backslash and a space as Python text', () => {
    expect(source(program([scrollText(str("it's \\ ok"))]))).toContain("display.scroll('it\\'s \\\\ ok')\n");
  });

  it('leaves a text that is only known at run time to the simulator: a join with é is written as it is, with no guard', () => {
    const text = source(program([scrollText(join(str('a'), str('é')))]));
    expect(text).toContain("display.scroll('a' + 'é')\n");
    expect(text).not.toMatch(/raise|assert|isalpha|ord\(|encode|try:|except|min\(|max\(/);
  });
});

describe('a scroll of the wrong type is a type-mismatch (C-07 takes a text, C-08 an int)', () => {
  it('refuses a text scroll of an int, a bool and a variable', () => {
    for (const value of [int(5), bool(true), get('x')]) {
      expect(failure(program([scrollText(value)])).diagnostics).toEqual([{ severity: 'error', code: 'type-mismatch', message: expect.any(String), blockId: value.blockId }]);
    }
  });

  it('refuses a number scroll of a text and a bool', () => {
    for (const value of [str('5'), bool(false), join(str('a'))]) {
      expect(failure(program([scrollNumber(value)])).diagnostics).toEqual([{ severity: 'error', code: 'type-mismatch', message: expect.any(String), blockId: value.blockId }]);
    }
  });

  it('refuses a number that is not a whole number inside the safe range', () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(codes(program([scrollNumber(int(value))]))).toEqual(['invalid-literal']);
    }
  });

  it('accepts a number scroll of an int expression, and writes it without str()', () => {
    expect(source(program([scrollNumber(arith(get('x'), int(1)))]))).toContain('display.scroll(x + 1)\n');
    expect(source(program([scrollNumber(int(-12))]))).toContain('display.scroll(-12)\n');
  });
});

describe('an operation the generator does not know is unsupported-node, not an exception', () => {
  it.each([
    ['display.set_pixel (Advanced, YB-7a)', 'call', 'display.set_pixel'],
    ['display.set_brightness (EXCLUDED, C-11)', 'call', 'display.set_brightness'],
    ['music.pitch (EXCLUDED, C-21)', 'call', 'music.pitch'],
    ['music.stop (EXCLUDED, C-22)', 'call', 'music.stop'],
    ['music.set_tempo (EXCLUDED, C-52)', 'call', 'music.set_tempo'],
    ['pin.writeDigital (YB-4)', 'call', 'pin.writeDigital'],
    ['random (EXCLUDED, C-40)', 'call', 'random.randint'],
    ['an Object.prototype member', 'call', 'constructor'],
    ['__proto__', 'call', '__proto__'],
    ['toString', 'call', 'toString'],
    ['the empty op', 'call', ''],
    ['no op', 'call', undefined as unknown as string],
  ])('refuses the call %s', (_label, kind, op) => {
    const bad = unknown(kind, op);
    expect(failure(program([bad])).diagnostics).toEqual([{ severity: 'error', code: 'unsupported-node', message: expect.any(String), blockId: bad.blockId }]);
  });

  it.each(['button.isPressedAB', 'temperature', 'accelerometer.x', 'pin.readAnalog', 'running_time', 'constructor', '__proto__', ''])(
    'refuses the read %j',
    (op) => {
      const bad = { type: 'int', kind: 'read', op, blockId: id() } as unknown as Expr;
      expect(failure(program([print(bad)])).diagnostics).toEqual([{ severity: 'error', code: 'unsupported-node', message: expect.any(String), blockId: bad.blockId }]);
    },
  );

  it('writes no import for an operation it refused (the header is only written for a program it can write)', () => {
    const result = failure(program([unknown('call', 'display.set_pixel'), clear()]));
    expect(JSON.stringify(result)).not.toContain('from yolobit');
  });
});

describe('the output is deterministic', () => {
  it.each(hardwareCases)('$name: generating twice is byte-identical, in source, line map and names', ({ blocks }) => {
    const ir = compileBlocks(blocks);
    const first = generateYbcMicroPython(ir);
    const second = generateYbcMicroPython(ir);
    expect(first.ok).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(generateYbcMicroPython(compileBlocks(blocks))).toEqual(first);
  });

  const reverseKeys = (ir: YbcProgramIR) =>
    JSON.parse(JSON.stringify(ir), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value,
    ) as YbcProgramIR;

  it.each(hardwareCases)('$name: the key order of the IR objects (operands included) changes nothing', ({ blocks }) => {
    const ir = compileBlocks(blocks);
    const reversed = reverseKeys(ir);
    expect(Object.keys(reversed.onStart[0] ?? {})).toEqual(Object.keys(ir.onStart[0] ?? {}).reverse());
    expect(JSON.stringify(generateYbcMicroPython(reversed))).toBe(JSON.stringify(generateYbcMicroPython(ir)));
  });

  it('the imports and the preamble depend on the operations used, not on where in the IR they are', () => {
    const inFlat = program([note('C4', 4)], [show(pixels(25))]);
    const inDeep = program([], [whileLoop(bool(true), [whileLoop(bool(true), [note('C4', 4)])]), whileLoop(bool(false), [show(pixels(25))])]);
    for (const ir of [inFlat, inDeep, reverseKeys(inFlat), reverseKeys(inDeep)]) {
      const lines = source(ir).split('\n');
      expect(lines.slice(1, 8)).toEqual([
        'import time',
        'from yolobit import *',
        'button_a.on_pressed = None',
        'button_b.on_pressed = None',
        'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
        'import music',
        'music.set_tempo(4, 120)',
      ]);
    }
  });

  it('writes the modules of the hardware only when a hardware operation is there', () => {
    expect(source(program([print(int(1))]))).not.toMatch(/yolobit|music|on_pressed/);
    expect(source(program([note('C4', 1)]))).not.toMatch(/yolobit|on_pressed/);
    // A program of only rests needs the music module as much as one of notes: a rest is `music.play(['R:t'], wait=True)`.
    const onlyRests = source(program([rest(1), rest(4)]));
    expect(onlyRests).toContain('import music\nmusic.set_tempo(4, 120)\n');
    expect(onlyRests).not.toMatch(/yolobit|on_pressed/);
    expect(source(program([clear()]))).not.toMatch(/import music|set_tempo/);
    expect(source(program([print(light())]))).not.toMatch(/import music|set_tempo/);
    expect(source(program([print(pressed('A'))]))).toContain('from yolobit import *\n');
  });
});

describe('a very deeply nested program still ends in a diagnostic, never in a stack overflow', () => {
  it('refuses 5000 nested statements with a hardware call at the bottom', () => {
    let statement: YbcStatement = clear();
    for (let level = 0; level < 5000; level += 1) {
      statement = whileLoop(bool(true), [statement]);
    }
    expect(failure(program([statement])).diagnostics[0]).toMatchObject({ code: 'limit-exceeded' });
    expect(failure(program([], [statement])).diagnostics[0]).toMatchObject({ code: 'limit-exceeded' });
  });

  it('refuses 100 000 nested statements (far more than the stack of any recursion could take)', () => {
    let statement: YbcStatement = note('C4', 4);
    for (let level = 0; level < 100_000; level += 1) {
      statement = whileLoop(bool(true), [statement]);
    }
    expect(failure(program([statement])).diagnostics[0]).toMatchObject({ code: 'limit-exceeded' });
  });

  it('refuses 100 000 nested expressions with a read at the bottom', () => {
    let expr: Expr = light();
    for (let level = 0; level < 100_000; level += 1) {
      expr = arith(int(1), expr);
    }
    expect(failure(program([print(expr)])).diagnostics.map((diagnostic) => diagnostic.code)).toContain('limit-exceeded');
  });

  it('refuses 200 nested loops around a bad note by the depth limit, as one diagnostic and not one per level', () => {
    let statement: YbcStatement = note('C6', 4);
    for (let level = 0; level < 200; level += 1) {
      statement = whileLoop(bool(true), [statement]);
    }
    expect(codes(program([statement]))).toEqual(['limit-exceeded']);
  });

  it('writes 60 nested loops around a hardware call, with the modules found at the bottom', () => {
    let statement: YbcStatement = clear();
    for (let level = 0; level < 60; level += 1) {
      statement = whileLoop(bool(true), [statement]);
    }
    const text = source(program([statement]));
    expect(text).toContain('from yolobit import *\n');
    expect(text).toContain(`${'    '.repeat(60)}display.clear()\n`);
  });

  it('writes a wide program of 4000 hardware statements in order, and refuses one that is over the size of the file (256 KB) with no source', () => {
    const wide = (count: number) => Array.from({ length: count }, (_, index) => (index % 2 === 0 ? clear() : note('C4', 1)));
    const text = source(program(wide(4000)));
    expect(text.split('\n').filter((line) => line === 'display.clear()')).toHaveLength(2000);
    expect(failure(program(wide(20_000))).diagnostics).toMatchObject([{ code: 'program-too-large' }]);
  });
});

describe('a variable named like the API the hardware uses is renamed, so a program cannot shadow the module', () => {
  const api = ['button_a', 'button_b', 'display', 'music', 'Image', 'light_level', 'yolobit', 'time', 'random', 'temperature', 'pin0', 'pin2'];

  it('renames each of them, and keeps the call to the real one', () => {
    const ir = program(
      [
        { kind: 'set', variable: 'light_level', value: light(), blockId: id() },
        { kind: 'set', variable: 'display', value: presses('A'), blockId: id() },
        scrollNumber(get('button_a')),
        clear(),
        note('C4', 1),
      ],
      null,
      variables(...api),
    );
    const generated = generateYbcMicroPython(ir);
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    expect(Object.values(generated.names)).toEqual(api.map((name) => `${name}_2`));
    for (const name of api) {
      expect(generated.source, name).toContain(`\n${name}_2 = 0\n`);
      expect(generated.source, name).not.toMatch(new RegExp(`^${name} = `, 'm'));
    }
    // The assignments go to the renamed variables and the calls to the module.
    expect(generated.source).toContain('light_level_2 = light_level()\n');
    expect(generated.source).toContain('display_2 = button_a.get_presses()\n');
    expect(generated.source).toContain('display.scroll(button_a_2)\n');
    expect(generated.source).toContain('display.clear()\n');
    expect(generated.source).toContain("music.play(['C4:1'], wait=True)\n");
  });

  it('renames a name taken by an earlier variable, in the order of the variables, and the second one of the same name', () => {
    const generated = generateYbcMicroPython(
      program([clear()], null, [
        { id: 'a', name: 'display', type: 'int' },
        { id: 'b', name: 'display', type: 'int' },
        { id: 'c', name: 'display_2', type: 'int' },
      ]),
    );
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    expect(Object.values(generated.names)).toEqual(['display_2', 'display_3', 'display_2_2']);
  });

  it('does not rename a name that is not part of the API', () => {
    const generated = generateYbcMicroPython(program([], null, variables('score', 'pin', 'pins', 'pin_0', 'buttons')));
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    expect(Object.values(generated.names)).toEqual(['score', 'pin', 'pins', 'pin_0', 'buttons']);
  });
});
