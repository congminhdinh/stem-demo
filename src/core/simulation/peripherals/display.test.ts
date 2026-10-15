import { describe, expect, it } from 'vitest';
import { isFrame, blankFrame, type Frame, type HexColour } from '../../capabilities/frame';
import { yolobitContract } from '../../compat/yolobit-contract';
import type { ComponentState } from '../simulate-circuit';
import {
  charactersOf,
  COLUMNS_PER_CHARACTER,
  createDisplayIO,
  DISPLAY_COLOUR,
  imageFrame,
  SCROLL_STEP_MS,
  scrollFrame,
  scrollSteps,
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
