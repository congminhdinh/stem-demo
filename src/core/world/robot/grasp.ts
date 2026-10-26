import type { ModuleSpecs } from '../../hardware/kit';
import type { Arena } from '../arena/arena-schema';
import type { BuiltArena } from '../arena/build-arena';
import { getRapier, type Collider, type PhysicsWorld, type RapierModule, type RigidBody } from '../rapier';
import { cmToM, radToDeg, rotateVector } from '../units';
import { GRIPPER_GROUP, innerFaceVCm, type Gripper, type GripperFinger } from './gripper';
import { conjugate, multiplyQuaternions } from './robot-frame';

// The grasp state machine (N19 B2, plan §4.4 with §4.6, D-G5; ADR 0004 §5.4, measured by the G0.1 spike in spikes/n19-grasp/grasp.ts):
// attach + hysteresis, as Gazebo's grasp fix does, not friction. It runs after each step of the world (world.ts: after stepWorld, before
// the sensors are measured) over the arena's objects in id order (UTF-16 code units, the same on every engine), and holds one at most.
//
// Free → held, when all five conditions hold for an object (the first in id order that meets them):
//   1. the claw command is at least the claw's angle − 0.5° (the servo is not opening);
//   2. the object's centre, in the carriage frame (u forward, v left, w up, cm), is at u ∈ [1.0, 5.5], |v| ≤ 1.5, |w| ≤ half its height;
//   3. both fingers are within CONTACT_GAP_M (2 mm) of it (a shape query, where the colliders are now);
//   4. the jaw gap at the object's u is at most its width across the jaws + 0.3 cm;
//   5. its massG is at most the gripper's maxPayloadG.
// On attach: θc is the claw's angle; each finger's target freezes where its inner face meets the object; a fixed ImpulseJoint carriage ↔
// object holds it (contacts off for that pair); the object's solver groups leave out GRIPPER_GROUP, so the fingers still touch it (a contact,
// for the sensors and the goals) but push nothing.
// Held → free:
//   - release when the claw command is at most θc − 6°;
//   - break when the contact impulses on the object from colliders that are not the gripper's, over dt, exceed 2·jawFriction·squeeze (the
//     squeeze: each finger's torque at half its length, `squeezeN`; ref-uno-gripper@0: 8.09 N, the break above 9.71 N). Pressing a held cube
//     on the floor peaks at 4.51 N (the car's weight lifts its nose first); driving it into a wall at 0.4 m/s gives 17–25 N.
// The four rules the spike added (§4.6, ADR 0004 §5.4):
//   1. latch after a break: nothing attaches again until the claw is commanded to θc − 6° or below (without it the still-closed claw
//      re-attaches on the next tick);
//   2. while nothing is held, the claw stops only when an object is clamped across it: both fingers within CONTACT_GAP_M and the jaw gap at
//      its centre no wider than its width + 0.05 cm; each finger then stops where it touches. A finger touching on its own keeps closing
//      and pushes a light object to the middle, as a real claw centres a cube (stalling each finger on its own contact shoved a 15 g cube
//      0.5 cm off centre sideways; stalling on "both touch" alone stopped the claw with a finger leaning on the cube, 4.48 cm apart).
//      A stalled finger stops, it is never opened (B2): the spike's stall also opened a finger that was into the object, by the depth over a
//      lever of 1 cm, and with a 60 g cube 0.25–1 cm off centre (funnelled in by the open jaws, up to 2 mm into a finger by the hinge) that
//      finger went to its open stop while the other pushed the cube round by 5.7–7.4°, β +12° / −5.4° (measured); stopped, the claw stalls at
//      25–28° with the cube turned 1.1–3.8° (centred: 26.95°, the same either way);
//   3. while held, each finger's target follows the held object's face every tick (the attach comes up to 2 mm early, and a contact by
//      the hinge has almost no lever: `touchingBeta`);
//   4. the gripper's colliders are members of GRIPPER_GROUP only for the solver too (gripper.ts), so that a held object leaving that group
//      out takes effect: a collider is a member of every group by default.
// And one more (B2 fix round 1, plan §4.6):
//   5. nothing attaches while the claw is under RELEASE_HYSTERESIS_DEG (6°): a held object is let go at a command ≤ θc − 6°, and commands
//      are 0..90, so one attached at θc < 6° could never be let go. The open jaws are 5.05 cm apart at u 3 and 6.08 cm at the tips: every
//      box from about 4.5 cm wide wedges on both fingers with the claw at about 0° and meets the five conditions there (measured: a 5 cm box
//      attached at θc −0.02° while the open jaws were driven onto it, lesson 11's 6×6×4 cm 40 g base at u 5.47, both carried with the claw
//      told 0°). Such an object is too wide to grip; the claw told to close just stalls on it.
//   6. nothing wider across the jaws than `gripWidthCm` attaches: the fingers' gap when parallel plus the attach's 0.3 cm (ref-uno-gripper@0:
//      2·2.2 − 0.4 + 0.3 = 4.3 cm). Condition 4 wants the gap at the object's centre within 0.3 cm of its width; the fingers splay outwards
//      from the hinges, so around an object wider than that they are inside it where they meet it. With rule 5 alone a 5 cm box still
//      attached, at θc 9.08°, both fingers 3.3 mm inside it (4.4–4.8 cm boxes at 9.5–9.6°, 1.5–3.2 mm), the claw having closed 5° into it
//      in one tick. Measured, the grasps the lessons make have one finger at most inside the object (a cube 1 cm off centre, funnelled in
//      by the open jaws: 2.07 mm), and a 3 cm cube turned 45° is 4.24 cm across.
//
// "Touching" in the sense of the narrow phase's manifolds (the tests' wall and chassis checks) is a positive contact impulse or a gap of at
// most 0.5 mm: a manifold's distance ≤ 0 alone misses the contacts the solver acts on before the gap closes (ADR 0004 §8). The machine itself
// measures gaps by shape queries (`contactCollider`), which give where the colliders are now.

