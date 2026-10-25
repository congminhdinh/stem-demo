import type { PointCm } from './arena/arena-schema';
import type { GoalFootprint, GoalFrame, GoalPose } from '../scenario/goals/frame';
import type { ContactEvent, Pose, RobotSnapshot } from './snapshot';

// The goals' view of a tick (N18 R3.5, R6.1 ruling): a RobotSnapshot turned into the `GoalFrame` the goal library judges
// (scenario/goals/frame.ts), plain centimetres and degrees in the arena's frame. Pure, no Rapier: the world gives the snapshot and
// the few things a snapshot does not carry (`GoalFrameExtras`, from `World.frameExtras()`), and the run session (R3.6) adds the
// buzzer, which only the virtual UNO's pins know.
//
// The contract with R6.1 (r61-report.md):
//   - `contacts`: the colliders the robot touches on this tick, each with every tag it has, its kind among them (`wall`, `box`,
//     `cylinder`, `object`, as build-arena.ts adds it). The floor is not a contact: `#ground` is left out.
//   - `lineSpotsCm`: the centre of each line sensor's spot on the floor; a sensor lifted off the floor (more than 3 cm) is left out.
//   - `speedCmS`: how fast the robot drives, 0 or more: the speed of the middle of its wheel axle, with a turn about a point within
//     1 cm of it counting as no drive (world.ts `TURN_IN_PLACE_TOLERANCE_CM`), so a robot spinning in place has 0 and the guard
//     goals do not count its spin as a path. Where the robot is (`xCm`, `yCm`) is the middle of its body, as R6.1 defines it.
//   - `servoDeg`: each arm's angle snapped to a thousandth of a degree, then clamped to its servo's minDeg..maxDeg
//     (`extras.servoRangeDeg`). The physics leaves an arm a hair off where it is told (measured: folded at 0° it reads −1.2e-6°;
//     driven to an end it passes it by up to 0.06°; held at 180° it jitters from 179.999987° to 180.000084°, held at 90° from
//     89.9999998°), which a goal from `minDeg: 0`, to `maxDeg: 180` or of `minDeg = maxDeg` would not accept. A thousandth of a
//     degree is 75 times the jitter and far below what a hobby servo resolves (about 1°). The snapshot keeps the physical angle,
//     for the view.
//   - `objects`: the arena's objects (`arena.objects`) by id; the dynamic boxes and cylinders of the snapshot are not goals' objects.
//   - `servoDeg` by role, `leds` by role, `outOfArena` latched, `tS` the snapshot's `t`.

/** What a goal frame needs besides the snapshot. */
export type GoalFrameExtras = {
  /** What the robot touches on this tick (`World.sense.contacts()`, the floor included: the frame leaves it out). */
  readonly contacts: readonly ContactEvent[];
  /** How fast the robot drives over the floor, cm/s (see the top of this file). */
  readonly speedCmS: number;
  /** The robot's outline on the floor, in the arena's frame. */
  readonly footprint: GoalFootprint;
  /** Each servo's range, [minDeg, maxDeg], by role (the kit's spec): the goal frame clamps the angle to it. A role left out is not clamped. */
  readonly servoRangeDeg: Readonly<Record<string, readonly [number, number]>>;
  /** The frequency the buzzer plays, Hz, or null when it is silent (R3.6 reads it from the pins). Left out: null. */
  readonly buzzerHz?: number | null;
};

const goalPose = (pose: Pose): GoalPose => ({ xCm: pose.xCm, yCm: pose.yCm, yawDeg: pose.yawDeg });

/** Servo angles are snapped to whole thousandths of a degree (see the top of this file). */
const SERVO_QUANTUM_PER_DEG = 1e3;

/** An arm's angle as a goal reads it: snapped to a thousandth of a degree, then clamped to its range (+0, never −0). */
function goalServoDeg(deg: number, range: readonly [number, number] | undefined): number {
  const snapped = Math.round(deg * SERVO_QUANTUM_PER_DEG) / SERVO_QUANTUM_PER_DEG;
  return (range === undefined ? snapped : Math.min(range[1], Math.max(range[0], snapped))) + 0;
}

/** The goal frame of a snapshot (see the top of this file). A new object each call; neither argument is changed. */
export function toGoalFrame(snapshot: RobotSnapshot, extras: GoalFrameExtras): GoalFrame {
  const lineSpotsCm: PointCm[] = [];
  for (const sensor of snapshot.sensors) {
    if (sensor.kind === 'line-sensor' && sensor.spotCm !== null) lineSpotsCm.push([sensor.spotCm[0], sensor.spotCm[1]]);
  }
  // fromEntries defines each id as an own field, so an id such as "__proto__" (letters and "_" are allowed) is an object like any other.
  const objects: Record<string, GoalPose> = Object.fromEntries(
    snapshot.objects.filter((object) => object.kind === 'object').map((object) => [object.id, goalPose(object.pose)]),
  );
  return {
    tS: snapshot.t,
    robot: { ...goalPose(snapshot.robot), speedCmS: extras.speedCmS, footprint: extras.footprint, lineSpotsCm },
    objects,
    contacts: extras.contacts.filter((contact) => contact.kind !== 'ground').map((contact) => ({ otherId: contact.otherId, tags: contact.tags })),
    servoDeg: Object.fromEntries(
      Object.entries(snapshot.robot.servoDeg).map(([role, deg]) => [role, goalServoDeg(deg, Object.hasOwn(extras.servoRangeDeg, role) ? extras.servoRangeDeg[role] : undefined)]),
    ),
    leds: snapshot.leds,
    buzzerHz: extras.buzzerHz ?? null,
    outOfArena: snapshot.outOfArena,
  };
}
