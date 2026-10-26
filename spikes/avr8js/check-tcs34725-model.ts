// N19 G0.2: the TCS34725 model alone against the datasheet behaviours it claims (tcs34725-model.ts header). Exact values; exits
// non-zero on the first that fails. node spikes/avr8js/check-tcs34725-model.ts (task A3 turns these into its Vitest tests).
import assert from 'node:assert/strict';
import { classifyColor, COLOR_NAMES } from './color-rules.ts';
import { timelineIntegral } from './gripper-light.ts';
import { createTcs34725, TCS34725_ID, TCS_STEP_US, type LightIntegral, type Tcs34725 } from './tcs34725-model.ts';

const constant = (perS: number): LightIntegral => (from, to) => ({ c: 3 * perS * (to - from), r: perS * (to - from), g: perS * (to - from), b: perS * (to - from) });
const write = (device: Tcs34725, t: number, bytes: readonly number[]) => {
  assert.equal(device.connect(t, false), true);
  for (const byte of bytes) {
    assert.equal(device.write(t, byte), true);
  }
  device.stop(t);
};
const read = (device: Tcs34725, t: number, command: number, count: number) => {
  write(device, t, [command]);
  device.connect(t, true);
  const bytes = Array.from({ length: count }, () => device.read(t));
  device.stop(t);
  return bytes;
};
const begin = (device: Tcs34725, aenAt: number) => {
  write(device, 0, [0x81, 0xeb]); // ATIME 21 cycles
  write(device, 0, [0x8f, 0x01]); // gain 4×
  write(device, 0, [0x80, 0x01]); // PON
  write(device, aenAt, [0x80, 0x03]); // PON | AEN
};
const results: string[] = [];
const check = (name: string, body: () => void) => {
  body();
  results.push(name);
};

check('reset values: ID 0x44, ATIME 0xFF, ENABLE 0, STATUS 0, data 0', () => {
  const device = createTcs34725(constant(1000));
  assert.deepEqual(read(device, 0, 0x92, 1), [TCS34725_ID]);
  assert.deepEqual(read(device, 0, 0x81, 1), [0xff]);
  assert.deepEqual(read(device, 0, 0x80, 1), [0]);
  assert.deepEqual(read(device, 0, 0x93, 1), [0]);
  assert.deepEqual(read(device, 0, 0xb4, 8), [0, 0, 0, 0, 0, 0, 0, 0]);
});

check('first window ready 2.4 ms + 50.4 ms after AEN (PON 3 ms before), then one every 52.8 ms (each cycle has its RGBC Init)', () => {
  const device = createTcs34725(constant(1000));
  begin(device, 3000);
  assert.equal(device.peek(3000 + 52_800 - 1).status, 0);
  assert.equal(device.peek(3000 + 52_800).status, 1);
  assert.equal(device.peek(3000 + 52_800).nextWindowEndUs, 3000 + 2 * 52_800);
  // 1000 counts/s at 4× for 50.4 ms: 201.6 → 201 (r, g, b), 604.8 → 604 (c).
  assert.deepEqual(device.peek(3000 + 52_800).data, { c: 604, r: 201, g: 201, b: 201 });
});

check('AEN with PON in one write waits the 2.4 ms warm-up first (Table 5 note 2)', () => {
  const device = createTcs34725(constant(1000));
  write(device, 0, [0x81, 0xeb]);
  write(device, 0, [0x80, 0x03]);
  assert.equal(device.peek(2400 + 52_800 - 1).status, 0);
  assert.equal(device.peek(2400 + 52_800).status, 1);
});

check('the counts are the light integrated over the ADC window only, not the RGBC Init before it', () => {
  // Light only during the first Init (3000..5400 µs): the first window sees none.
  const device = createTcs34725(timelineIntegral([{ fromUs: -1e9, light: 'none' }]));
  const lit = createTcs34725((from, to) => {
    const on = Math.max(0, Math.min(to, 5400) - Math.max(from, 3000));
    return { c: 1e6 * on, r: 1e6 * on, g: 1e6 * on, b: 1e6 * on };
  });
  begin(device, 3000);
  begin(lit, 3000);
  assert.deepEqual(lit.peek(3000 + 52_800).data, { c: 0, r: 0, g: 0, b: 0 });
  assert.deepEqual(device.peek(3000 + 52_800).data, { c: 120, r: 40, g: 40, b: 40 });
});

