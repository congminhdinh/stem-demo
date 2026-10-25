// The robot lab's 3D view as a learner's browser runs it (N18 P2): frame times, the main thread's time per frame and where it goes, long
// tasks, React commits, the GPU's resources, the heap over a soak, the first frame and Run → moving, measured on the production build
// in the LMS's 1100 × 640 lesson frame. `pnpm verify` does not run it (it takes a browser and minutes); run it on a quiet machine
// (`uptime`: every cell records the 1-minute load average next to its numbers).
//
//   node scripts/bench-robot3d.mjs [--profiles=a,b] [--scenarios=x,y] [--repeats=3] [--seconds=8] [--soak-minutes=10] [--switches=20]
//                                  [--pass=fps|profile|all] [--skip=x,y] [--sensors=on|off] [--port=5300] [--no-build | --dist=<dir>] [--label=<name>] [--out=<dir>] [--smoke]
//                                  [--targets] [--report=a.json,b.json (the tables again from earlier results, merged)]
//   pnpm bench:robot3d
//
// It builds the app (`vite build --sourcemap hidden`: the same bytes as `pnpm build`, the source maps beside them for the profiles) into
// node_modules/.cache/bench-robot3d/dist, serves it with `vite preview` on --port (the product's COOP/COEP headers; default 5300) and
// e2e/lesson-host.mjs on the next port, and opens the lab framed by the lesson page with the LMS's sandbox and `origin=`, the programs
// sent over stem-lab/v1 (`load-project`: a production build has no test hooks). Each cell is a new browser context (a cold HTTP cache).
//
// Profiles (the machine each stands for):
//   gpu-high          Chromium new headless on the machine's GPU, the high tier, DPR 1 (the plan's mid-range laptop, as far as one is here)
//   ss-low-4x         SwiftShader (no GPU), the low tier, CPU throttled 4× (the plan's "low tier at 4×")
//   school            the school PC: SwiftShader, the low tier, CPU 6×, DPR 1, a 1366 × 768 window
//   *-sim4x           the same at 4× simulation speed (8 ticks a frame at 60 fps): gpu-high-sim4x, ss-low-4x-sim4x, school-sim4x
// The CPU throttle is CDP Emulation.setCPUThrottlingRate: it slows the main thread (the frame is the same site, so the same renderer
// process), not the GPU process or SwiftShader's raster threads; a real school PC is slower there too.
//
// Scenarios: idle (the view at rest, then an orbit drag and its settling), the pilots' reference runs (drive-to-zone with its rest after
// parking, line-follow, mini-mission; --scenarios=pilots adds square-route, stop-at-wall, servo-gate), check-1x and check-4x (Kiểm tra of
// mini-mission: 1× for a window, 4× the whole check), follow (line-follow under "Theo xe"), teleop (Lái tay in the sandbox, the keys held),
// pins and cpp (line-follow with the "Cổng & chân" or the C++ tab open), soak (the sandbox's loop followed for --soak-minutes, a new Run
// when one ends: the heap after a garbage collection every minute) and switch (--switches × "Xem 2D" ↔ 3D, then × the quality tier).
//
// Passes: fps (no profiler: the frame times) and profile (the same windows under V8's CPU profiler and its sampling heap profiler, the
// samples mapped to their sources: what the main thread does per frame, the simulation, three's render and its shadow map, React, Blockly,
// the scene's frame callbacks, GC, and what allocates). scripts/lib/robot3d-probe.js is the page's side (it says what each series is).
//
// Output: <out>/bench-robot3d-<time>.json (every cell) and .md (the tables, the ranges over the repeats, the budgets). Budget rows (robot
// plan §5) exit 1 when missed; target rows (the P2 brief's for Phase B) are told, and count only with --targets.
// Exit codes: 0 every budget holds; 1 a budget is missed or a measurement failed; 2 a usage error.

import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { attributeCpuProfile, attributeHeapProfile, loadSourceMaps } from './lib/profile-attribution.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cacheDir = join(root, 'node_modules', '.cache', 'bench-robot3d');
/** The build measured: the script's own (built at start), or --dist's (a build made elsewhere, e.g. an A/B variant). */
let distDir = join(cacheDir, 'dist');
const probePath = join(root, 'scripts', 'lib', 'robot3d-probe.js');

class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const log = (line) => process.stdout.write(`${line}\n`);
const round = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits)));
const load1 = () => round(os.loadavg()[0], 2);

// ---------------------------------------------------------------------------------------------------------------------------------
// Profiles and scenarios

const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const COMMON_ARGS = [];
const LAB_VIEWPORT = { width: 1200, height: 760 };

const PROFILES = {
  'gpu-high': { label: 'GPU (Chromium new headless, the machine GPU), high tier, DPR 1', launch: { headless: true, channel: 'chromium', args: COMMON_ARGS }, tier: 'high', cpu: 1, viewport: LAB_VIEWPORT, dpr: 1, speed: 1 },
  'ss-low-4x': { label: 'SwiftShader (headless shell), low tier, CPU 4×, DPR 1', launch: { headless: true, args: [...SWIFTSHADER, ...COMMON_ARGS] }, tier: 'low', cpu: 4, viewport: LAB_VIEWPORT, dpr: 1, speed: 1 },
  school: { label: 'school PC: SwiftShader, low tier, CPU 6×, DPR 1, 1366 × 768 window', launch: { headless: true, args: [...SWIFTSHADER, ...COMMON_ARGS] }, tier: 'low', cpu: 6, viewport: { width: 1366, height: 768 }, dpr: 1, speed: 1 },
};
for (const name of ['gpu-high', 'ss-low-4x', 'school']) PROFILES[`${name}-sim4x`] = { ...PROFILES[name], label: `${PROFILES[name].label}, 4× simulation speed`, speed: 4 };

/** What each scenario opens and does. `window` is the measuring window (s) after `warmup` (s); `rest` measures after the robot parks. */
const SCENARIOS = {
  // A new browser for each repeat: the first lab a browser opens (its GPU process, SwiftShader's shader JIT and V8 all cold).
  idle: { template: 'rb-line-follow', program: 'rb-line-follow', action: 'idle', freshBrowser: true },
  'drive-to-zone': { template: 'rb-drive-to-zone', program: 'rb-drive-to-zone', action: 'run', warmup: 0.5, window: 4, rest: { from: 7, window: 3 } },
  'line-follow': { template: 'rb-line-follow', program: 'rb-line-follow', action: 'run', warmup: 2 },
  'mini-mission': { template: 'rb-mini-mission', program: 'rb-mini-mission', action: 'run', warmup: 2 },
  'square-route': { template: 'rb-square-route', program: 'rb-square-route', action: 'run', warmup: 2 },
  'stop-at-wall': { template: 'rb-stop-at-wall', program: 'rb-stop-at-wall', action: 'run', warmup: 2 },
  'servo-gate': { template: 'rb-servo-gate', program: 'rb-servo-gate', action: 'run', warmup: 2 },
  'check-1x': { template: 'rb-mini-mission', program: 'rb-mini-mission', action: 'check', speed: '1x', warmup: 2 },
  'check-4x': { template: 'rb-mini-mission', program: 'rb-mini-mission', action: 'check', speed: '4x', warmup: 0, whole: true },
  follow: { template: 'rb-line-follow', program: 'rb-line-follow', action: 'run', warmup: 2, camera: 'follow' },
  teleop: { template: 'rb-sandbox', program: null, action: 'teleop', warmup: 1 },
  pins: { template: 'rb-line-follow', program: 'rb-line-follow', action: 'run', warmup: 2, tab: 2 },
  cpp: { template: 'rb-line-follow', program: 'rb-line-follow', action: 'run', warmup: 2, tab: 1 },
  soak: { template: 'rb-sandbox', program: 'rb-line-follow', action: 'soak' },
  switch: { template: 'rb-line-follow', program: null, action: 'switch' },
};
const DEFAULT_SCENARIOS = {
  'gpu-high': ['idle', 'drive-to-zone', 'line-follow', 'mini-mission', 'check-1x', 'check-4x', 'follow', 'teleop', 'pins', 'cpp', 'switch', 'soak'],
  'ss-low-4x': ['idle', 'drive-to-zone', 'line-follow', 'mini-mission', 'check-1x', 'check-4x', 'follow', 'teleop', 'pins', 'cpp'],
  school: ['idle', 'drive-to-zone', 'line-follow', 'mini-mission', 'check-1x', 'check-4x', 'follow', 'teleop', 'pins', 'cpp', 'switch', 'soak'],
  'gpu-high-sim4x': ['line-follow', 'mini-mission'],
  'ss-low-4x-sim4x': ['line-follow', 'mini-mission'],
  'school-sim4x': ['line-follow', 'mini-mission'],
};
const PROFILE_PASS_SCENARIOS = ['line-follow', 'mini-mission', 'check-4x', 'follow', 'teleop', 'pins', 'cpp'];
const PILOTS = ['drive-to-zone', 'square-route', 'stop-at-wall', 'line-follow', 'servo-gate', 'mini-mission'];

