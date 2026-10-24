// Browser page of the R0.1 spike. Query: ?pkg=split|compat&mode=init|all|view&model=…
// Results go to window.__result (read by browsers.ts through Playwright) and to the page.
import { hashRun, HASH_SCRIPT, HASH_TICKS, trigProbe } from './scenarios.ts';
import { createSim, DRIVE_MODELS, PHYSICS_HZ, ROBOT, type DriveModel, type Rapier } from './sim.ts';

declare global {
  interface Window { __result?: unknown; __error?: string }
}

const params = new URLSearchParams(location.search);
const pkg = params.get('pkg') === 'split' ? 'split' : 'compat';
const mode = params.get('mode') ?? 'all';
const status = document.getElementById('status')!;
const out = document.getElementById('out')!;

async function loadRapier(): Promise<{ R: Rapier; importMs: number; initMs: number }> {
  const t0 = performance.now();
  // Split: the wasm is fetched and instantiated while the module evaluates (vite-plugin-wasm
  // top-level await). Compat: the module carries the wasm as base64; init() decodes + compiles.
  const mod = pkg === 'split'
    ? await import('@dimforge/rapier3d-deterministic')
    : await import('@dimforge/rapier3d-deterministic-compat');
  const t1 = performance.now();
  const R = mod.default as unknown as Rapier;
  if (typeof (R as { init?: unknown }).init === 'function') await R.init();
  const t2 = performance.now();
  return { R, importMs: t1 - t0, initMs: t2 - t1 };
}

async function run() {
  const tMain = performance.now(); // ms since navigation start
  const { R, importMs, initMs } = await loadRapier();
  const w0 = performance.now();
  createSim(R, { model: 'velocity', start: { x: 0, z: 0 }, box: { x: 0.5, z: 0 } }).dispose();
  const worldCreateMs = performance.now() - w0;
  const init = {
    mainStartMs: +tMain.toFixed(2),
    importMs: +importMs.toFixed(2),
    initMs: +initMs.toFixed(2),
    importPlusInitMs: +(importMs + initMs).toFixed(2),
    fromNavigationMs: +performance.now().toFixed(2),
    worldCreateMs: +worldCreateMs.toFixed(3),
    resources: performance.getEntriesByType('resource')
      .map((e) => e as PerformanceResourceTiming)
      .filter((e) => /\.(js|wasm)$/.test(e.name))
      .map((e) => ({ name: e.name.split('/').pop(), ms: +e.duration.toFixed(1), transfer: e.transferSize, decoded: e.decodedBodySize })),
  };
  const base = { pkg, ua: navigator.userAgent, isolated: crossOriginIsolated, rapier: R.version(), init };
  if (mode === 'init') return base;
  if (mode === 'view') return view(R, (params.get('model') as DriveModel) ?? 'velocity'), base;
  const now = () => performance.now();
  const hashes: Record<string, unknown> = {};
  for (const model of DRIVE_MODELS) {
    const a = hashRun(R, { model }, now);
    const b = hashRun(R, { model }, now);
    hashes[model] = {
      run1: { finalQ6: a.finalQ6, trajQ6: a.trajQ6, trajBits: a.trajBits },
      run2: { finalQ6: b.finalQ6, trajQ6: b.trajQ6, trajBits: b.trajBits },
      equal: a.finalQ6 === b.finalQ6 && a.trajQ6 === b.trajQ6 && a.trajBits === b.trajBits,
      msPerTickWarm: b.msPerTick,
      timerResolutionMs: b.timerResolutionMs,
    };
  }
  return { ...base, hashTicks: HASH_TICKS, hashes, trig: trigProbe() };
}

/** Real-time top view of the determinism script: the "runnable" part of the spike. */
function view(R: Rapier, model: DriveModel) {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  canvas.hidden = false;
  const g = canvas.getContext('2d')!;
  const sim = createSim(R, { model, start: { x: -0.2, z: 0 }, box: { x: -0.55, z: 0 } });
  const plan: [number, number][] = [];
  for (const [n, l, r] of HASH_SCRIPT) for (let i = 0; i < n; i++) plan.push([l, r]);
  const s = canvas.width / 2.2; // px per metre, arena 2 m + margin
  const px = (x: number) => canvas.width / 2 + x * s;
  const trail: [number, number][] = [];
  let tick = 0, debt = 0, last = performance.now();
  const frame = (t: number) => {
    debt += Math.min(100, t - last);
    last = t;
    while (debt >= 1000 / PHYSICS_HZ && tick < HASH_TICKS) {
      const [l, r] = plan[tick] ?? [0, 0];
      sim.setWheelTargets(l, r);
      sim.step();
      tick++;
      debt -= 1000 / PHYSICS_HZ;
      const p = sim.chassis.translation();
      if (tick % 4 === 0) trail.push([p.x, p.z]);
    }
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = '#333';
    g.strokeRect(px(-1), px(-1), 2 * s, 2 * s);
    g.strokeStyle = '#4a7';
    g.beginPath();
    trail.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))));
    g.stroke();
    for (const [body, hx, hz, color] of [
      [sim.chassis, ROBOT.bodyHalf.x, ROBOT.bodyHalf.z, '#27c'],
      ...(sim.box ? [[sim.box, 0.05, 0.05, '#c72']] : []),
    ] as const) {
      const p = body.translation(), q = body.rotation();
      // heading from the quaternion without trig: forward = rotate(q, +X)
      const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
      g.save();
      g.translate(px(p.x), px(p.z));
      g.transform(fx, fz, -fz, fx, 0, 0);
      g.fillStyle = color;
      g.fillRect(-hx * s, -hz * s, 2 * hx * s, 2 * hz * s);
      g.restore();
    }
    status.textContent = `${pkg} / ${model}: tick ${tick} / ${HASH_TICKS}`;
    if (tick < HASH_TICKS) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

run().then(
  (result) => {
    window.__result = result;
    if (mode !== 'view') status.textContent = 'done';
    out.textContent = JSON.stringify(result, null, 2);
  },
  (e: unknown) => {
    window.__error = String(e);
    status.textContent = `error: ${String(e)}`;
  },
);