check('counts saturate at 1024 × cycles (21504 for ATIME 0xEB) and at 65535', () => {
  const bright = createTcs34725(constant(10_000_000));
  begin(bright, 3000);
  assert.deepEqual(bright.peek(3000 + 52_800).data, { c: 21_504, r: 21_504, g: 21_504, b: 21_504 });
  const long = createTcs34725(constant(10_000_000));
  write(long, 0, [0x81, 0x00]); // 256 cycles: 1024 × 256 > 65535
  write(long, 0, [0x80, 0x03]);
  assert.deepEqual(long.peek(2400 + 2400 + 256 * TCS_STEP_US).data, { c: 65_535, r: 65_535, g: 65_535, b: 65_535 });
});

check('gain 1×, 4×, 16×, 60× (CONTROL AGAIN)', () => {
  const counts = [0, 1, 2, 3].map((again) => {
    const device = createTcs34725(constant(1000));
    write(device, 0, [0x81, 0xeb]);
    write(device, 0, [0x8f, again]);
    write(device, 0, [0x80, 0x03]);
    return device.peek(2400 + 52_800).data.r;
  });
  assert.deepEqual(counts, [50, 201, 806, 3024]);
});

check('auto-increment (0xB4) reads C R G B little-endian; repeated byte (0x94) reads CDATAL again', () => {
  const device = createTcs34725((from, to) => ({ c: 300_000 * (to - from), r: 100_000 * (to - from), g: 50_000 * (to - from), b: 25_000 * (to - from) }));
  begin(device, 3000);
  const t = 3000 + 52_800;
  const { data } = device.peek(t);
  assert.deepEqual(data, { c: 21_504, r: 20_160, g: 10_080, b: 5040 });
  assert.deepEqual(read(device, t, 0xb4, 8), [0x00, 0x54, 0xc0, 0x4e, 0x60, 0x27, 0xb0, 0x13]);
  assert.deepEqual(read(device, t, 0x94, 3), [0x00, 0x00, 0x00]);
});

check('the high byte comes from the shadow its low byte latched, even when a window ends in between', () => {
  let level = 100_000;
  const device = createTcs34725((from, to) => ({ c: level * (to - from), r: level * (to - from), g: level * (to - from), b: level * (to - from) }));
  begin(device, 3000);
  const t = 3000 + 52_800;
  write(device, t, [0xb4]);
  device.connect(t, true);
  const low = device.read(t); // CDATAL of the first window: 20160 = 0x4EC0
  level = 200_000;
  const high = device.read(t + 2 * 52_800); // two windows later, the shadow still holds the first window's high byte
  device.stop(t + 2 * 52_800);
  assert.deepEqual([low, high], [0xc0, 0x4e]);
});

check('a write whose first byte has no CMD bit goes to the last command’s register; read-only registers ignore writes', () => {
  const device = createTcs34725(constant(1000));
  write(device, 0, [0x81, 0xeb]);
  write(device, 0, [0x40]); // no CMD bit: ATIME again
  assert.deepEqual(read(device, 0, 0x81, 1), [0x40]);
  write(device, 0, [0x92, 0x12]);
  assert.deepEqual(read(device, 0, 0x92, 1), [TCS34725_ID]);
});

check('ATIME written during a window applies from the next one', () => {
  const device = createTcs34725(constant(1000));
  begin(device, 3000);
  write(device, 3000 + 10_000, [0x81, 0xf6]); // 10 cycles, during the first ADC window
  assert.equal(device.peek(3000 + 52_800).status, 1);
  assert.equal(device.peek(3000 + 52_800).nextWindowEndUs, 3000 + 52_800 + 2400 + 10 * TCS_STEP_US);
});

check('AEN off drops the window under way and keeps the data; AEN on again clears AVALID', () => {
  const device = createTcs34725(constant(1000));
  begin(device, 3000);
  const t = 3000 + 52_800 + 1000;
  write(device, t, [0x80, 0x01]);
  assert.equal(device.peek(t + 200_000).status, 1);
  assert.equal(device.peek(t + 200_000).nextWindowEndUs, null);
  assert.equal(device.peek(t + 200_000).data.r, 201);
  write(device, t + 200_000, [0x80, 0x03]);
  assert.equal(device.peek(t + 200_000).status, 0);
});

check('every palette light classifies as itself; ambient alone and zeros (NACK) are unknown', () => {
  const classes = (['red', 'green', 'blue', 'yellow', 'white', 'black', 'none'] as const).map((light) => {
    const device = createTcs34725(timelineIntegral([{ fromUs: -1e9, light }]));
    begin(device, 3000);
    return COLOR_NAMES[classifyColor(device.peek(3000 + 52_800).data)];
  });
  assert.deepEqual(classes, ['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown']);
  assert.equal(COLOR_NAMES[classifyColor({ c: 0, r: 0, g: 0, b: 0 })], 'unknown');
});

console.log(`${results.length} of ${results.length} model checks pass:\n- ${results.join('\n- ')}`);
