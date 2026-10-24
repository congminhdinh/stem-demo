// R0.1 Node runner. Usage (from the repo root):
//   node spikes/robot-physics/node-run.ts run1      -> spikes/robot-physics/results/node-run1.json
//   node spikes/robot-physics/node-run.ts run2 --quick   (hashes + trig only)
import { writeFileSync, mkdirSync } from 'node:fs';
import { arch, cpus, loadavg, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = process.argv[2] ?? 'run';
const quick = process.argv.includes('--quick');
const here = dirname(fileURLToPath(import.meta.url));

const tImport = performance.now();
const R = (await import('@dimforge/rapier3d-deterministic-compat')).default;
const tImported = performance.now();
await R.init();
const tInit = performance.now();

const { allMetrics, hashRun, trigProbe, HASH_TICKS } = await import('./scenarios.ts');
const { DRIVE_MODELS, MODEL_TUNING, createSim } = await import('./sim.ts');

let splitInNode: string;
try {
  await import('@dimforge/rapier3d-deterministic');
  splitInNode = 'ok';
} catch (e) {
  splitInNode = `FAIL: ${String(e).split('\n')[0]}`;
}

const now = () => performance.now();
const tWorld0 = now();
createSim(R, { model: 'velocity', start: { x: 0, z: 0 }, box: { x: 0.5, z: 0 } }).dispose();
const worldCreateMs = now() - tWorld0;

const hashes = Object.fromEntries(
  DRIVE_MODELS.map((model) => {
    const a = hashRun(R, { model }, now);
    const b = hashRun(R, { model }, now);
    return [model, {
      tuning: MODEL_TUNING[model],
      run1: { finalQ6: a.finalQ6, trajQ6: a.trajQ6, trajBits: a.trajBits },
      run2: { finalQ6: b.finalQ6, trajQ6: b.trajQ6, trajBits: b.trajBits },
      equal: a.finalQ6 === b.finalQ6 && a.trajQ6 === b.trajQ6 && a.trajBits === b.trajBits,
      stallMaxSpeedMmS: b.stallMaxSpeedMmS,
      msPerTickWarm: b.msPerTick,
      msPerTickCold: a.msPerTick,
      finalPoses: b.finalPoses,
    }];
  }),
);

const out: Record<string, unknown> = {
  label,
  env: {
    node: process.version, platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model, cores: cpus().length, rapier: R.version(), loadavg: loadavg(),
  },
  init: {
    importMs: +(tImported - tImport).toFixed(2),
    initMs: +(tInit - tImported).toFixed(2),
    totalMs: +(tInit - tImport).toFixed(2),
    worldCreateMs: +worldCreateMs.toFixed(3),
  },
  splitPackageInNode: splitInNode,
  hashTicks: HASH_TICKS,
  hashes,
  trig: trigProbe(),
};

if (!quick) {
  out.metrics = Object.fromEntries(DRIVE_MODELS.map((model) => [model, allMetrics(R, { model })]));
  // Integration-parameter sweep: lengthUnit x numSolverIterations per model.
  const sweep: Record<string, unknown>[] = [];
  for (const model of DRIVE_MODELS)
    for (const lengthUnit of [1, 0.1])
      for (const [solverIterations, pgsIterations] of [[1, 1], [2, 1], [4, 1], [8, 1], [8, 2]] as const) {
        const tuning = { lengthUnit, solverIterations, pgsIterations };
        const m = allMetrics(R, { model, tuning });
        const h = hashRun(R, { model, tuning }, now);
        sweep.push({
          model, lengthUnit, solverIterations, pgsIterations,
          crossTrackMm: m.straight.crossTrackMaxMm, headingErrDeg: m.straight.headingErrDeg,
          bounceMm: m.straight.bounceYRangeMm, spinMeanDeg: m.spin.meanDeg, spinRepeatDeg: m.spin.repeatErrMaxDeg,
          spinDriftMm: m.spin.centerDriftMm, pushSpeedMs: m.push.robotPushSpeedMs,
          idleMaxSpeedMmS: m.idle.maxSpeedMmS, idleDriftUm: m.idle.driftUm,
          stallMaxSpeedMmS: h.stallMaxSpeedMmS, msPerTickMedian: h.msPerTick.median,
        });
      }
  out.sweep = sweep;
  // Model-specific variants that led to the presets: joint wheel shape x motor model x factor,
  // raycast tyre / gain / suspension. All at the model's MODEL_TUNING.
  const brief = (m: ReturnType<typeof allMetrics>) => ({
    crossTrackMm: m.straight.crossTrackMaxMm, bounceMm: m.straight.bounceYRangeMm, maxTiltDeg: m.straight.maxTiltDeg,
    spinMeanDeg: m.spin.meanDeg, spinRepeatDeg: m.spin.repeatErrMaxDeg, spinDriftMm: m.spin.centerDriftMm,
    pushSpeedMs: m.push.robotPushSpeedMs, idleMaxSpeedMmS: m.idle.maxSpeedMmS, idleDriftUm: m.idle.driftUm,
    stepResponse90Ms: m.idle.stepResponse90Ms,
  });
  const variants: Record<string, unknown>[] = [];
  for (const wheelShape of ['cylinder', 'roundCylinder', 'ball'] as const)
    for (const motorModel of ['acceleration', 'force'] as const)
      for (const motorFactor of [50, 500, 5000])
        variants.push({ model: 'joint', wheelShape, motorModel, motorFactor, ...brief(allMetrics(R, { model: 'joint', wheelShape, motorModel, motorFactor })) });
  for (const frictionSlip of [1, 3, 10.5])
    for (const sideStiffness of [1, 5])
      for (const kp of [0.05, 0.2])
        variants.push({ model: 'raycast', frictionSlip, sideStiffness, kp, ...brief(allMetrics(R, { model: 'raycast', raycast: { frictionSlip, sideStiffness, kp } })) });
  for (const sag of [0.0005, 0.002])
    for (const zeta of [0.7, 1, 2])
      variants.push({ model: 'raycast', sag, zeta, ...brief(allMetrics(R, { model: 'raycast', raycast: { sag, zeta } })) });
  out.variants = variants;
  // Headless budget proxy: 3 scenario variants x 60 s of physics (7200 ticks each), per model.
  out.headless3x60s = Object.fromEntries(
    DRIVE_MODELS.map((model) => {
      const t0 = now();
      for (let v = 0; v < 3; v++) {
        const sim = createSim(R, { model, start: { x: -0.2, z: 0.1 * v }, box: { x: -0.55, z: 0.1 * v } });
        sim.setWheelTargets(10, 9);
        for (let i = 0; i < 7200; i++) {
          if (i % 600 === 0) sim.setWheelTargets(i % 1200 === 0 ? 10 : -6, i % 1200 === 0 ? 9 : 6);
          sim.step();
        }
        sim.dispose();
      }
      return [model, { wallMs: +(now() - t0).toFixed(1) }];
    }),
  );
}

mkdirSync(join(here, 'results'), { recursive: true });
const file = join(here, 'results', `node-${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
for (const [model, h] of Object.entries(hashes)) {
  console.log(model.padEnd(9), h.run1.finalQ6, h.run1.trajQ6, h.run1.trajBits, h.equal ? 'equal' : 'DIFFERENT', 'ms/tick', h.msPerTickWarm.median, h.msPerTickWarm.p95);
}
console.log('init', out.init, 'split in node:', splitInNode);
console.log('wrote', file);
