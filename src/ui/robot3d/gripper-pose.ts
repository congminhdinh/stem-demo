import type { RobotSnapshot } from '../../core/world/snapshot';
import type { GripperModel } from './robot-model';
import type { Vec3Tuple } from './scene-math';

// The gripper's pose in the 3D view (N19 E6), from the snapshot's `robot.gripper {clawDeg, liftDeg, heldId}` (plan §4.4), by the geometry
// the world builds it with (N19 B1, world/robot/gripper.ts; ADR 0004 §2): the boom turns about the lateral axis at the mount, its elevation
// `elevationAtLift0Deg + liftDeg`; the carriage hangs level at the boom's tip (a parallelogram); each finger turns about the carriage's
// vertical at its hinge, β = fingerOpenDeg − fingerDegPerServoDeg · clawDeg within [the jaws' meeting angle, fingerOpenDeg], positive
// outwards. In the robot group's three.js frame (scene-math.ts: robot x, z, −y; m). A held object is not the gripper's: the world moves it
// with the carriage, and the view draws it where the snapshot's `objects` say. The view's own arithmetic (Math trigonometry): the world's
// determinism is not at stake here.

/** What the snapshot says of the gripper (plan §4.4). */
export type GripperState = { readonly clawDeg: number; readonly liftDeg: number; readonly heldId: string | null };

/** What setup() writes before a run (plan D-G3, drivers/gripper-servo2.ts): the claw open, the lift up, nothing held. */
export const GRIPPER_REST: GripperState = Object.freeze({ clawDeg: 0, liftDeg: 90, heldId: null });

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The snapshot's gripper (N19 B4 adds it to RobotSnapshot['robot']), or setup()'s pose when the world has none yet (before a run). */
export function gripperStateOf(world: RobotSnapshot): GripperState {
  const state = (world.robot as { readonly gripper?: Partial<GripperState> }).gripper;
  if (!state || !isNumber(state.clawDeg) || !isNumber(state.liftDeg)) return GRIPPER_REST;
  return { clawDeg: state.clawDeg, liftDeg: state.liftDeg, heldId: typeof state.heldId === 'string' ? state.heldId : null };
}

export type GripperPose = {
  /** The boom's elevation, rad: a turn about the robot group's +Z (three), raising the boom's +X towards +Y. */
  elevationRad: number;
  /** The boom's tip, where the carriage hangs (m). */
  tip: Vec3Tuple;
  /** Each finger's angle out from straight ahead, rad (the left finger turns by +β about +Y, the right one by −β). */
  betaRad: number;
  /** The fingers' hinges (m): the left one (robot +y, three −Z) and the right one. */
  jawLeft: Vec3Tuple;
  jawRight: Vec3Tuple;
};

const DEG = Math.PI / 180;

export function gripperPose(gripper: GripperModel, state: Pick<GripperState, 'clawDeg' | 'liftDeg'>): GripperPose {
  const elevationRad = (gripper.elevationAtLift0Deg + state.liftDeg) * DEG;
  const [px, py, pz] = gripper.position;
  const tip: Vec3Tuple = [px + gripper.boomLengthM * Math.cos(elevationRad), py + gripper.boomLengthM * Math.sin(elevationRad), pz];
  const closed = gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * gripper.jawsMeetDeg;
  const beta = Math.min(gripper.fingerOpenDeg, Math.max(closed, gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * state.clawDeg));
  const hingeX = tip[0] + gripper.hinge.uM;
  return {
    elevationRad,
    tip,
    betaRad: beta * DEG,
    jawLeft: [hingeX, tip[1], tip[2] - gripper.hinge.vM],
    jawRight: [hingeX, tip[1], tip[2] + gripper.hinge.vM],
  };
}

/**
 * Whether the colour sensor's white LED is lit: while the robot runs. The breakout's LED is on whenever the board powers it (its LED pin
 * pulled up; the kit wires only SDA and SCL), and the lab's board is powered while a run or teleop goes.
 */
export const colorLedLit = (world: RobotSnapshot): boolean => world.status === 'running';
