import { describe, expect, it } from 'vitest';
import { isFrame, blankFrame, type Frame, type HexColour } from '../../capabilities/frame';
import { yolobitContract } from '../../compat/yolobit-contract';
import type { ComponentState } from '../simulate-circuit';
import { builtinImageNames } from '../../constructs/ybc.images';
import {
  charactersOf,
  clearPixelFrame,
  COLUMNS_PER_CHARACTER,
  createDisplayIO,
  DISPLAY_COLOUR,
  iconFrame,
  imageFrame,
  SCROLL_STEP_MS,
  scrollFrame,
  scrollSteps,
  setAllFrame,
  setPixelFrame,
} from './display';
import { glyphs } from './font';

// The virtual display (contract §4): a 5x5 matrix, 0-based, origin top-left, x the column and y the row, red by
// default. Every function is checked against the contract's numbers or against a strip built by hand here from the
// glyph table, not against its own indexing.

const SIZE = 5;
const pixelCount = SIZE * SIZE;
const off = (): (HexColour | null)[] => Array.from({ length: pixelCount }, () => null);

/** A frame as five strings of five characters, # lit and . dark: the way a person would draw it. */
const draw = (frame: Frame) =>
  Array.from({ length: SIZE }, (_, row) => frame.pixels.slice(row * SIZE, row * SIZE + SIZE).map((pixel) => (pixel === null ? '.' : '#')).join(''));

const glyphRows = (character: string): readonly string[] => glyphs.get(character) ?? [];

/**
 * The strip a text scrolls over, built by hand: for each character the five columns of its glyph and one blank column
 * (contract §4.2: 6 columns per character). A column is a string of five characters, the top row first.
 */
function strip(text: string): string[] {
  return [...text].flatMap((character) => {
    const rows = glyphRows(character);
    return [...Array.from({ length: SIZE }, (_, column) => rows.map((row) => row[column]).join('')), '.....'];
  });
}

/** The window of five columns that starts at `step`, drawn row by row; past the end of the strip it is dark. */
function window(text: string, step: number): string[] {
  const columns = strip(text);
  return Array.from({ length: SIZE }, (_, row) => Array.from({ length: SIZE }, (_, x) => columns[step + x]?.[row] ?? '.').join(''));
}

describe('imageFrame (C-06)', () => {
  it('maps the 25 cells row by row, a lit cell red and a dark cell off', () => {
    const pixels = Array.from({ length: pixelCount }, (_, index) => index % 3 === 0);
    expect(imageFrame(pixels).pixels).toEqual(pixels.map((lit) => (lit ? '#FF0000' : null)));
  });

  it('puts the cell of column x and row y at index y * 5 + x: a lone lit cell at column 3, row 1 is index 8', () => {
    const pixels = Array.from({ length: pixelCount }, (_, index) => index === 1 * SIZE + 3);
    const frame = imageFrame(pixels);
    expect(frame.pixels[8]).toBe('#FF0000');
    expect(frame.pixels.filter((pixel) => pixel !== null)).toHaveLength(1);
    expect(draw(frame)).toEqual(['.....', '...#.', '.....', '.....', '.....']);
  });

  it('places every one of the 25 cells at its own column and row', () => {
    for (let row = 0; row < SIZE; row++) {
      for (let column = 0; column < SIZE; column++) {
        const lit = draw(imageFrame(Array.from({ length: pixelCount }, (_, index) => index === row * SIZE + column)));
        expect(lit.join('').indexOf('#'), `row ${row} column ${column}`).toBe(row * SIZE + column);
        expect(lit[row]?.[column], `row ${row} column ${column}`).toBe('#');
      }
    }
  });

  it('draws the ring of the toolbox: the border lit, the inside dark', () => {
    const ring = ['11111', '10001', '10001', '10001', '11111'];
    expect(draw(imageFrame([...ring.join('')].map((digit) => digit === '1')))).toEqual(ring.map((row) => row.replaceAll('1', '#').replaceAll('0', '.')));
  });

  it.each([0, 1, 24, 26, 100])('refuses %d cells: a picture has exactly 25', (count) => {
    expect(() => imageFrame(Array.from({ length: count }, () => true))).toThrow(RangeError);
  });

  it('makes a well-formed frame of its own that does not alias the cells it was given', () => {
    const cells = Array.from({ length: pixelCount }, () => false);
    const frame = imageFrame(cells);
    expect(isFrame(frame)).toBe(true);
    cells[0] = true;
    expect(frame.pixels[0]).toBeNull();
  });
});

