// N19 E4/E5: close-ups of the gripper car's overlays for the report and the visual review (E8), not product code: the 3D view in "Theo xe",
// zoomed in, with the IR beam between the jaws and the colour spot on the held cube and their tag, and the 2D map at DPR 2 cropped round the
// car (the jaws, the held cube's ring, the beam, the spot, the tag). The lab is the gripper test entry with the pick-and-place floor
// (e2e/robot-lab-gripper-ui.html?arena=pick); teleop lowers the arm round the red cube and closes the claw. Chromium with SwiftShader, as
// the e2e. Run from the repository root with a dev server of this tree up (node node_modules/vite/bin/vite.js --port <port>):
//
//   node spikes/n19-e45/gripper-shots.mjs --origin=http://localhost:5529 --out=<dir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origin = args.origin ?? 'http://localhost:5529';
const out = resolve(args.out ?? 'spikes/n19-e45/out');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${origin}/e2e/robot-lab-gripper-ui.html?embed=1&lab=robot&template=rb-sandbox&arena=pick`);
  await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => window.__stem?.robot !== undefined);
  await page.evaluate(() => window.__stem.robot.setLowTierChain('off'));
  const snapshot = () => page.evaluate(() => window.__stem.robot.getSnapshot());
  const until = async (test) => {
    for (let i = 0; i < 240 && !test(await snapshot()); i++) await sleep(250);
  };
  await page.getByTestId('robot-tool-teleop').click();
  await until((world) => world?.status === 'running');
  await page.locator('.robot-stage').focus();
  for (let step = 0; step < 6; step++) await page.keyboard.press('f');
  await until((world) => world.robot.gripper.liftDeg < 1);
  // The open claw round the cube, before the grab: the IR sees it, the spot is red.
  await sleep(1500);
  await page.locator('[data-testid=robot-camera] [data-mode=follow]').click();
  await sleep(1500);
  const canvas = page.locator('[data-testid=robot-canvas] canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await sleep(120);
  }
  await sleep(1500);
  await canvas.screenshot({ path: join(out, '3d-follow-open-round-cube.png') });
  await page.locator('.robot-stage').focus();
  await page.keyboard.press('e');
  await until((world) => world.robot.gripper.heldId === 'cube');
  await sleep(1500);
  await canvas.screenshot({ path: join(out, '3d-follow-holding.png') });
  // The 2D map, cropped round the car.
  await page.getByTestId('robot-viewmode').click();
  await page.getByTestId('robot-topview').waitFor();
  await sleep(1500);
  const world = await snapshot();
  // The car on the page: the map's fit (TopView2D's margins 14, 14, 14, 40 round a 200 x 150 cm arena; top-view-math.ts fitTopView).
  const stage = await page.getByTestId('robot-topview').boundingBox();
  const [roomW, roomH] = [stage.width - 28, stage.height - 54];
  const scale = Math.min(roomW / 200, roomH / 150);
  const originX = stage.x + 14 + (roomW - 200 * scale) / 2;
  const originY = stage.y + 14 + (roomH - 150 * scale) / 2 + 150 * scale;
  const x = originX + (world.robot.xCm + 8) * scale;
  const y = originY - world.robot.yCm * scale;
  await page.screenshot({ path: join(out, '2d-map-holding-crop.png'), clip: { x: x - 90, y: y - 60, width: 180, height: 120 } });
  await page.screenshot({ path: join(out, '2d-map-holding.png') });
  process.stdout.write(`shots in ${out}\n`);
} finally {
  await browser.close();
}
