import { hexColourOf, type HexColour } from '../capabilities/frame';
import type { BlockDefinitionJson } from '../program/blocks';
import type { HardwareConstruct } from './ybc';
import { builtinImageNames, type BuiltinImageName } from './ybc.images';

// The display constructs (contract §4, owner-approved model OQ-E): a 5×5 RGB matrix, 0-based, origin top-left,
// x the column and y the row. YB-3a opened four rows; N17 B1 adds the colours, one pixel, all pixels and the
// built-in pictures. Basic and Advanced share them all:
//   C-06 own image     display.show(Image("r0:r1:r2:r3:r4"))   digit 1 red; N17: the colour field writes the palette digit 1–8
//   C-07 scroll text   display.scroll('…')                      ASCII 0x20–0x7E; N17: a colour input (color='#rrggbb', UNVERIFIED)
//   C-08 scroll number display.scroll(n)                        shown as str(n); N17: a colour input, as C-07
//   C-09 clear         display.clear()
//   C-05 built-in      display.show(Image.HEART)               N17; the arrows are written as an own image (C-06)
//   C-10 set pixel     display.set_pixel(x, y, '#rrggbb')       N17; the colour block (`ybc_colour`) belongs here
//   C-42 clear pixel   display.clear_pixel(x, y)                N17
//   C-43 set all       display.set_all('#rrggbb')               N17
// A colour is one of the eight of the palette (contract §4.4). Anything else a stored program may hold (a name such as
// 'red', '#ff00', an empty text) is shown red, with a warning: it never stops the program (N17 Review Focus 3). A block
// saved before N17 has no colour field or input, and stays red. Brightness and graphs stay EXCLUDED (C-11, C-44).

export const showImageType = 'ybc_display_show_image';
export const scrollTextType = 'ybc_display_scroll_text';
export const scrollNumberType = 'ybc_display_scroll_number';
export const clearDisplayType = 'ybc_display_clear';
export const showIconType = 'ybc_display_show_icon';
export const setPixelType = 'ybc_display_set_pixel';
export const clearPixelType = 'ybc_display_clear_pixel';
export const setAllType = 'ybc_display_set_all';
/** The colour block: a dropdown of the palette, plugged into a colour input. */
export const colourType = 'ybc_colour';

/** The colour field of "show image" and of the colour block, and the colour input of the blocks that take one. */
export const COLOUR_NAME = 'COLOUR';
/** The connection check of a colour: only the colour block fits a colour input. */
export const COLOUR_CHECK = 'Colour';

/**
 * Contract §4.4: the eight colours of the editor's palette, red first (the default, contract §4.3). The value is what the
 * dropdown saves: '#rrggbb' in lower case, as Blockly's colour field writes it. The name is the core's English label.
 */
export const paletteColours = [
  { value: '#ff0000', name: 'red' },
  { value: '#ffa500', name: 'orange' },
  { value: '#ffff00', name: 'yellow' },
  { value: '#00ff00', name: 'green' },
  { value: '#0000ff', name: 'blue' },
  { value: '#4b0082', name: 'indigo' },
  { value: '#800080', name: 'purple' },
  { value: '#ffffff', name: 'white' },
] as const;

/** Contract §4.3: the default colour of a text, of a picture and of a colour that is not one; as a frame holds it. */
export const DEFAULT_COLOUR: HexColour = '#FF0000';

const paletteFrameColours: readonly HexColour[] = paletteColours.map(({ value }) => value.toUpperCase() as HexColour);

/**
 * The colour (as a frame holds it, '#RRGGBB') of a value a colour block or field holds, or null when it is not one of the
 * palette's: a name, a short code, an empty text, a colour outside the palette, a value that is not a text.
 */
export function paletteColourOf(value: unknown): HexColour | null {
  const colour = hexColourOf(value);
  return colour !== null && paletteFrameColours.includes(colour) ? colour : null;
}

/** The digit of a palette colour in `Image("…")` (EVD-05: the palette index, 1 red … 8 white), or null for another colour. */
export function paletteDigitOf(colour: string): number | null {
  const index = paletteFrameColours.indexOf(colour.toUpperCase() as HexColour);
  return index < 0 ? null : index + 1;
}

/** The matrix is 5 columns by 5 rows (contract §4.3). */
export const IMAGE_SIZE = 5;

/** The checkbox of the image block at `row` and `column` (0-based, from the top left), as Blockly names and saves it. */
export const pixelFieldName = (row: number, column: number) => `R${row}C${column}`;

/** Contract C-07: the characters the display shows are ASCII 0x20 (space) to 0x7E (~). */
export const DISPLAY_CHAR_FROM = 0x20;
export const DISPLAY_CHAR_TO = 0x7e;

/** Whether every character of `text` is one the display shows. */
export function isDisplayText(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? -1;
    if (code < DISPLAY_CHAR_FROM || code > DISPLAY_CHAR_TO) {
      return false;
    }
  }
  return true;
}

const imageRows = Array.from({ length: IMAGE_SIZE }, (_, row) => row);

/** One row of five checkboxes, left to right. */
const imageRow = (row: number) =>
  Array.from({ length: IMAGE_SIZE }, (_, column) => ({ type: 'field_checkbox', name: pixelFieldName(row, column), checked: false }));

/** The palette as dropdown options: the English name shown, the lower-case code saved (the UI overlays the names, i18n/blocks.ts). */
const colourDropdown = { type: 'field_dropdown', name: COLOUR_NAME, options: paletteColours.map(({ name, value }) => [name, value]) };
const colourInput = { type: 'input_value', name: COLOUR_NAME, check: COLOUR_CHECK };

