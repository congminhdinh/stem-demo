// N19 G0.1 browser page: the determinism hashes of scenario 1 (3000 ticks, every config, twice) and ms/tick, with Rapier's -compat
// build (the same wasm as the app's split package, ADR 0001 §4.3). browsers.ts reads window.__result through Playwright.
import { initPhysics, type RapierModule } from '../../src/core/world/rapier';
import { CONFIGS, runHashes, timeCarry, timeRover } from './scenarios';

declare global {
  interface Window {
    __result?: unknown;
    __error?: string;
  }
}

const status = document.getElementById('status')!;
const out = document.getElementById('out')!;

async function run() {
  const t0 = performance.now();
  await initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as RapierModule);
  const initMs = performance.now() - t0;
  const now = () => performance.now();
  const hashes = runHashes();
  const cost: Record<string, unknown> = {};
  let commands: Parameters<typeof timeRover>[0] = [];
  for (const config of CONFIGS) {
    const timed = timeCarry(config, now);
    cost[config.name] = timed.stats;
    commands = timed.commands;
  }
  cost.roverPhysics = timeRover(commands, now);
  return { ua: navigator.userAgent, isolated: crossOriginIsolated, initMs: +initMs.toFixed(1), hashes, cost };
}

run().then(
  (result) => {
    window.__result = result;
    status.textContent = 'done';
    out.textContent = JSON.stringify(result, null, 2);
  },
  (error: unknown) => {
    window.__error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    status.textContent = `error: ${window.__error}`;
  },
);
