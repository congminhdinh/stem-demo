import type { Circuit, ComponentInstance, PortRef } from '../circuit/document';
import { buildNetlist } from '../circuit/netlist';
import type { DeviceDefinition } from '../devices/device-definition';
import type { Frame } from '../capabilities/frame';
import type { DeviceRegistry } from '../devices/registry';
import { dutyToBrightness } from './conversions';

// Net-level logic simulation (plan §6.5): a pure function of the design and
// the runtime inputs, recomputed in full on every change.
//
// Known limits (logic, not electrical):
// - Resistance is ignored: a HIGH pin through a resistor to GND is reported
//   as a conflict, although the real circuit is fine.
// - No pull-up/pull-down: a floating pin reads 0 (an implicit pull-down) on the
//   generic board. A Yolo:Bit-compatible board does not guess: the reader of the
//   pin sees `floating` (and the program stops, see run/ybc-pin-io.ts).
// - Two LEDs in series stay off: the net between them is floating.
// - No voltage, current, burn-out or transients; all rails share one
//   reference. An LED's brightness is a PWM duty's only (N17 B5, below).
// - The one signal that is not a logic level is an analog source's output (YB-4, a potentiometer's wiper):
//   a net it alone drives is `analog`, with the slider position as a percentage.
// - N17 B5: a pin a program drives with a PWM duty (`write_analog`, 0..1023) or a servo signal (`servo_write`, 0..180°) carries
//   it on its net. Such a pulse train is on part of the time: to every other part the net reads as on (high; a duty of 0 is a
//   steady low), and anything else that drives the net fights it (a conflict). An LED fed from a PWM net is lit at duty / 1023
//   (`brightness`); on any other high net it is lit as before, with no brightness. A servo powered from a high and a low rail
//   turns to the angle of a servo signal on its own net, and rests at 90° otherwise: the simulation keeps no memory, so a servo
//   whose signal stops goes back to 90° (a real one stays where it was). An LED whose cathode is on a PWM pin follows the level
//   (off while the duty is above 0), not the inverse duty.

export type SimulationInputs = {
  /** Run powers the board (plan §6.4 E1). Nothing drives a net while unpowered. */
  powered: boolean;
  /** What the program drives, by board pin name: a level, or (N17 B5) a PWM duty or a servo signal. A pin left out is not driven. */
  pinOutputs: Readonly<Record<string, PinOutput>>;
  /** Contacts held closed (a pressed push button), by component id. One left out is open. */
  contacts?: Readonly<Record<string, boolean>>;
  /**
   * The runtime input of every other component, by component id: the one `ComponentInput` every control uses
   * (plan §11.3), not a field per kind of control. A model reads the input of its own component and an id that
   * names no component is ignored. The potentiometer (`analog-source`, YB-4) is the first model to take one.
   */
  inputs?: Readonly<Record<string, ComponentInput>>;
};

/** `analog`: driven by exactly one analog source (a potentiometer wiper); the position is the net's `analogPercent`. */
export type NetLevel = 'floating' | 'high' | 'low' | 'conflict' | 'analog';

/**
 * A component's runtime state for its renderer (plan §11.4). The generic circuit uses `lit` (an LED) and
 * `closed` (a contact) only; the rest is the peripheral state of a Yolo:Bit-compatible board, written by
 * the models YB-3 and YB-4 add (none exists at YB-CP). Every field is optional, so a generic snapshot is
 * exactly what it was (GB4).
 */
export type ComponentState = {
  lit?: boolean;
  closed?: boolean;
  /** An external LED's brightness, 0..1 (presentation). */
  brightness?: number;
  /** A sensor or a slider-driven value, in the scale of the peripheral. */
  value?: number;
  /** The display's current frame (contract §4.3). */
  frame?: Frame;
  /** The tone the buzzer is playing, in Hz; absent when silent (plan §11.5: the core knows the Hz, WebAudio is a renderer). */
  hz?: number;
  /** A servo's angle. */
  angle?: number;
};

/**
 * N17 B5: what a program drives a pin with besides a level. `pwm` is `write_analog`'s duty, 0..1023 (0 is a steady low, anything
 * else a pulse train); `servo` is `servo_write`'s pulse train for an angle, 0..180°. The capability that writes them has checked
 * their range (run/ybc-pin-io.ts).
 */
export type PinSignalOutput = { kind: 'pwm'; duty: number } | { kind: 'servo'; angle: number };
/** What a program drives a pin with: a level, or a signal (N17 B5). */
export type PinOutput = 0 | 1 | PinSignalOutput;

