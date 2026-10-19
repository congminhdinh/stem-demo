import { describe, expect, it } from 'vitest';
import { hardwareConstructs } from '../constructs/ybc';
import {
  clearDisplayType, clearPixelType, colourType, DISPLAY_CHAR_FROM, DISPLAY_CHAR_TO, pixelFieldName, scrollNumberType, scrollTextType, setAllType, setPixelType,
  showIconType, showImageType,
} from '../constructs/ybc.display';
import { accelerationType, buttonNames, buttonPressedType, buttonPressesType, gestureIsType, lightLevelType, temperatureType } from '../constructs/ybc.input';
import { melodyType, noteNames, noteTicks, pitchType, playNoteType, restType, soundStopType } from '../constructs/ybc.sound';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { boardTargetOf } from '../devices/board-pins';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import {
  add, and, bool, buttonPressed, buttonPresses, clearDisplay, clearPixel, cmp, colour, getVar, ifElif, ifThen, images, join, lightLevel, mul, not, num, or,
  playNote, print, program, repeat, rest, scrollNumber, scrollText, setAll, setPixel, setVar, showIcon, showImage, text, wait, whileLoop, type ImageRows, type Json,
} from './__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import { MAX_PROGRAM_BLOCKS } from './limits';

// The compiler against the hardware blocks of YB-3 (contract §4-§8): the exact IR of each block, the domains of the
// contract rows (C-06..C-09, C-12, C-13, C-15, C-50, C-51), the capabilities of the board, and the rule that an operand
// (a picture, a note, a button) is never a value (plan §18.4, F3-A).

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const basicPacks = productionProfiles.get('ybc-basic')?.blockPacks ?? [];
const exposed = packs.typesOf(basicPacks);
const boardCapabilities = capabilitiesOf(registry.get('ybc-board'));

/** Compiles for the ybc-board, the way every caller that has a board does. */
/** The `ybc-board` as a compile target with the capabilities given (its pins as the board offers them). */
const targetWith = (capabilitySet: readonly string[]) => boardTargetOf(registry.get('ybc-board'), capabilitySet);
const compile = (blocks: unknown, capabilitySet: readonly string[] = boardCapabilities) => compileYbcProgram(blocks, exposed, undefined, targetWith(capabilitySet));
const main = (...statements: Json[]) => program(statements);
const diagnostics = (result: YbcCompileResult) => result.diagnostics.map(({ code, blockId }) => ({ code, blockId }));
const codes = (blocks: unknown, capabilitySet?: readonly string[]) => compile(blocks, capabilitySet).diagnostics.map((d) => d.code);
const onStart = (blocks: unknown) => {
  const result = compile(blocks);
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.ir.onStart;
};
const idOf = (block: Json) => String(block.id);
const withFields = (block: Json, fields: unknown): Json => ({ ...block, fields });

/** The pixels of a picture of five rows of five digits, row by row (digit 1 lit). */
const pixelsOf = (rows: readonly string[]) => rows.flatMap((digits) => [...digits].map((digit) => digit === '1'));

