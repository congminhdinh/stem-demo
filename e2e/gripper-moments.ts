// N19 E8: the moments the gallery of the four gripper lessons is taken at (e2e/robot-lab-gripper-look.spec.ts and its GPU shot script,
// spikes/n19-e8/gallery.mjs, which imports this file with Node's type stripping: no imports here). Each lesson's reference solution, from
// its start, paused after a whole number of Bước (0.1 s of simulated time each: 12 ticks at 120 Hz), so that every shot is of a world that
// is the same on every run and every machine, with no wall-clock wait. The times were chosen from the reference traced every 0.1 s
// headless (spikes/n19-e8/moments.test.ts, results/trace-*.txt), and what each moment must show is what the trace has there:
//   - start: the lesson as it opens, nothing run (the arm up at setup()'s 90°, the claw open);
//   - grasp: the first Bước with the jaws closed on the object on the floor (the arm still down): the claw closing on it;
//   - carry: the object held and lifted (90°, lesson 11's 55°), the car driving it to where it goes;
//   - release (lesson 11): the claw open over the base, the cube left standing on it;
//   - approach: going to the object, the arm down, the claw open, the IR and the colour sensor seeing nothing yet (lessons 9 and 11 on
//     the tape; fix round 1, review F1: lessons 8 and 10 too, for the default "Theo xe" shots).
// Lesson 10's later rounds (red, blue) are shown as the lab shows a check's round: Kiểm tra, Xem lại lượt N, then paused and put back to
// its start (Đặt lại robot) and stepped like the others.

export type GripperMomentName = 'start' | 'approach' | 'grasp' | 'carry' | 'release';

/** What a moment's world must show (the reference's own trace at that time; ranges for the angles, which the servos reach in steps). */
export type GripperMomentExpect = {
  heldId: string | null;
  liftDeg: readonly [number, number];
  clawDeg: readonly [number, number];
  /** The object the moment is about, the height of its middle (cm) and, where it matters, where it is (cm, within 0.05). */
  object: { id: string; zCm: readonly [number, number]; at?: readonly [number, number] };
  /** The robot's heading, degrees (within 1°). */
  yawDeg: number;
};

export type GripperMoment = { name: GripperMomentName; steps: number; expect: GripperMomentExpect };

export type GripperLessonRun = {
  key: 'rb-grip-pick' | 'rb-grip-deliver' | 'rb-grip-sort' | 'rb-grip-stack';
  /** The round shown: 1 is a plain run (Bước from the lesson's start, variant 0); 2 and 3 are Kiểm tra's rounds, shown by Xem lại. */
  round: 1 | 2 | 3;
  /** The colour the round paints the object in (lesson 10), for the shots' names. */
  colour?: 'green' | 'red' | 'blue';
  moments: readonly GripperMoment[];
};

const ARM_UP = [89.5, 90.5] as const;
const ARM_DOWN = [-0.5, 0.5] as const;
const OPEN = [-0.5, 0.5] as const;
const CLOSED = [26.5, 27.5] as const;
const ON_FLOOR = [1.9, 2.05] as const;

