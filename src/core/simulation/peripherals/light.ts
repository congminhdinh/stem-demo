import type { LightIO } from '../../capabilities/io';
import { percentToNative } from '../conversions';
import type { ComponentInput } from '../simulate-circuit';

// The onboard light sensor (contract C-15): `light_level()` is an int from 0 (darkest) to 100 (brightest),
// "as the tooltip states, not from the widget". The control is a slider of 0–100 %, and the scale of the
// board is the same 0..100, so the reading is `percentToNative(p, 100)` of the frozen conversions: the
// clamp and the rounding of the board live there, not here.

/** The native range of `light_level()`. */
export const LIGHT_LEVEL_MIN = 0;
export const LIGHT_LEVEL_MAX = 100;

/**
 * Where a run starts before the learner touches the slider: half way. The contract says nothing about it (the
 * reading of a sensor is the environment's, not the board's), so this is a choice of the virtual environment.
 */
export const LIGHT_LEVEL_INITIAL = 50;

export function createLightIO(read: () => ComponentInput | undefined): LightIO {
  return {
    lightLevel() {
      const input = read();
      return percentToNative(input?.kind === 'slider' ? input.value : LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX);
    },
  };
}
