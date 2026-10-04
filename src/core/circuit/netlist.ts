import type { DeviceRegistry } from '../devices/registry';
import type { Circuit, PortRef } from './document';

export type Netlist = {
  /** Every port of every component, grouped by net. */
  nets: PortRef[][];
  /** Index into `nets`. Not stable across circuits; never persist it. */
  netOf(port: PortRef): number;
};

/**
 * Groups ports into nets with union-find: wires and `extraConnections` (pairs
 * that a simulation model reports as conducting, e.g. a resistor) merge nets.
 * Assumes a valid document (plan §6.1 I2); unknown ports throw.
 */
export function buildNetlist(
  circuit: Circuit,
  registry: DeviceRegistry,
  extraConnections: readonly (readonly [PortRef, PortRef])[] = [],
): Netlist {
  const parent = new Map<string, string>();
  const refs = new Map<string, PortRef>();

  for (const component of circuit.components) {
    for (const port of registry.get(component.deviceType).ports) {
      const ref = { componentId: component.id, portId: port.id };
      parent.set(keyOf(ref), keyOf(ref));
      refs.set(keyOf(ref), ref);
    }
  }

  const root = (key: string): string => {
    let current = key;
    for (let next = parent.get(current); next !== current; next = parent.get(current)) {
      if (next === undefined) {
        throw new Error(`Unknown port "${current}"`);
      }
      current = next;
    }
    return current;
  };
  const union = (a: PortRef, b: PortRef) => {
    parent.set(root(keyOf(a)), root(keyOf(b)));
  };

  for (const wire of circuit.wires) {
    union(wire.from, wire.to);
  }
  for (const [a, b] of extraConnections) {
    union(a, b);
  }

  const groups = new Map<string, PortRef[]>();
  for (const [key, ref] of refs) {
    const rootKey = root(key);
    const group = groups.get(rootKey);
    if (group) {
      group.push(ref);
    } else {
      groups.set(rootKey, [ref]);
    }
  }

  const nets = [...groups.values()];
  const netByPort = new Map<string, number>();
  nets.forEach((net, index) => {
    for (const ref of net) {
      netByPort.set(keyOf(ref), index);
    }
  });

  return {
    nets,
    netOf(port) {
      const net = netByPort.get(keyOf(port));
      if (net === undefined) {
        throw new Error(`Unknown port "${keyOf(port)}"`);
      }
      return net;
    },
  };
}

function keyOf(port: PortRef): string {
  return `${port.componentId}/${port.portId}`;
}
