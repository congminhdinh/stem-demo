import { describe, expect, it } from 'vitest';
import { hasCap } from './board';
import { loadBoard } from './board-schema';
import unoR3Json from './uno-r3.board.json';

// N19 A2/A3 (plan §4.1, ADR 0004 §11): the UNO's I²C (Wire on the ATmega328P's TWI: SDA A4, SCL A5, 100 kHz) and what the gripper car's
// helpers cost, measured on avr8js (EMU-20, spikes/avr8js/out/gripper-results.json and gripper-timeline.json).

const board = loadBoard(unoR3Json);

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Nothing was thrown');
}

describe('the I²C of uno-r3', () => {
  it('has i2c on A4 and A5 only, SDA on A4 and SCL on A5 at 100 kHz (Wire: TWBR 72)', () => {
    expect(board.pins.filter((pin) => pin.caps.includes('i2c')).map((pin) => pin.id)).toEqual(['A4', 'A5']);
    expect(board.i2c).toEqual({ sda: 'A4', scl: 'A5', sclHz: 100_000 });
    expect([hasCap(board, 'A4', 'analogIn'), hasCap(board, 'A4', 'digital'), hasCap(board, 'A3', 'i2c')]).toEqual([true, true, false]);
  });

  it('refuses an i2c section on a pin that is not on the board or has no i2c, the same pin twice, or a clock of 0', () => {
    expect(thrown(() => loadBoard({ ...unoR3Json, i2c: { sda: 'A6', scl: 'A5', sclHz: 100_000 } }))).toMatch(/i2c\.sda: A6 is not a pin of uno-r3/);
    expect(thrown(() => loadBoard({ ...unoR3Json, i2c: { sda: 'A3', scl: 'A5', sclHz: 100_000 } }))).toMatch(/i2c\.sda: A3 has no i2c/);
    expect(thrown(() => loadBoard({ ...unoR3Json, i2c: { sda: 'A4', scl: 'A4', sclHz: 100_000 } }))).toMatch(/i2c\.scl: SCL is another pin than SDA/);
    expect(thrown(() => loadBoard({ ...unoR3Json, i2c: { sda: 'A4', scl: 'A5', sclHz: 0 } }))).toMatch(/i2c\.sclHz/);
  });

  it('may have no I²C at all', () => {
    const withoutI2c: Partial<typeof unoR3Json> = { ...unoR3Json };
    delete withoutI2c.i2c;
    expect(loadBoard(withoutI2c).i2c).toBeUndefined();
  });
});

describe('what the gripper car’s calls cost on uno-r3, µs (EMU-20; the shortest sample, as every cost of the table)', () => {
  it('charges gripperSet with its clamp, the colour helpers with and without a device at 0x29, the classification and Wire’s service of a bus phase', () => {
    const { gripperSet, colorWrite, colorWriteNack, colorBegin, colorBeginNack, colorFetch, colorFetchNack, colorClassify, colorClassifyZero, wirePhase } = board.costsUs;
    expect({ gripperSet, colorWrite, colorWriteNack, colorBegin, colorBeginNack, colorFetch, colorFetchNack, colorClassify, colorClassifyZero, wirePhase }).toEqual({
      gripperSet: 51.625,
      colorWrite: 334,
      colorWriteNack: 144.9375,
      colorBegin: 1350.5625,
      colorBeginNack: 589.4375,
      colorFetch: 1158.5,
      colorFetchNack: 146.0625,
      colorClassify: 147.25,
      colorClassifyZero: 12.5625,
      wirePhase: 4.9375,
    });
  });
});
