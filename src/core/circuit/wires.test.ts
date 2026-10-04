import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { simulateCircuit } from '../simulation/simulate-circuit';
import { addComponent } from './components';
import { projectDocumentSchema, type Circuit, type PortRef } from './document';
import { buildNetlist } from './netlist';
import { connectWire, deleteWire, nextWireId, type ConnectWireError } from './wires';

const registry = createDeviceRegistry(localDeviceDefinitions);
const circuit = projectDocumentSchema.parse(ledOnSample).circuit;
const board = (portId: string) => ({ componentId: 'board', portId });
const led = (portId: string) => ({ componentId: 'led', portId });

describe('connectWire', () => {
  it('adds a valid wire and leaves the input circuit unchanged', () => {
    const wire = { id: 'wire-d12-anode', from: board('d12'), to: led('anode') };

    const result = connectWire(circuit, registry, wire);

    expect(result).toEqual({ ok: true, circuit: { ...circuit, wires: [...circuit.wires, wire] } });
    expect(circuit.wires).toHaveLength(2);
  });

  it.each<[ConnectWireError, PortRef, PortRef]>([
    ['unknown-component', { componentId: 'missing', portId: 'anode' }, led('cathode')],
    ['unknown-port', board('d99'), led('cathode')],
    ['same-port', led('anode'), led('anode')],
    ['duplicate-wire', board('gnd'), led('cathode')],
  ])('rejects %s', (error, from, to) => {
    expect(connectWire(circuit, registry, { id: 'new-wire', from, to })).toEqual({ ok: false, error });
  });

  it('rejects a wire whose id is already used, even with different valid endpoints', () => {
    const before = structuredClone(circuit);
    const reusedId = { id: 'wire-d13-anode', from: board('d12'), to: led('anode') };

    expect(connectWire(circuit, registry, reusedId)).toEqual({ ok: false, error: 'duplicate-wire-id' });
    expect(circuit).toEqual(before);
  });
});

describe('nextWireId', () => {
  it('returns wire-<n> that no wire uses yet', () => {
    expect(nextWireId(circuit)).toBe('wire-1');
    const withWire1 = { ...circuit, wires: [...circuit.wires, { id: 'wire-1', from: board('d12'), to: led('anode') }] };
    expect(nextWireId(withWire1)).toBe('wire-2');
  });
});

describe('deleteWire', () => {
  it('removes only that wire and leaves the input untouched', () => {
    const before = structuredClone(circuit);

    const deleted = deleteWire(circuit, 'wire-d13-anode');

    expect(deleted.wires.map((wire) => wire.id)).toEqual(['wire-cathode-gnd']);
    expect(deleted.components).toEqual(circuit.components);
    expect(circuit).toEqual(before);
  });
});

describe('a circuit built with the editor operations', () => {
  it('has the netlist of the blink sample, and lights its LED the same way (L2)', () => {
    let built: Circuit = { components: [], wires: [] };
    const ids: Record<string, string> = {};
    for (const deviceType of ['board', 'resistor', 'led']) {
      const added = addComponent(built, deviceType, { x: 0, y: 0 });
      built = added.circuit;
      ids[deviceType] = added.componentId;
    }
    const port = (deviceType: string, portId: string) => ({ componentId: ids[deviceType] ?? '', portId });
    for (const [from, to] of [
      [port('board', 'd13'), port('resistor', 'a')],
      [port('resistor', 'b'), port('led', 'anode')],
      [port('led', 'cathode'), port('board', 'gnd')],
    ] as const) {
      const result = connectWire(built, registry, { id: nextWireId(built), from, to });
      if (!result.ok) {
        throw new Error(result.error);
      }
      built = result.circuit;
    }

    // Component ids differ (board-1 vs board), so compare nets by device type and port.
    const netsOf = (circuit: Circuit) => {
      const typeOf = new Map(circuit.components.map((component) => [component.id, component.deviceType]));
      const conducting = circuit.components
        .filter((component) => component.deviceType === 'resistor')
        .map((component): [PortRef, PortRef] => [
          { componentId: component.id, portId: 'a' },
          { componentId: component.id, portId: 'b' },
        ]);
      return buildNetlist(circuit, registry, conducting)
        .nets.map((net) => net.map((ref) => `${typeOf.get(ref.componentId)}/${ref.portId}`).sort().join(' '))
        .sort();
    };
    const sample = projectDocumentSchema.parse(blinkSample).circuit;
    expect(netsOf(built)).toEqual(netsOf(sample));

    const lit = (c: Circuit, ledId: string) =>
      simulateCircuit(c, registry, { powered: true, pinOutputs: { D13: 1 } }).components[ledId]?.lit;
    expect(lit(built, ids.led ?? '')).toBe(true);
    expect(lit(sample, 'led')).toBe(true);
  });
});
