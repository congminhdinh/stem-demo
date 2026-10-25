// What a generated sketch says it was made for (N18 C1, as yolobit/target.ts): the board's FQBN and the UNO contract it follows.
// The values are written here, not read from `compat/uno-contract.ts`, so that the large contract data stays out of the app bundle;
// generate.constructs.test.ts keeps them equal to the contract's.

export type ArduinoTarget = { readonly id: 'arduino-avr'; readonly fqbn: string; readonly contract: string; readonly contractVersion: string };

export const arduinoTarget: ArduinoTarget = { id: 'arduino-avr', fqbn: 'arduino:avr:uno', contract: 'uno-arduino-avr', contractVersion: '0.1.4' };
