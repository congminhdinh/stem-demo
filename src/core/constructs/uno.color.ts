import { COLOR_CHANNELS, COLOR_NAMES, COLOR_RAW_MAX, type ColorChannel, type ColorName } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';

// The colour sensor constructs of the robot (N19 A4, plan §4.3, D-G7, D-G11):
//
//   U-38  colour is   object colour is [red|green|blue|yellow|white|black|unknown]?   color.is(color1, colour)   bool
//   U-39  raw colour  colour sensor [red|green|blue|clear] raw value                   color.raw(color1, channel) 0..21504 (Advanced)
//
// `uno.color` is a pack of both profiles, `uno.color.advanced` of Advanced only. The sensor reads the light of the last integration
// window (52.8 ms each, ATIME 0xEB) and the driver sorts it by COLOR_RULES: no sensor, or too little light, is "unknown". Both read the
// bus, about 1.2 ms.

export const colorPackId = 'uno.color';
export const advancedColorPackId = 'uno.color.advanced';

export const colorIsType = 'uno_color_is';
export const colorRawType = 'uno_color_raw';

/** The fields of the two blocks: the colour asked about, the channel read. The values saved are the names. */
export const COLOR_FIELD = 'COLOR';
export const CHANNEL_FIELD = 'CHANNEL';

/** The colour sensor of the role vocabulary (plan §4.2). */
export const colorRoles: readonly RobotRole[] = ['color1'];

/** U-39: a channel's count, 0..21504 at the driver's ATIME (the board's answer is checked against it). */
export const COLOR_RAW_RANGE: readonly [min: number, max: number] = [0, COLOR_RAW_MAX];

const colorLabels: Readonly<Record<ColorName, string>> = {
  red: 'red',
  green: 'green',
  blue: 'blue',
  yellow: 'yellow',
  white: 'white',
  black: 'black',
  unknown: 'unknown',
};
const channelLabels: Readonly<Record<ColorChannel, string>> = { red: 'red', green: 'green', blue: 'blue', clear: 'clear' };

export const colorConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-38', pack: colorPackId, blockTypes: [colorIsType], op: 'color.is', roles: colorRoles, roleField: false },
];

export const advancedColorConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-39', pack: advancedColorPackId, blockTypes: [colorRawType], op: 'color.raw', roles: colorRoles, roleField: false },
];

export const colorDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: colorIsType,
    message0: 'object colour is %1 ?',
    args0: [{ type: 'field_dropdown', name: COLOR_FIELD, options: COLOR_NAMES.map((name) => [colorLabels[name], name]) }],
    output: 'Boolean',
    colour: 195,
    tooltip: 'True when the colour sensor sees an object of this colour. With nothing in front of it, it sees "unknown".',
  },
];

export const advancedColorDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: colorRawType,
    message0: 'colour sensor %1 raw value',
    args0: [{ type: 'field_dropdown', name: CHANNEL_FIELD, options: COLOR_CHANNELS.map((channel) => [channelLabels[channel], channel]) }],
    output: 'Number',
    colour: 195,
    tooltip: `The colour sensor's count for one channel in its last reading, 0 to ${COLOR_RAW_MAX}.`,
  },
];
