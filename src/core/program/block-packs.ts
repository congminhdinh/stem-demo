import { deviceFamily } from '../devices/device-definition';
import { arithDefinition, arithType, countUpDefinition, countUpType, intDivideDefinition, intDivideType, waitDefinition, waitType, whileDefinition, whileType, langConstructs, langPackIds, type LangPackId } from '../constructs/lang';
import { hardwareConstructs, type HardwarePackId } from '../constructs/ybc';
import {
  clearDisplayType,
  clearPixelType,
  COLOUR_NAME,
  colourType,
  displayDefinitions,
  ICON_NAME,
  IMAGE_SIZE,
  paletteColours,
  pixelFieldName,
  scrollNumberType,
  scrollTextType,
  setAllType,
  setPixelType,
  showIconType,
  showImageType,
} from '../constructs/ybc.display';
import { buttonPressedType, buttonPressesType, inputDefinitions, lightLevelType } from '../constructs/ybc.input';
import { createPinBlockDefinitions, pinAnalogType, pinConstructs, pinReadType, pinsPackId, pinWriteType, type PinChoices } from '../constructs/ybc.pins';
import { playNoteType, restType, soundDefinitions } from '../constructs/ybc.sound';
import { usablePins } from '../devices/board-pins';
import type { DeviceRegistry } from '../devices/registry';
import {
  blockTypes,
  buildBlockDefinitions,
  builtInBlockTypes,
  toolbox as genericToolbox,
  type BlockDefinitionJson,
} from './blocks';

// Block packs (YB plan §12): a pack is the data of a group of blocks, its
// definitions and its toolbox categories. Blockly registers the union of all
// known packs once, so any stored program stays structurally loadable (L-1);
// the toolbox shown comes from the board context, a profile choosing packs by id.

export type ToolboxCategory = {
  kind: string;
  name?: string;
  colour?: string;
  contents?: readonly unknown[];
  /** A dynamic category Blockly fills itself (variables). */
  custom?: string;
};
export type Toolbox = { kind: string; contents: readonly ToolboxCategory[] };

export type BlockPack = {
  id: string;
  family: 'generic' | 'ybc';
  /** Definitions this pack registers with Blockly. Packs may share one (the hats); the definitions must then be equal. */
  blocks: readonly BlockDefinitionJson[];
  /** Every block type a project using this pack may contain: its definitions and the Blockly built-ins it uses. */
  blockTypes: readonly string[];
  categories: readonly ToolboxCategory[];
};

export const genericPackId = 'generic.stem';
export const ybcStructurePackId = 'ybc.structure';

/** The pin names of every generic board in the registry: what the generic blocks' dropdowns offer. */
export function genericBoardPins(registry: DeviceRegistry): string[] {
  const names = registry
    .list()
    .filter((definition) => deviceFamily(definition) === 'generic')
    .flatMap((definition) => definition.board?.pins.map((pin) => pin.name) ?? []);
  return [...new Set(names)];
}

/** The PoC's blocks and toolbox, untouched (GB2). */
export function createGenericPack(boardPins: readonly string[]): BlockPack {
  const definitions = buildBlockDefinitions(boardPins);
  return {
    id: genericPackId,
    family: 'generic',
    blocks: definitions,
    blockTypes: [...definitions.map((definition) => definition.type), ...Object.values(builtInBlockTypes)],
    categories: genericToolbox.contents,
  };
}

/** The program structure of a Yolo:Bit-compatible project: the two shared hats and nothing else (YB-1). */
export function createYbcStructurePack(): BlockPack {
  const hats = buildBlockDefinitions([]).filter(
    (definition) => definition.type === blockTypes.onStart || definition.type === blockTypes.forever,
  );
  return {
    id: ybcStructurePackId,
    family: 'ybc',
    blocks: hats,
    blockTypes: hats.map((hat) => hat.type),
    categories: [
      {
        kind: 'category',
        name: 'Program',
        colour: '45',
        contents: [
          { kind: 'block', type: blockTypes.onStart },
          { kind: 'block', type: blockTypes.forever },
        ],
      },
    ],
  };
}

const shadowNumber = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
const block = (type: string, extra: Record<string, unknown> = {}) => ({ kind: 'block', type, ...extra });
const arithmetic = (op: string) => block(arithType, { fields: { OP: op }, inputs: { A: shadowNumber(1), B: shadowNumber(1) } });

