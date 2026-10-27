// N19 E9: what is still asked of the 3D view after a gripper lesson's reference run has ended (the bench's "draws per second at rest" row was 10 for
// rb-grip-stack and 0 for the other three). Not product code. A dev server of this tree (node node_modules/vite/bin/vite.js --port <port>) serves the lab
// in its test hooks; the reference of <key> runs to its end at 1x, and for 5 s after (2 s later) this prints: the draws to the screen (three clears the
// default framebuffer once per render), the snapshots published, who asked for the animation frames (the stacks of requestAnimationFrame's callers: R3F's
// invalidate from Scene.tsx's check is the scene redrawing for a changed picture, SensorOverlay.tsx's ask the overlays), and every field of the snapshot
// that changed (sampled every 20 ms) with how often, from and to.
//
//   node spikes/n19-e9/rest-draws.mjs [rb-grip-pick|rb-grip-deliver|rb-grip-sort|rb-grip-stack] [--origin=http://localhost:5550]
import { chromium } from '@playwright/test';
const args = process.argv.slice(2);
const origin = (args.find((arg) => arg.startsWith('--origin=')) ?? '--origin=http://localhost:5550').slice('--origin='.length);
const key = args.find((arg) => !arg.startsWith('--')) ?? 'rb-grip-stack';
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.addInitScript(() => {
  window.__asks = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    window.__asks.push(new Error().stack.split('\n').slice(2, 8).map((l) => l.trim().replace(/\(?http:\/\/localhost:\d+\//, '(').replace(/\?[tv]=\w+/, '')).join(' < '));
    return raf(cb);
  };
});
await page.goto(`${origin}/?embed=1&lab=robot&template=${key}`);
await page.getByTestId('robot-lab').waitFor();
await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60000 });
await page.waitForFunction(() => window.__stem?.robot !== undefined);
await page.evaluate(() => window.__stem.robot.setLowTierChain('off'));
await page.evaluate(async (key) => {
  const s = await import(/* @vite-ignore */ '/src/samples/robot-solutions.ts');
  const t = await import(/* @vite-ignore */ '/src/samples/robot-templates.ts');
  window.__stem.loadProject({ ...t.robotStarterDocument(key), program: { blocks: s.robotSolutions[key].reference } });
  const gl = document.querySelector('[data-testid=robot-canvas] canvas').getContext('webgl2');
  window.__draws = [];
  const clear = gl.clear.bind(gl);
  gl.clear = (mask) => { if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) window.__draws.push(Math.round(performance.now())); clear(mask); };
}, key);
await page.getByTestId('robot-run').click();
await page.waitForFunction(() => ['finished', 'timeUp', 'crashed'].includes(document.querySelector('[data-testid=robot-hud]')?.getAttribute('data-status')), null, { timeout: 180000 });
await page.waitForTimeout(2000);
const snap0 = await page.evaluate(() => window.__stem.robot.getSnapshot());
console.log('status', snap0.status, 't', snap0.t.toFixed(2));
await page.evaluate(() => {
  const flat = (v, path = '', out = {}) => { if (v !== null && typeof v === 'object') for (const k of Object.keys(v)) flat(v[k], path + '.' + k, out); else out[path] = v; return out; };
  window.__moved = new Map(); window.__pubs = 0;
  let last = flat(window.__stem.robot.getSnapshot());
  let lastT = last['.t'];
  setInterval(() => {
    const now = flat(window.__stem.robot.getSnapshot());
    if (now['.t'] !== lastT) window.__pubs++;
    lastT = now['.t'];
    for (const k of Object.keys(now)) if (k !== '.t' && now[k] !== last[k]) { const e = window.__moved.get(k) ?? { n: 0, from: last[k] }; e.n++; e.to = now[k]; window.__moved.set(k, e); }
    last = now;
  }, 20);
  window.__mark = window.__draws.length;
});
await page.evaluate(() => { window.__asks.length = 0; });
await page.waitForTimeout(5000);
console.log('rAF asks by caller', JSON.stringify(await page.evaluate(() => { const m = {}; for (const a of window.__asks) m[a.slice(0, 200)] = (m[a.slice(0, 200)] ?? 0) + 1; return m; })));
console.log('draws in 5 s', await page.evaluate(() => window.__draws.length - window.__mark), 'publishes', await page.evaluate(() => window.__pubs));
console.log('changed keys', JSON.stringify(await page.evaluate(() => [...window.__moved].map(([k, e]) => [k, e.n, e.from, e.to]))));
await browser.close();
