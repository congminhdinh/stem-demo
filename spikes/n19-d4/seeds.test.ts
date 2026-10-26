// N19 D4 spike: the variant offsets of candidate seeds of the four gripper lessons, at the gripper car's radius (16 cm), to pick seeds whose
// variants hold the static pins of plan §6 (results.md says which and why).
//   SPIKE=seeds pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts seeds
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { kitFootprintRadiusCm, variantOffsets } from '../../src/core/scenario/variants';
import { gripperKit, load } from './lib';

const radius = kitFootprintRadiusCm(gripperKit);
const keys = ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'];

it.runIf(process.env.SPIKE === 'seeds')('lists the offsets of seeds 0..19999', () => {
  const out: Record<string, unknown[]> = {};
  for (const key of keys) {
    const json = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'samples', 'robot-scenarios', `${key}.json`), 'utf8'));
    const rows: unknown[] = [];
    for (let seed = 0; seed < 20000; seed++) {
      const s = load({ ...json, variants: { ...json.variants, seed } });
      rows.push([
        seed,
        ...[1, 2].map((v) => {
          const o = variantOffsets(s, v, radius);
          return [o.start.dxCm, o.start.dyCm, o.start.dYawDeg, ...(o.objects ?? []).flatMap((b) => [b.dxCm, b.dyCm])].map((n) => Math.round(n * 1000) / 1000);
        }),
      ]);
    }
    out[key] = rows;
  }
  writeFileSync(join(import.meta.dirname, 'results', 'seed-offsets.json'), JSON.stringify(out));
});
