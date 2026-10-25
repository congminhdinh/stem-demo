// Screenshots of the robot lab's 3D view on the PRODUCTION build (N18 R4.7 fix round 1, review C4: a dev build runs React's StrictMode
// twice-effects, which once left the studio light without its environment map). Evidence for the report, not product code (spikes/ is
// outside lint and tsconfig). Run from the repository root:
//
//   node spikes/r47-visual/shots-prod.mjs --out=<dir> [--port=5252] [--only=<name-substring>] [--no-build]
//
// It builds the app (vite build → spikes/r47-visual/dist, as measure-fps.mjs does), serves it with `vite preview` on --port and
// e2e/lesson-host.mjs on --port + 1, opens the lab framed by the lesson page (1100 x 640, the LMS's sandbox and `origin=`; the iframe set
// to 760 px wide for the narrow layout, the Robot tab picked), loads each program over stem-lab/v1 (`load-project`: a production build
// has no test hooks), runs it at 4× and pauses it where the HUD's clock says, in Chromium on the machine's GPU (new headless, ANGLE
// Metal on a Mac). Shots (every one from this production build):
//   - <pilot>-<tier>-<width>.png: the six pilots, high and low, at 1100 and 760 (Tự do, the view each lesson opens on), paused mid-run;
//     idle/<pilot>-high-<width>.png the same views before the run, the robot at its start;
//   - drive-to-zone-{orbit,follow,top}-high-1100.png: the three camera views (Tự do orbited by a drag); servo-gate-flag-high-1100.png: the raised flag up close;
//   - follow-<tier>-1100.png, closeup-<tier>-1100.png, closeup-front-<tier>-1100.png: Theo xe as it opens, zoomed in, and orbited round
//     to the robot's front-left;
//   - line-lamps-free-<tier>-1100.png (Tự do), line-lamps-follow-<tier>-1100.png (Theo xe as it opens, the robot on a turn of the tape)
//     and line-lamps-side-<tier>-1100.png (Theo xe orbited to the robot's side): rb-line-follow's lamps, each at DPR 2;
//   - check/01..06: Kiểm tra at 4× under way, the passed card, an exploit's failed card, the card folded (the camera back), Xem lại
//     (the replay framed from its start), the replay's end.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const out = resolve(args.out ?? join(here, 'out-prod'));
const port = Number(args.port ?? 5252);
const hostPort = port + 1;
const only = args.only ?? null;
const distDir = join(here, 'dist');
const SANDBOX = 'allow-scripts allow-same-origin allow-downloads';
mkdirSync(join(out, 'check'), { recursive: true });
mkdirSync(join(out, 'idle'), { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const want = (name) => only === null || name.includes(only);

/** Where each pilot's run is paused for its picture: the HUD clock's simulated time, s. */
const pilots = [
  { key: 'rb-drive-to-zone', pauseAt: 2.2 },
  { key: 'rb-square-route', pauseAt: 3.2 },
  { key: 'rb-stop-at-wall', pauseAt: 2.6 },
  { key: 'rb-line-follow', pauseAt: 7 },
  { key: 'rb-servo-gate', pauseAt: 6.1 },
  { key: 'rb-mini-mission', pauseAt: 9 },
];

const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));

function project(key, exploit = null) {
  const solution = robotSolutions[key];
  const blocks = exploit === null ? solution.reference : solution.exploits.find((item) => item.name === exploit).program;
  return {
    schemaVersion: 1,
    id: `r47-${key}`,
    name: 'Robot',
    profile: 'uno-basic',
    kit: { id: 'ref-uno-rover', version: '0' },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks },
  };
}

