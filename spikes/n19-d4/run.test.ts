// N19 D4 spike: trace a draft program in a variant, or check it in every variant.
//   SPIKE=run KEY=rb-grip-deliver PROG=deliverRef [VARIANT=0] [SPIKE_MODE=trace|check] pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts run
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import * as programs from './programs';
import { check, load, trace } from './lib';

it.runIf(process.env.SPIKE === 'run')('runs', async () => {
  await initPhysics();
  const key = process.env.KEY!;
  const file = process.env.FILE ?? join(import.meta.dirname, '..', '..', 'src', 'samples', 'robot-scenarios', `${key}.json`);
  const scenario = load(JSON.parse(readFileSync(file, 'utf8')));
  const prog = (programs as unknown as Record<string, () => unknown>)[process.env.PROG!]!() as Record<string, unknown>;
  if (process.env.SPIKE_MODE === 'check') {
    const result = await check(scenario, prog);
    writeFileSync(join(import.meta.dirname, 'results', `check-${key}-${process.env.PROG}.json`), JSON.stringify(result, null, 1));
    return;
  }
  const v = Number(process.env.VARIANT ?? 0);
  const { rows, goals } = await trace(scenario, prog, v, Number(process.env.EVERY ?? 0.1));
  const out = join(import.meta.dirname, 'results', `trace-${key}-${process.env.PROG}-v${v}.txt`);
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n' + JSON.stringify(goals));
  console.log(JSON.stringify(goals));
});
