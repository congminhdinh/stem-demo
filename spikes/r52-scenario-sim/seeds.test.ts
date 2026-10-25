// Spike (N18 R5.2a): the variant offsets of candidate seeds, to pick seeds whose jittered variants a blind program cannot survive.
//   SPIKE_SEEDS=1 pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts seeds
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { variantOffsets } from '../../src/core/scenario/variants';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';

it.runIf(process.env.SPIKE_SEEDS)('lists the offsets of seeds 0..4999 for the jittered scenarios', () => {
  const out: Record<string, unknown[]> = {};
  for (const scenario of scenarioCatalog.scenarios.filter((s) => s.variants.count > 1)) {
    const rows: unknown[] = [];
    for (let seed = 0; seed < 5000; seed++) {
      const s = { ...scenario, variants: { ...scenario.variants, seed } };
      rows.push([seed, ...[1, 2].map((v) => { const o = variantOffsets(s, v); return [o.start.dxCm, o.start.dyCm, o.start.dYawDeg, ...o.boxes.flatMap((b) => [b.dxCm, b.dyCm])]; })]);
    }
    out[scenario.key] = rows;
  }
  writeFileSync(join(import.meta.dirname, 'results', 'seed-offsets.json'), JSON.stringify(out));
});
