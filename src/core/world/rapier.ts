import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';

// The physics engine of the robot world (N18 R3.1, ADR 0001 §5). This is the only place that loads
// Rapier: the bundle of a page without the robot lab never contains it (lazy `import()`), and nothing
// outside src/core/world may import it (B1, eslint.config.js).
//
// The world is SI inside (metres, kilograms, seconds), +Y up; arena JSON is in centimetres and degrees
// and is converted when it is built (units.ts, arena/build-arena.ts).
//
// Scene queries (`world.castRay` and the rest) only see what the broad phase knows, and Rapier 0.21 updates
// the broad phase only inside `world.step()`. Whoever creates colliders or moves bodies by hand calls
// `refreshQueries(world)` before the next sensor read (see there).

/** The Rapier namespace: the split .wasm package's, or anything with the same API (the -compat build). */
export type RapierModule = typeof RapierNamespace;
export type PhysicsWorld = RapierNamespace.World;
export type RigidBody = RapierNamespace.RigidBody;
export type Collider = RapierNamespace.Collider;
export type ColliderDesc = RapierNamespace.ColliderDesc;

/** Fixed physics rate (ADR 0001 §5.5): one `world.step()` per tick. */
export const PHYSICS_HZ = 120;
/** The tick length in seconds, `1 / PHYSICS_HZ`. Rapier keeps it as a float32. */
export const PHYSICS_DT_S = 1 / PHYSICS_HZ;
/**
 * Rapier's `lengthUnit` (ADR 0001 §4.2, §5.4): the typical dynamic object is about 10 cm, so the engine's
 * length tolerances (penetration, prediction distance, sleep threshold) are scaled by 0.1.
 */
export const LENGTH_UNIT = 0.1;
/** Constraint solver iterations per step (Rapier's default; ADR 0001 §5.4). */
export const SOLVER_ITERATIONS = 4;
/** Internal PGS iterations per solver iteration (Rapier's default; ADR 0001 §5.4). */
export const INTERNAL_PGS_ITERATIONS = 1;
/** Standard gravity, m/s², along −Y. */
export const GRAVITY_M_S2 = 9.81;

/**
 * Loads a Rapier build. The default is the split .wasm package, the app's (ADR 0001 §5.2). A plain Node
 * script, which cannot load that package, passes the -compat build instead (same wasm, same results):
 *
 *     await initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as RapierModule);
 *
 * `initPhysics` calls the build's `init()` when it has one (the -compat build does; the split one
 * instantiates its wasm while the module evaluates).
 */
export type RapierLoader = () => Promise<RapierModule>;

const loadSplitPackage: RapierLoader = () => import('@dimforge/rapier3d-deterministic');

let rapier: RapierModule | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads and initialises Rapier once per page (or process). Later calls, overlapping or not, return the
 * same promise and never load a second build; a later `loader` is ignored. A failed load can be retried.
 */
export function initPhysics(loader: RapierLoader = loadSplitPackage): Promise<void> {
  loading ??= (async () => {
    const module = await loader();
    const init = (module as { init?: unknown }).init;
    if (typeof init === 'function') {
      await (init as () => Promise<void>).call(module);
    }
    rapier = module;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Whether `initPhysics()` has finished, so `getRapier()` will not throw. */
export function isPhysicsReady(): boolean {
  return rapier !== null;
}

/** The loaded Rapier namespace. Throws until `initPhysics()` has finished. */
export function getRapier(): RapierModule {
  if (rapier === null) {
    throw new Error('initPhysics() has not finished: await it before building a world.');
  }
  return rapier;
}

/**
 * An empty physics world with the robot lab's integration parameters (ADR 0001 §5.4): gravity −Y,
 * `timestep = 1/120`, `lengthUnit = 0.1`, 4 solver and 1 internal PGS iterations. The caller owns it
 * and frees it with `world.free()`.
 */
export function createPhysicsWorld(): PhysicsWorld {
  const R = getRapier();
  const world = new R.World({ x: 0, y: -GRAVITY_M_S2, z: 0 });
  world.timestep = PHYSICS_DT_S;
  world.lengthUnit = LENGTH_UNIT;
  world.numSolverIterations = SOLVER_ITERATIONS;
  world.numInternalPgsIterations = INTERNAL_PGS_ITERATIONS;
  return world;
}

/**
 * Brings the scene queries (`world.castRay` and the other `world` queries) up to date with the colliders,
 * without advancing the simulation.
 *
 * Rapier 0.21 has no query update of its own (no `updateSceneQueries`, no query pipeline object):
 * `world.step()` alone updates the broad phase that every query walks, and
 * `propagateModifiedBodyPositionsToColliders()` does not. So a collider created, or a body moved by hand,
 * since the last step is invisible to a ray until the next step. The tick loop (plan §3) reads the sensors
 * before it steps, so tick 0 would read nothing.
 *
 * This runs a step with `timestep = 0`, twice. Collision detection and the broad phase run, nothing is integrated, and the
 * timestep is restored bit for bit. Measured (rapier.test.ts, build-arena.test.ts): poses and velocities are unchanged, and
 * the 600 ticks after an extra refresh are bit-identical, poses and velocities, to the 600 ticks without one.
 *
 * Why twice (N18 R3.3, rapier.test.ts): a collider created since the last step shows after one zero-length step, but a body
 * moved by hand (`setTranslation`, a reset) does not always. In a world of up to ~10 colliders it stays invisible to ray
 * casts, where it was and where it is, until a second one; with 100 or more, one is enough. Two always were (1 to 1000
 * colliders; dynamic and kinematic bodies, fixed colliders). Whoever moves bodies by hand calls
 * `world.propagateModifiedBodyPositionsToColliders()` and then this.
 *
 * Contact events: a refresh passes no event queue, so a pair that starts touching during it reports no start event later
 * (it is already touching). Refresh while a world is being built, before t = 0.
 */
export function refreshQueries(world: PhysicsWorld): void {
  const timestep = world.timestep;
  world.timestep = 0;
  try {
    world.step();
    world.step();
  } finally {
    world.timestep = timestep;
  }
}
