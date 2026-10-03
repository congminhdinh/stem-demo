import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { nearestPort, portRefPosition, portWorldPosition, snapToGrid } from './geometry';

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

describe('portRefPosition', () => {
  it('resolves a wire end to the world position of its port', () => {
    const circuit = {
      components: [{ id: 'led', deviceType: 'led', position: { x: 100, y: 100 } }],
      wires: [],
    };

    expect(portRefPosition(circuit, registry, { componentId: 'led', portId: 'cathode' })).toEqual({
      x: 110,
      y: 130,
    });
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest multiple of 10 on each axis', () => {
    expect(snapToGrid({ x: 457, y: 183 })).toEqual({ x: 460, y: 180 });
    expect(snapToGrid({ x: -14.9, y: 5 })).toEqual({ x: -10, y: 10 });
  });

  it('keeps the ports of a snapped component on the grid', () => {
    const led = { id: 'led', deviceType: 'led', position: snapToGrid({ x: 123, y: 77 }) };

    expect(portWorldPosition(led, registry.get('led'), 'anode')).toEqual({ x: 110, y: 110 });
  });
});

describe('nearestPort', () => {
  // Board at (200, 220): D13 at (310, 110), D12 at (310, 130), D11 at (310, 150), 20 apart.
  const circuit = { components: [{ id: 'board', deviceType: 'board', position: { x: 200, y: 220 } }], wires: [] };
  const pick = (x: number, y: number) => nearestPort(circuit, registry, { x, y }, 12);

  it('picks D12 for a click 3 px off it, although the pins are only 20 apart', () => {
    expect(pick(313, 130)).toEqual({ componentId: 'board', portId: 'd12' });
    expect(pick(310, 127)).toEqual({ componentId: 'board', portId: 'd12' });
  });

  it('picks the nearer pin where two pick areas overlap', () => {
    expect(pick(310, 138)).toEqual({ componentId: 'board', portId: 'd12' });
    expect(pick(310, 142)).toEqual({ componentId: 'board', portId: 'd11' });
  });

  it('picks nothing farther than the radius', () => {
    expect(pick(330, 130)).toBeNull();
  });
});