export const gripperLessonRuns: readonly GripperLessonRun[] = [
  {
    key: 'rb-grip-pick',
    round: 1,
    moments: [
      { name: 'start', steps: 0, expect: { heldId: null, liftDeg: ARM_UP, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [85, 45] }, yawDeg: 0 } },
      { name: 'approach', steps: 32, expect: { heldId: null, liftDeg: ARM_DOWN, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [85, 45] }, yawDeg: 0 } },
      // D4 fix round 1: the approach at 50 % (the claw closes at 3.6–3.7 s) and the drop 35 cm from the far wall.
      { name: 'grasp', steps: 37, expect: { heldId: 'cube', liftDeg: ARM_DOWN, clawDeg: CLOSED, object: { id: 'cube', zCm: ON_FLOOR, at: [85, 45] }, yawDeg: 0 } },
      { name: 'carry', steps: 50, expect: { heldId: 'cube', liftDeg: ARM_UP, clawDeg: CLOSED, object: { id: 'cube', zCm: [8.9, 9.1], at: [99.59, 45] }, yawDeg: 0 } },
    ],
  },
  {
    key: 'rb-grip-deliver',
    round: 1,
    moments: [
      { name: 'start', steps: 0, expect: { heldId: null, liftDeg: ARM_UP, clawDeg: OPEN, object: { id: 'parcel-1', zCm: ON_FLOOR, at: [120, 70] }, yawDeg: 90 } },
      { name: 'approach', steps: 15, expect: { heldId: null, liftDeg: ARM_DOWN, clawDeg: OPEN, object: { id: 'parcel-1', zCm: ON_FLOOR, at: [120, 70] }, yawDeg: 90 } },
      { name: 'grasp', steps: 25, expect: { heldId: 'parcel-1', liftDeg: ARM_DOWN, clawDeg: CLOSED, object: { id: 'parcel-1', zCm: ON_FLOOR, at: [120, 70] }, yawDeg: 90 } },
      { name: 'carry', steps: 50, expect: { heldId: 'parcel-1', liftDeg: ARM_UP, clawDeg: CLOSED, object: { id: 'parcel-1', zCm: [8.9, 9.1], at: [92.81, 55.09] }, yawDeg: -178.5 } },
    ],
  },
  {
    key: 'rb-grip-sort',
    round: 1,
    colour: 'green',
    moments: [
      { name: 'start', steps: 0, expect: { heldId: null, liftDeg: ARM_UP, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [49, 75] }, yawDeg: 0 } },
      { name: 'approach', steps: 6, expect: { heldId: null, liftDeg: ARM_DOWN, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [49, 75] }, yawDeg: 0 } },
      { name: 'grasp', steps: 10, expect: { heldId: 'cube', liftDeg: ARM_DOWN, clawDeg: CLOSED, object: { id: 'cube', zCm: ON_FLOOR, at: [49, 75] }, yawDeg: 0 } },
      { name: 'carry', steps: 30, expect: { heldId: 'cube', liftDeg: ARM_UP, clawDeg: CLOSED, object: { id: 'cube', zCm: [8.9, 9.1], at: [67.34, 75] }, yawDeg: 0 } },
    ],
  },
  {
    key: 'rb-grip-sort',
    round: 2,
    colour: 'red',
    moments: [{ name: 'carry', steps: 39, expect: { heldId: 'cube', liftDeg: ARM_UP, clawDeg: CLOSED, object: { id: 'cube', zCm: [8.9, 9.1], at: [34.19, 108.05] }, yawDeg: 90.79 } }],
  },
  {
    key: 'rb-grip-sort',
    round: 3,
    colour: 'blue',
    moments: [{ name: 'carry', steps: 39, expect: { heldId: 'cube', liftDeg: ARM_UP, clawDeg: CLOSED, object: { id: 'cube', zCm: [8.9, 9.1], at: [34.19, 42.19] }, yawDeg: -90.96 } }],
  },
  {
    key: 'rb-grip-stack',
    round: 1,
    moments: [
      { name: 'start', steps: 0, expect: { heldId: null, liftDeg: ARM_UP, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [95, 40] }, yawDeg: 0 } },
      { name: 'approach', steps: 20, expect: { heldId: null, liftDeg: ARM_DOWN, clawDeg: OPEN, object: { id: 'cube', zCm: ON_FLOOR, at: [95, 40] }, yawDeg: 0 } },
      { name: 'grasp', steps: 40, expect: { heldId: 'cube', liftDeg: ARM_DOWN, clawDeg: CLOSED, object: { id: 'cube', zCm: ON_FLOOR, at: [95, 39.98] }, yawDeg: 0 } },
      { name: 'carry', steps: 70, expect: { heldId: 'cube', liftDeg: [54.5, 55.5], clawDeg: CLOSED, object: { id: 'cube', zCm: [6.4, 6.5], at: [127.51, 39.94] }, yawDeg: 0 } },
      { name: 'release', steps: 100, expect: { heldId: null, liftDeg: [54.5, 55.5], clawDeg: OPEN, object: { id: 'cube', zCm: [5.9, 6.0], at: [157.83, 39.91] }, yawDeg: 0 } },
    ],
  },
];

/**
 * The program a later round is replayed with: the reference with its last "kẹp mở" (block `put-open`) turned to "kẹp đóng", so that each
 * round fails (the cube is still held at the end) and Kiểm tra offers Xem lại for it. Every block before it is the reference's own, so the
 * world up to the put-down (5.7 s) is the reference's to the last bit (the spec compares it with the reference's trace).
 */
export function holdAtEnd<T>(blocks: T): T {
  const copy = structuredClone(blocks);
  let found = 0;
  const walk = (node: unknown) => {
    if (node === null || typeof node !== 'object') return;
    const block = node as { id?: unknown; type?: unknown; fields?: { STATE?: string } };
    if (block.id === 'put-open' && block.type === 'uno_gripper_claw' && block.fields?.STATE === 'OPEN') {
      block.fields.STATE = 'CLOSE';
      found += 1;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(copy);
  if (found !== 1) throw new Error(`The reference has ${found} "put-open" claw blocks, not 1.`);
  return copy;
}

/** A shot's file name: lesson, tier (or "2d"), moment, round colour, view. */
export function shotName(run: GripperLessonRun, tier: 'high' | 'low' | '2d', moment: GripperMomentName, view: string): string {
  const lesson = run.key.replace(/^rb-grip-/, '');
  return `${lesson}-${tier}-${moment}${run.colour !== undefined && run.round > 1 ? `-${run.colour}` : ''}-${view}`;
}
