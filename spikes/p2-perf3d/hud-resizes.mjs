// N18 P2 spike (evidence for p2-audit.md). Run from the repository root after pnpm bench:robot3d has built its dist:
//   node spikes/p2-perf3d/hud-resizes.mjs
// How often the HUD's box changes during a run of mini-mission and a 4x check (production build, GPU, no throttle): each change
// beyond 0.01 NDC makes CameraRig frame the free view again (freeViewPose).
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const root = process.argv[2] ?? process.cwd();
const { chromium } = await import(join(root, 'node_modules/@playwright/test/index.mjs'));
const dist = join(root, 'node_modules/.cache/bench-robot3d/dist');
const port = 5302;
const kids = [spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }), spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' })];
await new Promise((r) => setTimeout(r, 1500));
const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const project = { schemaVersion: 1, id: 'x', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions['rb-mini-mission'].reference } };
const origin = `http://localhost:${port + 1}`;
const lab = `http://localhost:${port}/?embed=1&lab=robot&template=rb-mini-mission&origin=${encodeURIComponent(origin)}`;
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
const frame = page.frames().find((f) => f.url().includes('lab=robot'));
await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60000 });
await page.evaluate(([d, o]) => window.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: d }, o), [project, `http://localhost:${port}`]);
await new Promise((r) => setTimeout(r, 2000));
const watch = () => frame.evaluate(() => {
  const stage = document.querySelector('.robot-scene');
  const view = stage.getBoundingClientRect();
  window.__hud = { changes: 0, big: 0, last: null, log: [] };
  const hud = document.querySelector('[data-testid=robot-hud]');
  new ResizeObserver(() => {
    const r = hud.getBoundingClientRect();
    const right = -1 + (2 * (r.right + 8 - view.left)) / view.width;
    const bottom = 1 - (2 * (r.bottom + 8 - view.top)) / view.height;
    const last = window.__hud.last;
    window.__hud.changes += 1;
    if (!last || Math.abs(last[0] - right) >= 0.01 || Math.abs(last[1] - bottom) >= 0.01) { window.__hud.big += 1; window.__hud.last = [right, bottom]; window.__hud.log.push([Math.round(performance.now()), Math.round(r.width), Math.round(r.height)]); }
  }).observe(hud);
});
await watch();
await frame.getByTestId('robot-run').click();
await new Promise((r) => setTimeout(r, 15000));
console.log('mini-mission run 15 s:', JSON.stringify(await frame.evaluate(() => ({ changes: window.__hud.changes, reframes: window.__hud.big - 1, sizes: window.__hud.log.slice(0, 12) }))));
await frame.getByTestId('robot-stop').click();
await watch();
await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
await frame.getByTestId('robot-check-start').click();
await frame.getByTestId('robot-check-results').waitFor({ timeout: 120000 });
console.log('check 4x:', JSON.stringify(await frame.evaluate(() => ({ changes: window.__hud.changes, reframes: window.__hud.big - 1, sizes: window.__hud.log.slice(0, 40) }))));
await browser.close();
kids.forEach((k) => k.kill());
