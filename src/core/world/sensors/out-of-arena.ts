import type { Arena } from '../arena/arena-schema';
import { worldToArena, type Vec3 } from '../units';

// Whether the robot has left the arena (N18 R3.4), for the snapshot's `outOfArena` (R3.5) and the goals that end a run
// when it falls (R3.6, R6): review focus 3, a robot that drives off the table never leaves NaN or a hang behind.

/** How far below the floor plane a position may be and still count as on the arena, cm (resting contacts sink < 1 mm). */
export const BELOW_GROUND_TOLERANCE_CM = 1;

/**
 * Whether `position` (world frame, m: the robot frame's origin, on the floor under the chassis) is off the arena: beyond
 * the ground's footprint (its border is in, as for every authored point), more than BELOW_GROUND_TOLERANCE_CM below the
 * floor, or not finite. There is no ceiling: a robot that bounces up is still over the arena.
 */
export function isOutOfArena(arena: Pick<Arena, 'ground'>, position: Vec3): boolean {
  const [width, depth] = arena.ground.sizeCm;
  const { xCm, yCm, heightCm } = worldToArena(position);
  // Written as "not inside", so NaN is out.
  return !(xCm >= 0 && xCm <= width && yCm >= 0 && yCm <= depth && heightCm >= 0 - BELOW_GROUND_TOLERANCE_CM);
}
