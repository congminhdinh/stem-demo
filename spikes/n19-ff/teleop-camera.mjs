// N19 final fix (G1 M1): the free camera's distance with Lái tay off and on, in each gripper lesson and two rover lessons, in the lab
// opened at the size of the LMS's lab frame at a window size (G1 measured 948 × 450 at 1366 × 768; the others are read off its screenshots).
// Also the header's rows, the 3D view's size, and the HUD's and the view tools' corners as the camera reads them (hud-corner.ts
// `overlaysOf`). Drawn by SwiftShader, as the e2e's chromium-robot project. Run from the repository root against a dev server:
//
//   node spikes/n19-ff/teleop-camera.mjs --base=http://localhost:5580 [--only=<substring>] [--shots=<dir>]
//
// With --shots, a picture of the lab's stage (the 3D view and what floats over it) with Lái tay on, for each lesson and size.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const base = args.base ?? 'http://localhost:5580';
// The LMS's lab frame at each window (G1: 1366 × 768 → 948 × 450; 1440 × 900 and 1280 × 720 from the screenshots a20 and e04).
const frames = [
  { window: '1440x900', width: 1022, height: 582 },
  { window: '1366x768', width: 948, height: 450 },
  { window: '1280x720', width: 862, height: 450 },
];
const lessons = ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack', 'rb-drive-to-zone', 'rb-mini-mission'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function settled(page) {
  let last = '';
  for (let i = 0; i < 100; i++) {
    const now = await page.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const later = await page.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera');
    if (now === later && now === last && now) return later;
    last = later;
    await sleep(250);
  }
  return last;
}

const layout = (page) =>
  page.evaluate(() => {
    const view = document.querySelector('[data-testid=robot-scene]').getBoundingClientRect();
    const x = (px) => -1 + (2 * (px - view.left)) / view.width;
    const y = (px) => 1 - (2 * (px - view.top)) / view.height;
    const hud = document.querySelector('[data-testid=robot-hud]')?.getBoundingClientRect();
    const tools = document.querySelector('[data-testid=robot-tools]')?.getBoundingClientRect();
    const header = document.querySelector('.robot-header');
    const tops = new Set([...header.children].map((child) => Math.round(child.getBoundingClientRect().top)));
    const check = document.querySelector('[data-testid=robot-check]') ?? document.querySelector('.robot-check');
    const title = document.querySelector('[data-testid=robot-scenario]');
    return {
      view: `${Math.round(view.width)}x${Math.round(view.height)}`,
      hud: hud ? [x(hud.right + 8), y(hud.bottom + 8)].map((v) => v.toFixed(3)).join(' ') : null,
      tools: tools ? [x(tools.right + 8), y(tools.top - 8)].map((v) => v.toFixed(3)).join(' ') : null,
      headerTops: [...tops].length,
      headerHeight: Math.round(header.getBoundingClientRect().height),
      checkTop: check ? Math.round(check.getBoundingClientRect().top) : null,
      title: title ? { client: title.clientWidth, scroll: title.scrollWidth, title: title.getAttribute('title') } : null,
    };
  });

const rows = [];
try {
  for (const frame of frames) {
    for (const key of lessons) {
      if (args.only && !`${key} ${frame.window}`.includes(args.only)) continue;
      const context = await browser.newContext({ viewport: { width: frame.width, height: frame.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(`${base}/?embed=1&lab=robot&template=${key}`);
      await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
      await sleep(500);
      const off = await settled(page);
      const before = await layout(page);
      await page.getByTestId('robot-tool-teleop').click();
      await page.getByTestId('robot-teleop').waitFor();
      await sleep(500);
      const on = await settled(page);
      const during = await layout(page);
      if (args.shots) {
        mkdirSync(args.shots, { recursive: true });
        await page.locator('.robot-stage').screenshot({ path: join(args.shots, `${key}-${frame.window}-teleop.png`), animations: 'disabled' });
      }
      const [d0, d1] = [Number(off.split(' ')[0]), Number(on.split(' ')[0])];
      rows.push({ key, window: frame.window, frame: `${frame.width}x${frame.height}`, view: before.view, headerRows: before.headerTops, off, on, ratio: (d1 / d0).toFixed(2), hud: during.hud, toolsOff: before.tools, toolsOn: during.tools, title: before.title });
      process.stdout.write(`${key} ${frame.window} frame ${frame.width}x${frame.height} view ${before.view} header items' rows ${before.headerTops} (h ${before.headerHeight}) | off ${off} | on ${on} | x${(d1 / d0).toFixed(2)} | hud ${during.hud} | tools off ${before.tools} on ${during.tools} | title ${JSON.stringify(before.title)}\n`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