describe('the colour of the display (contract §4.3)', () => {
  it('is the default colour of the contract: red, #FF0000', () => {
    expect(DISPLAY_COLOUR).toBe(yolobitContract.display.defaultColour);
    expect(DISPLAY_COLOUR).toBe('#FF0000');
    expect(yolobitContract.display.palette).toContain(DISPLAY_COLOUR);
  });

  it('is a colour a frame accepts', () => {
    expect(isFrame({ pixels: off().map(() => DISPLAY_COLOUR) })).toBe(true);
  });
});

describe('the scroll metrics (contract §4.2, C-07 and C-08)', () => {
  it('moves one column every 200 ms and takes 6 columns per character', () => {
    expect(SCROLL_STEP_MS).toBe(200);
    expect(COLUMNS_PER_CHARACTER).toBe(6);
  });

  it.each([1, 2, 3, 5, 10])('scrolls %d characters in 6n steps, which block for 1200 ms x n', (n) => {
    expect(scrollSteps(n)).toBe(6 * n);
    expect(scrollSteps(n) * SCROLL_STEP_MS).toBe(1200 * n);
  });

  // The times the public simulator showed for these texts (contract §4.2, EVD-07 and EVD-11): vendor simulator
  // observations, not physical timings. The steps must reproduce them to within the noise of a browser timer.
  it.each([
    ['HI', 2398],
    ['ABC', 3596],
    ['HELLO', 6001],
    ['A B', 3602],
    ['ab', 2405],
    ['42', 2401],
    ['-7', 2400],
    ['100', 3602],
  ] as const)('blocks "%s" for about %d ms, as the simulator observed', (text, observed) => {
    expect(Math.abs(scrollSteps(charactersOf(text).length) * SCROLL_STEP_MS - observed)).toBeLessThanOrEqual(10);
  });

  it('counts a character outside the BMP as one character, not as its two UTF-16 units', () => {
    expect('😀'.length).toBe(2);
    expect(charactersOf('😀')).toEqual(['😀']);
    expect(charactersOf('a😀b')).toEqual(['a', '😀', 'b']);
    expect(charactersOf('AB')).toEqual(['A', 'B']);
    expect(charactersOf('')).toEqual([]);
    expect(scrollSteps(charactersOf('😀😀').length)).toBe(12);
  });
});

