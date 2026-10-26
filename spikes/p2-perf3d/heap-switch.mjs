// N18 P2 fix round 1 (I2): the heap, the DOM's nodes and the JS listeners after 20 × 2D ↔ 3D and 20 tier switches, on a production build
// with no probe (after the review's own script); and the 'dispose' listeners on three's shared Sprite geometry, one per renderer that drew
// it and is still reachable through it, read through a sprite of the latest scene three announces that has one (scenes held weakly). Run from the repository
// root (vite preview on --port, the lesson host on --port + 1):
//
//   node spikes/p2-perf3d/heap-switch.mjs --dist=<build> [--port=5306] [--switches=20] [--label=<name>]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const dist = resolve(args.dist);
const port = Number(args.port ?? 5306);
const switches = Number(args.switches ?? 20);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const origin = `http://localhost:${port + 1}`;
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  await sleep(1500);
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  // The latest scene three announces, held weakly (nothing kept alive by the measurement).
  await context.addInitScript(() => {
    if (!/[?&]lab=robot(&|$)/.test(location.search)) return;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (event) => {
      if (event.detail?.isScene) (window.__scenes ??= []).push(new WeakRef(event.detail));
    });
    window.__THREE_DEVTOOLS__ = devtools;
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const lab = `http://localhost:${port}/?embed=1&lab=robot&template=rb-line-follow&origin=${encodeURIComponent(origin)}`;
  await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  const drawn = () => frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  await drawn();
  const spriteListeners = () =>
    frame.evaluate(() => {
      // The latest scene three announced that holds a sprite (the lab's; the environment's and the files' scenes come and go).
      let geometry = null;
      for (const ref of [...(window.__scenes ?? [])].reverse()) {
        ref.deref()?.traverse((node) => {
          if (!geometry && node.isSprite) geometry = node.geometry;
        });
        if (geometry) break;
      }
      return geometry ? (geometry._listeners?.dispose?.length ?? 0) : null;
    });
  const sample = async (kind, index) => {
    await sleep(700);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const dom = await cdp.send('Memory.getDOMCounters');
    return { kind, index, heapMB: +(heap / 2 ** 20).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, spriteListeners: await spriteListeners() };
  };
  const samples = [await sample('start', 0)];
  for (let i = 1; i <= switches; i += 1) {
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor({ timeout: 60_000 });
    await sleep(300);
    await frame.getByTestId('robot-viewmode').click();
    await drawn();
    samples.push(await sample('2d-3d', i));
  }
  for (let i = 1; i <= switches; i += 1) {
    await frame.getByTestId('robot-quality').click();
    await sleep(300);
    await drawn();
    if (i % 2 === 0) samples.push(await sample('tier', i));
  }
  const by = {};
  for (const s of samples) (by[s.kind] ??= []).push(s);
  const label = args.label ?? dist;
  for (const [kind, list] of Object.entries(by)) {
    process.stdout.write(`${label} ${kind}: heap MB ${list.map((s) => s.heapMB).join(' ')}\n`);
    process.stdout.write(`${label} ${kind}: nodes ${list.map((s) => s.nodes).join(' ')} | listeners ${list.map((s) => s.listeners).join(' ')} | sprite geometry's dispose listeners ${list.map((s) => s.spriteListeners).join(' ')}\n`);
  }
  await context.close();
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