function parseArguments(argv) {
  const options = { profiles: Object.keys(PROFILES), scenarios: null, repeats: 3, seconds: 8, soakMinutes: 10, switches: 20, pass: 'all', skip: [], sensors: 'on', port: 5300, build: true, dist: null, label: null, out: join(cacheDir, 'results'), smoke: false, targets: false };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    const number = () => {
      const parsed = Number(value);
      if (!(Number.isFinite(parsed) && parsed > 0)) throw new Failure(2, `--${key} needs a number above 0, not ${value}.`);
      return parsed;
    };
    if (key === 'profiles') options.profiles = value.split(',');
    else if (key === 'scenarios') options.scenarios = value.split(',').flatMap((name) => (name === 'pilots' ? PILOTS : [name]));
    else if (key === 'skip') options.skip = value.split(',');
    else if (key === 'sensors' && ['on', 'off'].includes(value)) options.sensors = value;
    else if (key === 'repeats') options.repeats = number();
    else if (key === 'seconds') options.seconds = number();
    else if (key === 'soak-minutes') options.soakMinutes = number();
    else if (key === 'switches') options.switches = number();
    else if (key === 'port') options.port = number();
    else if (key === 'pass' && ['fps', 'profile', 'all'].includes(value)) options.pass = value;
    else if (key === 'out') options.out = resolve(value);
    else if (key === 'no-build') options.build = false;
    else if (key === 'dist') Object.assign(options, { dist: resolve(value), build: false });
    else if (key === 'label') options.label = value;
    else if (key === 'report') options.report = value.split(',').map((file) => resolve(file));
    else if (key === 'smoke') options.smoke = true;
    else if (key === 'targets') options.targets = true;
    else throw new Failure(2, `Unknown option ${arg}. See the top of scripts/bench-robot3d.mjs.`);
  }
  for (const profile of options.profiles) if (!PROFILES[profile]) throw new Failure(2, `Unknown profile ${profile}: ${Object.keys(PROFILES).join(', ')}.`);
  for (const scenario of options.scenarios ?? []) if (!SCENARIOS[scenario]) throw new Failure(2, `Unknown scenario ${scenario}: ${Object.keys(SCENARIOS).join(', ')}, pilots.`);
  if (options.smoke) Object.assign(options, { repeats: 1, seconds: 2, soakMinutes: 0.5, switches: 2 });
  return options;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Build, bundle, servers

function build() {
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', distDir, '--emptyOutDir', '--sourcemap', 'hidden', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' });
}

/** The build's chunks and files (gzip -6), and which chunks hold three, R3F, GLTFLoader, the meshopt decoder and Rapier. */
function bundleReport() {
  const assets = join(distDir, 'assets');
  const gz = (bytes) => gzipSync(bytes, { level: 6 }).length;
  const markers = { three: 'isWebGLRenderer', r3f: 'Hooks can only be used within the Canvas', gltfLoader: 'KHR_materials_emissive_strength', meshopt: 'decodeGltfBuffer', rapier: 'rawrigidbodyset' };
  const chunks = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const bytes = readFileSync(join(assets, file));
      const text = bytes.toString('utf8');
      return { file, bytes: bytes.length, gzip: gz(bytes), holds: Object.entries(markers).filter(([, marker]) => text.includes(marker)).map(([name]) => name) };
    })
    .sort((a, b) => b.gzip - a.gzip);
  const files = readdirSync(assets)
    .filter((file) => file.endsWith('.wasm'))
    .map((file) => {
      const bytes = readFileSync(join(assets, file));
      return { file, bytes: bytes.length, gzip: gz(bytes) };
    });
  // A build from before R4.7 has no model files.
  const glbs = (existsSync(join(distDir, 'robot3d')) ? readdirSync(join(distDir, 'robot3d')) : []).map((file) => {
    const bytes = readFileSync(join(distDir, 'robot3d', file));
    return { file, bytes: bytes.length, gzip: gz(bytes) };
  });
  const lab = chunks.find((chunk) => /^RobotLab-.*\.js$/.test(chunk.file));
  const entryHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
  return { chunks, wasm: files, glbs, robotLabGzip: lab?.gzip ?? null, entryPreloads: [...entryHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]) };
}

function startServers(port) {
  const children = [
    spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', distDir, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
    spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
  ];
  return () => children.forEach((child) => child.kill());
}

async function waitFor(url) {
  for (let i = 0; i < 150; i += 1) {
    try {
      if ((await globalThis.fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Failure(1, `${url} did not come up.`);
}

/** The caching and compression headers `vite preview` sends for the files the lab loads. */
async function servedHeaders(port, bundle) {
  const lab = bundle.chunks.find((chunk) => /^RobotLab-/.test(chunk.file));
  const paths = ['/', `/assets/${lab?.file}`, '/robot3d/robot-kit.glb?v=1', ...bundle.wasm.map((file) => `/assets/${file.file}`)];
  const out = {};
  for (const path of paths) {
    const response = await globalThis.fetch(`http://localhost:${port}${path}`, { headers: { 'Accept-Encoding': 'gzip, br' } });
    await response.arrayBuffer();
    out[path.replace(/-[\w-]{8}\./, '-*.')] = { cacheControl: response.headers.get('cache-control'), contentEncoding: response.headers.get('content-encoding'), etag: response.headers.get('etag') !== null };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The lab in its lesson frame

const SANDBOX = 'allow-scripts allow-same-origin allow-downloads';

async function projects() {
  const solutions = await import(join(root, 'src/samples/robot-solutions.ts'));
  const project = (blocks) => ({
    schemaVersion: 1,
    id: 'bench-robot3d',
    name: 'Robot',
    profile: 'uno-basic',
    kit: { id: 'ref-uno-rover', version: '0' },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks },
  });
  return Object.fromEntries(Object.entries(solutions.robotSolutions).map(([key, solution]) => [key, project(solution.reference)]));
}

/** The id of the first block of a Blockly workspace's JSON (to see it drawn in the editor). */
function firstBlockId(json) {
  const stack = [json];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node && typeof node === 'object') {
      if (typeof node.type === 'string' && typeof node.id === 'string') return node.id;
      stack.push(...Object.values(node));
    }
  }
  return null;
}

function urls(port, template) {
  const origin = `http://localhost:${port + 1}`;
  const query = `embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(origin)}`;
  return { lab: `http://localhost:${port}`, frame: `http://localhost:${port}/?${query}`, host: `${origin}/lesson?lab=${encodeURIComponent(`http://localhost:${port}/?${query}`)}&sandbox=${encodeURIComponent(SANDBOX)}` };
}

const p2 = (frame, expression) => frame.evaluate(expression);

async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}

async function pageMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

const metricDelta = (before, after, seconds) =>
  Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => [`${name}PerSecondMs`, round((((after[name] ?? 0) - (before[name] ?? 0)) * 1000) / seconds, 1)]));

/** The browser's own CDP session (one per launch): the CPU time of its processes, to see the GPU process's (SwiftShader's raster). */
const browserSessions = new WeakMap();
async function processCpu(browser) {
  if (!browserSessions.has(browser)) browserSessions.set(browser, await browser.newBrowserCDPSession());
  const { processInfo } = await browserSessions.get(browser).send('SystemInfo.getProcessInfo');
  const byType = {};
  for (const { type, cpuTime } of processInfo) byType[type] = (byType[type] ?? 0) + cpuTime;
  return byType;
}

async function startCpuProfile(cdp) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
}

