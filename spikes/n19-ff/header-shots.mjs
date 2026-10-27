// N19 final fix (G1 c2): the lab header of every lesson, for a pixel diff of BASE and HEAD (spikes/p2-perf3d/shots-diff.mjs): the rover's
// must be unchanged, the gripper lessons' keep Kiểm tra on the row of the run's controls at 1022 px. Run from the repository root:
//
//   node spikes/n19-ff/header-shots.mjs --dist=<a vite build> --out=<dir> [--port=5588]
//
// The build is served with `vite preview` on --port; the lab is opened by its URL (?embed=1&lab=robot&template=<key>) in a window of the
// LMS's lab frame at 1440 × 900 (1022 × 582) and of the lesson host's frame (1100 × 640), DPR 1, Chromium new headless. Each picture is the
// header (`.robot-header`) alone, 800 ms after the lab is there.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
if (!args.dist || !args.out) throw new Error('Usage: node spikes/n19-ff/header-shots.mjs --dist=<build> --out=<dir> [--port=5588]');
const out = resolve(args.out);
const port = Number(args.port ?? 5588);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const keys = ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox', 'rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'];
const preview = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', resolve(args.dist), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
let taken = 0;
try {
  await sleep(1500);
  for (const [width, height] of [
    [1022, 582],
    [1100, 640],
  ]) {
    for (const key of keys) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await page.goto(`http://localhost:${port}/?embed=1&lab=robot&template=${key}`);
      await page.getByTestId('robot-lab').waitFor();
      await sleep(800);
      writeFileSync(join(out, `${key.replace(/^rb-/, '')}-${width}.png`), await page.locator('.robot-header').screenshot({ animations: 'disabled' }));
      taken += 1;
      await page.close();
    }
  }
} finally {
  await browser.close();
  preview.kill();
}
process.stdout.write(`${taken} shots in ${out}\n`);
