import { ROBOT_ENGINE_VERSION } from '../src/core/world/snapshot';
import { runAllFixtures, type FixtureHashes } from '../tests/robot-determinism.fixtures';

// N18 R3.5: the determinism fixtures of tests/robot-determinism.fixtures.ts, run in the browser (the split Rapier build, as the app
// loads it). e2e/robot-determinism.spec.ts compares the result with the golden file Node is held to.

export type RobotDeterminismResult =
  | { readonly engineVersion: number; readonly hashes: Record<string, FixtureHashes>; readonly ms: number }
  | { readonly error: string };

declare global {
  interface Window {
    __robotDeterminism?: RobotDeterminismResult;
  }
}

const out = document.getElementById('hashes')!;
const begin = performance.now();
runAllFixtures().then(
  (hashes) => {
    window.__robotDeterminism = { engineVersion: ROBOT_ENGINE_VERSION, hashes, ms: performance.now() - begin };
    out.textContent = JSON.stringify(window.__robotDeterminism, null, 2);
  },
  (error: unknown) => {
    window.__robotDeterminism = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    out.textContent = window.__robotDeterminism.error;
  },
);
