import { beforeAll, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario, ScenarioError } from '../scenario/scenario';
import { applyVariant, kitFootprintRadiusCm, variantOffsets, variantSeed } from '../scenario/variants';
import { parseArena, type ArenaInput } from './arena/arena-schema';
import boxesArena from './arena/fixtures/boxes.json';
import lineLoopArena from './arena/fixtures/line-loop.json';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import type { MotorCommand } from './robot/dc-motor';
import { robotFootprint } from './robot/footprint';
import { readContacts } from './sensors/contacts';
import { isOutOfArena } from './sensors/out-of-arena';
import { hashSnapshot, type RobotSnapshot } from './snapshot';
import { createScenarioWorld, createWorld, type World } from './world';

// N18 R3.5: the world facade. One object that holds the physics, the arena, the robot and its sensors, steps in fixed ticks and
// tells what it looks like on each one (RobotSnapshot), with the reference kit ref-uno-rover@0.

// Both are the real functions; a test may count the calls or change one answer.
vi.mock('./sensors/contacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sensors/contacts')>();
  return { ...actual, readContacts: vi.fn(actual.readContacts) };
});
vi.mock('./sensors/out-of-arena', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sensors/out-of-arena')>();
  return { ...actual, isOutOfArena: vi.fn(actual.isOutOfArena) };
});

beforeAll(() => initPhysics(), 30_000);

const kit = productionKits.get(referenceKitRef) as Kit;
const open = (sizeCm: [number, number] = [300, 300]): ArenaInput => ({ ground: { sizeCm, color: '#ffffff' } });
const run = (duty: number, dir: -1 | 0 | 1): MotorCommand => ({ duty, dir, brake: false });
const both = (command: MotorCommand): ActuatorTargets => ({ motors: { motorLeft: command, motorRight: command } });
const spinLeft = (duty: number): ActuatorTargets => ({ motors: { motorLeft: run(duty, -1), motorRight: run(duty, 1) } });

async function withWorld<T>(arena: ArenaInput, start: { xCm: number; yCm: number; yawDeg: number }, use: (world: World) => T, robotKit: Kit = kit): Promise<T> {
  const world = await createWorld({ arena: parseArena(arena), start, kit: robotKit, seed: 1 });
  try {
    return use(world);
  } finally {
    world.dispose();
  }
}

function steps(world: World, ticks: number, targets?: ActuatorTargets): void {
  for (let tick = 0; tick < ticks; tick++) {
    if (targets) world.applyActuators(targets);
    world.step(PHYSICS_DT_S);
  }
}

/** Every number of a JSON value, with its path. */
function numbers(value: unknown, path = ''): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => numbers(item, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => numbers(item, `${path}.${key}`));
  return [];
}

/** Whether a value and everything in it is frozen. */
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

