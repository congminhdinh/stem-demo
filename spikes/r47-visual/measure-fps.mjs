// N18 R4.7: R4.2's harness (spikes/r42-lab-fps/measure.mjs), on this task's ports (--port, default 5252, and the next for the lesson
// host), its results to results/<--out> (default fps.json), the cells chosen with --tiers=high,low, --rates=1,4 and --dpr, extra lab
// query parameters with --extra=a=b, and --no-build to measure the last build again. It waits for the scene's first frame
// (`data-drawn`) before the project and the Run, and also records firstFrameMs (the lesson page's navigation to the scene's first
// frame) and runToMovingMs (a second Run, the physics loaded: the click to the first frame drawn after the clock moved).
//
// results/: fps-after-gpu.json, fps-after-swiftshader.json, fps-after-gpu-dpr2.json (R4.7's final code); fps-master-97adda4-*.json
// (master before R4.7, the same harness, run from a `git archive` of it); fps-before-*.json (master d9ab65b, R4.2's scene alone);
// fps-first-pass.jsonl (R4.7 before the first-frame work: compileAsync, the early load, fewer low-tier programs); ab-gate-on/off.json
// (the GPU's first frame with and without compileAsync, a temporary `r47gate=0` switch since removed: no difference).
//
// Frame rate of the robot lab as a learner sees it (N18 R4.2/R4.4): the production build in the LMS's 1100 x 640 iframe, running the
// line-follow reference program at 1×, in the high and the low quality tier, with and without a 4× CPU throttle, on the machine's GPU
// and on SwiftShader. Evidence for the report, not product code (spikes/ is outside lint and tsconfig). Run from the repository root:
//
//   node spikes/r47-visual/measure-fps.mjs [--repeats=3] [--seconds=8] [--warmup=2] [--only=gpu|swiftshader] [--tiers=high,low] [--rates=1,4] [--dpr=1|2] [--out=fps.json] [--no-build]
//
// It builds the app (vite build → spikes/r47-visual/dist), serves it with `vite preview` on :5252 (the product's COOP/COEP headers) and
// e2e/lesson-host.mjs on :5253, opens the lab framed by the lesson page with the LMS's sandbox and `origin=`, loads the reference program
// over stem-lab/v1 (`load-project`, as the LMS does: a production build has no test hooks), picks the tier with the lab's own button,
// presses Chạy and measures.
//
// What is measured, per cell: the page time of every frame the 3D view draws to the screen (a `clear` of WebGL's default framebuffer,
// which three does once per render; the shadow pass clears its own target and is not counted), the draw calls per frame, how much
// simulated time passed per second of page time (1.0 = real time at 1×), the HUD's "slower than real time" badge, and the first Run's
// time from the click to "Đang chạy" (physics load and init, compile, world). median fps = 1000 / median(frame interval); p5 fps =
// 1000 / p95(interval), the slowest 5 % of frames. The CPU throttle is CDP Emulation.setCPUThrottlingRate on the page (the frame is the
// same site, localhost, so the same renderer process: a fixed loop timed inside the frame proves it); it slows the main thread, not the
// GPU process or SwiftShader's rasterizer threads.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const results = join(here, 'results');
const outDir = join(here, 'dist');
const resultFile = args.out ?? 'fps.json';
mkdirSync(results, { recursive: true });

const LAB_PORT = Number(args.port ?? 5252);
const HOST_PORT = LAB_PORT + 1;
const SANDBOX = 'allow-scripts allow-same-origin allow-downloads';
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const GROUPS = {
  gpu: { label: 'Chromium new headless, the machine GPU (ANGLE Metal), vsync 60 Hz', launch: { headless: true, channel: 'chromium' } },
  swiftshader: { label: 'Chromium headless shell, --use-angle=swiftshader --enable-unsafe-swiftshader', launch: { headless: true, args: SWIFTSHADER } },
};

const repeats = Number(args.repeats ?? 3);
const seconds = Number(args.seconds ?? 8);
const warmup = Number(args.warmup ?? 2);
const only = args.only ?? null;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
const round = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? null : Number(n.toFixed(d)));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

