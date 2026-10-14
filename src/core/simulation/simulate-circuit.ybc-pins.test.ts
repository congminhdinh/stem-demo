import { describe, expect, it } from 'vitest';
import type { Circuit, PortRef } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { analogValueOf, pinSignal } from './pin-signal';
import { circuitInputKind, clampSliderPercent, simulateCircuit, type SimulationInputs } from './simulate-circuit';

// Signal-level simulation of the header pins (YB plan §11.1, YB-4): a Yolo:Bit-compatible board drives its
// pins from the program, and a potentiometer is the analog source (the only signal that is not a logic level).
// The generic board's behaviour is pinned by tests/generic-baseline.test.ts and simulate-circuit.test.ts.

const registry = createDeviceRegistry(localDeviceDefinitions);
const at = { x: 0, y: 0 };
const ref = (componentId: string, portId: string): PortRef => ({ componentId, portId });
const wires = (...pairs: [PortRef, PortRef][]) => pairs.map(([from, to], index) => ({ id: `w${index}`, from, to }));
const part = (id: string, deviceType: string) => ({ id, deviceType, position: at });

const run = (circuit: Circuit, inputs: Partial<SimulationInputs> = {}) =>
  simulateCircuit(circuit, registry, { powered: true, pinOutputs: {}, ...inputs });

const board = part('b', 'ybc-board');
/** The knob on P1, wired the way a learner wires it: VCC to 3V3, GND to GND, OUT to P1. */
const knobOnP1: Circuit = {
  components: [board, part('pot', 'potentiometer')],
  wires: wires([ref('pot', 'vcc'), ref('b', '3v3')], [ref('pot', 'gnd'), ref('b', 'gnd')], [ref('pot', 'out'), ref('b', 'p1')]),
};
const ledOnP0: Circuit = {
  components: [board, part('led', 'led')],
  wires: wires([ref('b', 'p0'), ref('led', 'anode')], [ref('led', 'cathode'), ref('b', 'gnd')]),
};

describe('a Yolo:Bit-compatible board is powered and drives its pins', () => {
  it('puts 3V3 high and GND low, and every pin reads low until something drives it', () => {
    const result = run({ components: [board], wires: [] });
    expect(pinSignal(result, 'b', '3v3')).toEqual({ kind: 'high' });
    expect(pinSignal(result, 'b', 'gnd')).toEqual({ kind: 'low' });
    expect(pinSignal(result, 'b', 'p0')).toEqual({ kind: 'floating' });
    expect(result.pinReads).toEqual({ P0: 0, P1: 0, P2: 0 });
  });

  it('drives nothing while unpowered', () => {
    const result = run(ledOnP0, { powered: false, pinOutputs: { P0: 1 } });
    expect(result.nets.every((net) => net.level === 'floating')).toBe(true);
    expect(result.components.led).toEqual({ lit: false });
  });

  it('lights an LED from P0 and puts it out again (digital write, the LED is the output)', () => {
    expect(run(ledOnP0, { pinOutputs: { P0: 1 } }).components.led).toEqual({ lit: true });
    expect(run(ledOnP0, { pinOutputs: { P0: 0 } }).components.led).toEqual({ lit: false });
    expect(run(ledOnP0).components.led).toEqual({ lit: false });
  });

  it('treats a resistor in the path as a conductor, as the generic board does', () => {
    const circuit: Circuit = {
      components: [board, part('r', 'resistor'), part('led', 'led')],
      wires: wires([ref('b', 'p2'), ref('r', 'a')], [ref('r', 'b'), ref('led', 'anode')], [ref('led', 'cathode'), ref('b', 'gnd')]),
    };
    expect(run(circuit, { pinOutputs: { P2: 1 } }).components.led).toEqual({ lit: true });
  });

  it('reports a pin driven against a rail as a conflict, not as a level', () => {
    const result = run(ledOnP0, { pinOutputs: { P0: 1 } });
    expect(pinSignal(result, 'led', 'anode')).toEqual({ kind: 'high' });
    const shorted: Circuit = { components: [board], wires: wires([ref('b', 'p0'), ref('b', 'gnd')]) };
    expect(pinSignal(run(shorted, { pinOutputs: { P0: 1 } }), 'b', 'p0')).toEqual({ kind: 'conflict' });
    // The same wire with the pin low is no conflict: both drive low.
    expect(pinSignal(run(shorted, { pinOutputs: { P0: 0 } }), 'b', 'p0')).toEqual({ kind: 'low' });
  });

  it('lets one pin drive another through a wire (a loopback), and a button open that path', () => {
    const loop: Circuit = { components: [board], wires: wires([ref('b', 'p0'), ref('b', 'p1')]) };
    expect(pinSignal(run(loop, { pinOutputs: { P0: 1 } }), 'b', 'p1')).toEqual({ kind: 'high' });
    const withButton: Circuit = {
      components: [board, part('btn', 'push-button')],
      wires: wires([ref('b', 'p0'), ref('btn', 'a')], [ref('btn', 'b'), ref('b', 'p1')]),
    };
    // Open: nothing drives P1. This is the floating read that stops a program (contract C-24).
    expect(pinSignal(run(withButton, { pinOutputs: { P0: 1 } }), 'b', 'p1')).toEqual({ kind: 'floating' });
    expect(pinSignal(run(withButton, { pinOutputs: { P0: 1 }, contacts: { btn: true } }), 'b', 'p1')).toEqual({ kind: 'high' });
  });
});