function startServers() {
  if (!('no-build' in args)) execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', distDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' });
  const children = [
    spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', distDir, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
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

const lessonOrigin = `http://localhost:${hostPort}`;
const labOrigin = `http://localhost:${port}`;
const hostUrl = (key) => `${lessonOrigin}/lesson?lab=${encodeURIComponent(`${labOrigin}/?embed=1&lab=robot&template=${key}&origin=${encodeURIComponent(lessonOrigin)}`)}&sandbox=${encodeURIComponent(SANDBOX)}`;

/** Opens `key`'s lab in the lesson page, its iframe `width` wide: its frame, once the scene has drawn. */
async function open(context, key, width = 1100) {
  const page = await context.newPage();
  await page.goto(hostUrl(key));
  if (width !== 1100) await page.evaluate((w) => (document.querySelector('iframe').width = String(w)), width);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (width < 900) {
    const tab = frame.getByRole('tab', { name: 'Robot', exact: true });
    await tab.waitFor({ timeout: 60_000 });
    await tab.click();
  }
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await sleep(800);
  return { page, frame };
}

async function load(page, frame, document) {
  await page.evaluate(([doc, origin]) => window.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: doc }, origin), [document, labOrigin]);
  await sleep(1200);
}

async function setTier(frame, tier) {
  for (let i = 0; i < 2 && (await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== tier; i += 1) {
    await frame.getByTestId('robot-quality').click();
    await sleep(300);
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await sleep(800);
  }
}

const simTime = async (frame) => Number(((await frame.getByTestId('robot-time').textContent()) ?? '').replace(/^[^0-9]*([0-9]+),([0-9]).*$/, '$1.$2'));

/** Runs the loaded program at 4× and pauses once the HUD's clock reaches `at` s. */
async function runTo(frame, at) {
  await frame.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
  await frame.getByTestId('robot-run').click();
  const started = Date.now();
  while (Date.now() - started < 30_000 && (await simTime(frame)) < at) await sleep(15);
  const pause = frame.getByTestId('robot-pause');
  if (await pause.isEnabled()) await pause.click();
  await sleep(900);
}

async function camera(frame, label) {
  await frame.getByTestId('robot-camera').getByRole('button', { name: label }).click();
  await sleep(1000);
}

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
  await sleep(1400);
}

async function zoom(page, box, clicks) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < clicks; i += 1) {
    await page.mouse.wheel(0, -120);
    await sleep(60);
  }
  await sleep(1000);
}

async function shoot(page, name, element = null) {
  await (element ?? page).screenshot({ path: join(out, name) });
  console.log('shot', name);
}

