import { ROBOT_ENGINE_VERSION } from '../src/core/world/snapshot';
import { runAllChecks, runAllFixtures, type CheckHashes, type FixtureHashes } from '../tests/robot-determinism.fixtures';

// N18 R3.5: the determinism fixtures of tests/robot-determinism.fixtures.ts, run in the browser (the split Rapier build, as the app
// loads it). e2e/robot-determinism.spec.ts compares the result with the golden file Node is held to. N18 final fix M3: with `?run=checks`
// the page runs the whole checks of that file instead (checkRobot headless: compiler, interpreter, virtual UNO, world and scorer).

/** The world fixtures' hashes, or with `?run=checks` the whole checks' results; or why there are none. */
export type RobotDeterminismResult =
  | { readonly engineVersion: number; readonly hashes?: Record<string, FixtureHashes>; readonly checks?: Record<string, CheckHashes>; readonly ms: number }
  | { readonly error: string };

declare global {
  interface Window {
    __robotDeterminism?: RobotDeterminismResult;
  }
}

const out = document.getElementById('hashes')!;
const begin = performance.now();
const run: Promise<{ hashes: Record<string, FixtureHashes> } | { checks: Record<string, CheckHashes> }> =
  new URLSearchParams(window.location.search).get('run') === 'checks' ? runAllChecks().then((checks) => ({ checks })) : runAllFixtures().then((hashes) => ({ hashes }));
run.then(
  (result) => {
    window.__robotDeterminism = { engineVersion: ROBOT_ENGINE_VERSION, ...result, ms: performance.now() - begin };
    out.textContent = JSON.stringify(window.__robotDeterminism, null, 2);
  },
  (error: unknown) => {
    window.__robotDeterminism = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    out.textContent = window.__robotDeterminism.error;
  },
);
