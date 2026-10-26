import type { CostsUs } from '../board';
import { TCS34725_ADDRESS, TCS_COMMAND, TCS_ENABLE, TCS_REGISTER, type Rgbc } from '../devices/tcs34725';
import type { DriverIO } from '../virtual-uno';
import { arduinoCore, defineDriver, defineOp, type ArgRange, type CppLibrary, type DriverOp, type SetupStep } from './driver';

// The TCS34725 colour sensor on raw Wire, no Adafruit library (N19 plan §4.3, D-G7; ADR 0004 §11; contract rows U-38, U-39 are task A5's).
// setup() calls `colorBegin()`: ATIME 0xEB (21 cycles, 50.4 ms), gain 4×, power on, 3 ms later the RGBC, then 54 ms for the first window
// (its 2.4 ms RGBC Init and 50.4 ms; the next ones end every 52.8 ms). `colorIs(n)` and `colorRaw(k)` read C, R, G, B in one auto-increment
// read from CDATAL; `colorIs` classifies it by the integer table COLOR_RULES. A missing sensor (NACK) reads zeros, which are "unknown".
// Wire.setWireTimeout(3000, true) resets the TWI if the bus hangs, so a broken bus never blocks the program.
//
// One table, two sides: `classifyColor` here and the C++ table of the helper, which `colorRulesCpp` writes from the same rows (a test
// holds the two together on every palette colour). The thresholds are PLACEHOLDER data, tied to this driver's version, until a real kit is
// measured (VG/L3).
//
// Time (EMU-20, spikes/avr8js/out/gripper-results.json; where the bus events fall, spikes/avr8js/out/gripper-timeline.json): the virtual
// UNO charges each bus phase (virtual-uno.ts: Wire's service, then the SCL periods) and calls the register model at its time; the helper's
// own statements are charged around the bus so that each helper takes its measured time and its first bus event comes where the board
// has it. So the eight data bytes are read one by one at their bus times (ADR 0004 §11, condition 3): a window that ends in the middle of
// a read gives C from one window and R, G, B from the next, as the board does (the datasheet's shadow registers, devices/tcs34725.ts).
// On the board a byte's service varies by ≤ 1.2 µs around `wirePhase`; the simulator's events stay within 1.25 µs of the board's in
// colorFetch (driver test). The libraries: Wire 1.0 of arduino:avr 1.8.8 (LGPL-2.1).

/** Wire 1.0, as arduino:avr 1.8.8 ships it (ADR 0004 §11: LGPL-2.1, Wire.cpp's header). */
export const wireLibrary: CppLibrary = { name: 'Wire', version: '1.0', license: 'LGPL-2.1' };

