// N19 E4/E5 (review B3/B4 M1, the hand-off's "measure the cost before and after"): how often the robot lab draws while a gripper car holds a
// cube still, in the browser, for one source tree (BASE or HEAD). The lab runs on the gripper test entry of E1–E3 (e2e/robot-lab-gripper-ui.html,
// on BASE too), teleop on: the arm lowered round the red cube, the claw closed on it, the arm raised to its stop, then nothing moves. Counted:
//   - the 3D canvas's frames (three clears WebGL's default framebuffer once per render), over 6 s;
//   - then, the view switched to "Xem 2D", the 2D map's sensor layer and moving layer draws (their `draws` attributes), over 6 s.
// Chromium with SwiftShader, as the E2E's chromium-robot project. Run from the repository root, once per tree:
//
//   node spikes/n19-e45/rest-draws.mjs --src=<a checkout, its node_modules linked> --port=5527 --label=BASE
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const src = resolve(args.src ?? '.');
const port = Number(args.port ?? 5527);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const server = spawn(process.execPath, [join(src, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: src, stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) break;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`http://localhost:${port}/e2e/robot-lab-gripper-ui.html?embed=1&lab=robot&template=rb-sandbox`);
  await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => window.__stem?.robot !== undefined);
  await page.evaluate(() => window.__stem.robot.setLowTierChain('off'));
  await page.evaluate(() => {
    const gl = document.querySelector('[data-testid=robot-canvas] canvas').getContext('webgl2');
    window.__draws = 0;
    const clear = gl.clear.bind(gl);
    gl.clear = (mask) => {
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) window.__draws += 1;
      clear(mask);
    };
  });
  const snapshot = () => page.evaluate(() => window.__stem.robot.getSnapshot());
  const until = async (test, what) => {
    for (let i = 0; i < 240; i++) {
      if (test(await snapshot())) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  await page.getByTestId('robot-tool-teleop').click();
  await until((world) => world?.status === 'running', 'teleop');
  await page.locator('.robot-stage').focus();
  for (let step = 0; step < 6; step++) await page.keyboard.press('f');
  await until((world) => world.robot.gripper.liftDeg < 1, 'the arm down');
  await page.keyboard.press('e');
  await until((world) => world.robot.gripper.heldId === 'cube', 'the grab');
  for (let step = 0; step < 6; step++) await page.keyboard.press('r');
  await until((world) => world.robot.gripper.liftDeg > 89, 'the arm up');
  await sleep(4000);
  const world = await snapshot();
  const sensors = world.sensors.filter((sensor) => sensor.kind === 'ir-obstacle' || sensor.kind === 'color-sensor');
  const d0 = await page.evaluate(() => window.__draws);
  const t0 = world.t;
  await sleep(6000);
  const d1 = await page.evaluate(() => window.__draws);
  const t1 = (await snapshot()).t;
  // The 2D map: its readers from the dev server (the very instances the lab runs on).
  await page.getByTestId('robot-viewmode').click();
  await page.getByTestId('robot-topview').waitFor();
  await page.evaluate(async () => {
    const [a, b] = ['/src/ui/robot3d/top-view-sensors-state.ts', '/src/ui/robot3d/top-view-state.ts'];
    window.__sensorsState = await import(a);
    window.__mapState = await import(b);
  });
  await sleep(3000);
  const layers = () => page.evaluate(() => [window.__sensorsState.readTopViewSensors().draws, window.__mapState.readTopViewState().draws]);
  const [s0, m0] = await layers();
  await sleep(6000);
  const [s1, m1] = await layers();
  process.stdout.write(
    `${JSON.stringify({
      label: args.label ?? src,
      simulatedS: Math.round((t1 - t0) * 100) / 100,
      held: world.robot.gripper,
      sensors,
      webglFramesIn6s: d1 - d0,
      map2dSensorLayerDrawsIn6s: s1 - s0,
      map2dMovingLayerDrawsIn6s: m1 - m0,
    })}\n`,
  );
} finally {
  await browser.close();
  server.kill();
}
