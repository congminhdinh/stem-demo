// N19 E6/E7's rover guard (spikes/p2-perf3d/shots.mjs, with the sandbox too: every rover scenario): deterministic production-build screenshots of the robot lab's 3D canvas, for a pixel diff before and
// after each optimisation (spikes/p2-perf3d/shots-diff.mjs). Run from the repository root:
//
//   node spikes/n19-e67/rover-shots.mjs --dist=<a vite build> --out=<dir> [--port=5472] [--only=<substring>]
//
// The build is served with `vite preview` on --port and framed by e2e/lesson-host.mjs on --port + 1, at 1100 × 640 in a 1200 × 760
// window, DPR 1, in Chromium new headless on the machine's GPU (the low tier picked with the lab's own button: the same scene a software
// renderer starts on). Every picture is of the canvas alone and of a state that is the same on every run:
//   - <pilot>-<tier>-idle.png: the view each lesson opens on ("Tự do"), the robot at its start, 2 s after the first frame (the tags in);
//   - <pilot>-<tier>-step.png: the same after 15 × Bước (1.5 s of simulated time, run paused: the same ticks every time);
//   - <pilot>-<tier>-follow.png and -top.png (drive-to-zone, line-follow, mini-mission): "Theo xe" and "Nhìn từ trên" after those steps.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
if (!args.dist || !args.out) throw new Error('Usage: node spikes/n19-e67/rover-shots.mjs --dist=<build> --out=<dir> [--port=5472] [--only=<substring>]');
const dist = resolve(args.dist);
const out = resolve(args.out);
const port = Number(args.port ?? 5472);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pilots = ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox'];
const cameraPilots = new Set(['rb-drive-to-zone', 'rb-line-follow', 'rb-mini-mission', 'rb-sandbox']);
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
    for (const tier of ['high', 'low']) {
      const name = `${key.replace(/^rb-/, '')}-${tier}`;
      if (args.only && !name.includes(args.only)) continue;
      const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const lab = `http://localhost:${port}/?embed=1&lab=robot&template=${key}&origin=${encodeURIComponent(origin)}`;
      await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
      const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
      const drawn = () => frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
      await drawn();
      if ((await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== tier) {
        await frame.getByTestId('robot-quality').click();
        await sleep(300);
        await drawn();
      }
      await page.evaluate(([document, to]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document }, to), [project(key), `http://localhost:${port}`]);
      await sleep(2000);
      const canvas = frame.locator('[data-testid=robot-canvas] canvas');
      const shot = async (suffix) => {
        await sleep(700);
        writeFileSync(join(out, `${name}-${suffix}.png`), await canvas.screenshot({ animations: 'disabled' }));
        taken.push(`${name}-${suffix}`);
      };
      await shot('idle');
      for (let i = 0; i < STEPS; i += 1) {
        await frame.getByTestId('robot-step').click();
        await sleep(120);
      }
      await shot('step');
      if (cameraPilots.has(key)) {
        for (const mode of ['follow', 'top']) {
          await frame.locator(`[data-testid=robot-camera] [data-mode=${mode}]`).click();
          await shot(mode);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
process.stdout.write(`${taken.length} shots in ${out}\n`);
