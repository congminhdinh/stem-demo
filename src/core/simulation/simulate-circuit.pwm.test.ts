import { describe, expect, it } from 'vitest';
import type { Circuit, PortRef } from '../circuit/document';
import { deviceFamily } from '../devices/device-definition';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { PWM_DUTY_MAX } from './conversions';
import { pinSignal } from './pin-signal';
import { SERVO_REST_ANGLE, simulateCircuit, type SimulationInputs } from './simulate-circuit';

// N17 B5: what a PWM duty and a servo signal do on the nets of a Yolo:Bit-compatible board. A program writes `write_analog` (a
// duty 0..1023) or `servo_write` (an angle 0..180) to P0–P2; the simulation carries it on the pin's net. An LED fed from that net
// glows at duty / 1023; every other part reads the net as it reads a level (on while the duty is above 0). A servo whose signal is
// on the net, and which is powered from 3V3 and GND, turns to the angle; otherwise it rests at 90°.

const registry = createDeviceRegistry(localDeviceDefinitions);
const at = { x: 0, y: 0 };
const ref = (componentId: string, portId: string): PortRef => ({ componentId, portId });
const wires = (...pairs: [PortRef, PortRef][]) => pairs.map(([from, to], index) => ({ id: `w${index}`, from, to }));
const part = (id: string, deviceType: string) => ({ id, deviceType, position: at });

const run = (circuit: Circuit, inputs: Partial<SimulationInputs> = {}) => simulateCircuit(circuit, registry, { powered: true, pinOutputs: {}, ...inputs });
const pwm = (duty: number) => ({ kind: 'pwm', duty }) as const;
const servo = (angle: number) => ({ kind: 'servo', angle }) as const;

const board = part('b', 'ybc-board');
/** An LED fed from P0 through a resistor, to GND: the circuit of the brief. */
const ledOnP0: Circuit = {
  components: [board, part('r', 'resistor'), part('led', 'led')],
  wires: wires([ref('b', 'p0'), ref('r', 'a')], [ref('r', 'b'), ref('led', 'anode')], [ref('led', 'cathode'), ref('b', 'gnd')]),
};
/** A servo whose signal is on P1, powered from 3V3 and GND as the LED and the knob are. */
const servoOnP1: Circuit = {
  components: [board, part('servo', 'servo')],
  wires: wires([ref('servo', 'signal'), ref('b', 'p1')], [ref('servo', 'vcc'), ref('b', '3v3')], [ref('servo', 'gnd'), ref('b', 'gnd')]),
};

describe('the servo part', () => {
  it('is a device of the Yolo:Bit-compatible family with a signal, a 3V3 and a GND port, drawn by its own renderer', () => {
    const definition = registry.get('servo');
    expect(deviceFamily(definition)).toBe('ybc');
    expect(definition.name).toBe('Servo');
    expect(definition.ports.map((port) => [port.id, port.label])).toEqual([
      ['signal', 'SIG'],
      ['vcc', '3V3'],
      ['gnd', 'GND'],
    ]);
    expect(definition.ports.every((port) => port.kind === 'passive')).toBe(true);
    expect(definition.renderer).toBe('servo');
    expect(definition.simulation.model).toBe('servo');
  });

  it('rests at 90° (the default of every run) until a servo signal reaches it', () => {
    expect(SERVO_REST_ANGLE).toBe(90);
    expect(run(servoOnP1).components.servo).toEqual({ angle: 90 });
  });

  it('turns to the angle of the servo signal on its net', () => {
    expect(run(servoOnP1, { pinOutputs: { P1: servo(30) } }).components.servo).toEqual({ angle: 30 });
    expect(run(servoOnP1, { pinOutputs: { P1: servo(0) } }).components.servo).toEqual({ angle: 0 });
    expect(run(servoOnP1, { pinOutputs: { P1: servo(180) } }).components.servo).toEqual({ angle: 180 });
  });

  it('does not turn for a signal on another pin, for a level, for a PWM duty, unpowered, or when the board is off', () => {
    expect(run(servoOnP1, { pinOutputs: { P0: servo(30) } }).components.servo).toEqual({ angle: 90 });
    expect(run(servoOnP1, { pinOutputs: { P1: 1 } }).components.servo).toEqual({ angle: 90 });
    expect(run(servoOnP1, { pinOutputs: { P1: pwm(512) } }).components.servo).toEqual({ angle: 90 });
    const unpowered: Circuit = { ...servoOnP1, wires: servoOnP1.wires.filter((wire) => wire.from.portId !== 'vcc') };
    expect(run(unpowered, { pinOutputs: { P1: servo(30) } }).components.servo).toEqual({ angle: 90 });
    expect(run(servoOnP1, { powered: false, pinOutputs: { P1: servo(30) } }).components.servo).toEqual({ angle: 90 });
  });

  it('turns every servo on the pin', () => {
    const two: Circuit = {
      components: [...servoOnP1.components, part('servo2', 'servo')],
      wires: [
        ...servoOnP1.wires,
        ...wires([ref('servo2', 'signal'), ref('b', 'p1')], [ref('servo2', 'vcc'), ref('b', '3v3')], [ref('servo2', 'gnd'), ref('b', 'gnd')]),
      ],
    };
    const result = run(two, { pinOutputs: { P1: servo(150) } });
    expect([result.components.servo, result.components.servo2]).toEqual([{ angle: 150 }, { angle: 150 }]);
  });
});

