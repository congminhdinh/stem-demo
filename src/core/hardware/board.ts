// The board profile (N18 R1.1, robot plan §4.1): the facts of a microcontroller board that the virtual UNO, the pin rules and
// the drivers read. Every value is data (`uno-r3.board.json`, validated by board-schema.ts), never a literal type, so a vendor
// board is a new JSON file. The numbers of uno-r3 are the UNO compatibility contract's (docs/uno-compatibility-contract.md
// §4.4, §5), measured in the R0.4 avr8js spike; hardware-contract.test.ts pins them to the contract's data, which production
// code never imports.
//
// Pin capabilities name only what a source establishes. uno-r3 lists `serial` on D0/D1 (contract §5.2, ARD-07) and no
// `interrupt`, `i2c` or `spi` yet: those wait for their contract rows (U-43 interrupts and U-46 I²C are DEFERRED).

export const pinCaps = ['digital', 'pwm', 'analogIn', 'interrupt', 'i2c', 'serial', 'spi'] as const;
export type PinCap = (typeof pinCaps)[number];

/**
 * The Arduino calls the virtual UNO charges, in µs (contract §4.4). The same keys, in the same order, as the contract's
 * `arduinoCalls`; hardware-contract.test.ts checks it.
 */
export const arduinoCalls = [
  'pinMode',
  'pinModeInputPullup',
  'digitalWrite',
  'digitalWriteTimerPin',
  'digitalRead',
  'digitalReadTimerPin',
  'analogRead',
  'analogReadFirst',
  'analogWrite',
  'analogWriteDigital',
  'millis',
  'delayOverhead',
  'servoWrite',
  'tone',
  'noTone',
  'pulseInAfterPulse',
  'pulseInNoPulse30000',
  'ultrasonicCmOverhead',
  'ultrasonicCmNoEcho',
  'serialWriteByte',
  'serialQueueByte',
  'serialLineByte',
  'serialPrintLongBase',
  'serialPrintLongDigit',
  'serialPrintLongSign',
  'serialPrintln',
] as const;
export type ArduinoCall = (typeof arduinoCalls)[number];

/** µs per Arduino call: the shortest of the measured samples of a call the compiler did not fold (contract §4.4). */
export type CostsUs = Readonly<Record<ArduinoCall, number>>;

export type BoardPin = {
  /** The header name: `D5`, `A0`. */
  readonly id: string;
  readonly caps: readonly PinCap[];
  /** The timer that makes this pin's PWM; a pin has one exactly when it has `pwm`. */
  readonly pwmTimer?: string;
};

export type BoardProfile = {
  readonly id: string;
  readonly version: string;
  readonly mcu: string;
  readonly clockHz: number;
  /** analogRead gives 0..adcMax. */
  readonly adcMax: number;
  /** analogWrite takes 0..pwmMax. */
  readonly pwmMax: number;
  /** analogWrite on a pin without PWM: a value from this one up drives HIGH, below it LOW (contract §5.1, EMU-06). */
  readonly nonPwmThreshold: number;
  /** In board (header) order. */
  readonly pins: readonly BoardPin[];
  /** Pins a program must leave alone in a given case: D0/D1 while it prints (contract §5.2). */
  readonly reserved: readonly { readonly pin: string; readonly when: 'serial' }[];
  /** What takes a timer away from PWM: `servo` (the Servo library) and `tone` (contract §5.3). */
  readonly timerClaims: Readonly<Record<string, string>>;
  readonly costsUs: CostsUs;
  /**
   * millis() as the board computes it (contract §4.3, EMU-12): with t the µs since setup() began, n = floor(t / overflowUs),
   * millis = n + floor(fractPerOverflow · n / fractMax).
   */
  readonly millis: { readonly overflowUs: number; readonly fractPerOverflow: number; readonly fractMax: number };
  /** Present when the board's programs can be checked against an emulator (C2 applies). */
  readonly emulator?: 'avr8js';
};

export function boardPin(board: BoardProfile, id: string): BoardPin | undefined {
  return board.pins.find((pin) => pin.id === id);
}

export function hasCap(board: BoardProfile, id: string, cap: PinCap): boolean {
  return boardPin(board, id)?.caps.includes(cap) ?? false;
}

/** The PWM pins, in board order. */
export function pwmPins(board: BoardProfile): string[] {
  return board.pins.filter((pin) => pin.caps.includes('pwm')).map((pin) => pin.id);
}

/** The timer of a PWM pin; undefined for a pin without PWM or not on the board. */
export function timerOf(board: BoardProfile, id: string): string | undefined {
  return boardPin(board, id)?.pwmTimer;
}

/** The pins reserved in `when`. */
export function reservedPins(board: BoardProfile, when: 'serial'): string[] {
  return board.reserved.filter((entry) => entry.when === when).map((entry) => entry.pin);
}
