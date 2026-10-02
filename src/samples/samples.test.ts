import { describe, expect, it } from 'vitest';
import { projectDocumentSchema, type Circuit } from '../core/circuit/document';
import { connectWire } from '../core/circuit/wires';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import blinkSample from './blink.project.json';
import ledOnSample from './led-on.project.json';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe.each([
  ['led-on', ledOnSample, ['board', 'led']],
  ['blink', blinkSample, ['board', 'resistor', 'led']],
])('%s sample', (_, sample, deviceTypes) => {
  it('is a project document whose wires all pass the wiring rules', () => {
    const document = projectDocumentSchema.parse(sample);

    let rebuilt: Circuit = { ...document.circuit, wires: [] };
    for (const wire of document.circuit.wires) {
      const result = connectWire(rebuilt, registry, wire);
      if (!result.ok) {
        throw new Error(`Wire ${wire.id} is invalid: ${result.error}`);
      }
      rebuilt = result.circuit;
    }

    expect(rebuilt).toEqual(document.circuit);
    expect(document.circuit.components.map((component) => component.deviceType)).toEqual(deviceTypes);
  });
});
