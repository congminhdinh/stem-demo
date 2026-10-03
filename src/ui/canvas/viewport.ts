import type { Point } from '../../core/circuit/document';

// The one place that converts between stage (pointer) coordinates and world
// coordinates (plan §5.1 B7). The viewport is fixed, so both conversions are
// the identity until pan/zoom (BL-E5) changes them here. Konva node positions
// are already world positions.

export function stageToWorld(point: Point): Point {
  return { x: point.x, y: point.y };
}

/** A distance on screen (stage pixels) in world units. */
export function stageToWorldDistance(pixels: number): number {
  return pixels;
}

/** A click this close to a port, in screen pixels, picks it (plan POC-10). */
export const portPickRadiusPx = 12;
