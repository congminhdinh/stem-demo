// Screenshots of the robot lab's 3D view (N18 R4.7): evidence for the report, not product code (spikes/ is outside lint and tsconfig).
// Run from the repository root:
//
//   node spikes/r47-visual/shots.mjs --out=<dir> [--port=5250] [--only=<name-substring>] [--no-server]
//
// It starts the dev server on --port (strict) and e2e/lesson-host.mjs on --port + 1, unless --no-server (then both must be up), opens
// each pilot scenario in the LMS's 1100 x 640 iframe in Chromium on the machine's GPU (new headless, ANGLE Metal on a Mac), loads the
// scenario's reference solution through the dev hook, runs it at 4× and pauses it at a moment where the robot is in the middle of the
// lesson (rb-servo-gate: once the flag is up), and takes:
//   - <scenario>-high-1100.png and <scenario>-low-1100.png (the tier picked with the lab's own button);
//   - drive-to-zone-{orbit,follow,top}-high-1100.png (the camera's three views);
//   - closeup-high-1100.png and closeup-low-1100.png (Theo xe, zoomed in with the wheel);
//   - <scenario>-high-760.png (the lab alone at 760 x 640, the Robot tab).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const out = resolve(args.out ?? join(here, 'out'));
const port = Number(args.port ?? 5250);
const hostPort = port + 1;
const only = args.only ?? null;
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Where each scenario's run is paused for its picture: a simulated time, or a test on the snapshot. */
const pilots = [
  { key: 'rb-drive-to-zone', pauseAt: (s) => s.t >= 2.2 },
  { key: 'rb-square-route', pauseAt: (s) => s.t >= 3.2 },
  { key: 'rb-stop-at-wall', pauseAt: (s) => s.t >= 2.6 },
  { key: 'rb-line-follow', pauseAt: (s) => s.t >= 7 },
  { key: 'rb-servo-gate', pauseAt: (s) => (s.robot.servoDeg?.servo1 ?? 0) >= 158 },
  { key: 'rb-mini-mission', pauseAt: (s) => s.t >= 9 },
];

async function project(key) {
  const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
  return {
    schemaVersion: 1,
    id: `r47-${key}`,
    name: 'Robot',
    profile: 'uno-basic',
    kit: { id: 'ref-uno-rover', version: '0' },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks: robotSolutions[key].reference },
  };
}

function startServers() {
  if ('no-server' in args) return () => {};
  const children = [
    spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
    spawn(process.execPath, ['e2e/lesson-host.mjs', String(hostPort)], { cwd: root, stdio: 'ignore' }),
  ];
  return () => children.forEach((child) => child.kill());
}

async function waitFor(url) {
  for (let i = 0; i < 300; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error(`${url} did not come up`);
}

const labUrl = (key) => `http://localhost:${port}/?embed=1&lab=robot&template=${key}`;
const hostUrl = (key) => `http://localhost:${hostPort}/lesson?lab=${encodeURIComponent(labUrl(key))}`;

async function setTier(target, tier) {
  for (let i = 0; i < 2 && (await target.getByTestId('robot-quality').getAttribute('data-tier')) !== tier; i += 1) {
    await target.getByTestId('robot-quality').click();
    await target.getByTestId('robot-canvas').locator('canvas').waitFor();
    await sleep(800);
  }
}

/** Runs the reference at 4× and pauses where `pauseAt` says. */
async function runToPause(target, key, pauseAt) {
  if ('idle' in args) {
    await target.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await sleep(600);
    return;
  }
  await target.evaluate((document) => window.__stem.loadProject(document), await project(key));
  await target.evaluate(() => window.__stem.robot.setSpeed(4));
  await target.getByTestId('robot-run').click();
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const snapshot = await target.evaluate(() => window.__stem.robot.getSnapshot());
    if (snapshot && pauseAt(snapshot)) break;
    await sleep(15);
  }
  const pause = target.getByTestId('robot-pause');
  if (await pause.isEnabled()) await pause.click();
  await sleep(700);
}

const want = (name) => only === null || name.includes(only);