describe('the IR of each hardware block', () => {
  it('compiles "show image" to the 25 cells of the picture, row by row, as a custom picture', () => {
    const block = showImage(images.RING);
    expect(onStart(main(block))).toStrictEqual([
      { kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'custom', pixels: pixelsOf(images.RING) } }, blockId: idOf(block) },
    ]);
  });

  it('compiles "scroll text" to the text as the one argument', () => {
    const literal = text('Hi');
    const block = scrollText(literal);
    expect(onStart(main(block))).toStrictEqual([
      { kind: 'call', op: 'display.scrollText', args: [{ blockId: idOf(literal), type: 'str', kind: 'str', value: 'Hi' }], blockId: idOf(block) },
    ]);
  });

  it('compiles "scroll number" to the number as the one argument', () => {
    const literal = num(42);
    const block = scrollNumber(literal);
    expect(onStart(main(block))).toStrictEqual([
      { kind: 'call', op: 'display.scrollNumber', args: [{ blockId: idOf(literal), type: 'int', kind: 'int', value: 42 }], blockId: idOf(block) },
    ]);
  });

  it('compiles "clear display" to a call with no operand and no argument', () => {
    const block = clearDisplay();
    expect(onStart(main(block))).toStrictEqual([{ kind: 'call', op: 'display.clear', blockId: idOf(block) }]);
  });

  it('compiles "play note" to the note and its length in ticks as a number', () => {
    const block = playNote('C4', 4);
    expect(onStart(main(block))).toStrictEqual([
      { kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note: 'C4', ticks: 4 }, blockId: idOf(block) },
    ]);
  });

  it('compiles "rest" to its length in ticks as a number', () => {
    const block = rest(2);
    expect(onStart(main(block))).toStrictEqual([{ kind: 'call', op: 'sound.rest', operand: { kind: 'rest', ticks: 2 }, blockId: idOf(block) }]);
  });

  it('compiles "button is pressed" to a bool read of that button', () => {
    const block = buttonPressed('A');
    const printed = print(block);
    expect(onStart(main(printed))).toStrictEqual([
      {
        kind: 'print',
        value: { blockId: idOf(block), type: 'bool', kind: 'read', op: 'button.isPressed', operand: { kind: 'button', button: 'A' } },
        blockId: idOf(printed),
      },
    ]);
  });

  it('compiles "presses of button" to an int read of that button', () => {
    const block = buttonPresses('B');
    const printed = print(block);
    expect(onStart(main(printed))).toStrictEqual([
      {
        kind: 'print',
        value: { blockId: idOf(block), type: 'int', kind: 'read', op: 'button.getPresses', operand: { kind: 'button', button: 'B' } },
        blockId: idOf(printed),
      },
    ]);
  });

  it('compiles "light level" to an int read with no operand', () => {
    const block = lightLevel();
    const printed = print(block);
    expect(onStart(main(printed))).toStrictEqual([
      { kind: 'print', value: { blockId: idOf(block), type: 'int', kind: 'read', op: 'light.level' }, blockId: idOf(printed) },
    ]);
  });

  it('compiles the shadow text the toolbox puts into "scroll text" like a text block', () => {
    const shadow = { type: 'text', id: 'shadow-hi', fields: { TEXT: 'Hi' } };
    const block = { type: scrollTextType, id: 'scroll-shadow', inputs: { TEXT: { shadow } } };
    expect(onStart(main(block))).toStrictEqual([
      { kind: 'call', op: 'display.scrollText', args: [{ blockId: 'shadow-hi', type: 'str', kind: 'str', value: 'Hi' }], blockId: 'scroll-shadow' },
    ]);
  });

  it('keeps the statements in order and gives IR that is plain data', () => {
    const blocks = [showImage(images.DOT), scrollText(text('A')), clearDisplay(), playNote('A4', 1), rest(4)];
    const result = compile(main(...blocks));
    expect(result.ok && result.ir.onStart.map((statement) => statement.blockId)).toEqual(blocks.map(idOf));
    expect(result.ok && JSON.parse(JSON.stringify(result.ir))).toEqual(result.ok && result.ir);
  });

  it('compiles a block of every hardware construct of Basic, and of nothing else (the sensors of N17 B2 and the music of N17 B3, Advanced only, are in ybc-sensors.test.ts and ybc-music.test.ts)', () => {
    // The colour block is a statement of none: it is in a colour input of set pixel and set all here (N17 B1).
    const everything = [
      showImage(images.CROSS), scrollText(text('x')), scrollNumber(num(1)), clearDisplay(), playNote('C3', 1), rest(1),
      print(buttonPressed('A')), print(buttonPresses('A')), print(lightLevel()),
      showIcon('HEART'), setPixel(num(1), num(2), colour('#00ff00')), clearPixel(num(1), num(2)), setAll(colour('#ffffff')),
    ];
    expect(onStart(main(...everything))).toHaveLength(everything.length);
    expect(hardwareConstructs.flatMap((construct) => construct.blockTypes).sort()).toEqual(
      [
        showImageType, scrollTextType, scrollNumberType, clearDisplayType, playNoteType, restType, buttonPressedType, buttonPressesType, lightLevelType,
        showIconType, setPixelType, colourType, clearPixelType, setAllType, temperatureType, accelerationType, gestureIsType,
        melodyType, pitchType, soundStopType,
      ].sort(),
    );
  });
});

describe('"show image" (C-06): the 25 checkboxes', () => {
  it('puts the cell of column x and row y at index y * 5 + x: a lone lit cell at column 3, row 1 is pixel 8', () => {
    const picture: ImageRows = ['00000', '00010', '00000', '00000', '00000'];
    const [statement] = onStart(main(showImage(picture)));
    const pixels = statement?.kind === 'call' && statement.op === 'display.show' ? (statement.operand.image.source === 'custom' ? statement.operand.image.pixels : []) : [];
    expect(pixels).toHaveLength(25);
    expect(pixels[1 * 5 + 3]).toBe(true);
    expect(pixels.filter(Boolean)).toHaveLength(1);
    expect(pixels.indexOf(true)).toBe(8);
  });

  it('places each of the 25 cells at its own place', () => {
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 5; column++) {
        const block = { ...showImage(images.DOT), fields: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`R${Math.floor(index / 5)}C${index % 5}`, index === row * 5 + column])) };
        const [statement] = onStart(main(block));
        const pixels = statement?.kind === 'call' && statement.op === 'display.show' ? (statement.operand.image.source === 'custom' ? statement.operand.image.pixels : []) : [];
        expect(pixels.indexOf(true), `row ${row} column ${column}`).toBe(row * 5 + column);
        expect(pixels.filter(Boolean), `row ${row} column ${column}`).toHaveLength(1);
      }
    }
  });

  it('reads the field named R{row}C{col}, whatever the order the fields are written in', () => {
    const forward = showImage(images.CROSS);
    const backward = { ...forward, fields: Object.fromEntries(Object.entries(forward.fields as Json).reverse()) };
    expect(onStart(main(backward))).toEqual(onStart(main(forward)));
    expect(pixelFieldName(1, 3)).toBe('R1C3');
  });

  it.each(Object.entries(images))('keeps the picture %s: lit cells lit, the others off', (_name, rows) => {
    const [statement] = onStart(main(showImage(rows)));
    expect(statement?.kind === 'call' && statement.op === 'display.show' && (statement.operand.image.source === 'custom' ? statement.operand.image.pixels : [])).toEqual(pixelsOf(rows));
  });

  it('reads a checkbox that Blockly never saved as unticked', () => {
    const block = withFields(showImage(images.FULL), { R1C3: true });
    const [statement] = onStart(main(block));
    const pixels = statement?.kind === 'call' && statement.op === 'display.show' ? (statement.operand.image.source === 'custom' ? statement.operand.image.pixels : []) : [];
    expect(pixels.indexOf(true)).toBe(8);
    expect(pixels.filter(Boolean)).toHaveLength(1);
  });

  it('reads a block with no fields at all as a picture with every light off', () => {
    const blank = { type: showImageType, id: 'blank-image' };
    const [statement] = onStart(main(blank));
    expect(statement).toStrictEqual({
      kind: 'call',
      op: 'display.show',
      operand: { kind: 'image', image: { source: 'custom', pixels: Array.from({ length: 25 }, () => false) } },
      blockId: 'blank-image',
    });
  });

  it('refuses a square that is neither lit nor not: a number, a text, null, an array or an object is malformed-program', () => {
    for (const value of [1, 0, 'true', 'TRUE', 'on', '', null, [], {}, [true]]) {
      const block = withFields(showImage(images.RING), { ...(showImage(images.RING).fields as Json), R2C2: value });
      const result = compile(main(block));
      expect(result.ok, JSON.stringify(value)).toBe(false);
      expect(diagnostics(result), JSON.stringify(value)).toEqual([{ code: 'malformed-program', blockId: idOf(block) }]);
    }
  });

  it('ignores a field that is not a square: nothing else is read from the block', () => {
    const block = withFields(showImage(images.RING), { ...(showImage(images.RING).fields as Json), EXTRA: 'x', R5C0: true, R0C5: true });
    const [statement] = onStart(main(block));
    expect(statement?.kind === 'call' && statement.op === 'display.show' && (statement.operand.image.source === 'custom' ? statement.operand.image.pixels : [])).toEqual(pixelsOf(images.RING));
  });
});

