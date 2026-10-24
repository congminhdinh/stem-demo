import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';

type RapierFile = typeof import('./rapier');
type RapierModule = typeof RapierNamespace;

// Each test gets a fresh copy of rapier.ts, so the module-level "loaded" state starts empty.
async function freshRapierFile(): Promise<RapierFile> {
  vi.resetModules();
  return import('./rapier');
}

const loadSplit = (): Promise<RapierModule> => import('@dimforge/rapier3d-deterministic');

describe('initPhysics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initPhysics twice is no-op', async () => {
    const physics = await freshRapierFile();
    const loader = vi.fn(loadSplit);
    await physics.initPhysics(loader);
    const first = physics.getRapier();
    await physics.initPhysics(loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(physics.getRapier()).toBe(first);
  });

  it('loads the module once when two calls overlap', async () => {
    const physics = await freshRapierFile();
    const loader = vi.fn(loadSplit);
    await Promise.all([physics.initPhysics(loader), physics.initPhysics(loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loads the split .wasm package by default, Rapier 0.21.0', async () => {
    const physics = await freshRapierFile();
    expect(physics.isPhysicsReady()).toBe(false);
    await physics.initPhysics();
    expect(physics.isPhysicsReady()).toBe(true);
    expect(physics.getRapier().version()).toBe('0.21.0');
  });

  it('refuses to hand out Rapier before initPhysics has finished', async () => {
    const physics = await freshRapierFile();
    expect(() => physics.getRapier()).toThrow('initPhysics() has not finished');
  });

  it('can retry after a failed load', async () => {
    const physics = await freshRapierFile();
    await expect(physics.initPhysics(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(physics.isPhysicsReady()).toBe(false);
    await physics.initPhysics(loadSplit);
    expect(physics.isPhysicsReady()).toBe(true);
  });

  it('calls init() of an injected build that has one (the -compat package for plain Node scripts)', async () => {
    const physics = await freshRapierFile();
    const compat = await import('@dimforge/rapier3d-deterministic-compat');
    const init = vi.fn(compat.init);
    await physics.initPhysics(async () => ({ ...compat, init }) as unknown as RapierModule);
    expect(init).toHaveBeenCalledTimes(1);
    expect(physics.getRapier().version()).toBe('0.21.0');
  });
});

describe('createPhysicsWorld', () => {
  it('applies the ADR 0001 integration parameters', async () => {
    const physics = await freshRapierFile();
    await physics.initPhysics();
    const world = physics.createPhysicsWorld();
    try {
      expect(physics.PHYSICS_HZ).toBe(120);
      expect(world.timestep).toBe(Math.fround(1 / 120));
      expect(world.lengthUnit).toBe(Math.fround(0.1));
      expect(world.numSolverIterations).toBe(4);
      expect(world.numInternalPgsIterations).toBe(1);
      expect(world.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
    } finally {
      world.free();
    }
  });
});
