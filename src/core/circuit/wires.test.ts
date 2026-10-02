import { describe, expect, it } from 'vitest';
import ledOnSample from '../../samples/led-on.project.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { projectDocumentSchema, type PortRef } from './document';
import { connectWire, type ConnectWireError } from './wires';

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
