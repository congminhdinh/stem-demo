import type { Rgbc } from './tcs34725-model.ts';

// COLOR_RULES (N19 plan §4.3, D-G7): one integer table that classifies a TCS34725 reading, shared by the simulator (TS) and the
// generated sketch (C++, `colorRulesCpp` writes the table the sketch carries; spikes/avr8js/run-gripper-forms.ts checks that the
// sketch's copy is this one). Task A3 moves it to the tcs34725-wire driver. Thresholds are PLACEHOLDER data, tied to the driver's
// version, until a real kit is measured (VG/L3).
//
// Per-mille of each colour channel over r + g + b, integer division (truncation, as C++ does with unsigned long); the first rule
// whose clear count and three per-mille are all inside its bounds (inclusive) wins; none → unknown.

export const COLOR_NAMES = ['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export const COLOR_UNKNOWN = 6;

/** [colour, cMin, cMax, rMin, rMax, gMin, gMax, bMin, bMax]: bounds inclusive, C in counts, r g b in per-mille. */
export type ColorRule = readonly [number, number, number, number, number, number, number, number, number];

const ANY_C = 65535;
const ANY = 1000;
export const COLOR_RULES: readonly ColorRule[] = [
  [6, 0, 299, 0, ANY, 0, ANY, 0, ANY], // C < 300: too little light (no object, no sensor, NACK)
  [0, 0, ANY_C, 500, ANY, 0, 299, 0, ANY], // red: r ≥ 500, g < 300
  [1, 0, ANY_C, 0, 329, 420, ANY, 0, ANY], // green: g ≥ 420, r < 330
  [2, 0, ANY_C, 0, 299, 0, ANY, 420, ANY], // blue: b ≥ 420, r < 300
  [4, 12000, ANY_C, 0, 419, 0, ANY, 230, ANY], // white: C ≥ 12000, b ≥ 230, r < 420
  [3, 0, ANY_C, 380, ANY, 330, ANY, 0, 229], // yellow: r ≥ 380, g ≥ 330, b < 230
  [5, 0, 3999, 0, ANY, 0, ANY, 0, ANY], // black: C < 4000
];

/** floor(a / b) for non-negative safe integers, exact. */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) {
    q -= 1;
  }
  while ((q + 1) * b <= a) {
    q += 1;
  }
  return q;
}

/** r, g, b per mille of r + g + b (all 0 when the sum is 0). */
export function perMille(reading: Rgbc): { r: number; g: number; b: number } {
  const sum = reading.r + reading.g + reading.b;
  if (sum === 0) {
    return { r: 0, g: 0, b: 0 };
  }
  return { r: floorDiv(reading.r * 1000, sum), g: floorDiv(reading.g * 1000, sum), b: floorDiv(reading.b * 1000, sum) };
}

/** The colour index of a reading: 0 red, 1 green, 2 blue, 3 yellow, 4 white, 5 black, 6 unknown. */
export function classifyColor(reading: Rgbc): number {
  const share = perMille(reading);
  const inside = (value: number, min: number, max: number) => value >= min && value <= max;
  for (const [colour, cMin, cMax, rMin, rMax, gMin, gMax, bMin, bMax] of COLOR_RULES) {
    if (inside(reading.c, cMin, cMax) && inside(share.r, rMin, rMax) && inside(share.g, gMin, gMax) && inside(share.b, bMin, bMax)) {
      return colour;
    }
  }
  return COLOR_UNKNOWN;
}

/** The C++ table of the generated sketch, row for row (the sketch's `COLOR_RULES` block between its two marker comments). */
export function colorRulesCpp(): string {
  const rows = COLOR_RULES.map((rule) => `  {${rule.join(', ')}},`);
  return [`#define COLOR_RULE_COUNT ${COLOR_RULES.length}`, `const uint16_t COLOR_RULES[COLOR_RULE_COUNT][9] PROGMEM = {`, ...rows, '};'].join('\n');
}
