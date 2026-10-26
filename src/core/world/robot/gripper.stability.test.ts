import { beforeAll, describe, expect, it } from 'vitest';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { BRAKE, COAST, backward, cube, forward, gripperKit, gripperScene, pick, run, seconds, wait, type GripperScene, type Script } from '../__fixtures__/gripper-scene';
import type { ArenaInput } from '../arena/arena-schema';
import { getRapier, initPhysics, type Collider } from '../rapier';
import { rotateVector } from '../units';
import { breakForceN } from './grasp';

// N19 B5 (plan §4.4 tipping budget, §4.6 anti-tip, §7 B5; ADR 0004 §4.2, §5.3; rulings G0 wall, G0 caster, G0 start duty): the gripper car
// stands up to what a learner does with it. The gripper reaches past the body, so ADR 0001 §9's rule (nothing sticks out ahead of the body)
// does not hold for this kit (D-G8): these bounded tests stand in for it (ADR 0001 §9 addendum).
//
// Measures (tests only, Math trigonometry): pitch is the chassis' nose angle above the floor's plane (positive nose up); the caster is off
// the floor when its ball's bottom is more than 0.1 mm above the ground (the spike's measure, as assembly.test.ts's wall tests); its load is
// the normal impulse of its contacts over the step. "Settled" is the spike's (spikes/n19-grasp/scenarios.ts): from then on, within the
// window, the pitch stays within 0.2° of its last value and the chassis turns at most 0.05 rad/s.

beforeAll(() => initPhysics(), 30_000);

const DEG = Math.PI / 180;
const spec = robotMechanics(gripperKit).gripper!.spec;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
/** The carriage origin ahead of the robot frame's origin at lift 0°, cm: 4.5 + 5·cos(−40°). */
const TIP0 = 4.5 + 5 * Math.cos(-40 * DEG);
const floor = (sizeCm: readonly [number, number]): ArenaInput['ground'] => ({ sizeCm: [sizeCm[0], sizeCm[1]], color: '#ffffff' });
/** A cube 8 cm ahead of where the pick holds it at carriage u `u`, at lift 0° (the pick drives it in). */
const cubeFor = (massG: number, u = 3) => cube('cube', [START.xCm + TIP0 + u + 8, START.yCm], massG);

/** What the tests read off the scene each tick. */
function gauges(scene: GripperScene) {
  let ground: Collider | null = null;
  let caster: Collider | null = null;
  const supports: Collider[] = [];
  scene.world.forEachCollider((collider) => {
    if (scene.arena.infoOf(collider)?.kind === 'ground') ground = collider;
    if (collider.parent()?.handle !== scene.robot.chassis.handle || collider.shape.type !== getRapier().ShapeType.Ball) return;
    // The caster's ball (radius 0.75 cm) and each wheel's support ball (half the 2.6 cm wheel width).
    if (Math.abs(collider.radius() - 0.0075) < 1e-6) caster = collider;
    if (Math.abs(collider.radius() - 0.013) < 1e-6) supports.push(collider);
  });
  if (ground === null || caster === null || supports.length !== 2) throw new Error('no ground, caster or support balls');
  const g: Collider = ground;
  const c: Collider = caster;
  const gapMm = (ball: Collider) => {
    const contact = ball.contactCollider(g, 0.05);
    return contact === null ? 50 : contact.distance * 1000;
  };
  return {
    pitchDeg: () => Math.asin(rotateVector(scene.robot.chassis.rotation(), { x: 1, y: 0, z: 0 }).y) / DEG,
    rollDeg: () => Math.asin(rotateVector(scene.robot.chassis.rotation(), { x: 0, y: 0, z: 1 }).y) / DEG,
    turnRadS: () => {
      const w = scene.robot.chassis.angvel();
      return Math.hypot(w.x, w.y, w.z);
    },
    casterGapMm: () => gapMm(c),
    /** Both wheels on the floor: their support balls within 0.1 mm of it. */
    wheelsDown: () => supports.every((ball) => gapMm(ball) <= 0.1),
    casterLoadN: () => {
      let impulse = 0;
      scene.world.contactPair(c, g, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
      });
      return impulse / scene.world.timestep;
    },
    /** Every body of the robot and every object: position, rotation and speed all finite. */
    finite: () =>
      [...scene.robot.bodies, ...scene.grasp.objects.map((object) => object.body)].every((body) => {
        const t = body.translation();
        const q = body.rotation();
        const v = body.linvel();
        return [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z].every(Number.isFinite);
      }),
  };
}

