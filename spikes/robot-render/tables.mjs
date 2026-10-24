// Prints the measured tables of the ADR as Markdown from results/*.json (so no number is retyped by hand).
//   node spikes/robot-render/tables.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const results = join(dirname(fileURLToPath(import.meta.url)), 'results');
const load = (name) => (existsSync(join(results, `${name}.json`)) ? JSON.parse(readFileSync(join(results, `${name}.json`), 'utf8')) : null);
const kb = (bytes) => (bytes / 1000).toFixed(1);
const row = (...cells) => `| ${cells.join(' | ')} |`;

const bundle = load('bundle');
if (bundle) {
  console.log('### Bundle\n');
  console.log(row('Variant', 'Lazy 3D chunk (min)', 'gzip -9', 'gzip -6 (Vite)', 'brotli -11', 'mediapipe in chunk'));
  console.log(row('---', '---:', '---:', '---:', '---:', '---'));
  for (const [name, v] of Object.entries(bundle.variants)) {
    const t = v.lazy3dTotal;
    console.log(row(name, `${kb(t.bytes)} kB`, `${kb(t.gzip9)} kB`, `${kb(t.gzipDefault)} kB`, `${kb(t.brotli11)} kB`, v.mediapipe.stringInAnyJsChunk || v.mediapipe.separateChunk ? 'yes' : 'no'));
  }
  console.log('\nEntry chunk (React, react-dom, spike entry; in the product it is the app chunk):');
  for (const [name, v] of Object.entries(bundle.variants)) console.log(`- ${name}: ${kb(v.mainEntryChunk.bytes)} kB, gzip -9 ${kb(v.mainEntryChunk.gzip9)} kB`);
  console.log('\nRendered bytes per package in the lazy chunk (source-map attribution, approximate):\n');
  console.log(row('Package', 'three variant', 'drei variant'));
  console.log(row('---', '---:', '---:'));
  const names = new Set([...Object.values(bundle.variants)].flatMap((v) => v.packagesInLazyChunk.map((p) => p.name)));
  const lookup = (v, n) => v.packagesInLazyChunk.find((p) => p.name === n);
  for (const n of [...names].sort((a, b) => (lookup(bundle.variants.three, b)?.renderedBytes ?? 0) - (lookup(bundle.variants.three, a)?.renderedBytes ?? 0) || (lookup(bundle.variants.drei, b)?.renderedBytes ?? 0) - (lookup(bundle.variants.drei, a)?.renderedBytes ?? 0))) {
    const cell = (v) => (lookup(v, n) ? `${kb(lookup(v, n).renderedBytes)} kB (${lookup(v, n).modules})` : '-');
    console.log(row(n, cell(bundle.variants.three), cell(bundle.variants.drei)));
  }
  console.log('\nFor scale (not part of the 3D render chunk; R0.1 owns the physics choice):');
  for (const a of Object.values(bundle.adjacent ?? {})) console.log(`- ${a.file}: ${kb(a.bytes)} kB, gzip -9 ${kb(a.gzip9)} kB, brotli -11 ${kb(a.brotli11)} kB`);
  console.log(`\nModules in the lazy chunk's source map: three ${bundle.variants.three.modulesInSourceMap}, drei ${bundle.variants.drei.modulesInSourceMap}.`);
}

const fps = load('fps');
if (fps) {
  console.log('\n### FPS (median of runs: median fps / p5 fps; in brackets the worst p5 of any run)\n');
  console.log(row('Group', 'DPR', 'Tier', 'CPU 1x', 'CPU 4x'));
  console.log(row('---', '---:', '---', '---:', '---:'));
  const find = (g, d, t, r) => fps.summary.find((c) => c.group === g && c.dsf === d && c.tier === t && c.cpuThrottle === r);
  for (const g of Object.keys(fps.groups)) {
    for (const d of [1, 2]) {
      for (const t of ['high', 'low']) {
        const cell = (r) => {
          const c = find(g, d, t, r);
          return c ? `${c.medianFps} / ${c.p5Fps} (${c.worstP5Fps})` : '-';
        };
        const any = find(g, d, t, 1);
        console.log(row(g, `${d} (${any?.drawingBuffer})`, t, cell(1), cell(4)));
      }
    }
  }
  const loads = fps.cells.map((c) => c.loadavg1m);
  console.log(`\nload average (1 min) at cell start: min ${Math.min(...loads)}, median ${loads.sort((a, b) => a - b)[loads.length >> 1]}, max ${Math.max(...loads)}`);
}

const stress = load('stress');
if (stress) {
  console.log('\n### Stress (CPU 4x, DPR 1): median / p5 fps\n');
  console.log(row('Group', 'Tier', 'Extra robots', 'Draw calls', 'Triangles', 'median fps', 'p5 fps', 'mean fps'));
  console.log(row('---', '---', '---:', '---:', '---:', '---:', '---:', '---:'));
  for (const c of stress.cells) console.log(row(c.group, c.tier, c.extra, c.drawCalls, c.triangles, c.medianFps, c.p5Fps, c.meanFps));
}

