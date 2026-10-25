import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import { createGoal, goalReasons, type Goal, type GoalFrame } from '../scenario/goals';
import { loadScenario, type Scenario } from '../scenario/scenario';
import { toGoalFrame, type GoalFrameExtras } from './goal-frame';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import type { RobotSnapshot } from './snapshot';
import { createScenarioWorld } from './world';

// N18 R3.5: the goals' view of a tick. A RobotSnapshot and the world's extras become the GoalFrame of R6.1 (plain cm and degrees),
// and the goals judge real runs from it.

beforeAll(() => initPhysics(), 30_000);

const pose = (xCm: number, yCm: number, yawDeg = 0) => ({ xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const snapshot: RobotSnapshot = {
  t: 1.25,
  robot: { ...pose(40, 60, 30), wheelRad: [3, 3.5], servoDeg: { servo1: 45 } },
  objects: [
    { id: '#box-1', kind: 'box', pose: pose(10, 10) },
    { id: 'crate', kind: 'object', pose: pose(120, 150, 15) },
    { id: '__proto__', kind: 'object', pose: pose(5, 6) },
  ],
  sensors: [
    { role: 'ultrasonic', kind: 'ultrasonic', cm: 400, hitId: null },
    { role: 'lineLeft', kind: 'line-sensor', reflectance: 0, dark: true, spotCm: [47, 61.5] },
    { role: 'lineCenter', kind: 'line-sensor', reflectance: 0, dark: true, spotCm: null },
    { role: 'lineRight', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: [47, 58.5] },
  ],
  pins: [],
  leds: { led1: true },
  activeBlockId: null,
  status: 'running',
  outOfArena: false,
  score: { points: 0, maxScore: null, goals: [] },
};
const extras: GoalFrameExtras = {
  contacts: [
    { otherId: '#ground', kind: 'ground', tags: ['ground'] },
    { otherId: 'east', kind: 'wall', tags: ['wall', 'fence'] },
    { otherId: 'crate', kind: 'object', tags: ['object', 'pushable'] },
  ],
  speedCmS: 12.5,
  footprint: { kind: 'polygon', pointsCm: [[30, 50], [50, 50], [50, 70], [30, 70]] },
  servoRangeDeg: { servo1: [0, 180] },
};

describe('toGoalFrame', () => {
  it('turns a snapshot and the world’s extras into the goal frame, in plain cm and degrees', () => {
    const frame: GoalFrame = toGoalFrame(snapshot, extras);
    expect(frame).toEqual({
      tS: 1.25,
      robot: { xCm: 40, yCm: 60, yawDeg: 30, speedCmS: 12.5, footprint: extras.footprint, lineSpotsCm: [[47, 61.5], [47, 58.5]] },
      objects: { crate: { xCm: 120, yCm: 150, yawDeg: 15 }, ['__proto__']: { xCm: 5, yCm: 6, yawDeg: 0 } },
      contacts: [
        { otherId: 'east', tags: ['wall', 'fence'] },
        { otherId: 'crate', tags: ['object', 'pushable'] },
      ],
      servoDeg: { servo1: 45 },
      leds: { led1: true },
      buzzerHz: null,
      outOfArena: false,
    });
  });

  it('leaves out the floor among the contacts, a lifted line sensor among the spots, and the boxes among the objects', () => {
    const frame = toGoalFrame(snapshot, extras);
    expect(frame.contacts.map((contact) => contact.otherId)).not.toContain('#ground');
    expect(frame.robot.lineSpotsCm).toHaveLength(2);
    expect(Object.keys(frame.objects)).toEqual(['crate', '__proto__']);
    expect(Object.hasOwn(frame.objects, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(frame.objects)).toBe(Object.prototype);
  });

  it('snaps each servo angle to a thousandth of a degree and clamps it to its servo’s range; the snapshot keeps the physical angle', () => {
    // The physics leaves an arm a hair off: at rest at 0° it reads −1.2e-6°, driven to an end up to 0.06° past it, held at 180° as
    // low as 179.999987°.
    const angles = (servo1: number, servo2?: number) =>
      toGoalFrame(
        { ...snapshot, robot: { ...snapshot.robot, servoDeg: servo2 === undefined ? { servo1 } : { servo1, servo2 } } },
        { ...extras, servoRangeDeg: { servo1: [0, 180], servo2: [30, 150] } },
      ).servoDeg;
    expect(angles(-0.0000012)).toEqual({ servo1: 0 });
    expect(angles(-0.057)).toEqual({ servo1: 0 });
    expect(angles(180.058)).toEqual({ servo1: 180 });
    expect(angles(179.9999996)).toEqual({ servo1: 180 });
    expect(angles(179.999987)).toEqual({ servo1: 180 });
    expect(angles(89.9999998)).toEqual({ servo1: 90 });
    expect(angles(45.0004, 20)).toEqual({ servo1: 45, servo2: 30 });
    expect(angles(45.0006)).toEqual({ servo1: 45.001 });
    expect(angles(90, 150.2)).toEqual({ servo1: 90, servo2: 150 });
    expect(Object.is(angles(-0.0000001).servo1, 0)).toBe(true);
    // A servo the kit gives no range for is only snapped.
    expect(toGoalFrame({ ...snapshot, robot: { ...snapshot.robot, servoDeg: { servo9: 200.0001 } } }, extras).servoDeg).toEqual({ servo9: 200 });
    // The snapshot is not changed: it keeps what the physics says, for the view.
    expect(snapshot.robot.servoDeg).toEqual({ servo1: 45 });
  });

  it('takes the buzzer from the run session, and the latched outOfArena from the snapshot', () => {
    expect(toGoalFrame(snapshot, { ...extras, buzzerHz: 440 }).buzzerHz).toBe(440);
    expect(toGoalFrame({ ...snapshot, outOfArena: true }, extras).outOfArena).toBe(true);
  });
});

describe('goals judged on a world (snapshot → frame → R6.1 goals)', () => {
  const kit = productionKits.get(referenceKitRef) as Kit;
  // A 300 × 150 cm floor: the robot starts at x 50 facing +x, a zone "goal" at x 150..200 lies ahead, then a wall tagged "fence"
  // whose face is at x 249.
  const scenario: Scenario = loadScenario({
    key: 'rb-drive-to-zone',
    version: 1,
    title: { vi: 'Thử: tới vùng, đừng chạm hàng rào', en: 'Fixture: reach the zone, do not touch the fence' },
    profile: 'uno-basic',
    kit: 'ref-uno-rover',
    arena: {
      ground: { sizeCm: [300, 150], color: '#ffffff' },
      paint: { zones: [{ id: 'goal', kind: 'target', polygonCm: [[150, 50], [200, 50], [200, 100], [150, 100]], color: '#d9ead3' }] },
      walls: [{ id: 'east', fromCm: [250, 0], toCm: [250, 150], tags: ['fence'] }],
    },
    start: { xCm: 50, yCm: 75, yawDeg: 0 },
    variants: { count: 1, seed: 7, startJitterCm: 0, yawJitterDeg: 0 },
    timeLimitS: 20,
    goals: [
      { id: 'reach', kind: 'reach-zone', label: { vi: 'Tới vùng', en: 'Reach the zone' }, points: 50, zone: 'goal' },
      { id: 'no-fence', kind: 'avoid-contact', label: { vi: 'Không chạm hàng rào', en: 'Do not touch the fence' }, points: 50, tag: 'fence' },
    ],
    starter: {},
  });
  const drive: ActuatorTargets = { motors: { motorLeft: { duty: 200, dir: 1, brake: false }, motorRight: { duty: 200, dir: 1, brake: false } } };
  const brake: ActuatorTargets = { motors: { motorLeft: { duty: 255, dir: 0, brake: true }, motorRight: { duty: 255, dir: 0, brake: true } } };

  /** Runs the scenario's world for `ticks`, feeding every tick's frame (tick 0's with a tick of 0 s) to the goals. */
  async function judge(ticks: number, targets: (tick: number) => ActuatorTargets) {
    const world = await createScenarioWorld(scenario, kit, 0);
    try {
      const goals: Goal[] = scenario.goals.map((spec) => createGoal(spec, { arena: world.arena, scenario }));
      const frames: GoalFrame[] = [];
      const feed = (dtS: number) => {
        const frame = toGoalFrame(world.snapshot(), world.frameExtras());
        frames.push(frame);
        for (const goal of goals) goal.update(frame, dtS);
      };
      feed(0);
      for (let tick = 0; tick < ticks; tick++) {
        world.applyActuators(targets(tick));
        world.step(PHYSICS_DT_S);
        feed(PHYSICS_DT_S);
      }
      return { results: goals.map((goal) => goal.result()), frames };
    } finally {
      world.dispose();
    }
  }

  it('driving into the zone passes reach-zone on the tick the middle of the body enters it; hitting the fence fails avoid-contact', async () => {
    const { results, frames } = await judge(1200, () => drive);
    const entered = frames.find((frame) => frame.robot.xCm >= 150)!;
    const touched = frames.find((frame) => frame.contacts.some((contact) => contact.otherId === 'east'))!;
    expect(results[0]).toEqual({ id: 'reach', passed: true, points: 50, progress: 1, atS: entered.tS });
    expect(results[1]).toEqual({ id: 'no-fence', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: touched.tS });
    // The fence is met with the body's front, 7.5 cm ahead of the middle: at x 241.5, within the 1 mm a contact allows.
    const at = frames.indexOf(touched);
    expect(touched.robot.xCm + 7.5).toBeGreaterThan(248.9);
    expect(frames[at - 1]!.robot.xCm + 7.5).toBeLessThan(248.9);
    // The floor is never a contact of the frame, though the robot stands on it throughout.
    expect(frames.every((frame) => frame.contacts.every((contact) => contact.otherId !== '#ground'))).toBe(true);
  });

  it('stopping short of the fence passes both: it drove far enough for the guard goal and touched nothing tagged', async () => {
    const { results, frames } = await judge(720, (tick) => (tick < 420 ? drive : brake));
    expect(results.map((result) => [result.id, result.passed])).toEqual([
      ['reach', true],
      ['no-fence', true],
    ]);
    expect(frames.at(-1)!.robot.xCm).toBeLessThan(241);
    expect(frames.at(-1)!.robot.speedCmS).toBeLessThan(0.1);
  });

  it('standing still passes neither: the zone is not reached, and the guard goal needs the robot 20 cm from its start', async () => {
    const { results } = await judge(240, () => ({}));
    expect(results.map((result) => [result.id, result.passed, result.reasonKey])).toEqual([
      ['reach', false, goalReasons.zoneNotReached],
      ['no-fence', false, goalReasons.robotDidNotMove],
    ]);
  });
});

describe('goals judged on a world: spinning in place and servo angles at their ends', () => {
  const kit = productionKits.get(referenceKitRef) as Kit;
  const scenarioOf = (goals: Scenario['goals'] | unknown[]): Scenario =>
    loadScenario({
      key: 'rb-mini-mission',
      version: 1,
      title: { vi: 'Thử: quay tại chỗ', en: 'Fixture: spinning in place' },
      profile: 'uno-basic',
      kit: 'ref-uno-rover',
      arena: {
        ground: { sizeCm: [300, 200], color: '#ffffff' },
        paint: {
          lines: [{ pointsCm: [[50, 50], [250, 50]], widthCm: 2 }],
          zones: [{ id: 'pad', kind: 'target', polygonCm: [[120, 70], [180, 70], [180, 130], [120, 130]], color: '#d9ead3' }],
        },
        walls: [{ id: 'east', fromCm: [290, 0], toCm: [290, 200], tags: ['fence'] }],
      },
      start: { xCm: 150, yCm: 100, yawDeg: 0 },
      variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
      timeLimitS: 60,
      goals,
      starter: {},
    });
  const label = { vi: 'Mục tiêu', en: 'Goal' };

  /** Runs variant 0 for `ticks`, feeding every frame to the scenario's goals; returns their results and the last frame. */
  async function judge(scenario: Scenario, ticks: number, targets: (tick: number) => ActuatorTargets) {
    const world = await createScenarioWorld(scenario, kit, 0);
    try {
      const goals = scenario.goals.map((spec) => createGoal(spec, { arena: world.arena, scenario }));
      let frame = toGoalFrame(world.snapshot(), world.frameExtras());
      for (const goal of goals) goal.update(frame, 0);
      for (let tick = 0; tick < ticks; tick++) {
        world.applyActuators(targets(tick));
        world.step(PHYSICS_DT_S);
        frame = toGoalFrame(world.snapshot(), world.frameExtras());
        for (const goal of goals) goal.update(frame, PHYSICS_DT_S);
      }
      return { results: goals.map((goal) => goal.result()), frame, snapshot: world.snapshot() };
    } finally {
      world.dispose();
    }
  }

  it.each([150, 255])('a robot spinning in place for the whole 60 s at duty %i fails both guard goals (it did not move) and counts as stopped', async (duty) => {
    const scenario = scenarioOf([
      { id: 'on-line', kind: 'stay-on-line', label, points: 40, minRatio: 0.5 },
      { id: 'no-fence', kind: 'avoid-contact', label, points: 30, tag: 'fence' },
      { id: 'park', kind: 'stop-in-zone', label, points: 30, zone: 'pad', maxSpeedCmS: 1, holdS: 1 },
    ]);
    const spin: ActuatorTargets = { motors: { motorLeft: { duty, dir: -1, brake: false }, motorRight: { duty, dir: 1, brake: false } } };
    const { results, frame } = await judge(scenario, 60 * 120, () => spin);
    expect(results.map((result) => [result.id, result.passed, result.reasonKey])).toEqual([
      ['on-line', false, goalReasons.robotDidNotMove],
      ['no-fence', false, goalReasons.robotDidNotMove],
      ['park', true, undefined],
    ]);
    // It has spun the whole time, about where it started.
    expect(Math.hypot(frame.robot.xCm - 150, frame.robot.yCm - 100)).toBeLessThan(3);
  }, 60_000);

  it('a folded arm passes a range from 0, and an arm held at 180° passes a range of exactly 180°', async () => {
    const scenario = scenarioOf([
      { id: 'folded', kind: 'servo-angle', label, points: 50, role: 'servo1', minDeg: 0, maxDeg: 10 },
      { id: 'up', kind: 'servo-angle', label, points: 50, role: 'servo1', minDeg: 180, maxDeg: 180 },
    ]);
    // 1 s at rest (the arm folded at its restDeg 0), then 1.5 s told 180°.
    const { results, frame, snapshot } = await judge(scenario, 300, (tick) => (tick < 120 ? {} : { servos: { servo1: 180 } }));
    expect(results.map((result) => [result.id, result.passed])).toEqual([
      ['folded', true],
      ['up', true],
    ]);
    expect(frame.servoDeg.servo1).toBe(180);
    // The snapshot keeps the arm's physical angle, a hair off the end.
    expect(snapshot.robot.servoDeg.servo1).toBeCloseTo(180, 1);
  });
});