/**
 * Opens the lab of `template` in a new context of `browser` as `profile` sets it, to its first frame on the profile's tier; with
 * `maps`, under V8's CPU profiler from the navigation to that frame (what the main thread did before it).
 */
async function openLab(browser, profile, template, port, maps = null) {
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.dpr });
  await context.addInitScript({ path: probePath });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text().slice(0, 240)));
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 240)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (profile.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const { host } = urls(port, template);
  if (maps) await startCpuProfile(cdp);
  const navigated = Date.now();
  await page.goto(host);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  if (!frame) throw new Failure(1, 'The lesson page has no lab frame.');
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  const firstFrameMs = Date.now() - navigated;
  let loadingCpu = null;
  if (maps) {
    const { profile: cpuProfile } = await cdp.send('Profiler.stop');
    loadingCpu = attributeCpuProfile(cpuProfile, maps, { top: 25 });
    await cdp.send('Profiler.disable');
  }
  // Where the lab frame's clock starts on the lesson page's (the frame's timings are its own).
  const frameOffsetMs = (await frame.evaluate('performance.timeOrigin')) - (await page.evaluate('performance.timeOrigin'));
  // The tier the profile asks for: the lab's own button, until it says that tier (a software renderer starts on low, a GPU on high).
  let switchedTier = false;
  for (let i = 0; i < 2 && (await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== profile.tier; i += 1) {
    switchedTier = true;
    await frame.getByTestId('robot-quality').click();
    await sleep(300);
  }
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
  return { context, page, frame, cdp, problems, firstFrameMs, frameOffsetMs, switchedTier, loadingCpu };
}

async function loadProject(page, frame, project, port) {
  if (!project) return;
  await page.evaluate(([document, origin]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document }, origin), [project, urls(port).lab]);
  const id = firstBlockId(project.program.blocks);
  if (id) await frame.locator(`[data-testid=blockly-panel] [data-id="${id}"]`).first().waitFor({ timeout: 60_000 });
}

/**
 * Measures `during` (async): the probe's window, the page's task metrics, and under `profiled` V8's CPU profiler (250 µs samples) and
 * its sampling heap profiler (collected objects included), mapped to their sources.
 */
async function measure(frame, cdp, during, { profiled = false, maps = null, browser = null } = {}) {
  if (profiled) {
    await cdp.send('HeapProfiler.enable');
    try {
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    } catch {
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
    }
    await startCpuProfile(cdp);
  }
  const before = await pageMetrics(cdp);
  const processesBefore = browser ? await processCpu(browser) : null;
  const loadBefore = load1();
  await p2(frame, 'window.__p2.begin()');
  const started = Date.now();
  const extra = await during();
  const summary = await p2(frame, 'window.__p2.summary()');
  const seconds = (Date.now() - started) / 1000;
  const after = await pageMetrics(cdp);
  const result = { ...summary, ...(extra ?? {}), page: metricDelta(before, after, seconds), loadavg1m: [loadBefore, load1()] };
  if (processesBefore) {
    // CPU time of each kind of process over the window: per animation frame (ms), and in cores (CPU s per wall s). With SwiftShader the
    // GPU process's is the rasterisation a computer without a GPU does on its CPU, which the main thread's numbers do not show.
    const processesAfter = await processCpu(browser);
    result.processCpu = Object.fromEntries(
      Object.entries(processesAfter).map(([type, cpuS]) => {
        const deltaS = cpuS - (processesBefore[type] ?? 0);
        return [type, { msPerFrame: summary.animationFrames > 0 ? round((deltaS * 1000) / summary.animationFrames, 2) : null, cores: round(deltaS / seconds, 2) }];
      }),
    );
  }
  if (profiled) {
    const { profile } = await cdp.send('Profiler.stop');
    const { profile: sampling } = await cdp.send('HeapProfiler.stopSampling');
    result.cpu = attributeCpuProfile(profile, maps, { frames: summary.animationFrames });
    result.alloc = attributeHeapProfile(sampling, maps, { frames: summary.animationFrames, top: 40 });
    await cdp.send('Profiler.disable');
  }
  return result;
}

const status = (frame) => frame.getByTestId('robot-hud').getAttribute('data-status');
const OVER = new Set(['timeUp', 'crashed', 'error', 'stopped', 'idle']);

async function setSpeed(frame, speed) {
  if (speed === 1) return;
  const index = [0.5, 1, 2, 4].indexOf(speed);
  await frame.locator('[data-testid=robot-speed] [role=radio]').nth(index).click();
}

/** Runs the program: the first Run (Rapier loads) to its robot moving, then Đặt lại and a warm Run to moving (robot plan §5's budget). */
async function runTwice(frame) {
  const firstRunToMovingMs = await p2(frame, `window.__p2.clickAndWatch('[data-testid=robot-run]', 30000)`);
  await frame.locator('[data-testid=robot-hud][data-status=running]').waitFor({ timeout: 60_000 });
  await sleep(600);
  // Dừng keeps where the robot got to; Đặt lại then shows the start, from where the warm Run is timed.
  await frame.getByTestId('robot-stop').click();
  await sleep(400);
  await frame.getByTestId('robot-reset').click();
  await sleep(600);
  const runToMovingMs = await p2(frame, `window.__p2.clickAndWatch('[data-testid=robot-run]', 30000)`);
  return { firstRunToMovingMs: round(firstRunToMovingMs, 0), runToMovingMs: round(runToMovingMs, 0) };
}

