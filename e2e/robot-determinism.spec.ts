import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { RobotDeterminismResult } from './robot-determinism.page';

// N18 R3.5 (robot plan §5): the robot world gives the same snapshot hashes in Chromium, Firefox and WebKit as on Node. The page runs
// the fixtures of tests/robot-determinism.fixtures.ts; tests/robot-determinism.test.ts holds Node to the same golden file. This spec
// is the one the firefox and webkit projects run (playwright.config.ts).

const golden = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'tests', '__snapshots__', 'robot-determinism.json'), 'utf8')) as {
  engineVersion: number;
  fixtures: Record<string, { final: string; trajectory: string }>;
};

test('the robot world hashes the same in this browser as on Node', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await page.goto('/e2e/robot-determinism.html');
  // The first visit can make the dev server optimise a dependency and reload the page: wait on the page that stays.
  await expect
    .poll(async () => page.evaluate(() => window.__robotDeterminism ?? null).catch(() => null), { timeout: 150_000, intervals: [250] })
    .not.toBeNull();
  const result = (await page.evaluate(() => window.__robotDeterminism)) as RobotDeterminismResult;
  expect('error' in result ? result.error : null).toBeNull();
  if ('error' in result) return;
  test.info().annotations.push({ type: 'robot-determinism', description: `${browserName}: ${JSON.stringify(result.hashes)} in ${result.ms.toFixed(0)} ms` });
  expect(result.engineVersion).toBe(golden.engineVersion);
  expect(result.hashes).toEqual(golden.fixtures);
});
