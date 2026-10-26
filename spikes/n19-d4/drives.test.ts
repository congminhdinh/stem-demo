// N19 D4 spike: each gripper reference's check driven headless, at 1× and at 4× (the drives of check-drives.ts), with each variant's score and
// last world hash per drive, written to results/drives.json (check-robot.gripper-lessons.test.ts asserts they are equal; this records them).
//   SPIKE=drives pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts drives
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { gripperReferences } from '../../src/core/scenario/__fixtures__/check-cases';
import { drivesOf, outcomeOf } from '../../src/core/scenario/__fixtures__/check-drives';
import { initPhysics } from '../../src/core/world/rapier';

it.runIf(process.env.SPIKE === 'drives')('records each drive', async () => {
  await initPhysics();
  const out: Record<string, Record<string, unknown>> = {};
  for (const check of gripperReferences) {
    const key = check.name.split(':')[0]!;
    out[key] = {};
    for (const drive of drivesOf.speeds) {
      const { result, variants } = await outcomeOf(check.project(), check.scenario(), drive);
      out[key]![drive.name] = { score: result.score, programHash: result.programHash.slice(0, 16), variants: result.variants.map((v, i) => [v.seed, v.score, variants[i]!.world]) };
    }
  }
  writeFileSync(join(import.meta.dirname, 'results', 'drives.json'), JSON.stringify(out, null, 1));
});
