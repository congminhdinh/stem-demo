import type { BlockDefinitionJson } from '../program/blocks';
import type { HardwareConstruct } from './ybc';

// The display constructs of YB-3a (contract §4, owner-approved model OQ-E): a 5×5 RGB matrix,
// 0-based, origin top-left, x the column and y the row. Basic and Advanced share these four rows:
//   C-06 own image   display.show(Image("r0:r1:r2:r3:r4"))   digits 0 (off) and 1 (red) only
//   C-07 scroll text display.scroll('…')                      ASCII 0x20–0x7E
//   C-08 scroll number display.scroll(n)                      shown as str(n)
//   C-09 clear       display.clear()
// Not here (not opened by YB-3): set / clear one pixel, set all, colours beyond red (Advanced, YB-7a),
// brightness, graphs and built-in images (EXCLUDED).

export const showImageType = 'ybc_display_show_image';
export const scrollTextType = 'ybc_display_scroll_text';
export const scrollNumberType = 'ybc_display_scroll_number';
export const clearDisplayType = 'ybc_display_clear';

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

/** "show image" over a 5×5 grid of checkboxes: the picture is the learner's own (built-in images are EXCLUDED, contract §14). */
export const showImageDefinition: BlockDefinitionJson = {
  type: showImageType,
  message0: 'show image',
  ...Object.fromEntries(imageRows.map((row) => [`message${row + 1}`, '%1 %2 %3 %4 %5'])),
  ...Object.fromEntries(imageRows.map((row) => [`args${row + 1}`, imageRow(row)])),
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Shows your own picture on the 5×5 display. A ticked square is a red light; the picture replaces everything on the display.',
};

export const scrollTextDefinition: BlockDefinitionJson = {
  type: scrollTextType,
  message0: 'scroll text %1',
  args0: [{ type: 'input_value', name: 'TEXT', check: 'String' }],
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Scrolls a text across the display. Letters, digits and symbols from space to ~ only. One character stays still; the program waits until the text has scrolled off.',
};

export const scrollNumberDefinition: BlockDefinitionJson = {
  type: scrollNumberType,
  message0: 'scroll number %1',
  args0: [{ type: 'input_value', name: 'NUM', check: 'Number' }],
  previousStatement: null,
  nextStatement: null,
  colour: 290,
  tooltip: 'Scrolls a whole number across the display, written like str(number). A single digit stays still; the program waits until it has scrolled off.',
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
];

export const displayDefinitions: readonly BlockDefinitionJson[] = [
  showImageDefinition,
  scrollTextDefinition,
  scrollNumberDefinition,
  clearDisplayDefinition,
];
