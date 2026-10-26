import { beforeAll, describe, expect, it } from 'vitest';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { BRAKE, backward, cube, forward, gripperKit, gripperScene, pick, run, seconds, until, wait, type GripperScene, type Script } from '../__fixtures__/gripper-scene';
import type { ArenaInput } from '../arena/arena-schema';
import { initPhysics, type Collider } from '../rapier';
import { rotateVector, type Quat } from '../units';
import { breakForceN, CONTACT_GAP_M, DEFAULT_GROUPS, gripWidthCm, HELD_SOLVER_GROUPS, squeezeN, type GraspObject } from './grasp';
import { innerFaceVCm } from './gripper';

// N19 B2 (plan §4.4 with §4.6; ADR 0004 §4.2, §4.3, §5.4): the grasp state machine on ref-uno-gripper@0, attach + hysteresis. Scripts set
// the targets each tick as the G0.1 spike did (spikes/n19-grasp/scenarios.ts); measures use Math trigonometry (tests only).
//
// The five attach conditions are checked by an oracle written from §4.4, evaluated where the machine evaluates them (after the physics
// step, before the machine's update): on every tick where nothing is held and nothing is latched, the object is attached after the update
// exactly when all five held. Each of the five has a test of its own in which it alone fails.

beforeAll(() => initPhysics(), 30_000);

const spec = robotMechanics(gripperKit).gripper!.spec;
const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
/** The carriage origin ahead of the robot frame's origin at lift 0°, cm: 4.5 + 5·cos(−40°). */
const TIP0 = 4.5 + 5 * Math.cos(-40 * DEG);
const floor = (sizeCm: [number, number] = [200, 100]): ArenaInput['ground'] => ({ sizeCm, color: '#ffffff' });
/** A cube `ahead` cm past carriage u 3 at lift 0° (the pick drives it in), `offset` [along, across] cm. */
const cubeAhead = (id: string, massG: number, options: { offset?: readonly [number, number]; sizeCm?: number; ahead?: number; u?: number } = {}) =>
  cube(id, [START.xCm + TIP0 + (options.u ?? 3) + (options.ahead ?? 8) + (options.offset?.[0] ?? 0), START.yCm + (options.offset?.[1] ?? 0)], massG, options.sizeCm ?? 4);

type Conditions = {
  readonly command: boolean;
  readonly window: boolean;
  readonly contacts: boolean;
  readonly gap: boolean;
  readonly payload: boolean;
  readonly releasable: boolean;
  readonly fits: boolean;
};
/** The five conditions of §4.4, then rules 5 and 6 of §4.6 (B2 fix rounds 1 and 2): θc ≥ 6°, the object's own width ≤ 4.3 cm. */
const names = ['command', 'window', 'contacts', 'gap', 'payload', 'releasable', 'fits'] as const;

/** An object's own width, cm (rule 6, fix round 2): a box's smaller horizontal side, a cylinder's diameter. */
const ownWidthOf = (object: GraspObject) => (object.shape.kind === 'box' ? 2 * Math.min(object.shape.halfM.x, object.shape.halfM.z) : 2 * object.shape.radiusM) * 100;

/** The five conditions of §4.4 (§4.6: CONTACT_GAP_M = 2 mm) and §4.6's rules 5 and 6, as the oracle reads them. */
function conditionsOf(scene: GripperScene, object: GraspObject): Conditions {
  const { gripper } = scene;
  const at = scene.grasp.view(object);
  const within = (collider: Collider) => {
    const contact = collider.contactCollider(object.collider, CONTACT_GAP_M);
    return contact !== null && contact.distance <= 0.002;
  };
  const gap = innerFaceVCm(spec, gripper.fingers[0].betaDeg(), at.u) + innerFaceVCm(spec, gripper.fingers[1].betaDeg(), at.u);
  return {
    command: gripper.clawCommandDeg >= gripper.clawDeg() - 0.5,
    window: at.u >= 1 && at.u <= 5.5 && Math.abs(at.v) <= 1.5 && Math.abs(at.w) <= at.heightCm / 2,
    contacts: within(gripper.fingers[0].collider) && within(gripper.fingers[1].collider),
    gap: gap <= at.widthCm + 0.3,
    payload: object.massG <= 50,
    releasable: gripper.clawDeg() >= 6,
    fits: ownWidthOf(object) <= 4.3,
  };
}

/**
 * Watches one object through a run: on each tick where the machine is free and unlatched, the oracle's five conditions before the update
 * and whether the object is held after it. `failedAlone[c]` counts the ticks where condition c alone failed.
 */
function watch(scene: GripperScene, id: string) {
  const object = scene.object(id);
  let pending: Conditions | null = null;
  const stats = {
    checked: 0,
    mismatches: [] as string[],
    allFive: 0,
    /** Ticks where §4.4's five held but rule 5 or 6 refused the attach. */
    refusedByRules: 0,
    attaches: 0,
    failedAlone: Object.fromEntries(names.map((name) => [name, 0])) as Record<(typeof names)[number], number>,
  };
  return {
    stats,
    between: () => {
      pending = scene.grasp.heldId === null && scene.grasp.latchDeg === null ? conditionsOf(scene, object) : null;
    },
    after: () => {
      if (pending === null) return;
      const c = pending;
      const all = names.every((name) => c[name]);
      const five = c.command && c.window && c.contacts && c.gap && c.payload;
      const held = scene.grasp.heldId === id;
      stats.checked += 1;
      if (all) stats.allFive += 1;
      if (five && !all) stats.refusedByRules += 1;
      if (held) stats.attaches += 1;
      if (held !== all) stats.mismatches.push(`tick ${scene.tick}: ${JSON.stringify(c)} held ${held}`);
      const failed = names.filter((name) => !c[name]);
      if (failed.length === 1) stats.failedAlone[failed[0]!] += 1;
    },
  };
}

