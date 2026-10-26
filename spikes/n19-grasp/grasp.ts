// N19 G0.1 grasp spike: the grasp state machine of plan §4.4 (attach + hysteresis, D-G5), run after every world step.
//
// Free → held when all five conditions hold for an object (objects tried in id order, at most one held):
//   1. claw command ≥ the claw's angle − 0.5°;
//   2. the object's centre in the carriage frame: u ∈ [1.0, 5.5], |v| ≤ 1.5, |w| ≤ half its height;
//   3. both fingers within CONTACT_GAP_M of it (a shape query: works for sensor fingers too);
//   4. the jaw gap at the object's u ≤ its width across the jaws + 0.3 cm;
//   5. massG ≤ maxPayloadG.
// On attach: θc = the claw angle; the finger targets freeze where they touch it (and follow its faces while held); a fixed
// ImpulseJoint carriage ↔ object (contacts off for the pair); the object's solver groups drop GRIPPER_GROUP, so the fingers still
// touch it but push nothing.
// While nothing is held, the claw stalls when an object is pinched across it (the servo cannot close through it): `stallLimits`.
// Held → free: release when the claw command ≤ θc − 6°; break when the contact impulses on the object from colliders that are not
// the gripper's, over dt, exceed 2·jawFriction·squeeze (BREAK_FORCE_N). After a break the claw must be commanded open past θc − 6°
// before anything attaches again (the spike's addition: without it the still-closed claw re-attaches on the next tick).

import { cos, sin } from '../../src/core/world/dmath';
import { getRapier, type Collider, type PhysicsWorld, type RapierModule, type RigidBody } from '../../src/core/world/rapier';
import { conjugate, multiplyQuaternions } from '../../src/core/world/robot/robot-frame';
import { degToRad, radToDeg, rotateVector } from '../../src/core/world/units';
import { DEFAULT_GROUPS, HELD_SOLVER_GROUPS, type Gripper } from './gripper';
import {
  ATTACH_COMMAND_SLACK_DEG,
  ATTACH_GAP_SLACK_CM,
  ATTACH_U_CM,
  ATTACH_V_CM,
  BREAK_FORCE_N,
  CONTACT_GAP_M,
  FINGER_HINGE_U_CM,
  FINGER_HINGE_V_CM,
  FINGER_THICKNESS_CM,
  GRIPPER_SPEC,
  RELEASE_HYSTERESIS_DEG,
} from './params';

export type GraspObject = {
  readonly id: string;
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly massG: number;
  /** Half extents of the box in its own frame, m (x, y up, z). */
  readonly half: { readonly x: number; readonly y: number; readonly z: number };
};

export type GraspEvent = { readonly tick: number; readonly kind: 'attach' | 'release' | 'break'; readonly id: string; readonly thetaCDeg: number; readonly forceN?: number };

/** Where an object is in the carriage frame, cm (u forward, v left, w up), and its extents across v and w. */
export type CarriageView = { readonly u: number; readonly v: number; readonly w: number; readonly widthCm: number; readonly heightCm: number };

export type Grasp = {
  readonly heldId: string | null;
  readonly thetaCDeg: number | null;
  readonly events: readonly GraspEvent[];
  /** The external contact force on the held object on the last step, N (0 when nothing is held). */
  readonly lastExternalN: number;
  /** After each world step. */
  update(tick: number, dt: number): void;
  /** Drops the held object (placeAt, dispose): removes the joint. */
  dropAll(tick: number): void;
  view(object: GraspObject): CarriageView;
  /** The number of fixed joints this machine has alive (0 or 1). */
  readonly liveJoints: number;
};

type FixedJoint = InstanceType<RapierModule['FixedImpulseJoint']>;

/** The lever range of `touchingBeta`, m: 1 cm to the finger's length plus its hinge offset. */
const LEVER_M = [0.01, 0.055] as const;
/** The claw is blocked when the jaw gap at an object's centre is at most its width plus this (cm). Spike choice. */
const STALL_GAP_SLACK_CM = 0.05;

