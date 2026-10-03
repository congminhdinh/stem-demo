import { findPort } from '../devices/device-definition';
import type { DeviceRegistry } from '../devices/registry';
import { isSamePort, type Circuit, type PortRef, type Wire } from './document';

export type ConnectWireError =
  | 'duplicate-wire-id'
  | 'unknown-component'
  | 'unknown-port'
  | 'same-port'
  | 'duplicate-wire';

export type ConnectWireResult =
  | { ok: true; circuit: Circuit }
  | { ok: false; error: ConnectWireError };

/**
 * Adds a wire if it keeps the document valid (plan §6.1 I1, I2, I3). These are
 * mistakes a user can make while wiring, so they are returned, not thrown.
 * A port may have several wires. The caller provides the wire id.
 */
export function connectWire(circuit: Circuit, registry: DeviceRegistry, wire: Wire): ConnectWireResult {
  if (circuit.wires.some((existing) => existing.id === wire.id)) {
    return { ok: false, error: 'duplicate-wire-id' };
  }
  for (const end of [wire.from, wire.to]) {
    const error = endpointError(circuit, registry, end);
    if (error) {
      return { ok: false, error };
    }
  }
  if (isSamePort(wire.from, wire.to)) {
    return { ok: false, error: 'same-port' };
  }
  const duplicate = circuit.wires.some(
    (existing) =>
      (isSamePort(existing.from, wire.from) && isSamePort(existing.to, wire.to)) ||
      (isSamePort(existing.from, wire.to) && isSamePort(existing.to, wire.from)),
  );
  if (duplicate) {
    return { ok: false, error: 'duplicate-wire' };
  }
  return { ok: true, circuit: { ...circuit, wires: [...circuit.wires, wire] } };
}

/** A wire id (`wire-1`, `wire-2`, …) that no wire of the circuit uses yet (I1). */
export function nextWireId(circuit: Circuit): string {
  const taken = new Set(circuit.wires.map((wire) => wire.id));
  let index = 1;
  while (taken.has(`wire-${index}`)) {
    index++;
  }
  return `wire-${index}`;
}

/** Removes one wire; the components and other wires stay as they are. */
export function deleteWire(circuit: Circuit, wireId: string): Circuit {
  return { ...circuit, wires: circuit.wires.filter((wire) => wire.id !== wireId) };
}

function endpointError(circuit: Circuit, registry: DeviceRegistry, end: PortRef): ConnectWireError | null {
  const component = circuit.components.find((candidate) => candidate.id === end.componentId);
  if (!component) {
    return 'unknown-component';
  }
  return findPort(registry.get(component.deviceType), end.portId) ? null : 'unknown-port';
}