describe('"scroll text" (C-07) and "scroll number" (C-08): the text and the number', () => {
  it('compiles the empty text: scrolling nothing is a statement that does nothing, not a mistake', () => {
    const literal = text('');
    expect(onStart(main(scrollText(literal)))).toMatchObject([{ args: [{ kind: 'str', value: '' }] }]);
  });

  it('compiles every character of the display in one text: space to ~, 95 characters', () => {
    const all = Array.from({ length: DISPLAY_CHAR_TO - DISPLAY_CHAR_FROM + 1 }, (_, index) => String.fromCharCode(DISPLAY_CHAR_FROM + index)).join('');
    expect(all).toHaveLength(95);
    expect(onStart(main(scrollText(text(all))))).toMatchObject([{ args: [{ kind: 'str', value: all }] }]);
  });

  it.each([' ', '~', '!', 'A', 'a1 b2', '-7'])('compiles the text %j', (value) => {
    expect(compile(main(scrollText(text(value)))).ok).toBe(true);
  });

  it.each(['é', 'à', '€', 'café', '日本', '😀', 'a\u00a0b', 'okÿ'])('refuses the typed-in text %j: display-char-unsupported, at the text block', (value) => {
    const literal = text(value);
    const result = compile(main(scrollText(literal)));
    expect(result.ok).toBe(false);
    expect(diagnostics(result)).toEqual([{ code: 'display-char-unsupported', blockId: idOf(literal) }]);
  });

  it('refuses a typed-in character outside ASCII in the shadow text too, which is what the toolbox puts in', () => {
    const shadow = { type: 'text', id: 'shadow-e', fields: { TEXT: 'é' } };
    const result = compile(main({ type: scrollTextType, id: 'scroll-shadow', inputs: { TEXT: { shadow } } }));
    expect(diagnostics(result)).toEqual([{ code: 'display-char-unsupported', blockId: 'shadow-e' }]);
  });

  // Contract C-07: the domain is ASCII 0x20-0x7E and a typed-in text outside it is `display-char-unsupported`. A control
  // character is outside it too (a tab is 0x09; 0x1f and 0x7f are the neighbours of the charset), whatever the text block
  // of the language says about control characters in a `print`.
  it('refuses a typed-in control character (a tab, a new line, 0x1f, 0x7f) as display-char-unsupported, the diagnostic the contract names for text outside 0x20-0x7E', () => {
    for (const value of ['\t', '\n', '\u001f', '\u007f', 'a\tb', '\u0080']) {
      const literal = text(value);
      const result = compile(main(scrollText(literal)));
      expect(result.ok, JSON.stringify(value)).toBe(false);
      expect(diagnostics(result), JSON.stringify(value)).toEqual([{ code: 'display-char-unsupported', blockId: idOf(literal) }]);
    }
  });

  it('compiles a text that is computed, and leaves its characters to be checked when the program runs', () => {
    const joined = join(text('a'), getVar('x'));
    const [statement] = onStart(main(scrollText(joined)));
    expect(statement).toMatchObject({ op: 'display.scrollText', args: [{ kind: 'join', type: 'str' }] });
    // Even a typed-in part outside ASCII: the compiler does not look into a join; the interpreter refuses the text when it runs.
    expect(compile(main(scrollText(join(text('a'), text('é'))))).ok).toBe(true);
  });

  it('refuses a number block where the text goes: type-mismatch, at the number', () => {
    const wrong = num(5);
    expect(diagnostics(compile(main(scrollText(wrong))))).toEqual([{ code: 'type-mismatch', blockId: idOf(wrong) }]);
  });

  it('refuses a text block where the number goes: type-mismatch, at the text', () => {
    const wrong = text('5');
    expect(diagnostics(compile(main(scrollNumber(wrong))))).toEqual([{ code: 'type-mismatch', blockId: idOf(wrong) }]);
  });

  it('refuses a true / false value where either goes', () => {
    expect(codes(main(scrollText(bool(true))))).toEqual(['type-mismatch']);
    expect(codes(main(scrollNumber(bool(false))))).toEqual(['type-mismatch']);
    expect(codes(main(scrollText(buttonPressed('A'))))).toEqual(['type-mismatch']);
    expect(codes(main(scrollNumber(buttonPressed('A'))))).toEqual(['type-mismatch']);
  });

  it('refuses a number where the text goes even when the number is a reading: the light level is not a text', () => {
    expect(codes(main(scrollText(lightLevel())))).toEqual(['type-mismatch']);
    expect(codes(main(scrollText(buttonPresses('A'))))).toEqual(['type-mismatch']);
    expect(codes(main(scrollText(getVar('x'))))).toEqual(['type-mismatch']);
  });

  it('shows any whole number: negative, zero, a reading, a variable or a sum', () => {
    for (const value of [num(-7), num(0), num(2 ** 53 - 1), lightLevel(), buttonPresses('B'), getVar('x'), add(num(1), num(2)), mul(lightLevel(), num(2))]) {
      expect(compile(main(scrollNumber(value))).ok, JSON.stringify(value.type)).toBe(true);
    }
  });

  it('refuses a number that is not whole, as the rest of the language does', () => {
    const fraction = num(1.5);
    expect(diagnostics(compile(main(scrollNumber(fraction))))).toEqual([{ code: 'float-not-supported', blockId: idOf(fraction) }]);
  });

  it('needs its input: a missing text or number is missing-input, at the block', () => {
    expect(diagnostics(compile(main({ type: scrollTextType, id: 'no-text' })))).toEqual([{ code: 'missing-input', blockId: 'no-text' }]);
    expect(diagnostics(compile(main({ type: scrollNumberType, id: 'no-number' })))).toEqual([{ code: 'missing-input', blockId: 'no-number' }]);
    expect(diagnostics(compile(main({ type: scrollTextType, id: 'empty-slot', inputs: { TEXT: {} } })))).toEqual([{ code: 'missing-input', blockId: 'empty-slot' }]);
  });
});

