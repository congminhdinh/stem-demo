import { describe, expect, it } from 'vitest';
import { findPort } from './device-definition';
import { localDeviceDefinitions } from './local-catalog';
import { createDeviceRegistry } from './registry';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('device registry', () => {
  it('loads the board with programmable pins D13…D2 on gpio ports, plus 3V3 and GND', () => {
    const board = registry.get('board');
    const pins = board.board?.pins ?? [];

    expect(pins.map((pin) => pin.name)).toEqual(Array.from({ length: 12 }, (_, i) => `D${13 - i}`));
    for (const pin of pins) {
      expect(findPort(board, pin.portId)?.kind).toBe('gpio');
    }
    expect(findPort(board, '3v3')?.kind).toBe('power');
    expect(findPort(board, 'gnd')?.kind).toBe('ground');
  });

  it('loads the LED with anode and cathode ports', () => {
    const led = registry.get('led');

    expect(findPort(led, 'anode')).toMatchObject({ x: -10, y: 30 });
    expect(findPort(led, 'cathode')).toMatchObject({ x: 10, y: 30 });
    expect(findPort(led, 'd13')).toBeUndefined();
  });

  it('rejects an unknown device type', () => {
    expect(() => registry.get('motor')).toThrow('Unknown device type "motor"');
  });

  it('fails fast on an invalid definition', () => {
    expect(() => createDeviceRegistry([{ id: 'broken', name: 'Broken' }])).toThrow();
  });
});
