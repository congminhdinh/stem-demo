import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { paletteItems, placementPosition } from './palette-model';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('paletteItems', () => {
  it('lists every device of the registry', () => {
    expect(paletteItems(registry)).toEqual([
      { deviceType: 'board', name: 'STEM Board' },
      { deviceType: 'led', name: 'LED' },
      { deviceType: 'resistor', name: 'Resistor' },
      { deviceType: 'push-button', name: 'Push Button' },
    ]);
  });

  it('gets an entry for a new definition without any UI change', () => {
    const buzzer = { ...registry.get('resistor'), id: 'buzzer', name: 'Buzzer', simulation: { model: 'buzzer' } };

    const items = paletteItems(createDeviceRegistry([...localDeviceDefinitions, buzzer]));

    expect(items).toHaveLength(5);
    expect(items.at(-1)).toEqual({ deviceType: 'buzzer', name: 'Buzzer' });
  });
});

describe('placementPosition', () => {
  const at = (x: number, y: number) => ({ id: `c-${x}-${y}`, deviceType: 'led', position: { x, y } });

  it('snaps the preferred point to the grid', () => {
    expect(placementPosition({ components: [], wires: [] }, { x: 383.5, y: 336 })).toEqual({ x: 380, y: 340 });
  });

  it('moves on diagonally while a component already sits there', () => {
    const circuit = { components: [at(380, 340), at(400, 360)], wires: [] };

    expect(placementPosition(circuit, { x: 383.5, y: 336 })).toEqual({ x: 420, y: 380 });
  });
});
