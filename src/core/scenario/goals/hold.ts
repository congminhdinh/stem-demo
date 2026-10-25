import { assertTickS } from './tick';

// A condition that has to hold for a while (N18 R6.1): `stop-in-zone` (holdS) and `servo-angle` in a zone (half a second).
//
// A frame is the state of the world at an instant, so the hold starts at the first frame the condition holds (0 s held) and each
// later frame in a row adds the tick that led to it. A stop of 1 s is therefore 1 s between two frames, both of which have the
// robot stopped: at 0.25 s ticks, the fifth frame in a row. The tick that ends on the first frame is not credited, since the robot
// may have been moving during it.

/**
 * How much shorter than the hold a sum of ticks may be and still complete it. Ticks that are not exact in binary (ten of 0.1 s add up
 * to 0.9999999999999999) must not cost a whole tick; a nanosecond is far below any tick, so no frame completes a hold early.
 */
export const TIME_EPSILON_S = 1e-9;

export type Hold = {
  /** One frame: whether the condition holds on it, and the tick that led to it. True once the condition has held for the whole time. */
  tick(holds: boolean, dtS: number): boolean;
  /** How long the condition has held, in a row, up to this frame. */
  readonly heldS: number;
  /** `heldS` as a part of the whole time, 0..1. */
  readonly progress: number;
};

export function createHold(requiredS: number): Hold {
  let holding = false;
  let heldS = 0;
  return {
    tick(holds, dtS) {
      assertTickS(dtS);
      if (!holds) {
        holding = false;
        heldS = 0;
        return false;
      }
      if (holding) {
        heldS += dtS;
      } else {
        holding = true;
        heldS = 0;
      }
      return heldS >= requiredS - TIME_EPSILON_S;
    },
    get heldS() {
      return heldS;
    },
    get progress() {
      return Math.min(1, heldS / requiredS);
    },
  };
}
