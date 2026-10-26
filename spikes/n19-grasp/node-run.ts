// N19 G0.1 Node runner. From the repo root:
//   node spikes/n19-grasp/node-run.ts run1            -> spikes/n19-grasp/results/node-run1.json (all scenarios, both finger modes, timing)
//   node spikes/n19-grasp/node-run.ts run2 --quick    -> results/node-run2.json (hashes only: a second process)
//   node spikes/n19-grasp/node-run.ts trace           -> results/trace.json: the lift/link tuning exploration (trace.ts)
//   node spikes/n19-grasp/node-run.ts cost            -> results/node-cost.json: ms/tick, 5 repetitions per configuration (cost.ts)
// The spike's TypeScript imports production modules with extensionless paths, so it is loaded through Vite's SSR loader (as
// scripts/verify-attempt.mjs does) with a dependency cache of its own. Physics is Rapier's -compat build (plain Node; ADR 0001 §5.2).
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const label = process.argv[2] ?? 'run1';
const quick = process.argv.includes('--quick');

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  cacheDir: join(root, 'node_modules', '.vite-n19-grasp'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const physics = await server.ssrLoadModule('/src/core/world/rapier.ts');
  const t0 = performance.now();
  await physics.initPhysics(async () => await import('@dimforge/rapier3d-deterministic-compat'));
  const initMs = performance.now() - t0;
  const env = {
    node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length,
    rapier: physics.getRapier().version(), loadavgStart: loadavg(), initMs: +initMs.toFixed(1),
  };
  if (label === 'cost') {
    const { cost } = await server.ssrLoadModule('/spikes/n19-grasp/cost.ts');
    const uptimeStart = loadavg();
    const result = await cost(() => performance.now());
    mkdirSync(join(here, 'results'), { recursive: true });
    writeFileSync(join(here, 'results', 'node-cost.json'), JSON.stringify({ date: new Date().toISOString(), command: 'node spikes/n19-grasp/node-run.ts cost', env, loadavgStart: uptimeStart, ...result, loadavgEnd: loadavg() }, null, 2) + '\n');
    console.log(JSON.stringify(result.summary, null, 1));
  } else if (label === 'trace') {
    const { trace } = await server.ssrLoadModule(process.argv[3] ?? '/spikes/n19-grasp/trace.ts');
    const result = trace();
    if (process.argv[3] === undefined) {
      mkdirSync(join(here, 'results'), { recursive: true });
      writeFileSync(join(here, 'results', 'trace.json'), JSON.stringify({ date: new Date().toISOString(), command: 'node spikes/n19-grasp/node-run.ts trace', env, result, loadavgEnd: loadavg() }, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 1));
  } else {
    const { runAll, runHashes } = await server.ssrLoadModule('/spikes/n19-grasp/scenarios.ts');
    const now = () => performance.now();
    let result: Record<string, unknown>;
    if (quick) {
      result = { hashes: runHashes() };
    } else {
      const { timeProductionRover } = await server.ssrLoadModule('/spikes/n19-grasp/scenarios.ts');
      const { commands, ...rest } = runAll(now);
      (rest.cost as Record<string, unknown>).roverProductionWorld = await timeProductionRover(commands, now);
      result = rest;
    }
    const out = { label, date: new Date().toISOString(), command: `node spikes/n19-grasp/node-run.ts ${process.argv.slice(2).join(' ')}`, env, ...result, loadavgEnd: loadavg() };
    mkdirSync(join(here, 'results'), { recursive: true });
    writeFileSync(join(here, 'results', `node-${label}.json`), JSON.stringify(out, null, 2) + '\n');
    console.log(JSON.stringify({ hashes: result.hashes, cost: result.cost }, null, 1));
  }
} finally {
  await server.close();
}
