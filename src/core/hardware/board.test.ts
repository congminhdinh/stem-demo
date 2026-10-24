import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { boardScaleOf } from '../devices/device-definition';
import { boardPin, pwmPins, timerOf } from './board';
import { HardwareDataError, loadBoard } from './board-schema';
import unoR3Json from './uno-r3.board.json';

// N18 R1.1 (robot plan §4.1): the board profile is data, validated by Zod with errors that name the path.

const board = loadBoard(unoR3Json);
const digitalPins = Array.from({ length: 14 }, (_, index) => `D${String(index)}`);
const analogPins = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

/** The message of what `run` throws. */
function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Nothing was thrown');
}

describe('the uno-r3 board profile', () => {
  it('uno-r3 lists exactly D3,D5,D6,D9,D10,D11 as pwm', () => {
    expect(pwmPins(board)).toEqual(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
    expect(board.pins.filter((pin) => pin.caps.includes('pwm')).map((pin) => pin.id)).toEqual(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
  });

  it('puts D5, D6 on T0, D9, D10 on T1 and D3, D11 on T2, and no other pin on a timer', () => {
    expect(Object.fromEntries(board.pins.filter((pin) => pin.pwmTimer).map((pin) => [pin.id, pin.pwmTimer]))).toEqual({
      D3: 'T2', D5: 'T0', D6: 'T0', D9: 'T1', D10: 'T1', D11: 'T2',
    });
    expect(timerOf(board, 'D7')).toBeUndefined();
    expect(timerOf(board, 'D10')).toBe('T1');
  });

  it('has D0–D13 and A0–A5, every pin digital, analog in on A0–A5 only', () => {
    expect(board.pins.map((pin) => pin.id)).toEqual([...digitalPins, ...analogPins]);
    expect(board.pins.every((pin) => pin.caps.includes('digital'))).toBe(true);
    expect(board.pins.filter((pin) => pin.caps.includes('analogIn')).map((pin) => pin.id)).toEqual(analogPins);
  });

  it('reserves D0 and D1 while the program prints, and says what holds which timer', () => {
    expect(board.reserved).toEqual([{ pin: 'D0', when: 'serial' }, { pin: 'D1', when: 'serial' }]);
    expect(boardPin(board, 'D0')?.caps).toEqual(['digital', 'serial']);
    expect(board.timerClaims).toEqual({ servo: 'T1', tone: 'T2' });
  });

  it('is an ATmega328P at 16 MHz with avr8js evidence, analogRead 0..1023 and analogWrite 0..255', () => {
    expect(board).toMatchObject({ id: 'uno-r3', mcu: 'atmega328p', clockHz: 16_000_000, adcMax: 1023, pwmMax: 255, emulator: 'avr8js' });
  });
});

describe('the uno-r3 device definition against the board profile', () => {
  const device = createDeviceRegistry(localDeviceDefinitions).get('uno-r3');

  it('uno-r3 device pins equal board profile pins', () => {
    const devicePins = device.board?.pins ?? [];
    expect(devicePins.map((pin) => pin.name)).toEqual(board.pins.map((pin) => pin.id));
    // The device schema names digital, pwm and analogIn; the profile adds what the editor never shows (serial).
    const editorCaps = new Set(['digital', 'pwm', 'analogIn']);
    for (const pin of board.pins) {
      const devicePin = devicePins.find((candidate) => candidate.name === pin.id);
      expect(devicePin?.capabilities ?? ['digital'], pin.id).toEqual(pin.caps.filter((cap) => editorCaps.has(cap)));
    }
  });

  it('has the same scales as the board profile', () => {
    expect(boardScaleOf(device)).toEqual({ adcMax: board.adcMax, pwmMax: board.pwmMax });
  });
});

describe('loadBoard refuses data that is not a board profile, naming the path', () => {
  const withPins = (pins: unknown) => ({ ...unoR3Json, pins });

  it('refuses a pwm pin without a timer and a timer on a pin without pwm', () => {
    const noTimer = withPins(unoR3Json.pins.map((pin) => (pin.id === 'D5' ? { id: 'D5', caps: ['digital', 'pwm'] } : pin)));
    expect(thrown(() => loadBoard(noTimer))).toMatch(/pins\.5\.pwmTimer/);
    const strayTimer = withPins(unoR3Json.pins.map((pin) => (pin.id === 'D7' ? { ...pin, pwmTimer: 'T0' } : pin)));
    expect(thrown(() => loadBoard(strayTimer))).toMatch(/pins\.7\.pwmTimer/);
  });

  it('refuses a pin twice, an unknown capability, a reserved pin not on the board and a claim on a timer no pin has', () => {
    expect(thrown(() => loadBoard(withPins([...unoR3Json.pins, { id: 'D2', caps: ['digital'] }])))).toMatch(/pins\.20\.id/);
    expect(thrown(() => loadBoard(withPins([{ id: 'D0', caps: ['digital', 'usb'] }, ...unoR3Json.pins.slice(1)])))).toMatch(/pins\.0\.caps\.1/);
    expect(thrown(() => loadBoard({ ...unoR3Json, reserved: [{ pin: 'D20', when: 'serial' }] }))).toMatch(/reserved\.0\.pin/);
    expect(thrown(() => loadBoard({ ...unoR3Json, timerClaims: { servo: 'T3' } }))).toMatch(/timerClaims\.servo/);
  });

  it('refuses a missing or extra cost and a cost that is not positive', () => {
    const withoutPinMode: Partial<typeof unoR3Json.costsUs> = { ...unoR3Json.costsUs };
    delete withoutPinMode.pinMode;
    expect(thrown(() => loadBoard({ ...unoR3Json, costsUs: withoutPinMode }))).toMatch(/costsUs\.pinMode/);
    expect(thrown(() => loadBoard({ ...unoR3Json, costsUs: { ...unoR3Json.costsUs, micros: 1 } }))).toMatch(/costsUs/);
    expect(thrown(() => loadBoard({ ...unoR3Json, costsUs: { ...unoR3Json.costsUs, analogRead: 0 } }))).toMatch(/costsUs\.analogRead/);
  });

  it('throws a HardwareDataError that lists every problem with its path', () => {
    let error: unknown;
    try {
      loadBoard({ ...unoR3Json, adcMax: -1, emulator: 'simavr' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HardwareDataError);
    expect((error as HardwareDataError).issues.map((issue) => issue.path)).toEqual(['adcMax', 'emulator']);
  });
});
