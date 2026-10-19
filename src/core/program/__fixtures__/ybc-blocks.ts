// Builders for Blockly serialization JSON of YBC programs (tests only). They write
// the shape Blockly itself saves, which tests/ybc-blockly-conformance.test.ts checks
// against real Blockly.

export type Json = Record<string, unknown>;

let counter = 0;
const id = (type: string) => `${type}-${++counter}`;

export const num = (value: number): Json => ({ type: 'math_number', id: id('num'), fields: { NUM: value } });
export const bool = (value: boolean): Json => ({ type: 'logic_boolean', id: id('bool'), fields: { BOOL: value ? 'TRUE' : 'FALSE' } });
export const text = (value: string): Json => ({ type: 'text', id: id('text'), fields: { TEXT: value } });
export const getVar = (variable: string): Json => ({ type: 'variables_get', id: id('get'), fields: { VAR: { id: variable } } });

const binary = (type: string, fields: Json, a: Json, b: Json, names: [string, string] = ['A', 'B']): Json => ({
  type,
  id: id(type),
  fields,
  inputs: { [names[0]]: { block: a }, [names[1]]: { block: b } },
});

/** Blockly's own arithmetic block (with ÷ and power): foreign to the dialect, used to test that it is refused. */
export const foreignArith = (op: 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER', a: Json, b: Json) =>
  binary('math_arithmetic', { OP: op }, a, b);
export const arith = (op: 'ADD' | 'MINUS' | 'MULTIPLY', a: Json, b: Json) => binary('ybc_arith', { OP: op }, a, b);
export const add = (a: Json, b: Json) => arith('ADD', a, b);
export const sub = (a: Json, b: Json) => arith('MINUS', a, b);
export const mul = (a: Json, b: Json) => arith('MULTIPLY', a, b);
export const idiv = (a: Json, b: Json) => binary('ybc_int_divide', {}, a, b);
export const mod = (a: Json, b: Json) => binary('math_modulo', {}, a, b, ['DIVIDEND', 'DIVISOR']);
export const cmp = (op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE', a: Json, b: Json) =>
  binary('logic_compare', { OP: op }, a, b);
export const and = (a: Json, b: Json) => binary('logic_operation', { OP: 'AND' }, a, b);
export const or = (a: Json, b: Json) => binary('logic_operation', { OP: 'OR' }, a, b);
export const not = (a: Json): Json => ({ type: 'logic_negate', id: id('not'), inputs: { BOOL: { block: a } } });

export const setVar = (variable: string, value: Json): Json => ({
  type: 'variables_set',
  id: id('set'),
  fields: { VAR: { id: variable } },
  inputs: { VALUE: { block: value } },
});
export const print = (value: Json): Json => ({ type: 'text_print', id: id('print'), inputs: { TEXT: { block: value } } });

export const ifThen = (condition: Json, then: Json[], otherwise?: Json[]): Json => ({
  type: 'controls_if',
  id: id('if'),
  ...(otherwise ? { extraState: { hasElse: true } } : {}),
  inputs: {
    IF0: { block: condition },
    ...(then.length > 0 ? { DO0: { block: chain(then) } } : {}),
    ...(otherwise && otherwise.length > 0 ? { ELSE: { block: chain(otherwise) } } : {}),
  },
});

/** Statements linked by `next`, as Blockly saves a stack. */
export function chain(statements: Json[]): Json {
  const [first, ...rest] = statements;
  if (!first) {
    throw new Error('A chain needs a statement');
  }
  return rest.length > 0 ? { ...first, next: { block: chain(rest) } } : first;
}

/** A workspace with an `on start` (and a `forever` when given) and the variables x, y and z (ids 'x', 'y', 'z'). */
export function program(onStart: Json[], forever?: Json[], variables = ['x', 'y', 'z']): Json {
  const hat = (type: string, body: Json[], hatId: string) => ({
    type,
    id: hatId,
    ...(body.length > 0 ? { inputs: { DO: { block: chain(body) } } } : {}),
  });
  return {
    blocks: {
      languageVersion: 0,
      blocks: [hat('stem_on_start', onStart, 'on-start'), ...(forever ? [hat('stem_forever', forever, 'forever')] : [])],
    },
    variables: variables.map((name) => ({ name, id: name })),
  };
}

// --- YB-2b: loops, wait, join, else-if ---------------------------------------------------------------

const body = (statements: Json[]) => (statements.length > 0 ? { block: chain(statements) } : undefined);

export const repeat = (times: Json, statements: Json[]): Json => ({
  type: 'controls_repeat_ext',
  id: id('repeat'),
  inputs: { TIMES: { block: times }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const whileLoop = (condition: Json, statements: Json[]): Json => ({
  type: 'ybc_while',
  id: id('while'),
  inputs: { COND: { block: condition }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const countUp = (variable: string, from: Json, to: Json, step: number, statements: Json[]): Json => ({
  type: 'ybc_count_up',
  id: id('count-up'),
  fields: { VAR: { id: variable }, STEP: step },
  inputs: { FROM: { block: from }, TO: { block: to }, ...(statements.length > 0 ? { DO: body(statements) } : {}) },
});

export const wait = (ms: Json): Json => ({ type: 'ybc_wait_ms', id: id('wait'), inputs: { MS: { block: ms } } });

export const join = (...parts: Json[]): Json => ({
  type: 'text_join',
  id: id('join'),
  extraState: { itemCount: parts.length },
  inputs: Object.fromEntries(parts.map((part, index) => [`ADD${index}`, { block: part }])),
});

/** if / else if … / else: `branches` are [condition, statements] pairs, the first being the `if`. */
export const ifElif = (branches: [Json, Json[]][], otherwise?: Json[]): Json => ({
  type: 'controls_if',
  id: id('if'),
  extraState: { ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}), ...(otherwise ? { hasElse: true } : {}) },
  inputs: {
    ...Object.fromEntries(
      branches.flatMap(([condition, statements], index) => [
        [`IF${index}`, { block: condition }],
        ...(statements.length > 0 ? [[`DO${index}`, body(statements)]] : []),
      ]),
    ),
    ...(otherwise && otherwise.length > 0 ? { ELSE: body(otherwise) } : {}),
  },
});

// --- YB-3: the onboard hardware (display, buttons, light, sound) -----------------------------------------

/** A picture as five rows of five digits (1 lit, 0 off), top to bottom, as the contract writes `Image("…")`. */
export type ImageRows = [string, string, string, string, string];

/** The 25 squares of a picture, as Blockly saves them: every one written, a square that is off too. */
const squares = (rows: ImageRows) => Object.fromEntries(rows.flatMap((digits, row) => [...digits].map((digit, column) => [`R${row}C${column}`, digit === '1'])));

/**
 * "show image" as Blockly saves it since N17 B1: the colour field first (it is on the first line of the block), red unless chosen
 * otherwise, then all 25 squares.
 */
export const showImage = (rows: ImageRows): Json => ({
  type: 'ybc_display_show_image',
  id: id('show-image'),
  fields: { COLOUR: '#ff0000', ...squares(rows) },
});

/** "show image" as it was saved before N17 B1, without a colour field: an old project. It shows red. */
export const legacyShowImage = (rows: ImageRows): Json => ({ type: 'ybc_display_show_image', id: id('show-image'), fields: squares(rows) });

export const scrollText = (value: Json): Json => ({ type: 'ybc_display_scroll_text', id: id('scroll-text'), inputs: { TEXT: { block: value } } });
export const scrollNumber = (value: Json): Json => ({ type: 'ybc_display_scroll_number', id: id('scroll-number'), inputs: { NUM: { block: value } } });
export const clearDisplay = (): Json => ({ type: 'ybc_display_clear', id: id('clear-display') });

export const buttonPressed = (button: 'A' | 'B'): Json => ({ type: 'ybc_button_pressed', id: id('button-pressed'), fields: { BUTTON: button } });
export const buttonPresses = (button: 'A' | 'B'): Json => ({ type: 'ybc_button_presses', id: id('button-presses'), fields: { BUTTON: button } });
export const lightLevel = (): Json => ({ type: 'ybc_light_level', id: id('light-level') });

/** Blockly saves a dropdown as the text of its option, so the length is '1', '2' or '4'. */
export const playNote = (note: string, ticks: 1 | 2 | 4): Json => ({ type: 'ybc_sound_note', id: id('note'), fields: { NOTE: note, TICKS: String(ticks) } });
export const rest = (ticks: 1 | 2 | 4): Json => ({ type: 'ybc_sound_rest', id: id('rest'), fields: { TICKS: String(ticks) } });

/** The contract's own sample pictures (§18). */
export const images = {
  RING: ['11111', '10001', '10001', '10001', '11111'],
  CROSS: ['10001', '01010', '00100', '01010', '10001'],
  DOT: ['00000', '00000', '00100', '00000', '00000'],
  FULL: ['11111', '11111', '11111', '11111', '11111'],
} as const satisfies Record<string, ImageRows>;

// --- N17 B1: the RGB display (colours, pixels, fill, built-in pictures) -----------------------------------

/** The colour block as Blockly saves it: the dropdown's value, a lower-case '#rrggbb' of the palette. */
export const colour = (value: string): Json => ({ type: 'ybc_colour', id: id('colour'), fields: { COLOUR: value } });

/** A colour input as the toolbox fills it: a shadow colour block (a real block would be `{ block }`). */
const colourInput = (value: Json | undefined) => (value ? { COLOUR: { shadow: value } } : {});

/** "show image" in a colour: the colour field and the picture's squares, as Blockly saves a block made after N17. */
export const showImageIn = (rows: ImageRows, colourValue: string): Json => {
  const block = showImage(rows);
  return { ...block, fields: { ...(block.fields as Json), COLOUR: colourValue } };
};

/** One of the display's built-in pictures (HEART, HAPPY, ARROW_N…), by name. */
export const showIcon = (name: string): Json => ({ type: 'ybc_display_show_icon', id: id('show-icon'), fields: { ICON: name } });

export const setPixel = (x: Json, y: Json, colourBlock?: Json): Json => ({
  type: 'ybc_display_set_pixel',
  id: id('set-pixel'),
  inputs: { X: { block: x }, Y: { block: y }, ...colourInput(colourBlock) },
});

export const clearPixel = (x: Json, y: Json): Json => ({ type: 'ybc_display_clear_pixel', id: id('clear-pixel'), inputs: { X: { block: x }, Y: { block: y } } });

export const setAll = (colourBlock?: Json): Json => ({ type: 'ybc_display_set_all', id: id('set-all'), inputs: { ...colourInput(colourBlock) } });

/** "scroll text" / "scroll number" with a colour block in their colour input (a block made after N17). */
export const scrollTextIn = (value: Json, colourBlock: Json): Json => ({ ...scrollText(value), inputs: { TEXT: { block: value }, ...colourInput(colourBlock) } });
export const scrollNumberIn = (value: Json, colourBlock: Json): Json => ({ ...scrollNumber(value), inputs: { NUM: { block: value }, ...colourInput(colourBlock) } });
