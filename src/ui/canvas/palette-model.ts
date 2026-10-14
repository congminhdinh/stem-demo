import type { Circuit, Point } from '../../core/circuit/document';
import { gridSize, snapToGrid } from '../../core/circuit/geometry';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { BoardContext } from '../../core/profiles/board-context';

export type PaletteItem = { deviceType: string; name: string };

/**
 * One entry per device the board context allows (B6, YB plan R-F3): a generic
 * project offers the generic devices, a Yolo:Bit-compatible one its profile's
 * palette. So a new definition shows up where its family belongs and nowhere
 * else, with no UI change.
 */
export function paletteItems(registry: DeviceRegistry, context: Pick<BoardContext, 'allowedDeviceTypes'>): PaletteItem[] {
  return context.allowedDeviceTypes.map((deviceType) => ({ deviceType, name: registry.get(deviceType).name }));
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
