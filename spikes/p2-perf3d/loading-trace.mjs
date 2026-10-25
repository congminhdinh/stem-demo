// N18 P2 spike (evidence for p2-audit.md). Run from the repository root after pnpm bench:robot3d has built its dist:
//   node spikes/p2-perf3d/loading-trace.mjs [--profile=school|gpu] [--template=rb-line-follow] [--out=trace.json] [--dist=<build>] [--check | --warmup] [--cold]
// What the main thread does from the lesson page's navigation to the robot lab's first 3D frame (school PC profile: SwiftShader, CPU 6x,
// 1366 x 768; or --profile=gpu): a Chromium trace (devtools.timeline), its long tasks on the renderer's main thread with what ran in
// them (scripts mapped to sources through the bench build's source maps), aligned with the probe's performance marks.
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const root = process.cwd();
const profileName = (process.argv.find((a) => a.startsWith('--profile=')) ?? '--profile=school').split('=')[1];
const template = (process.argv.find((a) => a.startsWith('--template=')) ?? '--template=rb-line-follow').split('=')[1];
const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
const { chromium } = await import(join(root, 'node_modules/@playwright/test/index.mjs'));
const { loadSourceMaps } = await import(join(root, 'scripts/lib/profile-attribution.mjs'));
const dist = process.argv.find((a) => a.startsWith('--dist='))?.split('=')[1] ?? join(root, 'node_modules/.cache/bench-robot3d/dist');
// --check: instead of the loading, trace a whole Kiểm tra 4× of mini-mission and list its long tasks over 100 ms.
const checkMode = process.argv.includes('--check');
// --warmup (Phase B #1b): instead of the loading, trace the 3 s after the host's load-project (the lab's first use: the physics engine
// is loaded and warmed at idle then) and list its long tasks over 50 ms.
const warmupMode = process.argv.includes('--warmup');
// --cold (Phase B #5): trace the loading in the browser's first page, its GPU process fresh (no warming visit before it).
const coldMode = process.argv.includes('--cold');
const maps = loadSourceMaps(join(dist, 'assets'));
const port = 5304;
const kids = [spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }), spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' })];
await new Promise((r) => setTimeout(r, 1500));
const school = profileName === 'school';
const browser = await chromium.launch(school ? { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { headless: true, channel: 'chromium' });
const origin = `http://localhost:${port + 1}`;
const lab = `http://localhost:${port}/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(origin)}`;
const host = `${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`;
async function open(trace) {
  const context = await browser.newContext({ viewport: school ? { width: 1366, height: 768 } : { width: 1200, height: 760 } });
  await context.addInitScript({ path: join(root, 'scripts/lib/robot3d-probe.js') });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (school) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing', 'loading', 'v8', 'disabled-by-default-v8.cpu_profiler'];
  if (trace && !checkMode && !warmupMode) await browser.startTracing(page, { categories });
  const t0 = Date.now();
  await page.goto(host);
  const frame = page.frames().find((f) => f.url().includes('lab=robot'));
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120000 });
  const first = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 300));
  if (trace && checkMode) {
    const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
    const document = { schemaVersion: 1, id: 'trace', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions['rb-mini-mission'].reference } };
    await page.evaluate(([d, o]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: d }, o), [document, `http://localhost:${port}`]);
    await new Promise((r) => setTimeout(r, 2500));
    await browser.startTracing(page, { categories });
    await frame.evaluate("performance.mark('p2:check-start')");
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await frame.getByTestId('robot-check-results').waitFor({ timeout: 180000 });
  }
  if (trace && warmupMode) {
    const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
    const document = { schemaVersion: 1, id: 'trace', name: 'Robot', profile: 'uno-basic', kit: { id: 'ref-uno-rover', version: '0' }, circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] }, program: { blocks: robotSolutions[template].reference } };
    await browser.startTracing(page, { categories });
    await frame.evaluate("performance.mark('p2:load-project')");
    await page.evaluate(([d, o]) => globalThis.__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document: d }, o), [document, `http://localhost:${port}`]);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const buffer = trace ? await browser.stopTracing() : null;
  await context.close();
  return { first, buffer };
}
if (!coldMode) await open(false); // warm the GPU process and the shader JIT as a second visit would find them
const { first, buffer } = await open(true);
const events = JSON.parse(buffer.toString()).traceEvents;
if (out) writeFileSync(out, buffer);
// The renderer main thread of the lab (the thread with the lab's marks).
const marks = events.filter((e) => e.cat?.includes('blink.user_timing') && e.name?.startsWith('p2:'));
const nav = events.find((e) => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.includes('/lesson'))?.ts ?? events.reduce((least, e) => (e.ts > 0 && e.ts < least ? e.ts : least), Infinity);
const labThread = marks[0] ? [marks[0].pid, marks[0].tid] : null;
const onMain = (e) => labThread && e.pid === labThread[0] && e.tid === labThread[1];
const ms = (ts) => Math.round((ts - nav) / 1000);
console.log(`first frame (Node) ${first} ms; marks:`, marks.map((m) => `${m.name.slice(3)} ${ms(m.ts)}`).join(', '));
const where = (data) => {
  if (!data?.url) return data?.functionName ?? '';
  const file = data.url.split('/').pop().replace(/\?.*$/, '');
  const map = maps.get(file);
  const hit = map?.lookupNear(Math.max(0, (data.lineNumber ?? 1) - 1), Math.max(0, (data.columnNumber ?? 1) - 1));
  return hit ? `${hit.source.replace(/^node_modules\//, '')}:${hit.line + 1}` : `${file}:${data.lineNumber}`;
};
// The sampled CPU profile in the trace (ProfileChunk events of the lab thread): every sample's time and its leaf's source.
const { attributeCpuProfile } = await import(join(root, 'scripts/lib/profile-attribution.mjs'));
const profiles = new Map();
for (const e of events) {
  if (e.name === 'Profile' && onMain(e)) profiles.set(e.id, { start: e.args.data.startTime, nodes: new Map(), samples: [], deltas: [] });
}
for (const e of events) {
  if (e.name !== 'ProfileChunk' || !profiles.has(e.id)) continue;
  const p = profiles.get(e.id);
  const data = e.args.data;
  for (const node of data.cpuProfile?.nodes ?? []) p.nodes.set(node.id, { id: node.id, callFrame: node.callFrame, parent: node.parent, children: [] });
  p.samples.push(...(data.cpuProfile?.samples ?? []));
  p.deltas.push(...(data.timeDeltas ?? []));
}
const sliceProfile = (from, to) => {
  // A CPU profile of the samples between `from` and `to` (trace µs), in the shape CDP's Profiler.stop gives.
  const out = { nodes: [], samples: [], timeDeltas: [] };
  for (const p of profiles.values()) {
    for (const node of p.nodes.values()) node.children = [];
    for (const node of p.nodes.values()) if (node.parent !== undefined && p.nodes.has(node.parent)) p.nodes.get(node.parent).children.push(node.id);
    out.nodes.push(...[...p.nodes.values()].map((node) => ({ id: node.id, callFrame: node.callFrame, children: node.children })));
    let t = p.start;
    let last = null;
    for (let i = 0; i < p.samples.length; i++) {
      t += p.deltas[i] ?? 0;
      if (t >= from && t <= to) {
        out.samples.push(p.samples[i]);
        out.timeDeltas.push(last === null ? 0 : t - last);
        last = t;
      }
    }
  }
  return out;
};
const tasks = events.filter((e) => onMain(e) && e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur > (checkMode ? 100000 : warmupMode ? 50000 : 30000)).sort((a, b) => a.ts - b.ts);
const endAt = checkMode || warmupMode ? Infinity : (marks.find((m) => m.name === 'p2:first-scene-render')?.ts ?? Infinity);
let busy = 0;
for (const task of tasks) {
  if (task.ts > endAt + 2e6) break;
  busy += task.dur;
  const inside = events.filter((e) => onMain(e) && e.ph === 'X' && e.ts >= task.ts && e.ts + (e.dur ?? 0) <= task.ts + task.dur && e !== task && e.dur > 8000);
  const parts = inside.filter((e) => ['FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.compileModule', 'ParseHTML', 'Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'MinorGC', 'MajorGC', 'V8.GC_MARK_COMPACTOR', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'v8.run', 'Decode Image', 'ResourceReceivedData', 'v8.produceModuleCache', 'v8.deserializeContext', 'CompileScript', 'CompileCode', 'v8.parseOnBackground', 'HitTest', 'Commit'].includes(e.name));
  const sampled = attributeCpuProfile(sliceProfile(task.ts, task.ts + task.dur), maps, { top: 5 });
  const desc = Object.entries(sampled.topSourcesMs).filter(([, v]) => v >= 3).map(([k, v]) => `${k.replace(/^node_modules\//, '').replace(/^src\/ui\/robot3d\//, 'robot3d/')} ${Math.round(v)}`).join(' | ') || parts.slice(0, 4).map((e) => `${e.name}${e.args?.data ? ` ${where(e.args.data)}` : ''} ${Math.round(e.dur / 1000)}`).join(' | ');
  console.log(`${String(ms(task.ts)).padStart(6)} ms  task ${String(Math.round(task.dur / 1000)).padStart(4)} ms  ${desc}`);
  if (task.dur > 150000) {
    // The leaf functions of a big task: source line and its text.
    const slice = sliceProfile(task.ts, task.ts + task.dur);
    const byId = new Map(slice.nodes.map((node) => [node.id, node]));
    const fns = new Map();
    slice.samples.forEach((id, i) => {
      const node = byId.get(id);
      const frame = node?.callFrame;
      if (!frame) return;
      let key = frame.functionName || '(anonymous)';
      if (frame.url) {
        const file = frame.url.split('/').pop().replace(/\?.*$/, '');
        const hit = maps.get(file)?.lookupNear(frame.lineNumber, frame.columnNumber);
        key = hit ? `${hit.source.replace(/^node_modules\//, '')}:${hit.line + 1} ${hit.text.trim().slice(0, 70)}` : `${file}:${frame.lineNumber}`;
      }
      fns.set(key, (fns.get(key) ?? 0) + (slice.timeDeltas[i + 1] ?? 0) / 1000);
    });
    for (const [key, v] of [...fns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`           ${Math.round(v)} ms  ${key}`);
  }
}
console.log(`long tasks (> 30 ms) up to 2 s after the first scene render: ${Math.round(busy / 1000)} ms`);
await browser.close();
kids.forEach((k) => k.kill());
