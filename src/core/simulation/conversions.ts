// The only place that converts between the learner scale, the UI scale and the native scale of the
// board (YB plan §11.3, YB-CP deliverable 4). Pure functions of numbers, no document, no run.
//
// C-Q6 = Option A (owner, 2026-10-14): an analog read is the NATIVE 0..4095 of the board (contract C-25);
// the UI shows 0..100 %. N17 B5 (owner, 2026-10-19): an analog WRITE is a PWM duty 0..1023 (contract C-26, its range UNVERIFIED);
// it is not an analog read's scale, and nothing converts one into the other.
//
// N18 R2.1: the scale is the board's. A board's definition names its own (`board.scale`; UNO: analogRead 0..1023, analogWrite
// 0..255) and `boardScaleOf` reads it; one that names none has the Yolo:Bit contract's, which the constants below are. The
// functions take the board's top as N (`percentToNative`, `rawToPercent`); without one they keep the Yolo:Bit scale.

/** The native range of an analog read (contract C-25). */
export const ANALOG_NATIVE_MAX = 4095;

/** NaN has no place on the scale; an infinity is just far outside it, and the clamp takes it to the end. */
function assertNumber(value: number, what: string): void {
  if (Number.isNaN(value)) {
    throw new RangeError(`${what} must be a number, got NaN`);
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The top of a native scale is a positive whole number: the contract's, or the board's data. */
function assertNativeMax(nativeMax: number): void {
  if (!Number.isInteger(nativeMax) || nativeMax < 1) {
    throw new RangeError(`The native maximum must be a positive integer, got ${String(nativeMax)}`);
  }
}

/** floor(clamp(p, 0, 100) x N / 100 + 0.5): a percentage of the native range N, rounded half up. N is a positive integer from the contract. */
export function percentToNative(percent: number, nativeMax: number): number {
  assertNumber(percent, 'A percentage');
  assertNativeMax(nativeMax);
  return Math.floor((clamp(percent, 0, 100) * nativeMax) / 100 + 0.5);
}

/** The analog read of a slider position: percentToNative(p, 4095). */
export const percentToRaw = (percent: number): number => percentToNative(percent, ANALOG_NATIVE_MAX);

/** floor(r x 100 / N + 0.5), for display only: the learner reads the native value. N is the board's top, 4095 unless given. */
export function rawToPercent(raw: number, nativeMax: number = ANALOG_NATIVE_MAX): number {
  assertNumber(raw, 'A raw reading');
  assertNativeMax(nativeMax);
  return Math.floor((clamp(raw, 0, nativeMax) * 100) / nativeMax + 0.5);
}

/** N17 B5: the top of a PWM duty, `write_analog`'s 0..1023 (contract C-26; the range is UNVERIFIED on the board). */
export const PWM_DUTY_MAX = 1023;

/** N17 B5: how bright an LED fed by a duty is, 0..1, for display only: duty / 1023, clamped. */
export function dutyToBrightness(duty: number): number {
  assertNumber(duty, 'A duty');
  return clamp(duty, 0, PWM_DUTY_MAX) / PWM_DUTY_MAX;
}
