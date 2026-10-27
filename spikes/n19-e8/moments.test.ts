// N19 E8 spike: each gripper lesson's reference traced every 0.1 s (one Bước of the lab), in the variants the gallery shows, to choose
// the moments it shoots at (start, grasp, carry, release). Writes results/trace-<key>-v<variant>.txt.
//   SPIKE=moments pnpm exec vitest run --config spikes/n19-e8/vitest.config.ts moments
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { robotSolutions } from '../../src/samples/robot-solutions';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { trace } from '../n19-d4/lib';

const runs: [string, number, number][] = [
  ['rb-grip-pick', 0, 14],
  ['rb-grip-deliver', 0, 14],
  ['rb-grip-sort', 0, 12],
  ['rb-grip-sort', 1, 12],
  ['rb-grip-sort', 2, 12],
  ['rb-grip-stack', 0, 20],
];

it.runIf(process.env.SPIKE === 'moments')('traces the references', async () => {
  await initPhysics();
  const out = join(import.meta.dirname, 'results');
  mkdirSync(out, { recursive: true });
  for (const [key, variant, seconds] of runs) {
    const scenario = scenarioCatalog.get(key)!;
    const { rows } = await trace(scenario, robotSolutions[key as keyof typeof robotSolutions].reference, variant, 0.1, seconds);
    const lines = rows.map((r) => `${r.t.toFixed(1)} x ${r.x} y ${r.y} yaw ${r.yaw} lift ${r.lift} claw ${r.claw} held ${r.held} ir ${r.ir}/${r.irHit} col ${r.colorHit}@${r.colorCm} us ${r.us}/${r.usHit} ${JSON.stringify(r.objects)} blk ${r.block}`);
    writeFileSync(join(out, `trace-${key}-v${variant}.txt`), `${lines.join('\n')}\n`);
  }
});