describe('scrollFrame', () => {
  it('shows the glyph of each of the 95 characters against column 0 at step 0, in red', () => {
    for (const character of glyphs.keys()) {
      const frame = scrollFrame([character], 0);
      expect(draw(frame), JSON.stringify(character)).toEqual(glyphRows(character));
      expect(frame.pixels.every((pixel) => pixel === null || pixel === '#FF0000'), JSON.stringify(character)).toBe(true);
      expect(isFrame(frame), JSON.stringify(character)).toBe(true);
    }
    expect(glyphs.size).toBe(95);
  });

  it('is blank at step 6n, when the last character has gone: the scroll ends on an empty frame', () => {
    for (const text of ['A', 'AB', 'HELLO', '42']) {
      const characters = charactersOf(text);
      expect(draw(scrollFrame(characters, scrollSteps(characters.length))), text).toEqual(draw(blankFrame()));
      expect(draw(scrollFrame(characters, scrollSteps(characters.length) + 3)), text).toEqual(draw(blankFrame()));
    }
  });

  it('does not shift a character early or late: "AB" at the steps that matter, drawn by hand', () => {
    const at = (step: number) => draw(scrollFrame(['A', 'B'], step));
    // Step 0: A against column 0.
    expect(at(0)).toEqual(['.###.', '#...#', '#####', '#...#', '#...#']);
    // Step 1: A has moved one column to the left; the blank column that follows it has come in on the right.
    expect(at(1)).toEqual(['###..', '...#.', '####.', '...#.', '...#.']);
    // Step 3: the last two columns of A, the blank column between the two characters, the first two columns of B.
    expect(at(3)).toEqual(['#..##', '.#.#.', '##.##', '.#.#.', '.#.##']);
    // Step 5: only the blank column of A is left, and B has not reached column 0 yet.
    expect(at(5)).toEqual(['.####', '.#...', '.####', '.#...', '.####']);
    // Step 6: B against column 0, six steps after A was.
    expect(at(6)).toEqual(['####.', '#...#', '####.', '#...#', '####.']);
    // Step 10: only the last column of B; step 11: only its blank column; step 12 = 6 x 2: empty.
    expect(at(10)).toEqual(['.....', '#....', '.....', '#....', '.....']);
    expect(at(11)).toEqual(['.....', '.....', '.....', '.....', '.....']);
    expect(at(12)).toEqual(['.....', '.....', '.....', '.....', '.....']);
  });

  it.each(['AB', 'Hi', 'a b', '42', '-7', '~!'])('matches a strip built by hand at every step of "%s"', (text) => {
    const characters = charactersOf(text);
    for (let step = 0; step <= scrollSteps(characters.length) + 2; step++) {
      expect(draw(scrollFrame(characters, step)), `${text} at step ${step}`).toEqual(window(text, step));
    }
  });

  it('draws a space as a dark character: the text moves on by its six columns', () => {
    expect(draw(scrollFrame(['A', ' ', 'B'], 6))).toEqual(draw(blankFrame()));
    expect(draw(scrollFrame(['A', ' ', 'B'], 12))).toEqual(glyphRows('B'));
  });
});

describe('createDisplayIO (the display capability)', () => {
  const reportTo = (reported: ComponentState[]) => (state: ComponentState) => {
    reported.push(state);
  };
  const frameWith = (change: (pixels: unknown[]) => void): Frame => {
    const pixels: unknown[] = off();
    change(pixels);
    return { pixels } as unknown as Frame;
  };

  it('reports the frame it was given as the state of the display part, and nothing else', () => {
    const reported: ComponentState[] = [];
    const frame = scrollFrame(['A'], 0);
    createDisplayIO(reportTo(reported)).setFrame(frame);
    expect(reported).toEqual([{ frame }]);
    expect(Object.keys(reported[0] ?? {})).toEqual(['frame']);
  });

  it('reports a copy: changing the frame afterwards does not change what was reported', () => {
    const reported: ComponentState[] = [];
    const pixels = off();
    const frame: Frame = { pixels };
    createDisplayIO(reportTo(reported)).setFrame(frame);

    pixels[0] = '#00FF00';
    expect(reported[0]?.frame?.pixels[0]).toBeNull();
    expect(reported[0]?.frame?.pixels).not.toBe(pixels);
    expect(reported[0]?.frame).not.toBe(frame);
  });

  it('reports every frame it is given, in order', () => {
    const reported: ComponentState[] = [];
    const io = createDisplayIO(reportTo(reported));
    io.setFrame(scrollFrame(['A'], 0));
    io.setFrame(blankFrame());
    expect(reported.map((state) => (state.frame ? draw(state.frame).join('/') : null))).toEqual(['.###./#...#/#####/#...#/#...#', '...../...../...../...../.....']);
  });

  it('rejects a sparse array of 25 holes, which looks the right size and draws nothing', () => {
    const reported: ComponentState[] = [];
    expect(() => createDisplayIO(reportTo(reported)).setFrame({ pixels: Array<HexColour | null>(pixelCount) })).toThrow(TypeError);
    expect(reported).toEqual([]);
  });

  it('rejects a frame with one hole', () => {
    const reported: ComponentState[] = [];
    const frame = frameWith((pixels) => {
      delete pixels[12];
    });
    expect(() => createDisplayIO(reportTo(reported)).setFrame(frame)).toThrow(TypeError);
    expect(reported).toEqual([]);
  });

  it.each([0, 1, 24, 26])('rejects a frame of %d pixels', (count) => {
    const reported: ComponentState[] = [];
    expect(() => createDisplayIO(reportTo(reported)).setFrame({ pixels: Array.from({ length: count }, () => null) })).toThrow(TypeError);
    expect(reported).toEqual([]);
  });

  it.each(['red', '#ff0000', '#FFF', 'FF0000', '#FF00000', '#GG0000', '', 1, true, undefined, {}])('rejects the colour %j', (colour) => {
    const reported: ComponentState[] = [];
    const frame = frameWith((pixels) => {
      pixels[7] = colour;
    });
    expect(() => createDisplayIO(reportTo(reported)).setFrame(frame)).toThrow(TypeError);
    expect(reported).toEqual([]);
  });

  it.each([null, undefined, 'frame', 0, [], {}, { pixels: 'x' }])('rejects %j, which is not a frame', (value) => {
    const reported: ComponentState[] = [];
    expect(() => createDisplayIO(reportTo(reported)).setFrame(value as unknown as Frame)).toThrow(TypeError);
    expect(reported).toEqual([]);
  });
});

