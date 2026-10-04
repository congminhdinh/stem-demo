import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import buttonDirectSample from '../../samples/button-direct.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { isSamePort, projectDocumentSchema, type Circuit, type PortRef } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { simulateCircuit, type SimulationInputs, type SimulationResult } from './simulate-circuit';

const registry = createDeviceRegistry(localDeviceDefinitions);
const ledOn = projectDocumentSchema.parse(ledOnSample).circuit;
const blink = projectDocumentSchema.parse(blinkSample).circuit;
const buttonDirect = projectDocumentSchema.parse(buttonDirectSample).circuit;

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

  describe('contact (push button)', () => {
    const button = (portId: string) => ({ componentId: 'button', portId });
    const held = (contacts: Record<string, boolean>): SimulationInputs => ({ ...powered(), contacts });

    it('conducts only while closed: 3V3 → button → R → LED → GND lights while held, without a program', () => {
      expect(simulateCircuit(buttonDirect, registry, held({ button: true })).components).toEqual({
        led: { lit: true },
        button: { closed: true },
      });
      for (const inputs of [powered(), held({}), held({ button: false })]) {
        expect(simulateCircuit(buttonDirect, registry, inputs).components).toEqual({
          led: { lit: false },
          button: { closed: false },
        });
      }
    });

    it('reads D2 wired through the button to 3V3: 1 while closed, 0 while open', () => {
      const circuit = rewired(
        { ...buttonDirect, components: buttonDirect.components.filter(({ id }) => id === 'board' || id === 'button') },
        [board('3v3'), button('a')],
        [button('b'), board('d2')],
      );

      expect(simulateCircuit(circuit, registry, held({ button: true })).pinReads.D2).toBe(1);
      expect(simulateCircuit(circuit, registry, held({ button: false })).pinReads.D2).toBe(0);
    });

    it('drives nothing through a closed contact while the board is unpowered', () => {
      const inputs = { powered: false, pinOutputs: {}, contacts: { button: true } };

      expect(simulateCircuit(buttonDirect, registry, inputs).components.led).toEqual({ lit: false });
    });

    it('closes only the contacts named in the input', () => {
      // The same circuit with the button named like an Object.prototype member.
      const constructor = (portId: string) => ({ componentId: 'constructor', portId });
      const renamed = rewired(
        {
          ...buttonDirect,
          components: buttonDirect.components.map((component) =>
            component.id === 'button' ? { ...component, id: 'constructor' } : component,
          ),
        },
        [board('3v3'), constructor('a')],
        [constructor('b'), { componentId: 'resistor', portId: 'a' }],
        [{ componentId: 'resistor', portId: 'b' }, led('anode')],
        [led('cathode'), board('gnd')],
      );

      // The LED is not a contact, and an id is never read off Object.prototype.
      expect(simulateCircuit(buttonDirect, registry, held({ led: true })).components.led).toEqual({ lit: false });
      expect(simulateCircuit(renamed, registry, held({})).components).toEqual({
        led: { lit: false },
        constructor: { closed: false },
      });
      expect(simulateCircuit(renamed, registry, held({ constructor: true })).components.led).toEqual({ lit: true });
    });
  });
});