/** One cell: a profile, a scenario, a repeat, on a new context. */
async function cell(browser, profileName, scenarioName, run, options, shared) {
  const profile = PROFILES[profileName];
  const scenario = SCENARIOS[scenarioName];
  const seconds = scenario.window ?? options.seconds;
  const profiled = run.pass === 'profile';
  const measured = { profile: profileName, scenario: scenarioName, pass: run.pass, repeat: run.repeat, loadavg1m: load1(), started: new Date().toISOString() };
  const lab = await openLab(browser, profile, scenario.template, options.port, profiled ? shared.maps : null);
  const { page, frame, cdp } = lab;
  try {
    measured.firstFrameMs = lab.firstFrameMs;
    measured.switchedTier = lab.switchedTier;
    measured.frameOffsetMs = round(lab.frameOffsetMs, 1);
    if (lab.loadingCpu) measured.loadingCpu = lab.loadingCpu;
    measured.loading = await p2(frame, 'window.__p2.loading()');
    // The lab's main thread as fast as this cell had it: a fixed loop (3·10⁷ steps) in the frame, after the CPU throttle. The host's
    // scheduler (performance or efficiency cores, other work) moves it between cells; a row's numbers scale with it.
    // N18 R4.3's sensor overlays ("Hiện cảm biến", on by default): --sensors=off turns them off with the lab's own switch, for their A/B.
    measured.sensors = options.sensors;
    const sensorSwitch = frame.getByTestId('robot-sensors');
    if (options.sensors === 'off' && (await sensorSwitch.count()) > 0 && (await sensorSwitch.getAttribute('aria-pressed')) === 'true') {
      await sensorSwitch.click();
      await sleep(300);
    }
    measured.cpuBenchMs = await p2(frame, '(() => { const s = performance.now(); let x = 0; for (let i = 0; i < 3e7; i += 1) x += i % 7; return Math.round(performance.now() - s + x * 0); })()');
    await loadProject(page, frame, scenario.program ? shared.projects[scenario.program] : null, options.port);
    await sleep(1500);
    const opts = { profiled: false, maps: shared.maps, browser };
    measured.idle = await measure(frame, cdp, () => sleep(3000), opts);
    const windowOpts = { profiled, maps: shared.maps, browser };

    if (scenario.action === 'idle') {
      // An orbit drag over the view, then its damping settling, then rest again.
      const canvas = frame.locator('[data-testid=robot-canvas] canvas');
      const box = await canvas.boundingBox();
      measured.drag = await measure(
        frame,
        cdp,
        async () => {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          for (let i = 0; i < 40; i += 1) {
            await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + Math.sin(i / 6) * 20);
            await sleep(25);
          }
          await page.mouse.up();
        },
        windowOpts,
      );
      // The damping settles frame by frame (slower in wall time where frames are slow): wait for 1 s with no frame (15 s at most).
      const settleFrom = Date.now();
      let last = await p2(frame, 'window.__p2.state.frames.length');
      let quietSince = Date.now();
      while (Date.now() - quietSince < 1000 && Date.now() - settleFrom < 15_000) {
        await sleep(100);
        const now = await p2(frame, 'window.__p2.state.frames.length');
        if (now !== last) [last, quietSince] = [now, Date.now()];
      }
      measured.settleMs = Date.now() - settleFrom - 1000;
      measured.afterDrag = await measure(frame, cdp, () => sleep(3000), opts);
    } else if (scenario.action === 'run') {
      await setSpeed(frame, profile.speed);
      if (scenario.camera) await frame.locator(`[data-testid=robot-camera] [data-mode=${scenario.camera}]`).click();
      if (scenario.tab !== undefined) await frame.locator('[data-testid=program-region] [role=tab]').nth(scenario.tab).click();
      Object.assign(measured, await runTwice(frame));
      await sleep(scenario.warmup * 1000);
      measured.window = await measure(frame, cdp, () => sleep(seconds * 1000), windowOpts);
      if (scenario.rest) {
        const elapsed = scenario.warmup + seconds;
        await sleep(Math.max(0, scenario.rest.from - elapsed) * 1000);
        measured.rest = await measure(frame, cdp, () => sleep(scenario.rest.window * 1000), opts);
      }
      measured.endStatus = await status(frame);
    } else if (scenario.action === 'check') {
      await frame.locator(`[data-testid=robot-check-speed] [data-speed="${scenario.speed}"]`).click();
      const clicked = Date.now();
      await frame.getByTestId('robot-check-start').click();
      await sleep(scenario.warmup * 1000);
      measured.window = await measure(
        frame,
        cdp,
        async () => {
          if (scenario.whole) {
            await frame.getByTestId('robot-check-results').waitFor({ timeout: 180_000 });
            return { checkMs: Date.now() - clicked };
          }
          await sleep(seconds * 1000);
          return null;
        },
        windowOpts,
      );
      if (!scenario.whole) await frame.getByTestId('robot-check-cancel').click();
    } else if (scenario.action === 'teleop') {
      await frame.getByTestId('robot-tool-teleop').click();
      await frame.locator('[data-testid=robot-hud][data-status=teleop]').waitFor({ timeout: 60_000 });
      await page.keyboard.down('ArrowUp');
      await sleep(scenario.warmup * 1000);
      measured.window = await measure(
        frame,
        cdp,
        async () => {
          // Forward, with a turn to the left every second (the sandbox's walls stop a robot driven straight).
          const until = Date.now() + seconds * 1000;
          while (Date.now() < until) {
            await page.keyboard.down('ArrowLeft');
            await sleep(350);
            await page.keyboard.up('ArrowLeft');
            await sleep(650);
          }
        },
        windowOpts,
      );
      await page.keyboard.up('ArrowUp');
    } else if (scenario.action === 'soak') {
      Object.assign(measured, await soak(frame, cdp, options, browser));
    } else if (scenario.action === 'switch') {
      Object.assign(measured, await switches(page, frame, cdp, options));
    }
    measured.inventory = await p2(frame, 'window.__p2.inventory()');
    measured.renderer = await p2(frame, 'window.__p2.rendererInfo()');
    measured.endTier = await frame.getByTestId('robot-quality').getAttribute('data-tier');
    measured.problems = lab.problems;
  } finally {
    measured.loadavg1mEnd = load1();
    await lab.context.close();
  }
  return measured;
}

/** The sandbox's loop line followed for the soak's minutes; a new Run when one ends. Every minute: the heap after a collection. */
async function soak(frame, cdp, options, browser) {
  const minutes = [];
  await frame.getByTestId('robot-run').click();
  await frame.locator('[data-testid=robot-hud][data-status=running]').waitFor({ timeout: 60_000 });
  await p2(frame, 'window.__p2.trim()');
  const heapStartB = await heapAfterGc(cdp);
  const contextsStart = await p2(frame, 'window.__p2.summary().contexts');
  let runs = 1;
  const minuteMs = Math.min(60_000, options.soakMinutes * 60_000);
  const count = Math.max(1, Math.round((options.soakMinutes * 60_000) / minuteMs));
  for (let minute = 1; minute <= count; minute += 1) {
    const summary = await measure(
      frame,
      cdp,
      async () => {
        const until = Date.now() + minuteMs - 1500;
        while (Date.now() < until) {
          if (OVER.has(await status(frame))) {
            runs += 1;
            await frame.getByTestId('robot-run').click();
          }
          await sleep(1000);
        }
      },
      { browser },
    );
    // The probe's series emptied first: only the lab's own heap is compared minute to minute.
    await p2(frame, 'window.__p2.trim()');
    const heapB = await heapAfterGc(cdp);
    minutes.push({ minute, heapB, framesDrawn: summary.framesDrawn, frameMs: summary.frameMs, busyMs: summary.busyMs, longTasks: summary.longTasks, commits: summary.commits, renderer: summary.renderer, contexts: summary.contexts, processCpu: summary.processCpu, loadavg1m: summary.loadavg1m });
    log(`    soak minute ${minute}/${count}: heap ${(heapB / 2 ** 20).toFixed(2)} MiB, ${summary.framesDrawn} frames, p95 ${round(summary.frameMs?.p95)} ms, load ${summary.loadavg1m[1]}`);
  }
  const heapEndB = minutes.at(-1).heapB;
  const baseB = minutes[0].heapB;
  return { soak: { minutes, runs, heapStartB, heapAfterMinute1B: baseB, heapEndB, growthPercent: round(((heapEndB - baseB) / baseB) * 100, 2), contextsStart } };
}

/**
 * `options.switches` × "Xem 2D" and back to 3D, then × the quality tier and back, then half as many scenario switches (the lesson frame
 * loads another pilot, as the LMS does from one lesson to the next): what the GPU, the heap and the DOM hold after each.
 */
