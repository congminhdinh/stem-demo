// Spike (N18 R5.2a): a grid over the timings of a blind program, variant 0 only, to find the open-loop program that solves it.
//   SPIKE_TUNE=rb-line-follow pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts tune
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { drive, hat, stop, wait, workspace } from '../../src/samples/robot-solutions';
import { runVariant } from './sim';

beforeAll(() => initPhysics(), 30_000);

const key = process.env.SPIKE_TUNE;
const grid = JSON.parse(process.env.SPIKE_GRID ?? '[]') as number[][];

/** legs: [forwardMs, turnMs?] ... */
const blind = (legs: number[][]) =>
  workspace(
    hat('stem_on_start', [
      ...legs.flatMap(([ms, turn], i) => [
        drive(`leg-${i + 1}-forward`, 'forward', 50),
        wait(`leg-${i + 1}-wait`, ms!),
        ...(turn === undefined ? [] : [drive(`leg-${i + 1}-turn`, 'spinLeft', 50), wait(`leg-${i + 1}-turn-wait`, turn)]),
      ]),
      stop('stop'),
    ]),
  );

it.runIf(key)('tunes a blind program', async () => {
  const scenario = scenarioCatalog.get(key!)!;
  const shape = JSON.parse(process.env.SPIKE_SHAPE ?? '[]') as (number | null)[][]; // template with nulls filled from the grid row in order
  const rows: unknown[] = [];
  for (const values of grid) {
    let i = 0;
    const legs = shape.map((leg) => leg.map((v) => (v === null ? values[i++]! : v)));
    const run = await runVariant(scenario, blind(legs), Number(process.env.SPIKE_VARIANT ?? 0));
    rows.push({ legs, points: run.points, ratio: run.onLine ? run.onLine.onTapeCm / Math.max(1e-9, run.onLine.drivenCm) : null, end: run.end, goals: run.goals.map((g) => `${g.id}:${g.passed ? 'ok' : g.reasonKey}`), contacts: run.contacts, minFront: run.minFrontCm });
  }
  writeFileSync(join(import.meta.dirname, 'results', `tune-${key}.json`), JSON.stringify(rows, null, 1));
});
