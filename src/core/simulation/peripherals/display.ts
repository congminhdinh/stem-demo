import { blankFrame, DISPLAY_HEIGHT, DISPLAY_WIDTH, frameIndex, isFrame, type Frame, type HexColour } from '../../capabilities/frame';
import type { DisplayIO } from '../../capabilities/io';
import { DEFAULT_COLOUR, IMAGE_SIZE } from '../../constructs/ybc.display';
import { builtinImagePixels, isBuiltinImageName, type BuiltinImageName } from '../../constructs/ybc.images';
import type { ComponentState } from '../simulate-circuit';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphs } from './font';

// The virtual display (contract §4, owner-approved model OQ-E): a 5×5 matrix of lights. Everything
// here is a pure function of the text or the picture, and the one capability that reports a frame.
//
// Scrolling (contract §4.2, C-07 / C-08): "one column per ≈200 ms, six columns per character, blocks
// 1200 ms × n for n ≥ 2 characters, ends with an empty frame, the first character starts at column 0, red".
// These are vendor public simulator observations, NOT physical timing verifications (contract §0.4).
// The glyph shapes are ours (font.ts) and are `presentation`.

/** Contract §4.2: one column every ≈200 ms. */
export const SCROLL_STEP_MS = 200;

/** Contract §4.2: a character takes 6 columns (5 of glyph and 1 blank), so n characters scroll for 1200 ms × n. */
export const COLUMNS_PER_CHARACTER = 6;

/** Contract §4.3: the default colour of the text and of a lit light of a picture is red. */
export const DISPLAY_COLOUR: HexColour = DEFAULT_COLOUR;

/**
 * The frame of a picture the learner drew: cell (column x, row y) is `pixels[y * 5 + x]`, a lit one in `colour` (contract C-06;
 * red unless the colour field of N17 says otherwise).
 */
export function imageFrame(pixels: readonly boolean[], colour: HexColour = DISPLAY_COLOUR): Frame {
  if (pixels.length !== IMAGE_SIZE * IMAGE_SIZE) {
    throw new RangeError(`A picture has ${IMAGE_SIZE * IMAGE_SIZE} cells, not ${pixels.length}`);
  }
  return { pixels: pixels.map((lit) => (lit ? colour : null)) };
}

/** The frame of a built-in picture (C-05, N17 B1), in red: the micro:bit table of constructs/ybc.images.ts (presentation). */
export function iconFrame(name: BuiltinImageName): Frame {
  if (!isBuiltinImageName(name)) {
    throw new RangeError(`"${String(name)}" is not a built-in picture`);
  }
  return imageFrame(builtinImagePixels(name));
}

/** Throws unless (x, y) is a cell of the display: the interpreter checks the domain first and names the block. */
function cellIndex(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= DISPLAY_WIDTH || y < 0 || y >= DISPLAY_HEIGHT) {
    throw new RangeError(`(${x}, ${y}) is not a light of the display`);
  }
  return frameIndex(x, y);
}

/** C-10 (N17 B1): `frame` with the light at column x, row y in `colour`; a new frame, the one given is left as it was. */
export function setPixelFrame(frame: Frame, x: number, y: number, colour: HexColour): Frame {
  const index = cellIndex(x, y);
  return { pixels: frame.pixels.map((pixel, at) => (at === index ? colour : pixel)) };
}

/** C-42 (N17 B1): `frame` with the light at column x, row y off. */
export function clearPixelFrame(frame: Frame, x: number, y: number): Frame {
  const index = cellIndex(x, y);
  return { pixels: frame.pixels.map((pixel, at) => (at === index ? null : pixel)) };
}

/** C-43 (N17 B1): every light in `colour`. */
export function setAllFrame(colour: HexColour): Frame {
  return { pixels: blankFrame().pixels.map(() => colour) };
}

/** The characters of a text one by one; a character outside the BMP is one character, not two. */
export const charactersOf = (text: string): string[] => [...text];

/** How many one-column steps a text of `length` characters scrolls: 6 per character. */
export const scrollSteps = (length: number): number => length * COLUMNS_PER_CHARACTER;

/** Whether column `column` of the strip of `characters` has its light `row` lit. Past the end, or between two glyphs, it is dark. */
function stripLit(characters: readonly string[], column: number, row: number): boolean {
  const glyph = glyphs.get(characters[Math.floor(column / COLUMNS_PER_CHARACTER)] ?? '');
  const inGlyph = column % COLUMNS_PER_CHARACTER;
  return glyph !== undefined && inGlyph < GLYPH_WIDTH && row < GLYPH_HEIGHT && glyph[row]?.[inGlyph] === '#';
}

/**
 * The frame after `step` one-column shifts of the text: the window of the strip that starts at column `step`.
 * Step 0 shows the first character against column 0; step `scrollSteps(n)` is empty. A text of one character
 * is shown with step 0 and stays (contract §4.2: "one character is shown without scrolling"). The glyphs are in `colour`: red,
 * unless the colour input of N17 says otherwise.
 */
export function scrollFrame(characters: readonly string[], step: number, colour: HexColour = DISPLAY_COLOUR): Frame {
  const pixels: (HexColour | null)[] = [];
  for (let y = 0; y < DISPLAY_HEIGHT; y += 1) {
    for (let x = 0; x < DISPLAY_WIDTH; x += 1) {
      pixels.push(stripLit(characters, step + x, y) ? colour : null);
    }
  }
  return { pixels };
}

/**
 * The display capability: it reports the frame it was given as the state of the display part, and keeps
 * nothing of its own (the run keeps what is reported). Brightness is EXCLUDED (contract C-11) and not offered.
 */
export function createDisplayIO(report: (state: ComponentState) => void): DisplayIO {
  return {
    setFrame(frame) {
      // The frame comes from the interpreter, which builds well-formed ones; a sparse or short one would draw wrong lights.
      if (!isFrame(frame)) {
        throw new TypeError('A display frame has 25 pixels, each a colour or off.');
      }
      report({ frame: { pixels: [...frame.pixels] } });
    },
  };
}
