import type { GoalFrame } from './frame';
import { assertTickS } from './tick';

// How far the robot has driven (N18 R6.1, controller ruling). `avoid-contact` and `stay-on-line` are guard goals: they are met by
// not doing something (not touching, not leaving the tape), so a robot that does nothing would meet them. Each can pass only if the
// robot's path during the run is at least MIN_GUARD_TRAVEL_CM; below it the goal has not passed, with `robot-did-not-move`.
//
// The path is the sum of speed × tick over the run: each frame adds `robot.speedCmS · dtS` (the speed at the end of the tick, held
// over the tick; the ticks are short and the sum is only held against a 20 cm limit). It is plain multiplication and addition, so it is
// the same on every engine. The speed is the robot's drive (frame.ts: the middle of its wheel axle, a turn within 1 cm of it counting as
// none), so a robot turning on the spot adds nothing, however long it spins, and one pushed without driving adds what its axle moves.
// A frame on which the robot is out of the arena adds nothing (the fall is not driving), and neither does a speed that is not a number.

/** The least path, in centimetres, over which a guard goal can pass. */
export const MIN_GUARD_TRAVEL_CM = 20;

/**
 * How much less than the minimum a sum may be and still reach it: a path of exactly 20 cm in 100 ticks of 0.2 cm adds up to
 * 19.99999999999996. A nanometre is far below anything a robot does, so no real path is let through by it.
 */
export const TRAVEL_EPSILON_CM = 1e-9;

export type TravelMeter = {
  /** One frame and the tick that led to it. Throws RangeError for a tick that is not a finite time of 0 s or more. */
  add(frame: GoalFrame, dtS: number): void;
  /** The path so far, cm. */
  readonly cm: number;
  /** Whether the path reaches MIN_GUARD_TRAVEL_CM. */
  readonly enough: boolean;
  /** `cm` as a part of the minimum, 0..1. */
  readonly progress: number;
};

export function createTravelMeter(): TravelMeter {
  let cm = 0;
  return {
    add(frame, dtS) {
      assertTickS(dtS);
      const speed = frame.robot.speedCmS;
      if (!frame.outOfArena && speed > 0 && Number.isFinite(speed)) cm += speed * dtS;
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
