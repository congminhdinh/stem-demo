import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';
import { createPhysicsWorld, getRapier, initPhysics, type Collider, type PhysicsWorld } from '../rapier';
import { parseArena, type Arena } from './arena-schema';
import { buildArena, type BuiltArena } from './build-arena';
import boxes from './fixtures/boxes.json';
import emptyWalled from './fixtures/empty-walled.json';

type RapierModule = typeof RapierNamespace;

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

function withArena<T>(arena: Arena, use: (built: BuiltArena, world: PhysicsWorld) => T): T {
  const world = createPhysicsWorld();
  try {
    return use(buildArena(world, arena), world);
  } finally {
    world.free();
  }
}

/** Rapier keeps float32: compare to 6 decimals (well under a micrometre). */
function expectVector(actual: { x: number; y: number; z: number } | null, expected: [number, number, number]) {
  expect(actual).not.toBeNull();
  expect([actual!.x, actual!.y, actual!.z].map((v) => Number(v.toFixed(6)))).toEqual(expected);
}

function collidersOf(built: BuiltArena, world: PhysicsWorld): Map<string, Collider> {
  const byId = new Map<string, Collider>();
  world.forEachCollider((collider) => {
    const info = built.infoOf(collider);
    if (info) byId.set(info.id, collider);
  });
  return byId;
}

describe('buildArena', () => {
  it('lays the ground with its top at y = 0 and the walls on it, in metres', () => {
    withArena(parseArena(emptyWalled), (built, world) => {
      const colliders = collidersOf(built, world);
      expect([...colliders.keys()]).toEqual(['#ground', '#wall-0', '#wall-1', '#wall-2', '#wall-3']);
      const ground = colliders.get('#ground')!;
      expectVector(ground.halfExtents(), [1, 0.025, 1]);
      expectVector(ground.translation(), [1, -0.025, -1]);
      // Wall 0 runs along arena x at y = 1 cm: 200 cm plus a 1 cm square end on each side, 10 cm high.
      const south = colliders.get('#wall-0')!;
      expectVector(south.halfExtents(), [1.01, 0.05, 0.01]);
      expectVector(south.translation(), [1, 0.05, -0.01]);
      // Wall 1 runs along arena +y at x = 199 cm: turned 90° about +Y.
      const east = colliders.get('#wall-1')!;
      expectVector(east.translation(), [1.99, 0.05, -1]);
      const q = east.rotation();
      expect([q.x, q.y, q.z, q.w].map((v) => Number(v.toFixed(6)))).toEqual([0, 0.707107, 0, 0.707107]);
      expect(built.dynamicBodies).toEqual([]);
      expect(ground.parent()?.handle).toBe(built.fixedBody.handle);
    });
  });

  it('builds the expected colliders with tags', () => {
    withArena(parseArena(boxes), (built) => {
      const infos = [...built.colliders.values()].map((info) => [info.id, info.kind, info.tags, info.ultrasonic, info.dynamic]);
      expect(infos).toEqual([
        ['#ground', 'ground', ['ground'], false, false],
        ['south', 'wall', ['wall'], true, false],
        ['#wall-1', 'wall', ['wall'], true, false],
        ['#wall-2', 'wall', ['wall'], true, false],
        ['#wall-3', 'wall', ['wall', 'west'], true, false],
        ['block', 'box', ['box', 'obstacle'], true, false],
        ['#box-1', 'box', ['box'], true, true],
        ['pole', 'cylinder', ['cylinder', 'obstacle'], false, false],
        ['crate', 'object', ['object'], true, true],
        ['puck', 'object', ['object', 'pushable'], true, true],
      ]);
    });
  });

  it('places boxes, cylinders and objects on the floor, turned and weighed as authored', () => {
    withArena(parseArena(boxes), (built, world) => {
      const colliders = collidersOf(built, world);
      const block = colliders.get('block')!;
      expectVector(block.halfExtents(), [0.1, 0.075, 0.05]);
      expectVector(block.translation(), [1, 0.075, -0.6]);
      const q = block.rotation(); // yaw 30°
      expect([q.x, q.y, q.z, q.w].map((v) => Number(v.toFixed(6)))).toEqual([0, 0.258819, 0, 0.965926]);
      const pole = colliders.get('pole')!;
      expect(pole.radius()).toBeCloseTo(0.01, 6);
      expect(pole.halfHeight()).toBeCloseTo(0.15, 6);
      expectVector(pole.translation(), [1.5, 0.15, -1]);

      expect(built.dynamicBodies.map(({ id, kind }) => [id, kind])).toEqual([
        ['#box-1', 'box'],
        ['crate', 'object'],
        ['puck', 'object'],
      ]);
      const [box, crate, puck] = built.dynamicBodies.map(({ body }) => body);
      expect(box!.isDynamic()).toBe(true);
      expect(box!.mass()).toBeCloseTo(0.1, 6);
      expect(crate!.mass()).toBeCloseTo(0.1, 6);
      expect(puck!.mass()).toBeCloseTo(0.05, 6);
      expectVector(crate!.translation(), [1.2, 0.05, -1.5]);
      expectVector(puck!.translation(), [0.8, 0.015, -1]);
      expect(colliders.get('puck')!.radius()).toBeCloseTo(0.04, 6);
    });
  });

  it('lets a sensor ray skip what does not echo, through the collider lookup', () => {
    withArena(parseArena(boxes), (built, world) => {
      world.step(); // colliders join the scene queries on the first step
      const R = getRapier();
      // From arena (150, 50) at 5 cm height, looking along arena +y (world −Z): the pole is 49 cm away.
      const ray = new R.Ray({ x: 1.5, y: 0.05, z: -0.5 }, { x: 0, y: 0, z: -1 });
      const any = world.castRay(ray, 5, true);
      expect(built.infoOf(any!.collider)?.id).toBe('pole');
      expect(any!.timeOfImpact).toBeCloseTo(0.49, 5);
      // An ultrasonic ray passes the thin pole and meets the north wall's inner face at y = 198 cm.
      const echo = world.castRay(ray, 5, true, undefined, undefined, undefined, undefined, (c) => built.infoOf(c)?.ultrasonic === true);
      expect(built.infoOf(echo!.collider)?.id).toBe('#wall-2');
      expect(echo!.timeOfImpact).toBeCloseTo(1.48, 5);
    });
  });

  it('knows nothing of colliders it did not create', () => {
    withArena(parseArena(emptyWalled), (built, world) => {
      const R = getRapier();
      const robot = world.createCollider(R.ColliderDesc.ball(0.05), world.createRigidBody(R.RigidBodyDesc.dynamic()));
      expect(built.infoOf(robot)).toBeUndefined();
    });
  });
});