/** What each language pack shows in the toolbox. */
const langCategories: Readonly<Record<LangPackId, ToolboxCategory[]>> = {
  'lang.logic': [
    {
      kind: 'category',
      name: 'Logic',
      colour: '210',
      contents: [
        block('controls_if'),
        block('controls_if', { extraState: { hasElse: true } }),
        block('logic_compare'),
        block('logic_operation', { fields: { OP: 'AND' } }),
        block('logic_operation', { fields: { OP: 'OR' } }),
        block('logic_negate'),
        block('logic_boolean', { fields: { BOOL: 'TRUE' } }),
        block('logic_boolean', { fields: { BOOL: 'FALSE' } }),
      ],
    },
  ],
  'lang.loops': [
    {
      kind: 'category',
      name: 'Loops',
      colour: '120',
      contents: [
        block('controls_repeat_ext', { inputs: { TIMES: shadowNumber(10) } }),
        block(whileType),
        block(countUpType, { inputs: { FROM: shadowNumber(1), TO: shadowNumber(10) } }),
      ],
    },
    {
      kind: 'category',
      name: 'Time',
      colour: '120',
      contents: [block(waitType, { inputs: { MS: shadowNumber(1000) } })],
    },
  ],
  'lang.math': [
    {
      kind: 'category',
      name: 'Math',
      colour: '230',
      contents: [
        block('math_number', { fields: { NUM: 0 } }),
        arithmetic('ADD'),
        arithmetic('MINUS'),
        arithmetic('MULTIPLY'),
        block(intDivideType, { inputs: { A: shadowNumber(7), B: shadowNumber(2) } }),
        block('math_modulo', { inputs: { DIVIDEND: shadowNumber(7), DIVISOR: shadowNumber(2) } }),
      ],
    },
  ],
  'lang.text': [
    {
      kind: 'category',
      name: 'Text',
      colour: '160',
      contents: [
        block('text'),
      block('text_join'),
        block('text_print', { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'abc' } } } } }),
      ],
    },
  ],
  // Blockly's own dynamic category: "Create variable…", set and get. The panel replaces its
  // callback to drop the extra blocks Blockly adds (change by) that the dialect does not have.
  'lang.variables': [{ kind: 'category', name: 'Variables', colour: '330', custom: 'VARIABLE' }],
};

const langBlocks: Readonly<Record<LangPackId, BlockDefinitionJson[]>> = {
  'lang.logic': [],
  'lang.loops': [whileDefinition, countUpDefinition, waitDefinition],
  'lang.math': [arithDefinition, intDivideDefinition],
  'lang.text': [],
  'lang.variables': [],
};

/** The language packs of YB-2a: Blockly's own blocks, plus `ybc_arith` and `ybc_int_divide`, whose operators the dialect fixes. */
export function createLangPacks(): BlockPack[] {
  return langPackIds.map((id) => ({
    id,
    family: 'ybc',
    blocks: langBlocks[id],
    blockTypes: langConstructs.filter((construct) => construct.pack === id).flatMap((construct) => construct.blockTypes),
    categories: langCategories[id],
  }));
}

/** The picture the "show image" block of the toolbox starts with: a ring of lights (the contract's own sample, §18). */
const ringImage = ['11111', '10001', '10001', '10001', '11111'];
const ringFields = Object.fromEntries(
  ringImage.flatMap((rowDigits, row) =>
    Array.from({ length: IMAGE_SIZE }, (_, column) => [pixelFieldName(row, column), rowDigits[column] === '1'] as const),
  ),
);

/** A colour input filled with the colour block (N17 B1), red unless said otherwise: the learner picks another in its dropdown. */
const shadowColour = (value: string = paletteColours[0].value) => ({ [COLOUR_NAME]: { shadow: { type: colourType, fields: { [COLOUR_NAME]: value } } } });

