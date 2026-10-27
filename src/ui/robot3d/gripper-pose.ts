import type { RobotSnapshot, SnapshotGripper } from '../../core/world/snapshot';
import type { GripperModel } from './robot-model';

// The gripper's pose in the 3D view (N19 E6), from the snapshot's `robot.gripper {clawDeg, liftDeg, heldId}` (plan §4.4), by the geometry
// the world builds it with (N19 B1, world/robot/gripper.ts; ADR 0004 §2): the boom turns about the lateral axis at the mount, its elevation
// `elevationAtLift0Deg + liftDeg`; the carriage hangs level at the boom's tip (a parallelogram); each finger turns about the carriage's
// vertical at its hinge, β = fingerOpenDeg − fingerDegPerServoDeg · clawDeg within [the jaws' meeting angle, fingerOpenDeg], positive
// outwards. In the robot group's three.js frame (scene-math.ts: robot x, z, −y; m). A held object is not the gripper's: the world moves it
// with the carriage, and the view draws it where the snapshot's `objects` say. The view's own arithmetic (Math trigonometry): the world's
// determinism is not at stake here.

/** What the snapshot says of the gripper (plan §4.4; N19 B1/B2 `SnapshotGripper`). */
export type GripperState = SnapshotGripper;

/** What setup() writes before a run (plan D-G3, drivers/gripper-servo2.ts): the claw open, the lift up, nothing held. */
export const GRIPPER_REST: GripperState = Object.freeze({ clawDeg: 0, liftDeg: 90, heldId: null });

/** The snapshot's gripper, or setup()'s pose when the world has none yet (the view before a run, `idleSnapshot`). */
export const gripperStateOf = (world: RobotSnapshot): GripperState => world.robot.gripper ?? GRIPPER_REST;

type Vec3 = [number, number, number];

export type GripperPose = {
  /** The boom's elevation, rad: a turn about the robot group's +Z (three), raising the boom's +X towards +Y. */
  elevationRad: number;
  /** The boom's tip, where the carriage hangs (m). */
  tip: Vec3;
  /** Each finger's angle out from straight ahead, rad (the left finger turns by +β about +Y, the right one by −β). */
  betaRad: number;
  /** The fingers' hinges (m): the left one (robot +y, three −Z) and the right one. */
  jawLeft: Vec3;
  jawRight: Vec3;
};

const DEG = Math.PI / 180;

/** A pose to write into (`gripperPoseInto`), made once: the view poses the gripper every drawn frame (N19 E6 fix round 1, review M1). */
export const createGripperPose = (): GripperPose => ({ elevationRad: 0, tip: [0, 0, 0], betaRad: 0, jawLeft: [0, 0, 0], jawRight: [0, 0, 0] });

/** The gripper's pose at `state`, written into `out` (nothing is made). */
export function gripperPoseInto(out: GripperPose, gripper: GripperModel, state: Pick<GripperState, 'clawDeg' | 'liftDeg'>): GripperPose {
  const elevationRad = (gripper.elevationAtLift0Deg + state.liftDeg) * DEG;
  // Read by index: `const [px, py, pz] = gripper.position` takes the array's iterator, an allocation in every drawn frame (N19 E9).
  const { position } = gripper;
  const pz = position[2];
  const tx = position[0] + gripper.boomLengthM * Math.cos(elevationRad);
  const ty = position[1] + gripper.boomLengthM * Math.sin(elevationRad);
  const closed = gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * gripper.jawsMeetDeg;
  const beta = Math.min(gripper.fingerOpenDeg, Math.max(closed, gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * state.clawDeg));
  out.elevationRad = elevationRad;
  out.tip[0] = tx;
  out.tip[1] = ty;
  out.tip[2] = pz;
  out.betaRad = beta * DEG;
  out.jawLeft[0] = out.jawRight[0] = tx + gripper.hinge.uM;
  out.jawLeft[1] = out.jawRight[1] = ty;
  out.jawLeft[2] = pz - gripper.hinge.vM;
  out.jawRight[2] = pz + gripper.hinge.vM;
  return out;
}

/** The gripper's pose at `state`, a new one (tests, fixtures). */
export const gripperPose = (gripper: GripperModel, state: Pick<GripperState, 'clawDeg' | 'liftDeg'>): GripperPose => gripperPoseInto(createGripperPose(), gripper, state);

/**
 * Whether the colour sensor's white LED is lit: while the robot runs. The breakout's LED is on whenever the board powers it (its LED pin
 * pulled up; the kit wires only SDA and SCL), and the lab's board is powered while a run or teleop goes.
 */
export const colorLedLit = (world: RobotSnapshot): boolean => world.status === 'running';
