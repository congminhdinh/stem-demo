// Measurement harness for the render spike (N18 R0.2). Run from the repository root:
//
//   node spikes/robot-render/measure.mjs bundle    # production builds, gzip/brotli of the lazy 3D chunk, drei vs three controls
//   node spikes/robot-render/measure.mjs fps [--only=<group>] [--repeats=3]   # FPS matrix: tier x CPU throttle x DPR x GPU/SwiftShader
//   node spikes/robot-render/measure.mjs stress    # extra robots: where does the frame rate break?
//   node spikes/robot-render/measure.mjs aa        # MSAA on/off per tier
//   node spikes/robot-render/measure.mjs boot      # fresh-load time of the lazy chunk, throttle 1x and 4x
//   node spikes/robot-render/measure.mjs idle      # frameloop="demand": frames while idle, after an orbit drag; run-to-motion
//   node spikes/robot-render/measure.mjs context   # WEBGL_lose_context: lost / restored behaviour
//   node spikes/robot-render/measure.mjs soak      # 60 s headless SwiftShader runs
//   node spikes/robot-render/measure.mjs flags     # which Chromium launch flags give WebGL, on which renderer
//   node spikes/robot-render/measure.mjs engines   # does WebGL render in Playwright Firefox / WebKit?
//   node spikes/robot-render/measure.mjs all
//
// Results go to spikes/robot-render/results/<command>.json. Servers: `vite preview` of the spike build on :5221
// and the existing e2e/lesson-host.mjs on :5222 (the lab is framed at 1100x640 with the LMS iframe sandbox).
import { chromium, firefox, webkit } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const results = join(here, 'results');
mkdirSync(results, { recursive: true });

const LAB_PORT = 5221;
const HOST_PORT = 5222;
const SANDBOX = 'allow-scripts allow-same-origin allow-downloads'; // the LMS iframe sandbox (docs/lab-embed-contract.md §4)
const UNCAPPED = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

// ---------------------------------------------------------------------------------------------------------------
// Browser groups. "shell" is Playwright's default headless (chromium-headless-shell); "new" is full Chromium in
// the new headless mode (channel: 'chromium'), which can use the machine's real GPU.
export const GROUPS = {
  'gpu-capped': { label: 'new headless, real GPU, vsync', launch: { headless: true, channel: 'chromium' } },
  'gpu-uncapped': {
    label: 'new headless, real GPU, frame-rate limit and vsync off',
    launch: { headless: true, channel: 'chromium', args: UNCAPPED },
  },
  'swiftshader-shell': {
    label: 'headless shell, --use-angle=swiftshader --enable-unsafe-swiftshader',
    launch: { headless: true, args: SWIFTSHADER },
  },
  'swiftshader-new': {
    label: 'new headless, --use-angle=swiftshader --enable-unsafe-swiftshader',
    launch: { headless: true, channel: 'chromium', args: SWIFTSHADER },
  },
};

// ---------------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
const round = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? null : Number(n.toFixed(d)));

/** FPS summary from per-frame intervals (ms). p5 fps = fps of the slowest 5 % of frames = 1000 / p95(interval). */
export function summarize(dt, renderMs, frames, seconds) {
  const sorted = [...dt].sort((a, b) => a - b);
  const render = [...renderMs].sort((a, b) => a - b);
  return {
    frames,
    seconds,
    meanFps: round(frames / seconds, 1),
    medianFps: round(1000 / pct(sorted, 0.5), 1),
    p5Fps: round(1000 / pct(sorted, 0.95), 1),
    minFps: round(1000 / sorted[sorted.length - 1], 1),
    intervalMs: { median: round(pct(sorted, 0.5)), p95: round(pct(sorted, 0.95)), p99: round(pct(sorted, 0.99)), max: round(sorted[sorted.length - 1]) },
    framesOver50ms: sorted.filter((v) => v > 50).length,
    renderCallMs: { median: round(pct(render, 0.5)), p95: round(pct(render, 0.95)) },
  };
}