describe('createWorld', () => {
  it('builds the arena and the robot, settled, at tick 0: the snapshot of the start', async () => {
    await withWorld(boxesArena as ArenaInput, { xCm: 30, yCm: 100, yawDeg: 0 }, (world) => {
      expect([world.tick, world.t]).toEqual([0, 0]);
      const snapshot = world.snapshot();
      expect(snapshot.t).toBe(0);
      // Settled on its supports (they sink a tenth of a millimetre), where it was put.
      expect(snapshot.robot.xCm).toBeCloseTo(30, 2);
      expect(snapshot.robot.yCm).toBeCloseTo(100, 2);
      expect(snapshot.robot.zCm).toBeLessThan(0);
      expect(snapshot.robot.zCm).toBeGreaterThan(-0.03);
      expect(snapshot.robot.yawDeg).toBeCloseTo(0, 2);
      expect(snapshot.robot.wheelRad).toEqual([0, 0]);
      expect(snapshot.robot.servoDeg.servo1).toBeCloseTo(0, 1);
      // The arena's moving bodies, in creation order: dynamic boxes, dynamic cylinders, objects.
      expect(snapshot.objects.map(({ id, kind }) => [id, kind])).toEqual([
        ['#box-1', 'box'],
        ['crate', 'object'],
        ['puck', 'object'],
      ]);
      expect(snapshot.sensors.map(({ role, kind }) => [role, kind])).toEqual([
        ['ultrasonic', 'ultrasonic'],
        ['lineLeft', 'line-sensor'],
        ['lineCenter', 'line-sensor'],
        ['lineRight', 'line-sensor'],
      ]);
      // What R3.6 fills in: the world alone has no pins, no lit LED, no block, no score.
      expect(snapshot).toMatchObject({ pins: [], leds: { led1: false }, activeBlockId: null, status: 'idle', outOfArena: false });
      expect(snapshot.score).toEqual({ points: 0, maxScore: null, goals: [] });
      expect(world.outOfArena).toBe(false);
    });
  });

  it('refuses a start where the robot overlaps the arena: a scenario error on `start` that names the thing', async () => {
    const arena = parseArena({ ...open(), walls: [{ id: 'front', fromCm: [108.3, 50], toCm: [108.3, 250] }] });
    const attempt = createWorld({ arena, start: { xCm: 100, yCm: 150, yawDeg: 0 }, kit, seed: 1 });
    await expect(attempt).rejects.toThrow(ScenarioError);
    await expect(attempt).rejects.toMatchObject({ issues: [{ path: 'start', message: 'the robot’s body overlaps walls[0] (front)' }] });
    await expect(attempt).rejects.toThrow('Invalid scenario: start: the robot’s body overlaps walls[0] (front)');
  });

  it('refuses a start where a servo arm would swing into something, at any angle it can turn to', async () => {
    // R3.3's servo, 4.5 cm ahead with a 6 cm arm: folded at rest, 3 cm past the body's front at 90°, where a box stands.
    const protruding: Kit = {
      ...kit,
      modules: kit.modules.map((module) =>
        module.role === 'servo1' ? { ...module, mount: { ...module.mount, posCm: [4.5, 0, 7] as const }, spec: { ...module.spec, armLengthCm: 6 } } : module,
      ),
    };
    const arena = parseArena({ ...open(), boxes: [{ id: 'post', centerCm: [110, 150], sizeCm: [5, 5, 10] }] });
    await expect(createWorld({ arena, start: { xCm: 100, yCm: 150, yawDeg: 0 }, kit: protruding, seed: 1 })).rejects.toMatchObject({
      issues: [{ path: 'start', message: 'the robot’s servo arm of servo1 (anywhere from 0° to 180°) overlaps boxes[0] (post)' }],
    });
    // The reference kit's arm stays inside the body: the same start is clear.
    const world = await createWorld({ arena, start: { xCm: 100, yCm: 150, yawDeg: 0 }, kit, seed: 1 });
    world.dispose();
  });

  it('refuses a seed that is not a whole number, a seed that is not the variant’s, and noise that is not a length of 0 or more', async () => {
    const arena = parseArena(open());
    const start = { xCm: 100, yCm: 100, yawDeg: 0 };
    await expect(createWorld({ arena, start, kit, seed: 1.5 })).rejects.toThrow(RangeError);
    const scenario = loadScenario(allGoalsScenario);
    const offsets = variantOffsets(scenario, 1, kitFootprintRadiusCm(kit));
    await expect(createWorld({ arena, start, kit, seed: offsets.seed + 1, variant: offsets })).rejects.toThrow(
      `The seed of variant 1 is ${offsets.seed}, not ${offsets.seed + 1}.`,
    );
    for (const ultrasonicNoiseCm of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(createWorld({ arena, start, kit, seed: 1, ultrasonicNoiseCm })).rejects.toThrow(RangeError);
    }
  });

  it('starts the clock after the settle: the arena’s moving bodies stand at t = 0 where the settle left them', async () => {
    // Two crates authored 2 cm into each other: the settle (60 steps before t = 0) pushes them apart, and t = 0 is after it.
    const arena: ArenaInput = {
      ...open(),
      objects: [
        { id: 'a', shape: 'box', centerCm: [200, 200], sizeCm: [10, 10, 10], massG: 100 },
        { id: 'b', shape: 'box', centerCm: [208, 200], sizeCm: [10, 10, 10], massG: 100 },
      ],
    };
    await withWorld(arena, { xCm: 50, yCm: 50, yawDeg: 0 }, (world) => {
      const [a, b] = world.snapshot().objects;
      expect(b!.pose.xCm - a!.pose.xCm).toBeGreaterThan(9.9);
      // One standing alone sinks no more than a tenth of a millimetre.
      expect(a!.pose.zCm).toBeGreaterThan(4.98);
    });
  });
});

