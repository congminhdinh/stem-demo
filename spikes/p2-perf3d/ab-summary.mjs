// N18 P2 Phase B: the before/after table of a phase-b-ab.sh folder (or any folder of bench:robot3d .json or .json.gz results): for each label
// (its round number dropped) and cell, the ranges over the rounds. Run from the repository root:
//
//   node spikes/p2-perf3d/ab-summary.mjs <dir> [--cols=a,b]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const dir = process.argv[2];
const round = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? null : Number(value.toFixed(digits)));
const range = (values, digits = 1) => {
  const known = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
  if (known.length === 0) return '—';
  const [low, high] = [Math.min(...known), Math.max(...known)];
  return low === high ? `${round(low, digits)}` : `${round(low, digits)}–${round(high, digits)}`;
};
const columns = {
  fps: [(c, w) => (w?.frameMs?.p50 ? 1000 / w.frameMs.p50 : null), 1],
  'p95 ms': [(c, w) => w?.frameMs?.p95, 1],
  'p99 ms': [(c, w) => w?.frameMs?.p99, 1],
  'long ≥50 (>100)': [(c, w) => (w?.longTasks ? `${w.longTasks.count} (${w.longTasks.over100})` : null), 0],
  'long max ms': [(c, w) => w?.longTasks?.maxMs, 0],
  'long total ms': [(c, w) => w?.longTasks?.totalMs, 0],
  'GPU proc ms/frame': [(c, w) => w?.processCpu?.GPU?.msPerFrame, 1],
  'renderer ms/frame': [(c, w) => w?.processCpu?.renderer?.msPerFrame, 1],
  'first frame ms': [(c) => c.firstFrameMs, 0],
  'first Run→moving': [(c) => c.firstRunToMovingMs, 0],
  'Run→moving': [(c) => c.runToMovingMs, 0],
  'tag changes/s': [(c, w) => (w && w.tagSpotChanges !== undefined ? w.tagSpotChanges / w.seconds : null), 1],
  'check s': [(c, w) => (w?.checkMs ? w.checkMs / 1000 : null), 1],
  'switch 2D↔3D heap MB': [(c) => (c.switch ? c.switch.views.heapGrowthB / 2 ** 20 : null), 2],
  'switch 2D↔3D listeners': [(c) => c.switch?.views.listenersGrowth ?? null, 0],
  'switch tiers heap MB': [(c) => (c.switch ? c.switch.tiers.heapGrowthB / 2 ** 20 : null), 2],
  'switch tiers listeners': [(c) => c.switch?.tiers.listenersGrowth ?? null, 0],
  'switch GPU res (geo/tex/prog/ctx)': [(c) => (c.switch ? ['views', 'tiers'].map((k) => { const g = c.switch[k]; return `${g.geometriesGrowth}/${g.texturesGrowth}/${g.programsGrowth}/${g.liveContextsGrowth}`; }).join(' · ') : null), 0],
  'CPU loop': [(c) => c.cpuBenchMs, 0],
  load: [(c) => c.loadavg1m, 2],
};
const wanted = (process.argv.find((arg) => arg.startsWith('--cols='))?.slice(7).split(',') ?? Object.keys(columns)).filter((name) => columns[name]);
const groups = new Map();
for (const file of readdirSync(dir).filter((name) => /\.json(\.gz)?$/.test(name)).sort()) {
  const bytes = readFileSync(join(dir, file));
  const result = JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  const label = (result.options.label ?? '').replace(/-\d+$/, '');
  for (const cell of result.cells.filter((entry) => !entry.error)) {
    const key = `${label} · ${cell.profile} · ${cell.scenario}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cell);
  }
}
const sortKey = (key) => key.split(' · ').slice(1).join(' · ') + ' ' + key.split(' · ')[0];
process.stdout.write(`| label · profile · scenario | n | ${wanted.join(' | ')} |\n|---|---|${wanted.map(() => '---').join('|')}|\n`);
for (const key of [...groups.keys()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
  const cells = groups.get(key);
  const values = wanted.map((name) => {
    const [pick, digits] = columns[name];
    const picked = cells.map((cell) => pick(cell, cell.window ?? cell.drag ?? null));
    return typeof picked.find((value) => value !== null && value !== undefined) === 'string' ? [...new Set(picked)].join(', ') : range(picked, digits);
  });
  process.stdout.write(`| ${key} | ${cells.length} | ${values.join(' | ')} |\n`);
}