describe('notes, rests and buttons: the values of the contract domain (C-50, C-51, C-12, C-13)', () => {
  const noteBlock = (note: unknown, ticks: unknown): Json => {
    const fields: Json = {};
    if (note !== undefined) {
      fields.NOTE = note;
    }
    if (ticks !== undefined) {
      fields.TICKS = ticks;
    }
    return withFields(playNote('C4', 4), fields);
  };
  const restBlock = (ticks: unknown): Json => withFields(rest(4), ticks === undefined ? {} : { TICKS: ticks });
  const buttonBlock = (make: (button: 'A' | 'B') => Json, button: unknown): Json => withFields(make('A'), button === undefined ? {} : { BUTTON: button });
  const inside = (block: Json) => main(print(block));

  it('compiles all 45 combinations of the 15 notes and the 3 lengths, each to the note and the length it names', () => {
    expect(noteNames).toHaveLength(15);
    expect(noteTicks).toHaveLength(3);
    for (const note of noteNames) {
      for (const ticks of noteTicks) {
        const block = playNote(note, ticks);
        expect(onStart(main(block)), `${note} ${ticks}`).toStrictEqual([
          { kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note, ticks }, blockId: idOf(block) },
        ]);
      }
    }
  });

  it('compiles the three lengths of a rest and the two buttons of each button block', () => {
    for (const ticks of noteTicks) {
      expect(onStart(main(rest(ticks))), String(ticks)).toMatchObject([{ op: 'sound.rest', operand: { kind: 'rest', ticks } }]);
    }
    for (const button of buttonNames) {
      expect(onStart(inside(buttonPressed(button))), button).toMatchObject([{ value: { op: 'button.isPressed', operand: { button } } }]);
      expect(onStart(inside(buttonPresses(button))), button).toMatchObject([{ value: { op: 'button.getPresses', operand: { button } } }]);
    }
  });

  it.each(['E9', 'C6', 'C2', 'DB4', 'C#4', 'Db4', 'B#3', 'c4', 'H3', 'C', '4', '', ' C4', 'C4 ', 'C4:4', 'R'])('refuses the note %j: value-out-of-range, at the block', (note) => {
    const block = noteBlock(note, '4');
    expect(diagnostics(compile(main(block)))).toEqual([{ code: 'value-out-of-range', blockId: idOf(block) }]);
  });

  it.each(['3', '8', '0', '-1', '5', '16', '', '1.0', '01', ' 1', '2 ', 'four'])('refuses the length %j of a note or a rest: value-out-of-range, at the block', (ticks) => {
    const note = noteBlock('C4', ticks);
    const silence = restBlock(ticks);
    expect(diagnostics(compile(main(note)))).toEqual([{ code: 'value-out-of-range', blockId: idOf(note) }]);
    expect(diagnostics(compile(main(silence)))).toEqual([{ code: 'value-out-of-range', blockId: idOf(silence) }]);
  });

  it('refuses a length that is not text, as malformed-program: Blockly saves the text of the option', () => {
    // Also 1, 2 and 4: a number is not what the editor saves, so even a length inside the domain is not read from one.
    for (const ticks of [3, 8, 2, 4, 1, 0, null, true, ['4'], {}]) {
      const note = noteBlock('C4', ticks);
      const silence = restBlock(ticks);
      expect(diagnostics(compile(main(note))), JSON.stringify(ticks)).toEqual([{ code: 'malformed-program', blockId: idOf(note) }]);
      expect(diagnostics(compile(main(silence))), JSON.stringify(ticks)).toEqual([{ code: 'malformed-program', blockId: idOf(silence) }]);
    }
  });

  it('refuses a note that is not text, as malformed-program', () => {
    for (const note of [60, null, true, ['C4'], {}]) {
      const block = noteBlock(note, '4');
      expect(diagnostics(compile(main(block))), JSON.stringify(note)).toEqual([{ code: 'malformed-program', blockId: idOf(block) }]);
    }
  });

  it('refuses a note or a rest whose field is missing, as malformed-program', () => {
    const noNote = noteBlock(undefined, '4');
    const noTicks = noteBlock('C4', undefined);
    const noTicksRest = restBlock(undefined);
    expect(diagnostics(compile(main(noNote)))).toEqual([{ code: 'malformed-program', blockId: idOf(noNote) }]);
    expect(diagnostics(compile(main(noTicks)))).toEqual([{ code: 'malformed-program', blockId: idOf(noTicks) }]);
    expect(diagnostics(compile(main(noTicksRest)))).toEqual([{ code: 'malformed-program', blockId: idOf(noTicksRest) }]);
    expect(codes(main({ type: playNoteType, id: 'bare-note' }))).toEqual(['malformed-program', 'malformed-program']);
  });

  it('reports a note and a length that are both wrong, one diagnostic for each', () => {
    expect(codes(main(noteBlock('E9', '8')))).toEqual(['value-out-of-range', 'value-out-of-range']);
    expect(codes(main(noteBlock('E9', 3)))).toEqual(['value-out-of-range', 'malformed-program']);
    expect(codes(main(noteBlock(undefined, '3')))).toEqual(['malformed-program', 'value-out-of-range']);
  });

  it.each([
    ['button is pressed', buttonPressed, ['AB', 'C', 'a', 'b', '', 'A ', ' B', 'AA', '0', 'button_a', 'a+b', 'A + B', 'B+A']],
    ['presses of button', buttonPresses, ['AB', 'A+B', 'C', 'a', 'b', '', 'A ', ' B', 'AA', '0', 'button_a']],
  ] as const)('refuses a button of %s that is not A or B (N17 B4: or A+B for "is pressed"): value-out-of-range, at the block', (_name, make, refused) => {
    for (const button of refused) {
      const block = buttonBlock(make, button);
      expect(diagnostics(compile(inside(block))), JSON.stringify(button)).toEqual([{ code: 'value-out-of-range', blockId: idOf(block) }]);
    }
  });

  it.each([
    ['button is pressed', buttonPressed],
    ['presses of button', buttonPresses],
  ])('refuses a button of %s that is missing or not text, as malformed-program', (_name, make) => {
    for (const button of [undefined, 1, 0, null, true, ['A'], {}]) {
      const block = buttonBlock(make, button);
      expect(diagnostics(compile(inside(block))), JSON.stringify(button)).toEqual([{ code: 'malformed-program', blockId: idOf(block) }]);
    }
  });
});

