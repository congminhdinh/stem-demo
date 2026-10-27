// N19 final fix (G2 I1): what the gripper car's sensors' tag says, in 3D and on the 2D map, at the end of each lesson's reference run (Chạy at
// 4×) and while driving by hand (Lái tay, 1 s in), read from the views' own state readers (sensor-overlay-state.ts, top-view-gripper-state.ts,
// loaded from the dev server, as the e2e does). Drawn by SwiftShader. Run from the repository root against a dev server of the tree to read:
//
//   node spikes/n19-ff/color-line.mjs --base=http://localhost:5580
import { chromium } from '@playwright/test';
import { robotSolutions } from '../../src/samples/robot-solutions.ts';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const base = args.base ?? 'http://localhost:5580';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const readers = (page) =>
  page.evaluate(async () => {
    const overlay = await import(/* @vite-ignore */ '/src/ui/robot3d/sensor-overlay-state.ts');
    const map = await import(/* @vite-ignore */ '/src/ui/robot3d/top-view-gripper-state.ts');
    window.__ff = { overlay, map };
  });
const tag3d = (page) => page.evaluate(() => window.__ff.overlay.readSensorOverlay()?.gripper?.label ?? null);
const tag2d = (page) => page.evaluate(() => window.__ff.map.readTopViewGripper()?.label?.lines ?? null);
async function until(read, ok, ms = 30_000) {
  const end = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < end) {
    await sleep(250);
    value = await read();
  }
  return value;
}
async function open(key) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(`${base}/?embed=1&lab=robot&template=${key}`);
  await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await readers(page);
  return page;
}
const both = async (page) => {
  const three = await until(() => tag3d(page), (value) => value !== null);
  await page.getByTestId('robot-viewmode').click();
  await page.getByTestId('robot-topview').waitFor();
  const two = await until(() => tag2d(page), (value) => value !== null && value.length > 0);
  return `3D ${JSON.stringify(three)} | 2D ${JSON.stringify(two)}`;
};
try {
  for (const key of ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack']) {
    const page = await open(key);
    // The lab's own document with the reference's blocks (as G1's load scripts and e2e/robot-lab-check.spec.ts `projectOf` do).
    await page.evaluate((blocks) => window.__stem.loadProject({ ...window.__stem.getProject(), program: { blocks } }), robotSolutions[key].reference);
    await page.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
    await page.getByTestId('robot-run').click();
    await page.getByTestId('robot-status').filter({ hasText: 'Chương trình đã chạy xong' }).waitFor({ timeout: 180_000 });
    await sleep(500);
    process.stdout.write(`${key} Chạy (reference, end): ${await both(page)}\n`);
    await page.close();
  }
  for (const key of ['rb-grip-pick', 'rb-grip-sort']) {
    const page = await open(key);
    await page.getByTestId('robot-tool-teleop').click();
    await page.getByTestId('robot-teleop').waitFor();
    await sleep(1000);
    process.stdout.write(`${key} Lái tay (1 s): ${await both(page)}\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