/** The arena's collider with an id. */
function colliderOf(scene: GripperScene, id: string): Collider {
  let found: Collider | null = null;
  scene.world.forEachCollider((collider) => {
    if (scene.arena.infoOf(collider)?.id === id) found = collider;
  });
  if (found === null) throw new Error(`no collider ${id}`);
  return found;
}

/**
 * Whether the robot, or the object it held during the last step, touches `wall` (a positive impulse or a gap ≤ 0.5 mm), read between the
 * physics step and the grasp machine's update: what world.ts counts as the robot's contact (`touchingBodies`, the object held before the
 * update), so a cube that meets the wall first and breaks off in that tick still counts.
 */
function touches(scene: GripperScene, wall: Collider): boolean {
  const held = scene.grasp.heldBody;
  let touch = false;
  scene.world.contactPairsWith(wall, (other) => {
    if (!scene.robot.ownsCollider(other) && !(held !== null && other.parent()?.handle === held.handle)) return;
    scene.world.contactPair(wall, other, (manifold) => {
      for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactImpulse(i) > 0 || manifold.contactDist(i) <= 0.0005) touch = true;
    });
  });
  return touch;
}

/** Runs `script` to its end, one tick per step (at most `maxTicks`). */
function runThrough(scene: GripperScene, script: Script, maxTicks = seconds(20)): void {
  for (let tick = 0; tick < maxTicks; tick++) {
    if (script.next().done === true) return;
    scene.step();
  }
  throw new Error('the script did not end');
}

type WallCase = { readonly duty: number; readonly liftDeg: number; readonly massG: number; readonly graspU: number };
type WallOutcome = {
  name: string;
  speedMS: number;
  heldAtContact: string | null;
  mostPitchDeg: number;
  finalPitchDeg: number;
  settledS: number | null;
  finite: boolean;
  /** The caster's ball: how high its bottom rose over the floor at most (mm), on how many ticks it was more than 0.1 mm off, its least load (N). */
  caster: { highestMm: number; offTicks: number; lightestN: number };
};

/**
 * ADR 0004 §4.2 scenario 5 in production: holding a cube gripped at carriage u `graspU` (u 4: it sticks 0.5 cm past the fingertips and meets
 * the wall first; u 3: the fingertips do), or with the claw empty (massG 0) and open, the arm at `liftDeg`, the car drives at `duty` from 60 cm
 * away into a wall; from the contact the drive is released (coast, what drive.stop does) and the window is 1.5 s.
 */
