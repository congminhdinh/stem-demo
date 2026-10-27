// N19 E9: the gripper pose change (gripper-pose.ts reads the mount by index; robot-assembly.ts poseGripper does nothing for an arm that has not
// moved) draws the same pixels. Not product code. The 3D look page of E6/E7 (e2e/robot-gripper-look.html: Scene.tsx with a fixture snapshot of the
// gripper car) on two trees, a BASE and a HEAD, each served by its own vite on its own port; the same states on both tiers, SwiftShader
// (--use-angle=swiftshader, as project chromium-robot), 1100 x 640 at DPR 1; every state is taken twice per tree, and a tree's two shots of a state
// must match each other first (a run is not always bit-identical, N18 P2). Prints one line a state and exits 1 on a difference.
//
//   node spikes/n19-e9/pose-pixels.mjs --base=http://localhost:5551 --head=http://localhost:5550 [--out=<dir for the PNGs>]
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origins = { base: args.base, head: args.head };
const out = args.out ? resolve(args.out) : null;
if (out) mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const states = [
  { name: 'up-open', query: { lift: 90, claw: 0 } },
  { name: 'down-open', query: { lift: 0, claw: 0, ahead: 'cube-red' } },
  { name: 'level-half', query: { lift: 40, claw: 40 } },
  { name: 'held-raised', query: { lift: 90, claw: 26.97, held: 'cube-red', heldAt: 4, sensors: 'seen' } },
  { name: 'down-closed-idle', query: { lift: 10, claw: 80, status: 'idle' } },
];
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let different = 0;
try {
  for (const tier of ['high', 'low']) {
    for (const state of states) {
      const hashes = {};
      for (const [tree, origin] of Object.entries(origins)) {
        hashes[tree] = [];
        for (let take = 0; take < 2; take++) {
          const context = await browser.newContext({ viewport: { width: 1100, height: 640 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(String(error)));
          await page.goto(`${origin}/e2e/robot-gripper-look.html?${new URLSearchParams({ tier, camera: 'follow', status: 'running', ...state.query })}`);
          await page.waitForFunction(() => window.__gripperLook === 'drawn', null, { timeout: 90_000 });
          await sleep(1500);
          const png = await page.locator('#view canvas').screenshot();
          hashes[tree].push(createHash('sha256').update(png).digest('hex').slice(0, 12));
          if (out) writeFileSync(join(out, `${tier}-${state.name}-${tree}-${take}.png`), png);
          if (errors.length) console.log('page errors', errors);
          await context.close();
        }
      }
      const stable = hashes.base[0] === hashes.base[1] && hashes.head[0] === hashes.head[1];
      const same = hashes.base.some((hash) => hashes.head.includes(hash));
      if (!same) different++;
      console.log(`${tier} ${state.name.padEnd(17)} base ${hashes.base.join(' ')}  head ${hashes.head.join(' ')}  ${same ? (stable ? 'identical' : 'identical (one shot of the tree differs from its other)') : 'DIFFERENT'}`);
    }
  }
} finally {
  await browser.close();
}
process.exit(different ? 1 : 0);
