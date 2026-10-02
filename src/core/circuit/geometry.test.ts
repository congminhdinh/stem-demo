import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { portWorldPosition } from './geometry';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('portWorldPosition', () => {
  it('is the component position plus the port offset from the definition', () => {
    const led = { id: 'led', deviceType: 'led', position: { x: 100, y: 100 } };

    expect(portWorldPosition(led, registry.get('led'), 'anode')).toEqual({ x: 90, y: 130 });
    expect(portWorldPosition(led, registry.get('led'), 'cathode')).toEqual({ x: 110, y: 130 });
  });

  it('works for board pins the same way', () => {
    const board = { id: 'board', deviceType: 'board', position: { x: 200, y: 220 } };

    expect(portWorldPosition(board, registry.get('board'), 'd13')).toEqual({ x: 310, y: 110 });
  });
});
