// Spike-only Vitest config: does each Rapier package run under Vitest 4 (Node)?
//   SPIKE_VITEST=<mode> pnpm exec vitest run --config spikes/robot-physics/vitest.config.ts
// plain  : no alias, no inlining, no plugin (what the app's vite.config.ts would do today)
// alias  : alias the split package to its rapier.js (it has no main/exports for SSR resolve)
// inline : alias + server.deps.inline (Vite transforms it; Vite 8 built-in wasm handling)
// plugin : alias + inline + vite-plugin-wasm (wasm becomes a base64 data URL under Vitest)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

const mode = process.env.SPIKE_VITEST ?? 'plugin';
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const splitDir = dirname(require.resolve('@dimforge/rapier3d-deterministic/package.json'));
export default defineConfig({
  root,
  plugins: mode === 'plugin' ? [wasm()] : [],
  resolve: mode === 'plain' ? {} : { alias: [{ find: /^@dimforge\/rapier3d-deterministic$/, replacement: join(splitDir, 'rapier.js') }] },
  test: {
    environment: 'node',
    include: ['vitest/*.test.ts'],
    server: mode === 'plain' || mode === 'alias' ? {} : { deps: { inline: [/rapier3d-deterministic[\\/](?!.*compat)/, /rapier3d-deterministic@/] } },
  },
});
