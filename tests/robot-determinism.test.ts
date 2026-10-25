import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';
import { productionKits, referenceKitRef } from '../src/core/hardware/catalog';
import type { Kit } from '../src/core/hardware/kit';
import { parseArena } from '../src/core/world/arena/arena-schema';
import emptyWalled from '../src/core/world/arena/fixtures/empty-walled.json';
import { initPhysics } from '../src/core/world/rapier';
import { ROBOT_ENGINE_VERSION } from '../src/core/world/snapshot';
import { createWorld } from '../src/core/world/world';
import { DETERMINISM_TICKS, determinismFixtures, runFixture, type FixtureHashes } from './robot-determinism.fixtures';

// N18 R3.5 (robot plan §5): the same project, scenario@version, seed and engine@version give the same snapshot hash. Here on Node,
// twice and with both Rapier builds; e2e/robot-determinism.spec.ts computes the same fixtures in Chromium, Firefox and WebKit against
// the same golden file, so the four runtimes agree.
//
// The golden hashes are ROBOT_ENGINE_VERSION's. A change that moves one (physics, robot, sensors, what a snapshot holds) is a new
// engine: bump ROBOT_ENGINE_VERSION and this file's engineVersion together, with the new hashes.

const goldenPath = join(import.meta.dirname, '__snapshots__', 'robot-determinism.json');
type Golden = { engineVersion: number; ticks: number; fixtures: Record<string, FixtureHashes> };
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden;
const kit = productionKits.get(referenceKitRef) as Kit;

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

describe('robot world determinism', () => {
  it('pins this engine version’s hashes, for every fixture and the tick count they run', () => {
    expect(golden.engineVersion).toBe(ROBOT_ENGINE_VERSION);
    expect(golden.ticks).toBe(DETERMINISM_TICKS);
    expect(Object.keys(golden.fixtures)).toEqual(determinismFixtures.map((fixture) => fixture.name));
  });

  it.each(determinismFixtures.map((fixture) => [fixture.name, fixture] as const))(
    'same seed twice → identical hash after 3000 ticks: %s',
    async (name, fixture) => {
      const first = await runFixture(fixture);
      expect(await runFixture(fixture)).toEqual(first);
      expect(first).toEqual(golden.fixtures[name]);
    },
    60_000,
  );

  it(
    'the -compat build (plain Node scripts) gives the same hashes',
    async () => {
      vi.resetModules();
      const physics = await import('../src/core/world/rapier');
      const fresh = await import('./robot-determinism.fixtures');
      await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as typeof RapierNamespace);
      for (const fixture of fresh.determinismFixtures) {
        expect([fixture.name, await fresh.runFixture(fixture)]).toEqual([fixture.name, golden.fixtures[fixture.name]]);
      }
    },
    120_000,
  );

  it('another seed changes a run with ultrasonic noise, and nothing in a run without it', async () => {
    // The obstacle avoider of mini-mission-v1-noise in the walled arena: it turns away from walls by what the ultrasonic reads.
    const avoider = determinismFixtures.find((fixture) => fixture.name === 'mini-mission-v1-noise')!.controller;
    const inWalls = (seed: number, ultrasonicNoiseCm: number) => ({
      name: `avoider seed ${seed}, noise ${ultrasonicNoiseCm}`,
      make: () => createWorld({ arena: parseArena(emptyWalled), start: { xCm: 100, yCm: 100, yawDeg: 20 }, kit, seed, ultrasonicNoiseCm }),
      controller: avoider,
    });
    const ticks = 1200;
    const quiet = await runFixture(inWalls(1, 0), ticks);
    expect(await runFixture(inWalls(99, 0), ticks)).toEqual(quiet);
    const noisy = await runFixture(inWalls(5, 1), ticks);
    expect(await runFixture(inWalls(5, 1), ticks)).toEqual(noisy);
    expect((await runFixture(inWalls(6, 1), ticks)).trajectory).not.toBe(noisy.trajectory);
    expect(noisy.trajectory).not.toBe(quiet.trajectory);
  }, 60_000);
});
