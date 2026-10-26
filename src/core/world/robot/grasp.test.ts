import { beforeAll, describe, expect, it } from 'vitest';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { BRAKE, backward, cube, forward, gripperKit, gripperScene, pick, run, seconds, until, wait, type GripperScene, type Script } from '../__fixtures__/gripper-scene';
import type { ArenaInput } from '../arena/arena-schema';
import { initPhysics, type Collider } from '../rapier';
import { rotateVector, type Quat } from '../units';
import { breakForceN, CONTACT_GAP_M, DEFAULT_GROUPS, HELD_SOLVER_GROUPS, squeezeN, type GraspObject } from './grasp';
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

type Conditions = { readonly command: boolean; readonly window: boolean; readonly contacts: boolean; readonly gap: boolean; readonly payload: boolean };
const names = ['command', 'window', 'contacts', 'gap', 'payload'] as const;

/** The five conditions of §4.4 (§4.6: CONTACT_GAP_M = 2 mm), as the oracle reads them. */
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
  };
}

/**
 * Watches one object through a run: on each tick where the machine is free and unlatched, the oracle's five conditions before the update
 * and whether the object is held after it. `failedAlone[c]` counts the ticks where condition c alone failed.
 */
function watch(scene: GripperScene, id: string) {
  const object = scene.object(id);
  let pending: Conditions | null = null;
  const stats = { checked: 0, mismatches: [] as string[], allFive: 0, attaches: 0, failedAlone: Object.fromEntries(names.map((name) => [name, 0])) as Record<(typeof names)[number], number> };
  return {
    stats,
    between: () => {
      pending = scene.grasp.heldId === null && scene.grasp.latchDeg === null ? conditionsOf(scene, object) : null;
    },
    after: () => {
      if (pending === null) return;
      const c = pending;
      const all = names.every((name) => c[name]);
      const held = scene.grasp.heldId === id;
      stats.checked += 1;
      if (all) stats.allFive += 1;
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
    // there, short of 80°, and stays. Centred, it stalls with the fingers flat on the faces (β 0, claw 26.97°); 0.5 cm off centre the open
    // jaws funnel the cube in, one finger meets it first and the claw closes on.
    for (const dy of [0, 0.5]) {
      const scene = gripperScene({ ground: floor(), objects: [cubeAhead('cube', 60, { offset: [0, dy] })] }, START);
      try {
        const object = scene.object('cube');
        const at = () => {
          const view = scene.grasp.view(object);
          const near = scene.gripper.fingers.map((finger) => {
            const contact = finger.collider.contactCollider(object.collider, CONTACT_GAP_M);
            return contact !== null && contact.distance <= CONTACT_GAP_M;
          });
          const gap = innerFaceVCm(spec, scene.gripper.fingers[0].betaDeg(), view.u) + innerFaceVCm(spec, scene.gripper.fingers[1].betaDeg(), view.u);
          return { clamped: near[0]! && near[1]! && gap <= view.widthCm + 0.05, oneOnly: near[0] !== near[1], claw: scene.gripper.clawDeg() };
        };
        let before = at();
        const closedOn = { oneOnly: 0, unclamped: 0 };
        let stalledAt: number | null = null;
        const after = { least: Number.POSITIVE_INFINITY, most: Number.NEGATIVE_INFINITY };
        let deepest = 0;
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(0.35 + 4), () => {
          const now = at();
          if (scene.gripper.clawCommandDeg === 80 && stalledAt === null) {
            if (before.oneOnly && now.claw > before.claw + 0.5) closedOn.oneOnly += 1;
            if (!before.oneOnly && !before.clamped && now.claw > before.claw + 0.5) closedOn.unclamped += 1;
            if (now.clamped) stalledAt = now.claw;
          } else if (stalledAt !== null) {
            after.least = Math.min(after.least, now.claw);
            after.most = Math.max(after.most, now.claw);
          }
          if (scene.gripper.clawCommandDeg === 80) deepest = Math.max(deepest, penetrationM(scene.gripper.fingers.map((finger) => finger.collider), object));
          before = now;
        });
        expect(closedOn.unclamped, `dy ${dy}`).toBeGreaterThan(0);
        if (dy > 0) expect(closedOn.oneOnly, `dy ${dy}`).toBeGreaterThan(0);
        expect(stalledAt, `dy ${dy}`).not.toBeNull();
        // Stalled where it clamped, for the 3 s that follow: the fingers arrive at 2.2° of β a tick and carry on a little past the faces
        // (29.2° at most, centred), and off centre the finger that went into the cube by the funnel is slowly pushed back out by the contact,
        // so the claw wobbles by a few degrees (22.6–27.9°), clamped, never closing on.
        expect(stalledAt!, `dy ${dy}`).toBeGreaterThan(24);
        expect(stalledAt!, `dy ${dy}`).toBeLessThan(29);
        expect(after.least, `dy ${dy}`).toBeGreaterThan(20);
        expect(after.most, `dy ${dy}`).toBeLessThan(30);
        expect(deepest * 1000, `dy ${dy}`).toBeLessThan(2.1);
        expect(scene.grasp.heldId).toBeNull();
        if (dy === 0) {
          // Centred: both fingers flat on the faces, within half a degree of parallel (β 0 is claw 26.97°).
          for (const finger of scene.gripper.fingers) expect(Math.abs(finger.betaDeg())).toBeLessThan(0.5);
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
