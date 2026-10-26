// N18 P2 fix round 1 (I1): first Run → moving in the LMS's order. The lesson page sends load-project the moment the lab says ready
// (STEMLearning's useLabHost does, before the robot lab's chunk has loaded), nothing is pressed, the view is left 3 s at rest after its
// first frame, then Chạy is clicked (a programmatic click: no pointerdown, so only the host's project counts as the lab's use) and timed
// to the first render with the robot moved (scripts/lib/robot3d-probe.js clickAndWatch). Also: whether Rapier was fetched before the click.
// Run from the repository root (vite preview on --port, the lesson host on --port + 1):
//
//   node spikes/p2-perf3d/lms-order.mjs --dist=<build> [--profile=school|gpu] [--port=5306] [--label=<name>]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const dist = resolve(args.dist);
const port = Number(args.port ?? 5306);
const school = (args.profile ?? 'school') === 'school';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const document = { schemaVersion: 1, id: 'lms', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions['rb-line-follow'].reference } };
const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const browser = await chromium.launch(school ? { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { headless: true, channel: 'chromium' });
try {
  await sleep(1500);
  const origin = `http://localhost:${port + 1}`;
  const labOrigin = `http://localhost:${port}`;
  const context = await browser.newContext({ viewport: school ? { width: 1366, height: 768 } : { width: 1200, height: 760 } });
  await context.addInitScript({ path: join(root, 'scripts/lib/robot3d-probe.js') });
  // The lesson page answers the lab's ready with load-project at once, as the LMS does.
  await context.addInitScript(
    ([d, to]) => {
      if (location.pathname !== '/lesson') return;
      window.addEventListener('message', (event) => {
        if (event.data?.protocol === 'stem-lab/v1' && event.data.type === 'ready') window.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: d }, to);
      });
    },
    [document, labOrigin],
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (school) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const rapier = [];
  const t0 = Date.now();
  page.on('request', (request) => {
    if (/rapier/.test(request.url())) rapier.push(Date.now() - t0);
  });
  const lab = `${labOrigin}/?embed=1&lab=robot&template=rb-line-follow&origin=${encodeURIComponent(origin)}`;
  await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  const drawnAt = Date.now() - t0;
  await sleep(3000);
  const beforeClick = rapier.length;
  const clickAt = Date.now() - t0;
  const firstRunToMovingMs = await frame.evaluate(() => window.__p2.clickAndWatch('[data-testid=robot-run]', 30000));
  const loaded = await frame.evaluate(() => window.__stem === undefined && document.querySelector('[data-testid=robot-lab]') !== null);
  process.stdout.write(
    `${JSON.stringify({ label: args.label ?? dist, profile: school ? 'school' : 'gpu', drawnAt, rapierRequestsBeforeClick: beforeClick, firstRapierRequestAt: rapier[0] ?? null, clickAt, firstRunToMovingMs: firstRunToMovingMs === null ? null : Math.round(firstRunToMovingMs), production: loaded })}\n`,
  );
  await context.close();
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
