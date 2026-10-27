// N19 E9 (review 1, Minor A): the long-task figures of bench:robot3d's cells, with a source that is committed. The bench's own tables show the fps pass's
// ("long tasks (>100) max ms"); the profile pass's (the same windows under V8's CPU profiler) and the exact counts are in the results JSON only, which is too big to
// keep (0.4 to 0.7 MB a run). This reads one or more of those files and writes, beside each, a small JSON of what it holds of long tasks: for every cell its profile,
// scenario, pass, repeat, load, window, and the window's `longTasks` as the probe summed them (`count` of tasks of 50 ms or more, `over100`, `maxMs`, `totalMs`).
//
//   node spikes/n19-e9/long-tasks.mjs <bench-robot3d-*.json> ... [--out=<dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const out = resolve((process.argv.slice(2).find((arg) => arg.startsWith('--out=')) ?? '--out=.').slice('--out='.length));
mkdirSync(out, { recursive: true });
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const cells = report.cells
    .filter((cell) => !cell.error && cell.window?.longTasks)
    .map((cell) => ({
      profile: cell.profile,
      scenario: cell.scenario,
      pass: cell.pass,
      repeat: cell.repeat,
      loadavg1m: cell.loadavg1m,
      windowS: Math.round(cell.window.seconds * 10) / 10,
      longTasks: cell.window.longTasks,
    }));
  const name = `long-tasks-${basename(file, '.json').replace(/^bench-robot3d-/, '')}.json`;
  writeFileSync(join(out, name), `${JSON.stringify({ source: basename(file), date: report.date, commit: report.commit, machine: report.machine, cells }, null, 1)}\n`);
  console.log(`\n${basename(file)} (${report.date}, commit ${report.commit}) -> ${name}`);
  console.log('profile      scenario          pass     #  load   window  tasks>=50ms  >100  max ms  total ms');
  for (const cell of cells) {
    const t = cell.longTasks;
    console.log(`${cell.profile.padEnd(12)} ${cell.scenario.padEnd(17)} ${cell.pass.padEnd(8)} ${String(cell.repeat).padStart(1)}  ${String(cell.loadavg1m).padStart(5)}  ${String(cell.windowS).padStart(5)}  ${String(t.count).padStart(11)}  ${String(t.over100).padStart(4)}  ${String(t.maxMs).padStart(6)}  ${String(t.totalMs).padStart(8)}`);
  }
}