describe('step', () => {
  it('takes fixed ticks of 1/120 s only, and counts them: t is tick / 120, never a sum of steps', async () => {
    await withWorld(open(), { xCm: 100, yCm: 100, yawDeg: 0 }, (world) => {
      for (const dt of [0.01, 1 / 60, 0, -PHYSICS_DT_S, Number.NaN]) {
        expect(() => world.step(dt)).toThrow(RangeError);
      }
      expect(world.tick).toBe(0);
      steps(world, 6);
      expect(world.tick).toBe(6);
      // Six steps added up are 0.05000000000000001 s; the world says 6 / 120.
      let sum = 0;
      for (let i = 0; i < 6; i++) sum += PHYSICS_DT_S;
      expect(sum).not.toBe(6 / 120);
      expect(world.t).toBe(6 / 120);
      expect(world.snapshot().t).toBe(6 / 120);
      steps(world, 114);
      expect([world.tick, world.t]).toEqual([120, 1]);
    });
  });

  it('moves the robot by the actuator targets, and refuses a bad one', async () => {
    await withWorld(open(), { xCm: 50, yCm: 150, yawDeg: 0 }, (world) => {
      steps(world, 120, both(run(255, 1)));
      expect(world.snapshot().robot.xCm - 50).toBeGreaterThan(30);
      expect(Math.abs(world.snapshot().robot.yCm - 150)).toBeLessThan(0.5);
      expect(world.snapshot().robot.wheelRad[0]).toBeGreaterThan(8);
      expect(() => world.applyActuators({ motors: { motorLeft: run(300, 1) } })).toThrow(RangeError);
      expect(() => world.applyActuators({ servos: { servo2: 10 } } as unknown as ActuatorTargets)).toThrow(RangeError);
    });
  });
});

