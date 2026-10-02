import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { isSamePort, projectDocumentSchema, type Circuit, type PortRef } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { simulateCircuit, type SimulationInputs, type SimulationResult } from './simulate-circuit';

const registry = createDeviceRegistry(localDeviceDefinitions);
const ledOn = projectDocumentSchema.parse(ledOnSample).circuit;
const blink = projectDocumentSchema.parse(blinkSample).circuit;

const board = (portId: string) => ({ componentId: 'board', portId });
const led = (portId: string) => ({ componentId: 'led', portId });
const powered = (pinOutputs: SimulationInputs['pinOutputs'] = {}): SimulationInputs => ({ powered: true, pinOutputs });

const rewired = (circuit: Circuit, ...wires: [PortRef, PortRef][]): Circuit => ({
  ...circuit,
  wires: wires.map(([from, to], index) => ({ id: `wire-${index}`, from, to })),
});
const levelAt = (result: SimulationResult, port: PortRef) =>
  result.nets.find((net) => net.ports.some((member) => isSamePort(member, port)))?.level;

describe('simulateCircuit', () => {
  it('lights the LED of the led-on sample when D13 is HIGH (Minimum Proof)', () => {
    const result = simulateCircuit(ledOn, registry, powered({ D13: 1 }));

    expect(result.components).toEqual({ led: { lit: true } });
    expect(levelAt(result, led('anode'))).toBe('high');
    expect(levelAt(result, led('cathode'))).toBe('low');
  });

  it.each<[string, SimulationInputs['pinOutputs']]>([
    ['D13 is LOW', { D13: 0 }],
    ['D13 is not written', {}],
    ['only another pin is HIGH', { D12: 1 }],
  ])('keeps the led-on LED off when %s', (_, pinOutputs) => {
    expect(simulateCircuit(ledOn, registry, powered(pinOutputs)).components).toEqual({ led: { lit: false } });
  });

  it('leaves a pin nothing drives floating', () => {
    expect(levelAt(simulateCircuit(ledOn, registry, powered()), board('d13'))).toBe('floating');
  });

  it('keeps a reversed LED off', () => {
    const reversed = rewired(ledOn, [board('d13'), led('cathode')], [led('anode'), board('gnd')]);

    expect(simulateCircuit(reversed, registry, powered({ D13: 1 })).components).toEqual({ led: { lit: false } });
  });

  it('keeps an LED off when its cathode is not wired to GND', () => {
    const noGround = rewired(ledOn, [board('d13'), led('anode')]);

    expect(simulateCircuit(noGround, registry, powered({ D13: 1 })).components).toEqual({ led: { lit: false } });
  });

  it('keeps a disconnected LED off', () => {
    const disconnected = rewired(ledOn);

    expect(simulateCircuit(disconnected, registry, powered({ D13: 1 })).components).toEqual({ led: { lit: false } });
  });

  it.each([
    [1, true],
    [0, false],
  ] as const)('conducts through the resistor of the blink sample: D13 = %i → lit %s', (level, lit) => {
    expect(simulateCircuit(blink, registry, powered({ D13: level })).components).toEqual({ led: { lit } });
  });

  it('reports D13 HIGH wired straight to GND as a conflict instead of failing', () => {
    const shorted: Circuit = { ...ledOn, wires: [...ledOn.wires, { id: 'short', from: board('d13'), to: board('gnd') }] };

    const result = simulateCircuit(shorted, registry, powered({ D13: 1 }));

    expect(levelAt(result, board('d13'))).toBe('conflict');
    expect(result.components).toEqual({ led: { lit: false } });
    expect(result.pinReads.D13).toBe(0);
  });

  it('reads a pin from its net: D2 wired to D13 reads 1, an unconnected D2 reads 0', () => {
    const linked: Circuit = { ...ledOn, wires: [...ledOn.wires, { id: 'link', from: board('d2'), to: board('d13') }] };

    expect(simulateCircuit(linked, registry, powered({ D13: 1 })).pinReads.D2).toBe(1);
    expect(simulateCircuit(ledOn, registry, powered({ D13: 1 })).pinReads.D2).toBe(0);
  });

  it('drives the 3V3 rail HIGH: 3V3 → LED → GND lights without a program', () => {
    const railToRail = rewired(ledOn, [board('3v3'), led('anode')], [led('cathode'), board('gnd')]);

    expect(simulateCircuit(railToRail, registry, powered()).components).toEqual({ led: { lit: true } });
  });

  it('drives nothing while the board is unpowered', () => {
    const result = simulateCircuit(ledOn, registry, { powered: false, pinOutputs: { D13: 1 } });

    expect(result.nets.map((net) => net.level)).toEqual(result.nets.map(() => 'floating'));
    expect(result.components).toEqual({ led: { lit: false } });
    expect(result.pinReads.D13).toBe(0);
  });

  it('treats a device with an unknown simulation model as inert', () => {
    const withMystery = createDeviceRegistry([
      ...localDeviceDefinitions,
      { ...registry.get('resistor'), id: 'mystery', simulation: { model: 'mystery' } },
    ]);
    const mystery = (portId: string) => ({ componentId: 'mystery', portId });
    const circuit = rewired(
      {
        ...ledOn,
        components: [...ledOn.components, { id: 'mystery', deviceType: 'mystery', position: { x: 300, y: 400 } }],
      },
      [board('d13'), mystery('a')],
      [mystery('b'), led('anode')],
      [led('cathode'), board('gnd')],
    );

    expect(simulateCircuit(circuit, withMystery, powered({ D13: 1 })).components).toEqual({ led: { lit: false } });
  });

  it('returns plain JSON, leaves its inputs unchanged and gives the same result for the same input', () => {
    const inputs = powered({ D13: 1 });
    const before = structuredClone({ blink, inputs });

    const result = simulateCircuit(blink, registry, inputs);

    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    expect({ blink, inputs }).toStrictEqual(before);
    expect(simulateCircuit(blink, registry, inputs)).toStrictEqual(result);
  });
});
