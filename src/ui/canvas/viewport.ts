import type { Circuit, Point } from '../../core/circuit/document';
import { portWorldPosition } from '../../core/circuit/geometry';
import type { DeviceRegistry } from '../../core/devices/registry';

// The one place that converts between stage (pointer) coordinates and world
// coordinates (plan §5.1 B7). The standalone editor's viewport is the identity;
// a lab launch fits its circuit into the canvas (N8s): world = (stage − offset) / scale.
// There is still no pan or zoom by the user (BL-E5). Konva node positions are
// world positions: the stage carries the scale and the offset.

export type Viewport = { scale: number; x: number; y: number };

export const identityViewport: Viewport = { scale: 1, x: 0, y: 0 };

export function stageToWorld(point: Point, viewport: Viewport = identityViewport): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

/** A distance on screen (stage pixels) in world units. */
export function stageToWorldDistance(pixels: number, viewport: Viewport = identityViewport): number {
  return pixels / viewport.scale;
}

/** A click this close to a port, in screen pixels, picks it (plan POC-10). */
export const portPickRadiusPx = 12;

export type Bounds = { left: number; top: number; right: number; bottom: number };

/** The box around every body and port of the circuit, in world units; null for a circuit without components. */
export function circuitBounds(circuit: Circuit, registry: DeviceRegistry): Bounds | null {
  let bounds: Bounds | null = null;
  const include = (x: number, y: number) => {
    bounds = bounds
      ? { left: Math.min(bounds.left, x), top: Math.min(bounds.top, y), right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y) }
      : { left: x, top: y, right: x, bottom: y };
  };
  for (const component of circuit.components) {
    const definition = registry.get(component.deviceType);
    const { x, y } = component.position;
    include(x - definition.body.width / 2, y - definition.body.height / 2);
    include(x + definition.body.width / 2, y + definition.body.height / 2);
    for (const port of definition.ports) {
      const at = portWorldPosition(component, definition, port.id);
      include(at.x, at.y);
    }
  }
  return bounds;
}

export type FitOptions = {
  /** Room left around the circuit, in screen pixels. */
  margin?: number;
  /** Room left at the left and the right, in screen pixels, when it differs from `margin` (a narrow canvas, fitSideMargin). */
  marginX?: number;
  /** Below this the circuit is unreadable: it is cut off instead. */
  minScale?: number;
};

/**
 * The room at the sides of a canvas `width` px wide (Fix 6, N17 M1): 24 px in a wide one, less in a narrow one (a lesson's short
 * frame puts the controls beside the canvas), where every pixel of width is board. The top and the bottom keep 24 px: the check's
 * note sits in the top one.
 */
export const fitSideMargin = (width: number): number => Math.min(24, Math.max(8, Math.round(width * 0.06)));

/**
 * The viewport that shows `bounds` whole, centred in a stage of `size`: shrunk when it does not fit, never
 * enlarged past 1 (bodies and the pick radius keep their size). The identity for no bounds or no room.
 */
export function fitViewport(
  bounds: Bounds | null,
  size: { width: number; height: number },
  { margin = 24, marginX = margin, minScale = 0.4 }: FitOptions = {},
): Viewport {
  const roomWidth = size.width - 2 * marginX;
  const roomHeight = size.height - 2 * margin;
  if (!bounds || roomWidth <= 0 || roomHeight <= 0) {
    return identityViewport;
  }
  const width = Math.max(bounds.right - bounds.left, 1);
  const height = Math.max(bounds.bottom - bounds.top, 1);
  const scale = Math.max(minScale, Math.min(1, roomWidth / width, roomHeight / height));
  return {
    scale,
    x: size.width / 2 - ((bounds.left + bounds.right) / 2) * scale,
    y: size.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale,
  };
}
