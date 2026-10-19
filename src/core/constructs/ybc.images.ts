// The built-in pictures of the display (N17 B1, contract row C-05): the names the "show icon" block offers and the 5×5 picture
// the simulator draws for each, row by row from the top, a lit light '1'.
//
// The names: nine of the thirteen the vendor's editor offers (contract §14, EVD-02; generated as `Image.<NAME>`, investigation
// §5.3), and four arrows the plan adds, which the vendor's editor does not offer.
// The pictures: the micro:bit MicroPython `Image` constants (microbitconstimage.c, MIT License, a 9 there being a 1 here), which
// is the table the plan names. They are `presentation`, like the glyphs of the font: the board draws its own pictures for the
// vendor's names, and those pictures were not read (contract §0.3), so how a name looks on the board is UNVERIFIED. The arrows
// are generated as a picture of our own (C-06), so the board shows exactly these.

export const builtinImageNames = [
  'HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO', 'ARROW_N', 'ARROW_E', 'ARROW_S', 'ARROW_W',
] as const;

export type BuiltinImageName = (typeof builtinImageNames)[number];

/** Five rows of five digits, top to bottom, 1 lit. */
export type ImageRows = readonly [string, string, string, string, string];

export const builtinImageRows: Readonly<Record<BuiltinImageName, ImageRows>> = {
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

/** The names the vendor's editor offers (contract §14): Python writes these `Image.<NAME>`; the others as a picture of our own. */
export const vendorImageNames: ReadonlySet<BuiltinImageName> = new Set(['HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO']);

/** Whether `value` names a built-in picture. A list, not an object lookup: "constructor" is not a picture. */
export const isBuiltinImageName = (value: unknown): value is BuiltinImageName =>
  typeof value === 'string' && (builtinImageNames as readonly string[]).includes(value);

/** The 25 cells of a built-in picture, row by row from the top left, true for a lit light. */
export const builtinImagePixels = (name: BuiltinImageName): boolean[] => [...builtinImageRows[name].join('')].map((digit) => digit === '1');
