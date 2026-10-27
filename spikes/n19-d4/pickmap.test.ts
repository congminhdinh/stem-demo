// N19 D4 fix round 1 (review I1): lesson 8's shipped reference on other seeds (60 consecutive and 8 spread ones, as review 1 ran), each jittered
// draw with the cube's lateral offset from the start's line of travel and the draw's score. results/pickmap.json.
//   SPIKE=pickmap pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts pickmap
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { kitFootprintRadiusCm, variantOffsets } from '../../src/core/scenario/variants';
import { initPhysics } from '../../src/core/world/rapier';
import { robotSolutions } from '../../src/samples/robot-solutions';
import { check, gripperKit, load } from './lib';

const base = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'samples', 'robot-scenarios', 'rb-grip-pick.json'), 'utf8'));

it.runIf(process.env.SPIKE === 'pickmap')('maps the draws', async () => {
  await initPhysics();
  const seeds = [...Array.from({ length: 60 }, (_, i) => 100 + i), 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
  const draws = new Map<string, { offset: number; score: number; goals: string[] }>();
  for (const seed of seeds) {
    const scenario = load({ ...base, variants: { ...base.variants, seed } });
    const result = await check(scenario, robotSolutions['rb-grip-pick'].reference);
    for (const index of [1, 2]) {
      const o = variantOffsets(scenario, index, kitFootprintRadiusCm(gripperKit));
      const yaw = ((base.start.yawDeg + o.start.dYawDeg) * Math.PI) / 180;
      const [sx, sy] = [base.start.xCm + o.start.dxCm, base.start.yCm + o.start.dyCm];
      const [cx, cy] = [85 + o.objects![0]!.dxCm, 45];
      const offset = -(cx - sx) * Math.sin(yaw) + (cy - sy) * Math.cos(yaw);
      // Consecutive seeds share draws (a variant's seed is the scenario's plus its index): key each by its own seed.
      draws.set(String(seed + index), { offset: Math.round(offset * 1000) / 1000, score: result.variants[index]!.score, goals: (result.ended[index] as { goals: string[] }).goals });
    }
  }
  writeFileSync(join(import.meta.dirname, 'results', 'pickmap.json'), JSON.stringify(Object.fromEntries(draws), null, 1));
});
