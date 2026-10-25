import type { ArenaPoint } from './robot-tools';
import { threeToArena } from './scene-math';

// Where the pointer is on the mat in the 3D view (N18 R4.8, the ruler and the move tool). The pointer's ray from the camera meets the
// floor plane, the mat, at y = 0 m (ArenaView draws the painted floor there), and the hit goes back to the arena's cm through scene-math,
// the frame the view draws in: what the learner points at is where the physics has it. Plain numbers (three's column-major matrices as
// arrays), tested against three's own projection in every camera view.

/** Normalised device coordinates (-1..1, y up) of a client point over the canvas `rect`. */
export function clientToNdc(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  return [((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2];
}

/** `m` (column-major 4 × 4) applied to the point (x, y, z, 1), divided by its w. */
function transform(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w];
}

/**
 * The arena point (cm) the camera shows at `ndc`, on the floor: `world` is the camera's matrixWorld, `projectionInverse` its
 * projectionMatrixInverse (three's `elements`). Null when the ray does not meet the floor in front of the camera (at or above the horizon).
 */
export function pickFloor(ndc: readonly [number, number], world: ArrayLike<number>, projectionInverse: ArrayLike<number>): ArenaPoint | null {
  const [x, y] = ndc;
  // The ray through the near and the far plane, unprojected to view space, then to the world.
  const near = transform(world, ...transform(projectionInverse, x, y, -1));
  const far = transform(world, ...transform(projectionInverse, x, y, 1));
  const down = far[1] - near[1];
  if (!(down < 0) || near[1] <= 0) return null;
  const t = near[1] / -down;
  const [xCm, yCm] = threeToArena(near[0] + (far[0] - near[0]) * t, 0, near[2] + (far[2] - near[2]) * t);
  return { xCm, yCm };
}
