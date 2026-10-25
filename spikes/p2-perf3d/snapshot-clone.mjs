// N18 P2 spike (evidence for p2-audit.md). Run from the repository root: node spikes/p2-perf3d/snapshot-clone.mjs
// The Web Worker option's message cost: one RobotRunSnapshot per frame posted from a worker is a structured clone of it. Its size
// (v8.serialize, the format postMessage uses) and the time of structuredClone, for each pilot's reference at 2 s and at 10 s.
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { serialize } from 'node:v8';
const root = process.argv[2] ?? process.cwd();
const { createServer } = await import(join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, cacheDir: join(root, 'node_modules/.cache/p2-micro-vite'), optimizeDeps: { noDiscovery: true, include: [] } });
const physics = await server.ssrLoadModule('/src/core/world/rapier.ts');
await physics.initPhysics(async () => (await server.ssrLoadModule('@dimforge/rapier3d-deterministic-compat')).default);
const { pilotReferences } = await server.ssrLoadModule('/src/core/scenario/__fixtures__/check-cases.ts');
const { roverSession } = await server.ssrLoadModule('/src/core/run/__fixtures__/robot-session.ts');
const { scenarioScorer } = await server.ssrLoadModule('/src/core/scenario/scoring.ts');
for (const reference of pilotReferences) {
  const session = roverSession(reference.scenario(), { scorer: scenarioScorer });
  const started = await session.start(reference.project());
  if (!started.ok) { console.log(reference.name, 'did not start', started.reason); continue; }
  const out = [];
  for (const t of [2, 10]) {
    await session.runUntil(t);
    const snapshot = session.getSnapshot();
    const bytes = serialize(snapshot).length;
    for (let i = 0; i < 200; i++) structuredClone(snapshot);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) structuredClone(snapshot);
    out.push(`${t} s: ${bytes} B, clone ${(((performance.now() - t0) / 2000) * 1000).toFixed(1)} µs`);
  }
  console.log(`${reference.name}: ${out.join('; ')}`);
  session.stop();
}
await server.close();
