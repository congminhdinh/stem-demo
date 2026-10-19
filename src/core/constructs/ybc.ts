import type { CapabilityKey } from '../capabilities/io';
import { displayConstructs } from './ybc.display';
import { inputConstructs, sensorConstructs } from './ybc.input';
import { soundConstructs } from './ybc.sound';

// The hardware constructs of the Yolo:Bit-compatible dialect (YB plan §9.4, §12): which block types
// realise which row of the contract, and which capability of the board a block needs. YB-3 owns the
// onboard parts (display, buttons, light, sound), N17 B2 adds the sensors of the Advanced board (temperature,
// accelerometer, gestures) in a pack of their own; the header pins (YB-4) are not here. A profile exposes
// a construct by listing its contract id, and a construct is only ever shown if that row passes the
// exposure gate (see the tests of each construct file and `profile.test.ts`).

export type HardwarePackId = 'ybc.display' | 'ybc.input' | 'ybc.sound' | 'ybc.sensors';

export type HardwareConstruct = {
  contractId: string;
  pack: HardwarePackId;
  blockTypes: readonly string[];
  /** The capability of the board the construct reaches (plan §10): a board without it cannot run the block (`capability-unavailable`). */
  capability: CapabilityKey;
};

export const hardwarePackIds: readonly HardwarePackId[] = ['ybc.display', 'ybc.input', 'ybc.sound', 'ybc.sensors'];

export const hardwareConstructs: readonly HardwareConstruct[] = [...displayConstructs, ...inputConstructs, ...soundConstructs, ...sensorConstructs];

/** The contract ids a profile lists for the onboard hardware of YB-3. */
export const hardwareContractIds = hardwareConstructs.map((construct) => construct.contractId);

const byBlockType = new Map(hardwareConstructs.flatMap((construct) => construct.blockTypes.map((type) => [type, construct] as const)));

/** The hardware construct a block type belongs to, or undefined for any other block. A Map: block types are data. */
export const hardwareConstructOf = (blockType: string): HardwareConstruct | undefined => byBlockType.get(blockType);
