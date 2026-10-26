// N19 G0.1: ms/tick of scenario 1 (3000 ticks, step only), 5 repetitions per configuration, against the rover baselines
// (`node spikes/n19-grasp/node-run.ts cost` -> results/node-cost.json). The machine is shared: the runner records uptime's load.
import type { MotorCommand } from '../../src/core/world/robot/dc-motor';
import { CONFIGS, PLAN, timeCarry, timeProductionRover, timeRover, TUNED_COLLIDER, type Config } from './scenarios';

const CHEAPER: Config[] = [
  { ...TUNED_COLLIDER, name: 'tuned, +8 PGS, no extra solver', tuning: { ...TUNED_COLLIDER.tuning, extraSolver: 0 } },
  { ...TUNED_COLLIDER, name: 'tuned, +4 PGS, no extra solver', tuning: { ...TUNED_COLLIDER.tuning, extraPgs: 4, extraSolver: 0 } },
];

export async function cost(now: () => number) {
  const rows: Record<string, unknown[]> = {};
  let commands: MotorCommand[] = [];
  for (let rep = 0; rep < 5; rep++) {
    for (const config of [...CONFIGS, ...CHEAPER]) {
      const timed = timeCarry(config, now);
      (rows[config.name] ??= []).push(timed.stats);
      if (config === PLAN) commands = timed.commands;
    }
    (rows.roverPhysics ??= []).push(timeRover(commands, now));
    (rows.roverProductionWorld ??= []).push(await timeProductionRover(commands, now));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const summary = Object.fromEntries(
    Object.entries(rows).map(([name, list]) => {
      const s = list as { median: number; p95: number; mean: number }[];
      return [name, { medianOfMedians: median(s.map((x) => x.median)), minMedian: Math.min(...s.map((x) => x.median)), medianP95: median(s.map((x) => x.p95)), medianMean: median(s.map((x) => x.mean)) }];
    }),
  );
  return { summary, rows };
}
