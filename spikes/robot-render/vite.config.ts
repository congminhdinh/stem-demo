// Spike-only Vite config (N18 R0.2). Not part of the product build.
//   SPIKE_CONTROLS=three|drei  chooses which OrbitControls module the lazy chunk imports (alias @controls).
//   pnpm exec vite build  -c spikes/robot-render/vite.config.ts   -> spikes/robot-render/dist/<controls>/
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const controls = process.env.SPIKE_CONTROLS ?? 'three';

// Same headers as the product lab (vite.config.ts), so the iframe behaves as the real lab does.
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: here,
  plugins: [react()],
  define: { __CONTROLS__: JSON.stringify(controls) },
  resolve: { alias: { '@controls': resolve(here, `src/controls-${controls}.tsx`) } },
  build: {
    outDir: resolve(here, `dist/${controls}`),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
  },
  server: { port: 5221, strictPort: true, headers },
  preview: { port: 5221, strictPort: true, headers },
});
