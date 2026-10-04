import type { Circuit, Point } from '../../core/circuit/document';
import { gridSize, snapToGrid } from '../../core/circuit/geometry';
import type { DeviceRegistry } from '../../core/devices/registry';

export type PaletteItem = { deviceType: string; name: string };

/** One entry per device definition, so a new definition needs no UI change (B6). */
export function paletteItems(registry: DeviceRegistry): PaletteItem[] {
  return registry.list().map((definition) => ({ deviceType: definition.id, name: definition.name }));
}

/**
 * Where a device added from the palette goes: the grid point nearest to
 * `preferred` (the middle of the canvas), moved diagonally while a component
 * already sits exactly there, so repeated adds do not hide each other.
 */
export function placementPosition(circuit: Circuit, preferred: Point): Point {
  const position = snapToGrid(preferred);
  const isTaken = () =>
    circuit.components.some((component) => component.position.x === position.x && component.position.y === position.y);
  while (isTaken()) {
    position.x += 2 * gridSize;
    position.y += 2 * gridSize;
  }
  return position;
}
