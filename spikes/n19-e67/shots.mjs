// N19 E6/E7: the gallery of the gripper car and the pick-and-place props, drawn by the robot lab's own 3D view (e2e/robot-gripper-look.html:
// Scene.tsx with a fixture snapshot of src/ui/robot3d/__fixtures__/gripper-scene.ts; no gripper scenario ships yet, plan D4), in Chromium
// new headless on the machine's GPU, 1100 × 640, high and low tier. Evidence for the report and the visual review (E8), not product code.
// Run from the repository root with a dev server of this tree up (pnpm dev --port <port>):
//
//   node spikes/n19-e67/shots.mjs --origin=http://localhost:5470 --out=<dir> [--only=<substring>] [--dpr=1]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origin = args.origin ?? 'http://localhost:5470';
const out = resolve(args.out ?? 'spikes/n19-e67/out');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const want = (name) => !args.only || name.includes(args.only);

/** Each shot: its name, the fixture's query, and what is done to the camera before it (drags across the canvas, wheel clicks). */
const shots = [];
const test = (args.test ?? '').split(';').filter(Boolean).map((spec) => spec.split(',').map(Number));
if (test.length) {
  for (const [zoomFirst, dx, dy, zoom] of test) shots.push({ name: `test-z${zoomFirst}-${dx}-${dy}-z${zoom}`, query: { tier: 'high', lift: 0, claw: 0, camera: 'follow' }, zoomFirst, orbit: [[dx, dy]], zoom });
}
for (const tier of test.length ? [] : ['high', 'low']) {
  for (const [lift, claw] of [[0, 0], [0, 80], [45, 0], [45, 80], [90, 0], [90, 80]]) {
    // "Theo xe" zoomed in, then orbited round to the car's front right, a little lower.
    shots.push({ name: `gripper-lift${lift}-claw${claw}-${tier}`, query: { tier, lift, claw, camera: 'follow' }, zoomFirst: 5, orbit: [[-420, -70]], zoom: 2 });
  }
  // Fix round 1 (review M9): the claw from its front three-quarter (its boards, the carriage) and the arm side on (the parallelogram).
  for (const lift of [0, 45, 90]) {
    shots.push({ name: `front34-lift${lift}-${tier}`, query: { tier, lift, claw: 30, camera: 'follow' }, zoomFirst: 6, orbit: [[-240, -90]], zoom: 2 });
    shots.push({ name: `side-lift${lift}-${tier}`, query: { tier, lift, claw: 0, camera: 'follow' }, zoomFirst: 6, orbit: [[-160, -40]], zoom: 2 });
  }
  shots.push({ name: `holding-red-cube-${tier}`, query: { tier, lift: 45, claw: 26.97, held: 'cube-red', camera: 'follow' }, zoomFirst: 5, orbit: [[-420, -70]], zoom: 2 });
  shots.push({ name: `holding-red-cube-side-${tier}`, query: { tier, lift: 45, claw: 26.97, held: 'cube-red', camera: 'follow' }, zoomFirst: 5, orbit: [[-300, -60]], zoom: 2 });
  shots.push({ name: `holding-red-cube-raised-${tier}`, query: { tier, lift: 90, claw: 26.97, held: 'cube-red', camera: 'follow' }, zoomFirst: 5, orbit: [[-420, -40]], zoom: 1 });
  // The claw's sensors from the front, close (DPR 2): the colour sensor's white LED off before a run, lit while it runs.
  shots.push({ name: `color-led-off-${tier}`, query: { tier, lift: 0, claw: 30, status: 'idle', camera: 'follow' }, zoomFirst: 8, orbit: [[-330, -140]], zoom: 9, dpr: 2 });
  shots.push({ name: `color-led-on-${tier}`, query: { tier, lift: 0, claw: 30, status: 'running', camera: 'follow' }, zoomFirst: 8, orbit: [[-330, -140]], zoom: 9, dpr: 2 });
  shots.push({ name: `arena-props-${tier}`, query: { tier, lift: 90, claw: 0, camera: 'orbit' } });
  shots.push({ name: `arena-props-close-${tier}`, query: { tier, lift: 90, claw: 0, camera: 'orbit' }, zoom: 5, pan: [0, 0] });
  shots.push({ name: `chase-${tier}`, query: { tier, lift: 90, claw: 0, camera: 'follow' } });
  shots.push({ name: `top-${tier}`, query: { tier, lift: 0, claw: 0, camera: 'top' } });
}

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const taken = [];
try {
  for (const shot of shots) {
    if (!want(shot.name)) continue;
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: Number(shot.dpr ?? args.dpr ?? 1), reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${origin}/e2e/robot-gripper-look.html?${new URLSearchParams(shot.query)}`);
    await page.waitForFunction(() => window.__gripperLook === 'drawn', null, { timeout: 60_000 });
    await sleep(1500);
    const canvas = page.locator('#view canvas');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < (shot.zoomFirst ?? 0); i += 1) {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -120);
      await sleep(80);
    }
    for (const [dx, dy] of shot.orbit ?? []) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 16; i += 1) {
        await page.mouse.move(cx + (dx * i) / 16, cy + (dy * i) / 16);
        await sleep(16);
      }
      await page.mouse.up();
      await sleep(400);
    }
    for (let i = 0; i < (shot.zoom ?? 0); i += 1) {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -120);
      await sleep(80);
    }
    await sleep(1200);
    const models = await page.locator('#view canvas').getAttribute('data-models');
    await page.locator('#view').screenshot({ path: join(out, `${shot.name}.png`) });
    taken.push(`${shot.name} (${models})${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`);
    await context.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(`${taken.join('\n')}\n${taken.length} shots in ${out}\n`);
