import { describe, expect, it } from 'vitest';
import { createTcs34725, TCS34725_ADDRESS, TCS34725_ID, TCS_STEP_US, windowCounts, type LightIntegral, type Rgbc, type Tcs34725 } from './tcs34725';

// N19 A3: the TCS34725 register model against the datasheet behaviours its header claims (TAOS135; ADR 0004 §11). Ported from the
// G0.2 spike's checks (spikes/avr8js/check-tcs34725-model.ts), exact values.

/** Light of a constant irradiance (counts per second at 1×), integrated over whole µs. */
const steady = (perS: Rgbc): LightIntegral => (from, to) => {
  const span = Math.round(to - from);
  return { c: perS.c * span, r: perS.r * span, g: perS.g * span, b: perS.b * span };
};
/** `perS` on r, g and b, the sum on c. */
const grey = (perS: number) => steady({ c: 3 * perS, r: perS, g: perS, b: perS });

const write = (device: Tcs34725, t: number, bytes: readonly number[]) => {
  expect(device.connect(t, false)).toBe(true);
  for (const byte of bytes) {
    expect(device.write(t, byte)).toBe(true);
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
/** colorBegin's register writes: ATIME 0xEB (21 cycles), gain 4×, PON, then PON | AEN at `aenAt`. */
const begin = (device: Tcs34725, aenAt: number) => {
  write(device, 0, [0x81, 0xeb]);
  write(device, 0, [0x8f, 0x01]);
  write(device, 0, [0x80, 0x01]);
  write(device, aenAt, [0x80, 0x03]);
};

describe('the TCS34725 register model (datasheet TAOS135)', () => {
  it('answers at 0x29 and resets to ID 0x44, ATIME 0xFF, ENABLE 0, STATUS 0 and zero data', () => {
    const device = createTcs34725(grey(1000));
    expect([device.address, TCS34725_ADDRESS, TCS34725_ID]).toEqual([0x29, 0x29, 0x44]);
    expect(read(device, 0, 0x92, 1)).toEqual([0x44]);
    expect(read(device, 0, 0x81, 1)).toEqual([0xff]);
    expect(read(device, 0, 0x80, 1)).toEqual([0]);
    expect(read(device, 0, 0x93, 1)).toEqual([0]);
    expect(read(device, 0, 0xb4, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('first integration ready 2.4 ms + 50.4 ms after AEN (PON 3 ms before), then one every 52.8 ms: each cycle has its RGBC Init', () => {
    const device = createTcs34725(grey(1000));
    begin(device, 3000);
    expect(device.peek(3000 + 52_800 - 1).status).toBe(0);
    expect(device.peek(3000 + 52_800).status).toBe(1);
    expect(device.peek(3000 + 52_800).nextWindowEndUs).toBe(3000 + 2 * 52_800);
    // 1000 counts/s at 4× for 50.4 ms: 201.6 → 201 (r, g, b), 604.8 → 604 (c).
    expect(device.peek(3000 + 52_800).data).toEqual({ c: 604, r: 201, g: 201, b: 201 });
  });

  it('waits the 2.4 ms warm-up first when PON and AEN come in one write (Table 5 note 2)', () => {
    const device = createTcs34725(grey(1000));
    write(device, 0, [0x81, 0xeb]);
    write(device, 0, [0x80, 0x03]);
    expect(device.peek(2400 + 52_800 - 1).status).toBe(0);
    expect(device.peek(2400 + 52_800).status).toBe(1);
  });

  it('counts the light of the ADC window only, not of the RGBC Init before it', () => {
    // Light only during the first Init (3000..5400 µs): the first window sees none.
    const lit = createTcs34725((from, to) => {
      const on = Math.max(0, Math.min(to, 5400) - Math.max(from, 3000));
      return { c: 1e6 * on, r: 1e6 * on, g: 1e6 * on, b: 1e6 * on };
    });
    begin(lit, 3000);
    expect(lit.peek(3000 + 52_800).data).toEqual({ c: 0, r: 0, g: 0, b: 0 });
    // Ambient only (200 counts/s a channel): 0.2 × 4 × 50.4 = 40.32 → 40, and 120 on c.
    const ambient = createTcs34725(grey(200));
    begin(ambient, 3000);
    expect(ambient.peek(3000 + 52_800).data).toEqual({ c: 120, r: 40, g: 40, b: 40 });
  });

  it('saturates at 1024 × cycles (21504 for ATIME 0xEB) and at 65535', () => {
    const bright = createTcs34725(grey(10_000_000));
    begin(bright, 3000);
    expect(bright.peek(3000 + 52_800).data).toEqual({ c: 21_504, r: 21_504, g: 21_504, b: 21_504 });
    const long = createTcs34725(grey(10_000_000));
    write(long, 0, [0x81, 0x00]); // 256 cycles: 1024 × 256 > 65535
    write(long, 0, [0x80, 0x03]);
    expect(long.peek(2400 + 2400 + 256 * TCS_STEP_US).data).toEqual({ c: 65_535, r: 65_535, g: 65_535, b: 65_535 });
    expect(windowCounts({ c: 0, r: 1, g: 2, b: 3 }, 60, 1)).toEqual({ c: 0, r: 0, g: 0, b: 0 });
    expect(() => windowCounts({ c: -1, r: 0, g: 0, b: 0 }, 1, 1)).toThrow(RangeError);
  });

  it('applies the gain of CONTROL AGAIN: 1×, 4×, 16×, 60×', () => {
    const counts = [0, 1, 2, 3].map((again) => {
      const device = createTcs34725(grey(1000));
      write(device, 0, [0x81, 0xeb]);
      write(device, 0, [0x8f, again]);
      write(device, 0, [0x80, 0x03]);
      return device.peek(2400 + 52_800).data.r;
    });
    expect(counts).toEqual([50, 201, 806, 3024]);
  });

  it('reads C R G B little-endian by auto-increment (0xB4); a repeated-byte command (0x94) reads CDATAL again', () => {
    const device = createTcs34725(steady({ c: 300_000, r: 100_000, g: 50_000, b: 25_000 }));
    begin(device, 3000);
    const t = 3000 + 52_800;
    expect(device.peek(t).data).toEqual({ c: 21_504, r: 20_160, g: 10_080, b: 5040 });
    expect(read(device, t, 0xb4, 8)).toEqual([0x00, 0x54, 0xc0, 0x4e, 0x60, 0x27, 0xb0, 0x13]);
    expect(read(device, t, 0x94, 3)).toEqual([0x00, 0x00, 0x00]);
  });

  it('gives a high byte from the shadow its low byte latched, even when a window ends in between', () => {
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
    expect([low, high]).toEqual([0xc0, 0x4e]);
  });

  it('writes a byte without the CMD bit to the last command’s register, and ignores writes to read-only registers', () => {
    const device = createTcs34725(grey(1000));
    write(device, 0, [0x81, 0xeb]);
    write(device, 0, [0x40]); // no CMD bit: ATIME again
    expect(read(device, 0, 0x81, 1)).toEqual([0x40]);
    write(device, 0, [0x92, 0x12]);
    expect(read(device, 0, 0x92, 1)).toEqual([TCS34725_ID]);
  });

  it('applies an ATIME written during a window from the next window', () => {
    const device = createTcs34725(grey(1000));
    begin(device, 3000);
    write(device, 3000 + 10_000, [0x81, 0xf6]); // 10 cycles, during the first ADC window
    expect(device.peek(3000 + 52_800).status).toBe(1);
    expect(device.peek(3000 + 52_800).nextWindowEndUs).toBe(3000 + 52_800 + 2400 + 10 * TCS_STEP_US);
  });

  it('drops the window under way when AEN goes off and keeps the data; AEN on again clears AVALID', () => {
    const device = createTcs34725(grey(1000));
    begin(device, 3000);
    const t = 3000 + 52_800 + 1000;
    write(device, t, [0x80, 0x01]);
    expect(device.peek(t + 200_000).status).toBe(1);
    expect(device.peek(t + 200_000).nextWindowEndUs).toBeNull();
    expect(device.peek(t + 200_000).data.r).toBe(201);
    write(device, t + 200_000, [0x80, 0x03]);
    expect(device.peek(t + 200_000).status).toBe(0);
  });

  it('runs forward in time only', () => {
    const device = createTcs34725(grey(1000));
    device.peek(1000);
    expect(() => device.peek(999)).toThrow(/forward in time/);
    expect(() => device.peek(Number.NaN)).toThrow(RangeError);
  });
});
