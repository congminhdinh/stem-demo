// Block definitions and toolbox are plain data (plan §5.1 B4): the Blockly
// panel registers them, the compiler reads the JSON they produce. Nothing
// here imports Blockly.

export const blockTypes = {
  onStart: 'stem_on_start',
  forever: 'stem_forever',
  digitalWrite: 'stem_digital_write',
  wait: 'stem_wait',
} as const;

/** JSON accepted by `Blockly.common.defineBlocksWithJsonArray`. */
export type BlockDefinitionJson = { type: string } & Record<string, unknown>;

const hatArgs = [
  { type: 'input_dummy' },
  { type: 'input_statement', name: 'DO' },
];

/** Pin dropdown options come from the board profile, never from the block itself. */
export function buildBlockDefinitions(boardPins: readonly string[]): BlockDefinitionJson[] {
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
        { type: 'field_dropdown', name: 'PIN', options: boardPins.map((pin) => [pin, pin]) },
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
      contents: [{ kind: 'block', type: blockTypes.digitalWrite }],
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
