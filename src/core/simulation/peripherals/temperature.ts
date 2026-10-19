import type { TemperatureIO } from '../../capabilities/io';
import type { ComponentInput } from '../simulate-circuit';

// The onboard temperature sensor (contract C-16, N17 B2): `int(temperature())` is whole degrees Celsius. The control is a slider
// of −10..50 °C in steps of 1: the contract's supported domain, a choice of the virtual environment and not a physical range of
// the board. A run starts at 25 °C, a room, before the learner moves it (plan N17, Global Constraints).

export const TEMPERATURE_MIN = -10;
export const TEMPERATURE_MAX = 50;
export const TEMPERATURE_INITIAL = 25;

/** Whole degrees in −10..50 from the slider's input; the initial 25 °C without one, or for one that is not a number. */
export function temperatureOf(input: ComponentInput | undefined): number {
  if (input?.kind !== 'slider' || Number.isNaN(input.value)) {
    return TEMPERATURE_INITIAL;
  }
  // `+ 0` turns a rounded −0 into 0.
  return Math.round(Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, input.value))) + 0;
}

export function createTemperatureIO(read: () => ComponentInput | undefined): TemperatureIO {
  return {
    temperature: () => temperatureOf(read()),
  };
}