/** The least angle between world up and ± a face normal of a box, degrees: 0 when it stands on any face. */
function tiltDeg(rotation: Quat): number {
  let best = 90;
  for (const axis of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    best = Math.min(best, Math.acos(Math.min(1, Math.abs(rotateVector(rotation, axis).y))) / DEG);
  }
  return best;
}

/**
 * Puts `object` at rest on the floor with its centre at carriage (u, v), cm, turned by `yawDeg` from the carriage's heading, while the robot
 * stands still with its carriage level: a test's way to set up exactly the case it checks.
 */
function placeInJaws(scene: GripperScene, object: GraspObject, u: number, v: number, yawDeg = 0): void {
  const c = scene.gripper.carriage.translation();
  const q = scene.gripper.carriage.rotation();
  const offset = rotateVector(q, { x: u / 100, y: 0, z: -v / 100 });
  const halfHeight = object.shape.kind === 'box' ? object.shape.halfM.y : object.shape.halfHeightM;
  const yaw = { x: 0, y: Math.sin((yawDeg * DEG) / 2), z: 0, w: Math.cos((yawDeg * DEG) / 2) };
  object.body.setTranslation({ x: c.x + offset.x, y: halfHeight, z: c.z + offset.z }, true);
  object.body.setRotation(multiply(q, yaw), true);
  object.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  object.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  scene.world.propagateModifiedBodyPositionsToColliders();
}

/** a ⊗ b for quaternions (tests only). */
function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** How deep a gripper collider is in the object, m (0 when apart), by shape query. */
function penetrationM(colliders: readonly Collider[], object: GraspObject): number {
  let deepest = 0;
  for (const collider of colliders) {
    const contact = collider.contactCollider(object.collider, 0);
    if (contact !== null && contact.distance < 0) deepest = Math.max(deepest, 0 - contact.distance);
  }
  return deepest;
}