/** The reference program of rb-line-follow and the robot project it goes in, from the sources (Node strips the types). */
async function lineFollowProject() {
  const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
  return {
    schemaVersion: 1,
    id: 'r42-fps',
    name: 'Robot',
    profile: 'uno-basic',
    kit: { id: 'ref-uno-rover', version: '0' },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks: robotSolutions['rb-line-follow'].reference },
  };
}

function startServers() {
  if (!('no-build' in args)) execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' });
  const children = [
    spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', outDir, '--port', String(LAB_PORT), '--strictPort'], { cwd: root, stdio: 'ignore' }),
    spawn(process.execPath, ['e2e/lesson-host.mjs', String(HOST_PORT)], { cwd: root, stdio: 'ignore' }),
  ];
  return () => children.forEach((child) => child.kill());
}

async function waitFor(url) {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error(`${url} did not come up`);
}

const lessonOrigin = `http://localhost:${HOST_PORT}`;
const labQuery = `embed=1&lab=robot&template=rb-line-follow&origin=${encodeURIComponent(lessonOrigin)}${args.extra ? `&${args.extra}` : ''}`;
const hostUrl = `${lessonOrigin}/lesson?lab=${encodeURIComponent(`http://localhost:${LAB_PORT}/?${labQuery}`)}&sandbox=${encodeURIComponent(SANDBOX)}`;

/** Counts, in every frame of the page, the draws of each WebGL context to the screen. */
function frameProbe() {
  const stamps = [];
  const draws = [];
  let drawsInFrame = 0;
  window.__r42 = { stamps, draws, reset: () => ((stamps.length = 0), (draws.length = 0)) };
  for (const Context of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Context) continue;
    const clear = Context.prototype.clear;
    Context.prototype.clear = function (mask) {
      if (this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
        stamps.push(performance.now());
        draws.push(drawsInFrame);
        drawsInFrame = 0;
      }
      return clear.call(this, mask);
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const draw = Context.prototype[name];
      if (!draw) continue;
      Context.prototype[name] = function (...rest) {
        drawsInFrame += 1;
        return draw.apply(this, rest);
      };
    }
  }
}

