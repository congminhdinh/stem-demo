import type { BlockDefinitionJson } from '../program/blocks';

// The language blocks of the uno family whose meaning on the UNO is not the Yolo:Bit dialect's (N18 R2.2, contract UNO §3):
//
//   U-06  divide     (a) / (b)                           C++ division of two longs: the fraction dropped toward zero (-7 / 2 is -3)
//   U-14  count up   count up with [i] from (a) to (b)   by 1, always (`_c += 1L`): there is no step to choose
//
// They compile to the same IR as the dialect's `ybc_int_divide` and `ybc_count_up` (the `//` node, `countUp` with step 1), whose
// texts say Python's floor division and offer a step up to 1 000 000; the uno packs show these instead. The compiler still reads the
// dialect's blocks in the uno family (the R2.3 language tests compile them), but no uno profile shows them.

export const unoIntDivideType = 'uno_int_divide';
export const unoCountUpType = 'uno_count_up';

/** U-06: `div32(a, b)`, truncating toward zero; a division by zero gives 0 and warns. */
export const unoIntDivideDefinition: BlockDefinitionJson = {
  type: unoIntDivideType,
  message0: '%1 / %2',
  args0: [
    { type: 'input_value', name: 'A', check: 'Number' },
    { type: 'input_value', name: 'B', check: 'Number' },
  ],
  inputsInline: true,
  output: 'Number',
  colour: 230,
  tooltip: 'Whole-number division, as the board does it: the fraction is dropped toward zero (-7 / 2 is -3). Dividing by 0 gives 0.',
};

/** U-14: `start` then `end`, each once, then by 1 up to `end` (at most 2147483646). */
export const unoCountUpDefinition: BlockDefinitionJson = {
  type: unoCountUpType,
  message0: 'count up with %1 from %2 to %3 %4',
  args0: [
    { type: 'field_variable', name: 'VAR', variable: 'i' },
    { type: 'input_value', name: 'FROM', check: 'Number' },
    { type: 'input_value', name: 'TO', check: 'Number' },
    { type: 'input_statement', name: 'DO' },
  ],
  previousStatement: null,
  nextStatement: null,
  inputsInline: true,
  colour: 120,
  tooltip: 'Counts up by 1 from the first number to the second.',
};
