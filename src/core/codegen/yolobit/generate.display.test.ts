import { describe, expect, it } from 'vitest';
import {
  colour, images, legacyShowImage, num, program, scrollNumber, scrollNumberIn, scrollText, scrollTextIn, setAll, setPixel, showIcon, showImage, showImageIn,
  text,
} from '../../program/__fixtures__/ybc-blocks';
import type { Expr, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { compileBlocks } from './__fixtures__/compile-case';
import { generateYbcMicroPython } from './generate';

// N17 B1: the Python of the RGB display. The forms (docs/yolobit-compatibility-contract.md, N17 table):
//   display.show(Image.HEART)                  VERIFIED (V·G, investigation §5.3; the editor's list, contract §14)
//   display.set_pixel(x, y, '#rrggbb')          VERIFIED (V·G EVD-03, C-10); clear_pixel C-42, set_all C-43 likewise
//   display.show(Image("20002:…"))             form VERIFIED (V·G EVD-05: the digit is the palette index); how the board shows 2–8 UNVERIFIED (EVD-13)
//   display.scroll('Hi', color='#rrggbb')       UNVERIFIED (no evidence of a colour on scroll); red writes the verified form without it
// A program saved before N17 generates exactly what it generated before.

const source = (blocks: unknown): string => {
  const generated = generateYbcMicroPython(compileBlocks(blocks));
  if (!generated.ok) {
    throw new Error(JSON.stringify(generated.diagnostics));
  }
  return generated.source;
};
const body = (blocks: unknown) => source(blocks).split('\n').filter((line) => /^display\./.test(line));

describe('old programs generate what they generated before', () => {
  it('writes a picture without a colour field and one whose colour is red the same, in the 0/1 digits of C-06', () => {
    const legacy = source(program([legacyShowImage(images.RING)]));
    expect(source(program([showImageIn(images.RING, '#ff0000')]))).toBe(legacy);
    expect(source(program([showImage(images.RING)]))).toBe(legacy);
    expect(legacy).toContain('display.show(Image("11111:10001:10001:10001:11111"))');
  });

  it('writes a red scroll, or one without a colour input, in the verified form, with no colour argument', () => {
    expect(body(program([scrollText(text('Hi')), scrollNumber(num(7))]))).toEqual(["display.scroll('Hi')", 'display.scroll(7)']);
    expect(body(program([scrollTextIn(text('Hi'), colour('#ff0000')), scrollNumberIn(num(7), colour('#FF0000'))]))).toEqual(["display.scroll('Hi')", 'display.scroll(7)']);
  });
});

describe('the colours of the palette', () => {
  const palette = ['#ff0000', '#ffa500', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#800080', '#ffffff'];

  it.each(palette.map((value, index) => [value, index + 1] as const))('writes %s as the digit %d of a picture (EVD-05) and in lower case elsewhere', (value, digit) => {
    expect(body(program([showImageIn(images.DOT, value), setAll(colour(value.toUpperCase())), setPixel(num(0), num(4), colour(value))]))).toEqual([
      `display.show(Image("00000:00000:00${digit}00:00000:00000"))`,
      `display.set_all('${value}')`,
      `display.set_pixel(0, 4, '${value}')`,
    ]);
  });

  it('writes red for a colour that is not one (the program the simulator ran shows red too)', () => {
    expect(body(program([setAll(colour('red')), setPixel(num(1), num(1), colour('#ff00')), showImageIn(images.DOT, '')]))).toEqual([
      "display.set_all('#ff0000')",
      "display.set_pixel(1, 1, '#ff0000')",
      'display.show(Image("00000:00000:00100:00000:00000"))',
    ]);
  });
});

describe('the built-in pictures', () => {
  it.each(['HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO'])('writes %s by its name, as the vendor editor does', (name) => {
    expect(body(program([showIcon(name)]))).toEqual([`display.show(Image.${name})`]);
  });

  it.each([
    ['ARROW_N', '00100:01110:10101:00100:00100'],
    ['ARROW_E', '00100:00010:11111:00010:00100'],
    ['ARROW_S', '00100:00100:10101:01110:00100'],
    ['ARROW_W', '00100:01000:11111:01000:00100'],
  ])('writes %s, which the vendor editor does not offer, as a picture of our own', (name, rows) => {
    expect(body(program([showIcon(name)]))).toEqual([`display.show(Image("${rows}"))`]);
  });
});

describe('IR the compiler would never produce is a diagnostic, never a crash or half a program', () => {
  let counter = 0;
  const id = () => `forged-${++counter}`;
  const int = (value: number): Expr => ({ type: 'int', kind: 'int', value, blockId: id() });
  const ir = (statement: unknown): YbcProgramIR => ({ onStart: [statement as YbcStatement], forever: null, variables: [] });
  const fails = (statement: unknown) => {
    const result = generateYbcMicroPython(ir(statement));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('source');
  };

  it.each([
    ['a colour that is not a code', { kind: 'call', op: 'display.setAll', operand: { kind: 'colour', colour: 'red' } }],
    ['a colour outside the palette', { kind: 'call', op: 'display.setAll', operand: { kind: 'colour', colour: '#123456' } }],
    ['a pixel at column 5', { kind: 'call', op: 'display.setPixel', args: [int(5), int(0)], operand: { kind: 'colour', colour: '#FF0000' } }],
    ['a pixel with one coordinate', { kind: 'call', op: 'display.setPixel', args: [int(0)], operand: { kind: 'colour', colour: '#FF0000' } }],
    ['a pixel off at row -1', { kind: 'call', op: 'display.clearPixel', args: [int(0), int(-1)] }],
    ['a picture with a name that is not one', { kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'builtin', name: 'SMILE' } } }],
    ['a picture in a colour that is not one', { kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'custom', pixels: Array.from({ length: 25 }, () => true), colour: '#12' } } }],
    ['a scroll in a colour that is not one', { kind: 'call', op: 'display.scrollText', args: [{ type: 'str', kind: 'str', value: 'Hi', blockId: 's' }], operand: { kind: 'colour', colour: 'blue' } }],
  ])('%s', (_label, statement) => {
    fails({ ...statement, blockId: id() });
  });
});
