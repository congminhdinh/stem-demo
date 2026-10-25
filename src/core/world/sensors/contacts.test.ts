import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import boxes from '../arena/fixtures/boxes.json';
import { createPhysicsWorld, getRapier, initPhysics, refreshQueries, type Collider, type PhysicsWorld, type RigidBody } from '../rapier';
import { assembleRobot, stepWorld } from '../robot/assembly';
import { rotateVector } from '../units';
import type { ColliderLookup, SensedCollider } from './collider-lookup';
import { CONTACT_GAP_M, readContacts } from './contacts';
import { threadCpuMs } from '../__fixtures__/cpu-time';

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

  /** How far a cuboid collider's foremost corner (largest world x) is from the plane x = faceM, m: geometry only. */
  const gapToPlaneX = (collider: Collider, faceM: number) => {
    const t = collider.translation();
    const q = collider.rotation();
    const h = collider.halfExtents();
    if (h === null) throw new Error('gapToPlaneX measures a cuboid');
    let front = Number.NEGATIVE_INFINITY;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      front = Math.max(front, t.x + rotateVector(q, { x: sx * h.x, y: sy * h.y, z: sz * h.z }).x);
    }
    return faceM - front;
  };
  /**
   * Steps a body (or the robot, through `step`) towards zeta's face, x = 0.99 m, and checks every tick, the start included,
   * that zeta is a contact exactly when the gap is within CONTACT_GAP_M. Returns the gaps (mm) of the first touching tick.
   */
  const checkArrival = (world: PhysicsWorld, built: BuiltArena, bodies: readonly RigidBody[], front: Collider, step: () => void) => {
    let arrivalMm = Number.NaN;
    for (let tick = 0; tick <= 12; tick++) {
      if (tick > 0) step();
      const gapM = gapToPlaneX(front, 0.99);
      const touching = ids(readContacts(world, built, bodies)).includes('zeta');
      // Ticks within 0.01 mm of the threshold could go either way on rounding; none occur in these runs.
      if (Math.abs(gapM - CONTACT_GAP_M) > 1e-5) expect([tick, gapM, touching]).toEqual([tick, gapM, gapM <= CONTACT_GAP_M]);
      if (Number.isNaN(arrivalMm) && touching) arrivalMm = gapM * 1000;
    }
    return arrivalMm;
  };

  it('reports a wall on the tick a cube arrives at 0.25 to 1 m/s from 0 to 12 mm away, not a tick later', () => {
    const R = getRapier();
    for (const speed of [0.25, 0.5, 0.6, 1]) {
      for (let gapMm = 0; gapMm <= 12; gapMm++) {
        withWorld(corner, (world, built) => {
          const cube = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.94 - gapMm / 1000, 0.05, -0.5).setLinvel(speed, 0, 0));
          const collider = world.createCollider(
            R.ColliderDesc.cuboid(0.05, 0.05, 0.05).setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min),
            cube,
          );
          refreshQueries(world);
          const arrivalMm = checkArrival(world, built, [cube], collider, () => world.step());
          expect([speed, gapMm, arrivalMm <= 1]).toEqual([speed, gapMm, true]);
        });
      }
    }
  });

  it('reports a wall on the tick the reference rover arrives at 0.6 m/s from 0 to 12 mm away', () => {
    const kit = productionKits.get(referenceKitRef) as Kit;
    const full = { duty: 255, dir: 1 as const, brake: false };
    for (let gapMm = 0; gapMm <= 12; gapMm++) {
      withWorld(corner, (world, built) => {
        // The body box is 15 cm long, centred on the robot frame's origin: its front face is 7.5 cm ahead of it.
        const robot = assembleRobot(world, kit, { xCm: 99 - 7.5 - gapMm / 10, yCm: 50, yawDeg: 0 });
        const box = robot.chassis.collider(0);
        expect(box.halfExtents()).toEqual({ x: expect.closeTo(0.075, 6), y: expect.closeTo(0.025, 6), z: expect.closeTo(0.06, 6) });
        robot.applyActuators({ motors: { motorLeft: full, motorRight: full } });
        robot.chassis.setLinvel({ x: 0.6, y: 0, z: 0 }, true);
        const arrivalMm = checkArrival(world, built, robot.bodies, box, () => stepWorld(world, robot));
        expect([gapMm, arrivalMm <= 1]).toEqual([gapMm, true]);
      });
    }
  });

  it('reports a box 0.05 mm into a wall that contactCollider misses: when it finds no contact, an intersection test decides', () => {
    withWorld(corner, (world, built) => {
      // The reference rover's body box on the 7th tick of driving into zeta from 3 mm at 0.6 m/s (measured in R3.5): its front
      // corner is 0.054 mm into the wall. From the box, Rapier 0.21's contactCollider finds no contact at all, even with a 1 cm
      // prediction; from the wall, the same pair is −0.054 mm.
      const R = getRapier();
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(0.9149761199951172, 0.03989134728908539, -0.49998778104782104)
          .setRotation({ x: 0.000026017691197921522, y: -0.0002131032815668732, z: 0.0010453163413330913, w: 0.9999994039535522 }),
      );
      const box = world.createCollider(R.ColliderDesc.cuboid(0.075, 0.025, 0.06), body);
      refreshQueries(world);
      const zeta = colliderNamed(world, built, 'zeta');
      expect(gapToPlaneX(box, 0.99)).toBeCloseTo(-0.000054, 6);
      expect(box.contactCollider(zeta, CONTACT_GAP_M)).toBeNull();
      expect(zeta.contactCollider(box, CONTACT_GAP_M)?.distance).toBeCloseTo(-0.000054, 6);
      // The body box rides at the chassis' clearance, 1.5 cm over the floor.
      expect(ids(readContacts(world, built, [body]))).toEqual(['zeta']);
    });
  });

  it('reads nothing, and never throws, for a body whose pose is not finite', () => {
    withWorld(corner, (world, built) => {
      const cube = cubeAt(world, 94, 94);
      refreshQueries(world);
      expect(ids(readContacts(world, built, [cube]))).toEqual(['#ground', 'alpha', 'mid', 'zeta']);
      cube.setTranslation({ x: Number.NaN, y: 0.05, z: -0.94 }, false);
      expect(readContacts(world, built, [cube])).toEqual([]);
      world.propagateModifiedBodyPositionsToColliders();
      expect(readContacts(world, built, [cube])).toEqual([]);
      cube.setTranslation({ x: 0.94, y: 0.05, z: -0.94 }, false);
      cube.setRotation({ x: 0, y: Number.POSITIVE_INFINITY, z: 0, w: 1 }, false);
      world.propagateModifiedBodyPositionsToColliders();
      expect(readContacts(world, built, [cube])).toEqual([]);
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

  it('costs a few tens of microseconds per call for the reference rover in the arena with boxes', () => {
    const kit = productionKits.get(referenceKitRef) as Kit;
    withWorld(boxes as ArenaInput, (world, built) => {
      // Against the west wall (inner face x = 2 cm), on the floor: two contacts to confirm, more candidates to reject.
      const robot = assembleRobot(world, kit, { xCm: 9.5, yCm: 100, yawDeg: 180 });
      expect(ids(readContacts(world, built, robot.bodies))).toEqual(['#ground', '#wall-3']);
      for (let i = 0; i < 200; i++) readContacts(world, built, robot.bodies);
      const count = 2000;
      // CPU time of this thread, so that other processes on a loaded machine (parallel test workers, a build) do not count.
      const started = threadCpuMs();
      for (let i = 0; i < count; i++) readContacts(world, built, robot.bodies);
      const usPerCall = ((threadCpuMs() - started) * 1000) / count;
      console.info(`readContacts: ${usPerCall.toFixed(2)} µs of CPU per call (${count} calls, reference rover, boxes arena)`);
      expect(usPerCall).toBeLessThan(100);
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

function colliderNamed(world: PhysicsWorld, built: BuiltArena, id: string): Collider {
  let found: Collider | undefined;
  world.forEachCollider((collider) => {
    if (built.infoOf(collider)?.id === id) found = collider;
  });
  if (!found) throw new Error(`no collider ${id}`);
  return found;
}
