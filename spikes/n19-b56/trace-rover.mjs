// N19 B5/B6 evidence (spike, eslint-ignored): the rover's world makes the same Rapier calls, with the same arguments, at BASE and HEAD.
//
//   git archive 0a7a479 | tar -x -C <scratch>/base && ln -s $PWD/node_modules <scratch>/base/node_modules
//   node spikes/n19-b56/trace-rover.mjs <scratch>/base     # BASE master 0a7a479
//   node spikes/n19-b56/trace-rover.mjs .                  # HEAD
//
// Every method on the prototype of every class Rapier's -compat build exports is wrapped to log its name and arguments (numbers exactly,
// Rapier objects by handle). The run: the all-goals scenario (src/core/scenario/__fixtures__/all-goals.scenario.json) on ref-uno-rover@0,
// variant 1, 600 ticks of a script, the snapshot, the goal frame, the frame extras and the ultrasonic read every tick; and the start check
// (startFootprintIssues) of its arena. It prints the number of calls, an FNV-1a hash of the call log and one of the snapshots. Loaded through
// Vite's SSR loader with no config file, as scripts/verify-attempt.mjs does.
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(process.argv[2] ?? '.');
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  cacheDir: join(root, 'node_modules', '.vite-b56-trace'),
  optimizeDeps: { noDiscovery: true, include: [] },
});

/** FNV-1a 64 bit over a string, as hex. */
function fnv64(text, h = 0xcbf29ce484222325n) {
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

try {
  const load = (path) => server.ssrLoadModule(path);
  const physics = await load('/src/core/world/rapier.ts');
  await physics.initPhysics(async () => import(join(root, 'node_modules', '@dimforge', 'rapier3d-deterministic-compat', 'dist', 'rapier.cjs')));
  const R = physics.getRapier();
  let calls = 0;
  let log = 0xcbf29ce484222325n;
  const counts = new Map();
  const digest = (value, depth = 0) => {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'function') return 'fn';
    if (typeof value.handle === 'number') return `#${value.handle}`;
    if (depth > 2) return '…';
    if (Array.isArray(value) || ArrayBuffer.isView(value)) return `[${Array.from(value, (item) => digest(item, depth + 1)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${key}:${digest(value[key], depth + 1)}`).join(',')}}`;
  };
  let active = false;
  for (const [name, value] of Object.entries(R)) {
    if (typeof value !== 'function' || value.prototype === undefined) continue;
    for (const key of Object.getOwnPropertyNames(value.prototype)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value.prototype, key);
      if (typeof descriptor?.value !== 'function') continue;
      const original = descriptor.value;
      value.prototype[key] = function (...args) {
        if (active) {
          calls += 1;
          const line = `${name}.${key}(${args.map((arg) => digest(arg)).join(',')})`;
          log = fnv64(`${line}\n`, log);
          counts.set(`${name}.${key}`, (counts.get(`${name}.${key}`) ?? 0) + 1);
        }
        return original.apply(this, args);
      };
    }
  }
  const { productionKits, referenceKitRef } = await load('/src/core/hardware/index.ts');
  const { loadScenario } = await load('/src/core/scenario/scenario.ts');
  const { createScenarioWorld } = await load('/src/core/world/world.ts');
  const { snapshotText } = await load('/src/core/world/snapshot.ts');
  const { startFootprintIssues } = await load('/src/core/world/robot/footprint.ts');
  const { readFileSync } = await import('node:fs');
  const scenario = loadScenario(JSON.parse(readFileSync(join(root, 'src/core/scenario/__fixtures__/all-goals.scenario.json'), 'utf8')));
  const kit = productionKits.get(referenceKitRef);
  active = true;
  const world = await createScenarioWorld(scenario, kit, 1);
  let snapshots = 0xcbf29ce484222325n;
  const drive = (duty, dir) => ({ duty, dir, brake: false });
  for (let tick = 0; tick < 600; tick++) {
    const s = tick / 120;
    const motors = s < 1.5 ? { motorLeft: drive(160, 1), motorRight: drive(160, 1) } : s < 2.5 ? { motorLeft: drive(140, -1), motorRight: drive(140, 1) } : { motorLeft: drive(200, 1), motorRight: drive(120, 1) };
    world.applyActuators({ motors, servos: { servo1: Math.floor(tick / 60) % 2 === 0 ? 30 : 150 } });
    world.step(1 / 120);
    const frame = world.goalFrame({ leds: {}, buzzerHz: null });
    snapshots = fnv64(`${snapshotText(world.snapshot())}${snapshotText(frame)}${snapshotText(world.frameExtras())}${world.sense.ultrasonic('ultrasonic').cm}\n`, snapshots);
  }
  world.dispose();
  const issues = startFootprintIssues(scenario.arena, kit, scenario.start);
  active = false;
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, n]) => `${key} ${n}`);
  console.log(JSON.stringify({ root, calls, callLog: log.toString(16).padStart(16, '0'), snapshots: snapshots.toString(16).padStart(16, '0'), startIssues: issues, top }));
} finally {
  await server.close();
}
