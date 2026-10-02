import { findPort, type DeviceDefinition } from '../devices/device-definition';
import type { ComponentInstance, Point } from './document';

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
