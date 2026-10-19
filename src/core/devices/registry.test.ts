import { describe, expect, it } from 'vitest';
import { deviceFamily, findPort } from './device-definition';
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

  it('loads the push button: two passive ports on the grid, simulated as a contact', () => {
    const button = registry.get('push-button');

    expect(button.ports).toEqual([
      expect.objectContaining({ id: 'a', x: -30, y: 0, kind: 'passive' }),
      expect.objectContaining({ id: 'b', x: 30, y: 0, kind: 'passive' }),
    ]);
    expect(button.simulation).toEqual({ model: 'contact' });
  });

  it('lists every definition in catalog order: the generic ones first, the Yolo:Bit-compatible devices after them', () => {
    expect(registry.list().map((definition) => definition.id)).toEqual([
      'board',
      'led',
      'resistor',
      'push-button',
      'ybc-board',
      'potentiometer',
      'servo',
    ]);
  });

  it('gives a definition the generic family unless it says otherwise (GB1: the generic files stay as they are)', () => {
    expect(registry.list().map((definition) => [definition.id, deviceFamily(definition)])).toEqual([
      ['board', 'generic'],
      ['led', 'generic'],
      ['resistor', 'generic'],
      ['push-button', 'generic'],
      ['ybc-board', 'ybc'],
      // YB-4: a device of the Yolo:Bit-compatible track never shows up in a generic palette (R-F3, GB9).
      ['potentiometer', 'ybc'],
      // N17 B5: the servo of the Advanced board.
      ['servo', 'ybc'],
    ]);
    expect(registry.get('board')).not.toHaveProperty('family');
  });

  it('rejects an unknown device type', () => {
    expect(() => registry.get('motor')).toThrow('Unknown device type "motor"');
  });

  it('fails fast on an invalid definition', () => {
    expect(() => createDeviceRegistry([{ id: 'broken', name: 'Broken' }])).toThrow();
  });
});