describe('the capabilities of the board (plan §10)', () => {
  const blocks = {
    image: showImage(images.RING),
    text: scrollText(text('Hi')),
    number: scrollNumber(num(7)),
    clear: clearDisplay(),
    pressed: buttonPressed('A'),
    presses: buttonPresses('B'),
    light: lightLevel(),
    note: playNote('C4', 4),
    rest: rest(2),
  };
  const everything = main(
    blocks.image, blocks.text, blocks.number, blocks.clear,
    print(blocks.pressed), print(blocks.presses), print(blocks.light),
    blocks.note, blocks.rest,
  );
  const lacking = (capability: string) => boardCapabilities.filter((candidate) => candidate !== capability);
  const unavailable = (capabilitySet: readonly string[]) => diagnostics(compile(everything, capabilitySet));

  it('has the capabilities of the ybc-board: display, buttons, light and sound (and the temperature and motion of N17 B2) next to the pins', () => {
    expect([...boardCapabilities].sort()).toEqual(['analogIn', 'buttons', 'digital', 'display', 'light', 'motion', 'sound', 'temperature']);
    expect(compile(everything).ok).toBe(true);
  });

  it.each([
    ['display', ['image', 'text', 'number', 'clear']],
    ['buttons', ['pressed', 'presses']],
    ['light', ['light']],
    ['sound', ['note', 'rest']],
  ] as const)('refuses exactly the blocks of the %s when the board has none: capability-unavailable', (capability, affected) => {
    const result = compile(everything, lacking(capability));
    expect(result.ok).toBe(false);
    expect(diagnostics(result)).toEqual(affected.map((name) => ({ code: 'capability-unavailable', blockId: idOf(blocks[name]) })));
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('refuses all nine blocks on a board with none of the four, such as a generic board with only digital pins', () => {
    for (const capabilitySet of [[], ['digital'], ['digital', 'analogIn']]) {
      const refused = unavailable(capabilitySet);
      expect(refused.map((diagnostic) => diagnostic.code), capabilitySet.join()).toEqual(Array.from({ length: 9 }, () => 'capability-unavailable'));
      expect(refused.map((diagnostic) => diagnostic.blockId).sort(), capabilitySet.join()).toEqual(Object.values(blocks).map(idOf).sort());
    }
  });

  it('needs the hardware capabilities and no pin capability: the four alone are enough', () => {
    expect(compile(everything, ['display', 'buttons', 'light', 'sound']).ok).toBe(true);
  });

  it('checks nothing when the caller says nothing about the board', () => {
    expect(compileYbcProgram(everything, exposed).ok).toBe(true);
    expect(compileYbcProgram(everything, exposed, undefined, undefined).ok).toBe(true);
  });

  it('does not touch the language: a program without hardware compiles on a board with no capability at all', () => {
    expect(compile(main(setVar('x', num(1)), print(getVar('x')), wait(num(10))), []).ok).toBe(true);
  });

  it('refuses a hardware block wherever it stands: in a condition, a loop or a nested statement', () => {
    const noButtons = lacking('buttons');
    const inCondition = ifThen(buttonPressed('A'), [print(num(1))]);
    const inLoop = whileLoop(and(buttonPressed('A'), bool(true)), [clearDisplay()]);
    const nested = ifThen(bool(true), [ifThen(bool(true), [print(buttonPresses('A'))])]);
    expect(codes(main(inCondition), noButtons)).toEqual(['capability-unavailable']);
    expect(codes(main(inLoop), noButtons)).toEqual(['capability-unavailable']);
    expect(codes(main(nested), noButtons)).toEqual(['capability-unavailable']);
    expect(codes(main(ifThen(bool(true), [rest(1)])), lacking('sound'))).toEqual(['capability-unavailable']);
  });
});

describe('a value is not a statement, and a statement is not a value', () => {
  it('refuses a block that gives a value used as a statement: unsupported-construct, at the block', () => {
    for (const block of [buttonPressed('A'), buttonPresses('B'), lightLevel()]) {
      const result = compile(main(block));
      expect(result.ok, block.type as string).toBe(false);
      expect(diagnostics(result), block.type as string).toEqual([{ code: 'unsupported-construct', blockId: idOf(block) }]);
    }
  });

  it('refuses a statement block used as a value: unsupported-construct, at the block', () => {
    for (const block of [showImage(images.RING), scrollText(text('a')), scrollNumber(num(1)), clearDisplay(), playNote('C4', 1), rest(1)]) {
      const result = compile(main(print(block)));
      expect(result.ok, block.type as string).toBe(false);
      expect(diagnostics(result), block.type as string).toEqual([{ code: 'unsupported-construct', blockId: idOf(block) }]);
    }
  });

  it('refuses a statement block everywhere a value goes: print, set, compare, join, arithmetic, a condition, wait, repeat and the inputs of the display', () => {
    const operands: [string, (block: Json) => Json][] = [
      ['print', (block) => print(block)],
      ['set', (block) => setVar('x', block)],
      ['compare', (block) => print(cmp('EQ', block, num(1)))],
      ['join', (block) => print(join(text('a'), block))],
      ['arithmetic', (block) => setVar('x', add(block, num(1)))],
      ['if', (block) => ifThen(block, [print(num(1))])],
      ['while', (block) => whileLoop(block, [])],
      ['not', (block) => print(not(block))],
      ['and', (block) => print(and(bool(true), block))],
      ['wait', (block) => wait(block)],
      ['repeat', (block) => repeat(block, [])],
      ['scroll text', (block) => scrollText(block)],
      ['scroll number', (block) => scrollNumber(block)],
    ];
    const statements = [showImage(images.RING), clearDisplay(), playNote('C4', 4), rest(1), scrollText(text('a')), scrollNumber(num(1))];
    for (const [where, plug] of operands) {
      for (const statement of statements) {
        const result = compile(main(plug(statement)));
        expect(result.ok, `${String(statement.type)} in ${where}`).toBe(false);
        expect(diagnostics(result), `${String(statement.type)} in ${where}`).toEqual([{ code: 'unsupported-construct', blockId: idOf(statement) }]);
      }
    }
  });

  it('refuses a picture stored in a variable, printed, compared or joined: an operand is not a value (plan §18.4)', () => {
    const picture = showImage(images.RING);
    expect(codes(main(setVar('x', picture)))).toEqual(['unsupported-construct']);
    expect(codes(main(print(picture)))).toEqual(['unsupported-construct']);
    expect(codes(main(print(cmp('EQ', picture, showImage(images.RING)))))).toEqual(['unsupported-construct', 'unsupported-construct']);
    expect(codes(main(print(join(picture, text('a')))))).toEqual(['unsupported-construct']);
  });
});

describe('a block of a pack the profile does not show is not compiled', () => {
  const blocksOfPack = {
    'ybc.display': [showImage(images.RING), scrollText(text('a')), scrollNumber(num(1)), clearDisplay()],
    'ybc.sound': [playNote('C4', 1), rest(1)],
  };
  const valuesOfInput = [buttonPressed('A'), buttonPresses('A'), lightLevel()];
  const exposedWithout = (pack: string) => packs.typesOf(basicPacks.filter((id) => id !== pack));

  it.each(Object.entries(blocksOfPack))('is unknown-block for each block of %s when that pack is left out', (pack, blocks) => {
    for (const block of blocks) {
      const result = compileYbcProgram(main(block), exposedWithout(pack), undefined, targetWith(boardCapabilities));
      expect(result.ok, block.type as string).toBe(false);
      expect(diagnostics(result), block.type as string).toEqual([{ code: 'unknown-block', blockId: idOf(block) }]);
    }
  });

  it('is unknown-block for each value block of ybc.input when that pack is left out, also inside print', () => {
    for (const block of valuesOfInput) {
      const result = compileYbcProgram(main(print(block)), exposedWithout('ybc.input'), undefined, targetWith(boardCapabilities));
      expect(diagnostics(result), block.type as string).toEqual([{ code: 'unknown-block', blockId: idOf(block) }]);
    }
  });

  it('leaves the other packs alone: with ybc.input left out the display still compiles', () => {
    expect(compileYbcProgram(main(showImage(images.RING), rest(1)), exposedWithout('ybc.input'), undefined, targetWith(boardCapabilities)).ok).toBe(true);
  });

  it('refuses every hardware block when only the structure is shown, as the profiles before YB-3 did', () => {
    const structureOnly = packs.typesOf(['ybc.structure']);
    for (const block of [...blocksOfPack['ybc.display'], ...blocksOfPack['ybc.sound'], buttonPressed('A'), lightLevel()]) {
      const result = compileYbcProgram(main(block), structureOnly, undefined, targetWith(boardCapabilities));
      expect(diagnostics(result), block.type as string).toEqual([{ code: 'unknown-block', blockId: idOf(block) }]);
    }
  });
});

describe('no truthiness: a reading is a number, not a condition', () => {
  it('refuses "if (light level)" and "while (presses of A)": invalid-condition, at the if or the while', () => {
    const choose = ifThen(lightLevel(), [print(num(1))]);
    const loop = whileLoop(buttonPresses('A'), [clearDisplay()]);
    expect(diagnostics(compile(main(choose)))).toEqual([{ code: 'invalid-condition', blockId: idOf(choose) }]);
    expect(diagnostics(compile(main(loop)))).toEqual([{ code: 'invalid-condition', blockId: idOf(loop) }]);
  });

  it('refuses an else-if whose condition is a reading, and "not" and "and" of a reading', () => {
    const chain = ifElif([[buttonPressed('A'), []], [lightLevel(), []]]);
    expect(diagnostics(compile(main(chain)))).toEqual([{ code: 'invalid-condition', blockId: idOf(chain) }]);
    expect(codes(main(print(not(lightLevel()))))).toEqual(['type-mismatch']);
    expect(codes(main(print(and(buttonPressed('A'), buttonPresses('A')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(or(lightLevel(), bool(false)))))).toEqual(['type-mismatch']);
  });

  it('accepts a button as a condition, because it is true or false', () => {
    expect(compile(main(ifThen(buttonPressed('A'), [clearDisplay()]), whileLoop(buttonPressed('B'), []))).ok).toBe(true);
  });

  it('keeps the static types: a bool is not a number and a number is not a bool', () => {
    expect(codes(main(print(add(buttonPressed('A'), num(1)))))).toEqual(['type-mismatch']);
    expect(codes(main(setVar('x', buttonPressed('A'))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('LT', buttonPressed('A'), buttonPressed('B')))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('EQ', buttonPressed('A'), num(1)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('EQ', lightLevel(), bool(true)))))).toEqual(['type-mismatch']);
    expect(codes(main(print(cmp('EQ', lightLevel(), text('50')))))).toEqual(['type-mismatch']);
  });
});

describe('the readings compose with the language', () => {
  it('compares the light level with a number: light level < 30 is a bool over an int', () => {
    const condition = cmp('LT', lightLevel(), num(30));
    const [statement] = onStart(main(ifThen(condition, [clearDisplay()])));
    expect(statement).toMatchObject({
      kind: 'if',
      branches: [
        {
          condition: {
            kind: 'compare',
            op: '<',
            type: 'bool',
            left: { kind: 'read', op: 'light.level', type: 'int' },
            right: { kind: 'int', value: 30, type: 'int' },
          },
          body: [{ kind: 'call', op: 'display.clear' }],
        },
      ],
    });
  });

  it('adds to the presses: presses of A + 1 is an int', () => {
    const [statement] = onStart(main(print(add(buttonPresses('A'), num(1)))));
    expect(statement).toMatchObject({
      kind: 'print',
      value: { kind: 'arith', op: '+', type: 'int', left: { kind: 'read', op: 'button.getPresses', type: 'int', operand: { kind: 'button', button: 'A' } } },
    });
  });

  it('puts the buttons inside and, or and not, and keeps every node a bool', () => {
    const condition = and(buttonPressed('A'), or(not(buttonPressed('B')), cmp('GT', lightLevel(), num(10))));
    const [statement] = onStart(main(whileLoop(condition, [scrollNumber(buttonPresses('A'))])));
    expect(statement).toMatchObject({
      kind: 'while',
      condition: {
        kind: 'logic',
        op: 'and',
        type: 'bool',
        left: { kind: 'read', op: 'button.isPressed', type: 'bool', operand: { button: 'A' } },
        right: {
          kind: 'logic',
          op: 'or',
          type: 'bool',
          left: { kind: 'not', type: 'bool', value: { kind: 'read', op: 'button.isPressed', operand: { button: 'B' } } },
          right: { kind: 'compare', op: '>', type: 'bool' },
        },
      },
      body: [{ kind: 'call', op: 'display.scrollNumber', args: [{ kind: 'read', op: 'button.getPresses', type: 'int' }] }],
    });
  });

  it('stores a reading in an integer variable and shows it', () => {
    expect(compile(main(setVar('x', lightLevel()), setVar('y', buttonPresses('B')), scrollNumber(getVar('x')))).ok).toBe(true);
  });

  it('uses a reading where a computed number goes: wait, repeat, arithmetic', () => {
    expect(compile(main(wait(mul(lightLevel(), num(10))), repeat(buttonPresses('A'), [clearDisplay()]))).ok).toBe(true);
  });

  it('joins a reading into a text and scrolls it', () => {
    const [statement] = onStart(main(scrollText(join(text('level '), lightLevel()))));
    expect(statement).toMatchObject({ op: 'display.scrollText', args: [{ kind: 'join', type: 'str', parts: [{ kind: 'str' }, { kind: 'read', op: 'light.level' }] }] });
  });

  it('prints a button, which is true or false', () => {
    expect(compile(main(print(buttonPressed('A')), print(buttonPresses('A')), print(lightLevel()))).ok).toBe(true);
  });
});

describe('the limits of the language still apply to hardware blocks', () => {
  it('limits a program to 2000 blocks: the hat and 1999 hardware statements pass, one more is program-too-large', () => {
    const many = (count: number) => main(...Array.from({ length: count }, () => clearDisplay()));
    expect(compile(many(MAX_PROGRAM_BLOCKS - 1)).ok).toBe(true);
    expect(codes(many(MAX_PROGRAM_BLOCKS))).toEqual(['program-too-large']);
  });

  it('counts the blocks that give a value too: a print of the light level is two blocks', () => {
    const readings = (count: number) => main(...Array.from({ length: count }, () => print(lightLevel())));
    expect(compile(readings((MAX_PROGRAM_BLOCKS - 2) / 2)).ok).toBe(true);
    expect(codes(readings(MAX_PROGRAM_BLOCKS / 2 + 1))).toEqual(['program-too-large']);
  });

  it('does not count the 25 squares of a picture as blocks', () => {
    const pictures = Array.from({ length: MAX_PROGRAM_BLOCKS - 1 }, () => showImage(images.FULL));
    expect(compile(main(...pictures)).ok).toBe(true);
  });

  it('does not follow statements nested without end around a hardware block', () => {
    let nested: Json = clearDisplay();
    for (let depth = 0; depth < 150; depth++) {
      nested = ifThen(buttonPressed('A'), [nested]);
    }
    const result = compile(main(nested));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'malformed-program')).toBe(true);
  });

  it('follows a reasonable nesting around a hardware block', () => {
    let nested: Json = clearDisplay();
    for (let depth = 0; depth < 30; depth++) {
      nested = ifThen(buttonPressed('A'), [nested]);
    }
    expect(compile(main(nested)).ok).toBe(true);
  });

  it('does not follow expressions nested without end around a reading', () => {
    let nested: Json = lightLevel();
    for (let depth = 0; depth < 150; depth++) {
      nested = add(nested, num(1));
    }
    const result = compile(main(scrollNumber(nested)));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'malformed-program')).toBe(true);
  });
});

