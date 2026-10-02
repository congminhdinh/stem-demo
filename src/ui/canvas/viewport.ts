import type { Point } from '../../core/circuit/document';

/**
 * The one conversion from stage (pointer) coordinates to world coordinates
 * (plan §5.1 B7). The viewport is fixed, so it is the identity until pan/zoom
 * (BL-E5) changes it here. Konva node positions are already world positions.
 */
export function stageToWorld(point: Point): Point {
  return { x: point.x, y: point.y };
}
