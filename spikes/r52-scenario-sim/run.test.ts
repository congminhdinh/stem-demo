// Spike (N18 R5.2a): every scored scenario's reference, blind and starter program through every variant (sim.ts), written to
// results/runs.json (results/runs-<keys>.json when narrowed). SPIKE_ONLY=<key>[,<key>] and SPIKE_PROGRAM=reference,blind,starter narrow
// it; SPIKE_TRACKS=1 keeps the pose of every 6th tick.
//   pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts run
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { robotSolutions } from '../../src/samples/robot-solutions';
import { runVariant, type VariantRun } from './sim';

beforeAll(() => initPhysics(), 30_000);

const only = process.env.SPIKE_ONLY;
const programs = (process.env.SPIKE_PROGRAM ?? 'reference,blind,starter').split(',');

it('runs the pilot scenarios', async () => {
  const out: Record<string, Record<string, VariantRun[]>> = {};
  const started = performance.now();
  for (const scenario of scenarioCatalog.scenarios) {
    if (scenario.goals.length === 0 || (only && !only.split(',').includes(scenario.key))) continue;
    const solution = robotSolutions[scenario.key as keyof typeof robotSolutions];
    const candidates: [string, unknown][] = [
      ['reference', solution.reference],
      ...('blind' in solution ? [['blind', solution.blind] as [string, unknown]] : []),
      ['starter', scenario.starter],
    ];
    out[scenario.key] = {};
    for (const [name, program] of candidates) {
      if (!programs.includes(name)) continue;
      const runs: VariantRun[] = [];
      for (let v = 0; v < scenario.variants.count; v++) {
        const t0 = performance.now();
        const run = await runVariant(scenario, program, v);
        runs.push(process.env.SPIKE_TRACKS ? run : { ...run, track: [] });
        const goals = run.goals.map((g) => `${g.id}:${g.passed ? 'ok' : g.reasonKey}${g.atS === undefined ? '' : `@${g.atS.toFixed(2)}`}`).join(' ');
        const r = (n: number) => n.toFixed(1);
        console.log(
          `${scenario.key} ${name} v${v} start(${r(run.start.xCm)},${r(run.start.yCm)},${r(run.start.yawDeg)}) end(${r(run.end.xCm)},${r(run.end.yCm)},${r(run.end.yawDeg)}) path ${r(run.pathCm)} pts ${run.points}` +
            `${run.onLine ? ` line ${run.onLine.onTape}/${run.onLine.moving}=${(run.onLine.onTape / Math.max(1, run.onLine.moving)).toFixed(3)}` : ''}` +
            `${run.minFrontCm === undefined ? '' : ` minFront ${run.minFrontCm.toFixed(1)}`} contacts [${run.contacts.join(',')}] ${goals} (${((performance.now() - t0) / 1000).toFixed(1)} s wall)`,
        );
      }
      out[scenario.key]![name] = runs;
    }
  }
  const machine = { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, node: process.version };
  mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
  const file = only ? `runs-${only.replace(/,/g, '+')}.json` : 'runs.json';
  writeFileSync(join(import.meta.dirname, 'results', file), `${JSON.stringify({ machine, wallS: (performance.now() - started) / 1000, runs: out }, null, 2)}\n`);
  expect(Object.keys(out).length).toBeGreaterThan(0);
});