/** World velocities (m/s) given to #box-1, crate and puck: the puck slides 65 cm into the pole, still at ~2 m/s. */
const PUSHES = [
  { x: 2.5, y: 0, z: 0 },
  { x: 0.5, y: 0, z: 1 },
  { x: 3, y: 0, z: 0 },
];

/** Builds the arena with boxes, sets every dynamic body moving and spinning, steps 120 ticks (1 s), returns every pose. */
function pushAndStep(create: () => PhysicsWorld, build: typeof buildArena): number[] {
  const world = create();
  try {
    const built = build(world, parseArena(boxes));
    built.dynamicBodies.forEach(({ body }, i) => {
      body.setLinvel(PUSHES[i]!, true);
      body.setAngvel({ x: 0, y: 3, z: 0 }, true);
    });
    for (let tick = 0; tick < 120; tick++) world.step();
    return built.dynamicBodies.flatMap(({ body }) => {
      const t = body.translation();
      const q = body.rotation();
      return [t.x, t.y, t.z, q.x, q.y, q.z, q.w];
    });
  } finally {
    world.free();
  }
}

describe('determinism smoke', () => {
  it('the same arena built twice gives identical poses after 120 ticks', () => {
    const first = pushAndStep(createPhysicsWorld, buildArena);
    const second = pushAndStep(createPhysicsWorld, buildArena);
    expect(second).toEqual(first);
    // Something happened. The puck (third body) slid into the pole and rests against it: 1.5 − 0.01 − 0.04 m.
    expect(first[14]!).toBeCloseTo(1.45, 3);
    // #box-1 (first body) would slide freely to x = 0.6 + 2.5² / (2 · 0.4 · 9.81) = 1.396 m; the crate stopped it.
    expect(first[0]!).toBeGreaterThan(1.1);
    expect(first[0]!).toBeLessThan(1.3);
  });

  it(
    'the -compat build (plain Node scripts) gives the same poses',
    async () => {
      vi.resetModules();
      const physics = await import('../rapier');
      const arena = await import('./build-arena');
      await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as RapierModule);
      expect(pushAndStep(physics.createPhysicsWorld, arena.buildArena)).toEqual(pushAndStep(createPhysicsWorld, buildArena));
    },
    30_000,
  );
});
