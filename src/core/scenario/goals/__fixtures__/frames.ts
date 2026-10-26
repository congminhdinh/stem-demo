import type { PointCm } from '../../../world/arena/arena-schema';
import type { Goal } from '../goal';
import type { GoalFrame } from '../frame';

// Frames for the goal tests: a robot of a small footprint, at rest in the middle of nowhere unless a test says otherwise.

export type FrameInit = {
  tS?: number;
  xCm?: number;
  yCm?: number;
  yawDeg?: number;
  speedCmS?: number;
  lineSpotsCm?: readonly PointCm[];
  objects?: GoalFrame['objects'];
  contacts?: GoalFrame['contacts'];
  servoDeg?: GoalFrame['servoDeg'];
  outOfArena?: boolean;
  /** N19 D2: the gripper of a kit with one; left out, the frame has none. */
  gripper?: GoalFrame['gripper'];
};

export function frameAt(init: FrameInit = {}): GoalFrame {
  return {
    tS: init.tS ?? 0,
    robot: {
      xCm: init.xCm ?? 100,
      yCm: init.yCm ?? 80,
      yawDeg: init.yawDeg ?? 0,
      speedCmS: init.speedCmS ?? 0,
      footprint: { kind: 'circle', radiusCm: 10 },
      ...(init.lineSpotsCm === undefined ? {} : { lineSpotsCm: init.lineSpotsCm }),
    },
    objects: init.objects ?? {},
    contacts: init.contacts ?? [],
    servoDeg: init.servoDeg ?? {},
    leds: {},
    buzzerHz: null,
    outOfArena: init.outOfArena ?? false,
    ...(init.gripper === undefined ? {} : { gripper: init.gripper }),
  };
}

/** Feeds a goal one frame per entry, `dtS` apart, the first at `fromS`. Each entry is what changes from the plain frame. */
export function feed(goal: Goal, inits: readonly FrameInit[], { dtS = 0.25, fromS = 0 }: { dtS?: number; fromS?: number } = {}): void {
  inits.forEach((init, k) => goal.update(frameAt({ tS: init.tS ?? fromS + k * dtS, ...init }), dtS));
}
