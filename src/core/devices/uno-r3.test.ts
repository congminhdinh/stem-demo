import { describe, expect, it } from 'vitest';
import { boardScaleOf, deviceDefinitionSchema, deviceFamily, findPort } from './device-definition';
import { usablePins } from './board-pins';
import { localDeviceDefinitions } from './local-catalog';
import { createDeviceRegistry } from './registry';
import unoR3 from './definitions/uno-r3.json';

// The UNO-compatible board of the robot lab (N18 R2.1, plan §4.0): static metadata only. Its pins are the
// UNO header's (contract docs/uno-compatibility-contract.md §5: PWM on D3, D5, D6, D9, D10, D11, analog in on
// A0–A5); what a pin does at run time is the virtual UNO's (R1), not this file's.

const registry = createDeviceRegistry(localDeviceDefinitions);
const board = registry.get('uno-r3');
const digitalPins = Array.from({ length: 14 }, (_, index) => `D${String(index)}`);
const analogPins = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
const pwmPins = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'];

describe('uno-r3', () => {
  it('belongs to the uno family and targets Arduino AVR', () => {
    expect(deviceFamily(board)).toBe('uno');
    expect(board.board?.codeTarget).toBe('arduino-avr');
  });

  it('is in the local catalog, so a document with it resolves', () => {
    expect(registry.list().map((definition) => definition.id)).toContain('uno-r3');
    expect(deviceDefinitionSchema.parse(unoR3)).toEqual(board);
  });

  it('has the pins D0–D13 and A0–A5, in that order, each on a gpio port of its own', () => {
    expect(board.board?.pins.map((pin) => pin.name)).toEqual([...digitalPins, ...analogPins]);
    const ports = board.board?.pins.map((pin) => pin.portId) ?? [];
    expect(new Set(ports).size).toBe(ports.length);
    for (const pin of board.board?.pins ?? []) {
      expect(findPort(board, pin.portId)?.kind, pin.name).toBe('gpio');
      expect(findPort(board, pin.portId)?.label, pin.name).toBe(pin.name);
    }
    expect(findPort(board, '5v')?.kind).toBe('power');
    expect(findPort(board, 'gnd')?.kind).toBe('ground');
  });

  it('gives PWM to D3, D5, D6, D9, D10, D11 and analog in to A0–A5, every pin digital, nothing else', () => {
    expect(usablePins(board, 'digital')).toEqual([...digitalPins, ...analogPins]);
    expect(usablePins(board, 'pwm')).toEqual(pwmPins);
    expect(usablePins(board, 'analogIn')).toEqual(analogPins);
    expect(usablePins(board, 'servo')).toEqual([]);
    expect(usablePins(board, 'pulse')).toEqual([]);
  });

  it('reserves no pin outright: D0/D1 are only taken while the program prints (the board profile’s `reserved`, R1)', () => {
    expect(board.board?.reservedPins).toEqual([]);
  });

  it('has no onboard part: its modules come from the kit (plan §4.2)', () => {
    expect(board.board?.onboard).toBeUndefined();
  });

  it('puts every port on the editor grid', () => {
    for (const port of board.ports) {
      expect(Math.abs(port.x % 10), port.id).toBe(0);
      expect(Math.abs(port.y % 10), port.id).toBe(0);
    }
  });
});

describe('boardScaleOf: the native scales of a board (N18 R2.1)', () => {
  it('ybc board keeps 0..4095 analog scale', () => {
    // The Yolo:Bit contract's C-25 (analog read 0..4095) and C-26 (duty 0..1023): ybc-board.json says nothing, so nothing changed.
    expect(registry.get('ybc-board').board).not.toHaveProperty('scale');
    expect(boardScaleOf(registry.get('ybc-board'))).toEqual({ adcMax: 4095, pwmMax: 1023 });
  });

  it('gives the UNO board its own data: analogRead 0..1023, analogWrite 0..255 (UNO contract U-32, U-34)', () => {
    expect(boardScaleOf(board)).toEqual({ adcMax: 1023, pwmMax: 255 });
  });

  it('refuses a scale that is not a positive whole number', () => {
    for (const scale of [{ adcMax: 0, pwmMax: 255 }, { adcMax: 1023, pwmMax: 25.5 }, { adcMax: -1, pwmMax: 255 }]) {
      expect(() => deviceDefinitionSchema.parse({ ...unoR3, board: { ...unoR3.board, scale } }), JSON.stringify(scale)).toThrow();
    }
  });
});