describe('the potentiometer is an analog source', () => {
  it('drives OUT with its slider position while VCC is high and GND is low', () => {
    const result = run(knobOnP1, { sliders: { pot: 37 } });
    expect(pinSignal(result, 'b', 'p1')).toEqual({ kind: 'analog', percent: 37 });
    expect(result.nets.find((net) => net.level === 'analog')).toMatchObject({ analogPercent: 37 });
    // The knob is drawn from the snapshot, from the same number.
    expect(result.components.pot).toEqual({ value: 37 });
  });

  it('rests at 0 % until it is moved, and a net that is not analog carries no `analogPercent`', () => {
    const result = run(knobOnP1);
    expect(pinSignal(result, 'b', 'p1')).toEqual({ kind: 'analog', percent: 0 });
    expect(result.components.pot).toEqual({ value: 0 });
    expect(result.nets.filter((net) => net.level !== 'analog').every((net) => !('analogPercent' in net))).toBe(true);
  });

  it('clamps the position to 0..100, and takes anything that is not a whole number as the resting position', () => {
    expect(run(knobOnP1, { sliders: { pot: 250 } }).components.pot).toEqual({ value: 100 });
    expect(run(knobOnP1, { sliders: { pot: -3 } }).components.pot).toEqual({ value: 0 });
    expect(run(knobOnP1, { sliders: { pot: 12.5 } }).components.pot).toEqual({ value: 0 });
    expect(run(knobOnP1, { sliders: { pot: Number.NaN } }).components.pot).toEqual({ value: 0 });
    expect(run(knobOnP1, { sliders: { pot: Number.POSITIVE_INFINITY } }).components.pot).toEqual({ value: 0 });
    expect([clampSliderPercent(0), clampSliderPercent(100), clampSliderPercent(101), clampSliderPercent(-1)]).toEqual([0, 100, 100, 0]);
  });

  it('reads an input by its own key only: an id such as "constructor" rests at 0', () => {
    const circuit: Circuit = {
      components: [board, part('constructor', 'potentiometer')],
      wires: wires([ref('constructor', 'vcc'), ref('b', '3v3')], [ref('constructor', 'gnd'), ref('b', 'gnd')], [ref('constructor', 'out'), ref('b', 'p1')]),
    };
    expect(run(circuit).components.constructor).toEqual({ value: 0 });
    expect(run(circuit, { sliders: { constructor: 80 } }).components.constructor).toEqual({ value: 80 });
  });

  it('drives nothing unless its own rails are right: unpowered, reversed or unconnected', () => {
    expect(pinSignal(run(knobOnP1, { powered: false }), 'b', 'p1')).toEqual({ kind: 'floating' });
    const reversed: Circuit = {
      ...knobOnP1,
      wires: wires([ref('pot', 'vcc'), ref('b', 'gnd')], [ref('pot', 'gnd'), ref('b', '3v3')], [ref('pot', 'out'), ref('b', 'p1')]),
    };
    expect(pinSignal(run(reversed), 'b', 'p1')).toEqual({ kind: 'floating' });
    const noGround: Circuit = { ...knobOnP1, wires: knobOnP1.wires.filter((wire) => wire.from.portId !== 'gnd') };
    expect(pinSignal(run(noGround), 'b', 'p1')).toEqual({ kind: 'floating' });
    // The component state is still reported: the knob is where the learner left it.
    expect(run(reversed, { sliders: { pot: 60 } }).components.pot).toEqual({ value: 60 });
  });

  it('is a conflict when another driver is on the same net: a pin written high, a rail, or a second wiper', () => {
    expect(pinSignal(run(knobOnP1, { pinOutputs: { P1: 1 } }), 'b', 'p1')).toEqual({ kind: 'conflict' });
    const railed: Circuit = { ...knobOnP1, wires: [...knobOnP1.wires, ...wires([ref('pot', 'out'), ref('b', '3v3')])] };
    expect(pinSignal(run(railed), 'b', 'p1')).toEqual({ kind: 'conflict' });
    const two: Circuit = {
      components: [...knobOnP1.components, part('pot2', 'potentiometer')],
      wires: [
        ...knobOnP1.wires,
        ...wires([ref('pot2', 'vcc'), ref('b', '3v3')], [ref('pot2', 'gnd'), ref('b', 'gnd')], [ref('pot2', 'out'), ref('b', 'p1')]),
      ],
    };
    expect(pinSignal(run(two, { sliders: { pot: 10, pot2: 10 } }), 'b', 'p1')).toEqual({ kind: 'conflict' });
  });

  it('does not light an LED: an analog level is neither on nor off', () => {
    const circuit: Circuit = {
      components: [...knobOnP1.components, part('led', 'led')],
      wires: [...knobOnP1.wires, ...wires([ref('b', 'p1'), ref('led', 'anode')], [ref('led', 'cathode'), ref('b', 'gnd')])],
    };
    expect(run(circuit, { sliders: { pot: 100 } }).components.led).toEqual({ lit: false });
  });

  it('is independent of the pin outputs of other pins', () => {
    const result = run(knobOnP1, { sliders: { pot: 55 }, pinOutputs: { P0: 1, P2: 0 } });
    expect(pinSignal(result, 'b', 'p1')).toEqual({ kind: 'analog', percent: 55 });
  });
});

