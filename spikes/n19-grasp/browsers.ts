// N19 G0.1 browser harness. From the repo root: node spikes/n19-grasp/browsers.ts  -> spikes/n19-grasp/results/browsers.json
// Builds the spike page (vite build, spikes/n19-grasp/vite.config.ts), serves it with `vite preview` on port 5401 (COOP/COEP), and runs
// it in Chromium, Firefox and WebKit (Playwright, headless). Compares every hash with results/node-run1.json.
import { chromium, firefox, webkit } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const configFile = join(here, 'vite.config.ts');

await build({ configFile, logLevel: 'warn' });
const server = await preview({ configFile });
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5401/';
const node = JSON.parse(readFileSync(join(here, 'results', 'node-run1.json'), 'utf8')) as { hashes: Record<string, { run1: unknown }> };
const result: Record<string, unknown> = { date: new Date().toISOString(), command: 'node spikes/n19-grasp/browsers.ts', url, loadavgStart: loadavg(), browsers: {} };
try {
  for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__result !== undefined || window.__error !== undefined, null, { timeout: 600_000 });
    const got = (await page.evaluate(() => window.__result ?? { error: window.__error })) as { hashes?: Record<string, { run1: unknown; equal: boolean }> };
    const sameAsNode = got.hashes === undefined ? false : Object.entries(node.hashes).every(([config, h]) => JSON.stringify(got.hashes![config]?.run1) === JSON.stringify(h.run1) && got.hashes![config]!.equal);
    (result.browsers as Record<string, unknown>)[name] = { version: browser.version(), sameAsNode, ...got };
    console.log(name, browser.version(), sameAsNode ? 'hashes = Node' : 'HASH MISMATCH', JSON.stringify(got.hashes));
    await browser.close();
  }
} finally {
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
result.loadavgEnd = loadavg();
writeFileSync(join(here, 'results', 'browsers.json'), JSON.stringify(result, null, 2) + '\n');
