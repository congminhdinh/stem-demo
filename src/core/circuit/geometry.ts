import { findPort, type DeviceDefinition } from '../devices/device-definition';
import type { DeviceRegistry } from '../devices/registry';
import type { Circuit, ComponentInstance, Point, PortRef } from './document';

/**
 * The single source of port positions (plan §5.1 B7): renderers, wiring and
 * hit-testing must use this instead of computing positions themselves.
 * No rotation yet; it will be applied here when added.
 */
export function portWorldPosition(
  component: ComponentInstance,
  definition: DeviceDefinition,
  portId: string,
): Point {
  const port = findPort(definition, portId);
  if (!port) {
    throw new Error(`Device "${definition.id}" has no port "${portId}"`);
  }
  return { x: component.position.x + port.x, y: component.position.y + port.y };
}

/** World position of the port a wire end points to (assumes a valid document). */
export function portRefPosition(circuit: Circuit, registry: DeviceRegistry, ref: PortRef): Point {
  const component = circuit.components.find((candidate) => candidate.id === ref.componentId);
  if (!component) {
    throw new Error(`Unknown component "${ref.componentId}"`);
  }
  return portWorldPosition(component, registry.get(component.deviceType), ref.portId);
}