/** Both fingers must be this close to an object for it to attach (plan §4.6), m. Not sensors/contacts.ts's 1 mm of a contact. */
export const CONTACT_GAP_M = 0.002;
/** Attach window of the object's centre in the carriage frame, cm: u ∈ [1.0, 5.5], |v| ≤ 1.5 (|w| ≤ half its height). */
export const ATTACH_U_CM: readonly [number, number] = [1.0, 5.5];
export const ATTACH_V_CM = 1.5;
/** Attach: the claw command is at least the claw's angle less this, degrees. */
export const ATTACH_COMMAND_SLACK_DEG = 0.5;
/** Attach: the jaw gap at the object's centre is at most its width plus this, cm. */
export const ATTACH_GAP_SLACK_CM = 0.3;
/** Release (and the latch after a break) at a claw command of θc less this, degrees. */
export const RELEASE_HYSTERESIS_DEG = 6;
/** The claw stalls on an object when the jaw gap at its centre is at most its width plus this, cm (rule 2). */
export const CLAMP_GAP_SLACK_CM = 0.05;
/** The lever a finger's correction uses is held within this, m: from 1 cm to the finger's length past its hinge (5.5 cm, rule 3). */
export const LEVER_M: readonly [number, number] = [0.01, 0.055];
/** Rapier's default interaction groups: a member of every group, interacting with every group. */
export const DEFAULT_GROUPS = 0xffffffff;
/** A held object's solver groups: its contacts with every group but GRIPPER_GROUP are solved. */
export const HELD_SOLVER_GROUPS = ((0xffff << 16) | (0xffff & ~GRIPPER_GROUP)) >>> 0;

type GripperSpec = ModuleSpecs['gripper'];
type FixedJoint = InstanceType<RapierModule['FixedImpulseJoint']>;

/** The squeeze of the jaws, N: each finger's torque (T_s / (2·fingerDegPerServoDeg)) at half the finger's length. ref-uno-gripper@0: 8.09. */
export function squeezeN(spec: GripperSpec): number {
  return spec.clawStallTorqueNm / (2 * spec.fingerDegPerServoDeg) / cmToM(spec.fingerLengthCm / 2);
}

