// N18 P2 fix round 1 (M8): a picture of the 2D offer with a long check result open, on the dev server (its robot hooks force the
// offer). rb-mini-mission's reference program checked with "Nhanh" (its results card lists five goals), then the offer forced. Run from
// the repository root; it starts vite on --port and the lesson host on --port + 1:
//
//   node spikes/p2-perf3d/offer-over-result.mjs --out=<png> [--port=5304]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const port = Number(args.port ?? 5304);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  await sleep(4000);
  const origin = `http://localhost:${port + 1}`;
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 })).newPage();
  const lab = `http://localhost:${port}/?embed=1&lab=robot&template=rb-mini-mission&origin=${encodeURIComponent(origin)}`;
  await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  const document = { schemaVersion: 1, id: 'offer', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions['rb-mini-mission'].reference } };
  await frame.evaluate((d) => window.__stem.loadProject(d), document);
  await frame.locator('[data-testid=robot-check-speed] [data-speed=fast]').click();
  await frame.getByTestId('robot-check-start').click();
  await frame.getByTestId('robot-check-results').waitFor({ timeout: 120_000 });
  await frame.evaluate(() => window.__stem.robot.forceLowTierStep('offer'));
  await frame.getByTestId('robot-offer-2d').waitFor();
  await sleep(800);
  const stacked = await frame.evaluate(() => {
    const offer = document.querySelector('[data-testid=robot-offer-2d]').getBoundingClientRect();
    const card = document.querySelector('[data-testid=robot-check-results]').getBoundingClientRect();
    const top = document.elementFromPoint(offer.left + offer.width / 2, offer.top + 6);
    return { offer: [offer.top, offer.bottom], card: [card.top, card.bottom], overlap: card.bottom > offer.top, offerOnTop: top?.closest('[data-testid=robot-offer-2d]') !== null };
  });
  await page.screenshot({ path: resolve(args.out) });
  process.stdout.write(`${JSON.stringify(stacked)}\n`);
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
