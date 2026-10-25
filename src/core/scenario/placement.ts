import type { Kit } from '../hardware/kit';
import type { Arena } from '../world/arena/arena-schema';
import { cos, sin } from '../world/dmath';
import { degToRad } from '../world/units';
import { robotFootprint, startFootprintIssues } from '../world/robot/footprint';

// Where the learner may put the robot before a Run (N18 R4.8, "Di chuyển robot"): the run session's `placeRobot` and the 3D view's ghost
// both ask here. A pose is moved back inside the arena, just far enough that the robot's outline at its heading (what stands on the floor:
// the body and the wheels, footprint.ts `outlineCm`) is on the ground, and its heading is turned into (-180°, 180°]. Then it is checked
// as a scenario's start is (`startFootprintIssues`: no part of the robot, a servo arm at any angle it can turn to included, in a wall, box,
// cylinder or object): a pose with issues is not a place for the robot, and the view shows it as a red ghost.

/** A pose of the robot on the arena: the point of the floor under the middle of its body and its heading (arena frame). */
export type PlacementPose = { readonly xCm: number; readonly yCm: number; readonly yawDeg: number };

export type Placement = {
  /** The pose moved inside the arena, its heading in (-180°, 180°]. */
  readonly pose: PlacementPose;
  /** What the robot would stand in there, as the start check says it; empty when the place is clear. */
  readonly issues: readonly { readonly path: string; readonly message: string }[];
};

/** A heading in (-180°, 180°]. `+ 0` makes −0 a 0. */
export function normalizeYawDeg(yawDeg: number): number {
  const turned = ((yawDeg % 360) + 360) % 360;
  return (turned > 180 ? turned - 360 : turned) + 0;
}

/** cos and sin of an angle in degrees: exact at the right angles, dmath's (the same bits on every engine) everywhere else. */
function cosSin(deg: number): [number, number] {
  const turn = ((deg % 360) + 360) % 360;
  if (turn === 0) return [1, 0];
  if (turn === 90) return [0, 1];
  if (turn === 180) return [-1, 0];
  if (turn === 270) return [0, -1];
  const rad = degToRad(turn);
  return [cos(rad), sin(rad)];
}

/** `value` inside [low, high]; the middle of the two when the range is empty (an arena smaller than the robot). */
const clamp = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value)));

export function checkPlacement(arena: Pick<Arena, 'ground' | 'walls' | 'boxes' | 'cylinders' | 'objects'>, kit: Kit, pose: PlacementPose): Placement {
  if (!Number.isFinite(pose.xCm) || !Number.isFinite(pose.yCm) || !Number.isFinite(pose.yawDeg)) {
    throw new RangeError('A robot pose is finite numbers of cm and degrees.');
  }
  const yawDeg = normalizeYawDeg(pose.yawDeg);
  const [c, s] = cosSin(yawDeg);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of robotFootprint(kit).outlineCm) {
    const dx = x * c - y * s;
    const dy = x * s + y * c;
    minX = Math.min(minX, dx);
    maxX = Math.max(maxX, dx);
    minY = Math.min(minY, dy);
    maxY = Math.max(maxY, dy);
  }
  const [width, depth] = arena.ground.sizeCm;
  const placed: PlacementPose = { xCm: clamp(pose.xCm, -minX, width - maxX), yCm: clamp(pose.yCm, -minY, depth - maxY), yawDeg };
  return { pose: placed, issues: startFootprintIssues(arena, kit, placed) };
}