/** Rule 6: the widest object across the jaws that attaches, cm: the fingers' gap when parallel plus ATTACH_GAP_SLACK_CM. ref-uno-gripper@0: 4.3. */
export function gripWidthCm(spec: GripperSpec): number {
  return 2 * spec.fingerHingeVCm - spec.fingerThicknessCm + ATTACH_GAP_SLACK_CM;
}

/** The external force above which a held object slips out, N: 2·jawFriction·squeeze (two jaws). ref-uno-gripper@0: 9.71. */
export function breakForceN(spec: GripperSpec): number {
  return 2 * spec.jawFriction * squeezeN(spec);
}

/** What the grasp machine knows of an arena object: its body, collider and mass, and its shape in its own frame (m; Rapier's axes). */
export type GraspObject = {
  readonly id: string;
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly massG: number;
  readonly shape: { readonly kind: 'box'; readonly halfM: { readonly x: number; readonly y: number; readonly z: number } } | { readonly kind: 'cylinder'; readonly radiusM: number; readonly halfHeightM: number };
};

/** The arena's objects (`arena.objects`, as built by buildArena) for the grasp machine, in the arena's order (createGrasp orders them by id). */
export function graspObjects(arena: Arena, built: BuiltArena): GraspObject[] {
  const specs = new Map(arena.objects.map((object) => [object.id, object]));
  const out: GraspObject[] = [];
  for (const dynamic of built.dynamicBodies) {
    if (dynamic.kind !== 'object') continue;
    const spec = specs.get(dynamic.id);
    if (spec === undefined) continue;
    // buildArena turns a box's [x, y, z] (z up) into Rapier's x, y up, z.
    const shape: GraspObject['shape'] =
      spec.shape === 'box'
        ? { kind: 'box', halfM: { x: cmToM(spec.sizeCm[0]) / 2, y: cmToM(spec.sizeCm[2]) / 2, z: cmToM(spec.sizeCm[1]) / 2 } }
        : { kind: 'cylinder', radiusM: cmToM(spec.radiusCm), halfHeightM: cmToM(spec.heightCm) / 2 };
    out.push({ id: dynamic.id, body: dynamic.body, collider: dynamic.body.collider(0), massG: spec.massG, shape });
  }
  return out;
}

/** Where an object is in the carriage frame, cm (u forward, v left, w up), and how wide (across v) and high (along w) it is there. */
export type CarriageView = { readonly u: number; readonly v: number; readonly w: number; readonly widthCm: number; readonly heightCm: number };

export type Grasp = {
  /** The objects it may hold, in id order. */
  readonly objects: readonly GraspObject[];
  /** The id of the held object, or null. */
  readonly heldId: string | null;
  /** The held object's body, or null: it counts as the robot's for contacts (world.ts). */
  readonly heldBody: RigidBody | null;
  /** The claw angle the held object was attached at (θc), degrees, or null. */
  readonly thetaCDeg: number | null;
  /** After a break, the θc that still blocks a new attach until the claw is commanded to latchDeg − 6° or below (rule 1); else null. */
  readonly latchDeg: number | null;
  /** The fixed joints it has alive: 0 or 1. */
  readonly liveJoints: number;
  /** After each world step of `dt` seconds. */
  update(dt: number): void;
  /**
   * Lets go of the held object, if any, removing its joint, and forgets the rest of the machine's state: no latch, no stall (placeAt, a
   * teleport such as a reset; dispose). Nothing of the run before it holds the claw back after.
   */
  release(): void;
  view(object: GraspObject): CarriageView;
};

