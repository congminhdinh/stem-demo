import type { UnoCallOp, UnoReadOp } from '../program/ybc-ir';
import type { RobotRole } from '../hardware/kit';
import { driveConstructs } from './uno.drive';
import { advancedOutputConstructs, outputConstructs } from './uno.output';
import { pinConstructs } from './uno.pins';
import { advancedSensorConstructs, sensorConstructs } from './uno.sensors';
import { servoConstructs } from './uno.servo';

// The constructs of the UNO-compatible dialect of the robot lab (N18 R2.2, docs/uno-compatibility-contract.md §10, §11): which block
// types realise which row of the UNO contract, in which block pack. A profile exposes a row by listing its id (uno-basic.json,
// uno-advanced.json), and every row it lists passes the exposure gate of the UNO contract (uno.test.ts); the contract is test data,
// never imported here.
//
// The language rows (U-01…U-18) are the blocks of the Yolo:Bit dialect, in packs of the uno family that leave out what the UNO
// contract does not open (random numbers U-45, the running time: U-19 is the board's millis, Advanced). The module rows are the
// files uno.drive, uno.sensors, uno.servo, uno.output and uno.pins: one block per row, one IR op per block (robot plan §4.4).

export type UnoPackId =
  | 'uno.structure'
  | 'uno.drive'
  | 'uno.sensors'
  | 'uno.servo'
  | 'uno.output'
  | 'uno.logic'
  | 'uno.loops'
  | 'uno.math'
  | 'uno.text'
  | 'uno.variables'
  | 'uno.sensors.advanced'
  | 'uno.output.advanced'
  | 'uno.pins';

export type UnoConstruct = { contractId: string; pack: UnoPackId; blockTypes: readonly string[] };

/** A module row: its one block, the IR op it compiles to, and the roles of the vocabulary its block can name. */
export type UnoModuleConstruct = UnoConstruct & {
  op: UnoCallOp | UnoReadOp;
  /** The options of the block's role dropdown, or the one role it is about; none for the drive, a raw pin and millis. */
  roles: readonly RobotRole[];
  /** Whether the block names its role in a dropdown (the ROLE field); otherwise it is about its one role. */
  roleField: boolean;
};

/**
 * The language of both profiles (contract UNO U-01…U-18). U-08 (negate) has no block of its own: a negative number is typed into a
 * number block, and `neg32` is what the generator writes for the −s of the drive (U-21).
 */
export const unoLangConstructs: readonly UnoConstruct[] = [
  { contractId: 'U-01', pack: 'uno.structure', blockTypes: ['stem_on_start'] },
  { contractId: 'U-02', pack: 'uno.structure', blockTypes: ['stem_forever'] },
  { contractId: 'U-03', pack: 'uno.variables', blockTypes: ['variables_get', 'variables_set'] },
  { contractId: 'U-04', pack: 'uno.math', blockTypes: ['math_number'] },
  { contractId: 'U-05', pack: 'uno.math', blockTypes: ['ybc_arith'] },
  { contractId: 'U-06', pack: 'uno.math', blockTypes: ['ybc_int_divide'] },
  { contractId: 'U-07', pack: 'uno.math', blockTypes: ['math_modulo'] },
  { contractId: 'U-08', pack: 'uno.math', blockTypes: [] },
  { contractId: 'U-09', pack: 'uno.logic', blockTypes: ['logic_compare'] },
  { contractId: 'U-10', pack: 'uno.logic', blockTypes: ['logic_operation', 'logic_negate', 'logic_boolean'] },
  { contractId: 'U-11', pack: 'uno.logic', blockTypes: ['controls_if'] },
  { contractId: 'U-12', pack: 'uno.loops', blockTypes: ['controls_repeat_ext'] },
  { contractId: 'U-13', pack: 'uno.loops', blockTypes: ['ybc_while'] },
  { contractId: 'U-14', pack: 'uno.loops', blockTypes: ['ybc_count_up'] },
  { contractId: 'U-15', pack: 'uno.text', blockTypes: ['text_print'] },
  { contractId: 'U-16', pack: 'uno.text', blockTypes: ['text'] },
  { contractId: 'U-17', pack: 'uno.text', blockTypes: ['text_join'] },
  { contractId: 'U-18', pack: 'uno.loops', blockTypes: ['ybc_wait_ms'] },
];

/** The module rows: drive, sensors, servo, light and sound of both profiles; the raw line value, buzzer stop and raw pins of Advanced. */
export const unoModuleConstructs: readonly UnoModuleConstruct[] = [
  ...driveConstructs,
  ...sensorConstructs,
  ...servoConstructs,
  ...outputConstructs,
  ...advancedSensorConstructs,
  ...advancedOutputConstructs,
  ...pinConstructs,
];

export const unoConstructs: readonly UnoConstruct[] = [...unoLangConstructs, ...unoModuleConstructs];

/** The packs of the uno family, in toolbox order: Basic's, then what Advanced adds. */
export const unoPackIds: readonly UnoPackId[] = [
  'uno.structure',
  'uno.drive',
  'uno.sensors',
  'uno.servo',
  'uno.output',
  'uno.logic',
  'uno.loops',
  'uno.math',
  'uno.text',
  'uno.variables',
  'uno.sensors.advanced',
  'uno.output.advanced',
  'uno.pins',
];

/** The block types a pack owns: those of its constructs. */
export const unoBlockTypesOf = (pack: UnoPackId): string[] => unoConstructs.filter((construct) => construct.pack === pack).flatMap((construct) => construct.blockTypes);

const byBlockType = new Map(unoModuleConstructs.flatMap((construct) => construct.blockTypes.map((type) => [type, construct] as const)));

/** The module construct a block type belongs to, or undefined for any other block. A Map: block types are data. */
export const unoModuleConstructOf = (blockType: string): UnoModuleConstruct | undefined => byBlockType.get(blockType);
