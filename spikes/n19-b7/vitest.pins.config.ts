// N19 B7 spike: the repo's own test setup for src/core/world, with record-pins.ts as a setup file.
//   PINS_OUT=<file> pnpm exec vitest run --config spikes/n19-b7/vitest.pins.config.ts
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
    include: ['src/core/world/**/*.test.ts'],
    setupFiles: [join(root, 'spikes/n19-b7/record-pins.ts')],
    testTimeout: 1_200_000,
    alias: [{ find: /^@dimforge\/rapier3d-deterministic$/, replacement: rapierEntry }],
    server: { deps: { inline: [/[\\/]@dimforge[\\/]rapier3d-deterministic[\\/]/] } },
  },
});