describe('sense', () => {
  it('hears a wall with the ultrasonic where the kit mounts it, ahead of the body, at any heading', async () => {
    // The sensor is 7.5 cm ahead of the robot frame's origin (the body's front). A wall's face 50 cm ahead of it, then turned 90°.
    const arena: ArenaInput = {
      ...open(),
      walls: [
        { id: 'east', fromCm: [158.5, 0], toCm: [158.5, 300] },
        { id: 'north', fromCm: [0, 208.5], toCm: [300, 208.5] },
      ],
    };
    await withWorld(arena, { xCm: 100, yCm: 150, yawDeg: 0 }, (world) => {
      expect(world.sense.distanceCm('ultrasonic')).toBeCloseTo(50, 1);
      const echo = world.sense.ultrasonic('ultrasonic');
      expect(echo.hitId).toBe('east');
      expect(echo.echoUs).toBeCloseTo(echo.cm * 58, 6);
      expect(world.snapshot().sensors[0]).toEqual({ role: 'ultrasonic', kind: 'ultrasonic', cm: echo.cm, hitId: 'east' });
    });
    await withWorld(arena, { xCm: 100, yCm: 150, yawDeg: 90 }, (world) => {
      expect(world.sense.distanceCm('ultrasonic')).toBeCloseTo(50, 1);
      expect(world.sense.ultrasonic('ultrasonic').hitId).toBe('north');
    });
  });

  it('reads the floor under each line sensor: tape under the centre one, white under the two beside it', async () => {
    // The tape runs along y = 25 (2 cm wide); the line sensors are 7 cm ahead of the origin, 1.5 cm apart.
    await withWorld(lineLoopArena as ArenaInput, { xCm: 50, yCm: 25, yawDeg: 0 }, (world) => {
      expect(world.sense.groundReflectance('lineCenter')).toBe(0);
      expect(world.sense.groundReflectance('lineLeft')).toBe(1);
      expect(world.sense.groundReflectance('lineRight')).toBe(1);
      // The reference kit's line-digital ports are active-high: dark is HIGH, a high ADC value.
      expect(world.sense.line('lineCenter')).toEqual({ reflectance: 0, dark: true, raw: 1023, level: 1 });
      expect(world.sense.line('lineLeft')).toEqual({ reflectance: 1, dark: false, raw: 0, level: 0 });
      const center = world.snapshot().sensors.find((sensor) => sensor.role === 'lineCenter')!;
      expect(center).toMatchObject({ kind: 'line-sensor', reflectance: 0, dark: true });
      const spot = (center as Extract<RobotSnapshot['sensors'][number], { kind: 'line-sensor' }>).spotCm!;
      expect(spot[0]).toBeCloseTo(57, 2);
      expect(spot[1]).toBeCloseTo(25, 2);
    });
  });

  it('refuses a role the kit has no such sensor for', async () => {
    await withWorld(open(), { xCm: 100, yCm: 100, yawDeg: 0 }, (world) => {
      expect(() => world.sense.distanceCm('lineLeft')).toThrow('The kit has no ultrasonic sensor "lineLeft".');
      expect(() => world.sense.ultrasonic('nope')).toThrow(RangeError);
      expect(() => world.sense.groundReflectance('ultrasonic')).toThrow('The kit has no line sensor "ultrasonic".');
      expect(() => world.sense.line('lineMiddle')).toThrow(RangeError);
    });
  });

  it('lists what the robot touches, the floor included, with each thing’s kind and tags', async () => {
    const arena: ArenaInput = { ...open(), walls: [{ id: 'front', fromCm: [100, 50], toCm: [100, 250], tags: ['fence'] }] };
    await withWorld(arena, { xCm: 80, yCm: 150, yawDeg: 0 }, (world) => {
      expect(world.sense.contacts()).toEqual([{ otherId: '#ground', kind: 'ground', tags: ['ground'] }]);
      steps(world, 240, both(run(200, 1)));
      expect(world.sense.contacts()).toEqual([
        { otherId: '#ground', kind: 'ground', tags: ['ground'] },
        { otherId: 'front', kind: 'wall', tags: ['wall', 'fence'] },
      ]);
    });
  });

  it('measures once per tick: one readContacts call shared by the sense, the snapshot and the goal frame', async () => {
    const calls = vi.mocked(readContacts);
    calls.mockClear();
    await withWorld(boxesArena as ArenaInput, { xCm: 30, yCm: 100, yawDeg: 0 }, (world) => {
      expect(calls).toHaveBeenCalledTimes(1);
      for (let tick = 1; tick <= 5; tick++) {
        world.step(PHYSICS_DT_S);
        for (let read = 0; read < 3; read++) {
          world.sense.contacts();
          world.snapshot();
          world.frameExtras();
          world.sense.distanceCm('ultrasonic');
        }
        expect(calls).toHaveBeenCalledTimes(1 + tick);
      }
    });
  });

  it('draws the ultrasonic noise from the seed: one draw per tick, whoever reads it and however often', async () => {
    const arena = parseArena({ ...open(), walls: [{ id: 'east', fromCm: [158.5, 0], toCm: [158.5, 300] }] });
    const start = { xCm: 100, yCm: 150, yawDeg: 0 };
    const readings = async (seed: number, readsPerTick: number) => {
      const world = await createWorld({ arena, start, kit, seed, ultrasonicNoiseCm: 2 });
      const cms: number[] = [];
      for (let tick = 0; tick < 20; tick++) {
        for (let read = 0; read < readsPerTick; read++) cms.push(world.sense.distanceCm('ultrasonic'));
        world.step(PHYSICS_DT_S);
      }
      world.dispose();
      return cms.filter((_, i) => i % readsPerTick === 0);
    };
    const once = await readings(7, 1);
    expect(await readings(7, 3)).toEqual(once);
    expect(await readings(8, 1)).not.toEqual(once);
    expect(new Set(once).size).toBeGreaterThan(15);
    for (const cm of once) expect(Math.abs(cm - 50)).toBeLessThanOrEqual(2.01);
  });
});

