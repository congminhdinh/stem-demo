// Spike-only Vitest config (N19 B5): the repo's own test setup (Rapier alias and inlining), with only this spike included.
//   pnpm exec vitest run --config spikes/n19-b56/vitest.config.ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rapierEntry = join(dirname(createRequire(import.meta.url).resolve('@dimforge/rapier3d-deterministic/package.json')), 'rapier.js');

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['spikes/n19-b56/*.test.ts'],
    testTimeout: 600_000,
    alias: [{ find: /^@dimforge\/rapier3d-deterministic$/, replacement: rapierEntry }],
    server: { deps: { inline: [/[\\/]@dimforge[\\/]rapier3d-deterministic[\\/]/] } },
  },
});
