import type { Circuit, ComponentInstance, PortRef } from '../circuit/document';
import { buildNetlist } from '../circuit/netlist';
import type { DeviceDefinition } from '../devices/device-definition';
import type { Frame } from '../capabilities/frame';
import type { DeviceRegistry } from '../devices/registry';

// Net-level logic simulation (plan §6.5): a pure function of the design and
// the runtime inputs, recomputed in full on every change.
//
// Known limits (logic, not electrical):
// - Resistance is ignored: a HIGH pin through a resistor to GND is reported
//   as a conflict, although the real circuit is fine.
// - No pull-up/pull-down: a floating pin reads 0 (an implicit pull-down).
// - Two LEDs in series stay off: the net between them is floating.
// - No voltage, current, brightness, burn-out or transients; all rails share
//   one reference.

export type SimulationInputs = {
  /** Run powers the board (plan §6.4 E1). Nothing drives a net while unpowered. */
  powered: boolean;
  /** Levels the program drives, by board pin name. A pin left out is not driven. */
  pinOutputs: Readonly<Record<string, 0 | 1>>;
  /** Contacts held closed (a pressed push button), by component id. One left out is open. */
  contacts?: Readonly<Record<string, boolean>>;
  /**
   * The runtime input of every other component, by component id: the one `ComponentInput` every control uses
   * (plan §11.3), not a field per kind of control. A model reads the input of its own component and an id that
   * names no component is ignored. No model takes one at YB-CP (YB-4's potentiometer is the first), so this only
   * carries them.
   */
  inputs?: Readonly<Record<string, ComponentInput>>;
};

export type NetLevel = 'floating' | 'high' | 'low' | 'conflict';

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
 * integer in the peripheral's range (clamped at its ends by the peripheral); `tilt` the accelerometer;
 * `gesture` a one-shot event (shake).
 */
export type ComponentInput =
  | { kind: 'hold'; closed: boolean }
  | { kind: 'slider'; value: number }
  | { kind: 'tilt'; x: number; y: number }
  | { kind: 'gesture' };

export type ComponentInputKind = ComponentInput['kind'];

/** The input a model of an onboard part (plan §11.2) takes; a part that takes none (display, buzzer) is not listed. */
export const inputKindOfModel: Readonly<Record<string, ComponentInputKind>> = {
  button: 'hold',
  'light-sensor': 'slider',
  'temperature-sensor': 'slider',
  accelerometer: 'tilt',
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
      return Number.isFinite(input.x) && Number.isFinite(input.y);
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
      return { kind: 'tilt', x: input.x, y: input.y };
    case 'gesture':
      return { kind: 'gesture' };
  }
}

/** Plain JSON, so it can travel in a run snapshot. */
export type SimulationResult = {
  nets: { ports: PortRef[]; level: NetLevel }[];
  /** Runtime state for renderers, by component id. */
  components: Record<string, ComponentState>;
  /** What `digitalRead` returns, by board pin name: 1 only on a high net. */
  pinReads: Record<string, 0 | 1>;
};

const contactModel = 'contact';

/**
 * A contact (the push button) conducts between its ports `a` and `b` while
 * closed. Closing it is a runtime input (`contacts`), never design state (B2).
 */
export function isContact(definition: DeviceDefinition): boolean {
  return definition.simulation.model === contactModel;
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
  const boards = withModel('board');
  const contacts = withModel(contactModel).map(({ component }) => ({
    component,
    // Strictly true: an id such as "constructor" must not read an Object.prototype member as closed.
    closed: inputs.contacts?.[component.id] === true,
  }));

  // A resistor always conducts between its two ports; a contact only while closed.
  const conducting = [...withModel('resistor'), ...contacts.filter(({ closed }) => closed)].map(
    ({ component }): [PortRef, PortRef] => [port(component, 'a'), port(component, 'b')],
  );
  const netlist = buildNetlist(circuit, registry, conducting);

  // Net index → level; a net nothing drives is floating.
  const levels = new Map<number, NetLevel>();
  const netLevel = (net: number): NetLevel => levels.get(net) ?? 'floating';
  const levelOf = (ref: PortRef) => netLevel(netlist.netOf(ref));
  const drive = (ref: PortRef, level: 0 | 1) => {
    const net = netlist.netOf(ref);
    const driven = level === 1 ? 'high' : 'low';
    const current = netLevel(net);
    levels.set(net, current === 'floating' || current === driven ? driven : 'conflict');
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
        const level = Object.hasOwn(inputs.pinOutputs, pin.name) ? inputs.pinOutputs[pin.name] : undefined;
        if (level !== undefined) {
          drive(port(component, pin.portId), level);
        }
      }
    }
  }

  return {
    nets: netlist.nets.map((ports, net) => ({ ports, level: netLevel(net) })),
    components: Object.fromEntries([
      // A shorted LED has one level on both legs, so it stays off.
      ...withModel('led').map(({ component }): [string, ComponentState] => [
        component.id,
        { lit: levelOf(port(component, 'anode')) === 'high' && levelOf(port(component, 'cathode')) === 'low' },
      ]),
      // Reported back so a pressed button is drawn from the snapshot, like a lit LED.
      ...contacts.map(({ component, closed }): [string, ComponentState] => [component.id, { closed }]),
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