// --- N17 B1: the RGB display ----------------------------------------------------------------------------------
// Colours, one pixel, all pixels, the built-in pictures and a coloured scroll. A frame holds upper-case '#RRGGBB'
// (frame.ts); the expected cells are written here by hand, not read back from the functions under test.

const GREEN: HexColour = '#00FF00';
const BLUE: HexColour = '#0000FF';
/** A frame as five strings of five characters, the first letter of the colour of each lit cell (R, G, B, Y, W…) and '.' off. */
const paint = (frame: Frame) => {
  const letter: Record<string, string> = { '#FF0000': 'R', '#00FF00': 'G', '#0000FF': 'B', '#FFFF00': 'Y', '#FFFFFF': 'W', '#FFA500': 'O', '#4B0082': 'I', '#800080': 'P' };
  return Array.from({ length: SIZE }, (_, row) =>
    frame.pixels.slice(row * SIZE, row * SIZE + SIZE).map((pixel) => (pixel === null ? '.' : (letter[pixel] ?? '?'))).join(''),
  );
};

describe('setPixelFrame (C-10): one light at column x, row y, in a colour', () => {
  it('puts the colour at column 2, row 3 (index 17) and changes nothing else', () => {
    const before = imageFrame([...'1000000000000000000000001'].map((digit) => digit === '1'));
    const after = setPixelFrame(before, 2, 3, GREEN);
    expect(after.pixels[3 * SIZE + 2]).toBe(GREEN);
    expect(paint(after)).toEqual(['R....', '.....', '.....', '..G..', '....R']);
    // The frame it was given is left as it was: the run keeps what was reported, never a frame changed afterwards.
    expect(paint(before)).toEqual(['R....', '.....', '.....', '.....', '....R']);
    expect(isFrame(after)).toBe(true);
  });

  it('places every one of the 25 cells at its own column and row: x the column, y the row, origin top left', () => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const lit = paint(setPixelFrame(blankFrame(), x, y, BLUE));
        expect(lit[y]?.[x], `x ${x} y ${y}`).toBe('B');
        expect(lit.join('').replaceAll('.', ''), `x ${x} y ${y}`).toBe('B');
      }
    }
  });

  it('recolours a light that is already lit', () => {
    expect(paint(setPixelFrame(setAllFrame(DISPLAY_COLOUR), 0, 0, GREEN))).toEqual(['GRRRR', 'RRRRR', 'RRRRR', 'RRRRR', 'RRRRR']);
  });

  it.each([[-1, 0], [5, 0], [0, -1], [0, 5], [1.5, 2], [Number.NaN, 0]])('refuses the cell (%d, %d): the interpreter checks 0..4 first', (x, y) => {
    expect(() => setPixelFrame(blankFrame(), x, y, GREEN)).toThrow(RangeError);
  });
});