describe('compileYbcProgram never throws on a hardware block of the wrong shape', () => {
  const isValueBlock = (block: Json) => [buttonPressedType, buttonPressesType, lightLevelType].includes(String(block.type));
  const hardware = (): Json[] => [
    showImage(images.RING), scrollText(text('a')), scrollNumber(num(1)), clearDisplay(),
    buttonPressed('A'), buttonPresses('A'), lightLevel(), playNote('C4', 4), rest(1),
  ];
  /** A hardware block where a program holds it: a statement as it is, a block that gives a value inside a print. */
  const placed = (block: Json): Json => (isValueBlock(block) ? print(block) : block);
  const shapes: [string, Json][] = [
    ['fields: a text', { fields: 'x' }],
    ['fields: a number', { fields: 5 }],
    ['fields: null', { fields: null }],
    ['fields: an array', { fields: ['A'] }],
    ['inputs: a text', { inputs: 'x' }],
    ['inputs: a number', { inputs: 5 }],
    ['inputs: null', { inputs: null }],
    ['inputs: an array', { inputs: [] }],
    ['next: a text', { next: 'x' }],
    ['next: a number', { next: 5 }],
    ['next: null', { next: null }],
    ['next: an array', { next: [] }],
    ['disabledReasons: a text', { disabledReasons: 'x' }],
    ['id: a number', { id: 5 }],
    ['type: a number', { type: 5 }],
  ];

  it.each(shapes)('reports a hardware block with %s, and does not throw', (_name, change) => {
    for (const block of hardware()) {
      const hostile = { ...block, ...change };
      let result: YbcCompileResult | undefined;
      expect(() => {
        result = compile(main(placed(hostile)));
      }, `${String(block.type)} with ${JSON.stringify(change)}`).not.toThrow();
      expect(result?.ok, `${String(block.type)} with ${JSON.stringify(change)}`).toBe(false);
      expect(result?.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    }
  });

  it.each([
    ['a text', 'x'],
    ['null', null],
    ['an array', []],
    ['a block that is a number', { block: 5 }],
    ['a block that is an empty object', { block: {} }],
    ['a block with fields of the wrong shape', { block: { type: 'text', id: 't', fields: 'x' } }],
    ['a block with inputs of the wrong shape', { block: { type: 'math_number', id: 'n', inputs: 'x' } }],
    ['a shadow that is a number', { shadow: 5 }],
  ])('reports a display input that is %s, and does not throw', (_name, input) => {
    for (const [type, name] of [[scrollTextType, 'TEXT'], [scrollNumberType, 'NUM']] as const) {
      const hostile = { type, id: 'hostile', inputs: { [name]: input } };
      let result: YbcCompileResult | undefined;
      expect(() => {
        result = compile(main(hostile));
      }, `${type} with ${JSON.stringify(input)}`).not.toThrow();
      expect(result?.ok, `${type} with ${JSON.stringify(input)}`).toBe(false);
    }
  });

  it('reports a text input whose block is a text without its text, and a number without its number', () => {
    expect(codes(main({ type: scrollTextType, id: 's', inputs: { TEXT: { block: { type: 'text', id: 't' } } } }))).toEqual(['malformed-program']);
    expect(codes(main({ type: scrollNumberType, id: 's', inputs: { NUM: { block: { type: 'math_number', id: 'n' } } } }))).toEqual(['float-not-supported']);
  });

  it('ends on hardware statements that link back to themselves, reporting them instead of running for ever', () => {
    const loop = clearDisplay();
    loop.next = { block: loop };
    let result: YbcCompileResult | undefined;
    expect(() => {
      result = compile({ blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'on-start', inputs: { DO: { block: loop } } }] }, variables: [] });
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.diagnostics.some((diagnostic) => diagnostic.code === 'malformed-program')).toBe(true);
  });

  it('reports a program that is not a workspace, and does not throw', () => {
    for (const blocks of [null, undefined, 5, 'x', [], { blocks: 5 }, { blocks: { blocks: 'x' } }]) {
      expect(() => compile(blocks), JSON.stringify(blocks)).not.toThrow();
      expect(compile(blocks).ok, JSON.stringify(blocks)).toBe(false);
    }
  });
});
