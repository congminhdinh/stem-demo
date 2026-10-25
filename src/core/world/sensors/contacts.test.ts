import { beforeAll, describe, expect, it } from 'vitest';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import { createPhysicsWorld, getRapier, initPhysics, refreshQueries, type Collider, type PhysicsWorld, type RigidBody } from '../rapier';
import type { ColliderLookup, SensedCollider } from './collider-lookup';
import { CONTACT_GAP_M, readContacts } from './contacts';

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

/**
 * A 200 × 200 cm floor with, in this creation order: a wall "zeta" whose west face is x = 99, a wall "alpha" whose
 * south face is y = 99, and a fixed 10 cm box "mid" whose east face is x = 89 (it spans y 89..99).
 */
const corner: ArenaInput = {
  ground: { sizeCm: [200, 200], color: '#ffffff' },
  walls: [
    { id: 'zeta', fromCm: [100, 0], toCm: [100, 200] },
    { id: 'alpha', fromCm: [0, 100], toCm: [200, 100] },
  ],
  boxes: [{ id: 'mid', centerCm: [84, 94], sizeCm: [10, 10, 10] }],
};

function withWorld<T>(arena: ArenaInput, use: (world: PhysicsWorld, built: BuiltArena) => T): T {
  const world = createPhysicsWorld();
  try {
    return use(world, buildArena(world, parseArena(arena)));
  } finally {
    world.free();
  }
}

/** A dynamic 10 cm cube standing on the floor with its centre at arena (xCm, yCm): a stand-in for the robot. */
function cubeAt(world: PhysicsWorld, xCm: number, yCm: number): RigidBody {
  const R = getRapier();
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(xCm / 100, 0.05, -yCm / 100));
  world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05), body);
  return body;
}

const ids = (contacts: readonly SensedCollider[]) => contacts.map((contact) => contact.id);

