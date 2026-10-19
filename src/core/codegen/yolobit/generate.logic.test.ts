import { describe, expect, it } from 'vitest';
import {
  add, buttonPressed, buttonPresses, getVar, idiv, ifThen, lightLevel, not, num, or, print, program, randomInt, runningTime, scrollNumber, setVar, showImage,
  images,
} from '../../program/__fixtures__/ybc-blocks';
import { compileBlocks } from './__fixtures__/compile-case';
import { generateYbcMicroPython } from './generate';

// N17 B4: the Python of A+B, the running time and a random number (docs/yolobit-compatibility-contract.md §26):
//   button_a.is_pressed() and button_b.is_pressed()   A+B: two C-12 calls (V·G) joined by C-35's `and`; never the editor's
//                                                     button_a.is_pressed_ab(), which the simulator snapshot does not have (C-47)
//   running_time()                                    C-19, the call the editor wrote (V·G); what it counts from is UNVERIFIED
//   random.randint(1, 6)                              C-40, the call the editor wrote (V·G), with `import random` once;
//                                                     the module on the firmware is UNVERIFIED (C-03d)
// The simulator takes the ends of a random number in either order; the Python must mean the same, so typed-in ends are written low
// first, and computed ends that read nothing are written `min(a, b), max(a, b)`. Computed ends that read the board (or draw another
// random number) would be read twice that way, so they are refused, never written wrong (K4).

const generated = (blocks: unknown) => generateYbcMicroPython(compileBlocks(blocks));
const source = (blocks: unknown): string => {
  const result = generated(blocks);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.source;
};
/** The lines of the program after the header and the variables (x, y and z, which the builder declares, start at 0). */
const body = (blocks: unknown) => {
  const lines = source(blocks).split('\n');
  return lines.slice(lines.indexOf('') + 1).filter((line) => line !== '' && !/^[xyz] = 0$/.test(line));
};
const header = (blocks: unknown) => {
  const lines = source(blocks).split('\n');
  return lines.slice(1, lines.indexOf(''));
};

describe('A+B', () => {
  it('is button_a.is_pressed() and button_b.is_pressed()', () => {
    expect(body(program([print(buttonPressed('A+B'))]))).toContain('print(button_a.is_pressed() and button_b.is_pressed())');
    expect(body(program([], [ifThen(buttonPressed('A+B'), [showImage(images.FULL)])]))).toContain('    if button_a.is_pressed() and button_b.is_pressed():');
  });

  it('keeps its meaning inside not and or: parenthesised where Python would bind it otherwise', () => {
    expect(body(program([print(not(buttonPressed('A+B')))]))).toContain('print(not (button_a.is_pressed() and button_b.is_pressed()))');
    expect(body(program([print(or(buttonPressed('A+B'), buttonPressed('A')))]))).toContain('print((button_a.is_pressed() and button_b.is_pressed()) or button_a.is_pressed())');
  });

  it('never writes the editor’s is_pressed_ab(), and imports yolobit as a button does', () => {
    const text = source(program([print(buttonPressed('A+B'))]));
    expect(text).not.toContain('is_pressed_ab()');
    expect(header(program([print(buttonPressed('A+B'))]))).toEqual([
      'import time',
      'from yolobit import *',
      'button_a.on_pressed = None',
      'button_b.on_pressed = None',
      'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
    ]);
  });
});

describe('running time', () => {
  it('is running_time(), from the yolobit module', () => {
    expect(body(program([print(runningTime())]))).toContain('print(running_time())');
    expect(header(program([print(runningTime())]))).toContain('from yolobit import *');
    expect(body(program([setVar('x', add(runningTime(), num(1)))]))).toContain('x = running_time() + 1');
  });
});

describe('a random number', () => {
  it('is random.randint(1, 6), with import random once, after the other imports', () => {
    const blocks = program([print(randomInt(num(1), num(6))), scrollNumber(randomInt(num(1), num(6)))]);
    expect(body(blocks)).toEqual(['print(random.randint(1, 6))', 'display.scroll(random.randint(1, 6))', 'while True:', '    time.sleep_ms(10)']);
    expect(header(blocks)).toEqual([
      'import time',
      'from yolobit import *',
      'button_a.on_pressed = None',
      'button_b.on_pressed = None',
      'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
      'import random',
    ]);
    expect(source(blocks).match(/import random/g)).toHaveLength(1);
  });

  it('needs only import random when nothing else is used', () => {
    expect(header(program([print(randomInt(num(0), num(4)))]))).toEqual(['import time', 'import random']);
  });

  it('is not imported when no random number is used', () => {
    expect(source(program([print(num(1))]))).not.toContain('random');
  });

  it('writes typed-in ends low first, also when they were typed the other way round', () => {
    expect(body(program([print(randomInt(num(6), num(1))), print(randomInt(num(-5), num(-5)))]))).toEqual([
      'print(random.randint(1, 6))',
      'print(random.randint(-5, -5))',
      'while True:',
      '    time.sleep_ms(10)',
    ]);
  });

  it('writes computed ends that read nothing as min and max, so the order does not matter on the board either', () => {
    expect(body(program([print(randomInt(num(1), getVar('x'))), print(randomInt(add(getVar('x'), num(1)), idiv(getVar('y'), num(2))))]))).toEqual([
      'print(random.randint(min(1, x), max(1, x)))',
      'print(random.randint(min(x + 1, y // 2), max(x + 1, y // 2)))',
      'while True:',
      '    time.sleep_ms(10)',
    ]);
  });

  it('refuses ends that read the board or draw a random number: written twice, they would be read twice', () => {
    for (const end of [lightLevel(), buttonPresses('A'), runningTime(), randomInt(num(1), num(2))]) {
      const result = generated(program([print(randomInt(num(1), end))]));
      expect(result.ok, String(end.type)).toBe(false);
      expect(result.diagnostics, String(end.type)).toEqual([
        expect.objectContaining({
          code: 'unsupported-node',
          message: 'The ends of a random number must not read the board or draw a random number; put that value in a variable first.',
        }),
      ]);
    }
  });

  it('checks typed-in ends against the contract domain, as the compiler does', () => {
    const ir = compileBlocks(program([print(randomInt(num(1), num(6)))]));
    const statement = ir.onStart[0];
    if (statement?.kind !== 'print' || statement.value.kind !== 'read' || statement.value.op !== 'random.int') {
      throw new Error('not a random number');
    }
    const forged = { ...ir, onStart: [{ ...statement, value: { ...statement.value, args: [statement.value.args[0], { ...statement.value.args[1], value: 2_000_000 }] } }] };
    const result = generateYbcMicroPython(forged as typeof ir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'value-out-of-range' })]);
  });
});