describe('the grasp machine (N19 B2)', () => {
  it('squeezes with 8.09 N and lets go above 9.71 N: each finger gets T_s / (2 · 0.445) at half its length, two jaws of μ 0.6 (§4.6)', () => {
    expect(Math.round(squeezeN(spec) * 100) / 100).toBe(8.09);
    expect(Math.round(breakForceN(spec) * 100) / 100).toBe(9.71);
    expect(breakForceN(spec)).toBeCloseTo((2 * 0.6 * 0.18) / 0.89 / 0.025, 12);
    expect([DEFAULT_GROUPS, HELD_SOLVER_GROUPS]).toEqual([0xffffffff, 0xfffffffb]);
    // Rule 6: the fingers 2·2.2 − 0.4 = 4.0 cm apart when parallel, + 0.3 cm.
    expect(gripWidthCm(spec)).toBeCloseTo(4.3, 12);
  });

  it('sees an object in the carriage frame: u forward, v left, w up from the boom’s tip, and its width across the jaws', () => {
    const scene = gripperScene(
      {
        ground: floor(),
        objects: [
          cubeAhead('cube', 15),
          { ...cubeAhead('turned', 15, { offset: [0, 30], sizeCm: 3 }), yawDeg: 45 },
          { shape: 'cylinder', id: 'can', centerCm: [START.xCm + TIP0 + 11, START.yCm - 30], radiusCm: 1.5, heightCm: 5, massG: 15 },
        ],
      },
      START,
    );
    try {
      scene.set({ liftDeg: 0 });
      run(scene, wait(seconds(0.5)), seconds(0.5));
      const a = scene.grasp.view(scene.object('cube'));
      // 3 + 8 cm ahead of the tip, on the centre line; its centre 2 cm up, the tip at 4.9 + 5·sin(−40°) = 1.69 cm. (Lowering the arm
      // rocks the car forward by 0.6 mm, and the supports sink a tenth of a millimetre.)
      expect(Math.abs(a.u - 11)).toBeLessThan(0.1);
      expect(Math.abs(a.v)).toBeLessThan(0.01);
      expect(Math.abs(a.w - 0.31)).toBeLessThan(0.03);
      expect(Math.abs(a.widthCm - 4)).toBeLessThan(0.01);
      expect(Math.abs(a.heightCm - 4)).toBeLessThan(0.01);
      const b = scene.grasp.view(scene.object('turned'));
      expect(Math.abs(b.u - 11)).toBeLessThan(0.1);
      expect(Math.abs(b.v - 30)).toBeLessThan(0.01);
      // Turned 45°, a 3 cm cube is 3·√2 cm across the jaws.
      expect(Math.abs(b.widthCm - 3 * Math.SQRT2)).toBeLessThan(0.01);
      expect(Math.abs(b.heightCm - 3)).toBeLessThan(0.01);
      // An upright cylinder is 2r across and its height high; laid on its side across the jaws, the other way round.
      const can = scene.object('can');
      const c = scene.grasp.view(can);
      expect(Math.abs(c.v + 30)).toBeLessThan(0.01);
      expect([c.widthCm, c.heightCm].map((n) => Math.round(n * 100) / 100)).toEqual([3, 5]);
      can.body.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, true);
      const lying = scene.grasp.view(can);
      expect([lying.widthCm, lying.heightCm].map((n) => Math.round(n * 100) / 100)).toEqual([5, 3]);
      expect(scene.grasp.objects.map((object) => object.id)).toEqual(['can', 'cube', 'turned']);
    } finally {
      scene.dispose();
    }
  });

  describe('attach needs all five conditions', () => {
    it('all five: the pick attaches on the first tick they all hold, θc 19.94° for a 4 cm cube, and freezes the fingers on it', () => {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
      try {
        const watcher = watch(scene, 'cube');
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(0.35 + 4), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect([watcher.stats.allFive, watcher.stats.attaches]).toEqual([1, 1]);
        expect(scene.grasp.heldId).toBe('cube');
        expect(scene.grasp.thetaCDeg).toBeCloseTo(19.94, 2);
        expect(scene.grasp.liveJoints).toBe(1);
        expect(scene.world.impulseJoints.len()).toBe(6);
        expect(scene.object('cube').collider.solverGroups()).toBe(HELD_SOLVER_GROUPS);
        // The claw is still told 80°; the fingers follow the cube's faces (rule 3): they turn in from the corners they met to lie on them,
        // within a tenth of a millimetre.
        expect(scene.gripper.clawCommandDeg).toBe(80);
        for (const finger of scene.gripper.fingers) {
          const contact = finger.collider.contactCollider(scene.object('cube').collider, 0.001);
          expect(contact).not.toBeNull();
          expect(Math.abs(contact!.distance)).toBeLessThan(0.0001);
        }
      } finally {
        scene.dispose();
      }
    });

    it('1. the claw command: a claw opening over a cube it still touches does not attach it', () => {
      // A 3 cm cube turned 45°: its corners meet the fingers at its centre's u, so the jaws opening 5° in a tick stay within 2 mm of it
      // and within 3 mm of its width; only the command (0°, the claw still at 15°) says the servo is opening.
      const scene = gripperScene({ ground: floor(), objects: [{ ...cubeAhead('cube', 15, { sizeCm: 3 }), yawDeg: 45 }] }, START);
      try {
        const watcher = watch(scene, 'cube');
        const script = (function* (): Script {
          yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
          expect(scene.grasp.heldId).toBe('cube');
          scene.set({ clawDeg: 0 });
          yield* wait(seconds(0.5));
        })();
        run(scene, script, seconds(0.35 + 4 + 0.5), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.command).toBeGreaterThan(0);
        expect(watcher.stats.attaches).toBe(1);
        expect(scene.grasp.heldId).toBeNull();
      } finally {
        scene.dispose();
      }
    });

    it('2. the window: a cube clamped past the fingertips (centre at u ≈ 6) is not attached', () => {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
      try {
        const watcher = watch(scene, 'cube');
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 6 }), seconds(0.35 + 4), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.window).toBeGreaterThan(30);
        expect(watcher.stats.attaches).toBe(0);
        expect(scene.grasp.view(scene.object('cube')).u).toBeGreaterThan(5.5);
      } finally {
        scene.dispose();
      }
    });

    it('3. the contacts: a 3.75 cm cube 1 mm off centre between parallel fingers (0.25 mm and 2.25 mm away) is not attached', () => {
      // Claw 26.97°: β = 0, the inner faces parallel and 4.0 cm apart; the gap is the cube's width + 2.5 mm, under its 3 mm of slack. (Driven
      // in between parallel fingers with 1.25 mm to spare, a cube jams on a fingertip and turns: the jaws close on it once it is in.)
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15, { sizeCm: 3.75, offset: [0, 0.1] })] }, START);
      try {
        const watcher = watch(scene, 'cube');
        const script = (function* (): Script {
          scene.set({ liftDeg: 0, clawDeg: 0 });
          yield* wait(seconds(0.35));
          scene.drive(forward(140));
          yield* until(() => scene.grasp.view(scene.object('cube')).u <= 3.25, seconds(4));
          scene.drive(BRAKE);
          yield* wait(seconds(0.3));
          scene.set({ clawDeg: 12 / 0.445 });
          yield* wait(seconds(0.5));
        })();
        run(scene, script, seconds(0.35 + 4 + 0.5), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.contacts).toBeGreaterThan(30);
        expect(watcher.stats.attaches).toBe(0);
      } finally {
        scene.dispose();
      }
    });

    it('4. the jaw gap: a claw stopped at 16.5° touches a 4 cm cube at its back corners, 4 mm wider than it at its centre: not attached', () => {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
      try {
        const watcher = watch(scene, 'cube');
        const script = (function* (): Script {
          scene.set({ liftDeg: 0, clawDeg: 16.5 });
          yield* wait(seconds(0.35));
          scene.drive(forward(140));
          yield* until(() => scene.grasp.view(scene.object('cube')).u <= 3.25, seconds(4));
          scene.drive(BRAKE);
          yield* wait(seconds(0.5));
        })();
        run(scene, script, seconds(0.35 + 4 + 0.5), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.gap).toBeGreaterThan(30);
        expect(watcher.stats.attaches).toBe(0);
      } finally {
        scene.dispose();
      }
    });

    it('5. the payload: a 60 g cube clamped across the jaws is not attached', () => {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 60)] }, START);
      try {
        const watcher = watch(scene, 'cube');
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(0.35 + 4), watcher.after, watcher.between);
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.payload).toBeGreaterThan(30);
        expect(watcher.stats.attaches).toBe(0);
      } finally {
        scene.dispose();
      }
    });
  });

  describe('condition 2, the window, at each of its edges', () => {
    /** The car at rest, lift 0°, the claw at 26.97° (β 0: the inner faces parallel and 4.0 cm apart), a box placed in the jaws. */
    const placed = (sizeCm: [number, number, number], u: number, v: number, options: { clawDeg?: number; betaDeg?: readonly [number, number]; yawDeg?: number } = {}) => {
      const scene = gripperScene({ ground: floor(), objects: [{ shape: 'box', id: 'box', centerCm: [START.xCm, START.yCm + 30], sizeCm, massG: 15 }] }, START);
      const watcher = watch(scene, 'box');
      try {
        scene.set({ liftDeg: 0, clawDeg: options.clawDeg ?? 12 / 0.445 });
        if (options.betaDeg !== undefined) scene.gripper.freezeFingers(options.betaDeg);
        run(scene, wait(seconds(0.5)), seconds(0.5));
        placeInJaws(scene, scene.object('box'), u, v, options.yawDeg ?? 0);
        const at = scene.grasp.view(scene.object('box'));
        run(scene, wait(seconds(0.2)), seconds(0.2), watcher.after, watcher.between);
        return { held: scene.grasp.heldId, at, stats: watcher.stats };
      } finally {
        scene.dispose();
      }
    };

    it('u ∈ [1.0, 5.5]: a 3.8 cm wide, 0.6 cm deep box between parallel jaws attaches at u 1.15 and 5.35, not at 0.85 nor 5.65', () => {
      const rows = [0.85, 1.15, 5.35, 5.65].map((u) => ({ u, ...placed([0.6, 3.8, 3], u, 0) }));
      expect(rows.map((row) => [row.u, row.held])).toEqual([
        [0.85, null],
        [1.15, 'box'],
        [5.35, 'box'],
        [5.65, null],
      ]);
      for (const row of rows) {
        expect(Math.abs(row.at.u - row.u), `u ${row.u}`).toBeLessThan(0.01);
        expect(row.stats.mismatches, `u ${row.u}`).toEqual([]);
      }
      // Outside, the window alone said no.
      expect(rows[0]!.stats.failedAlone.window).toBeGreaterThan(0);
      expect(rows[3]!.stats.failedAlone.window).toBeGreaterThan(0);
    });

    it('|w| ≤ half the height: a 4 × 4 × 1 cm plate under the lowered jaws, the claw closed above it, is not attached', () => {
      // The jaws' bottom is at 1.09 cm, the plate's top at 1 cm: both fingers are within 2 mm of it, the claw closes to 80° over it, and its
      // centre is 1.19 cm under the carriage's, more than its half height of 0.5 cm.
      const result = placed([4, 4, 1], 3, 0, { clawDeg: 80 });
      expect(result.held).toBeNull();
      expect(result.at.w).toBeLessThan(-1.1);
      expect(result.stats.mismatches).toEqual([]);
      expect(result.stats.failedAlone.window).toBeGreaterThan(0);
    });

    it('|v| ≤ 1.5: in jaws turned 12° to the left (β +12° and −12°, still parallel), a box 1.0 cm left of the centre line attaches', () => {
      // The inner faces 3.90 cm apart across the turned jaws; a 3.8 cm box turned with them, its centre on their middle line at u 5.2, is at
      // v (5.2 − 0.5)·tan 12° = 1.0 cm.
      const result = placed([1, 3.8, 3], 5.2, 4.7 * Math.tan(12 * DEG), { betaDeg: [12, -12], yawDeg: 12 });
      expect(Math.abs(result.at.v - 1)).toBeLessThan(0.01);
      expect(result.held).toBe('box');
      expect(result.stats.mismatches).toEqual([]);
    });
  });

  it('tries the objects in id order (UTF-16 code units) whatever order the arena lists them: of two in the jaws, the lower id is held', () => {
    const plate = (id: string) => ({ shape: 'box' as const, id, centerCm: [START.xCm, START.yCm + (id === 'b' ? 30 : -30)] as [number, number], sizeCm: [1, 3.8, 3] as [number, number, number], massG: 15 });
    // The arena lists 'b' first; 'b' sits deeper in the jaws.
    const scene = gripperScene({ ground: floor(), objects: [plate('b'), plate('a')] }, START);
    try {
      expect(scene.arena.dynamicBodies.map((body) => body.id)).toEqual(['b', 'a']);
      expect(scene.grasp.objects.map((object) => object.id)).toEqual(['a', 'b']);
      scene.set({ liftDeg: 0, clawDeg: 12 / 0.445 });
      run(scene, wait(seconds(0.5)), seconds(0.5));
      placeInJaws(scene, scene.object('b'), 2, 0);
      placeInJaws(scene, scene.object('a'), 4, 0);
      run(scene, wait(seconds(0.2)), seconds(0.2));
      expect(scene.grasp.heldId).toBe('a');
      expect(scene.grasp.liveJoints).toBe(1);
      expect(scene.world.impulseJoints.len()).toBe(6);
    } finally {
      scene.dispose();
    }
  });

  describe('an attach is always one the claw can let go of: θc ≥ 6° (§4.6 rule 5)', () => {
    /** Lower and open, drive the open jaws into the box (duty 140, 3 s at most, until its centre is at u ≤ 3.25), brake, then 80°, lift 60°, 0°. */
    const wide = (box: ReturnType<typeof cube> & { yawDeg?: number }) => {
      const scene = gripperScene({ ground: floor(), objects: [box] }, START);
      const watcher = watch(scene, 'box');
      const seen: string[] = [];
      const script = (function* (): Script {
        scene.set({ liftDeg: 0, clawDeg: 0 });
        yield* wait(seconds(0.35));
        scene.drive(forward(140));
        yield* until(() => scene.grasp.view(scene.object('box')).u <= 3.25, seconds(3));
        scene.drive(BRAKE);
        yield* wait(seconds(0.3));
        seen.push(`driven in: u ${scene.grasp.view(scene.object('box')).u.toFixed(2)}`);
        scene.set({ clawDeg: 80 });
        yield* wait(seconds(0.6));
        seen.push(`told 80°: claw ${scene.gripper.clawDeg().toFixed(2)}°`);
        scene.set({ liftDeg: 60 });
        yield* wait(seconds(0.6));
        scene.set({ clawDeg: 0 });
        yield* wait(seconds(1));
      })();
      let held = 0;
      try {
        run(
          scene,
          script,
          seconds(0.35 + 3 + 0.3 + 0.6 + 0.6 + 1),
          () => {
            watcher.after();
            if (scene.grasp.heldId !== null) held += 1;
          },
          watcher.between,
        );
        return { held, seen, stats: watcher.stats, bottomCm: scene.object('box').body.translation().y * 100 - box.sizeCm[2] / 2 };
      } finally {
        scene.dispose();
      }
    };

    it('a 5 cm box never attaches: the open jaws wedge on it below 6°, and it would never be let go', () => {
      const result = wide(cubeAhead('box', 15, { sizeCm: 5 }));
      expect(result.held, result.seen.join('; ')).toBe(0);
      expect(result.stats.mismatches).toEqual([]);
      // The five conditions of §4.4 were met (the claw wedged on it near 0°, then closed 5° into it): rules 5 and 6 refused it.
      expect(result.stats.refusedByRules).toBeGreaterThan(0);
      // Left on the floor.
      expect(Math.abs(result.bottomCm)).toBeLessThan(0.05);
    });

    it('lesson 11’s 6×6×4 cm 40 g base never attaches, even when the open jaws are driven into it', () => {
      const base = { shape: 'box' as const, id: 'box', centerCm: [START.xCm + TIP0 + 3 + 8, START.yCm] as [number, number], sizeCm: [6, 6, 4] as [number, number, number], massG: 40 };
      const result = wide(base);
      expect(result.held, result.seen.join('; ')).toBe(0);
      expect(result.stats.mismatches).toEqual([]);
      expect(Math.abs(result.bottomCm)).toBeLessThan(0.05);
    });

    it('a 4.4 cm and a 5 cm box, square or 10° off, are never held: their own width is over the 4.3 cm of rule 6', () => {
      const rows: string[] = [];
      for (const sizeCm of [4.4, 5]) {
        for (const yawDeg of [0, 10]) {
          const result = wide({ ...cubeAhead('box', 15, { sizeCm }), yawDeg });
          rows.push(`${sizeCm} cm at ${yawDeg}°: held ${result.held} ticks; ${result.seen.join('; ')}`);
          expect(result.held, rows.at(-1)).toBe(0);
          expect(result.stats.mismatches, rows.at(-1)).toEqual([]);
          expect(Math.abs(result.bottomCm), rows.at(-1)).toBeLessThan(0.05);
        }
      }
      expect(rows).toHaveLength(4);
    }, 60_000);

    it('a 4 cm cube the claw meets 8°, 12° or 20° off square is gripped, carried and let go (rule 6 reads its own width, 4 cm)', () => {
      // Turned, the cube is 4·(cos ψ + sin ψ) = 4.52, 4.74 and 5.13 cm across the jaws. The claw does not stall on its corners (rule 2 clamps
      // on the object's own width too): it closes on, and the cube attaches as soon as the claw is past 6° with the five conditions met,
      // still turned (measured θc 9.86°, 9.47°, 8.98°, 4.53–4.80 cm across; 50 g: 9.76°, 9.33°, 7.48°).
      const rows: string[] = [];
      for (const yawDeg of [8, 12, 20]) {
        const scene = gripperScene({ ground: floor(), objects: [{ ...cubeAhead('cube', 15), yawDeg }] }, START);
        try {
          const watcher = watch(scene, 'cube');
          const object = scene.object('cube');
          const log: { thetaC?: number | null; liftedBottomCm?: number; heldUp?: string | null } = {};
          const script = (function* (): Script {
            yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
            log.thetaC = scene.grasp.thetaCDeg;
            scene.set({ liftDeg: 60 });
            yield* wait(seconds(0.6));
            log.heldUp = scene.grasp.heldId;
            log.liftedBottomCm = object.body.translation().y * 100 - 2;
            scene.set({ liftDeg: 10 });
            yield* wait(seconds(0.6));
            scene.set({ clawDeg: 0 });
            yield* wait(seconds(0.8));
          })();
          run(scene, script, seconds(0.35 + 4 + 2), watcher.after, watcher.between);
          rows.push(`${yawDeg}°: θc ${log.thetaC}, held at lift 60° ${log.heldUp}, bottom ${log.liftedBottomCm?.toFixed(2)} cm, end held ${scene.grasp.heldId}`);
          expect(watcher.stats.mismatches, rows.at(-1)).toEqual([]);
          expect(log.thetaC, rows.at(-1)).not.toBeNull();
          expect(log.thetaC!, rows.at(-1)).toBeGreaterThanOrEqual(6);
          expect(log.heldUp, rows.at(-1)).toBe('cube');
          expect(log.liftedBottomCm!, rows.at(-1)).toBeGreaterThan(3);
          // Let go at claw 0°, and back on the floor.
          expect(scene.grasp.heldId, rows.at(-1)).toBeNull();
          expect(Math.abs(object.body.translation().y * 100 - 2), rows.at(-1)).toBeLessThan(0.05);
        } finally {
          scene.dispose();
        }
      }
      expect(rows).toHaveLength(3);
    }, 60_000);

    it('rule 5 alone: a 4.2 cm box (within the 4.3 cm of rule 6) wedged by the hinges of the open jaws is not attached at θc 0°', () => {
      // 1 cm deep, its centre at u 1.5: the open fingers' inner faces are 2.10 cm from the middle at its back and 2.31 at its front, so both
      // are within 2 mm of it, and the gap at its centre (4.42 cm) is within 0.3 cm of its width. The claw is at 0° (told 0°): taken now,
      // it could never be told θc − 6°.
      const scene = gripperScene({ ground: floor(), objects: [{ shape: 'box', id: 'box', centerCm: [START.xCm, START.yCm + 30], sizeCm: [1, 4.2, 3], massG: 15 }] }, START);
      try {
        const watcher = watch(scene, 'box');
        scene.set({ liftDeg: 0, clawDeg: 0 });
        run(scene, wait(seconds(0.5)), seconds(0.5));
        placeInJaws(scene, scene.object('box'), 1.5, 0);
        run(scene, wait(seconds(0.3)), seconds(0.3), watcher.after, watcher.between);
        expect(scene.grasp.heldId).toBeNull();
        expect(watcher.stats.mismatches).toEqual([]);
        expect(watcher.stats.failedAlone.releasable).toBeGreaterThan(0);
      } finally {
        scene.dispose();
      }
    });

    it('a 4 cm cube still attaches at about 19.94°', () => {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
      try {
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(0.35 + 4));
        expect(scene.grasp.heldId).toBe('cube');
        expect(scene.grasp.thetaCDeg).toBeCloseTo(19.94, 1);
      } finally {
        scene.dispose();
      }
    });
  });

  it('a held 4.2 cm box keeps the claw at θc or more: following the faces never opens a finger past where it was at the attach', () => {
    // The box's back corners sit by the hinges, inside the fingers wherever they are; "touching" would open them to their stop (claw −0.5°)
    // with the box held between fully open jaws.
    const scene = gripperScene({ ground: floor(), objects: [cubeAhead('box', 15, { sizeCm: 4.2 })] }, START);
    try {
      let least = Number.POSITIVE_INFINITY;
      let heldTicks = 0;
      const script = (function* (): Script {
        yield* pick(scene, 'box', { liftDeg: 0, u: 3 });
        scene.set({ liftDeg: 60 });
        yield* wait(seconds(0.6));
        scene.set({ liftDeg: 0 });
        yield* wait(seconds(0.6));
      })();
      run(scene, script, seconds(0.35 + 4 + 1.2), () => {
        if (scene.grasp.heldId !== 'box') return;
        heldTicks += 1;
        least = Math.min(least, scene.gripper.clawDeg() - scene.grasp.thetaCDeg!);
      });
      expect(heldTicks).toBeGreaterThan(seconds(1.2));
      expect(scene.grasp.thetaCDeg!).toBeGreaterThanOrEqual(6);
      expect(least).toBeGreaterThanOrEqual(-0.05);
    } finally {
      scene.dispose();
    }
  });

  it('release at θc−6° not at θc−3°', () => {
    const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
    try {
      const seen: (string | null)[] = [];
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
        const thetaC = scene.grasp.thetaCDeg!;
        scene.set({ liftDeg: 30 });
        yield* wait(seconds(0.5));
        for (const below of [3, 5.9]) {
          scene.set({ clawDeg: thetaC - below });
          yield* wait(seconds(0.3));
          seen.push(scene.grasp.heldId);
        }
        scene.set({ clawDeg: thetaC - 6 });
        yield;
        seen.push(scene.grasp.heldId);
        yield* wait(seconds(0.5));
        seen.push(scene.grasp.heldId);
      })();
      run(scene, script, seconds(0.35 + 4 + 0.5 + 0.6 + 0.6));
      // Told θc − 3° and θc − 5.9° it holds; at θc − 6° it lets go on the next update, and does not take the cube again.
      expect(seen).toEqual(['cube', 'cube', null, null]);
      expect([scene.grasp.liveJoints, scene.world.impulseJoints.len()]).toEqual([0, 5]);
      expect(scene.object('cube').collider.solverGroups()).toBe(DEFAULT_GROUPS);
      expect(scene.grasp.latchDeg).toBeNull();
    } finally {
      scene.dispose();
    }
  });

  it('no re-attach after a break until the claw opens past θc−6°', () => {
    // A held cube pushed into a wall at lift 0° (0.5 cm past the fingertips: grasped at u 4) breaks the grasp; the claw, still told 80°,
    // clamps it again at once, and only the latch keeps it free.
    const graspU = 4;
    const wallX = START.xCm + TIP0 + graspU + 8 + 40;
    const scene = gripperScene({ ground: floor([250, 100]), walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: [cubeAhead('cube', 15, { u: graspU })] }, START);
    try {
      const watcher = watch(scene, 'cube');
      const log: Record<string, unknown> = {};
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: graspU });
        const thetaC = scene.grasp.thetaCDeg!;
        log.thetaC = thetaC;
        scene.drive(forward(226));
        yield* until(() => scene.grasp.heldId === null, seconds(4));
        scene.drive(BRAKE);
        log.latch = scene.grasp.latchDeg;
        yield* wait(seconds(0.5));
        log.whileLatched = scene.grasp.heldId;
        scene.drive(backward(80));
        yield* wait(seconds(0.1));
        scene.drive(BRAKE);
        yield* wait(seconds(0.3));
        log.stillLatched = [scene.grasp.heldId, scene.grasp.latchDeg];
        scene.set({ clawDeg: thetaC - 5.5 });
        yield* wait(seconds(0.3));
        log.atMinus55 = [scene.grasp.heldId, scene.grasp.latchDeg];
        scene.set({ clawDeg: thetaC - 6 });
        yield* wait(2);
        log.atMinus6 = scene.grasp.latchDeg;
        scene.set({ clawDeg: 80 });
        yield* wait(seconds(0.4));
        log.again = scene.grasp.heldId;
      })();
      run(scene, script, seconds(0.35 + 4 + 4 + 2.5), watcher.after, watcher.between);
      expect(log.latch).toBe(log.thetaC);
      expect(log.whileLatched).toBeNull();
      expect(log.stillLatched).toEqual([null, log.thetaC]);
      expect(log.atMinus55).toEqual([null, log.thetaC]);
      expect(log.atMinus6).toBeNull();
      expect(log.again).toBe('cube');
      expect(watcher.stats.mismatches).toEqual([]);
    } finally {
      scene.dispose();
    }
  });

  it('claw stops only on a sideways clamp', () => {
    // 60 g cubes (they never attach), the claw told 80°. Each tick the claw closes on while at most one finger is within 2 mm of the cube,
    // or both are but the jaw gap at the cube's centre is wider than the cube + 0.05 cm; once the cube is clamped across the jaws it stops
    // there, short of 80°, and stays. A 4 cm cube centred (picked as a lesson does) stalls with the fingers flat on its faces (β 0, claw
    // 26.97°). A 3 cm cube 0.6 cm off centre in the open jaws (placed there, so the approach does not centre it first) is met by the left
    // finger first; the claw closes on, pushing it to the middle, and stalls where both fingers clamp it.
    // `steadyMm`: how deep a finger is in the cube once stalled and settled, from 1 s after the stall to the end (N19 B5, B2 review 3 M7).
    const cases = [
      { name: '4 cm centred', size: 4, place: null, stall: [24, 30], deepestMm: 2.1, steadyMm: [0, 0.05] },
      // A 60 g cube (over the payload: it never attaches) 0.6 cm off centre. One 3 g finger pushes it across at the servo's speed and sinks
      // into it before the other meets it, 3.82 mm at most (measured; the cube turns a little as it is pushed, and the clamp waits for the gap
      // to come down to its own 3 cm). That is not only a push: stalled, a finger stays about 3 mm inside it (2.11–2.99 mm, measured: the cube
      // creeps and the stall takes the face again) for as long as the claw is told to close. A placeholder-kit artifact of an object too heavy
      // to hold, which no lesson has; a held object's fingers stay within 2.1 mm (the off-centre suite).
      { name: '3 cm 0.6 cm off centre', size: 3, place: { u: 3.5, v: 0.6 }, stall: [40, 56], deepestMm: 4, steadyMm: [2, 3.05] },
    ] as const;
    for (const c of cases) {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 60, { sizeCm: c.size, offset: c.place === null ? [0, 0] : [0, 30] })] }, START);
      try {
        const object = scene.object('cube');
        const at = () => {
          const view = scene.grasp.view(object);
          const near = scene.gripper.fingers.map((finger) => {
            const contact = finger.collider.contactCollider(object.collider, CONTACT_GAP_M);
            return contact !== null && contact.distance <= CONTACT_GAP_M;
          });
          const gap = innerFaceVCm(spec, scene.gripper.fingers[0].betaDeg(), view.u) + innerFaceVCm(spec, scene.gripper.fingers[1].betaDeg(), view.u);
          return { clamped: near[0]! && near[1]! && gap <= view.widthCm + 0.05, oneOnly: near[0] !== near[1], claw: scene.gripper.clawDeg(), v: view.v };
        };
        const script = (function* (): Script {
          if (c.place === null) {
            yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
          } else {
            scene.set({ liftDeg: 0, clawDeg: 0 });
            yield* wait(seconds(0.5));
            placeInJaws(scene, object, c.place.u, c.place.v);
            yield;
            scene.set({ clawDeg: 80 });
            yield* wait(seconds(3));
          }
        })();
        let before = at();
        const closedOn = { oneOnly: 0, unclamped: 0 };
        let stalledAt: number | null = null;
        let stalledTick: number | null = null;
        const steady = { least: Number.POSITIVE_INFINITY, most: Number.NEGATIVE_INFINITY };
        let firstNearV: number | null = null;
        const after = { least: Number.POSITIVE_INFINITY, most: Number.NEGATIVE_INFINITY };
        let deepest = 0;
        run(scene, script, seconds(0.35 + 4), () => {
          const now = at();
          if (scene.gripper.clawCommandDeg === 80 && stalledAt === null) {
            if (before.oneOnly && firstNearV === null) firstNearV = before.v;
            if (before.oneOnly && now.claw > before.claw + 0.5) closedOn.oneOnly += 1;
            if (!before.oneOnly && !before.clamped && now.claw > before.claw + 0.5) closedOn.unclamped += 1;
            if (now.clamped) stalledAt = now.claw;
          } else if (stalledAt !== null) {
            after.least = Math.min(after.least, now.claw);
            after.most = Math.max(after.most, now.claw);
          }
          if (scene.gripper.clawCommandDeg === 80) deepest = Math.max(deepest, penetrationM(scene.gripper.fingers.map((finger) => finger.collider), object));
          if (stalledAt !== null && stalledTick === null) stalledTick = scene.tick;
          if (stalledTick !== null && scene.tick >= stalledTick + seconds(1)) {
            const depthMm = penetrationM(scene.gripper.fingers.map((finger) => finger.collider), object) * 1000;
            steady.least = Math.min(steady.least, depthMm);
            steady.most = Math.max(steady.most, depthMm);
          }
          before = now;
        });
        expect(closedOn.unclamped, c.name).toBeGreaterThan(0);
        expect(stalledAt, c.name).not.toBeNull();
        // Stalled where it clamped, for the rest of the run: the fingers arrive at 2.2° of β a tick and carry on a little past the faces
        // before the stall holds them (centred: clamped at 29.7°, back on the faces at 26.9° within the second), never closing on.
        expect(stalledAt!, c.name).toBeGreaterThan(c.stall[0]);
        expect(stalledAt!, c.name).toBeLessThan(c.stall[1]);
        expect(after.least, c.name).toBeGreaterThan(c.stall[0] - 4);
        expect(after.most, c.name).toBeLessThan(c.stall[1]);
        expect(deepest * 1000, c.name).toBeLessThan(c.deepestMm);
        expect(steady.least, c.name).toBeGreaterThanOrEqual(c.steadyMm[0]);
        expect(steady.most, c.name).toBeLessThanOrEqual(c.steadyMm[1]);
        expect(scene.grasp.heldId).toBeNull();
        if (c.place === null) {
          // Centred: both fingers flat on the faces, within half a degree of parallel (β 0 is claw 26.97°).
          for (const finger of scene.gripper.fingers) expect(Math.abs(finger.betaDeg())).toBeLessThan(0.5);
        } else {
          // One finger met it first, 0.6 cm off centre, and the claw closed on, pushing it to the middle (it stalls 0.24 cm off it: a stalled
          // finger only stops, rule 2).
          expect(closedOn.oneOnly, c.name).toBeGreaterThan(0);
          expect(firstNearV!, c.name).toBeGreaterThan(0.5);
          expect(Math.abs(at().v), c.name).toBeLessThan(0.3);
        }
      } finally {
        scene.dispose();
      }
    }
  });

  it('payload 60 g never attaches', () => {
    const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 60)] }, START);
    try {
      let held = 0;
      let highest = Number.NEGATIVE_INFINITY;
      let atTop = Number.NaN;
      const object = scene.object('cube');
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
        scene.set({ liftDeg: 90 });
        yield* wait(seconds(1));
        atTop = object.body.translation().y * 100 - 2;
        scene.set({ clawDeg: 0 });
        yield* wait(seconds(0.4));
      })();
      run(scene, script, seconds(0.35 + 4 + 1.4), () => {
        if (scene.grasp.heldId !== null) held += 1;
        highest = Math.max(highest, object.body.translation().y * 100 - 2);
      });
      expect(held).toBe(0);
      // Not carried by friction either (the fingers have none): at lift 90° it stands on the floor (ADR 0004 §4.2: −0.007 cm), and on the way
      // up it only tips as the jaws slide up past it (5°, its centre 1.7 mm up at most).
      expect(Math.abs(atTop)).toBeLessThan(0.01);
      expect(highest).toBeLessThan(0.2);
    } finally {
      scene.dispose();
    }
  });

  it('released cube lands within 5° of upright', () => {
    for (const massG of [15, 50]) {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', massG)] }, START);
      try {
        const object = scene.object('cube');
        const log: Record<string, number> = {};
        const script = (function* (): Script {
          yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
          scene.set({ liftDeg: 90 });
          yield* wait(seconds(0.5));
          scene.set({ liftDeg: 14 });
          yield* wait(seconds(0.6));
          log.bottomBeforeCm = object.body.translation().y * 100 - 2;
          scene.set({ clawDeg: 0 });
          yield* wait(seconds(1));
          log.tiltDeg = tiltDeg(object.body.rotation());
          log.bottomAfterCm = object.body.translation().y * 100 - 2;
        })();
        run(scene, script, seconds(0.35 + 4 + 2.1));
        // Dropped from about 1 cm (lift 14°), it lands on its face.
        expect(log.bottomBeforeCm, `${massG} g`).toBeGreaterThan(0.8);
        expect(log.bottomBeforeCm, `${massG} g`).toBeLessThan(1.2);
        expect(Math.abs(log.bottomAfterCm!), `${massG} g`).toBeLessThan(0.05);
        expect(log.tiltDeg, `${massG} g`).toBeLessThan(5);
        expect(scene.grasp.heldId).toBeNull();
      } finally {
        scene.dispose();
      }
    }
  });

  it('off-centre cube (≤ 1 cm) penetrates ≤ 2.1 mm', () => {
    const rows: string[] = [];
    for (const massG of [15, 50]) {
      for (const offset of [[-1, 0], [1, 0], [0, -0.5], [0, 0.5], [0, -1], [0, 1]] as const) {
        const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', massG, { offset })] }, START);
        try {
          const object = scene.object('cube');
          let deepest = 0;
          let everHeld = false;
          const script = (function* (): Script {
            yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
            scene.set({ liftDeg: 90 });
            yield* wait(seconds(0.5));
            scene.set({ liftDeg: 0 });
            yield* wait(seconds(0.5));
            scene.set({ clawDeg: 0 });
            yield* wait(seconds(0.4));
          })();
          run(scene, script, seconds(0.35 + 4 + 1.4), () => {
            everHeld ||= scene.grasp.heldId === 'cube';
            // While closing and while held: what the fingers and the carriage do to the cube.
            if (everHeld ? scene.grasp.heldId === 'cube' : scene.gripper.clawCommandDeg > 0) deepest = Math.max(deepest, penetrationM(scene.gripper.colliders, object));
          });
          rows.push(`${massG} g ${offset.join(',')}: held ${everHeld}, ${(deepest * 1000).toFixed(3)} mm, ${scene.grasp.heldId}`);
          expect(everHeld, rows.at(-1)).toBe(true);
          expect(deepest * 1000, rows.at(-1)).toBeLessThanOrEqual(2.1);
          expect(scene.grasp.heldId, rows.at(-1)).toBeNull();
        } finally {
          scene.dispose();
        }
      }
    }
    expect(rows).toHaveLength(12);
  }, 60_000);

  it('placeAt forgets a latch and a stall: a reset robot takes an object again at once', () => {
    // A held cube broken off against a wall at lift 0° (the latch test's way), the claw still told 80°: latched, and clamping the cube.
    const graspU = 4;
    const wallX = START.xCm + TIP0 + graspU + 8 + 40;
    const scene = gripperScene({ ground: floor([250, 100]), walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: [cubeAhead('cube', 15, { u: graspU })] }, START);
    try {
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: graspU });
        scene.drive(forward(226));
        yield* until(() => scene.grasp.heldId === null, seconds(4));
        scene.drive(BRAKE);
        yield* wait(seconds(0.3));
      })();
      run(scene, script, seconds(0.35 + 4 + 4 + 0.3));
      expect(scene.grasp.latchDeg).not.toBeNull();
      const clampedAt = scene.gripper.clawDeg();
      expect(clampedAt).toBeLessThan(40);
      scene.robot.placeAt({ xCm: 40, yCm: 50, yawDeg: 0 });
      expect([scene.grasp.heldId, scene.grasp.latchDeg, scene.grasp.liveJoints]).toEqual([null, null, 0]);
      // Nothing is in the jaws at the new place, so the claw (still told 80°) closes on from the first tick, no stale stall holding a finger
      // where it clamped the cube, and on to its stop.
      scene.step();
      expect(scene.gripper.clawDeg()).toBeGreaterThan(clampedAt + 2);
      run(scene, wait(seconds(0.4)), seconds(0.4));
      expect(scene.gripper.clawDeg()).toBeCloseTo(80, 0);
    } finally {
      scene.dispose();
    }
  });

  it('placeAt lets the held object go first: its joint is removed and it keeps its own pose', () => {
    const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 15)] }, START);
    try {
      const object = scene.object('cube');
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
        scene.set({ liftDeg: 60 });
        yield* wait(seconds(0.5));
      })();
      run(scene, script, seconds(0.35 + 4 + 0.5));
      expect(scene.grasp.heldId).toBe('cube');
      const before = object.body.translation();
      scene.robot.placeAt({ xCm: 150, yCm: 50, yawDeg: 90 });
      expect([scene.grasp.heldId, scene.grasp.liveJoints, scene.grasp.latchDeg, scene.world.impulseJoints.len()]).toEqual([null, 0, null, 5]);
      expect(object.collider.solverGroups()).toBe(DEFAULT_GROUPS);
      expect(object.body.translation()).toEqual(before);
      run(scene, wait(seconds(0.5)), seconds(0.5));
      // The claw is still told 80° but there is nothing in the jaws now: it closes to its stop.
      expect(scene.gripper.clawDeg()).toBeCloseTo(80, 0);
      expect(object.body.translation().y * 100).toBeCloseTo(2, 1);
    } finally {
      scene.dispose();
    }
  });
});