describe('a PWM duty on the net of a pin', () => {
  it('lights an LED fed through the resistor in proportion: 0 off, 1023 the brightest', () => {
    expect(PWM_DUTY_MAX).toBe(1023);
    expect(run(ledOnP0, { pinOutputs: { P0: pwm(512) } }).components.led).toEqual({ lit: true, brightness: 512 / 1023 });
    expect(run(ledOnP0, { pinOutputs: { P0: pwm(1023) } }).components.led).toEqual({ lit: true, brightness: 1 });
    expect(run(ledOnP0, { pinOutputs: { P0: pwm(1) } }).components.led).toEqual({ lit: true, brightness: 1 / 1023 });
    expect(run(ledOnP0, { pinOutputs: { P0: pwm(0) } }).components.led).toEqual({ lit: false });
  });

  it('leaves an LED on a plain level exactly as before: lit or not, no brightness (projects made before N17 see the same state)', () => {
    expect(run(ledOnP0, { pinOutputs: { P0: 1 } }).components.led).toEqual({ lit: true });
    expect(run(ledOnP0, { pinOutputs: { P0: 0 } }).components.led).toEqual({ lit: false });
  });

  it('reads as a level to every other part: on while the duty is above 0, off at 0', () => {
    const high = run(ledOnP0, { pinOutputs: { P0: pwm(300) } });
    expect(pinSignal(high, 'b', 'p0')).toEqual({ kind: 'high' });
    expect(high.pinReads.P0).toBe(1);
    const low = run(ledOnP0, { pinOutputs: { P0: pwm(0) } });
    expect(pinSignal(low, 'b', 'p0')).toEqual({ kind: 'low' });
    expect(low.pinReads.P0).toBe(0);
  });

  it('is a conflict on a net something else drives (a rail, another pin), and lights nothing there', () => {
    const toRail: Circuit = { ...ledOnP0, wires: [...ledOnP0.wires, ...wires([ref('b', 'p0'), ref('b', '3v3')])] };
    const onRail = run(toRail, { pinOutputs: { P0: pwm(512) } });
    expect(pinSignal(onRail, 'b', 'p0')).toEqual({ kind: 'conflict' });
    expect(onRail.components.led).toEqual({ lit: false });
    const toPin: Circuit = { ...ledOnP0, wires: [...ledOnP0.wires, ...wires([ref('b', 'p0'), ref('b', 'p2')])] };
    expect(pinSignal(run(toPin, { pinOutputs: { P0: pwm(512), P2: 1 } }), 'b', 'p0')).toEqual({ kind: 'conflict' });
    expect(pinSignal(run(toPin, { pinOutputs: { P0: 1, P2: pwm(512) } }), 'b', 'p0')).toEqual({ kind: 'conflict' });
    // A duty of 0 is a steady low: on a net GND also holds low, nothing fights.
    const toGround: Circuit = { ...ledOnP0, wires: [...ledOnP0.wires, ...wires([ref('b', 'p0'), ref('b', 'gnd')])] };
    expect(pinSignal(run(toGround, { pinOutputs: { P0: pwm(0) } }), 'b', 'p0')).toEqual({ kind: 'low' });
  });
});

describe('a servo signal on the net of a pin', () => {
  it('reads as on to the other parts of the net, and fights anything else that drives it', () => {
    const withLed: Circuit = {
      components: [...servoOnP1.components, part('led', 'led')],
      wires: [...servoOnP1.wires, ...wires([ref('led', 'anode'), ref('b', 'p1')], [ref('led', 'cathode'), ref('b', 'gnd')])],
    };
    const result = run(withLed, { pinOutputs: { P1: servo(45) } });
    expect(pinSignal(result, 'b', 'p1')).toEqual({ kind: 'high' });
    expect(result.components.led).toEqual({ lit: true });
    const toRail: Circuit = { ...servoOnP1, wires: [...servoOnP1.wires, ...wires([ref('b', 'p1'), ref('b', '3v3')])] };
    const fought = run(toRail, { pinOutputs: { P1: servo(45) } });
    expect(pinSignal(fought, 'b', 'p1')).toEqual({ kind: 'conflict' });
    expect(fought.components.servo).toEqual({ angle: 90 });
  });
});