/** Whether two pin outputs are the same drive (a level, or a signal of the same kind and value). */
export function samePinOutput(a: PinOutput | undefined, b: PinOutput | undefined): boolean {
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  if (a.kind === 'pwm') {
    return b.kind === 'pwm' && a.duty === b.duty;
  }
  return b.kind === 'servo' && a.angle === b.angle;
}

/** N17 B5: where a servo stands when no servo signal reaches it: at 90°, the middle of its 0..180°, at every run start and Stop. */
export const SERVO_REST_ANGLE = 90;

/** The tone state of the buzzer: what `ComponentState.hz` says while a note plays. */
export type ToneState = Required<Pick<ComponentState, 'hz'>>;

/**
 * Whether two states say the same thing, whatever order their properties were written in; a property that is
 * `undefined` is a property that is absent. The frame is compared pixel by pixel. A property this does not know
 * compares by identity, so a state is published once too often and never once too rarely.
 */
export function sameComponentState(a: ComponentState, b: ComponentState): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ComponentState>) {
    if (key === 'frame' ? !sameFrame(a.frame, b.frame) : !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

function sameFrame(a: Frame | undefined, b: Frame | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.pixels.length !== b.pixels.length) {
    return false;
  }
  // Every index is read: a sparse frame is not a short one.
  for (let index = 0; index < a.pixels.length; index += 1) {
    if (!Object.is(a.pixels[index], b.pixels[index])) {
      return false;
    }
  }
  return true;
}

/**
 * A runtime input of a component (plan §11.3, YB-CP deliverable 2). Inputs belong to the run, never to the
 * document (B2). `hold` is a push button or a board button (Space/Enter or pointer down/up); `slider` is an
 * integer in the peripheral's range (clamped at its ends by the peripheral); `tilt` the accelerometer, in mg
 * (N17 B2: `z` absent is the rest of the board's weight, face up; a positive `z` is face down);
 * `gesture` a one-shot event (shake).
 */
export type ComponentInput =
  | { kind: 'hold'; closed: boolean }
  | { kind: 'slider'; value: number }
  | { kind: 'tilt'; x: number; y: number; z?: number }
  | { kind: 'gesture' };

export type ComponentInputKind = ComponentInput['kind'];

/** The input a model takes (plan §11.2); a model that takes none (display, buzzer) is not listed. */
export const inputKindOfModel: Readonly<Record<string, ComponentInputKind>> = {
  button: 'hold',
  'light-sensor': 'slider',
  'temperature-sensor': 'slider',
  accelerometer: 'tilt',
  // A device of the circuit, not an onboard part: its input is routed by id like a contact's (plan §6.5).
  'analog-source': 'slider',
};

/**
 * The one-shot event a model takes besides its input (N17 B2): the accelerometer is shaken. An event is not a state: it never
 * replaces the model's input (the tilt stays), and the run keeps only when it last happened.
 */
export const eventKindOfModel: Readonly<Record<string, ComponentInputKind>> = {
  accelerometer: 'gesture',
};

/**
 * The id of an onboard peripheral in snapshots and inputs: `<board>/<peripheral>` (plan §11.2). A peripheral id
 * never contains `/`, so the split is at the last one, whatever characters the board's own id has.
 */
export const peripheralComponentId = (boardId: string, peripheralId: string) => `${boardId}/${peripheralId}`;

export function splitPeripheralComponentId(componentId: string): { boardId: string; peripheralId: string } | null {
  const cut = componentId.lastIndexOf('/');
  return cut <= 0 || cut === componentId.length - 1
    ? null
    : { boardId: componentId.slice(0, cut), peripheralId: componentId.slice(cut + 1) };
}

/** Whether a value read from a hook or a UI event is a well-formed input. */
export function isComponentInput(value: unknown): value is ComponentInput {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  switch (input.kind) {
    case 'hold':
      return typeof input.closed === 'boolean';
    case 'slider':
      return typeof input.value === 'number' && Number.isInteger(input.value);
    case 'tilt':
      return Number.isFinite(input.x) && Number.isFinite(input.y) && (input.z === undefined || Number.isFinite(input.z));
    case 'gesture':
      return true;
    default:
      return false;
  }
}

/**
 * A copy of a valid input that nothing else holds: what a run keeps (the caller may go on editing its own object),
 * what it hands out and what it gives the simulation. It is written kind by kind, so a new kind of input cannot be
 * forgotten here, and equal inputs get the same property order, so they also compare equal as text.
 */
export function copyComponentInput(input: ComponentInput): ComponentInput {
  switch (input.kind) {
    case 'hold':
      return { kind: 'hold', closed: input.closed };
    case 'slider':
      return { kind: 'slider', value: input.value };
    case 'tilt':
      return input.z === undefined ? { kind: 'tilt', x: input.x, y: input.y } : { kind: 'tilt', x: input.x, y: input.y, z: input.z };
    case 'gesture':
      return { kind: 'gesture' };
  }
}

/** Plain JSON, so it can travel in a run snapshot. */
export type SimulationResult = {
  /** `analogPercent` (0..100) is present only on a net whose level is `analog`. */
  nets: { ports: PortRef[]; level: NetLevel; analogPercent?: number }[];
  /** Runtime state for renderers, by component id. */
  components: Record<string, ComponentState>;
  /** What `digitalRead` returns, by board pin name: 1 only on a high net. */
  pinReads: Record<string, 0 | 1>;
};

const contactModel = 'contact';
const analogSourceModel = 'analog-source';
const servoModel = 'servo';
/** The models of a board whose pins a program drives and reads: the generic board and the Yolo:Bit-compatible one. */
const boardModels: ReadonlySet<string> = new Set(['board', 'ybc-board']);

/**
 * A contact (the push button) conducts between its ports `a` and `b` while
 * closed. Closing it is a runtime input (`contacts`), never design state (B2).
 */
export function isContact(definition: DeviceDefinition): boolean {
  return definition.simulation.model === contactModel;
}

/** The slider range, in percent: the analog source clamps at its ends. */
export const SLIDER_MIN_PERCENT = 0;
export const SLIDER_MAX_PERCENT = 100;

/** A slider value as the analog source takes it: a whole number clamped to 0..100. Anything else is the resting position 0. */
export function clampSliderPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return SLIDER_MIN_PERCENT;
  }
  return Math.min(SLIDER_MAX_PERCENT, Math.max(SLIDER_MIN_PERCENT, value));
}