async function switches(page, frame, cdp, options) {
  const sample = async (kind, index) => {
    await sleep(700);
    await p2(frame, 'window.__p2.trim()');
    const heapB = await heapAfterGc(cdp);
    const dom = await cdp.send('Memory.getDOMCounters');
    const summary = await p2(frame, '({ contexts: window.__p2.summary().contexts, renderer: window.__p2.rendererInfo(), renderers: window.__p2.state.renderers.length })');
    return { kind, index, heapB, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners, ...summary };
  };
  let step = 'start';
  try {
    return await switchesSteps(page, frame, cdp, options, sample, (name) => (step = name));
  } catch (error) {
    throw new Error(`switch step ${step}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, { cause: error });
  }
}

async function switchesSteps(page, frame, cdp, options, sample, at) {
  const samples = [await sample('start', 0)];
  for (let i = 1; i <= options.switches; i += 1) {
    at(`2d-3d ${i}`);
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor({ timeout: 60_000 });
    await sleep(300);
    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
    samples.push(await sample('2d-3d', i));
  }
  for (let i = 1; i <= options.switches; i += 1) {
    at(`tier ${i}`);
    await frame.getByTestId('robot-quality').click();
    await sleep(300);
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
    if (i % 2 === 0) samples.push(await sample('tier', i));
  }
  for (let i = 1; i <= Math.max(2, Math.round(options.switches / 2)); i += 1) {
    const template = SCENARIOS[PILOTS[i % PILOTS.length]].template;
    at(`scenario ${i} ${template}`);
    await page.evaluate(`document.querySelector('iframe').src = ${JSON.stringify(urls(options.port, template).frame)}`);
    await frame.locator(`[data-testid=robot-lab][data-scenario=${template}]`).waitFor({ timeout: 120_000 });
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
    samples.push(await sample('scenario', i));
  }
  const of = (kind) => samples.filter((entry) => entry.kind === kind);
  const growth = (list, pick) => (list.length < 2 ? null : pick(list.at(-1)) - pick(list[0]));
  const growthOf = (list) => ({
    heapGrowthB: growth(list, (s) => s.heapB),
    liveContextsGrowth: growth(list, (s) => s.contexts.live),
    geometriesGrowth: growth(list, (s) => s.renderer?.geometries ?? 0),
    texturesGrowth: growth(list, (s) => s.renderer?.textures ?? 0),
    programsGrowth: growth(list, (s) => s.renderer?.programs ?? 0),
    documentsGrowth: growth(list, (s) => s.documents),
    listenersGrowth: growth(list, (s) => s.listeners),
  });
  return { switch: { samples, views: growthOf(of('2d-3d')), tiers: growthOf(of('tier')), scenarios: growthOf(of('scenario')) } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Summaries, budgets, tables

const fps = (frameMs) => (frameMs?.p50 ? 1000 / frameMs.p50 : null);
const p5fps = (frameMs) => (frameMs?.p95 ? 1000 / frameMs.p95 : null);

/** The numbers a cell's table row shows. */
function rowOf(measured) {
  const w = measured.window ?? measured.drag ?? null;
  const loading = measured.loading;
  // The first render that drew the scene (an older probe had only the first render, which may be the empty scene's).
  const firstRender = loading?.firstSceneRender ?? loading?.firstRender;
  const compiles = loading?.compiles ?? [];
  const parses = loading?.parses ?? [];
  const glb = (loading?.resources ?? []).filter((resource) => resource.name.startsWith('robot3d/'));
  // The loading timeline on the lesson page's clock (the frame's timings plus where its clock starts). Time to interactive: the end of
  // the last long task that starts less than 2 s after the one before it (or after the first render), from the first render on.
  const offset = measured.frameOffsetMs ?? 0;
  const at = (ms) => (ms === null || ms === undefined ? null : round(ms + offset, 0));
  const tasks = (loading?.longTasks ?? []).filter((task) => firstRender && task.start + task.ms > firstRender.at - 50).sort((a, b) => a.start - b.start);
  let tti = firstRender ? firstRender.at + firstRender.ms : null;
  for (const task of tasks) if (tti !== null && task.start - tti < 2000) tti = Math.max(tti, task.start + task.ms);
  const labJs = (loading?.resources ?? []).find((resource) => /^assets\/RobotLab-.*\.js$/.test(resource.name));
  const longBeforeFirst = (loading?.longTasks ?? []).filter((task) => firstRender && task.start < firstRender.at);
  const commitsPerS = (summary) => (summary ? Object.fromEntries(Object.entries(summary.commits).map(([name, count]) => [name, round(count / summary.seconds, 1)])) : null);
  return {
    fps: round(fps(w?.frameMs)),
    p5fps: round(p5fps(w?.frameMs)),
    frameP50: round(w?.frameMs?.p50),
    frameP95: round(w?.frameMs?.p95),
    frameP99: round(w?.frameMs?.p99),
    busyP50: round(w?.busyMs?.p50),
    busyP95: round(w?.busyMs?.p95),
    renderCallP50: round(w?.renderCallMs?.p50, 2),
    drawsScreen: w?.drawsScreen?.p50 ?? null,
    drawsOffscreen: w?.drawsOffscreen?.p50 ?? null,
    triangles: w?.triangles ?? null,
    longTasks: w?.longTasks?.count ?? null,
    longOver100: w?.longTasks?.over100 ?? null,
    longMaxMs: round(w?.longTasks?.maxMs, 0),
    commitsRun: commitsPerS(w),
    commitsIdle: commitsPerS(measured.idle),
    idleDrawsPerS: measured.idle ? round(measured.idle.framesDrawn / measured.idle.seconds, 2) : null,
    restDrawsPerS: measured.rest ? round(measured.rest.framesDrawn / measured.rest.seconds, 2) : measured.afterDrag ? round(measured.afterDrag.framesDrawn / measured.afterDrag.seconds, 2) : null,
    allocPerFrameKB: w?.alloc ? round(w.alloc.perFrameB / 1024, 1) : null,
    taskPerS: w?.page?.TaskDurationPerSecondMs ?? null,
    tagChangesPerS: w && w.tagSpotChanges !== undefined ? round(w.tagSpotChanges / w.seconds, 1) : null,
    gpuProcMsPerFrame: w?.processCpu?.GPU?.msPerFrame ?? null,
    gpuProcCores: w?.processCpu?.GPU?.cores ?? null,
    rendererProcMsPerFrame: w?.processCpu?.renderer?.msPerFrame ?? null,
    rendererProcCores: w?.processCpu?.renderer?.cores ?? null,
    scriptPerS: w?.page?.ScriptDurationPerSecondMs ?? null,
    gpuMB: measured.inventory ? round(measured.inventory.gpuBytes.total / 2 ** 20, 1) : null,
    programs: measured.renderer?.programs ?? null,
    firstFrameMs: measured.firstFrameMs,
    ttiMs: at(tti),
    labJsEndMs: at(labJs?.end),
    rendererMadeMs: at(loading?.rendererMadeAt),
    parseEndMs: parses.length ? at(Math.max(...parses.map((parse) => parse.end ?? parse.begin))) : null,
    compileBeginMs: at(compiles[0]?.begin),
    compileEndMs: at(compiles[0]?.end),
    firstRenderAtMs: firstRender ? at(firstRender.at + firstRender.ms) : null,
    longBeforeFirstMs: round(longBeforeFirst.reduce((sum, task) => sum + task.ms, 0), 0),
    longBeforeFirstMax: longBeforeFirst.length ? round(Math.max(...longBeforeFirst.map((task) => task.ms)), 0) : 0,
    firstRenderMs: firstRender ? round(firstRender.ms, 0) : null,
    compileMs: compiles[0]?.end ? round(compiles[0].end - compiles[0].begin, 0) : null,
    glbParseMs: parses.length ? round(Math.max(...parses.map((parse) => (parse.end ?? parse.begin) - parse.begin)), 0) : null,
    glbFetchEndMs: glb.length ? at(Math.max(...glb.map((resource) => resource.end))) : null,
    firstRunToMovingMs: measured.firstRunToMovingMs ?? null,
    runToMovingMs: measured.runToMovingMs ?? null,
    simPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs.sim, 2) : null,
    renderPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs.render + w.cpu.perFrameMs['shadow map'], 2) : null,
    shadowPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs['shadow map'], 2) : null,
    reactPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs['react-dom'] + w.cpu.perFrameMs['r3f reconciler'], 2) : null,
    blocklyPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs.blockly, 2) : null,
    scenePerFrameMs: w?.cpu ? round(w.cpu.perFrameMs['scene callbacks'], 2) : null,
    gcPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs.gc, 2) : null,
    browserPerFrameMs: w?.cpu ? round(w.cpu.perFrameMs.browser, 2) : null,
    busyPerFrameMsCpu: w?.cpu ? round(w.cpu.busyPerFrameMs, 2) : null,
    checkMs: w?.checkMs ?? null,
    endTier: measured.endTier,
    cpuBenchMs: measured.cpuBenchMs ?? null,
    load: measured.loadavg1m,
  };
}

const range = (values, digits = 1) => {
  const known = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
  if (known.length === 0) return '—';
  const [low, high] = [Math.min(...known), Math.max(...known)];
  return low === high ? `${round(low, digits)}` : `${round(low, digits)}–${round(high, digits)}`;
};

function groups(cells, pass) {
  const by = new Map();
  for (const measured of cells.filter((entry) => entry.pass === pass && !entry.error)) {
    const key = `${measured.profile} · ${measured.scenario}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push({ measured, row: rowOf(measured) });
  }
  return by;
}

/** Budget rows (robot plan §5: exit 1 when missed) and target rows (the P2 brief's Phase B targets: told). */
function judge(cells, bundle) {
  const rows = [];
  const fpsCells = cells.filter((entry) => entry.pass === 'fps' && !entry.error);
  const of = (profile, scenarios = null) => fpsCells.filter((entry) => entry.profile === profile && (scenarios === null || scenarios.includes(entry.scenario)));
  const add = (kind, name, values, test, unit, detail) => {
    const known = values.filter((value) => value !== null && value !== undefined);
    if (known.length === 0) return;
    const worst = test.worst(known);
    rows.push({ kind, name, value: worst, unit, ok: test.ok(worst), limit: test.limit, detail, n: known.length });
  };
  const atMost = (limit) => ({ worst: (values) => Math.max(...values), ok: (value) => value <= limit, limit: `≤ ${limit}` });
  const atLeast = (limit) => ({ worst: (values) => Math.min(...values), ok: (value) => value >= limit, limit: `≥ ${limit}` });
  const runs = ['drive-to-zone', 'line-follow', 'mini-mission', 'square-route', 'stop-at-wall', 'servo-gate', 'follow', 'pins', 'cpp', 'check-1x', 'teleop'];
  if (bundle.robotLabGzip !== null) add('budget', '3D chunk RobotLab-*.js, gzip -6', [bundle.robotLabGzip / 1000], atMost(600), 'kB', 'robot plan §5');
  add('budget', 'gpu-high: median fps of every run', of('gpu-high', runs).map((entry) => fps(entry.window?.frameMs)), atLeast(50), 'fps', 'the plan’s ≥ 50 fps mid-range');
  add('budget', 'ss-low-4x: p5 fps of every run', of('ss-low-4x', runs).map((entry) => p5fps(entry.window?.frameMs)), atLeast(30), 'fps', 'the plan’s ≥ 30 fps low tier at 4×');
  add('budget', 'Run → moving (warm), every profile', fpsCells.map((entry) => entry.runToMovingMs), atMost(300), 'ms', 'click to the first render with the robot moved');
  add('budget', 'ss-low-4x: first Run → moving (physics loads)', of('ss-low-4x').map((entry) => entry.firstRunToMovingMs), atMost(1500), 'ms', 'the plan’s init physics ≤ 1.5 s at 4×');
  add('budget', 'draws per second at rest', fpsCells.flatMap((entry) => [entry.idle, entry.rest, entry.afterDrag].filter(Boolean).map((summary) => summary.framesDrawn / summary.seconds)), atMost(0), '/s', 'idle before a run, a parked robot, after an orbit settles');
  for (const entry of fpsCells.filter((cellEntry) => cellEntry.soak)) add('budget', `${entry.profile}: JS heap growth over the soak (minute 1 → end)`, [entry.soak.growthPercent], atMost(5), '%', `${entry.soak.minutes.length} min, ${entry.soak.runs} runs`);

  const schoolRuns = of('school', runs);
  add('target', 'school: p95 frame time running at 1×', schoolRuns.map((entry) => entry.window?.frameMs?.p95), atMost(33), 'ms', 'every run scenario, low tier');
  add('target', 'school: p95 frame time running at 4×', [...of('school-sim4x'), ...of('school', ['check-4x'])].map((entry) => entry.window?.frameMs?.p95), atMost(33), 'ms', 'sim speed 4× and Kiểm tra 4×');
  add('target', 'school: long tasks > 100 ms during a run', [...schoolRuns, ...of('school-sim4x'), ...of('school', ['check-4x'])].map((entry) => entry.window?.longTasks?.over100), atMost(0), '', 'in the measuring window');
  add('target', 'school: first frame', of('school').map((entry) => entry.firstFrameMs), atMost(2500), 'ms', 'lesson page navigation → the scene drawn');
  for (const entry of of('school', ['soak'])) add('target', 'school: heap growth over the soak', [entry.soak.growthPercent], atMost(5), '%', '10 min');
  for (const entry of fpsCells.filter((cellEntry) => cellEntry.switch)) {
    const views = entry.switch.views;
    add('target', `${entry.profile}: GPU resources growth over the 2D↔3D switches`, [Math.max(views.liveContextsGrowth ?? 0, views.geometriesGrowth ?? 0, views.texturesGrowth ?? 0)], atMost(0), '', 'live WebGL contexts, geometries, textures');
  }
  add('target', 'gpu-high: p95 frame time running', of('gpu-high', runs).map((entry) => entry.window?.frameMs?.p95), atMost(20), 'ms', 'every run scenario');
  return rows;
}

function markdown(report) {
  const lines = [];
  const { options, machine, bundle, headers, cells, verdicts } = report;
  lines.push(`# bench:robot3d — ${report.date}${options.label ? ` — ${options.label}` : ''}`, '');
  lines.push(`Machine: ${machine.cpus} (${machine.cores} cores, ${machine.memGB} GB), ${machine.platform}, Node ${machine.node}, Chromium ${machine.chromium}.`);
  lines.push(`Commit ${report.commit}. Sensor overlays ${options.sensors ?? 'on'} (where the build has them). Repeats ${options.repeats}, window ${options.seconds} s, soak ${options.soakMinutes} min, switches ${options.switches}. 1-minute load average from ${range(cells.map((entry) => entry.loadavg1m), 2)} at the cells' start.`, '');
  lines.push('## Budgets and targets', '', '| kind | measure | worst | limit | result | n | detail |', '|---|---|---|---|---|---|---|');
  for (const row of verdicts) lines.push(`| ${row.kind} | ${row.name} | ${round(row.value, 1)} ${row.unit} | ${row.limit} ${row.unit} | ${row.ok ? 'ok' : row.kind === 'budget' ? 'MISSED' : 'not met'} | ${row.n} | ${row.detail} |`);
  lines.push('', '## Frames (fps pass): ranges over the repeats', '');
  lines.push('| profile · scenario | fps | p5 fps | frame p50 / p95 / p99 ms | main thread p50 / p95 ms | render call ms | draws screen + shadow | long tasks (>100) max ms | commits/s run (idle) | tasks (script) ms/s | GPU process ms/frame (cores) | renderer process ms/frame (cores) | tag spot changes/s | CPU loop ms | load |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [key, entries] of groups(cells, 'fps')) {
    const rows = entries.map((entry) => entry.row);
    const pick = (name, digits) => range(rows.map((row) => row[name]), digits);
    const dom = rows.map((row) => row.commitsRun?.['react-dom'] ?? null);
    const domIdle = rows.map((row) => row.commitsIdle?.['react-dom'] ?? null);
    lines.push(
      `| ${key} | ${pick('fps')} | ${pick('p5fps')} | ${pick('frameP50')} / ${pick('frameP95')} / ${pick('frameP99')} | ${pick('busyP50')} / ${pick('busyP95')} | ${pick('renderCallP50', 2)} | ${pick('drawsScreen', 0)} + ${pick('drawsOffscreen', 0)} | ${pick('longTasks', 0)} (${pick('longOver100', 0)}) ${pick('longMaxMs', 0)} | ${range(dom)} (${range(domIdle)}) | ${pick('taskPerS', 0)} (${pick('scriptPerS', 0)}) | ${pick('gpuProcMsPerFrame')} (${pick('gpuProcCores', 2)}) | ${pick('rendererProcMsPerFrame')} (${pick('rendererProcCores', 2)}) | ${pick('tagChangesPerS')} | ${pick('cpuBenchMs', 0)} | ${range(rows.flatMap((row) => row.load ?? []), 2)} |`,
    );
  }
  lines.push('', '## Loading and rest (fps pass)', '');
  lines.push('On the lesson page\'s clock (ms from its navigation): the lab chunk loaded, the renderer made, the GLBs fetched and parsed, compileAsync from and to, the first frame drawn; then time to interactive and the long tasks before the first frame (total, longest).', '');
  lines.push('| profile · scenario | first frame | RobotLab.js | renderer | GLBs fetched | parsed | compile from → to | first render | TTI | long before (max) | GLB parse ms | programs | GPU MB (est.) | first Run → moving | Run → moving | draws/s idle | draws/s rest |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [key, entries] of groups(cells, 'fps')) {
    const rows = entries.map((entry) => entry.row);
    const pick = (name, digits = 0) => range(rows.map((row) => row[name]), digits);
    lines.push(
      `| ${key} | ${pick('firstFrameMs')} | ${pick('labJsEndMs')} | ${pick('rendererMadeMs')} | ${pick('glbFetchEndMs')} | ${pick('parseEndMs')} | ${pick('compileBeginMs')} → ${pick('compileEndMs')} | ${pick('firstRenderAtMs')} | ${pick('ttiMs')} | ${pick('longBeforeFirstMs')} (${pick('longBeforeFirstMax')}) | ${pick('glbParseMs')} | ${pick('programs')} | ${pick('gpuMB', 1)} | ${pick('firstRunToMovingMs')} | ${pick('runToMovingMs')} | ${pick('idleDrawsPerS', 2)} | ${pick('restDrawsPerS', 2)} |`,
    );
  }
  if (cells.some((entry) => entry.pass === 'profile')) {
    lines.push('', '## Where the main thread goes (profile pass, ms per animation frame, ranges over the repeats)', '');
    lines.push('| profile · scenario | busy | sim | render (shadow map) | React | Blockly | scene callbacks | GC | browser (style, layout, paint, GL) | alloc/frame KB | CPU loop ms | load |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [key, entries] of groups(cells, 'profile')) {
      const rows = entries.map((entry) => entry.row);
      const pick = (name) => range(rows.map((row) => row[name]), 2);
      const alloc = entries.map((entry) => (entry.measured.window?.alloc?.perFrameB ?? null) / 1024);
      lines.push(`| ${key} | ${pick('busyPerFrameMsCpu')} | ${pick('simPerFrameMs')} | ${pick('renderPerFrameMs')} (${pick('shadowPerFrameMs')}) | ${pick('reactPerFrameMs')} | ${pick('blocklyPerFrameMs')} | ${pick('scenePerFrameMs')} | ${pick('gcPerFrameMs')} | ${pick('browserPerFrameMs')} | ${range(alloc)} | ${pick('cpuBenchMs')} | ${range(rows.flatMap((row) => row.load ?? []), 2)} |`);
    }
  }
  if (cells.some((entry) => entry.pass === 'profile')) {
    const top = (record, count) => Object.entries(record).filter(([name]) => name !== '(idle)').slice(0, count).map(([name, ms]) => `${name.replace(/^node_modules\//, '')} ${round(ms, 0)}`).join('; ');
    lines.push('', '## The busiest sources (profile pass, self time in the window, ms; the first repeat)', '');
    for (const [key, entries] of groups(cells, 'profile')) {
      const first = entries[0].measured;
      if (first.window?.cpu) lines.push(`- **${key}** (${round(first.window.seconds, 1)} s, ${first.window.animationFrames} frames): ${top(first.window.cpu.topSourcesMs, 8)}. Allocates most: ${top(Object.fromEntries(Object.entries(first.window.alloc.topSourcesB).map(([name, bytes]) => [name, bytes / 2 ** 20])), 5).replace(/(\d+)(;|$)/g, '$1 MiB$2')}`);
    }
    lines.push('', '## Before the first frame (profile pass: navigation → the scene drawn, main thread self time by what ran, ms)', '');
    const kinds = ['three', 'blockly', 'react-dom', 'r3f', 'ui: robot3d', 'sim', 'webgl calls', 'browser', 'gc'];
    lines.push(`| profile · scenario | first frame | busy | ${kinds.join(' | ')} |`, `|---|---|---|${kinds.map(() => '---|').join('')}`);
    for (const [key, entries] of groups(cells, 'profile')) {
      const loads = entries.map((entry) => entry.measured.loadingCpu).filter(Boolean);
      if (loads.length === 0) continue;
      const kind = (cpu, name) => Object.entries(cpu.categoriesMs).reduce((sum, [category, ms]) => sum + (category === name || (name === 'sim' && category.startsWith('sim')) ? ms : 0), 0);
      lines.push(`| ${key} | ${range(entries.map((entry) => entry.measured.firstFrameMs), 0)} | ${range(loads.map((cpu) => cpu.busyMs), 0)} | ${kinds.map((name) => range(loads.map((cpu) => kind(cpu, name)), 0)).join(' | ')} |`);
    }
    lines.push('');
    for (const [key, entries] of groups(cells, 'profile')) {
      const first = entries[0].measured.loadingCpu;
      if (first) lines.push(`- **${key}**: ${top(first.topSourcesMs, 10)}`);
    }
  }
  const inventories = new Map();
  for (const entry of cells) if (entry.inventory && entry.pass === 'fps' && !inventories.has(entry.profile)) inventories.set(entry.profile, entry);
  if (inventories.size > 0) {
    lines.push('', '## Scene inventory (the first fps cell of each profile)', '', '| profile · scenario | meshes (visible, casting) | sprites | materials | vertices | triangles/frame | programs | GPU MB est.: textures + geometry + shadow + drawing buffer | biggest textures |', '|---|---|---|---|---|---|---|---|---|');
    for (const [profile, entry] of inventories) {
      const inv = entry.inventory;
      const mb = (bytes) => round(bytes / 2 ** 20, 1);
      const biggest = inv.textures.slice(0, 4).map((texture) => `${texture.name} ${texture.width}×${texture.height} ${texture.kind}${texture.anisotropy > 1 ? ` aniso ${texture.anisotropy}` : ''}`).join('; ');
      lines.push(`| ${profile} · ${entry.scenario} | ${inv.counts.meshes} (${inv.counts.visibleMeshes}, ${inv.counts.castShadow}) | ${inv.counts.sprites} | ${Object.entries(inv.materialTypes).map(([type, count]) => `${count} ${type.replace(/^Mesh|Material$/g, '')}`).join(', ')} | ${inv.vertices} | ${entry.window?.triangles ?? entry.drag?.triangles ?? '—'} | ${entry.renderer?.programs ?? '—'} | ${mb(inv.gpuBytes.total)}: ${mb(inv.gpuBytes.textures)} + ${mb(inv.gpuBytes.geometry)} + ${mb(inv.gpuBytes.shadowMaps)} + ${mb(inv.gpuBytes.drawingBuffer)} | ${biggest} |`);
    }
  }
  const soaks = cells.filter((entry) => entry.soak);
  if (soaks.length > 0) {
    lines.push('', '## Soak', '', '| profile | repeat | minutes | runs | heap after GC, minute 1 → end (MiB) | growth | frames/min | p95 frame ms (min–max over minutes) | live contexts | geometries / textures (end) |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const entry of soaks) {
      const minutes = entry.soak.minutes;
      lines.push(`| ${entry.profile} | ${entry.repeat} | ${minutes.length} | ${entry.soak.runs} | ${(entry.soak.heapAfterMinute1B / 2 ** 20).toFixed(2)} → ${(entry.soak.heapEndB / 2 ** 20).toFixed(2)} | ${entry.soak.growthPercent} % | ${range(minutes.map((minute) => minute.framesDrawn), 0)} | ${range(minutes.map((minute) => minute.frameMs?.p95))} | ${minutes.at(-1).contexts.live} | ${minutes.at(-1).renderer?.geometries} / ${minutes.at(-1).renderer?.textures} |`);
    }
  }
  const switched = cells.filter((entry) => entry.switch);
  if (switched.length > 0) {
    lines.push('', '## Switches (growth from the first switch to the last; the scenario switches load the lesson frame again, so its contexts and renderer are new)', '', '| profile | repeat | kind | switches | heap KB | live contexts | geometries | textures | programs | documents | listeners |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const entry of switched) {
      for (const [kind, label] of [['views', '2D ↔ 3D'], ['tiers', 'tier high ↔ low (sampled every second)'], ['scenarios', 'scenario']]) {
        const growth = entry.switch[kind];
        if (!growth) continue;
        const count = entry.switch.samples.filter((sampled) => sampled.kind === { views: '2d-3d', tiers: 'tier', scenarios: 'scenario' }[kind]).length;
        lines.push(`| ${entry.profile} | ${entry.repeat} | ${label} | ${count} | ${round(growth.heapGrowthB / 1024, 0)} | ${growth.liveContextsGrowth} | ${growth.geometriesGrowth} | ${growth.texturesGrowth} | ${growth.programsGrowth ?? '—'} | ${growth.documentsGrowth ?? '—'} | ${growth.listenersGrowth ?? '—'} |`);
      }
    }
  }
  lines.push('', '## Bundle (gzip -6)', '', '| file | bytes | gzip | holds |', '|---|---|---|---|');
  for (const chunk of bundle.chunks) lines.push(`| ${chunk.file} | ${chunk.bytes} | ${chunk.gzip} | ${chunk.holds.join(', ') || '—'} |`);
  for (const file of [...bundle.wasm, ...bundle.glbs]) lines.push(`| ${file.file} | ${file.bytes} | ${file.gzip} | |`);
  lines.push('', `Entry HTML loads: ${bundle.entryPreloads.join(', ')}.`, '', '## Served headers (vite preview)', '', '| path | Cache-Control | Content-Encoding | ETag |', '|---|---|---|---|');
  for (const [path, header] of Object.entries(headers)) lines.push(`| ${path} | ${header.cacheControl} | ${header.contentEncoding ?? 'none'} | ${header.etag ? 'yes' : 'no'} |`);
  const failed = cells.filter((entry) => entry.error);
  if (failed.length > 0) {
    lines.push('', '## Cells that failed', '');
    for (const entry of failed) lines.push(`- ${entry.profile} · ${entry.scenario} (${entry.pass} #${entry.repeat}): ${entry.error}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** --report=a.json,b.json: the tables and verdicts again from earlier runs' results, their cells together (the first run's bundle). */
function reportOnly(options) {
  const runs = options.report.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const [first] = runs;
  const cells = runs.flatMap((run) => run.cells);
  const report = { ...first, date: new Date().toISOString(), options: { ...first.options, label: options.label ?? 'merged' }, cells, verdicts: judge(cells, first.bundle), merged: options.report };
  const table = markdown(report);
  const loads = runs.map((run) => `${run.date} (${run.options.label ?? 'unlabelled'}, ${run.cells.length} cells)`).join('; ');
  mkdirSync(options.out, { recursive: true });
  const base = join(options.out, `bench-robot3d-${options.label ?? 'merged'}`);
  writeFileSync(`${base}.md`, table.replace('\n\n', `\n\nMerged from: ${loads}.\n\n`));
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`${table}\nwritten ${base}.md and .json\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.report) {
    reportOnly(options);
    return;
  }
  if (options.dist) distDir = options.dist;
  const started = Date.now();
  if (options.build) build();
  statSync(join(distDir, 'index.html'));
  const bundle = bundleReport();
  const maps = loadSourceMaps(join(distDir, 'assets'));
  const stop = startServers(options.port);
  const cells = [];
  let chromiumVersion = null;
  let headers;
  try {
    await waitFor(`http://localhost:${options.port}/`);
    await waitFor(`http://localhost:${options.port + 1}/lesson`);
    headers = await servedHeaders(options.port, bundle);
    const shared = { projects: await projects(), maps };
    const passes = options.pass === 'all' ? ['fps', 'profile'] : [options.pass];
    for (const pass of passes) {
      for (const profileName of options.profiles) {
        const scenarios = (options.scenarios ?? DEFAULT_SCENARIOS[profileName]).filter((name) => !options.skip.includes(name) && (pass === 'fps' || PROFILE_PASS_SCENARIOS.includes(name)));
        if (scenarios.length === 0) continue;
        let browser = await chromium.launch(PROFILES[profileName].launch);
        chromiumVersion ??= browser.version();
        try {
          for (const scenarioName of scenarios) {
            if (pass === 'profile' && ['soak', 'switch', 'idle'].includes(scenarioName)) continue;
            for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
              const label = `${pass} ${profileName} · ${scenarioName} #${repeat}`;
              if (SCENARIOS[scenarioName].freshBrowser) {
                await browser.close();
                browser = await chromium.launch(PROFILES[profileName].launch);
              }
              try {
                const measured = await cell(browser, profileName, scenarioName, { pass, repeat }, options, shared);
                cells.push(measured);
                const row = rowOf(measured);
                log(`${label}: fps ${row.fps} p5 ${row.p5fps} p95 ${row.frameP95} ms, main p95 ${row.busyP95} ms, long ${row.longTasks} (${row.longOver100}), first frame ${row.firstFrameMs} ms, run→moving ${row.runToMovingMs} ms${row.simPerFrameMs !== null ? `, sim ${row.simPerFrameMs} render ${row.renderPerFrameMs} react ${row.reactPerFrameMs} ms/frame` : ''}, load ${measured.loadavg1m}`);
              } catch (error) {
                const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
                cells.push({ profile: profileName, scenario: scenarioName, pass, repeat, error: message, loadavg1m: load1() });
                log(`${label}: FAILED ${message}`);
              }
            }
          }
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    stop();
  }
  const machine = { cpus: os.cpus()[0]?.model, cores: os.cpus().length, memGB: round(os.totalmem() / 2 ** 30, 0), platform: `${os.type()} ${os.release()}`, node: process.version, chromium: chromiumVersion };
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    // not a git checkout
  }
  const verdicts = judge(cells, bundle);
  const report = { date: new Date().toISOString(), commit, machine, options, profiles: PROFILES, bundle, headers, cells, verdicts, durationS: round((Date.now() - started) / 1000, 0) };
  mkdirSync(options.out, { recursive: true });
  const base = join(options.out, `bench-robot3d-${options.label ? `${options.label}-` : ''}${report.date.replace(/[:.]/g, '-')}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 1)}\n`);
  const table = markdown(report);
  writeFileSync(`${base}.md`, table);
  process.stdout.write(`\n${table}\nwritten ${base}.json and .md (${report.durationS} s)\n`);
  const failedCells = cells.filter((entry) => entry.error);
  const missed = verdicts.filter((row) => !row.ok && (row.kind === 'budget' || options.targets));
  if (failedCells.length > 0) throw new Failure(1, `${failedCells.length} cell(s) failed.`);
  if (missed.length > 0) throw new Failure(1, `Missed: ${missed.map((row) => row.name).join('; ')}.`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof Failure ? error.code : 1;
}
