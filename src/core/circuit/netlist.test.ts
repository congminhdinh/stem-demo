import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { projectDocumentSchema, type Circuit, type PortRef } from './document';
import { buildNetlist } from './netlist';

const registry = createDeviceRegistry(localDeviceDefinitions);
const circuit = projectDocumentSchema.parse(ledOnSample).circuit;
const board = (portId: string) => ({ componentId: 'board', portId });
const led = (portId: string) => ({ componentId: 'led', portId });

describe('buildNetlist', () => {
  it('puts the two ends of each wire on the same net (led-on sample)', () => {
    const netlist = buildNetlist(circuit, registry);

    expect(netlist.netOf(board('d13'))).toBe(netlist.netOf(led('anode')));
    expect(netlist.netOf(led('cathode'))).toBe(netlist.netOf(board('gnd')));
    expect(netlist.netOf(board('d13'))).not.toBe(netlist.netOf(board('gnd')));
  });

  it('keeps an unconnected port alone on its own net', () => {
    const netlist = buildNetlist(circuit, registry);

    expect(netlist.nets[netlist.netOf(board('d12'))]).toEqual([board('d12')]);
  });

  it('merges a chain of wires into one net', () => {
    const chained: Circuit = {
      ...circuit,
      wires: [...circuit.wires, { id: 'wire-anode-d12', from: led('anode'), to: board('d12') }],
    };
    const netlist = buildNetlist(chained, registry);

    expect(netlist.netOf(board('d13'))).toBe(netlist.netOf(board('d12')));
    expect(netlist.netOf(board('d12'))).not.toBe(netlist.netOf(board('gnd')));
  });

  it('merges extra conducting connections reported by simulation models', () => {
    const netlist = buildNetlist(circuit, registry, [[led('anode'), led('cathode')]]);

    expect(netlist.netOf(board('d13'))).toBe(netlist.netOf(board('gnd')));
  });

  it('keeps the resistor between two nets (blink sample); conduction is left to the simulation', () => {
    const netlist = buildNetlist(projectDocumentSchema.parse(blinkSample).circuit, registry);
    const resistor = (portId: string) => ({ componentId: 'resistor', portId });
    const netMembers = (port: PortRef) =>
      netlist.nets[netlist.netOf(port)]?.map((member) => `${member.componentId}/${member.portId}`).sort();

    expect(netMembers(board('d13'))).toEqual(['board/d13', 'resistor/a']);
    expect(netMembers(resistor('b'))).toEqual(['led/anode', 'resistor/b']);
    expect(netMembers(led('cathode'))).toEqual(['board/gnd', 'led/cathode']);
  });
});
