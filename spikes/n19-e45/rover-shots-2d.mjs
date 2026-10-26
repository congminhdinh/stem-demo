// N19 E4/E5's rover guard for the 2D map (spikes/n19-e67/rover-shots.mjs, whose method and scenarios this is, for the 3D canvas): deterministic
// production-build screenshots of the robot lab's 2D top view ("Xem 2D"), its sensor layer on (the cone, the spots, the goal's zone, the tag), for a
// pixel diff of BASE and HEAD (spikes/p2-perf3d/shots-diff.mjs). Run from the repository root:
//
//   node spikes/n19-e45/rover-shots-2d.mjs --dist=<a vite build> --out=<dir> [--port=5526] [--only=<substring>]
//
// The build is served with `vite preview` on --port and framed by e2e/lesson-host.mjs on --port + 1, at 1100 × 640 in a 1200 × 760 window,
// DPR 1, reduced motion (the goal zone's pulse stands still). Every picture is of the map alone, of a state that is the same on every run:
//   - <pilot>-2d-idle.png: the map each lesson opens on in 2D, the robot at its start;
//   - <pilot>-2d-step.png: the same after 15 × Bước (1.5 s of simulated time, run paused: the same ticks every time).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
if (!args.dist || !args.out) throw new Error('Usage: node spikes/n19-e45/rover-shots-2d.mjs --dist=<build> --out=<dir> [--port=5526] [--only=<substring>]');
const dist = resolve(args.dist);
const out = resolve(args.out);
const port = Number(args.port ?? 5526);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pilots = ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox'];
const STEPS = 15;

const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const project = (key) => ({ schemaVersion: 1, id: `p2-${key}`, name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: (robotSolutions[key] ?? robotSolutions['rb-drive-to-zone']).reference } });

const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const origin = `http://localhost:${port + 1}`;
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const taken = [];
try {
  await sleep(1500);
  for (const key of pilots) {
    const name = `${key.replace(/^rb-/, '')}-2d`;
    if (args.only && !name.includes(args.only)) continue;
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const lab = `http://localhost:${port}/?embed=1&lab=robot&template=${key}&origin=${encodeURIComponent(origin)}`;
    await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
    const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    // "Xem 2D": the map instead of the 3D canvas.
    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-topview] canvas').first().waitFor({ timeout: 60_000 });
    await page.evaluate(([document, to]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document }, to), [project(key), `http://localhost:${port}`]);
    await sleep(2000);
    const map = frame.getByTestId('robot-topview');
    const shot = async (suffix) => {
      await sleep(700);
      writeFileSync(join(out, `${name}-${suffix}.png`), await map.screenshot({ animations: 'disabled' }));
      taken.push(`${name}-${suffix}`);
    };
    await shot('idle');
    for (let i = 0; i < STEPS; i += 1) {
      await frame.getByTestId('robot-step').click();
      await sleep(120);
    }
    await shot('step');
    await context.close();
  }
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
process.stdout.write(`${taken.length} shots in ${out}\n`);
