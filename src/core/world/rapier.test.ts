import { describe, expect, it, vi } from 'vitest';
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';

type RapierFile = typeof import('./rapier');
type RapierModule = typeof RapierNamespace;

// Each test gets a fresh copy of rapier.ts, so the module-level "loaded" state starts empty.
async function freshRapierFile(): Promise<RapierFile> {
  vi.resetModules();
  return import('./rapier');
}

/** Stands in for a Rapier build where only the loading rules matter (no 3 MB wasm to compile). */
function stubBuild(extra: object = {}): RapierModule {
  return { version: () => 'stub', ...extra } as unknown as RapierModule;
}

// Compiling the real wasm can take seconds on a loaded machine; those tests get room for it.
const WASM_TIMEOUT_MS = 30_000;

describe('initPhysics', () => {
  it('initPhysics twice is no-op', async () => {
    const physics = await freshRapierFile();
    const loader = vi.fn(async () => stubBuild());
    await physics.initPhysics(loader);
    const first = physics.getRapier();
    await physics.initPhysics(loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(physics.getRapier()).toBe(first);
  });

  it('loads the module once when two calls overlap, and ignores a later loader', async () => {
    const physics = await freshRapierFile();
    const loader = vi.fn(async () => stubBuild());
    const other = vi.fn(async () => stubBuild());
    await Promise.all([physics.initPhysics(loader), physics.initPhysics(loader), physics.initPhysics(other)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('refuses to hand out Rapier before initPhysics has finished', async () => {
    const physics = await freshRapierFile();
    expect(physics.isPhysicsReady()).toBe(false);
    expect(() => physics.getRapier()).toThrow('initPhysics() has not finished');
  });

  it('can retry after a failed load', async () => {
    const physics = await freshRapierFile();
    await expect(physics.initPhysics(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(physics.isPhysicsReady()).toBe(false);
    await physics.initPhysics(async () => stubBuild());
    expect(physics.isPhysicsReady()).toBe(true);
  });

  it('awaits the init() of a build that has one before it counts as ready', async () => {
    const physics = await freshRapierFile();
    const order: string[] = [];
    const init = vi.fn(async () => {
      order.push('init');
    });
    await physics.initPhysics(async () => stubBuild({ init }));
    order.push('ready');
    expect(init).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['init', 'ready']);
  });

  it(
    'loads the split .wasm package by default, Rapier 0.21.0',
    async () => {
      const physics = await freshRapierFile();
      await physics.initPhysics();
      expect(physics.isPhysicsReady()).toBe(true);
      expect(physics.getRapier().version()).toBe('0.21.0');
    },
    WASM_TIMEOUT_MS,
  );

  it(
    'runs the injected -compat build (plain Node scripts)',
    async () => {
      const physics = await freshRapierFile();
      await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as RapierModule);
      expect(physics.getRapier().version()).toBe('0.21.0');
      const world = physics.createPhysicsWorld();
      world.free();
    },
    WASM_TIMEOUT_MS,
  );
});

describe('createPhysicsWorld', () => {
  it(
    'applies the ADR 0001 integration parameters',
    async () => {
      const physics = await freshRapierFile();
      await physics.initPhysics();
      const world = physics.createPhysicsWorld();
      try {
        expect(physics.PHYSICS_HZ).toBe(120);
        expect(physics.PHYSICS_DT_S).toBe(1 / 120);
        // Rapier keeps its parameters as float32.
        expect(world.timestep).toBe(Math.fround(1 / 120));
        expect(world.lengthUnit).toBe(Math.fround(0.1));
        expect(world.numSolverIterations).toBe(4);
        expect(world.numInternalPgsIterations).toBe(1);
        expect(world.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
      } finally {
        world.free();
      }
    },
    WASM_TIMEOUT_MS,
  );
});

describe('refreshQueries', () => {
  it(
    'makes a new collider visible to scene queries without a step, moving nothing and keeping the timestep',
    async () => {
      const physics = await freshRapierFile();
      await physics.initPhysics();
      const R = physics.getRapier();
      const world = physics.createPhysicsWorld();
      try {
        world.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1).setTranslation(1, 0, 0));
        const ball = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0));
        world.createCollider(R.ColliderDesc.ball(0.05), ball);
        const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
        // Rapier 0.21 updates its broad phase only inside step(): a fresh collider is invisible to a ray.
        expect(world.castRay(ray, 5, true)).toBeNull();
        physics.refreshQueries(world);
        expect(world.castRay(ray, 5, true)?.timeOfImpact).toBeCloseTo(0.9, 6);
        expect(world.timestep).toBe(Math.fround(1 / 120));
        // timestep 0: gravity has not acted yet.
        expect(ball.translation()).toEqual({ x: 0, y: 0.5, z: 0 });
        expect(ball.linvel()).toEqual({ x: 0, y: 0, z: 0 });
      } finally {
        world.free();
      }
    },
    WASM_TIMEOUT_MS,
  );

  it(
    'makes a body moved by hand visible where it now is and gone from where it was, in a world of few colliders as of many',
    async () => {
      const physics = await freshRapierFile();
      await physics.initPhysics();
      const R = physics.getRapier();
      // N18 R3.3, measured: after a body is moved by hand, one zero-length step brings it back to ray casts in a world of 100
      // or more colliders, but only a second one does in a world of up to ~10 (Rapier 0.21's BVH); with one, the body is
      // invisible both where it was and where it is.
      for (const statics of [0, 3, 10, 100]) {
        const world = physics.createPhysicsWorld();
        try {
          const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
          for (let i = 0; i < statics; i++) {
            world.createCollider(R.ColliderDesc.cuboid(0.01, 0.01, 0.01).setTranslation(i * 0.05, -1, -2), fixed);
          }
          const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setGravityScale(0));
          world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05), body);
          for (let tick = 0; tick < 10; tick++) world.step();
          const seen = (x: number) => world.castRay(new R.Ray({ x, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }), 5, true) !== null;
          expect(seen(0)).toBe(true);
          body.setTranslation({ x: 2, y: 0, z: 0 }, true);
          world.propagateModifiedBodyPositionsToColliders();
          physics.refreshQueries(world);
          expect([seen(0), seen(2)], `${statics} other colliders`).toEqual([false, true]);
          expect(body.translation()).toEqual({ x: 2, y: 0, z: 0 });
        } finally {
          world.free();
        }
      }
    },
    WASM_TIMEOUT_MS,
  );
});
