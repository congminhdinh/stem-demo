// N19 B7 spike: every value of tests/__snapshots__/robot-determinism.json as this tree computes it on Node (the split package), written to
// spikes/n19-b7/results/golden-<OUT>.json, to regenerate the golden's gripper entries and show that the rover's do not move.
//   OUT=head pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts golden
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { runAllChecks, runAllFixtures } from '../../tests/robot-determinism.fixtures';

it('computes the golden', async () => {
  await initPhysics();
  const fixtures = await runAllFixtures();
  const checks = await runAllChecks();
  writeFileSync(join(import.meta.dirname, 'results', `golden-${process.env.OUT ?? 'head'}.json`), `${JSON.stringify({ fixtures, checks }, null, 1)}\n`);
  expect(Object.keys(fixtures)).toHaveLength(6);
}, 1_200_000);