describe('outOfArena', () => {
  it('latches: once the robot has been out of the arena, the world says so for the rest of the run', async () => {
    const answers = vi.mocked(isOutOfArena);
    await withWorld(open(), { xCm: 100, yCm: 100, yawDeg: 0 }, (world) => {
      expect(world.outOfArena).toBe(false);
      // The origin wobbles across the border (R3.4: a step with no hysteresis): out on one tick, in on the next.
      answers.mockReturnValueOnce(true).mockReturnValueOnce(false);
      const seen: boolean[] = [];
      for (let tick = 0; tick < 4; tick++) {
        world.step(PHYSICS_DT_S);
        seen.push(world.outOfArena, world.snapshot().outOfArena);
      }
      expect(seen).toEqual([true, true, true, true, true, true, true, true]);
    });
  });

  it('a robot driven off the arena is out of it from the tick it leaves on, and its poses stay finite', async () => {
    await withWorld(open([150, 100]), { xCm: 130, yCm: 50, yawDeg: 0 }, (world) => {
      const out: boolean[] = [];
      for (let tick = 0; tick < 600; tick++) {
        world.applyActuators(both(run(255, 1)));
        world.step(PHYSICS_DT_S);
        const snapshot = world.snapshot();
        out.push(snapshot.outOfArena);
        expect(numbers(snapshot).filter(([, value]) => !Number.isFinite(value))).toEqual([]);
      }
      const left = out.indexOf(true);
      expect(left).toBeGreaterThan(0);
      expect(out.slice(left).every(Boolean)).toBe(true);
      expect(world.snapshot().robot.zCm).toBeLessThan(-10);
    });
  });
});