export function createGrasp(world: PhysicsWorld, gripper: Gripper, objects: readonly GraspObject[]): Grasp {
  const R = getRapier();
  const ordered = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const events: GraspEvent[] = [];
  let held: { object: GraspObject; joint: FixedJoint; thetaC: number } | null = null;
  let brokenThetaC: number | null = null;
  let lastExternalN = 0;
  const halfT = FINGER_THICKNESS_CM / 2;

  const view = (object: GraspObject): CarriageView => {
    const qc = gripper.carriage.rotation();
    const pc = gripper.carriage.translation();
    const po = object.body.translation();
    const inverse = conjugate(qc);
    const p = rotateVector(inverse, { x: po.x - pc.x, y: po.y - pc.y, z: po.z - pc.z });
    const rel = multiplyQuaternions(inverse, object.body.rotation());
    const ex = rotateVector(rel, { x: 1, y: 0, z: 0 });
    const ey = rotateVector(rel, { x: 0, y: 1, z: 0 });
    const ez = rotateVector(rel, { x: 0, y: 0, z: 1 });
    const { x: hx, y: hy, z: hz } = object.half;
    const width = 2 * (Math.abs(ex.z) * hx + Math.abs(ey.z) * hy + Math.abs(ez.z) * hz);
    const height = 2 * (Math.abs(ex.y) * hx + Math.abs(ey.y) * hy + Math.abs(ez.y) * hz);
    return { u: p.x * 100, v: (0 - p.z) * 100, w: p.y * 100, widthCm: width * 100, heightCm: height * 100 };
  };

  /** The inner face of a finger at u (cm), as |v| from the centre line. */
  const innerV = (betaDeg: number, u: number) => {
    const b = degToRad(betaDeg);
    const c = cos(b);
    const s = sin(b);
    const along = (u - FINGER_HINGE_U_CM - halfT * s) / c;
    return FINGER_HINGE_V_CM + along * s - halfT * c;
  };

  const externalForceN = (object: GraspObject, dt: number) => {
    let impulse = 0;
    world.contactPairsWith(object.collider, (other) => {
      if (gripper.ownsCollider(other)) return;
      world.contactPair(object.collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          const n = manifold.contactImpulse(i);
          const t1 = manifold.contactTangentImpulseX(i);
          const t2 = manifold.contactTangentImpulseY(i);
          impulse += Math.sqrt(n * n + t1 * t1 + t2 * t2);
        }
      });
    });
    return impulse / dt;
  };

  /**
   * The β at which a finger's inner face meets the object of a contact: the signed distance over the lever to the contact point,
   * the lever held within LEVER_M (a contact at the cube's corner next to the hinge has almost no lever, and would swing the finger
   * tip deep into the cube). An estimate: it is applied again every tick (stall, hold), so it converges onto the face.
   */
  const touchingBeta = (finger: Gripper['fingers'][number], contact: { distance: number; point1: { x: number; y: number; z: number } }) => {
    const hinge = finger.body.translation();
    const dx = contact.point1.x - hinge.x;
    const dy = contact.point1.y - hinge.y;
    const dz = contact.point1.z - hinge.z;
    const lever = Math.min(LEVER_M[1], Math.max(LEVER_M[0], Math.sqrt(dx * dx + dy * dy + dz * dz)));
    return finger.betaDeg() - radToDeg(contact.distance / lever);
  };

  /**
   * The claw's stall: one servo drives both fingers through gears, so the claw is blocked only when an object is pinched across
   * it: both fingers within CONTACT_GAP_M of it and the jaw gap at its centre no wider than it (+ STALL_GAP_SLACK_CM). Then each
   * finger stops where it touches. A finger touching on its own keeps closing and pushes a light object towards the middle, as a
   * real claw centres a cube. Measured: stalling each finger on its own contact let the other finger shove a 15 g cube placed 0.5 cm
   * off centre sideways; stalling on "both touch" alone stopped the claw with an open finger leaning on the cube (gap 4.48 cm for a 4
   * cm cube). In both, nothing attached.
   */
  const stallLimits = (): [number | null, number | null] => {
    for (const object of ordered) {
      const left = gripper.fingers[0].collider.contactCollider(object.collider, CONTACT_GAP_M);
      const right = gripper.fingers[1].collider.contactCollider(object.collider, CONTACT_GAP_M);
      if (left === null || right === null) continue;
      const at = view(object);
      const gap = innerV(gripper.fingers[0].betaDeg(), at.u) + innerV(gripper.fingers[1].betaDeg(), at.u);
      if (gap > at.widthCm + STALL_GAP_SLACK_CM) continue;
      return [touchingBeta(gripper.fingers[0], left), touchingBeta(gripper.fingers[1], right)];
    }
    return [null, null];
  };

  const detach = () => {
    if (held === null) return;
    world.removeImpulseJoint(held.joint, true);
    held.object.collider.setSolverGroups(DEFAULT_GROUPS);
    gripper.freezeFingers(null);
    held = null;
  };

  const tryAttach = (tick: number) => {
    const clawNow = gripper.clawDeg();
    if (!(gripper.clawCommandDeg >= clawNow - ATTACH_COMMAND_SLACK_DEG)) return;
    for (const object of ordered) {
      if (object.massG > GRIPPER_SPEC.maxPayloadG) continue;
      const at = view(object);
      if (at.u < ATTACH_U_CM[0] || at.u > ATTACH_U_CM[1] || Math.abs(at.v) > ATTACH_V_CM || Math.abs(at.w) > at.heightCm / 2) continue;
      const contacts = gripper.fingers.map((finger) => finger.collider.contactCollider(object.collider, CONTACT_GAP_M));
      if (contacts[0] === null || contacts[1] === null) continue;
      const gap = innerV(gripper.fingers[0].betaDeg(), at.u) + innerV(gripper.fingers[1].betaDeg(), at.u);
      if (gap > at.widthCm + ATTACH_GAP_SLACK_CM) continue;

      // Freeze each finger where its inner face meets the object: attach comes up to CONTACT_GAP_M early (a solid finger still short
      // of the face, a sensor finger up to a tick of travel past it), so each finger's target is moved by its signed distance over its
      // lever (closing for a gap, opening for a penetration). The fingers then show touching, and push nothing (solver groups).
      const frozen = gripper.fingers.map((finger, i) => touchingBeta(finger, contacts[i]!)) as [number, number];
      gripper.freezeFingers(frozen);

      const qc = gripper.carriage.rotation();
      const pc = gripper.carriage.translation();
      const po = object.body.translation();
      const inverse = conjugate(qc);
      const anchor = rotateVector(inverse, { x: po.x - pc.x, y: po.y - pc.y, z: po.z - pc.z });
      const frame = multiplyQuaternions(inverse, object.body.rotation());
      const joint = world.createImpulseJoint(
        R.JointData.fixed(anchor, frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }),
        gripper.carriage,
        object.body,
        true,
      ) as FixedJoint;
      joint.setContactsEnabled(false);
      object.collider.setSolverGroups(HELD_SOLVER_GROUPS);
      held = { object, joint, thetaC: clawNow };
      events.push({ tick, kind: 'attach', id: object.id, thetaCDeg: clawNow });
      return;
    }
  };

  return {
    get heldId() {
      return held === null ? null : held.object.id;
    },
    get thetaCDeg() {
      return held === null ? null : held.thetaC;
    },
    get events() {
      return events;
    },
    get lastExternalN() {
      return lastExternalN;
    },
    get liveJoints() {
      return held === null ? 0 : 1;
    },
    view,
    update(tick, dt) {
      if (held !== null) {
        lastExternalN = externalForceN(held.object, dt);
        // Keep the fingers on the held object's faces (they push nothing: the object's solver groups leave them out).
        const object = held.object;
        const frozen = gripper.fingers.map((finger) => {
          const contact = finger.collider.contactCollider(object.collider, CONTACT_GAP_M);
          return contact === null ? null : touchingBeta(finger, contact);
        });
        if (frozen[0] !== null && frozen[1] !== null) gripper.freezeFingers([frozen[0]!, frozen[1]!]);
        if (gripper.clawCommandDeg <= held.thetaC - RELEASE_HYSTERESIS_DEG) {
          events.push({ tick, kind: 'release', id: held.object.id, thetaCDeg: held.thetaC });
          detach();
        } else if (lastExternalN > BREAK_FORCE_N) {
          events.push({ tick, kind: 'break', id: held.object.id, thetaCDeg: held.thetaC, forceN: lastExternalN });
          brokenThetaC = held.thetaC;
          detach();
        }
        return;
      }
      lastExternalN = 0;
      gripper.stallFingers(stallLimits());
      if (brokenThetaC !== null) {
        if (gripper.clawCommandDeg <= brokenThetaC - RELEASE_HYSTERESIS_DEG) brokenThetaC = null;
        else return;
      }
      tryAttach(tick);
    },
    dropAll(tick) {
      if (held !== null) events.push({ tick, kind: 'release', id: held.object.id, thetaCDeg: held.thetaC });
      detach();
    },
  };
}
