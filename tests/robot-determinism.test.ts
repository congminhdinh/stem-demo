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
import { DETERMINISM_TICKS, determinismChecks, determinismFixtures, runCheckFixture, runFixture, type CheckHashes, type FixtureHashes } from './robot-determinism.fixtures';

// N18 R3.5 (robot plan §5): the same project, scenario@version, seed and engine@version give the same snapshot hash. Here on Node,
// twice and with both Rapier builds; e2e/robot-determinism.spec.ts computes the same fixtures in Chromium, Firefox and WebKit against
// the same golden file, so the four runtimes agree.
//
// The golden hashes are ROBOT_ENGINE_VERSION's. A change that moves one (physics, robot, sensors, what a snapshot holds) is a new
// engine: bump ROBOT_ENGINE_VERSION, ROBOT_ENGINE (check-result.ts, which check-result.test.ts ties to it) and this file's engineVersion
// together, with the new hashes. N18 final fix M3: the golden file holds whole checks too (`checks`), which the browsers compare with the
// same values.

const goldenPath = join(import.meta.dirname, '__snapshots__', 'robot-determinism.json');
type Golden = { engineVersion: number; ticks: number; fixtures: Record<string, FixtureHashes>; checks: Record<string, CheckHashes> };
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

  it('pins the gripper car’s fixtures after the rover’s, on the same engine version (N19 B6)', () => {
    expect(determinismFixtures.map((fixture) => fixture.name)).toEqual(['boxes-script', 'line-follow', 'mini-mission-v1-noise', 'gripper-pick-place', 'gripper-stack', 'gripper-sensors']);
    expect(golden.engineVersion).toBe(1);
  });

  it('pins a whole check of each closed-loop case: its result and the last world of each variant (N18 final fix M3)', () => {
    expect(Object.keys(golden.checks)).toEqual(determinismChecks.map((check) => check.name));
    expect(determinismChecks.map(({ check }) => check.name)).toEqual([
      'rb-mini-mission: the reference solution',
      'rb-line-follow: the reference solution',
      'rb-grip-pick: the reference solution',
      'rb-grip-deliver: the reference solution',
      'rb-grip-sort: the reference solution',
      'rb-grip-stack: the reference solution',
    ]);
  });

  it.each(determinismChecks.map(({ name, check }) => [name, check] as const))(
    'same project, scenario@version, seeds and engine twice → the same check result and last worlds: %s',
    async (name, check) => {
      const first = await runCheckFixture(check);
      expect(await runCheckFixture(check)).toEqual(first);
      expect(first).toEqual(golden.checks[name]);
      expect(first.passed).toBe(true);
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
