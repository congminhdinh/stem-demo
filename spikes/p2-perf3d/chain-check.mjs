// N18 P2 Phase B #3: the low tier's chain end to end, on a production build. The school PC profile (SwiftShader, the low tier, CPU 6x,
// 1366 x 768), the lab in its lesson frame, rb-line-follow's reference program run for --seconds; every 250 ms the view's state: whether
// a run is drawn at 30 fps (the "Đang vẽ 30 hình mỗi giây" note), whether the 2D map is offered, whether the 2D map is up. Run beside
// spikes/p2-perf3d/busy.mjs for a busy machine. From the repository root:
//
//   node spikes/p2-perf3d/chain-check.mjs --dist=<build> [--seconds=20] [--port=5307] [--accept] [--shot=<png>]
// --accept: take the offer when it comes, then check the run goes on in the 2D map. --shot: a picture of the lab frame when the cap's
// note or the offer first shows (the offer's wins).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const dist = resolve(args.dist);
const port = Number(args.port ?? 5307);
const seconds = Number(args.seconds ?? 20);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const document = { schemaVersion: 1, id: 'chain', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions['rb-line-follow'].reference } };
const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await sleep(1500);
  const origin = `http://localhost:${port + 1}`;
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const lab = `http://localhost:${port}/?embed=1&lab=robot&template=rb-line-follow&origin=${encodeURIComponent(origin)}`;
  await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  const tier = await frame.getByTestId('robot-quality').getAttribute('data-tier');
  await page.evaluate(([d, o]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: d }, o), [document, `http://localhost:${port}`]);
  await sleep(2000);
  // Frames drawn, counted in the lab frame (each requestAnimationFrame callback that drew the canvas is not visible from here: count
  // the animation frames and the canvas's draws through WebGL's drawElements).
  await frame.evaluate(() => {
    const state = (globalThis.__chain = { draws: 0, frames: [] });
    const canvas = document.querySelector('[data-testid=robot-canvas] canvas');
    const gl = canvas.getContext('webgl2');
    const draw = gl.drawElements.bind(gl);
    let last = -1;
    gl.drawElements = (...a) => {
      const now = performance.now();
      if (now - last > 4) state.frames.push(now);
      last = now;
      state.draws += 1;
      return draw(...a);
    };
  });
  const started = Date.now();
  await frame.getByTestId('robot-run').click();
  const seen = [];
  let accepted = false;
  let shotNote = false;
  let shotOffer = false;
  while (Date.now() - started < seconds * 1000) {
    await sleep(250);
    const state = await frame.evaluate(() => ({
      note: document.querySelector('[data-testid=robot-quality-note]')?.textContent ?? null,
      offer: document.querySelector('[data-testid=robot-offer-2d]') !== null,
      map: document.querySelector('[data-testid=robot-topview]') !== null,
      status: document.querySelector('[data-testid=robot-status]')?.textContent ?? null,
      frames: globalThis.__chain?.frames.length ?? 0,
    }));
    const key = `${state.note ?? '-'} | offer ${state.offer} | map ${state.map}`;
    if (seen.at(-1)?.key !== key) seen.push({ at: ((Date.now() - started) / 1000).toFixed(2), key, status: state.status });
    if (args.shot && (state.offer || (state.note && !shotNote))) {
      shotNote = true;
      if (state.offer && !shotOffer) shotOffer = true;
      if (state.offer || !shotOffer) await page.screenshot({ path: resolve(args.shot) });
    }
    if (state.offer && 'accept' in args && !accepted) {
      accepted = true;
      await frame.getByTestId('robot-offer-2d-accept').click();
    }
  }
  const frames = await frame.evaluate(() => globalThis.__chain.frames);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? null;
  const thirds = [0, 1, 2].map((k) => gaps.slice(Math.floor((k * gaps.length) / 3), Math.floor(((k + 1) * gaps.length) / 3)));
  const status = await frame.getByTestId('robot-status').textContent().catch(() => null);
  process.stdout.write(`tier ${tier}; ${frames.length} drawn frames in ${seconds} s; median gap by thirds: ${thirds.map((list) => median(list)?.toFixed(1) ?? '—').join(' / ')} ms; status at the end: ${status}\n`);
  for (const step of seen) process.stdout.write(`  ${step.at} s: ${step.key} (${step.status})\n`);
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}