function wallHit(c: WallCase): WallOutcome {
  const wallX = START.xCm + TIP0 + c.graspU + 8 + 60;
  const scene = gripperScene(
    { ground: floor([250, 100]), walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: c.massG === 0 ? [] : [cubeFor(c.massG, c.graspU)] },
    START,
  );
  try {
    const gauge = gauges(scene);
    const wall = colliderOf(scene, 'wall');
    let contact = -1;
    let driving = false;
    let speedMS = 0;
    let heldAtContact: string | null = null;
    const log: { pitch: number; turn: number }[] = [];
    const caster = { highestMm: -Infinity, offTicks: 0, lightestN: Infinity };
    let finite = true;
    const script = (function* (): Script {
      if (c.massG > 0) yield* pick(scene, 'cube', { liftDeg: 0, u: c.graspU });
      scene.set({ liftDeg: c.liftDeg, clawDeg: c.massG > 0 ? 80 : 0 });
      yield* wait(seconds(0.5));
      scene.drive(forward(c.duty));
      driving = true;
      for (;;) yield;
    })();
    for (let tick = 0; tick < seconds(14) && (contact < 0 || scene.tick <= contact + seconds(1.5)); tick++) {
      script.next();
      if (driving && contact < 0) speedMS = Math.abs(scene.robot.chassis.linvel().x);
      scene.step(() => {
        if (driving && contact < 0 && touches(scene, wall)) {
          contact = scene.tick;
          heldAtContact = scene.grasp.heldId;
          scene.drive(COAST);
        }
      });
      if (contact >= 0) {
        log.push({ pitch: gauge.pitchDeg(), turn: gauge.turnRadS() });
        finite &&= gauge.finite();
        const gapMm = gauge.casterGapMm();
        caster.highestMm = Math.max(caster.highestMm, gapMm);
        if (gapMm > 0.1) caster.offTicks += 1;
        caster.lightestN = Math.min(caster.lightestN, gauge.casterLoadN());
      }
    }
    if (contact < 0) throw new Error('never met the wall');
    const finalPitchDeg = log.at(-1)!.pitch;
    let settled: number | null = null;
    for (let i = log.length - 1; i >= 0 && Math.abs(log[i]!.pitch - finalPitchDeg) <= 0.2 && log[i]!.turn <= 0.05; i--) settled = i;
    const what = c.massG === 0 ? 'empty claw' : `${c.massG} g at u ${c.graspU}`;
    return {
      name: `duty ${c.duty}, lift ${c.liftDeg}°, ${what}`,
      speedMS,
      heldAtContact,
      mostPitchDeg: Math.max(...log.map((entry) => entry.pitch)),
      finalPitchDeg,
      settledS: settled === null ? null : settled / 120,
      finite,
      caster,
    };
  } finally {
    scene.dispose();
  }
}

/** Every lift the claw meets a wall at (lift 0: the empty claw only, a held cube rests on the floor there), empty, 15 g and 50 g, both grips. */
function wallCases(duty: number): WallCase[] {
  const cases: WallCase[] = [{ duty, liftDeg: 0, massG: 0, graspU: 3 }];
  for (const liftDeg of [45, 90]) {
    cases.push({ duty, liftDeg, massG: 0, graspU: 3 });
    for (const massG of [15, 50]) for (const graspU of [3, 4]) cases.push({ duty, liftDeg, massG, graspU });
  }
  return cases;
}