describe('clearPixelFrame (C-42): one light off', () => {
  it('turns the light at column 4, row 0 off and leaves the others lit', () => {
    expect(paint(clearPixelFrame(setAllFrame(GREEN), 4, 0))).toEqual(['GGGG.', 'GGGGG', 'GGGGG', 'GGGGG', 'GGGGG']);
  });

  it('leaves a light that is already off off', () => {
    expect(paint(clearPixelFrame(blankFrame(), 2, 2))).toEqual(paint(blankFrame()));
  });
});

describe('setAllFrame (C-43): every light in one colour', () => {
  it.each(['#FF0000', '#00FF00', '#4B0082', '#FFFFFF'] as const)('lights all 25 in %s', (colour) => {
    const frame = setAllFrame(colour);
    expect(frame.pixels).toHaveLength(pixelCount);
    expect(frame.pixels.every((pixel) => pixel === colour)).toBe(true);
    expect(isFrame(frame)).toBe(true);
  });
});

describe('imageFrame in a colour (C-06 with the colour field of N17)', () => {
  it('lights the ticked squares in the colour given, and red when none is given (an image saved before N17)', () => {
    const cells = [...'0101011111111110111000100'].map((digit) => digit === '1');
    expect(paint(imageFrame(cells, GREEN))).toEqual(['.G.G.', 'GGGGG', 'GGGGG', '.GGG.', '..G..']);
    expect(paint(imageFrame(cells))).toEqual(['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..']);
  });
});

describe('iconFrame (C-05): the built-in pictures, in red', () => {
  // The micro:bit MicroPython images (microbitconstimage.c, MIT), a 9 there being a lit light here.
  const microbit: Record<string, string[]> = {
    HEART: ['01010', '11111', '11111', '01110', '00100'],
    HEART_SMALL: ['00000', '01010', '01110', '00100', '00000'],
    HAPPY: ['00000', '01010', '00000', '10001', '01110'],
    SAD: ['00000', '01010', '00000', '01110', '10001'],
    CONFUSED: ['00000', '01010', '00000', '01010', '10101'],
    ANGRY: ['10001', '01010', '00000', '11111', '10101'],
    SURPRISED: ['01010', '00000', '00100', '01010', '00100'],
    YES: ['00000', '00001', '00010', '10100', '01000'],
    NO: ['10001', '01010', '00100', '01010', '10001'],
    ARROW_N: ['00100', '01110', '10101', '00100', '00100'],
    ARROW_E: ['00100', '00010', '11111', '00010', '00100'],
    ARROW_S: ['00100', '00100', '10101', '01110', '00100'],
    ARROW_W: ['00100', '01000', '11111', '01000', '00100'],
  };

  it('draws HEART as the micro:bit heart: exactly these 25 cells, the lit ones red', () => {
    const frame = iconFrame('HEART');
    expect(frame.pixels).toHaveLength(pixelCount);
    expect(paint(frame)).toEqual(['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..']);
    expect(frame.pixels.filter((pixel) => pixel !== null)).toHaveLength(16);
    expect(isFrame(frame)).toBe(true);
  });

  it('offers the thirteen pictures of the plan, and draws each as the micro:bit table does', () => {
    expect([...builtinImageNames]).toEqual(Object.keys(microbit));
    for (const name of builtinImageNames) {
      const rows = microbit[name] ?? [];
      expect(draw(iconFrame(name)), name).toEqual(rows.map((row) => row.replaceAll('1', '#').replaceAll('0', '.')));
      expect(iconFrame(name).pixels.every((pixel) => pixel === null || pixel === DISPLAY_COLOUR), name).toBe(true);
    }
  });

  it.each(['heart', 'SMILE', '', 'constructor', '__proto__'])('refuses %j, which is not one of them', (name) => {
    expect(() => iconFrame(name as never)).toThrow(RangeError);
  });
});

describe('scrollFrame in a colour (C-07 / C-08 with the colour input of N17)', () => {
  it('draws the glyph in the colour given, and in red when none is given', () => {
    expect(paint(scrollFrame(['A'], 0, BLUE))).toEqual(['.BBB.', 'B...B', 'BBBBB', 'B...B', 'B...B']);
    expect(paint(scrollFrame(['A'], 0))).toEqual(['.RRR.', 'R...R', 'RRRRR', 'R...R', 'R...R']);
  });
});
