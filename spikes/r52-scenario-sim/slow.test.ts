// Spike (N18 R5.2a fix round 2): how long a correct lesson-4 follower at 35 % takes to reach the garage, for rb-line-follow's time limit.
//   SPIKE_SLOW=1 pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts slow
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { drive, hat, ifBlock, lineDark, stop, workspace } from '../../src/samples/robot-solutions';
import { runVariant } from './sim';

beforeAll(() => initPhysics(), 30_000);

it.runIf(process.env.SPIKE_SLOW)('times the 35 % follower on every variant of lesson 4', async () => {
  const scenario = scenarioCatalog.get('rb-line-follow')!;
  const follower = (speed: number) =>
    workspace(
      hat('stem_forever', [
        ifBlock('if-line', [
          [lineDark('center', 'lineCenter'), [drive('forward', 'forward', speed)]],
          [lineDark('left', 'lineLeft'), [drive('spin-left', 'spinLeft', speed)]],
          [lineDark('right', 'lineRight'), [drive('spin-right', 'spinRight', speed)]],
        ], [stop('lost')]),
      ]),
    );
  const rows: unknown[] = [];
  for (const speed of [35, 40]) {
    for (let v = 0; v < scenario.variants.count; v++) {
      const run = await runVariant(scenario, follower(speed), v, { seconds: 240 });
      rows.push({ speed, variant: v, goals: run.goals.map((g) => `${g.id}:${g.passed ? `ok@${g.atS?.toFixed(1)}` : g.reasonKey}`), end: run.end });
    }
  }
  writeFileSync(join(import.meta.dirname, 'results', 'slow-rb-line-follow.json'), `${JSON.stringify(rows, null, 1)}\n`);
});