async function environment(browser) {
  let power = '';
  try {
    const batt = execFileSync('pmset', ['-g', 'batt']).toString().split('\n')[0].trim();
    const mode = /powermode\s+(\d)/.exec(execFileSync('pmset', ['-g']).toString())?.[1]; // 0 automatic, 1 low power, 2 high power
    power = `${batt}; pmset powermode ${mode}`;
  } catch {
    // not macOS
  }
  return {
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    playwright: JSON.parse(readFileSync(join(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version,
    chromium: browser ? browser.version() : undefined,
    three: JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version,
    r3f: JSON.parse(readFileSync(join(root, 'node_modules/@react-three/fiber/package.json'), 'utf8')).version,
    drei: JSON.parse(readFileSync(join(root, 'node_modules/@react-three/drei/package.json'), 'utf8')).version,
    power,
    loadavgAtStart: os.loadavg().map((v) => round(v)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Servers
const viteBin = join(root, 'node_modules/vite/bin/vite.js');

function build(controls) {
  const t = performance.now();
  const out = execFileSync(process.execPath, [viteBin, 'build', '-c', 'spikes/robot-render/vite.config.ts'], {
    cwd: root,
    env: { ...process.env, SPIKE_CONTROLS: controls },
  }).toString();
  return { ms: Math.round(performance.now() - t), log: out };
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
  throw new Error(`server did not start: ${url}`);
}

async function startServers(controls = 'three') {
  if (!existsSync(join(here, 'dist', controls, 'index.html'))) build(controls);
  const children = [
    spawn(process.execPath, [viteBin, 'preview', '-c', 'spikes/robot-render/vite.config.ts'], {
      cwd: root,
      env: { ...process.env, SPIKE_CONTROLS: controls },
      stdio: 'ignore',
    }),
    spawn(process.execPath, ['e2e/lesson-host.mjs', String(HOST_PORT)], { cwd: root, stdio: 'ignore' }),
  ];
  await waitFor(`http://localhost:${LAB_PORT}/`);
  await waitFor(`http://localhost:${HOST_PORT}/lesson`);
  return () => children.forEach((child) => child.kill());
}

const hostUrl = (query) =>
  `http://localhost:${HOST_PORT}/lesson?lab=${encodeURIComponent(`http://localhost:${LAB_PORT}/?${query}`)}&sandbox=${encodeURIComponent(SANDBOX)}`;

/** Opens the lab in the lesson host's 1100x640 iframe. Returns { page, frame, cdp, errors }. */
async function openLab(browser, { query, dsf = 1, rate = 1, engine = 'chromium' }) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  const messages = [];
  page.on('console', (m) => messages.push({ type: m.type(), text: m.text().slice(0, 200) }));
  page.on('pageerror', (e) => messages.push({ type: 'pageerror', text: String(e.message).slice(0, 200) }));
  page.on('crash', () => messages.push({ type: 'crash', text: 'page crashed' }));
  let cdp = null;
  if (engine === 'chromium') {
    cdp = await context.newCDPSession(page);
    if (rate !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
  await page.goto(hostUrl(query));
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForFunction(() => window.__spike, null, { timeout: 30000 });
  return { context, page, frame, cdp, messages };
}

/** Collapses console noise into distinct messages with counts. */
function distinct(messages) {
  const map = new Map();
  for (const m of messages) {
    const key = `${m.type}: ${m.text.replace(/0x[0-9a-f]+/gi, '0x…')}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map].map(([text, count]) => ({ text, count }));
}

const save = (name, data) => writeFileSync(join(results, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------------------------
// bundle
function gzip(buf, level = 9) {
  return gzipSync(buf, { level }).length;
}
function brotli(buf) {
  return brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Rendered bytes per source file, from the source map segments (approximate: a segment runs to the next one). */
function bytesPerSource(code, map) {
  const lines = code.split('\n');
  const perSource = new Array(map.sources.length).fill(0);
  let src = 0;
  map.mappings.split(';').forEach((line, lineIndex) => {
    const segments = [];
    let col = 0;
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const values = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      col += values[0];
      if (values.length >= 4) {
        src += values[1];
        segments.push({ col, src });
      } else segments.push({ col, src: -1 });
    }
    const lineLength = lines[lineIndex]?.length ?? 0;
    segments.forEach((s, i) => {
      const end = i + 1 < segments.length ? segments[i + 1].col : lineLength;
      if (s.src >= 0) perSource[s.src] += Math.max(0, end - s.col);
    });
  });
  return perSource;
}

function packageOf(source) {
  const i = source.lastIndexOf('node_modules/');
  if (i < 0) return '(spike source)';
  const parts = source.slice(i + 13).split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return name === 'three' && source.includes('/examples/') ? 'three/examples' : name;
}

function measureBundle(controls) {
  const built = build(controls);
  const dir = join(here, 'dist', controls);
  const manifest = JSON.parse(readFileSync(join(dir, '.vite/manifest.json'), 'utf8'));
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  const lazy = Object.values(manifest).find((chunk) => chunk.isDynamicEntry);
  const sizeOf = (file) => {
    const buf = readFileSync(join(dir, file));
    return { file, bytes: buf.length, gzip9: gzip(buf, 9), gzipDefault: gzip(buf, 6), brotli11: brotli(buf) };
  };
  const lazyFiles = [lazy.file, ...(lazy.imports ?? []).map((key) => manifest[key]).filter((chunk) => !chunk.isEntry).map((chunk) => chunk.file)];
  const lazyChunks = lazyFiles.map(sizeOf);
  const sum = (key) => lazyChunks.reduce((total, c) => total + c[key], 0);
  const code = readFileSync(join(dir, lazy.file), 'utf8');
  const map = JSON.parse(readFileSync(join(dir, `${lazy.file}.map`), 'utf8'));
  const perSource = bytesPerSource(code, map);
  const packages = new Map();
  map.sources.forEach((source, i) => {
    const name = packageOf(source);
    const row = packages.get(name) ?? { name, renderedBytes: 0, modules: 0 };
    row.renderedBytes += perSource[i];
    row.modules += 1;
    packages.set(name, row);
  });
  const allJs = readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.js'));
  const needle = /mediapipe|tasks-vision|FaceLandmarker/i;
  return {
    controls,
    buildMs: built.ms,
    modulesTransformed: Number(/(\d+) modules transformed/.exec(built.log)?.[1]),
    mainEntryChunk: sizeOf(entry.file),
    lazy3dChunks: lazyChunks,
    lazy3dTotal: { bytes: sum('bytes'), gzip9: sum('gzip9'), gzipDefault: sum('gzipDefault'), brotli11: sum('brotli11') },
    jsChunkCount: allJs.length,
    mediapipe: {
      stringInAnyJsChunk: allJs.some((f) => needle.test(readFileSync(join(dir, 'assets', f), 'utf8'))),
      inSourceMap: map.sources.some((s) => needle.test(s)),
      separateChunk: allJs.some((f) => /mediapipe|tasks-vision/i.test(f)),
    },
    modulesInSourceMap: map.sources.length,
    packagesInLazyChunk: [...packages.values()].sort((a, b) => b.renderedBytes - a.renderedBytes),
  };
}

async function cmdBundle() {
  const variants = {};
  for (const controls of ['three', 'drei']) variants[controls] = measureBundle(controls);
  // Cold-install footprint note: modules Vite had to transform for each variant (drei's barrel pulls its whole graph).
  const fileSize = (rel) => {
    const buf = readFileSync(join(root, 'node_modules', rel));
    return { file: rel, bytes: buf.length, gzip9: gzip(buf, 9), brotli11: brotli(buf) };
  };
  // Context for the 3D budget (owned by R0.1): the two Rapier packages as published.
  const adjacent = {
    rapierSplitWasm: fileSize('@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm'),
    rapierCompatEmbeddedWasmModule: fileSize('@dimforge/rapier3d-deterministic-compat/dist/rapier.mjs'),
  };
  const data = { env: await environment(null), adjacent, gzipLevel: 'gzip9 = zlib level 9, brotli11 = quality 11; gzipDefault = zlib level 6 (what Vite prints)', variants };
  save('bundle', data);
  for (const [name, v] of Object.entries(variants)) {
    console.log(name, 'lazy', v.lazy3dTotal, 'mediapipe', v.mediapipe, 'modules', v.modulesInSourceMap);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// fps
async function fpsCell(browser, { group, tier, rate, dsf, extra = 0, seconds = 8, warmup = 2, aa }) {
  const query = `tier=${tier}&run=1&extra=${extra}${aa === undefined ? '' : `&aa=${aa}`}`;
  const lab = await openLab(browser, { query, dsf, rate });
  const load = os.loadavg()[0];
  // Proof that the CDP throttle reaches the iframe: the same fixed loop, timed inside it.
  const cpuBenchMs = await lab.frame.evaluate(() => {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 3e7; i += 1) x += i % 7;
    return performance.now() - t + x * 0;
  });
  await sleep(warmup * 1000);
  await lab.frame.evaluate(() => window.__spike.resetStats());
  await sleep(seconds * 1000);
  const stats = await lab.frame.evaluate(() => window.__spike.stats());
  const cell = {
    group,
    tier,
    cpuThrottle: rate,
    dsf,
    extra,
    aa: aa ?? (tier === 'high' ? 1 : 0),
    ...summarize(stats.dt, stats.renderMs, stats.frames, seconds),
    drawingBuffer: stats.drawingBuffer,
    pixelRatio: stats.pixelRatio,
    shadowMapEnabled: stats.shadowMapEnabled,
    drawCalls: stats.render.calls,
    triangles: stats.render.triangles,
    renderer: stats.renderer,
    loadavg1m: round(load),
    cpuBenchMs: round(cpuBenchMs, 0),
    consoleErrors: distinct(lab.messages.filter((m) => m.type === 'error' || m.type === 'pageerror' || m.type === 'crash')),
  };
  await lab.context.close();
  return cell;
}

async function cmdFps({ only, repeats = 3 } = {}) {
  const cells = [];
  let env;
  for (const [group, def] of Object.entries(GROUPS)) {
    if (only && group !== only) continue;
    const browser = await chromium.launch(def.launch);
    env ??= await environment(browser);
    for (const dsf of [1, 2]) {
      for (const rate of [1, 4]) {
        for (const tier of ['high', 'low']) {
          for (let run = 1; run <= repeats; run += 1) {
            const cell = { run, ...(await fpsCell(browser, { group, tier, rate, dsf })) };
            console.log(group, `tier=${tier} throttle=${rate}x dsf=${dsf} run=${run}`, `median ${cell.medianFps} p5 ${cell.p5Fps} mean ${cell.meanFps} load ${cell.loadavg1m}`);
            cells.push(cell);
          }
        }
      }
    }
    await browser.close();
  }
  const keys = new Map();
  for (const c of cells) {
    const key = `${c.group}|${c.tier}|${c.cpuThrottle}|${c.dsf}`;
    keys.set(key, [...(keys.get(key) ?? []), c]);
  }
  const med = (values) => round(pct([...values].sort((a, b) => a - b), 0.5), 1);
  const summary = [...keys.values()].map((runs) => ({
    group: runs[0].group,
    tier: runs[0].tier,
    cpuThrottle: runs[0].cpuThrottle,
    dsf: runs[0].dsf,
    runs: runs.length,
    medianFps: med(runs.map((r) => r.medianFps)),
    p5Fps: med(runs.map((r) => r.p5Fps)),
    worstP5Fps: Math.min(...runs.map((r) => r.p5Fps)),
    meanFps: med(runs.map((r) => r.meanFps)),
    drawingBuffer: runs[0].drawingBuffer.join('x'),
  }));
  save(only ? `fps-${only}` : 'fps', {
    env,
    groups: Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, v.label])),
    protocol: `${repeats} runs per cell, each 2 s warm-up + 8 s measured, 1100x640 iframe, sandbox allow-scripts allow-same-origin allow-downloads. summary: median of the runs' median fps, median of the runs' p5 fps, worst p5 of any run`,
    summary,
    cells,
  });
}

async function cmdStress() {
  const cells = [];
  let env;
  for (const group of ['gpu-uncapped', 'swiftshader-shell']) {
    const browser = await chromium.launch(GROUPS[group].launch);
    env ??= await environment(browser);
    for (const extra of [0, 8, 24]) {
      for (const tier of ['high', 'low']) {
        const cell = await fpsCell(browser, { group, tier, rate: 4, dsf: 1, extra });
        console.log(group, `tier=${tier} extra=${extra} calls=${cell.drawCalls}`, `median ${cell.medianFps} p5 ${cell.p5Fps}`);
        cells.push(cell);
      }
    }
    await browser.close();
  }
  save('stress', { env, protocol: 'CPU throttle 4x, dsf 1, 2 s warm-up, 8 s measured; each extra robot is about 20 draw calls (about 40 with the shadow pass)', cells });
}

// ---------------------------------------------------------------------------------------------------------------
// aa: what does MSAA cost per tier?
async function cmdAa({ repeats = 3 } = {}) {
  const cells = [];
  let env;
  for (const group of ['swiftshader-shell', 'gpu-uncapped']) {
    const browser = await chromium.launch(GROUPS[group].launch);
    env ??= await environment(browser);
    for (const tier of ['high', 'low']) {
      for (const aa of [0, 1]) {
        for (let run = 1; run <= repeats; run += 1) {
          const cell = { run, ...(await fpsCell(browser, { group, tier, rate: 4, dsf: 2, aa })) };
          console.log(group, `tier=${tier} aa=${aa} run=${run}`, `median ${cell.medianFps} p5 ${cell.p5Fps} mean ${cell.meanFps} load ${cell.loadavg1m}`);
          cells.push(cell);
        }
      }
    }
    await browser.close();
  }
  const keys = new Map();
  for (const c of cells) {
    const key = `${c.group}|${c.tier}|${c.aa}`;
    keys.set(key, [...(keys.get(key) ?? []), c]);
  }
  const med = (values) => round(pct([...values].sort((a, b) => a - b), 0.5), 1);
  const summary = [...keys.values()].map((runs) => ({ group: runs[0].group, tier: runs[0].tier, aa: runs[0].aa, runs: runs.length, medianFps: med(runs.map((r) => r.medianFps)), p5Fps: med(runs.map((r) => r.p5Fps)), meanFps: med(runs.map((r) => r.meanFps)) }));
  save('aa', { env, protocol: 'CPU throttle 4x, DPR 2 (drawing buffer 1100x640 x1.5 in the high tier, x1 in the low tier), antialias off vs on', summary, cells });
}

// ---------------------------------------------------------------------------------------------------------------
// boot: fresh load, lazy chunk
async function cmdBoot() {
  const rows = [];
  let env;
  for (const controls of ['three', 'drei']) {
    const stop = await startServers(controls);
    const browser = await chromium.launch(GROUPS['gpu-capped'].launch);
    env ??= await environment(browser);
    for (const rate of [1, 4]) {
      const samples = [];
      for (let i = 0; i < 7; i += 1) {
        const lab = await openLab(browser, { query: 'tier=high', rate });
        await sleep(600);
        // one render is needed for the first-frame mark (frameloop="demand" renders once on mount)
        const boot = await lab.frame.evaluate(() => {
          const b = window.__spike.boot;
          return { importMs: b.importEnd - b.importStart, suspenseMs: b.labRender - b.importEnd, commitDelayMs: b.glStart - b.importEnd, rendererMs: b.glEnd - b.glStart, glEndToFirstFrameMs: b.firstFrame - b.glEnd, canvasMs: b.canvasCreated - b.importEnd, firstFrameMs: b.firstFrame - b.importStart };
        });
        samples.push(boot);
        await lab.context.close();
      }
      const med = (key) => round(pct(samples.map((s) => s[key]).sort((a, b) => a - b), 0.5));
      const max = (key) => round(Math.max(...samples.map((s) => s[key])));
      rows.push({ controls, cpuThrottle: rate, runs: samples.length, importMsMedian: med('importMs'), suspenseMsMedian: med('suspenseMs'), commitDelayMsMedian: med('commitDelayMs'), rendererMsMedian: med('rendererMs'), glEndToFirstFrameMsMedian: med('glEndToFirstFrameMs'), canvasMsMedian: med('canvasMs'), firstFrameMsMedian: med('firstFrameMs'), firstFrameMsMax: max('firstFrameMs') });
      console.log(rows[rows.length - 1]);
    }
    await browser.close();
    stop();
  }
  save('boot', { env, note: 'localhost, no network latency: importMs is fetch + parse + evaluate of the lazy chunk; firstFrameMs is import start to the first rendered frame', rows });
}

// ---------------------------------------------------------------------------------------------------------------
// idle / demand frameloop + orbit + run-to-motion, both controls variants
async function cmdIdle() {
  const out = {};
  let env;
  for (const controls of ['three', 'drei']) {
    const stop = await startServers(controls);
    const browser = await chromium.launch(GROUPS['swiftshader-shell'].launch);
    env ??= await environment(browser);
    const lab = await openLab(browser, { query: 'tier=high' });
    const f = lab.frame;
    const frames = () => f.evaluate(() => window.__spike.stats().frames);
    await sleep(1500);
    await f.evaluate(() => window.__spike.resetStats());
    await sleep(3000);
    const idleFrames = await frames();
    // Drag across the canvas in the iframe.
    const box = await (await lab.page.$('iframe')).boundingBox();
    const camBefore = await f.evaluate(() => window.__spike.cameraPosition());
    await f.evaluate(() => window.__spike.resetStats());
    await lab.page.mouse.move(box.x + 500, box.y + 320);
    await lab.page.mouse.down();
    for (let i = 1; i <= 20; i += 1) await lab.page.mouse.move(box.x + 500 + i * 8, box.y + 320 + i * 2, { steps: 1 });
    await lab.page.mouse.up();
    await sleep(1500);
    const framesAfterDrag = await frames();
    const camAfter = await f.evaluate(() => window.__spike.cameraPosition());
    await f.evaluate(() => window.__spike.resetStats());
    await sleep(2000);
    const framesSettled = await frames();
    // run() to first moving frame, at 1x and 4x CPU throttle
    const runToMotion = {};
    for (const rate of [1, 4]) {
      await lab.cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await f.evaluate(() => window.__spike.stop());
      await sleep(800);
      runToMotion[`${rate}x`] = await f.evaluate(
        () =>
          new Promise((resolve) => {
            const api = window.__spike;
            const before = api.stats().frames;
            const t0 = performance.now();
            api.run();
            const poll = () => {
              if (api.stats().frames >= before + 2) resolve(performance.now() - t0);
              else requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          }),
      );
      runToMotion[`${rate}x`] = round(runToMotion[`${rate}x`]);
    }
    await lab.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await f.evaluate(() => window.__spike.run());
    await sleep(1000);
    await f.evaluate(() => window.__spike.resetStats());
    await sleep(3000);
    const runningFrames = await frames();
    out[controls] = {
      idleFramesIn3s: idleFrames,
      framesAfterOrbitDrag: framesAfterDrag,
      framesIn2sAfterSettling: framesSettled,
      cameraMoved: camBefore.some((v, i) => Math.abs(v - camAfter[i]) > 1e-3),
      runningFramesIn3s: runningFrames,
      runToSecondFrameMs: runToMotion,
    };
    console.log(controls, out[controls]);
    await lab.context.close();
    await browser.close();
    stop();
  }
  save('idle', { env, note: 'headless shell + SwiftShader, tier high, 1100x640. run -> second rendered frame: the first frame in which the robot has moved', variants: out });
}

// ---------------------------------------------------------------------------------------------------------------
// context loss
async function contextScenario(browser, { name, mode, restore, invalidateAfterRestore, screenshots = false }) {
  const lab = await openLab(browser, { query: `tier=high&run=${mode === 'running' ? 1 : 0}` });
  const f = lab.frame;
  const call = (expr) => f.evaluate(expr);
  await sleep(1200);
  if (mode === 'paused') {
    await call(() => window.__spike.stop());
    await sleep(500);
  }
  const base = await call(() => window.__spike.sample());
  const frames = () => call(() => window.__spike.stats().frames);
  const f0 = await frames();
  const shot = async (tag) => {
    if (!screenshots) return;
    await lab.page.screenshot({ path: join(results, `context-${name}-${tag}.png`), clip: { x: 0, y: 0, width: 1100, height: 720 } });
  };
  await shot('before');
  const events0 = await call(() => window.__spike.contextEvents.length);
  await call(() => window.__spike.loseContext());
  await sleep(1500);
  const afterLoss = await call(() => ({ ...window.__spike.sample(), events: window.__spike.contextEvents.slice(), frames: window.__spike.stats().frames, renderMsMedian: (() => { const r = window.__spike.stats().renderMs.slice(-30).sort((a, b) => a - b); return r[r.length >> 1]; })() }));
  const framesWhileLost = afterLoss.frames - f0;
  await shot('lost');
  let afterRestore = null;
  let afterInvalidate = null;
  let recoveryMs = null;
  if (restore) {
    const fRestore = await frames();
    recoveryMs = await call(
      () =>
        new Promise((resolve) => {
          const api = window.__spike;
          const t0 = performance.now();
          api.restoreContext();
          const poll = () => {
            if (api.contextEvents.some((e) => e.type === 'webglcontextrestored')) resolve(performance.now() - t0);
            else if (performance.now() - t0 > 5000) resolve(null);
            else requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        }),
    );
    await sleep(1500);
    const fAfter = await frames();
    await shot('restored');
    afterRestore = await call(() => window.__spike.sample());
    afterRestore.framesRenderedAfterRestore = fAfter - fRestore;
    if (invalidateAfterRestore) {
      await call(() => window.__spike.invalidate());
      await sleep(800);
      afterInvalidate = {
        framesRenderedAfterInvalidate: (await frames()) - fAfter,
      };
      await shot('invalidated');
    }
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const result = {
    name,
    mode,
    baselineFrameHash: base.hash,
    eventsDuringLoss: afterLoss.events.slice(events0).map((e) => ({ type: e.type, defaultPrevented: e.defaultPrevented })),
    whileLost: { isContextLost: afterLoss.lost, pixelsRead: afterLoss.pixels, framesCalledWhileLost: framesWhileLost, renderCallMsMedian: round(afterLoss.renderMsMedian) },
    recoveryMs: round(recoveryMs),
    afterRestore: afterRestore && { isContextLost: afterRestore.lost, framesRenderedAfterRestore: afterRestore.framesRenderedAfterRestore, pixelsEqualBaseline: equal(afterRestore.pixels, base.pixels), frameHashEqualBaseline: afterRestore.hash === base.hash, frameHash: afterRestore.hash },
    afterInvalidate,
    consoleMessages: distinct(lab.messages.filter((m) => m.type !== 'debug')),
  };
  await lab.context.close();
  return result;
}

async function cmdContext() {
  const scenarios = [];
  let env;
  for (const group of ['swiftshader-shell', 'gpu-capped']) {
    const browser = await chromium.launch(GROUPS[group].launch);
    env ??= await environment(browser);
    const defs = [
      { name: 'running-restored', mode: 'running', restore: true },
      { name: 'paused-restored-no-invalidate', mode: 'paused', restore: true, invalidateAfterRestore: true },
      { name: 'running-never-restored', mode: 'running', restore: false },
    ];
    for (const def of defs) {
      const r = await contextScenario(browser, { ...def, name: `${group}-${def.name}`, screenshots: group === 'swiftshader-shell' && def.mode === 'paused' });
      console.log(group, JSON.stringify({ ...r, baseline: undefined, afterRestore: r.afterRestore && { ...r.afterRestore, pixels: undefined } }));
      scenarios.push({ group, ...r });
    }
    await browser.close();
  }
  save('context', { env, scenarios });
}

// ---------------------------------------------------------------------------------------------------------------
// soak
async function cmdSoak({ repeats = 2 } = {}) {
  const runs = [];
  const browser = await chromium.launch(GROUPS['swiftshader-shell'].launch);
  const env = await environment(browser);
  for (let run = 1; run <= repeats; run += 1) {
    for (const { tier, rate } of [{ tier: 'high', rate: 1 }, { tier: 'low', rate: 1 }, { tier: 'high', rate: 4 }, { tier: 'low', rate: 4 }]) {
      const lab = await openLab(browser, { query: `tier=${tier}&run=1`, rate });
      await sleep(2000);
      await lab.frame.evaluate(() => window.__spike.resetStats());
      const before = await lab.frame.evaluate(() => window.__spike.stats());
      const loadStart = os.loadavg()[0];
      const seconds = 60;
      await sleep(seconds * 1000);
      const loadEnd = os.loadavg()[0];
      const after = await lab.frame.evaluate(() => window.__spike.stats());
      const events = await lab.frame.evaluate(() => window.__spike.contextEvents);
      if (run === 1 && rate === 1) await lab.page.screenshot({ path: join(results, `render-${tier}-swiftshader.png`), clip: { x: 0, y: 0, width: 1100, height: 720 } });
      runs.push({
        run,
        tier,
        cpuThrottle: rate,
        ...summarize(after.dt, after.renderMs, after.frames, seconds),
        renderer: after.renderer,
        loadavg1m: { start: round(loadStart), end: round(loadEnd) },
        heapMB: { start: round(before.heapMB, 1), end: round(after.heapMB, 1) },
        glMemory: { start: before.memory, end: after.memory },
        programs: { start: before.programs, end: after.programs },
        contextEvents: events.length,
        crashes: lab.messages.filter((m) => m.type === 'crash').length,
        messages: distinct(lab.messages),
      });
      const last = runs[runs.length - 1];
      console.log(run, tier, `${rate}x`, last.medianFps, last.p5Fps, last.loadavg1m);
      await lab.context.close();
    }
  }
  await browser.close();
  save('soak', { env, note: 'headless shell, --use-angle=swiftshader --enable-unsafe-swiftshader, dsf 1, 60 s per run after a 2 s warm-up; heap is performance.memory.usedJSHeapSize (Chromium buckets it); loadavg1m is the host load average (1 min) at the start and end of the run', runs });
}

// ---------------------------------------------------------------------------------------------------------------
// flags: which launch options give WebGL, and on which renderer?
async function cmdFlags() {
  const variants = {
    'headless shell, Playwright defaults': { launch: { headless: true } },
    'headless shell, no --enable-unsafe-swiftshader (ignoreDefaultArgs)': { launch: { headless: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'] } },
    'headless shell, --use-angle=swiftshader --enable-unsafe-swiftshader': { launch: { headless: true, args: SWIFTSHADER } },
    'headless shell, --disable-gpu': { launch: { headless: true, args: ['--disable-gpu'] } },
    'headless shell, --disable-3d-apis': { launch: { headless: true, args: ['--disable-3d-apis'] } },
    'new headless (channel chromium), Playwright defaults': { launch: { headless: true, channel: 'chromium' } },
    'new headless, --use-angle=swiftshader --enable-unsafe-swiftshader': { launch: { headless: true, channel: 'chromium', args: SWIFTSHADER } },
    'new headless, --disable-3d-apis': { launch: { headless: true, channel: 'chromium', args: ['--disable-3d-apis'] } },
  };
  const rows = [];
  let env;
  for (const [name, v] of Object.entries(variants)) {
    const browser = await chromium.launch(v.launch);
    env ??= await environment(browser);
    const page = await browser.newPage();
    const messages = [];
    page.on('console', (m) => messages.push({ type: m.type(), text: m.text().slice(0, 220) }));
    // A routed http page: about:blank does not show Chromium's WebGL console notes.
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
    await page.goto('http://probe.localhost/');
    const info = await page.evaluate(() => {
      // the attributes R3F/three ask for by default
      const gl = document.createElement('canvas').getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' });
      if (!gl) return { webgl2: false };
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: true, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), loseContextExtension: Boolean(gl.getExtension('WEBGL_lose_context')) };
    });
    rows.push({ name, ...info, messages: distinct(messages) });
    console.log(name, JSON.stringify(info));
    await browser.close();
  }
  // The same question on the lab page itself (the deprecation note shows up there, not on a blank page).
  const labConsole = {};
  for (const [name, launch] of Object.entries({
    'headless shell, no --enable-unsafe-swiftshader': { headless: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'] },
    'headless shell, --use-angle=swiftshader --enable-unsafe-swiftshader': { headless: true, args: SWIFTSHADER },
  })) {
    const browser = await chromium.launch(launch);
    const lab = await openLab(browser, { query: 'tier=low&run=1' });
    await sleep(1500);
    labConsole[name] = distinct(lab.messages);
    console.log(name, JSON.stringify(labConsole[name]));
    await browser.close();
  }
  save('flags', { env, rows, labPageConsole: labConsole });
}

// ---------------------------------------------------------------------------------------------------------------
// engines
async function cmdEngines() {
  const rows = [];
  for (const [name, type] of [['firefox', firefox], ['webkit', webkit]]) {
    try {
      const browser = await type.launch({ headless: true });
      const lab = await openLab(browser, { query: 'tier=high&run=1', engine: name });
      await sleep(1500);
      await lab.frame.evaluate(() => window.__spike.resetStats());
      await sleep(5000);
      const stats = await lab.frame.evaluate(() => window.__spike.stats());
      rows.push({ engine: name, version: browser.version(), renderer: stats.renderer, ...summarize(stats.dt, stats.renderMs, stats.frames, 5), messages: distinct(lab.messages).slice(0, 5) });
      await browser.close();
    } catch (error) {
      rows.push({ engine: name, error: String(error.message).split('\n')[0] });
    }
    console.log(rows[rows.length - 1]);
  }
  save('engines', { env: await environment(null), rows });
}

// ---------------------------------------------------------------------------------------------------------------
/** Runs a command with the spike build (three controls) served on :5221 and the lesson host on :5222. */
const withServers = (run) => async (args) => {
  const stop = await startServers('three');
  try {
    await run(args);
  } finally {
    stop();
  }
};
// boot and idle start their own servers: they compare both controls builds.
const commands = {
  bundle: cmdBundle,
  fps: withServers(cmdFps),
  stress: withServers(cmdStress),
  aa: withServers(cmdAa),
  boot: cmdBoot,
  idle: cmdIdle,
  context: withServers(cmdContext),
  soak: withServers(cmdSoak),
  engines: withServers(cmdEngines),
  flags: withServers(cmdFlags),
};
const [command, ...rest] = process.argv.slice(2);
if (command !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const names = command === 'all' ? Object.keys(commands) : [command];
  if (names.some((n) => !(n in commands))) {
    console.error(`unknown command ${command}; use one of: ${Object.keys(commands).join(', ')}, all`);
    process.exit(2);
  }
  for (const n of names) {
    await commands[n]({
      only: rest.find((a) => a.startsWith('--only='))?.slice(7),
      repeats: Number(rest.find((a) => a.startsWith('--repeats='))?.slice(10) ?? 3),
    });
  }
}
