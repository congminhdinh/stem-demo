// N19 D4 spike: every whole check of tests/robot-determinism.fixtures.ts on Node (the split Rapier build), written to results/golden-checks.json:
// the rover's two must equal the committed golden, the gripper's four are appended to it.
//   SPIKE=golden pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts golden
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { runAllChecks } from '../../tests/robot-determinism.fixtures';

it.runIf(process.env.SPIKE === 'golden')('computes the checks', async () => {
  await initPhysics();
  writeFileSync(join(import.meta.dirname, 'results', 'golden-checks.json'), JSON.stringify(await runAllChecks(), null, 1));
});