/** The colours, by index: what `color.is` asks and `colorClassify` answers. */
export const COLOR_NAMES = ['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export const COLOR_UNKNOWN = 6;

/** `color.is(color1, n)`: the colour index 0..6. `color.raw(color1, k)`: 0 red, 1 green, 2 blue, 3 clear. */
export const COLOR_INDEX: ArgRange = { name: 'colour', min: 0, max: 6 };
export const COLOR_CHANNEL: ArgRange = { name: 'channel', min: 0, max: 3 };

/** [colour, cMin, cMax, rMin, rMax, gMin, gMax, bMin, bMax]: bounds inclusive, C in counts, r g b in per-mille of r + g + b. */
export type ColorRule = readonly [number, number, number, number, number, number, number, number, number];

const ANY_C = 65535;
const ANY = 1000;
/** Plan §4.3: the first rule whose clear count and three per-mille are all inside its bounds wins; none → unknown (PLACEHOLDER). */
export const COLOR_RULES: readonly ColorRule[] = [
  [6, 0, 299, 0, ANY, 0, ANY, 0, ANY], // C < 300: too little light (no object, no sensor, NACK)
  [0, 0, ANY_C, 500, ANY, 0, 299, 0, ANY], // red: r ≥ 500, g < 300
  [1, 0, ANY_C, 0, 329, 420, ANY, 0, ANY], // green: g ≥ 420, r < 330
  [2, 0, ANY_C, 0, 299, 0, ANY, 420, ANY], // blue: b ≥ 420, r < 300
  [4, 12000, ANY_C, 0, 419, 0, ANY, 230, ANY], // white: C ≥ 12000, b ≥ 230, r < 420
  [3, 0, ANY_C, 380, ANY, 330, ANY, 0, 229], // yellow: r ≥ 380, g ≥ 330, b < 230
  [5, 0, 3999, 0, ANY, 0, ANY, 0, ANY], // black: C < 4000
];

/** floor(a / b) for non-negative safe integers, exact (unsigned long division, as the C++ does). */
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

/** r, g, b per mille of r + g + b, truncated (all 0 when the sum is 0). */
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

/** The C++ table the helper carries, row for row from COLOR_RULES (in PROGMEM). */
export function colorRulesCpp(): string {
  const rows = COLOR_RULES.map((rule) => `  {${rule.join(', ')}},`);
  return [`#define COLOR_RULE_COUNT ${String(COLOR_RULES.length)}`, `const uint16_t COLOR_RULES[COLOR_RULE_COUNT][9] PROGMEM = {`, ...rows, '};'].join('\n');
}

/** colorBegin's registers (datasheet TAOS135 Tables 6 and 11): ATIME 0xEB, 21 integration cycles of 2.4 ms; AGAIN 1, gain 4×. */
export const COLOR_ATIME = 0xeb;
export const COLOR_AGAIN = 0x01;
/** colorBegin's waits, ms: after PON (> the 2.4 ms warm-up, Table 5 note 2), and for the first window (2.4 ms Init + 50.4 ms). */
export const COLOR_PON_WAIT_MS = 3;
export const COLOR_FIRST_WINDOW_MS = 54;
/** The auto-increment read of C, R, G, B from CDATAL. */
const FETCH_COMMAND = TCS_COMMAND.CMD | TCS_COMMAND.AUTO_INCREMENT | TCS_REGISTER.CDATAL;

const byte = (value: number) => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;

/** The helper the generated sketch carries: the table, then the functions, the register values and waits written from the constants above. */
export function colorHelperText(): string {
  return [
    `#define COLOR_ADDR 0x${TCS34725_ADDRESS.toString(16)}`,
    colorRulesCpp(),
    'void colorWrite(uint8_t reg, uint8_t value) {',
    '  Wire.beginTransmission(COLOR_ADDR);',
    `  Wire.write((uint8_t)(${byte(TCS_COMMAND.CMD)} | reg));`,
    '  Wire.write(value);',
    '  Wire.endTransmission();',
    '}',
    'void colorBegin() {',
    '  Wire.begin();',
    '  Wire.setWireTimeout(3000, true);',
    `  colorWrite(${byte(TCS_REGISTER.ATIME)}, ${byte(COLOR_ATIME)});`,
    `  colorWrite(${byte(TCS_REGISTER.CONTROL)}, ${byte(COLOR_AGAIN)});`,
    `  colorWrite(${byte(TCS_REGISTER.ENABLE)}, ${byte(TCS_ENABLE.PON)});`,
    `  delay(${String(COLOR_PON_WAIT_MS)});`,
    `  colorWrite(${byte(TCS_REGISTER.ENABLE)}, ${byte(TCS_ENABLE.PON | TCS_ENABLE.AEN)});`,
    `  delay(${String(COLOR_FIRST_WINDOW_MS)});`,
    '}',
    'void colorFetch() {',
    '  Wire.beginTransmission(COLOR_ADDR);',
    `  Wire.write((uint8_t)${byte(FETCH_COMMAND)});`,
    '  if (Wire.endTransmission() != 0 || Wire.requestFrom((uint8_t)COLOR_ADDR, (uint8_t)8) != 8) {',
    '    colorC = 0;',
    '    colorR = 0;',
    '    colorG = 0;',
    '    colorB = 0;',
    '    return;',
    '  }',
    '  uint8_t bytes[8];',
    '  for (uint8_t i = 0; i < 8; i++) {',
    '    bytes[i] = (uint8_t)Wire.read();',
    '  }',
    '  colorC = (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);',
    '  colorR = (uint16_t)bytes[2] | ((uint16_t)bytes[3] << 8);',
    '  colorG = (uint16_t)bytes[4] | ((uint16_t)bytes[5] << 8);',
    '  colorB = (uint16_t)bytes[6] | ((uint16_t)bytes[7] << 8);',
    '}',
    'uint8_t colorClassify() {',
    '  unsigned long sum = (unsigned long)colorR + colorG + colorB;',
    '  uint16_t r = sum == 0UL ? 0 : (uint16_t)((colorR * 1000UL) / sum);',
    '  uint16_t g = sum == 0UL ? 0 : (uint16_t)((colorG * 1000UL) / sum);',
    '  uint16_t b = sum == 0UL ? 0 : (uint16_t)((colorB * 1000UL) / sum);',
    '  for (uint8_t i = 0; i < COLOR_RULE_COUNT; i++) {',
    '    const uint16_t *rule = COLOR_RULES[i];',
    '    if (colorC >= pgm_read_word(&rule[1]) && colorC <= pgm_read_word(&rule[2]) &&',
    '        r >= pgm_read_word(&rule[3]) && r <= pgm_read_word(&rule[4]) &&',
    '        g >= pgm_read_word(&rule[5]) && g <= pgm_read_word(&rule[6]) &&',
    '        b >= pgm_read_word(&rule[7]) && b <= pgm_read_word(&rule[8])) {',
    '      return (uint8_t)pgm_read_word(&rule[0]);',
    '    }',
    '  }',
    `  return ${String(COLOR_UNKNOWN)};`,
    '}',
    'bool colorIs(uint8_t n) {',
    '  colorFetch();',
    '  return colorClassify() == n;',
    '}',
    'long colorRaw(uint8_t k) {',
    '  colorFetch();',
    '  if (k == 0) return (long)colorR;',
    '  if (k == 1) return (long)colorG;',
    '  if (k == 2) return (long)colorB;',
    '  return (long)colorC;',
    '}',
  ].join('\n');
}

// ---- The simulator's side: the same helpers on the virtual UNO ----------------------------------------------------------------------

/**
 * Where the helpers' first bus phase starts, µs from the call (gripper-timeline.json, the shortest sample): colorWrite's statements
 * before Wire's first service (Wire.beginTransmission, two Wire.write, endTransmission's entry), colorFetch's, and colorFetch's between
 * its command write and its read (endTransmission's return, requestFrom's entry).
 */
export const COLOR_WRITE_LEAD_US = 11.625;
export const COLOR_FETCH_LEAD_US = 9.1875;
export const COLOR_FETCH_GAP_US = 10.5625;

const ZERO: Rgbc = { c: 0, r: 0, g: 0, b: 0 };

/** colorWrite on the virtual UNO: one register write, the measured time with or without a device; whether the device acknowledged it. */
function colorWrite(io: DriverIO, register: number, value: number): boolean {
  const costs = io.costsUs;
  io.compute(COLOR_WRITE_LEAD_US);
  const acked = io.i2c.transmit(TCS34725_ADDRESS, [TCS_COMMAND.CMD | register, value]);
  io.compute((acked ? costs.colorWrite : costs.colorWriteNack) - COLOR_WRITE_LEAD_US - io.i2c.transactionUs(2, acked));
  return acked;
}

/** colorBegin's own time besides its four writes and two delays, with a sensor and without one. */
const beginOwnUs = (costs: CostsUs) => ({ acked: costs.colorBegin - 4 * costs.colorWrite, nack: costs.colorBeginNack - 4 * costs.colorWriteNack });

/**
 * colorBegin on the virtual UNO. Its own statements (Wire.begin, setWireTimeout) come first: as much of their time as both measured
 * totals leave (9.6875 µs; 13.0625 measured before the first write with a sensor, whose delays the board ran 1.5 µs longer than the
 * simulator charges them), the rest after the last delay, so the helper takes colorBegin (or colorBeginNack) and its two delays as the
 * simulator charges every delay (ms · 1000 + delayOverhead).
 */
export function colorBeginSim(io: DriverIO): void {
  const costs = io.costsUs;
  const own = beginOwnUs(costs);
  const first = Math.min(own.acked, own.nack);
  io.compute(first);
  const acked = colorWrite(io, TCS_REGISTER.ATIME, COLOR_ATIME);
  colorWrite(io, TCS_REGISTER.CONTROL, COLOR_AGAIN);
  colorWrite(io, TCS_REGISTER.ENABLE, TCS_ENABLE.PON);
  io.compute(COLOR_PON_WAIT_MS * 1000 + costs.delayOverhead);
  colorWrite(io, TCS_REGISTER.ENABLE, TCS_ENABLE.PON | TCS_ENABLE.AEN);
  io.compute(COLOR_FIRST_WINDOW_MS * 1000 + costs.delayOverhead);
  io.compute((acked ? own.acked : own.nack) - first);
}

/** colorFetch on the virtual UNO: C, R, G, B, each byte read at its bus time; zeros on a NACK. */
export function colorFetchSim(io: DriverIO): Rgbc {
  const costs = io.costsUs;
  io.compute(COLOR_FETCH_LEAD_US);
  if (!io.i2c.transmit(TCS34725_ADDRESS, [FETCH_COMMAND])) {
    io.compute(costs.colorFetchNack - COLOR_FETCH_LEAD_US - io.i2c.transactionUs(1, false));
    return ZERO;
  }
  io.compute(COLOR_FETCH_GAP_US);
  const bytes = io.i2c.request(TCS34725_ADDRESS, 8);
  if (bytes.length !== 8) {
    // The device acknowledged the command but not the read (not measured: the board's own code path is as short as a NACK's).
    return ZERO;
  }
  io.compute(costs.colorFetch - COLOR_FETCH_LEAD_US - COLOR_FETCH_GAP_US - io.i2c.transactionUs(1, true) - io.i2c.transactionUs(8, true));
  const word = (low: number) => (bytes[low] ?? 0) | ((bytes[low + 1] ?? 0) << 8);
  return { c: word(0), r: word(2), g: word(4), b: word(6) };
}

const libraries = [arduinoCore, wireLibrary];
const includes = ['#include <Wire.h>'];
const helper = { id: 'tcs34725-wire', text: colorHelperText() };
const globals = () => ['uint16_t colorC = 0;', 'uint16_t colorR = 0;', 'uint16_t colorG = 0;', 'uint16_t colorB = 0;'];
const setup: readonly SetupStep[] = [{ kind: 'helper', name: 'colorBegin' }];

const isOp: DriverOp = defineOp({
  kind: 'read',
  row: 'U-38',
  args: [COLOR_INDEX],
  setup,
  sim(io, _port, [n = 0]) {
    const reading = colorFetchSim(io);
    io.compute(reading.r + reading.g + reading.b === 0 ? io.costsUs.colorClassifyZero : io.costsUs.colorClassify);
    // As the C++ compares (the binding has clamped n to 0..6 already).
    return classifyColor(reading) === n;
  },
  cpp: { libraries, includes, helper, globals, call: (_port, _role, [n = '0L']) => `colorIs(${n})` },
});

const rawOp: DriverOp = defineOp({
  kind: 'read',
  row: 'U-39',
  args: [COLOR_CHANNEL],
  setup,
  sim(io, _port, [k = 0]) {
    const reading = colorFetchSim(io);
    // As the C++ picks: 0 red, 1 green, 2 blue, anything else clear.
    return k === 0 ? reading.r : k === 1 ? reading.g : k === 2 ? reading.b : reading.c;
  },
  cpp: { libraries, includes, helper, globals, call: (_port, _role, [k = '0L']) => `colorRaw(${k})` },
});

export const tcs34725Driver = defineDriver('tcs34725-wire', { 'color.is': isOp, 'color.raw': rawOp }, { colorBegin: (io) => colorBeginSim(io) });