const aa = load('aa');
if (aa) {
  console.log('\n### MSAA (CPU 4x, DPR 2): median of runs, median / p5 / mean fps\n');
  console.log(row('Group', 'Tier', 'antialias', 'median fps', 'p5 fps', 'mean fps'));
  console.log(row('---', '---', '---', '---:', '---:', '---:'));
  for (const c of aa.summary) console.log(row(c.group, c.tier, c.aa ? 'on' : 'off', c.medianFps, c.p5Fps, c.meanFps));
}

const boot = load('boot');
if (boot) {
  console.log('\n### Boot of the lazy chunk (fresh load, median of runs, ms)\n');
  console.log(row('Controls', 'CPU', 'import (fetch+parse+eval)', 'import end to Lab render', 'import end to renderer creation (React commit)', 'new WebGLRenderer()', 'renderer created to first frame', 'first frame after import start', 'worst first frame'));
  console.log(row('---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:'));
  for (const r of boot.rows) console.log(row(r.controls, `${r.cpuThrottle}x`, r.importMsMedian, r.suspenseMsMedian, r.commitDelayMsMedian, r.rendererMsMedian, r.glEndToFirstFrameMsMedian, r.firstFrameMsMedian, r.firstFrameMsMax));
}

const idle = load('idle');
if (idle) {
  console.log('\n### Demand frameloop, orbit, run to motion\n');
  console.log(row('Controls', 'idle frames / 3 s', 'frames after drag', 'frames / 2 s once settled', 'camera moved', 'running frames / 3 s', 'run to 2nd frame 1x', '4x'));
  console.log(row('---', '---:', '---:', '---:', '---', '---:', '---:', '---:'));
  for (const [name, v] of Object.entries(idle.variants)) console.log(row(name, v.idleFramesIn3s, v.framesAfterOrbitDrag, v.framesIn2sAfterSettling, v.cameraMoved, v.runningFramesIn3s, `${v.runToSecondFrameMs['1x']} ms`, `${v.runToSecondFrameMs['4x']} ms`));
}

const context = load('context');
if (context) {
  console.log('\n### Context loss\n');
  for (const s of context.scenarios) {
    console.log(`- ${s.group} / ${s.name.replace(`${s.group}-`, '')}: events ${JSON.stringify(s.eventsDuringLoss)}; while lost isContextLost=${s.whileLost.isContextLost}, pixels read ${JSON.stringify(s.whileLost.pixelsRead[0])}, useFrame calls in 1.5 s ${s.whileLost.framesCalledWhileLost}, render call ${s.whileLost.renderCallMsMedian} ms; restore event after ${s.recoveryMs} ms; ` +
      (s.afterRestore ? `after restore: frames rendered ${s.afterRestore.framesRenderedAfterRestore}, sampled pixels equal baseline ${s.afterRestore.pixelsEqualBaseline}, whole-frame hash equal baseline ${s.afterRestore.frameHashEqualBaseline}` : 'not restored') +
      (s.afterInvalidate ? `; after invalidate(): ${s.afterInvalidate.framesRenderedAfterInvalidate} frames` : ''));
  }
}

const soak = load('soak');
if (soak) {
  console.log('\n### Soak (60 s, headless shell + SwiftShader)\n');
  console.log(row('Run', 'Tier', 'CPU', 'host load avg (start / end)', 'frames', 'median fps', 'p5 fps', 'mean fps', 'frames > 50 ms', 'heap MB start -> end', 'GL geometries/textures start -> end', 'context events', 'crashes'));
  console.log(row('---:', '---', '---:', '---', '---:', '---:', '---:', '---:', '---:', '---', '---', '---:', '---:'));
  for (const r of soak.runs) console.log(row(r.run, r.tier, `${r.cpuThrottle}x`, `${r.loadavg1m.start} / ${r.loadavg1m.end}`, r.frames, r.medianFps, r.p5Fps, r.meanFps, r.framesOver50ms, `${r.heapMB.start} -> ${r.heapMB.end}`, `${r.glMemory.start.geometries}/${r.glMemory.start.textures} -> ${r.glMemory.end.geometries}/${r.glMemory.end.textures}`, r.contextEvents, r.crashes));
}

const flags = load('flags');
if (flags) {
  console.log('\n### Launch flags\n');
  console.log(row('Launch', 'WebGL2', 'Renderer', 'Console (distinct)'));
  console.log(row('---', '---', '---', '---'));
  for (const r of flags.rows) console.log(row(r.name, r.webgl2 ? 'yes' : 'no', r.renderer ?? '-', r.messages.map((m) => `${m.text.slice(0, 90)}${m.count > 1 ? ` x${m.count}` : ''}`).join('<br>') || '-'));
  console.log('\nConsole of the lab page (distinct messages):');
  for (const [name, list] of Object.entries(flags.labPageConsole ?? {})) {
    console.log(`- ${name}:`);
    for (const m of list) console.log(`  - ${m.text.slice(0, 200)}${m.count > 1 ? ` (x${m.count})` : ''}`);
  }
}

const engines = load('engines');
if (engines) {
  console.log('\n### Other engines\n');
  for (const r of engines.rows) console.log(`- ${r.engine}: ${r.error ? `FAILED: ${r.error}` : `${r.version}, ${r.renderer}, median ${r.medianFps} fps, p5 ${r.p5Fps}`}`);
}
