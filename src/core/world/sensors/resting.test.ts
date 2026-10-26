import { beforeAll, describe, expect, it } from 'vitest';
import { parseArena } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import { createPhysicsWorld, initPhysics, refreshQueries, type PhysicsWorld, type RigidBody } from '../rapier';
import { arenaToWorld } from '../units';
import { RESTING_GAP_M, RESTING_NORMAL_MIN_Y, restingOn } from './resting';

// N19 B4 (plan §4.4): what an arena object rests on, for the goal frame's `restingOn`: the colliders of its contact pairs (the narrow phase's)
// that it touches within 1 mm, measured where both are now, with the support's surface facing up there (the normal's y at least 0.7, 45.6°
// at most from level), sorted by id. Measured now, not read off the pair's manifold, which lags a step and freezes while a body sleeps
// (contacts.ts): a cube that has come to rest and fallen asleep still rests on what it rests on.

beforeAll(() => initPhysics(), 30_000);

const arenaInput = {
  ground: { sizeCm: [100, 100] as [number, number], color: '#ffffff' },
  walls: [{ id: 'wall', fromCm: [70, 10] as [number, number], toCm: [70, 90] as [number, number] }],
  objects: [
    { shape: 'box' as const, id: 'base', centerCm: [30, 50] as [number, number], sizeCm: [6, 6, 4] as [number, number, number], massG: 40 },
    { shape: 'box' as const, id: 'cube', centerCm: [50, 50] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], massG: 15 },
  ],
};

function withArena<T>(use: (world: PhysicsWorld, built: BuiltArena, body: (id: string) => RigidBody) => T): T {
  const world = createPhysicsWorld();
  try {
    const built = buildArena(world, parseArena(arenaInput));
    const body = (id: string) => built.dynamicBodies.find((dynamic) => dynamic.id === id)!.body;
    return use(world, built, body);
  } finally {
    world.free();
  }
}

const steps = (world: PhysicsWorld, n: number) => {
  for (let i = 0; i < n; i++) world.step();
};
const resting = (world: PhysicsWorld, built: BuiltArena, body: RigidBody) => restingOn(world, built, body.collider(0));

describe('restingOn (N19 B4)', () => {
  it('reads 0.7 and 1 mm', () => {
    expect([RESTING_NORMAL_MIN_Y, RESTING_GAP_M]).toEqual([0.7, 0.001]);
  });

  it('a cube resting on the base lists the base in restingOn; the base and a cube on the floor rest on the ground', () => {
    withArena((world, built, body) => {
      steps(world, 30);
      expect(resting(world, built, body('cube'))).toEqual(['#ground']);
      // Put the cube on the base: 4 cm up, a hair above its top, and let it settle until it sleeps.
      const top = arenaToWorld(30.5, 50.3, 4 + 2 + 0.05);
      body('cube').setTranslation(top, true);
      refreshQueries(world);
      let asleep = 0;
      for (let i = 0; i < 1200 && !body('cube').isSleeping(); i++) {
        world.step();
        asleep = i;
      }
      expect(body('cube').isSleeping()).toBe(true);
      expect(asleep).toBeGreaterThan(10);
      expect(resting(world, built, body('cube'))).toEqual(['base']);
      expect(resting(world, built, body('base'))).toEqual(['#ground']);
      // Asleep, it still rests on the base: two more seconds change nothing.
      steps(world, 240);
      expect(resting(world, built, body('cube'))).toEqual(['base']);
    });
  });

  it('lists a support within 1 mm, not one 1.5 mm below, nor a wall beside it', () => {
    withArena((world, built, body) => {
      steps(world, 30);
      const cube = body('cube');
      const at = (heightCm: number) => {
        cube.setTranslation(arenaToWorld(30, 50, 4 + 2 + heightCm), true);
        refreshQueries(world);
        return resting(world, built, cube);
      };
      expect(at(0.09)).toEqual(['base']);
      expect(at(0.15)).toEqual([]);
      // Touching the wall's face (x 69) with its side, on the floor: the wall's normal there is level.
      cube.setTranslation(arenaToWorld(69 - 2, 50, 2), true);
      refreshQueries(world);
      steps(world, 1);
      expect(resting(world, built, cube)).toEqual(['#ground']);
    });
  });

  it('sorts several supports by id, and leaves out what the lookup does not name', () => {
    const world = createPhysicsWorld();
    try {
      const built = buildArena(
        world,
        parseArena({
          ground: { sizeCm: [100, 100], color: '#ffffff' },
          objects: [
            { shape: 'box', id: 'zeta', centerCm: [30, 50], sizeCm: [6, 6, 4], massG: 40 },
            { shape: 'box', id: 'alpha', centerCm: [44, 50], sizeCm: [6, 6, 4], massG: 40 },
            { shape: 'box', id: 'plank', centerCm: [37, 80], sizeCm: [20, 4, 1], massG: 20 },
          ],
        }),
      );
      const plank = built.dynamicBodies.find((dynamic) => dynamic.id === 'plank')!.body;
      steps(world, 30);
      // Across both bases, a hair above their tops.
      plank.setTranslation(arenaToWorld(37, 50, 4 + 0.5 + 0.02), true);
      refreshQueries(world);
      steps(world, 60);
      expect(resting(world, built, plank)).toEqual(['alpha', 'zeta']);
      expect(restingOn(world, { infoOf: (collider) => (built.infoOf(collider)?.id === 'zeta' ? undefined : built.infoOf(collider)) }, plank.collider(0))).toEqual(['alpha']);
    } finally {
      world.free();
    }
  });
});