async function main() {
  const stop = startServers();
  try {
    await waitFor(`${labOrigin}/`);
    await waitFor(`${lessonOrigin}/lesson`);
    const browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
    const sharp = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });

    for (const tier of ['high', 'low']) {
      for (const width of [1100, 760]) {
        for (const { key, pauseAt } of pilots) {
          const name = `${key.slice(3)}-${tier}-${width}.png`;
          const views = width === 1100 && tier === 'high' && key === 'rb-drive-to-zone' && want('drive-to-zone-');
          const follow = width === 1100 && key === 'rb-drive-to-zone' && (want('follow') || want('closeup'));
          const flag = width === 1100 && tier === 'high' && key === 'rb-servo-gate' && want('flag');
          if (!want(name) && !views && !follow && !flag) continue;
          const { page, frame } = await open(context, key, width);
          await setTier(frame, tier);
          // The view the lesson opens on, the robot at its start (the high tier).
          if (tier === 'high' && want(name)) await shoot(page, `idle/${key.slice(3)}-${tier}-${width}.png`, width === 1100 ? null : page.locator('iframe'));
          await load(page, frame, project(key));
          await runTo(frame, pauseAt);
          const iframe = width === 1100 ? null : page.locator('iframe');
          if (want(name)) await shoot(page, name, iframe);
          if (views) {
            for (const [mode, label] of [['orbit', 'Tự do'], ['follow', 'Theo xe'], ['top', 'Nhìn từ trên']]) {
              await camera(frame, label);
              // "Tự do" orbited for real: a drag about a quarter turn round the arena, a little higher.
              if (mode === 'orbit') await orbit(page, await frame.getByTestId('robot-canvas').boundingBox(), -110, 12);
              await shoot(page, `drive-to-zone-${mode}-high-1100.png`);
            }
          }
          if (follow) {
            await camera(frame, 'Theo xe');
            await shoot(page, `follow-${tier}-1100.png`);
            const box = await frame.getByTestId('robot-canvas').boundingBox();
            await zoom(page, box, 5);
            await shoot(page, `closeup-${tier}-1100.png`);
            await orbit(page, box, -200, -12);
            await shoot(page, `closeup-front-${tier}-1100.png`);
          }
          if (flag) {
            await camera(frame, 'Theo xe');
            const box = await frame.getByTestId('robot-canvas').boundingBox();
            // Round to the robot's right and a little lower, the flag against the arena's far side, clear of the HUD.
            await orbit(page, box, 160, 40);
            await shoot(page, 'servo-gate-flag-high-1100.png');
          }
          await page.close();
        }
      }
    }

    // rb-line-follow's lamps, at DPR 2: Tự do as it opens (the robot on the tape's first turn), Theo xe as it opens on a turn, and Theo
    // xe orbited to the robot's side.
    for (const tier of ['high', 'low']) {
      if (!want(`line-lamps`) && !want(tier === 'high' ? 'line-lamps-high' : 'line-lamps-low')) continue;
      const { page, frame } = await open(sharp, 'rb-line-follow');
      await setTier(frame, tier);
      await load(page, frame, project('rb-line-follow'));
      await runTo(frame, 4.4);
      await shoot(page, `line-lamps-free-${tier}-1100.png`);
      await camera(frame, 'Theo xe');
      await shoot(page, `line-lamps-follow-${tier}-1100.png`);
      const box = await frame.getByTestId('robot-canvas').boundingBox();
      await zoom(page, box, 4);
      await orbit(page, box, -150, -10);
      await shoot(page, `line-lamps-side-${tier}-1100.png`);
      await page.close();
    }

    // Kiểm tra: the card's states and the replay, on the tier the GPU starts on (high).
    if (want('check')) {
      const { page, frame } = await open(context, 'rb-drive-to-zone');
      await load(page, frame, project('rb-drive-to-zone'));
      await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
      await frame.getByTestId('robot-check-start').click();
      await sleep(1500);
      await shoot(page, 'check/01-checking-4x-1100.png');
      await frame.locator('[data-testid=robot-check-results][data-open=true]').waitFor({ timeout: 60_000 });
      await sleep(1500);
      await shoot(page, 'check/02-passed-1100.png');
      await page.close();

      const failed = await open(context, 'rb-stop-at-wall');
      await load(failed.page, failed.frame, project('rb-stop-at-wall', 'crash-and-back-off'));
      await failed.frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
      await failed.frame.getByTestId('robot-check-start').click();
      await failed.frame.locator('[data-testid=robot-check-results][data-open=true]').waitFor({ timeout: 60_000 });
      await sleep(1500);
      await shoot(failed.page, 'check/03-exploit-1100.png');
      await failed.frame.getByTestId('robot-check-fold').click();
      await sleep(1500);
      await shoot(failed.page, 'check/04-folded-1100.png');
      await failed.frame.getByTestId('robot-check-fold').click();
      await sleep(1200);
      await failed.frame.getByTestId('robot-check-replay-2').click();
      await sleep(1100);
      await shoot(failed.page, 'check/05-replay-1100.png');
      await failed.frame.getByTestId('robot-status').filter({ hasText: 'Hết lượt' }).waitFor({ timeout: 30_000 });
      await sleep(800);
      await shoot(failed.page, 'check/06-replay-end-1100.png');
      await failed.page.close();
    }
    await browser.close();
  } finally {
    stop();
  }
}

await main();
