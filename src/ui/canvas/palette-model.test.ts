import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { resolveBoardContext } from '../../core/profiles/board-context';
import { createFixtureEnvironment, fixtureDocument } from '../../core/profiles/__fixtures__/test-profiles';
import { paletteItems, placementPosition } from './palette-model';

const registry = createDeviceRegistry(localDeviceDefinitions);
const emptyCircuit = { components: [], wires: [] };
/** A generic project: the palette is the same whichever devices the registry also holds. */
const genericContext = (devices = registry) => resolveBoardContext({ circuit: emptyCircuit }, devices, productionProfiles);

describe('paletteItems', () => {
  it('lists every generic device of the registry, and not the Yolo:Bit-compatible board', () => {
    expect(paletteItems(registry, genericContext())).toEqual([
      { deviceType: 'board', name: 'STEM Board' },
      { deviceType: 'led', name: 'LED' },
      { deviceType: 'resistor', name: 'Resistor' },
      { deviceType: 'push-button', name: 'Push Button' },
    ]);
  });

  it('gets an entry for a new definition without any UI change', () => {
    const buzzer = { ...registry.get('resistor'), id: 'buzzer', name: 'Buzzer', simulation: { model: 'buzzer' } };

    const withBuzzer = createDeviceRegistry([...localDeviceDefinitions, buzzer]);
    const items = paletteItems(withBuzzer, genericContext(withBuzzer));

    expect(items).toHaveLength(5);
    expect(items.at(-1)).toEqual({ deviceType: 'buzzer', name: 'Buzzer' });
  });
});

describe('paletteItems by family (GB9, R-F3)', () => {
  const { registry: fixtureRegistry, profiles } = createFixtureEnvironment();
  const paletteOf = (profile: string | undefined) => {
    const document = profile === undefined ? { circuit: emptyCircuit } : fixtureDocument(profile, { components: [] });
    return paletteItems(fixtureRegistry, resolveBoardContext(document, fixtureRegistry, profiles)).map((item) => item.deviceType);
  };

  it('keeps every ybc device out of a generic project, however many are registered', () => {
    expect(paletteOf(undefined)).toEqual(['board', 'led', 'resistor', 'push-button']);
  });

  it('offers a ybc project only what its profile lists, and not the generic board', () => {
    expect(paletteOf('ybc-basic')).toEqual(['ybc-board', 'led', 'resistor', 'push-button', 'potentiometer']);
    expect(paletteOf('ybc-advanced')).toEqual(['ybc-board', 'led', 'resistor', 'push-button', 'potentiometer']);
  });

  it('adds a device of a richer profile only to that profile (test-only fixture)', () => {
    expect(paletteOf('test-base')).toEqual(['ybc-board']);
    expect(paletteOf('test-extended')).toEqual(['ybc-board', 'test-device']);
  });

  it('names the ybc board with its own name, and offers the parts of the header pins after it (YB-4)', () => {
    const context = resolveBoardContext({ profile: 'ybc-basic', circuit: emptyCircuit }, registry, productionProfiles);
    expect(paletteItems(registry, context)).toEqual([
      { deviceType: 'ybc-board', name: 'Bit-compatible Board' },
      { deviceType: 'led', name: 'LED' },
      { deviceType: 'resistor', name: 'Resistor' },
      { deviceType: 'push-button', name: 'Push Button' },
      { deviceType: 'potentiometer', name: 'Potentiometer' },
    ]);
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
