// Block definitions and toolbox are plain data (plan §5.1 B4): the Blockly
// panel registers them, the compiler reads the JSON they produce. Nothing
// here imports Blockly.

export const blockTypes = {
  onStart: 'stem_on_start',
  forever: 'stem_forever',
  digitalWrite: 'stem_digital_write',
  digitalRead: 'stem_digital_read',
  wait: 'stem_wait',
} as const;

/**
 * Blockly's own blocks the toolbox offers (plan §3.3). Blockly defines them
 * (`blockly/blocks`); the compiler reads their JSON like any other block.
 */
export const builtInBlockTypes = {
  /** if / else if / else; the else-if count and the else are its `extraState`. */
  if: 'controls_if',
  not: 'logic_negate',
} as const;

/** JSON accepted by `Blockly.common.defineBlocksWithJsonArray`. */
export type BlockDefinitionJson = { type: string } & Record<string, unknown>;

const hatArgs = [
  { type: 'input_dummy' },
  { type: 'input_statement', name: 'DO' },
];

/** Pin dropdown options come from the board profile, never from the block itself. */
export function buildBlockDefinitions(boardPins: readonly string[]): BlockDefinitionJson[] {
  const pinDropdown = { type: 'field_dropdown', name: 'PIN', options: boardPins.map((pin) => [pin, pin]) };
  return [
    {
      type: blockTypes.onStart,
      message0: 'on start %1 %2',
      args0: hatArgs,
      colour: 45,
      tooltip: 'Runs once when the program starts.',
    },
    {
      type: blockTypes.forever,
      message0: 'forever %1 %2',
      args0: hatArgs,
      colour: 45,
      tooltip: 'Repeats until the program is stopped.',
    },
    {
      type: blockTypes.digitalWrite,
      message0: 'digital write %1 %2',
      args0: [
        pinDropdown,
        {
          type: 'field_dropdown',
          name: 'LEVEL',
          options: [
            ['HIGH', 'HIGH'],
            ['LOW', 'LOW'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: 'Sets a digital pin HIGH or LOW.',
    },
    {
      type: blockTypes.digitalRead,
      message0: 'digital read %1',
      args0: [pinDropdown],
      // Boolean, so it fits the conditions of "if" and "not".
      output: 'Boolean',
      colour: 210,
      tooltip: 'True while the pin reads HIGH.',
    },
    {
      type: blockTypes.wait,
      message0: 'wait %1 seconds',
      args0: [{ type: 'field_number', name: 'SECONDS', value: 1, min: 0 }],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
      tooltip: 'Pauses the program.',
    },
  ];
}

export const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Events',
      colour: '45',
      contents: [
        { kind: 'block', type: blockTypes.onStart },
        { kind: 'block', type: blockTypes.forever },
      ],
    },
    {
      kind: 'category',
      name: 'Pins',
      colour: '210',
      contents: [
        { kind: 'block', type: blockTypes.digitalWrite },
        { kind: 'block', type: blockTypes.digitalRead },
      ],
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '210',
      contents: [
        { kind: 'block', type: builtInBlockTypes.if },
        // The same block with its else already added, so if/else needs no mutator.
        { kind: 'block', type: builtInBlockTypes.if, extraState: { hasElse: true } },
        { kind: 'block', type: builtInBlockTypes.not },
      ],
    },
    {
      kind: 'category',
      name: 'Time',
      colour: '120',
      contents: [{ kind: 'block', type: blockTypes.wait }],
    },
  ],
};

/**
 * The program of a new project: an empty `on start` and an empty `forever`,
 * as Blockly serialization JSON (what the document stores).
 */
export function createDefaultProgram() {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: blockTypes.onStart, id: 'on-start', x: 40, y: 40 },
        { type: blockTypes.forever, id: 'forever', x: 40, y: 220 },
      ],
    },
  };
}
