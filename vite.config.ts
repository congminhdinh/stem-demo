import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Rapier's split .wasm package (ADR 0001 §5.2) has only a `module` field, which Vitest's SSR resolve does not
// read, and its wasm must go through Vite's own wasm handling. So the tests alone alias the bare name to its
// entry and inline the package; the app build resolves it natively and is left untouched.
const rapierEntry = join(
  dirname(createRequire(import.meta.url).resolve('@dimforge/rapier3d-deterministic/package.json')),
  'rapier.js',
);

// Cross-origin isolation is optional in the PoC (plan §5.2, AD-17). It is only
// required later by the Pyodide track (SharedArrayBuffer). If these headers
// ever cause friction (Blockly media, assets, Playwright…), remove them
// instead of debugging COEP.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const blocklyMediaDir = 'node_modules/blockly/media';

/**
 * Serves Blockly's media (dropdown arrow, sprites, cursors) at <base>blockly-media/
 * so it never comes from a CDN: in dev by rewriting to the package folder,
 * in builds by copying that folder next to the bundle. The base path is the
 * app's (`--base /lab/` serves it at /lab/blockly-media/, S6), and so is the
 * URL BlocklyPanel gives Blockly (src/ui/blockly/media.ts).
 */
function blocklyMedia(): Plugin {
  return {
    name: 'blockly-media',
    configureServer(server) {
      const prefix = `${server.config.base}blockly-media/`;
      // Not mounted on a path: connect would re-add the mount prefix after next().
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith(prefix)) {
          // Still under the base, which Vite strips before it serves the file.
          req.url = `${server.config.base}${blocklyMediaDir}/${req.url.slice(prefix.length)}`;
        }
        next();
      });
    },
    writeBundle(options) {
      cpSync(blocklyMediaDir, join(options.dir ?? 'dist', 'blockly-media'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), blocklyMedia()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    alias: [{ find: /^@dimforge\/rapier3d-deterministic$/, replacement: rapierEntry }],
    server: { deps: { inline: [/[\\/]@dimforge[\\/]rapier3d-deterministic[\\/]/] } },
  },
});
