// The display frame of the Yolo:Bit-compatible runtime (contract §4.3, owner-approved OQ-E; plan §11.4).
// A 5x5 matrix of RGB; coordinates are 0-based with the origin at the top left, x is the column and y the
// row, a colour is a '#rrggbb' string, and a pixel that is off is null. This is the LOGICAL model of the
// contract: how an LED or a screen shows a colour is presentation.

export const DISPLAY_WIDTH = 5;
export const DISPLAY_HEIGHT = 5;

/** '#rrggbb', upper case as the contract writes the palette (§4.4). */
export type HexColour = `#${string}`;

/** Row-major: the pixel at column x, row y is `pixels[y * DISPLAY_WIDTH + x]`. Always 25 entries. */
export type Frame = { pixels: readonly (HexColour | null)[] };

const hexColour = /^#[0-9A-F]{6}$/;

export const frameIndex = (x: number, y: number) => y * DISPLAY_WIDTH + x;

/**
 * A '#rrggbb' code in either case as the colour a frame holds (upper case), or null for anything else: a name such as
 * 'red', a short code, an empty text, a value that is not a text (N17 B1). Whether the colour is one the blocks offer is
 * the construct's business (`paletteColourOf` in constructs/ybc.display.ts).
 */
export function hexColourOf(value: unknown): HexColour | null {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? (value.toUpperCase() as HexColour) : null;
}

/** All pixels off: the display after `clear()` and at power-on. */
export const blankFrame = (): Frame => ({ pixels: Array.from({ length: DISPLAY_WIDTH * DISPLAY_HEIGHT }, () => null) });

/** Whether a value read from a snapshot or a hook is a well-formed frame. */
export function isFrame(value: unknown): value is Frame {
  if (typeof value !== 'object' || value === null || !('pixels' in value)) {
    return false;
  }
  const { pixels } = value;
  if (!Array.isArray(pixels) || pixels.length !== DISPLAY_WIDTH * DISPLAY_HEIGHT) {
    return false;
  }
  // Every index is read: `every` and `map` skip the holes of a sparse array, and `Array(25)` has 25 holes.
  for (let index = 0; index < DISPLAY_WIDTH * DISPLAY_HEIGHT; index += 1) {
    if (!(index in pixels)) {
      return false;
    }
    const pixel: unknown = pixels[index];
    if (pixel !== null && !(typeof pixel === 'string' && hexColour.test(pixel))) {
      return false;
    }
  }
  return true;
}