/** Drags across the canvas by (dx, dy) px with the left button: OrbitControls turns the camera. */
async function orbit(page, box, dx, dy) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(1200);
}

async function shoot(page, name) {
  await page.screenshot({ path: join(out, name) });
  console.log('shot', name);
}

async function main() {
  const stop = startServers();
  try {
    await waitFor(`http://localhost:${port}/`);
    await waitFor(`http://localhost:${hostPort}/lesson`);
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });

    for (const tier of ['high', 'low']) {
      for (const { key, pauseAt } of pilots) {
        const name = `${key.slice(3)}-${tier}-1100.png`;
        const cameraShots = tier === 'high' && key === 'rb-drive-to-zone';
        const closeups = key === 'rb-drive-to-zone';
        const flagShot = key === 'rb-servo-gate' && tier === 'high' && want('flag');
        const lineShot = key === 'rb-line-follow' && want('line-eyes');
        if (!want(name) && !(cameraShots && want('drive-to-zone-')) && !(closeups && want('closeup')) && !flagShot && !lineShot) continue;
        const page = await context.newPage();
        await page.goto(hostUrl(key));
        const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
        await frame.getByTestId('robot-canvas').locator('canvas').waitFor({ timeout: 60_000 });
        await sleep(1500);
        await setTier(frame, tier);
        await runToPause(frame, key, pauseAt);
        if (want(name)) await shoot(page, name);
        if (cameraShots) {
          for (const [mode, label] of [['orbit', 'Tự do'], ['follow', 'Theo xe'], ['top', 'Nhìn từ trên']]) {
            await frame.getByTestId('robot-camera').getByRole('button', { name: label }).click();
            await sleep(900);
            if (want(`drive-to-zone-${mode}`)) await shoot(page, `drive-to-zone-${mode}-high-1100.png`);
          }
        }
        if (closeups && want('closeup')) {
          await frame.getByTestId('robot-camera').getByRole('button', { name: 'Theo xe' }).click();
          await sleep(900);
          const box = await frame.getByTestId('robot-canvas').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 6; i += 1) {
            await page.mouse.wheel(0, -120);
            await sleep(60);
          }
          await sleep(900);
          await shoot(page, `closeup-${tier}-1100.png`);
          // Round to the robot's front-left: a drag orbits the chase, which keeps the angle it is left at.
          await orbit(page, box, -200, -12);
          await shoot(page, `closeup-front-${tier}-1100.png`);
        }
        if (lineShot) {
          // The line sensors' lamps from the front: the robot on the line, an eye over the tape lit.
          await frame.getByTestId('robot-camera').getByRole('button', { name: 'Theo xe' }).click();
          await sleep(900);
          const box = await frame.getByTestId('robot-canvas').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 7; i += 1) {
            await page.mouse.wheel(0, -120);
            await sleep(60);
          }
          await orbit(page, box, -230, -20);
          await shoot(page, `line-eyes-${tier}-1100.png`);
        }
        if (key === 'rb-servo-gate' && tier === 'high' && want('flag')) {
          await frame.getByTestId('robot-camera').getByRole('button', { name: 'Theo xe' }).click();
          await sleep(900);
          const box = await frame.getByTestId('robot-canvas').boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 3; i += 1) {
            await page.mouse.wheel(0, -120);
            await sleep(60);
          }
          await orbit(page, box, 110, -6);
          await shoot(page, 'servo-gate-flag-high-1100.png');
        }
        await page.close();
      }
    }

    for (const { key, pauseAt } of pilots) {
      const name = `${key.slice(3)}-high-760.png`;
      if (!want(name)) continue;
      const page = await browser.newPage({ viewport: { width: 760, height: 640 } });
      await page.goto(labUrl(key));
      await page.getByTestId('robot-canvas').locator('canvas').waitFor({ state: 'attached', timeout: 60_000 });
      await sleep(1000);
      await runToPause(page, key, pauseAt);
      await shoot(page, name);
      await page.close();
    }
    await browser.close();
  } finally {
    stop();
  }
}

await main();