describe('readContacts', () => {
  it('contact present at spawn: before any step, from the pair state a refresh leaves', () => {
    withWorld(corner, (world, built) => {
      // The cube fills x 89..99 and y 89..99: it touches mid, zeta, alpha and the floor, all at a gap of 0.
      const robot = cubeAt(world, 94, 94);
      refreshQueries(world);
      const contacts = readContacts(world, built, [robot]);
      expect(ids(contacts)).toEqual(['#ground', 'alpha', 'mid', 'zeta']);
      expect(contacts.map((contact) => contact.tags)).toEqual([['ground'], ['wall'], ['box'], ['wall']]);
    });
  });

  it('lists each collider once, in a fixed order by id, whatever the order of creation, colliders or bodies', () => {
    withWorld(corner, (world, built) => {
      const R = getRapier();
      // Two bodies, each of two colliders, all four touching the floor; the second body also touches zeta and alpha.
      const first = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.4, 0.05, -0.4));
      world.createCollider(R.ColliderDesc.cuboid(0.02, 0.05, 0.05).setTranslation(0.03, 0, 0), first);
      world.createCollider(R.ColliderDesc.cuboid(0.02, 0.05, 0.05).setTranslation(-0.03, 0, 0), first);
      const second = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.94, 0.05, -0.94));
      world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.025).setTranslation(0, 0, 0.025), second);
      world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.025).setTranslation(0, 0, -0.025), second);
      refreshQueries(world);
      const expected = ['#ground', 'alpha', 'mid', 'zeta'];
      expect(ids(readContacts(world, built, [first, second]))).toEqual(expected);
      expect(ids(readContacts(world, built, [second, first]))).toEqual(expected);
      // A second of simulated time later the cube still stands in its corner: same contacts, same order.
      for (let tick = 0; tick < 120; tick++) world.step();
      expect(ids(readContacts(world, built, [second, first]))).toEqual(expected);
      expect(readContacts(world, built, [first, second])).toEqual(readContacts(world, built, [first, second]));
    });
  });

  it('counts a pair as touching within 1 mm, not a pair the narrow phase merely keeps', () => {
    expect(CONTACT_GAP_M).toBe(0.001);
    // The cube's east face is 0.5 mm, then 1.5 mm, from zeta's face (x = 99 cm); the narrow phase keeps both pairs.
    for (const [gapMm, touching] of [
      [0.5, true],
      [1.5, false],
    ] as const) {
      withWorld(corner, (world, built) => {
        const robot = cubeAt(world, 94 - gapMm / 10, 50);
        refreshQueries(world);
        const pairs: string[] = [];
        world.contactPairsWith(robot.collider(0), (other) => pairs.push(built.infoOf(other)?.id ?? '?'));
        expect(pairs.sort()).toEqual(['#ground', 'zeta']);
        expect(ids(readContacts(world, built, [robot]))).toEqual(touching ? ['#ground', 'zeta'] : ['#ground']);
      });
    }
  });

  it('measures where the bodies are now, not where the narrow phase last saw them: a body asleep on the floor touches it', () => {
    withWorld(corner, (world, built) => {
      // Dropped from 5 mm, the cube lands and falls asleep. Its manifold with the floor was computed at the start of the
      // step it landed in, 1.7 mm up (measured), and is never updated while it sleeps.
      const R = getRapier();
      const cube = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.5, 0.055, -0.5));
      const collider = world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05), cube);
      for (let tick = 0; tick < 300; tick++) world.step();
      expect(cube.isSleeping()).toBe(true);
      expect(cube.translation().y).toBeLessThan(0.05);
      let manifoldDist = Number.NaN;
      world.contactPairsWith(collider, (other) => world.contactPair(collider, other, (manifold) => (manifoldDist = manifold.contactDist(0))));
      expect(manifoldDist).toBeGreaterThan(CONTACT_GAP_M);
      expect(ids(readContacts(world, built, [cube]))).toEqual(['#ground']);
    });
  });

  it('reports a wall on the tick a body sliding into it arrives, not one step later', () => {
    withWorld(corner, (world, built) => {
      const R = getRapier();
      // A frictionless cube 1 cm from zeta's face, sliding towards it at 0.5 m/s: it arrives within 3 ticks.
      const cube = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.93, 0.05, -0.5).setLinvel(0.5, 0, 0));
      world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05).setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min), cube);
      refreshQueries(world);
      const seen: [number, boolean][] = [];
      for (let tick = 1; tick <= 12; tick++) {
        world.step();
        const gapM = 0.99 - (cube.translation().x + 0.05);
        seen.push([Number((gapM * 1000).toFixed(1)), ids(readContacts(world, built, [cube])).includes('zeta')]);
      }
      // Within 1 mm (or into the wall) is touching, on that very tick.
      expect(seen.every(([gapMm, touching]) => touching === gapMm <= 1)).toBe(true);
      expect(seen.slice(0, 2).map(([, touching]) => touching)).toEqual([false, false]);
      expect(seen.at(-1)![1]).toBe(true);
    });
  });

  it('never reports the robot’s own parts, nor a collider the lookup does not name', () => {
    withWorld(corner, (world, built) => {
      const R = getRapier();
      const chassis = cubeAt(world, 50, 50);
      // An arm resting against the chassis' east face, and a stray cube the arena does not know against its west face.
      const arm = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.56, 0.05, -0.5));
      const armCollider = world.createCollider(R.ColliderDesc.cuboid(0.01, 0.05, 0.02), arm);
      const stray = cubeAt(world, 40, 50);
      refreshQueries(world);
      const named = new Map<number, SensedCollider>([
        [chassis.collider(0).handle, { id: 'robot-chassis', tags: ['robot'], ultrasonic: false }],
        [armCollider.handle, { id: 'robot-arm', tags: ['robot'], ultrasonic: false }],
      ]);
      const lookup: ColliderLookup = { infoOf: (collider: Collider) => named.get(collider.handle) ?? built.infoOf(collider) };
      expect(ids(readContacts(world, lookup, [chassis, arm]))).toEqual(['#ground']);
      // Seen from the arm alone, the chassis is just another collider it touches.
      expect(ids(readContacts(world, lookup, [arm]))).toEqual(['#ground', 'robot-chassis']);
      expect(ids(readContacts(world, built, [stray]))).toEqual(['#ground']);
    });
  });

  it('reads nothing for a robot with no bodies or in the air', () => {
    withWorld(corner, (world, built) => {
      const R = getRapier();
      const flying = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.5, 1, -0.5));
      world.createCollider(R.ColliderDesc.ball(0.05), flying);
      refreshQueries(world);
      expect(readContacts(world, built, [])).toEqual([]);
      expect(readContacts(world, built, [flying])).toEqual([]);
    });
  });
});
