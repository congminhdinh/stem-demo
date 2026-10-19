import type { BlockDefinitionJson } from '../program/blocks';

// The language constructs of the YBC dialect (YB plan §9.4, §12): which block
// types realise which row of the Yolo:Bit contract. A profile exposes a
// construct by listing its contract id, and a construct is only ever shown if
// that row passes the exposure gate (tests/constructs). The structure stays in
// `ybc.structure`; this file holds the language rows of YB-2a and YB-2b.

export type LangPackId = 'lang.logic' | 'lang.loops' | 'lang.math' | 'lang.text' | 'lang.variables';

export type LangConstruct = { contractId: string; pack: LangPackId; blockTypes: readonly string[] };

export const whileType = 'ybc_while';
export const countUpType = 'ybc_count_up';
export const waitType = 'ybc_wait_ms';
/** N17 B4: "running time (ms)", C-19: `running_time()`, the whole ms since the program started. */
export const runningTimeType = 'ybc_running_time';
/** N17 B4: "random number from … to …", C-40: `random.randint(a, b)`, both ends included, in either order. */
export const randomIntType = 'ybc_random_int';

/** Blockly's own blocks, plus the ones whose operators the dialect fixes or that Blockly has no block for. */
export const langConstructs: readonly LangConstruct[] = [
  { contractId: 'C-30', pack: 'lang.variables', blockTypes: ['variables_get', 'variables_set'] },
  { contractId: 'C-29', pack: 'lang.text', blockTypes: ['text_print'] },
  { contractId: 'C-56', pack: 'lang.text', blockTypes: ['text', 'text_join'] },
  { contractId: 'C-04', pack: 'lang.loops', blockTypes: [waitType] },
  // N17 B4 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): the running time joins the Time category, a random number the Math one.
  // Both profiles show them for now; B6 decides the split.
  { contractId: 'C-19', pack: 'lang.loops', blockTypes: [runningTimeType] },
  { contractId: 'C-37', pack: 'lang.loops', blockTypes: ['controls_repeat_ext'] },
  { contractId: 'C-38', pack: 'lang.loops', blockTypes: [whileType] },
  { contractId: 'C-39', pack: 'lang.loops', blockTypes: [countUpType] },
  { contractId: 'C-31', pack: 'lang.math', blockTypes: ['math_number', 'ybc_arith'] },
  { contractId: 'C-32', pack: 'lang.math', blockTypes: ['ybc_int_divide'] },
  { contractId: 'C-33', pack: 'lang.math', blockTypes: ['math_modulo'] },
  { contractId: 'C-40', pack: 'lang.math', blockTypes: [randomIntType] },
  { contractId: 'C-34', pack: 'lang.logic', blockTypes: ['logic_compare'] },
  { contractId: 'C-35', pack: 'lang.logic', blockTypes: ['logic_operation', 'logic_negate', 'logic_boolean'] },
  { contractId: 'C-36', pack: 'lang.logic', blockTypes: ['controls_if'] },
];

export const langPackIds: readonly LangPackId[] = ['lang.logic', 'lang.loops', 'lang.math', 'lang.text', 'lang.variables'];

/** The contract ids a profile lists for the language packs of YB-2a. */
export const langContractIds = langConstructs.map((construct) => construct.contractId);

export const intDivideType = 'ybc_int_divide';
export const arithType = 'ybc_arith';

/** a + b, a − b, a × b: the only operators this block offers. Blockly's own math_arithmetic also has ÷ and power, which are not in the dialect, so it is not used. */
export const arithDefinition: BlockDefinitionJson = {
  type: arithType,
  message0: '%1 %2 %3',
  args0: [
    { type: 'input_value', name: 'A', check: 'Number' },
    {
      type: 'field_dropdown',
      name: 'OP',
      options: [
        ['+', 'ADD'],
        ['−', 'MINUS'],
        ['×', 'MULTIPLY'],
      ],
    },
    { type: 'input_value', name: 'B', check: 'Number' },
  ],
  inputsInline: true,
  output: 'Number',
  colour: 230,
  tooltip: 'Adds, subtracts or multiplies two whole numbers.',
};

/** "a // b": floor division of two integers, Python's `//` (Blockly has no block for it). */
export const intDivideDefinition: BlockDefinitionJson = {
  type: intDivideType,
  message0: '%1 // %2',
  args0: [
    { type: 'input_value', name: 'A', check: 'Number' },
    { type: 'input_value', name: 'B', check: 'Number' },
  ],
  inputsInline: true,
  output: 'Number',
  colour: 230,
  tooltip: 'Whole-number division, rounded down (like Python //).',
};

/** `while` with a Boolean condition. Blockly's own block also offers "repeat until", which the dialect does not have. */
export const whileDefinition: BlockDefinitionJson = {
  type: whileType,
  message0: 'while %1 %2',
  args0: [
    { type: 'input_value', name: 'COND', check: 'Boolean' },
    { type: 'input_statement', name: 'DO' },
  ],
  previousStatement: null,
  nextStatement: null,
  colour: 120,
  tooltip: 'Repeats while the condition is true.',
};

/** Python's range(from, to + 1, step) with `from` and `to` evaluated once, in that order; `step` is a number typed in. */
export const countUpDefinition: BlockDefinitionJson = {
  type: countUpType,
  message0: 'count up with %1 from %2 to %3 by %4 %5',
  args0: [
    { type: 'field_variable', name: 'VAR', variable: 'i' },
    { type: 'input_value', name: 'FROM', check: 'Number' },
    { type: 'input_value', name: 'TO', check: 'Number' },
    { type: 'field_number', name: 'STEP', value: 1, min: 1, max: 1_000_000, precision: 1 },
    { type: 'input_statement', name: 'DO' },
  ],
  previousStatement: null,
  nextStatement: null,
  inputsInline: true,
  colour: 120,
  tooltip: 'Counts up from the first number to the second, in steps.',
};

/** Waits a number of milliseconds (0 to 60 000). */
export const waitDefinition: BlockDefinitionJson = {
  type: waitType,
  message0: 'wait %1 ms',
  args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
  previousStatement: null,
  nextStatement: null,
  colour: 120,
  tooltip: 'Pauses the program for some milliseconds.',
};

/** N17 B4, C-19: the whole milliseconds since the program started (in the simulator: since this run started). */
export const runningTimeDefinition: BlockDefinitionJson = {
  type: runningTimeType,
  message0: 'running time (ms)',
  output: 'Number',
  colour: 120,
  tooltip: 'The time since the program started, in whole milliseconds.',
};

/** N17 B4, C-40: a whole number from the first to the second, both included; the ends may come in either order. */
export const randomIntDefinition: BlockDefinitionJson = {
  type: randomIntType,
  message0: 'random number from %1 to %2',
  args0: [
    { type: 'input_value', name: 'FROM', check: 'Number' },
    { type: 'input_value', name: 'TO', check: 'Number' },
  ],
  inputsInline: true,
  output: 'Number',
  colour: 230,
  tooltip: 'A random whole number from the first number to the second, both included. Either may be the larger.',
};