describe('what a reader of a pin gets from a signal (contract C-25, C-Q6 = Option A)', () => {
  it('reads high as 4095, low as 0 and a wiper as percentToNative(p, 4095); nothing else has a value', () => {
    expect(analogValueOf({ kind: 'high' })).toBe(4095);
    expect(analogValueOf({ kind: 'low' })).toBe(0);
    expect(analogValueOf({ kind: 'floating' })).toBeNull();
    expect(analogValueOf({ kind: 'conflict' })).toBeNull();
    const expected: [number, number][] = [[0, 0], [1, 41], [25, 1024], [33, 1351], [50, 2048], [75, 3071], [99, 4054], [100, 4095]];
    for (const [percent, native] of expected) {
      expect(analogValueOf({ kind: 'analog', percent }), `${percent} %`).toBe(native);
    }
  });

  it('keeps every slider position inside the native scale and in order', () => {
    let previous = -1;
    for (let percent = 0; percent <= 100; percent++) {
      const value = analogValueOf({ kind: 'analog', percent });
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(previous);
      expect(value as number).toBeLessThanOrEqual(4095);
      previous = value as number;
    }
  });

  it('says the port is undriven when it is on no net of the result', () => {
    expect(pinSignal({ nets: [], components: {}, pinReads: {} }, 'b', 'p0')).toEqual({ kind: 'floating' });
  });
});

describe('the runtime input a component of the circuit takes', () => {
  it('is hold for a contact, slider for a potentiometer, and none for the rest', () => {
    expect(circuitInputKind(registry.get('push-button'))).toBe('hold');
    expect(circuitInputKind(registry.get('potentiometer'))).toBe('slider');
    for (const id of ['led', 'resistor', 'board', 'ybc-board']) {
      expect(circuitInputKind(registry.get(id)), id).toBeUndefined();
    }
  });
});
