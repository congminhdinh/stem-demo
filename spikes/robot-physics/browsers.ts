// R0.1 browser harness. Usage (from the repo root): node spikes/robot-physics/browsers.ts
// Builds the spike page twice (with / without vite-plugin-wasm), measures what the browser
// downloads (raw, gzip -9, brotli q11), serves the builds with COOP/COEP on port 5211 and
// runs Chromium, Firefox and WebKit (Playwright). Chromium also runs with CPU throttling 4x
// (CDP Emulation.setCPUThrottlingRate). Writes spikes/robot-physics/results/browsers.json.
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { loadavg } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const PORT = 5211;
const INIT_SAMPLES = 5;
const config = join(here, 'vite.config.ts');

// ---------- 1. builds ----------
function build(name: string, noPlugin: boolean) {
  const outDir = join('dist', name);
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', config], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, SPIKE_OUT_DIR: outDir, ...(noPlugin ? { SPIKE_NO_WASM_PLUGIN: '1' } : {}) },
  });
  return { name, ok: r.status === 0, outDir: join(here, outDir), log: (r.stdout + r.stderr).trim().split('\n').slice(-8) };
}

// ---------- 2. sizes ----------
type Manifest = Record<string, { file: string; imports?: string[]; assets?: string[]; isEntry?: boolean; isDynamicEntry?: boolean }>;
function sizeOf(path: string) {
  const buf = readFileSync(path);
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
  };
}
function sizes(outDir: string) {
  const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')) as Manifest;
  const closure = (key: string, seen = new Set<string>()): string[] => {
    const e = manifest[key]!;
    if (seen.has(e.file)) return [];
    seen.add(e.file);
    return [e.file, ...(e.assets ?? []), ...(e.imports ?? []).flatMap((k) => closure(k, seen))];
  };
  const out: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(manifest)) {
    if (!e.isDynamicEntry && !e.isEntry) continue;
    const pkg = key.includes('rapier3d-deterministic-compat') ? 'compat' : key.includes('rapier3d-deterministic') ? 'split' : 'page';
    const files = closure(key).map((f) => ({ file: f, ...sizeOf(join(outDir, f)) }));
    const total = files.reduce((t, f) => ({ raw: t.raw + f.raw, gzip: t.gzip + f.gzip, brotli: t.brotli + f.brotli }), { raw: 0, gzip: 0, brotli: 0 });
    out[pkg] = { files, total };
  }
  return out;
}

// ---------- 3. static server (two builds side by side) ----------
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
function serve(roots: Record<string, string>) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const [, prefix, ...rest] = url.pathname.split('/');
    const root = roots[prefix ?? ''];
    let file = root ? join(root, rest.join('/') || 'index.html') : '';
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!root || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  return new Promise<typeof server>((ok) => server.listen(PORT, () => ok(server)));
}

// ---------- 4. page runs ----------
type PageResult = Record<string, any>;
async function runPage(browser: Browser, url: string, throttle = false, timeout = 600_000): Promise<PageResult> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    if (throttle) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.goto(url);
    await page.waitForFunction(() => window.__result || window.__error, null, { timeout });
    return await page.evaluate(() => (window.__result ?? { error: window.__error }) as PageResult);
  } catch (e) {
    return { error: String(e).split('\n')[0] };
  } finally {
    await ctx.close();
  }
}
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
async function initSamples(browser: Browser, url: string, throttle = false) {
  const samples: PageResult[] = [];
  for (let i = 0; i < INIT_SAMPLES; i++) samples.push(await runPage(browser, url, throttle));
  const ok = samples.filter((s) => !s.error);
  if (!ok.length) return { error: samples[0]?.error };
  const pick = (k: string) => ok.map((s) => s.init[k] as number);
  return {
    samples: ok.length,
    importPlusInitMsMedian: median(pick('importPlusInitMs')),
    importPlusInitMs: pick('importPlusInitMs'),
    importMsMedian: median(pick('importMs')),
    initMsMedian: median(pick('initMs')),
    fromNavigationMsMedian: median(pick('fromNavigationMs')),
    worldCreateMsMedian: median(pick('worldCreateMs')),
    resources: ok[0]!.init.resources,
  };
}

