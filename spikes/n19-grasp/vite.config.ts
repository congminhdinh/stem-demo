// N19 G0.1 spike page (browsers.ts builds it and serves it with `vite preview` on port 5401). Spike-only config.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
// COOP/COEP as the app (vite.config.ts): cross-origin isolated pages get fine performance.now() (5 µs Chromium, 20 µs Firefox/WebKit).
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' };

export default defineConfig({
  root,
  base: './',
  cacheDir: '../../node_modules/.vite-n19-grasp-page',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 8000 },
  server: { port: 5400, strictPort: true, headers },
  preview: { port: 5401, strictPort: true, headers },
});
