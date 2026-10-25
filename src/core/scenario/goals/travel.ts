import type { GoalFrame } from './frame';
import { assertTickS } from './tick';

// How far the robot has got from where it started (N18 R6.1, controller ruling; net reach since R5.2a fix round 1). `avoid-contact` and
// `stay-on-line` are guard goals: they are met by not doing something (not touching, not leaving the tape), so a robot that does nothing
// would meet them. Each can pass only if the robot has been at least MIN_GUARD_TRAVEL_CM from its start at some moment of the run; below
// it the goal has not passed, with `robot-did-not-move`.
//
// The reach is the greatest distance of the middle of the body (`robot.xCm`, `yCm`, where the robot is, R6.1) from where it was on the
// first frame that counts. Not the length of the path: a path can be made as long as one likes on the spot, by spinning (the middle of
// the body circles 2 cm ahead of the axle on ref-uno-rover@0) or by driving back and forth, and such a robot has still guarded nothing.
// Only + − × and Math.sqrt (exactly rounded by IEEE 754), so it is the same on every engine. A frame on which the robot is out of the arena
// counts for nothing (neither a start nor a reach: the fall is not driving), and neither does one whose position is not a number.

/** The least distance from its start, in centimetres, the robot must have reached for a guard goal to pass. */
export const MIN_GUARD_TRAVEL_CM = 20;

/**
 * How much less than the minimum a reach may be and still count: positions 12.3 and 32.3 are 19.999999999999996 apart in doubles. A
 * nanometre is far below anything a robot does, so no real robot is let through by it.
 */
export const TRAVEL_EPSILON_CM = 1e-9;

export type ReachMeter = {
  /** One frame and the tick that led to it. Throws RangeError for a tick that is not a finite time of 0 s or more. */
  add(frame: GoalFrame, dtS: number): void;
  /** The greatest distance from the start so far, cm. */
  readonly cm: number;
  /** Whether the reach is MIN_GUARD_TRAVEL_CM or more. */
  readonly enough: boolean;
  /** `cm` as a part of the minimum, 0..1. */
  readonly progress: number;
};

export function createReachMeter(): ReachMeter {
  let start: { readonly x: number; readonly y: number } | undefined;
  let cm = 0;
  return {
    add(frame, dtS) {
      assertTickS(dtS);
      const { xCm, yCm } = frame.robot;
      if (frame.outOfArena || !Number.isFinite(xCm) || !Number.isFinite(yCm)) return;
      if (start === undefined) {
        start = { x: xCm, y: yCm };
        return;
      }
      const dx = xCm - start.x;
      const dy = yCm - start.y;
      cm = Math.max(cm, Math.sqrt(dx * dx + dy * dy));
    },
    get cm() {
      return cm;
    },
    get enough() {
      return cm >= MIN_GUARD_TRAVEL_CM - TRAVEL_EPSILON_CM;
    },
    get progress() {
      return Math.min(1, cm / MIN_GUARD_TRAVEL_CM);
    },
  };
}