// ---------- 5. dev server check ----------
async function devCheck(browser: Browser, noPlugin: boolean) {
  // Spawn Vite itself (not through `pnpm exec`, which does not pass SIGTERM on to Vite).
  const viteBin = join(repo, 'node_modules/vite/bin/vite.js');
  const proc = spawn(process.execPath, [viteBin, '--config', config, '--port', String(PORT), '--strictPort'], {
    cwd: repo, env: { ...process.env, ...(noPlugin ? { SPIKE_NO_WASM_PLUGIN: '1' } : {}) }, stdio: 'pipe',
  });
  const exited = new Promise((ok) => proc.on('exit', ok));
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('dev server did not start')), 30_000);
    proc.stdout.on('data', (d: Buffer) => { if (d.toString().includes('Local:')) { clearTimeout(t); ok(); } });
  });
  const res: Record<string, unknown> = {};
  for (const pkg of ['split', 'compat']) {
    // First load may trigger dependency optimisation and a full reload: warm up once.
    await runPage(browser, `http://localhost:${PORT}/?pkg=${pkg}&mode=init`, false, 60_000);
    const r = await runPage(browser, `http://localhost:${PORT}/?pkg=${pkg}&mode=init`, false, 60_000);
    res[pkg] = r.error ? `FAIL: ${r.error}` : `ok (import+init ${r.init.importPlusInitMs} ms)`;
  }
  proc.kill('SIGTERM');
  await exited;
  return res;
}

// ---------- main ----------
rmSync(join(here, 'dist'), { recursive: true, force: true });
const builds = [build('plugin', false), build('noplugin', true)];
const result: Record<string, any> = {
  date: new Date().toISOString(),
  loadavgStart: loadavg(), // other agents share this machine: record the background load
  builds: builds.map(({ name, ok, log }) => ({ name, ok, log })),
  sizes: Object.fromEntries(builds.filter((b) => b.ok).map((b) => [b.name, sizes(b.outDir)])),
  browsers: {},
};
const server = await serve(Object.fromEntries(builds.filter((b) => b.ok).map((b) => [b.name, b.outDir])));
const base = `http://localhost:${PORT}`;
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
  const browser = await type.launch();
  const r: Record<string, any> = { version: browser.version() };
  for (const pkg of ['split', 'compat']) {
    r[pkg] = {
      full: await runPage(browser, `${base}/plugin/?pkg=${pkg}&mode=all`),
      init: await initSamples(browser, `${base}/plugin/?pkg=${pkg}&mode=init`),
    };
    if (name === 'chromium') {
      r[pkg].throttled4x = {
        full: await runPage(browser, `${base}/plugin/?pkg=${pkg}&mode=all`, true),
        init: await initSamples(browser, `${base}/plugin/?pkg=${pkg}&mode=init`, true),
      };
    }
    console.log(name, pkg, 'done');
  }
  // Split build made without vite-plugin-wasm (Vite 8 built-in wasm ESM integration).
  r.splitNoPlugin = await runPage(browser, `${base}/noplugin/?pkg=split&mode=all`);
  await browser.close();
  result.browsers[name] = r;
}
server.close();
// Dev server (vite serve) with and without the plugin, Chromium only.
{
  const browser = await chromium.launch();
  result.browsers.chromium.devServer = { plugin: await devCheck(browser, false), noPlugin: await devCheck(browser, true) };
  await browser.close();
}
result.loadavgEnd = loadavg();
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(join(here, 'results', 'browsers.json'), JSON.stringify(result, null, 2) + '\n');

// ---------- summary ----------
for (const [name, r] of Object.entries(result.browsers) as [string, any][]) {
  for (const pkg of ['split', 'compat']) {
    const full = r[pkg].full;
    if (full.error) { console.log(name, pkg, 'ERROR', full.error); continue; }
    for (const [model, h] of Object.entries(full.hashes) as [string, any][]) {
      console.log(name.padEnd(8), pkg.padEnd(6), model.padEnd(8), h.run1.finalQ6, h.run1.trajQ6, h.run1.trajBits, h.equal ? 'equal' : 'DIFF',
        'ms/tick', h.msPerTickWarm.median, h.msPerTickWarm.p95, 'b10', h.msPerTickWarm.batch10Median, h.msPerTickWarm.batch10P95, 'res', h.timerResolutionMs);
    }
    console.log('   init', JSON.stringify({ ...r[pkg].init, resources: undefined, importPlusInitMs: undefined }));
    if (r[pkg].throttled4x) console.log('   init 4x', JSON.stringify({ ...r[pkg].throttled4x.init, resources: undefined, importPlusInitMs: undefined }));
  }
  console.log('   trig', JSON.stringify(r.split.full.trig ?? r.compat.full.trig));
  console.log('   noplugin', r.splitNoPlugin.error ?? JSON.stringify(Object.fromEntries(Object.entries(r.splitNoPlugin.hashes).map(([m, h]: [string, any]) => [m, h.run1.trajBits]))));
}
console.log('dev', JSON.stringify(result.browsers.chromium.devServer));
console.log('sizes', JSON.stringify(Object.fromEntries(Object.entries(result.sizes).map(([b, s]: [string, any]) => [b, Object.fromEntries(Object.entries(s).map(([k, v]: [string, any]) => [k, v.total]))]))));
