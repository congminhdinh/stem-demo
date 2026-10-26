import raw from '../../__fixtures__/pick-place.scenario.json';
import { loadScenario, type RobotGoalSpec } from '../../scenario';
import { applyVariant, variantOffsets } from '../../variants';
import type { GoalObject } from '../frame';
import type { GoalContext } from '../goal';
import type { FrameInit } from './frames';

// The scenario of the pick-and-place goal tests (N19 D2): pick-place.scenario.json, a 200 × 120 cm arena with these zones
//   start  x 10..40   y 45..75  (no name)       pickup      x 70..100  y 40..80  (pickup)    drop       x 110..150 y 40..80 (drop)
//   red    x 160..190 y 85..115 (red)           green-zone  x 160..190 y 45..75  (green)     blue-zone  x 160..190 y 5..35  (blue)
//   bare   x 45..65   y 90..110 (no name)
// and these objects: the red 4 cm `cube` at 85,60 (in pickup; green in variant 1, blue in variant 2), the yellow 6 × 6 × 4 cm `base` at
// 130,100, three 5 cm parcels at y 20, and the `can`. Its goals: grab-cube (object-held, minLift 2), place-cube (object-placed, drop),
// stack-cube (object-on-object on the base, offset 1.5, tilt 10, rest 0.5), base-still (object-unmoved, 1 cm), sort-cube (object-placed by
// colour) and deliver-2 (parcel-2 to drop).

export const scenario = loadScenario(raw);
export const ctx: GoalContext = { arena: scenario.arena, scenario };
/** The context of variant `index`: its arena, where the cube has that variant's colour. */
export const variantCtx = (index: number): GoalContext => ({ arena: applyVariant(scenario, variantOffsets(scenario, index, 11)).arena, scenario });

export const specOf = <K extends RobotGoalSpec['kind']>(id: string, kind: K): Extract<RobotGoalSpec, { kind: K }> => {
  const spec = scenario.goals.find((goal) => goal.id === id);
  if (spec?.kind !== kind) throw new Error(`no ${kind} goal "${id}" in the fixture`);
  return spec as Extract<RobotGoalSpec, { kind: K }>;
};

/** A cube standing on the floor (its middle 2 cm up), upright, not held. */
export const CUBE_REST_Z = 2;
/** The base's place: the cube resting on it has its middle at 2 + 2 + 2 = 6 cm. */
export const BASE = { xCm: 130, yCm: 100, zCm: 2 } as const;
export const ON_BASE_Z = 6;

/** A frame with the cube at (x, y), on the floor unless `more` says otherwise, and the base where it stands. */
export const cubeAt = (xCm: number, yCm: number, more: Partial<GoalObject> = {}, extra: FrameInit = {}): FrameInit => ({
  ...extra,
  objects: { base: { ...BASE, yawDeg: 0 }, cube: { xCm, yCm, yawDeg: 0, zCm: CUBE_REST_Z, ...more }, ...extra.objects },
});
/** The same, held by the gripper at height `zCm`. */
export const heldAt = (xCm: number, yCm: number, zCm: number, extra: FrameInit = {}): FrameInit => cubeAt(xCm, yCm, { held: true, zCm }, extra);

/**
 * The cube picked up where it starts (85, 60), carried at 5 cm, put down at (x, y) and let go there on the floor (or at `zCm`), then left for
 * three frames (0.5 s at the 0.25 s ticks of `feed`): at rest at the end. 0.25 s a frame, so it is let go at 1.25 s.
 */
export function carryTo(xCm: number, yCm: number, zCm = CUBE_REST_Z): FrameInit[] {
  return [
    cubeAt(85, 60),
    heldAt(85, 60, 2),
    heldAt(85, 60, 5),
    heldAt(xCm, yCm, 5),
    heldAt(xCm, yCm, zCm + 0.1),
    cubeAt(xCm, yCm, { zCm: zCm + 0.1 }),
    cubeAt(xCm, yCm, { zCm }),
    cubeAt(xCm, yCm, { zCm }),
    cubeAt(xCm, yCm, { zCm }),
  ];
}
/** When `carryTo` lets go: its sixth frame. */
export const RELEASE_AT_S = 1.25;