describe('snapshot', () => {
  it('is frozen all through, the same object within a tick, a new one after each, and one already read never changes', async () => {
    await withWorld(boxesArena as ArenaInput, { xCm: 30, yCm: 100, yawDeg: 0 }, (world) => {
      steps(world, 30, both(run(200, 1)));
      const first = world.snapshot();
      expect(deeplyFrozen(first)).toBe(true);
      expect(world.snapshot()).toBe(first);
      const text = JSON.stringify(first);
      steps(world, 30, both(run(200, 1)));
      const second = world.snapshot();
      expect(second).not.toBe(first);
      expect(second.robot.xCm).toBeGreaterThan(first.robot.xCm);
      expect(JSON.stringify(first)).toBe(text);
      expect(() => {
        (first.robot as { xCm: number }).xCm = 0;
      }).toThrow(TypeError);
    });
  });

  it('is JSON: a round trip gives an equal snapshot and the same hash, and it holds no −0', async () => {
    await withWorld(boxesArena as ArenaInput, { xCm: 30, yCm: 100, yawDeg: 0 }, (world) => {
      // Drive into the puck (80, 100) and push it, so that every part of the snapshot has moved.
      steps(world, 240, { ...both(run(200, 1)), servos: { servo1: 120 } });
      const snapshot = world.snapshot();
      expect(snapshot.objects.find((object) => object.id === 'puck')!.pose.xCm).toBeGreaterThan(80.5);
      const copy = JSON.parse(JSON.stringify(snapshot)) as RobotSnapshot;
      expect(copy).toEqual(snapshot);
      expect(hashSnapshot(copy)).toBe(hashSnapshot(snapshot));
      expect(numbers(snapshot).filter(([, value]) => Object.is(value, -0))).toEqual([]);
    });
  });

  it('gives the poses in the arena frame: the robot’s point, height and yaw, and a rotation about +z for a turn', async () => {
    await withWorld(open(), { xCm: 120, yCm: 80, yawDeg: 90 }, (world) => {
      const { robot } = world.snapshot();
      expect(robot.yawDeg).toBeCloseTo(90, 2);
      // A yaw of 90° counter-clockwise from above: about the arena's +z by 90°, (0, 0, sin 45°, cos 45°).
      expect(robot.rotation.x).toBeCloseTo(0, 3);
      expect(robot.rotation.y).toBeCloseTo(0, 3);
      expect(robot.rotation.z).toBeCloseTo(Math.SQRT1_2, 3);
      expect(robot.rotation.w).toBeCloseTo(Math.SQRT1_2, 3);
      steps(world, 120, both(run(255, 1)));
      // Driving along its heading, +y on the arena.
      expect(world.snapshot().robot.yCm - 80).toBeGreaterThan(30);
      expect(Math.abs(world.snapshot().robot.xCm - 120)).toBeLessThan(0.5);
    });
  });
});

describe('frameExtras', () => {
  it('gives the speed the robot drives at (the middle of its wheel axle): 0 at rest, the axle’s speed straight, 0 spinning in place', async () => {
    /** The middle of the axle on the floor, 2 cm behind the robot frame's origin, from a snapshot. */
    const axleOf = (snapshot: RobotSnapshot) => {
      const q = snapshot.robot.rotation;
      const forward = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z)] as const;
      return [snapshot.robot.xCm - 2 * forward[0], snapshot.robot.yCm - 2 * forward[1]] as const;
    };
    const axleSpeed = (before: RobotSnapshot, after: RobotSnapshot) => {
      const [a, b] = [axleOf(before), axleOf(after)];
      return Math.hypot(b[0] - a[0], b[1] - a[1]) * 120;
    };
    await withWorld(open([400, 400]), { xCm: 100, yCm: 200, yawDeg: 0 }, (world) => {
      expect(world.frameExtras().speedCmS).toBeLessThan(0.01);
      steps(world, 120, both(run(255, 1)));
      // ref-uno-rover@0 runs free at 0.479 m/s at duty 255 (R3.3); straight, the speed is the axle's, unchanged.
      let before = world.snapshot();
      world.step(PHYSICS_DT_S);
      expect(world.frameExtras().speedCmS).toBeGreaterThan(45);
      expect(world.frameExtras().speedCmS).toBeLessThan(50);
      expect(world.frameExtras().speedCmS / axleSpeed(before, world.snapshot())).toBeCloseTo(1, 2);
      steps(world, 120, { motors: {} });
      // Spinning in place at full duty: the robot turns about a point within 0.6 cm of the axle's middle (measured), so its body
      // moves (the middle of the body 2 cm ahead circles at about 14 cm/s) but the robot drives nowhere.
      steps(world, 120, spinLeft(255));
      let fastest = 0;
      for (let tick = 0; tick < 240; tick++) {
        world.applyActuators(spinLeft(255));
        world.step(PHYSICS_DT_S);
        fastest = Math.max(fastest, world.frameExtras().speedCmS);
      }
      expect(fastest).toBe(0);
      // Pivoting about the left wheel (7.5 cm from the axle's middle) is driving, at the axle's speed less 1 cm × ω.
      steps(world, 120, { motors: { motorRight: run(200, 1) } });
      before = world.snapshot();
      world.applyActuators({ motors: { motorRight: run(200, 1) } });
      world.step(PHYSICS_DT_S);
      const ratio = world.frameExtras().speedCmS / axleSpeed(before, world.snapshot());
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(0.89);
    });
  });

  it('gives the outline of the robot on the floor where it stands, and the contacts of the tick', async () => {
    await withWorld(open(), { xCm: 100, yCm: 100, yawDeg: 0 }, (world) => {
      const extras = world.frameExtras();
      expect(extras.footprint.kind).toBe('polygon');
      const points = (extras.footprint as { pointsCm: readonly [number, number][] }).pointsCm;
      const outline = robotFootprint(kit).outlineCm;
      expect(points).toHaveLength(outline.length);
      points.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(100 + outline[i]![0], 2);
        expect(y).toBeCloseTo(100 + outline[i]![1], 2);
      });
      expect(extras.contacts).toBe(world.sense.contacts());
    });
  });
});

