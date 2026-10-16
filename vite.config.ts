import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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
  },
});