describe('the gripper car’s stability (N19 B5)', () => {
  it('brake from top speed with 50 g held tips < 3°, caster loaded', () => {
    // Plan §4.4: the forward tipping threshold 1.04 g against the wheels' 0.63 g of braking, ×1.65. ADR 0004 §4.2 scenario 4: lift 90° and 45°.
    const rows: string[] = [];
    for (const [liftDeg, stop] of [
      [90, BRAKE],
      [45, BRAKE],
      [90, COAST],
    ] as const) {
      const scene = gripperScene({ ground: floor([300, 100]), objects: [cubeFor(50)] }, START);
      try {
        const gauge = gauges(scene);
        const script = (function* (): Script {
          yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
          scene.set({ liftDeg });
          yield* wait(seconds(0.5));
          scene.drive(forward(255));
          yield* wait(seconds(1.5));
        })();
        runThrough(scene, script);
        expect(scene.grasp.heldId).toBe('cube');
        const topSpeed = scene.robot.chassis.linvel().x;
        const x0 = scene.robot.chassis.translation().x;
        scene.drive(stop);
        const pitch = { least: Infinity, most: -Infinity };
        let highestCasterMm = -Infinity;
        let lightestCasterN = Infinity;
        run(scene, wait(seconds(1.5)), seconds(1.5), () => {
          pitch.least = Math.min(pitch.least, gauge.pitchDeg());
          pitch.most = Math.max(pitch.most, gauge.pitchDeg());
          highestCasterMm = Math.max(highestCasterMm, gauge.casterGapMm());
          lightestCasterN = Math.min(lightestCasterN, gauge.casterLoadN());
        });
        const name = `lift ${liftDeg}° ${stop.brake ? 'brake' : 'coast'}`;
        rows.push(name);
        // Top speed 0.476 m/s (ADR 0004 §4.2: 0.476); stopped in 1.67 / 1.65 cm braking, 3.92 cm coasting (spike: 1.66, 1.64, 3.95).
        expect(topSpeed, name).toBeCloseTo(0.476, 3);
        expect((scene.robot.chassis.translation().x - x0) * 100, name).toBeCloseTo(stop.brake ? (liftDeg === 90 ? 1.67 : 1.65) : 3.92, 1);
        expect(Math.max(Math.abs(pitch.least), Math.abs(pitch.most)), name).toBeLessThan(3);
        // Measured: −0.053..+0.034° (90°), −0.056..+0.019° (45°), −0.026..+0.034° coasting; the spike: −0.054..+0.034°, −0.057..+0.019°.
        expect(Math.max(Math.abs(pitch.least), Math.abs(pitch.most)), name).toBeLessThan(0.06);
        // The caster never leaves the floor and always carries weight (measured ≥ 1.667 N; at rest it carries about 1.7 N).
        expect(highestCasterMm, name).toBeLessThanOrEqual(0.1);
        expect(lightestCasterN, name).toBeGreaterThan(1.5);
        expect(scene.grasp.heldId, name).toBe('cube');
        expect(gauge.finite(), name).toBe(true);
      } finally {
        scene.dispose();
      }
    }
    expect(rows).toHaveLength(3);
  }, 60_000);

  it('claw into a wall with the drive released on contact tips < 8° and settles within 0.5 s', () => {
    // ADR 0004 §4.2 scenario 5b (the spike's: a 15 g cube that meets the wall first, 0.398 m/s, lift 45° and 90°), and every lift, payload and
    // grip at the lesson solutions' speeds (duty 128, 50 %, and 160). Measured worst: 7.71° (duty 160, lift 45°, the empty claw: its frictionless
    // fingertips meet the wall 7 cm up). Faster, with the fingertips first, it tips more: the next test.
    const outcomes = [
      ...[45, 90].map((liftDeg) => wallHit({ duty: 226, liftDeg, massG: 15, graspU: 4 })),
      ...wallCases(128).map(wallHit),
      ...wallCases(160).map(wallHit),
      // The spike's speed with the fingertips first at lift 45°: under 8°, but the caster lifts (ruling G0 caster's limit, below).
      wallHit({ duty: 226, liftDeg: 45, massG: 15, graspU: 3 }),
    ];
    for (const outcome of outcomes) {
      expect(outcome.finite, outcome.name).toBe(true);
      expect(outcome.mostPitchDeg, outcome.name).toBeLessThan(8);
      expect(outcome.settledS, outcome.name).not.toBeNull();
      expect(outcome.settledS!, outcome.name).toBeLessThanOrEqual(0.5);
    }
    expect(outcomes).toHaveLength(2 + 11 + 11 + 1);
    // The spike's case: 0.398 m/s; the cube breaks off (24.9 / 17.3 N in the spike, past 9.71 N); 0.17° and 2.31°, settled in 0.058 and 0.125 s
    // (the spike: 1.00° and 2.39°, 0.083 and 0.175 s).
    const [at45, at90] = outcomes;
    for (const outcome of [at45!, at90!]) {
      expect(outcome.speedMS, outcome.name).toBeCloseTo(0.398, 3);
      expect(outcome.heldAtContact, outcome.name).toBe('cube');
    }
    expect(at45!.mostPitchDeg).toBeCloseTo(0.17, 2);
    expect(at90!.mostPitchDeg).toBeCloseTo(2.31, 2);
    // Ruling G0 caster: on a wall hit at lift 90° the caster lifts ≤ 3 mm, at lift ≤ 45° it stays on the floor. True when the cube meets the
    // wall first (measured 2.862 mm for 12 ticks; 0.080 mm, never off, though its load touches 0 N on a tick of the impact). With the
    // fingertips first it is not: 5.01 mm at lift 45° here, up to 23.7 mm in the next test.
    expect(at90!.caster.highestMm).toBeLessThanOrEqual(3);
    expect(at90!.caster.highestMm).toBeCloseTo(2.862, 3);
    expect(at90!.caster.offTicks).toBe(12);
    expect(at45!.caster.highestMm).toBeLessThanOrEqual(0.1);
    expect(at45!.caster.highestMm).toBeCloseTo(0.08, 3);
    expect(at45!.caster.offTicks).toBe(0);
    const tipsFirst = outcomes.at(-1)!;
    expect(tipsFirst.name).toBe('duty 226, lift 45°, 15 g at u 3');
    expect(tipsFirst.mostPitchDeg).toBeCloseTo(3.95, 2);
    expect(tipsFirst.caster.highestMm).toBeGreaterThan(3);
    expect(tipsFirst.caster.highestMm).toBeCloseTo(5.01, 2);
    const worst = outcomes.reduce((a, b) => (b.mostPitchDeg > a.mostPitchDeg ? b : a));
    expect(worst.name).toBe('duty 160, lift 45°, empty claw');
    expect(worst.mostPitchDeg).toBeCloseTo(7.71, 2);
    // At duty 128 nothing tips more than 0.73° (measured).
    expect(Math.max(...outcomes.slice(2, 13).map((outcome) => outcome.mostPitchDeg))).toBeLessThan(0.75);
    expect(Math.max(...outcomes.map((outcome) => outcome.settledS!))).toBeLessThan(0.25);
  }, 120_000);

  it('with the fingertips or the empty claw first, a claw raised to 45–90° meeting a wall at 0.4 m/s or more tips past 8° even released (up to 17.2°), but stays finite and settles within 0.5 s', () => {
    // Why every gripper scenario ends the run on contact with a wall on the claw's path (ruling G0 wall): with the fingertips (frictionless,
    // they slide up the wall) or the empty claw first, at lift 45–90°, the car noses up past 8° though the drive lets go at the contact.
    const outcomes = [
      wallHit({ duty: 226, liftDeg: 45, massG: 0, graspU: 3 }),
      wallHit({ duty: 226, liftDeg: 90, massG: 0, graspU: 3 }),
      wallHit({ duty: 226, liftDeg: 90, massG: 15, graspU: 3 }),
      wallHit({ duty: 255, liftDeg: 45, massG: 15, graspU: 3 }),
      wallHit({ duty: 255, liftDeg: 90, massG: 15, graspU: 3 }),
      wallHit({ duty: 255, liftDeg: 90, massG: 0, graspU: 3 }),
    ];
    // Measured: 8.35, 14.22, 11.44, 12.47, 17.16 and 15.70°; settled in 0.24–0.39 s. Some stay leaning on the wall a few degrees up, the
    // caster off the floor (final 0.06–4.86°): the coasting motors' gearbox friction holds the wheels (as ADR 0001 §9's servo arm did).
    expect(outcomes.map((outcome) => Math.round(outcome.mostPitchDeg * 100) / 100)).toEqual([8.35, 14.22, 11.44, 12.47, 17.16, 15.7]);
    // The fingertips or the empty claw first, the caster lifts far past ruling G0 caster's 3 mm (measured, mm).
    expect(outcomes.map((outcome) => Math.round(outcome.caster.highestMm * 100) / 100)).toEqual([10.78, 18.42, 14.81, 16.15, 23.68, 20.45]);
    for (const outcome of outcomes) expect(outcome.caster.highestMm, outcome.name).toBeGreaterThan(3);
    for (const outcome of outcomes) {
      expect(outcome.finite, outcome.name).toBe(true);
      expect(outcome.mostPitchDeg, outcome.name).toBeGreaterThan(8);
      expect(outcome.mostPitchDeg, outcome.name).toBeLessThan(17.5);
      expect(outcome.settledS!, outcome.name).toBeLessThanOrEqual(0.5);
      expect(Math.abs(outcome.finalPitchDeg), outcome.name).toBeLessThan(5);
    }
  }, 120_000);

  it('drive still pushing into a wall noses up but stays finite and lands back on its wheels', () => {
    // ADR 0004 §4.2 scenarios 5a and 5c, ruling G0 wall: teleop at full speed (duty 255) into a wall for 3 s, then released (drive.stop: coast)
    // for 2 s, then backed off at duty 128 for 1 s and braked.
    const rows: string[] = [];
    for (const [liftDeg, massG, graspU] of [
      [45, 50, 4],
      [90, 50, 4],
      [90, 50, 3],
      [45, 0, 3],
      [90, 0, 3],
    ] as const) {
      const wallX = START.xCm + TIP0 + graspU + 8 + 60;
      const scene = gripperScene({ ground: floor([250, 100]), walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: massG === 0 ? [] : [cubeFor(massG, graspU)] }, START);
      try {
        const gauge = gauges(scene);
        const wall = colliderOf(scene, 'wall');
        const name = `lift ${liftDeg}°, ${massG === 0 ? 'empty claw' : `${massG} g at u ${graspU}`}`;
        let contact = -1;
        let driving = false;
        const setup = (function* (): Script {
          if (massG > 0) yield* pick(scene, 'cube', { liftDeg: 0, u: graspU });
          scene.set({ liftDeg, clawDeg: massG > 0 ? 80 : 0 });
          yield* wait(seconds(0.5));
          scene.drive(forward(255));
          driving = true;
          for (;;) yield;
        })();
        for (let tick = 0; tick < seconds(12) && contact < 0; tick++) {
          setup.next();
          scene.step(() => {
            if (driving && touches(scene, wall)) contact = scene.tick;
          });
        }
        expect(contact, name).toBeGreaterThan(0);
        // Pushing: the reaction high on the wall and the drive at the floor pitch it up (ADR 0001 §9's arm: 15.85°), on its wheels, finite.
        // (Pitched up, the wheels' support balls, 2 cm under the axle, swing up to 2.8 mm off the floor: the car stands on its wheels' rims.)
        const pushing = { most: -Infinity, roll: 0, finite: true };
        run(scene, wait(seconds(3)), seconds(3), () => {
          pushing.most = Math.max(pushing.most, gauge.pitchDeg());
          pushing.roll = Math.max(pushing.roll, Math.abs(gauge.rollDeg()));
          pushing.finite &&= gauge.finite();
        });
        const pushedPitch = gauge.pitchDeg();
        // Released: the coasting motors' gearbox friction keeps it leaning on the wall, where the push left it (ADR 0001 §9: "stood like that").
        scene.drive(COAST);
        run(scene, wait(seconds(2)), seconds(2));
        const releasedPitch = gauge.pitchDeg();
        const releasedFinite = gauge.finite();
        // Backed off, it lands back on its wheels and its caster.
        scene.drive(backward(128));
        run(scene, wait(seconds(1)), seconds(1));
        scene.drive(BRAKE);
        run(scene, wait(seconds(1)), seconds(1));
        rows.push(`${name}: ${pushing.most.toFixed(2)}° pushing, ${releasedPitch.toFixed(2)}° released, ${gauge.pitchDeg().toFixed(2)}° backed off`);
        expect([pushing.finite, releasedFinite, gauge.finite()], name).toEqual([true, true, true]);
        expect(pushing.most, name).toBeGreaterThan(15);
        expect(pushing.most, name).toBeLessThan(19);
        expect(pushing.roll, name).toBeLessThan(1);
        expect(Math.abs(releasedPitch - pushedPitch), name).toBeLessThan(0.5);
        expect(Math.abs(gauge.pitchDeg()), name).toBeLessThan(0.5);
        expect(gauge.wheelsDown(), name).toBe(true);
        expect(gauge.casterGapMm(), name).toBeLessThanOrEqual(0.1);
        expect(gauge.casterLoadN(), name).toBeGreaterThan(0.5);
      } finally {
        scene.dispose();
      }
    }
    // Measured: 17.78 / 15.81 / 17.19 / 17.32 / 18.80° at most pushing (the spike: 17.16°, 15.69°, 16.58°); 15.93 / 11.26 / 16.31 / 15.71 /
    // 15.28° leaning, released; 0.03–0.08° backed off.
    expect(rows.map((row) => row.split(':')[1]!.split('°')[0]!.trim())).toEqual(['17.78', '15.81', '17.19', '17.32', '18.80']);
  }, 120_000);

  it('full-speed lift moves lift the caster ≤ 4 mm for ≤ 0.2 s', () => {
    // Ruling G0 caster: the boom's momentum outweighs the caster's holding moment for a moment when a full-speed move down stops (physical).
    let highestMm = 0;
    let longestTicks = 0;
    for (const massG of [0, 15, 50]) {
      const scene = gripperScene({ ground: floor([300, 100]), objects: massG === 0 ? [] : [cubeFor(massG)] }, START);
      try {
        const gauge = gauges(scene);
        if (massG > 0) run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(3));
        for (const [from, to] of [
          [0, 90],
          [90, 0],
          [90, 40],
          [40, 90],
          [90, 45],
          [45, 0],
          [0, 45],
          [90, 60],
          [60, 0],
        ] as const) {
          scene.set({ liftDeg: from });
          run(scene, wait(seconds(0.6)), seconds(0.6));
          scene.set({ liftDeg: to });
          let off = 0;
          run(scene, wait(seconds(0.8)), seconds(0.8), () => {
            const gap = gauge.casterGapMm();
            highestMm = Math.max(highestMm, gap);
            off = gap > 0.1 ? off + 1 : 0;
            longestTicks = Math.max(longestTicks, off);
          });
          expect(Math.abs(scene.gripper.liftDeg() - to), `${massG} g ${from}→${to}`).toBeLessThan(massG > 0 && to === 0 ? 1 : 0.5);
          expect(scene.grasp.heldId, `${massG} g ${from}→${to}`).toBe(massG > 0 ? 'cube' : null);
          expect(gauge.finite()).toBe(true);
        }
      } finally {
        scene.dispose();
      }
    }
    expect(highestMm).toBeLessThanOrEqual(4);
    expect(longestTicks).toBeLessThanOrEqual(seconds(0.2));
    // Measured: 3.336 mm for 11 ticks (0.092 s), holding 50 g, 90° → 0° (the spike: ≤ 3.34 mm, 20 ticks); moves up never lift it.
    expect(highestMm).toBeCloseTo(3.336, 2);
    expect(longestTicks).toBe(11);
  }, 60_000);

  it('starts from rest at duty ≥ 128 (50 %) with 50 g held at lift 0°', () => {
    // Ruling G0 start duty: the lowest duty the lesson solutions use. The held cube at lift 0° rests on the floor and is dragged along. In
    // five arenas and places (the stale-friction cases of B2's fix round 1 among them); and at 40 % (duty 102), the margin the plan asked.
    const moved = new Map<string, number>();
    for (const [size, at, yawDeg] of [
      [[300, 300], [40, 50], 0],
      [[400, 400], [40, 50], 0],
      [[200, 100], [40, 50], 0],
      [[300, 300], [150, 150], 90],
      [[180, 150], [30, 75], 0],
    ] as const) {
      for (const duty of [102, 128, 160]) {
        const start = { xCm: at[0], yCm: at[1], yawDeg };
        const ahead = TIP0 + 3 + 8;
        const scene = gripperScene({ ground: floor(size), objects: [cube('cube', yawDeg === 0 ? [at[0] + ahead, at[1]] : [at[0], at[1] + ahead], 50)] }, start);
        try {
          const key = `${size.join('×')} at (${at.join(', ')}) ${yawDeg}°, duty ${duty}`;
          const script = (function* (): Script {
            yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
            scene.drive(BRAKE);
            yield* wait(seconds(0.5));
            const from = scene.robot.pose().position;
            scene.drive(forward(duty));
            yield* wait(seconds(0.5));
            const to = scene.robot.pose().position;
            moved.set(key, Math.hypot(to.x - from.x, to.z - from.z) * 100);
            expect(scene.grasp.heldId, key).toBe('cube');
            scene.drive(BRAKE);
            for (;;) yield;
          })();
          run(scene, script, seconds(0.35 + 4 + 1.1 + 1));
          expect(moved.has(key), key).toBe(true);
        } finally {
          scene.dispose();
        }
      }
    }
    // In 0.5 s from rest, in every arena alike: 1.369–1.371 cm at duty 102, 4.431–4.434 cm at 128, 8.199–8.203 cm at 160 (measured; B2's
    // fix round 1: 8.20 at 160). Duty 100 moves it 1.14 cm and duty 90 not at all (0.009 cm): it starts from about duty 95, 37 %.
    for (const [key, cm] of moved) {
      const duty = Number(key.split('duty ')[1]);
      const expected = duty === 102 ? 1.37 : duty === 128 ? 4.433 : 8.2;
      expect(Math.abs(cm - expected), key).toBeLessThan(0.005);
    }
    expect(moved.size).toBe(15);
  }, 120_000);

  it('pressing a held 50 g cube on the floor at lift stall keeps the grasp, and lifting it again sets the car back level (Review Focus 1)', () => {
    // World-level with 15 g: world.goal-frame.gripper.test.ts. Here the heaviest payload, gripped at lift 10° and 15° (the cube 0.4 and 0.8 cm
    // under the carriage), told lift 0°: the cube meets the floor first, the servo lifts the car's nose rather than press harder, and the
    // external force on the cube stays under the break threshold (9.71 N).
    expect(breakForceN(spec)).toBeCloseTo(9.71, 2);
    const peaks: number[] = [];
    for (const gripLift of [10, 15]) {
      const scene = gripperScene({ ground: floor([200, 100]), objects: [cubeFor(50)] }, START);
      try {
        const gauge = gauges(scene);
        const object = scene.object('cube');
        const externalN = () => {
          const others: Collider[] = [];
          scene.world.contactPairsWith(object.collider, (other) => {
            if (!scene.gripper.ownsCollider(other)) others.push(other);
          });
          let impulse = 0;
          for (const other of others) {
            scene.world.contactPair(object.collider, other, (manifold) => {
              for (let i = 0; i < manifold.numContacts(); i++) {
                impulse += Math.hypot(manifold.contactImpulse(i), manifold.contactTangentImpulseX(i), manifold.contactTangentImpulseY(i));
              }
            });
          }
          return impulse / scene.world.timestep;
        };
        const tipX = 4.5 + 5 * Math.cos((gripLift - 40) * DEG);
        scene.set({ liftDeg: gripLift, clawDeg: 0 });
        run(scene, wait(seconds(0.35)), seconds(0.35));
        scene.drive(forward(140));
        for (let i = 0; i < seconds(4) && (object.body.translation().x - scene.robot.chassis.translation().x) * 100 - tipX > 3.25; i++) scene.step();
        scene.drive(BRAKE);
        run(scene, wait(seconds(0.3)), seconds(0.3));
        scene.set({ clawDeg: 80 });
        run(scene, wait(seconds(0.6)), seconds(0.6));
        expect(scene.grasp.heldId).toBe('cube');
        scene.set({ liftDeg: 0 });
        let peakN = 0;
        let mostPitch = 0;
        let held = true;
        for (let i = 0; i < seconds(2.5); i++) {
          scene.step(() => {
            peakN = Math.max(peakN, externalN());
          });
          mostPitch = Math.max(mostPitch, gauge.pitchDeg());
          held &&= scene.grasp.heldId === 'cube';
        }
        peaks.push(peakN);
        expect(held, `lift ${gripLift}`).toBe(true);
        expect(peakN, `lift ${gripLift}`).toBeLessThan(breakForceN(spec));
        expect(Math.abs(scene.gripper.liftDeg()), `lift ${gripLift}`).toBeLessThan(0.1);
        // The nose lifts 3.70° (10°) and 5.67° (15°): the car's weight bounds how hard the servo presses.
        expect(mostPitch, `lift ${gripLift}`).toBeCloseTo(gripLift === 10 ? 3.7 : 5.67, 1);
        expect(gauge.finite()).toBe(true);
        scene.set({ liftDeg: 90 });
        run(scene, wait(seconds(1)), seconds(1));
        expect(scene.grasp.heldId).toBe('cube');
        expect(Math.abs(gauge.pitchDeg())).toBeLessThan(0.1);
        expect(gauge.casterGapMm()).toBeLessThanOrEqual(0.1);
        expect(gauge.casterLoadN()).toBeGreaterThan(1.5);
      } finally {
        scene.dispose();
      }
    }
    // Measured: 3.33 N and 3.74 N at most (the spike, 15 g at 10°: 4.51 N), a third of the 9.71 N it takes to break.
    expect(peaks.map((n) => Math.round(n * 100) / 100)).toEqual([3.33, 3.74]);
  }, 60_000);
});