describe('dispose', () => {
  it('frees the physics: the world refuses every use after, and a second dispose does nothing', async () => {
    const world = await createWorld({ arena: parseArena(open()), start: { xCm: 100, yCm: 100, yawDeg: 0 }, kit, seed: 1 });
    world.dispose();
    world.dispose();
    expect(() => world.step(PHYSICS_DT_S)).toThrow('The world has been disposed.');
    expect(() => world.snapshot()).toThrow('The world has been disposed.');
    expect(() => world.sense.distanceCm('ultrasonic')).toThrow('The world has been disposed.');
    expect(() => world.applyActuators({})).toThrow('The world has been disposed.');
  });
});

describe('createScenarioWorld', () => {
  const scenario = loadScenario(allGoalsScenario);

  it('builds variant 0 at the scenario’s own start, and a jittered variant where applyVariant puts it, with the variant’s seed', async () => {
    const exact = await createScenarioWorld(scenario, kit, 0);
    try {
      expect(exact.variant).toEqual(variantOffsets(scenario, 0, kitFootprintRadiusCm(kit)));
      expect(exact.snapshot().robot.xCm).toBeCloseTo(scenario.start.xCm, 2);
      expect(exact.snapshot().robot.yCm).toBeCloseTo(scenario.start.yCm, 2);
    } finally {
      exact.dispose();
    }
    const offsets = variantOffsets(scenario, 1, kitFootprintRadiusCm(kit));
    const { start, arena } = applyVariant(scenario, offsets);
    expect(offsets.start.dxCm).not.toBe(0);
    const jittered = await createScenarioWorld(scenario, kit, 1);
    try {
      expect(jittered.variant).toEqual(offsets);
      expect(jittered.variant!.seed).toBe(variantSeed(scenario, 1));
      expect(jittered.arena).toEqual(arena);
      expect(jittered.snapshot().robot.xCm).toBeCloseTo(start.xCm, 2);
      expect(jittered.snapshot().robot.yCm).toBeCloseTo(start.yCm, 2);
      expect(jittered.snapshot().robot.yawDeg).toBeCloseTo(start.yawDeg, 1);
    } finally {
      jittered.dispose();
    }
  });

  it('refuses another kit than the scenario’s, a variant it does not have, and a start that overlaps, naming the scenario', async () => {
    await expect(createScenarioWorld(scenario, { ...kit, id: 'other-rover' }, 0)).rejects.toThrow('Scenario "rb-mini-mission" runs on the kit "ref-uno-rover", not "other-rover".');
    await expect(createScenarioWorld(scenario, kit, 3)).rejects.toThrow(RangeError);
    const blocked = { ...scenario, start: { xCm: 100, yCm: 32, yawDeg: 0 } };
    await expect(createScenarioWorld(blocked, kit, 0)).rejects.toThrow(/^Invalid scenario "rb-mini-mission": start: in variant 0, the robot’s .* overlap(s)? boxes\[0\] \(block\)$/);
  });
});