async function cell(browser, project, { group, tier, rate }) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: Number(args.dpr ?? 1) });
  await context.addInitScript(frameProbe);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text().slice(0, 200)));
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  if (rate !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const navigated = Date.now();
  await page.goto(hostUrl);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  await frame.getByTestId('robot-canvas').locator('canvas').waitFor({ timeout: 60_000 });
  // Time to the first frame of the scene (the tier the renderer starts on), from the lesson page's navigation.
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  const firstFrameMs = Date.now() - navigated;
  const load = os.loadavg()[0];
  const cpuBenchMs = await frame.evaluate(() => {
    const start = performance.now();
    let x = 0;
    for (let i = 0; i < 3e7; i += 1) x += i % 7;
    return performance.now() - start + x * 0;
  });
  // The tier: the lab's own button, until the canvas says the tier asked for.
  for (let i = 0; i < 2 && (await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== tier; i += 1) {
    await frame.getByTestId('robot-quality').click();
    await sleep(500);
  }
  const shownTier = await frame.getByTestId('robot-canvas').getAttribute('data-tier');
  // N18 R4.7: the scene of the tier drawn (its models loaded, its first frame), before the project and the Run.
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  // The project, as the LMS sends it.
  await page.evaluate(([document, origin]) => window.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document }, origin), [project, `http://localhost:${LAB_PORT}`]);
  // The reference's own blocks (the starter has no `if`): the project is in the editor.
  await frame.locator('[data-testid=blockly-panel] .blocklyText', { hasText: /^nếu$/ }).first().waitFor();
  const clicked = Date.now();
  await frame.getByTestId('robot-run').click();
  await frame.getByTestId('robot-status').filter({ hasText: 'Đang chạy' }).waitFor({ timeout: 60_000 });
  const firstRunMs = Date.now() - clicked;
  // N18 R4.7: a second Run, the physics loaded: the click to the first frame drawn with the robot moved (stem-lab/v1 has no
  // hook in a production build, so the canvas's draws are watched: the first draw after the click that follows a new snapshot).
  await sleep(warmup * 500);
  const runToMovingMs = await frame.evaluate(async () => {
    const reset = document.querySelector('[data-testid=robot-reset]');
    reset?.click();
    await new Promise((done) => setTimeout(done, 400));
    const drawsBefore = window.__r42.stamps.length;
    const start = performance.now();
    document.querySelector('[data-testid=robot-run]')?.click();
    while (performance.now() - start < 5000) {
      await new Promise((done) => requestAnimationFrame(done));
      const time = document.querySelector('[data-testid=robot-time]')?.textContent ?? '';
      if (window.__r42.stamps.length > drawsBefore + 1 && /[1-9]/.test(time.replace(/\/.*$/, ''))) return Math.round(window.__r42.stamps[drawsBefore + 1] - start);
    }
    return null;
  });
  await sleep(warmup * 1000);
  const simAt = async () => Number((await frame.getByTestId('robot-time').textContent()).replace(/^[^0-9]*([0-9]+),([0-9]).*$/, '$1.$2'));
  const simStart = await simAt();
  await frame.evaluate(() => window.__r42.reset());
  const wallStart = Date.now();
  let slowSeen = false;
  const until = wallStart + seconds * 1000;
  while (Date.now() < until) {
    slowSeen ||= (await frame.getByTestId('robot-slower').count()) > 0;
    await sleep(250);
  }
  const { stamps, draws } = await frame.evaluate(() => ({ stamps: [...window.__r42.stamps], draws: [...window.__r42.draws] }));
  const simEnd = await simAt();
  const renderer = await frame.evaluate(() => {
    const gl = document.querySelector('[data-testid=robot-canvas] canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { name: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  });

  const wallS = (Date.now() - wallStart) / 1000;
  const intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
  const sorted = [...intervals].sort((a, b) => a - b);
  await context.close();
  return {
    group,
    tier,
    shownTier,
    cpuThrottle: rate,
    frames: stamps.length,
    medianFps: round(1000 / pct(sorted, 0.5)),
    p5Fps: round(1000 / pct(sorted, 0.95)),
    meanFps: round(stamps.length / seconds),
    framesOver50ms: sorted.filter((v) => v > 50).length,
    drawCallsPerFrame: median(draws.slice(1)),
    simSecondsPerSecond: round((simEnd - simStart) / wallS, 2),
    slowerBadgeSeen: slowSeen,
    firstRunMs,
    firstFrameMs,
    runToMovingMs,
    renderer: renderer.name,
    drawingBuffer: renderer.buffer,
    loadavg1m: round(load, 2),
    cpuBenchMs: round(cpuBenchMs, 0),
    consoleErrors: problems,
  };
}

async function main() {
  const stop = startServers();
  try {
    await waitFor(`http://localhost:${LAB_PORT}/`);
    await waitFor(`${lessonOrigin}/lesson`);
    const project = await lineFollowProject();
    const cells = [];
    for (const [group, definition] of Object.entries(GROUPS)) {
      if (only !== null && only !== group) continue;
      const browser = await chromium.launch(definition.launch);
      for (const tier of (args.tiers ?? 'high,low').split(',')) {
        for (const rate of (args.rates ?? '1,4').split(',').map(Number)) {
          for (let run = 1; run <= repeats; run += 1) {
            const measured = await cell(browser, project, { group, tier, rate });
            console.log(JSON.stringify({ run, ...measured, consoleErrors: measured.consoleErrors.length }));
            cells.push({ run, ...measured });
          }
        }
      }
      await browser.close();
    }
    const machine = { cpus: os.cpus()[0]?.model, cores: os.cpus().length, memGB: round(os.totalmem() / 2 ** 30, 0), platform: `${os.type()} ${os.release()}`, node: process.version };
    const file = join(results, resultFile);
    writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), machine, groups: GROUPS, seconds, warmup, repeats, cells }, null, 2)}\n`);
    console.log(`written ${file}`);
  } finally {
    stop();
  }
}

await main();