/**
 * Models are picked by `simulation.model`; an unknown model is inert (B6).
 * Assumes a valid document (plan §6.1 I1–I2), like `buildNetlist`. For one,
 * it never throws: shorts, floating nets and reversed LEDs are results.
 */
export function simulateCircuit(
  circuit: Circuit,
  registry: DeviceRegistry,
  inputs: SimulationInputs,
): SimulationResult {
  const devices = circuit.components.map((component) => ({
    component,
    definition: registry.get(component.deviceType),
  }));
  const withModel = (model: string) => devices.filter(({ definition }) => definition.simulation.model === model);
  const boards = devices.filter(({ definition }) => boardModels.has(definition.simulation.model));
  const contacts = withModel(contactModel).map(({ component }) => ({
    component,
    // Strictly true: an id such as "constructor" must not read an Object.prototype member as closed.
    closed: inputs.contacts?.[component.id] === true,
  }));
  const analogSources = withModel(analogSourceModel).map(({ component }) => {
    // Ids are data: only an own key is an input, so "constructor" rests at 0; and only a slider is a position.
    const input = inputs.inputs && Object.hasOwn(inputs.inputs, component.id) ? inputs.inputs[component.id] : undefined;
    return { component, percent: clampSliderPercent(input?.kind === 'slider' ? input.value : 0) };
  });

  // A resistor always conducts between its two ports; a contact only while closed.
  const conducting = [...withModel('resistor'), ...contacts.filter(({ closed }) => closed)].map(
    ({ component }): [PortRef, PortRef] => [port(component, 'a'), port(component, 'b')],
  );
  const netlist = buildNetlist(circuit, registry, conducting);

  // Net index → level; a net nothing drives is floating.
  const levels = new Map<number, NetLevel>();
  const netLevel = (net: number): NetLevel => levels.get(net) ?? 'floating';
  const levelOf = (ref: PortRef) => netLevel(netlist.netOf(ref));
  // N17 B5: the signal a pin drives its net with (a PWM duty above 0, a servo pulse train), by net index. It counts only while the
  // net is high, its own: a net it shares with another driver is a conflict.
  const signals = new Map<number, PinSignalOutput>();
  const signalOf = (ref: PortRef) => {
    const net = netlist.netOf(ref);
    return netLevel(net) === 'high' ? signals.get(net) : undefined;
  };
  const drive = (ref: PortRef, level: 0 | 1) => {
    const net = netlist.netOf(ref);
    const driven = level === 1 ? 'high' : 'low';
    const current = netLevel(net);
    levels.set(net, !signals.has(net) && (current === 'floating' || current === driven) ? driven : 'conflict');
  };
  // A pulse train is high only part of the time: alone on its net it reads as on; with any other driver it is a conflict.
  const driveSignal = (ref: PortRef, signal: PinSignalOutput) => {
    const net = netlist.netOf(ref);
    if (netLevel(net) === 'floating') {
      levels.set(net, 'high');
      signals.set(net, signal);
    } else {
      levels.set(net, 'conflict');
    }
  };
  // An analog source: alone on its net it gives `analog`; any other driver, or a second source, is a conflict.
  const analogPercents = new Map<number, number>();
  const driveAnalog = (ref: PortRef, percent: number) => {
    const net = netlist.netOf(ref);
    if (netLevel(net) === 'floating') {
      levels.set(net, 'analog');
      analogPercents.set(net, percent);
    } else {
      levels.set(net, 'conflict');
    }
  };

  if (inputs.powered) {
    for (const { component, definition } of boards) {
      for (const { id, kind } of definition.ports) {
        if (kind === 'power') {
          drive(port(component, id), 1);
        } else if (kind === 'ground') {
          drive(port(component, id), 0);
        }
      }
      for (const pin of definition.board?.pins ?? []) {
        const output = Object.hasOwn(inputs.pinOutputs, pin.name) ? inputs.pinOutputs[pin.name] : undefined;
        if (output === undefined) {
          continue;
        }
        if (typeof output === 'number') {
          drive(port(component, pin.portId), output);
        } else if (output.kind === 'pwm' && output.duty <= 0) {
          // A duty of 0 never goes high: a steady low, as a level is.
          drive(port(component, pin.portId), 0);
        } else {
          driveSignal(port(component, pin.portId), output);
        }
      }
    }
    // Second pass: a source is driven only when its own rails are, as the board and the pins left them.
    for (const { component, percent } of analogSources) {
      if (levelOf(port(component, 'vcc')) === 'high' && levelOf(port(component, 'gnd')) === 'low') {
        driveAnalog(port(component, 'out'), percent);
      }
    }
  }

  return {
    nets: netlist.nets.map((ports, net) => {
      const analogPercent = analogPercents.get(net);
      return netLevel(net) === 'analog' && analogPercent !== undefined
        ? { ports, level: netLevel(net), analogPercent }
        : { ports, level: netLevel(net) };
    }),
    components: Object.fromEntries([
      // A shorted LED has one level on both legs, so it stays off. Fed from a PWM net (N17 B5), it is as bright as the duty.
      ...withModel('led').map(({ component }): [string, ComponentState] => {
        const lit = levelOf(port(component, 'anode')) === 'high' && levelOf(port(component, 'cathode')) === 'low';
        const signal = lit ? signalOf(port(component, 'anode')) : undefined;
        return [component.id, signal?.kind === 'pwm' ? { lit, brightness: dutyToBrightness(signal.duty) } : { lit }];
      }),
      // N17 B5: a servo powered from its rails turns to the angle of the servo signal on its net, and rests at 90° otherwise.
      ...withModel(servoModel).map(({ component }): [string, ComponentState] => {
        const powered = levelOf(port(component, 'vcc')) === 'high' && levelOf(port(component, 'gnd')) === 'low';
        const signal = powered ? signalOf(port(component, 'signal')) : undefined;
        return [component.id, { angle: signal?.kind === 'servo' ? signal.angle : SERVO_REST_ANGLE }];
      }),
      // Reported back so a pressed button is drawn from the snapshot, like a lit LED.
      ...contacts.map(({ component, closed }): [string, ComponentState] => [component.id, { closed }]),
      // The knob is drawn from the snapshot too: its position is the run's input, never the document's (B2).
      ...analogSources.map(({ component, percent }): [string, ComponentState] => [component.id, { value: percent }]),
    ]),
    // The PoC runs exactly one board (RunSession checks it, plan §6.4).
    pinReads: Object.fromEntries(
      boards.flatMap(({ component, definition }) =>
        (definition.board?.pins ?? []).map((pin): [string, 0 | 1] => [
          pin.name,
          levelOf(port(component, pin.portId)) === 'high' ? 1 : 0,
        ]),
      ),
    ),
  };
}

function port(component: ComponentInstance, portId: string): PortRef {
  return { componentId: component.id, portId };
}