/** What each hardware pack shows in the toolbox (YB-3; the RGB display of N17 B1 after the four blocks of YB-3). */
const hardwareCategories: Readonly<Record<HardwarePackId, ToolboxCategory[]>> = {
  'ybc.display': [
    {
      kind: 'category',
      name: 'Display',
      colour: '290',
      contents: [
        block(showImageType, { fields: { ...ringFields, [COLOUR_NAME]: paletteColours[0].value } }),
        block(showIconType, { fields: { [ICON_NAME]: 'HEART' } }),
        block(scrollTextType, { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hi' } } }, ...shadowColour() } }),
        block(scrollNumberType, { inputs: { NUM: shadowNumber(0), ...shadowColour() } }),
        block(clearDisplayType),
        block(setPixelType, { inputs: { X: shadowNumber(2), Y: shadowNumber(2), ...shadowColour('#00ff00') } }),
        block(clearPixelType, { inputs: { X: shadowNumber(2), Y: shadowNumber(2) } }),
        block(setAllType, { inputs: shadowColour('#0000ff') }),
        block(colourType, { fields: { [COLOUR_NAME]: paletteColours[0].value } }),
      ],
    },
  ],
  'ybc.input': [
    {
      kind: 'category',
      name: 'Input',
      colour: '20',
      contents: [
        block(buttonPressedType, { fields: { BUTTON: 'A' } }),
        block(buttonPressedType, { fields: { BUTTON: 'B' } }),
        block(buttonPressesType, { fields: { BUTTON: 'A' } }),
        block(buttonPressesType, { fields: { BUTTON: 'B' } }),
        block(lightLevelType),
      ],
    },
  ],
  'ybc.sound': [
    {
      kind: 'category',
      name: 'Sound',
      colour: '180',
      contents: [block(playNoteType, { fields: { NOTE: 'C4', TICKS: '4' } }), block(restType, { fields: { TICKS: '4' } })],
    },
  ],
};

const hardwareBlocks: Readonly<Record<HardwarePackId, BlockDefinitionJson[]>> = {
  'ybc.display': [...displayDefinitions],
  'ybc.input': [...inputDefinitions],
  'ybc.sound': [...soundDefinitions],
};

/** The onboard hardware packs of YB-3: display, buttons and light, sound. */
export function createHardwarePacks(): BlockPack[] {
  return (Object.keys(hardwareBlocks) as HardwarePackId[]).map((id) => ({
    id,
    family: 'ybc',
    blocks: hardwareBlocks[id],
    blockTypes: hardwareConstructs.filter((construct) => construct.pack === id).flatMap((construct) => construct.blockTypes),
    categories: hardwareCategories[id],
  }));
}

/** The pins each pin block offers: those the Yolo:Bit-compatible boards of the registry allow (reserved ones left out). */
export function ybcPinChoices(registry: DeviceRegistry): PinChoices {
  const boards = registry.list().filter((definition) => deviceFamily(definition) === 'ybc' && definition.board !== undefined);
  const names = (capability: 'digital' | 'analogIn') => [...new Set(boards.flatMap((definition) => usablePins(definition, capability)))];
  return { digital: names('digital'), analogIn: names('analogIn') };
}

/** The header pins of a Yolo:Bit-compatible project (YB-4): write, digital read and analog read of P0–P2. */
export function createYbcPinsPack(choices: PinChoices): BlockPack {
  return {
    id: pinsPackId,
    family: 'ybc',
    blocks: createPinBlockDefinitions(choices),
    blockTypes: pinConstructs.flatMap((construct) => construct.blockTypes),
    categories: [
      {
        kind: 'category',
        name: 'Pins',
        colour: '210',
        contents: [block(pinWriteType), block(pinReadType), block(pinAnalogType)],
      },
    ],
  };
}

export type BlockPackCatalog = {
  list(): readonly BlockPack[];
  get(id: string): BlockPack | undefined;
  /** One definition per block type over every known pack: what Blockly registers. */
  definitions(): BlockDefinitionJson[];
  /** The block types of the given packs. An unknown pack id is a programmer error and throws. */
  typesOf(packIds: readonly string[]): Set<string>;
  /** Whether some known pack owns the block type (Blockly built-ins that no pack lists are not known). */
  isKnown(blockType: string): boolean;
};

/**
 * The production packs, plus `extraPacks` (tests inject fixture packs here,
 * YB plan §8.7; production code never passes any).
 */
export function createBlockPackCatalog(
  registry: DeviceRegistry,
  extraPacks: readonly BlockPack[] = [],
): BlockPackCatalog {
  const packs = [
    createGenericPack(genericBoardPins(registry)),
    createYbcStructurePack(),
    ...createHardwarePacks(),
    createYbcPinsPack(ybcPinChoices(registry)),
    ...createLangPacks(),
    ...extraPacks,
  ];
  const byId = new Map<string, BlockPack>();
  for (const pack of packs) {
    if (byId.has(pack.id)) {
      throw new Error(`Duplicate block pack "${pack.id}"`);
    }
    byId.set(pack.id, pack);
  }

  const byType = new Map<string, BlockDefinitionJson>();
  for (const pack of packs) {
    for (const definition of pack.blocks) {
      const known = byType.get(definition.type);
      if (known && JSON.stringify(known) !== JSON.stringify(definition)) {
        throw new Error(`Block "${definition.type}" is defined differently by two packs`);
      }
      byType.set(definition.type, definition);
    }
  }
  const knownTypes = new Set(packs.flatMap((pack) => pack.blockTypes));

  return {
    list: () => packs,
    get: (id) => byId.get(id),
    definitions: () => [...byType.values()],
    typesOf(packIds) {
      return new Set(
        packIds.flatMap((id) => {
          const pack = byId.get(id);
          if (!pack) {
            throw new Error(`Unknown block pack "${id}"`);
          }
          return pack.blockTypes;
        }),
      );
    },
    isKnown: (blockType) => knownTypes.has(blockType),
  };
}

/** The toolbox of the packs a board context shows, in that order. */
export function buildToolbox(packIds: readonly string[], catalog: BlockPackCatalog): Toolbox {
  return {
    kind: 'categoryToolbox',
    contents: packIds.flatMap((id) => {
      const pack = catalog.get(id);
      if (!pack) {
        throw new Error(`Unknown block pack "${id}"`);
      }
      return pack.categories;
    }),
  };
}
