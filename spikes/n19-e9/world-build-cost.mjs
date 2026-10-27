// N19 E9 (fix round 1, review M1): what building a round's world costs, rover against gripper car. Kiểm tra builds one world a round
// (createScenarioWorld, robot-run-session.ts), and on the school profile the gripper Kiểm tra 4x showed 2 to 3 long tasks of 68 to 79 ms
// (the rover's none, bar 3 to 4 under the profiler). Not product code. Loaded through Vite's SSR loader as scripts/bench-robot.mjs does (plain Node,
// Rapier's -compat build, one thread): per lesson, the first build of the process and the median of 15 later ones, in ms of this thread's wall time.
//
//   node spikes/n19-e9/world-build-cost.mjs
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  cacheDir: join(root, 'node_modules', '.vite-bench-robot'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const physics = await server.ssrLoadModule('/src/core/world/rapier.ts');
  await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')).default);
  const { createScenarioWorld } = await server.ssrLoadModule('/src/core/world/world.ts');
  const { scenarioCatalog } = await server.ssrLoadModule('/src/samples/robot-scenarios/index.ts');
  const { productionKits } = await server.ssrLoadModule('/src/core/hardware/catalog.ts');
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
  for (const key of ['rb-mini-mission', 'rb-line-follow', 'rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack']) {
    const scenario = scenarioCatalog.get(key);
    const kit = productionKits.get({ id: scenario.kit, version: '0' });
    const times = [];
    for (let i = 0; i < 16; i += 1) {
      const started = performance.now();
      const world = await createScenarioWorld(scenario, kit, i % scenario.variants.count);
      times.push(performance.now() - started);
      world.dispose();
    }
    console.log(`${key.padEnd(16)} ${scenario.kit.padEnd(16)} first ${times[0].toFixed(1)} ms, median of the next 15: ${median(times.slice(1)).toFixed(2)} ms (min ${Math.min(...times.slice(1)).toFixed(2)}, max ${Math.max(...times.slice(1)).toFixed(2)})`);
  }
} finally {
  await server.close();
}
