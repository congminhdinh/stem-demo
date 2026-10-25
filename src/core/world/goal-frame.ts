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
//   - `speedCmS`: the speed of the middle of the body (the point of the robot's pose) over the floor, 0 or more.
//   - `objects`: the arena's objects (`arena.objects`) by id; the dynamic boxes and cylinders of the snapshot are not goals' objects.
//   - `servoDeg` by role, `leds` by role, `outOfArena` latched, `tS` the snapshot's `t`.

/** What a goal frame needs besides the snapshot. */
export type GoalFrameExtras = {
  /** What the robot touches on this tick (`World.sense.contacts()`, the floor included: the frame leaves it out). */
  readonly contacts: readonly ContactEvent[];
  /** How fast the middle of the body moves over the floor, cm/s. */
  readonly speedCmS: number;
  /** The robot's outline on the floor, in the arena's frame. */
  readonly footprint: GoalFootprint;
  /** The frequency the buzzer plays, Hz, or null when it is silent (R3.6 reads it from the pins). Left out: null. */
  readonly buzzerHz?: number | null;
};

const goalPose = (pose: Pose): GoalPose => ({ xCm: pose.xCm, yCm: pose.yCm, yawDeg: pose.yawDeg });

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
    servoDeg: snapshot.robot.servoDeg,
    leds: snapshot.leds,
    buzzerHz: extras.buzzerHz ?? null,
    outOfArena: snapshot.outOfArena,
  };
}
