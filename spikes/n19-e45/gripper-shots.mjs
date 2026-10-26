// N19 E4/E5 (fix round 1): close-ups of the gripper's sensor overlays in the 3D view, for the report and the visual review (E8), not product
// code. The robot lab's own 3D view (Scene.tsx with its sensor overlay) on E6/E7's gallery page (e2e/robot-gripper-look.html: a fixture
// snapshot of src/ui/robot3d/__fixtures__/gripper-scene.ts, with the readouts a run gives: &sensors=quiet|seen, &ahead=<object>), in Chromium
// new headless on the machine's GPU, 1200 x 760 at DPR 2, the high and the low tier, the chase camera 6 wheel clicks in, dragged round
// (E6/E7's `front34` recipe, spikes/n19-e67/shots.mjs) and up to its steepest, 2 more clicks in: the beam and the spot lie between the
// carriage and the cube, under the claw servo and between the fingers, so only a view from high over the jaws sees them (from the front
// three-quarters the cube hides them, from the side a finger). Three states:
//   1. open-empty: the arm down, the claw open, nothing between the jaws (the IR beam quiet, the colour ray its 4 cm, no spot);
//   2. cube-in-jaws: the red cube between the open jaws, its near face 1.7 cm from the sensors (the IR seeing it, the colour spot on it, red);
//   3. held-raised: the claw closed on it (26.97°) and the arm up, held where the e2e's real grab holds it (4 cm on: the IR seeing it, the spot red).
// Run from the repository root with a dev server of this tree up (node node_modules/vite/bin/vite.js --port <port>):
//
//   node spikes/n19-e45/gripper-shots.mjs --origin=http://localhost:5529 --out=<dir> [--only=<substring>] [--orbit=-240,80]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origin = args.origin ?? 'http://localhost:5529';
const out = resolve(args.out ?? 'spikes/n19-e45/out');
const orbit = (args.orbit ?? '-240,80').split(',').map(Number);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const want = (name) => !args.only || name.includes(args.only);
const states = [
  { name: '1-open-empty', query: { lift: 0, claw: 0, sensors: 'quiet' } },
  { name: '2-cube-in-jaws', query: { lift: 0, claw: 0, ahead: 'cube-red', sensors: 'seen' } },
  { name: '3-held-raised', query: { lift: 90, claw: 26.97, held: 'cube-red', heldAt: 4, sensors: 'seen' } },
];
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const taken = [];
try {
  for (const tier of ['high', 'low']) {
    for (const state of states) {
      const name = `3d-${state.name}-${tier}`;
      if (!want(name)) continue;
      const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${origin}/e2e/robot-gripper-look.html?${new URLSearchParams({ tier, camera: 'follow', status: 'running', ...state.query })}`);
      await page.waitForFunction(() => window.__gripperLook === 'drawn', null, { timeout: 60_000 });
      await sleep(1500);
      const canvas = page.locator('#view canvas');
      const box = await canvas.boundingBox();
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      const wheel = async (clicks) => {
        for (let i = 0; i < clicks; i++) {
          await page.mouse.move(cx, cy);
          await page.mouse.wheel(0, -120);
          await sleep(80);
        }
      };
      await wheel(6);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 16; i++) {
        await page.mouse.move(cx + (orbit[0] * i) / 16, cy + (orbit[1] * i) / 16);
        await sleep(16);
      }
      await page.mouse.up();
      await sleep(400);
      await wheel(2);
      await sleep(1500);
      await page.locator('#view').screenshot({ path: join(out, `${name}.png`) });
      taken.push(`${name} (${await canvas.getAttribute('data-models')})${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
process.stdout.write(`${taken.join('\n')}\n${taken.length} shots in ${out}\n`);