export function createGrasp(world: PhysicsWorld, gripper: Gripper, objects: readonly GraspObject[]): Grasp {
  const R = getRapier();
  const { spec } = gripper;
  const ordered = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const breakN = breakForceN(spec);
  const widest = gripWidthCm(spec);
  let held: { readonly object: GraspObject; readonly joint: FixedJoint; readonly thetaC: number } | null = null;
  let latch: number | null = null;

  /** The object's centre and rotation in the carriage frame (Rapier's local axes of the carriage body). */
  const relative = (object: GraspObject) => {
    const inverse = conjugate(gripper.carriage.rotation());
    const pc = gripper.carriage.translation();
    const po = object.body.translation();
    return { at: rotateVector(inverse, { x: po.x - pc.x, y: po.y - pc.y, z: po.z - pc.z }), rotation: multiplyQuaternions(inverse, object.body.rotation()) };
  };

  const view = (object: GraspObject): CarriageView => {
    const { at, rotation } = relative(object);
    let halfAcross: number;
    let halfUp: number;
    if (object.shape.kind === 'box') {
      // Half its extent along the carriage's local z (across the jaws) and y (up): the support of the box in those directions.
      const ex = rotateVector(rotation, { x: 1, y: 0, z: 0 });
      const ey = rotateVector(rotation, { x: 0, y: 1, z: 0 });
      const ez = rotateVector(rotation, { x: 0, y: 0, z: 1 });
      const { x: hx, y: hy, z: hz } = object.shape.halfM;
      halfAcross = Math.abs(ex.z) * hx + Math.abs(ey.z) * hy + Math.abs(ez.z) * hz;
      halfUp = Math.abs(ex.y) * hx + Math.abs(ey.y) * hy + Math.abs(ez.y) * hz;
    } else {
      // A cylinder about its local y: radius·√(1 − a_d²) + halfHeight·|a_d| along a unit direction d, a its axis.
      const axis = rotateVector(rotation, { x: 0, y: 1, z: 0 });
      const { radiusM, halfHeightM } = object.shape;
      halfAcross = radiusM * Math.sqrt(Math.max(0, 1 - axis.z * axis.z)) + halfHeightM * Math.abs(axis.z);
      halfUp = radiusM * Math.sqrt(Math.max(0, 1 - axis.y * axis.y)) + halfHeightM * Math.abs(axis.y);
    }
    return { u: at.x * 100, v: (0 - at.z) * 100, w: at.y * 100, widthCm: 2 * halfAcross * 100, heightCm: 2 * halfUp * 100 };
  };

  /** The jaw gap at carriage u, cm: the two inner faces' distances from the centre line. */
  const jawGapCm = (uCm: number) => innerFaceVCm(spec, gripper.fingers[0].betaDeg(), uCm) + innerFaceVCm(spec, gripper.fingers[1].betaDeg(), uCm);

  /** The contact force on `object` from colliders that are not the gripper's on the last step, N. */
  const externalForceN = (object: GraspObject, dt: number) => {
    const others: Collider[] = [];
    world.contactPairsWith(object.collider, (other) => {
      if (!gripper.ownsCollider(other)) others.push(other);
    });
    let impulse = 0;
    for (const other of others) {
      world.contactPair(object.collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) {
          const n = manifold.contactImpulse(i);
          const t1 = manifold.contactTangentImpulseX(i);
          const t2 = manifold.contactTangentImpulseY(i);
          impulse += Math.sqrt(n * n + t1 * t1 + t2 * t2);
        }
      });
    }
    return impulse / dt;
  };

  /** A finger's contact with an object within CONTACT_GAP_M, where both are now, or null. */
  const contactOf = (finger: GripperFinger, object: GraspObject) => {
    const contact = finger.collider.contactCollider(object.collider, CONTACT_GAP_M);
    return contact !== null && contact.distance <= CONTACT_GAP_M ? contact : null;
  };

  /**
   * The β at which a finger's inner face meets the object of a contact (rule 3): its β less the signed gap over the lever to the contact
   * point, the lever held within LEVER_M (a contact at the cube's corner by the hinge has almost no lever and would swing the tip 4–9 mm
   * into the cube). An estimate, applied again every tick, so it converges onto the face.
   */
  const touchingBeta = (finger: GripperFinger, contact: { readonly distance: number; readonly point1: { readonly x: number; readonly y: number; readonly z: number } }) => {
    const hinge = finger.body.translation();
    const dx = contact.point1.x - hinge.x;
    const dy = contact.point1.y - hinge.y;
    const dz = contact.point1.z - hinge.z;
    const lever = Math.min(LEVER_M[1], Math.max(LEVER_M[0], Math.sqrt(dx * dx + dy * dy + dz * dz)));
    return finger.betaDeg() - radToDeg(contact.distance / lever);
  };

  /**
   * Rule 2: the claw's stall while nothing is held, each finger's least β (where it touches, and never more open than it is), or nulls when
   * no object is clamped across the jaws.
   */
  const stallLimits = (): [number | null, number | null] => {
    for (const object of ordered) {
      const left = contactOf(gripper.fingers[0], object);
      if (left === null) continue;
      const right = contactOf(gripper.fingers[1], object);
      if (right === null) continue;
      const at = view(object);
      if (jawGapCm(at.u) > at.widthCm + CLAMP_GAP_SLACK_CM) continue;
      const stop = (finger: GripperFinger, contact: NonNullable<typeof left>) => Math.min(touchingBeta(finger, contact), finger.betaDeg());
      return [stop(gripper.fingers[0], left), stop(gripper.fingers[1], right)];
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

  const tryAttach = () => {
    const clawNow = gripper.clawDeg();
    if (!(gripper.clawCommandDeg >= clawNow - ATTACH_COMMAND_SLACK_DEG)) return;
    // Rule 5: θc ≥ 6°, so the claw can always be told θc − 6° (commands are 0..90): what the jaws meet wider than that is not gripped.
    if (!(clawNow >= RELEASE_HYSTERESIS_DEG)) return;
    for (const object of ordered) {
      if (!(object.massG <= spec.maxPayloadG)) continue;
      const at = view(object);
      if (at.u < ATTACH_U_CM[0] || at.u > ATTACH_U_CM[1] || Math.abs(at.v) > ATTACH_V_CM || Math.abs(at.w) > at.heightCm / 2) continue;
      if (at.widthCm > widest) continue;
      const left = contactOf(gripper.fingers[0], object);
      if (left === null) continue;
      const right = contactOf(gripper.fingers[1], object);
      if (right === null) continue;
      if (jawGapCm(at.u) > at.widthCm + ATTACH_GAP_SLACK_CM) continue;

      // Each finger freezes where its inner face meets the object: the attach comes up to CONTACT_GAP_M early, so the target moves by the
      // signed gap over the lever. The fingers then show touching, and push nothing (solver groups).
      gripper.freezeFingers([touchingBeta(gripper.fingers[0], left), touchingBeta(gripper.fingers[1], right)]);
      const { at: anchor, rotation: frame } = relative(object);
      const joint = world.createImpulseJoint(R.JointData.fixed(anchor, frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), gripper.carriage, object.body, true) as FixedJoint;
      joint.setContactsEnabled(false);
      object.collider.setSolverGroups(HELD_SOLVER_GROUPS);
      held = { object, joint, thetaC: clawNow };
      return;
    }
  };

  return {
    objects: ordered,
    get heldId() {
      return held === null ? null : held.object.id;
    },
    get heldBody() {
      return held === null ? null : held.object.body;
    },
    get thetaCDeg() {
      return held === null ? null : held.thetaC;
    },
    get latchDeg() {
      return latch;
    },
    get liveJoints() {
      return held === null ? 0 : 1;
    },
    view,
    update(dt) {
      if (held !== null) {
        const { object, thetaC } = held;
        const externalN = externalForceN(object, dt);
        const left = contactOf(gripper.fingers[0], object);
        const right = contactOf(gripper.fingers[1], object);
        if (left !== null && right !== null) gripper.freezeFingers([touchingBeta(gripper.fingers[0], left), touchingBeta(gripper.fingers[1], right)]);
        if (gripper.clawCommandDeg <= thetaC - RELEASE_HYSTERESIS_DEG) {
          detach();
        } else if (externalN > breakN) {
          latch = thetaC;
          detach();
        }
        return;
      }
      gripper.stallFingers(stallLimits());
      if (latch !== null) {
        if (gripper.clawCommandDeg <= latch - RELEASE_HYSTERESIS_DEG) latch = null;
        else return;
      }
      tryAttach();
    },
    release() {
      detach();
      latch = null;
      gripper.stallFingers([null, null]);
    },
  };
}
