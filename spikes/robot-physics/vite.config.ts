// Spike-only Vite config. Build: pnpm exec vite build --config spikes/robot-physics/vite.config.ts
// SPIKE_NO_WASM_PLUGIN=1 builds without vite-plugin-wasm (to record whether Vite 8 needs it).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import wasm from 'vite-plugin-wasm';

const root = dirname(fileURLToPath(import.meta.url));
const headers = {
  // Same COOP/COEP as the app (vite.config.ts); also gives browsers fine performance.now().
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const plugins: PluginOption[] = process.env.SPIKE_NO_WASM_PLUGIN ? [] : [wasm()];

export default defineConfig({
  root,
  plugins,
  base: './', // relative URLs: browsers.ts serves several builds side by side
  build: { outDir: process.env.SPIKE_OUT_DIR ?? 'dist', emptyOutDir: true, manifest: true, chunkSizeWarningLimit: 8000 },
  server: { port: 5211, strictPort: true, headers },
  preview: { port: 5211, strictPort: true, headers },
});