/**
 * "show image in <colour>" over a 5×5 grid of checkboxes: the picture is the learner's own. The colour field is N17's; its first
 * option is red, so a picture saved before it (no field) loads red, and Blockly writes the field when it saves it again.
 */
export const showImageDefinition: BlockDefinitionJson = {
  type: showImageType,
  message0: 'show image in %1',
  args0: [colourDropdown],
  ...Object.fromEntries(imageRows.map((row) => [`message${row + 1}`, '%1 %2 %3 %4 %5'])),
  ...Object.fromEntries(imageRows.map((row) => [`args${row + 1}`, imageRow(row)])),
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Shows your own picture on the 5×5 display. A ticked square lights in the colour you choose; the picture replaces everything on the display.',
};

/** The text, then its colour (N17). A block saved before N17 has an empty colour input: it scrolls red. */
export const scrollTextDefinition: BlockDefinitionJson = {
  type: scrollTextType,
  message0: 'scroll text %1 in %2',
  args0: [{ type: 'input_value', name: 'TEXT', check: 'String' }, colourInput],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Scrolls a text across the display in a colour (red when none is chosen). Letters, digits and symbols from space to ~ only. One character stays still; the program waits until the text has scrolled off.',
};

export const scrollNumberDefinition: BlockDefinitionJson = {
  type: scrollNumberType,
  message0: 'scroll number %1 in %2',
  args0: [{ type: 'input_value', name: 'NUM', check: 'Number' }, colourInput],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Scrolls a whole number across the display in a colour (red when none is chosen), written like str(number). A single digit stays still; the program waits until it has scrolled off.',
};

/** The English names of the built-in pictures, in the order of `builtinImageNames` (the UI overlays them, i18n/blocks.ts). */
export const builtinImageLabels: Readonly<Record<BuiltinImageName, string>> = {
  HEART: 'heart',
  HEART_SMALL: 'small heart',
  HAPPY: 'happy',
  SAD: 'sad',
  CONFUSED: 'confused',
  ANGRY: 'angry',
  SURPRISED: 'surprised',
  YES: 'yes',
  NO: 'no',
  ARROW_N: 'arrow up',
  ARROW_E: 'arrow right',
  ARROW_S: 'arrow down',
  ARROW_W: 'arrow left',
};

/** The field of "show icon" that names the picture. */
export const ICON_NAME = 'ICON';

export const showIconDefinition: BlockDefinitionJson = {
  type: showIconType,
  message0: 'show icon %1',
  args0: [{ type: 'field_dropdown', name: ICON_NAME, options: builtinImageNames.map((name) => [builtinImageLabels[name], name]) }],
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Shows a built-in picture in red; it replaces everything on the display.',
};

/** The column (x) and the row (y), 0 to 4 from the top left, are numbers the program may compute. */
const coordinates = [
  { type: 'input_value', name: 'X', check: 'Number' },
  { type: 'input_value', name: 'Y', check: 'Number' },
];

export const setPixelDefinition: BlockDefinitionJson = {
  type: setPixelType,
  message0: 'set light at column %1 row %2 to %3',
  args0: [...coordinates, colourInput],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Lights one light in a colour. Columns and rows go from 0 to 4, starting at the top left.',
};

export const clearPixelDefinition: BlockDefinitionJson = {
  type: clearPixelType,
  message0: 'turn off light at column %1 row %2',
  args0: coordinates,
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Turns one light off. Columns and rows go from 0 to 4, starting at the top left.',
};

export const setAllDefinition: BlockDefinitionJson = {
  type: setAllType,
  message0: 'set all lights to %1',
  args0: [colourInput],
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Lights all 25 lights in one colour.',
};

export const colourDefinition: BlockDefinitionJson = {
  type: colourType,
  message0: '%1',
  args0: [colourDropdown],
  output: COLOUR_CHECK,
  colour: 290,
  tooltip: 'A colour of the display: one of the eight colours of the palette.',
};

export const clearDisplayDefinition: BlockDefinitionJson = {
  type: clearDisplayType,
  message0: 'clear display',
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Turns all the lights of the display off.',
};

export const displayConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-06', pack: 'ybc.display', blockTypes: [showImageType], capability: 'display' },
  { contractId: 'C-07', pack: 'ybc.display', blockTypes: [scrollTextType], capability: 'display' },
  { contractId: 'C-08', pack: 'ybc.display', blockTypes: [scrollNumberType], capability: 'display' },
  { contractId: 'C-09', pack: 'ybc.display', blockTypes: [clearDisplayType], capability: 'display' },
  { contractId: 'C-05', pack: 'ybc.display', blockTypes: [showIconType], capability: 'display' },
  // The colour block has no Python of its own: it is the colour argument of set pixel (and of the other colour inputs).
  { contractId: 'C-10', pack: 'ybc.display', blockTypes: [setPixelType, colourType], capability: 'display' },
  { contractId: 'C-42', pack: 'ybc.display', blockTypes: [clearPixelType], capability: 'display' },
  { contractId: 'C-43', pack: 'ybc.display', blockTypes: [setAllType], capability: 'display' },
];

export const displayDefinitions: readonly BlockDefinitionJson[] = [
  showImageDefinition,
  scrollTextDefinition,
  scrollNumberDefinition,
  clearDisplayDefinition,
  showIconDefinition,
  setPixelDefinition,
  clearPixelDefinition,
  setAllDefinition,
  colourDefinition,
];
