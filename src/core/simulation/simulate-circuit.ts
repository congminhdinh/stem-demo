import type { Circuit, ComponentInstance, PortRef } from '../circuit/document';
import { buildNetlist } from '../circuit/netlist';
import type { DeviceDefinition } from '../devices/device-definition';
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
};

export type NetLevel = 'floating' | 'high' | 'low' | 'conflict';

/** A component's runtime state for its renderer: `lit` for an LED, `closed` for a contact. */
export type ComponentState = { lit?: boolean; closed?: boolean };

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
