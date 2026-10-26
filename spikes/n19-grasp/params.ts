// N19 G0.1 grasp spike: the gripper car's numbers (docs/n19-gripper-plan.md §4.1, §4.4).
//
// PLACEHOLDER: every kit number here is a placeholder until the vendor's kit is measured (plan §3, §10). The spike reads them from
// this one file so a corrected value is changed in one place.
//
// Frames: the kit's robot frame (x forward, y left, z up, cm; kit.ts `KitModule.mount`). The carriage frame (u forward, v left,
// w up, cm) has its origin at the boom tip (the carriage hinge) and, when the carriage is level, the chassis' axes.

import roverJson from '../../src/core/hardware/kits/ref-uno-rover.kit.json';

/** GripperSpec of plan §4.1 (PLACEHOLDER). */
export const GRIPPER_SPEC = {
  liftSPer60Deg: 0.1,
  liftStallTorqueNm: 0.18,
  boomLengthCm: 5,
  boomHalfSpanCm: 6.6,
  boomMassG: 6,
  carriageMassG: 22,
  clawSPer60Deg: 0.1,
  clawStallTorqueNm: 0.18,
  jawsMeetDeg: 80,
  fingerOpenDeg: 12,
  fingerDegPerServoDeg: 0.445,
  fingerLengthCm: 5,
  fingerMassG: 3,
  jawFriction: 0.6,
  maxPayloadG: 50,
} as const;

/** The GR1 mount (§4.1): the boom's pivot in the robot frame, cm. */
export const GRIPPER_MOUNT_CM = [4.5, 0, 4.9] as const;

// ---- Geometry the plan implies but does not name (derived here; the ADR records each derivation) ----

/**
 * The boom's elevation at lift 0°, degrees above the horizontal. §4.1: lowered, the jaws are at x 8.83–13.83 and z 1.09–2.29, so the
 * boom tip is at x 8.33 = 4.5 + 5·cos α and z 1.69 = 4.9 + 5·sin α: α = −40°. The reach is longest at lift 40° (boom level), as §4.1
 * says. Elevation = lift − 40°, so lift 90° is 50° up.
 */
export const BOOM_ELEVATION_AT_LIFT0_DEG = -40;
/** Finger hinges in the carriage frame (§4.4): u 0.5, v ±2.2 cm. */
export const FINGER_HINGE_U_CM = 0.5;
export const FINGER_HINGE_V_CM = 2.2;
/**
 * Finger thickness, cm. §4.1's open tip gap of 6.08 cm = 2·(2.2 + 5·sin 12°) − t gives t = 0.40. Then the inner faces are 4.0 cm
 * apart, parallel, at claw 26.97° (β = 0): a 4 cm cube is gripped flat.
 */
export const FINGER_THICKNESS_CM = 0.4;
/** Jaw (finger) height, cm: §4.1's jaws span z 1.09–2.29 at lift 0°, centred on the boom tip. */
export const JAW_HEIGHT_CM = 1.2;
/** The carriage box (holds the claw servo): u −0.5..0.5, v ±2.6, w ±0.6 cm. Spike choice. */
export const CARRIAGE_HALF_CM = [0.5, 0.6, 2.6] as const; // local x (u), y (w), z (v)
/** The boom's side plates (one each side, outside the 12 cm body) and the cross bar at the tip. Spike choice. */
export const BOOM_PLATE_HALF_CM = [2.5, 0.5, 0.2] as const;
export const BOOM_BAR_HALF_CM = [0.3, 0.3, 6.8] as const;

// ---- The grasp model (§4.4) ----

/** The parallel link's hold motor: max torque, N·m (§4.4). */
export const LINK_HOLD_NM = 1;
/** Extra PGS iterations on every gripper body (§4.4; the servo arm's ARM_EXTRA_PGS_ITERATIONS). */
export const GRIPPER_EXTRA_PGS_ITERATIONS = 4;
/** GRIPPER_GROUP (§4.4): gripper colliders do not collide with each other. */
export const GRIPPER_GROUP = 0x0004;
/** A finger "touches" an object within this gap, m. Not named in the plan; spike choice (2 mm). */
export const CONTACT_GAP_M = 0.002;
/** Attach window in the carriage frame (§4.4): u ∈ [1.0, 5.5], |v| ≤ 1.5 cm, |w| ≤ half the object's height. */
export const ATTACH_U_CM = [1.0, 5.5] as const;
export const ATTACH_V_CM = 1.5;
/** Attach: the claw command is at least the current claw angle − 0.5°. */
export const ATTACH_COMMAND_SLACK_DEG = 0.5;
/** Attach: the jaw gap at the object's centre is at most its width + 0.3 cm. */
export const ATTACH_GAP_SLACK_CM = 0.3;
/** Release when the claw command is ≤ θc − 6°. */
export const RELEASE_HYSTERESIS_DEG = 6;

/**
 * The squeeze, N: one servo drives both fingers through gears (β = 12 − 0.445·θ), so each finger gets T_s / (2·0.445) =
 * 0.202 N·m, which presses a flat 4 cm face with its resultant at half the finger (2.5 cm): 8.09 N. The plan's "about 9.6 N"
 * break threshold is 2·μ·N with N ≈ 8: here 2 · 0.6 · 8.09 = 9.71 N.
 */
export const FINGER_TORQUE_NM = GRIPPER_SPEC.clawStallTorqueNm / (2 * GRIPPER_SPEC.fingerDegPerServoDeg);
export const SQUEEZE_N = FINGER_TORQUE_NM / (GRIPPER_SPEC.fingerLengthCm / 2 / 100);
export const BREAK_FORCE_N = 2 * GRIPPER_SPEC.jawFriction * SQUEEZE_N;

// ---- The gripper kit, built from the rover kit (§4.1) ----

/** Mass of the gripper's own bodies, g: boom 6 + carriage 22 + 2 fingers × 3 = 34. */
export const GRIPPER_BODIES_G = GRIPPER_SPEC.boomMassG + GRIPPER_SPEC.carriageMassG + 2 * GRIPPER_SPEC.fingerMassG;

/**
 * The kit the production builder (assembly.ts `assembleRobot`) gets: ref-uno-rover@0 without the flag servo and the buzzer (§4.1),
 * the ultrasonic at [7.5, 0, 5.0], and §4.1's chassis: massG 460 for the whole robot, comCm [-1.2, 0, 3.6]. assembleRobot gives the
 * chassis body massG less the servo arms' masses; it does not know the gripper, so the spike passes 460 − 34 = 426 g (what a
 * production `gripper` module would subtract, like a servo arm) and comCm as the chassis body's centre of mass.
 */
export function gripperKitJson(boomMassG: number = GRIPPER_SPEC.boomMassG): unknown {
  const rover = JSON.parse(JSON.stringify(roverJson)) as {
    id: string;
    chassis: { massG: number; comCm: number[] };
    ports: { id: string }[];
    modules: { role: string; mount: { posCm: number[] } }[];
  };
  rover.id = 'spike-uno-gripper';
  rover.chassis.massG = 460 - (GRIPPER_BODIES_G - GRIPPER_SPEC.boomMassG + boomMassG);
  rover.chassis.comCm = [-1.2, 0, 3.6];
  rover.ports = rover.ports.filter((port) => port.id !== 'SV1' && port.id !== 'BZ1');
  rover.modules = rover.modules.filter((module) => module.role !== 'servo1' && module.role !== 'buzzer');
  for (const module of rover.modules) if (module.role === 'ultrasonic') module.mount.posCm = [7.5, 0, 5.0];
  return rover;
}
