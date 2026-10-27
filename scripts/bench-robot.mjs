// The strict performance budgets of the robot lab (N18 P1, robot plan §5), which `pnpm verify` does not hold: its cost tests assert generous
// bounds that survive other test workers and agents on the machine (2 ms a tick, 20 s a headless check of 3 × 60 s); this script measures
// the plan's own and fails when one is missed. Run it on a quiet machine.
//
//   node scripts/bench-robot.mjs [--smoke] [--budget-scale <factor>] [--gripper]
//   pnpm bench:robot
//
//   --smoke         everything for a moment (a few ticks, every check cut to 1 s a variant): shows that the tool works; its numbers are
//                   not the budgets' (tests/bench-robot.test.ts runs it)
//   --gripper       N19 E9: four rows more, the headless check of each gripper lesson's reference solution (rb-grip-pick, -deliver, -sort,
//                   -stack on ref-uno-gripper@0), at the rate of the pilot lessons'. The table without it is the rover's, row for row
//                   (tests/bench-robot.test.ts pins it, and the usage message below).
//   --budget-scale  multiplies every budget (default 1): 3 for the plan's slow tier (a headless check ≤ 30 s), a large one to check only
//                   that the measurements run
//
// It prints one table: a tick with the program in the loop (median and p95 ms of CPU, JS heap per tick) for the obstacle avoider and the
// line follower; the headless check of 3 variants × 60 s; the headless check of each pilot scenario's reference solution; the JS heap per
// hardware read. What is measured and why: src/core/run/__fixtures__/robot-bench.ts.
//
// Exit codes: 0 every budget holds; 1 a budget is missed (the table says which), or a measurement failed; 2 a usage error.
//
// The sources are TypeScript with extensionless imports (and the pilot scenarios use `import.meta.glob`), so the script loads them through
// Vite's SSR loader with the repo's vite.config.ts, as scripts/export-robot-manifest.mjs does, with a dependency cache of its own
// (node_modules/.vite-bench-robot: never node_modules/.vite, which `pnpm dev` and the e2e runs share) and no WebSocket server (`ws: false`:
// with `hmr: false` alone Vite still opens one on port 24678, so two runs at once, or a run next to `pnpm dev`, wrote a port error). Plain Node cannot load Rapier's split
// .wasm package, so physics is initialised first with its -compat build (same wasm, same results: tests/robot-determinism.test.ts).

import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A failure with the exit code it ends the script with. */
class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));

function parseArguments(args) {
  const options = { smoke: false, budgetScale: 1, gripper: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--smoke') {
      options.smoke = true;
    } else if (arg === '--gripper') {
      options.gripper = true;
    } else if (arg === '--budget-scale') {
      const value = Number(args[index + 1]);
      if (!(Number.isFinite(value) && value > 0)) {
        throw new Failure(2, '--budget-scale needs a number above 0.');
      }
      options.budgetScale = value;
      index += 1;
    } else {
      throw new Failure(2, `Unknown option ${arg}. Usage: node scripts/bench-robot.mjs [--smoke] [--budget-scale <factor>]`);
    }
  }
  return options;
}

/** A value in its unit, with the precision the unit needs. */
function shown(value, unit) {
  if (unit === 'ms') return `${value.toFixed(4)} ms`;
  if (unit === 's') return `${value.toFixed(2)} s`;
  if (unit === 'KiB') return `${value.toFixed(1)} KiB`;
  return `${value.toFixed(1)} B`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const started = performance.now();
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    cacheDir: join(root, 'node_modules', '.vite-bench-robot'),
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let report;
  try {
    const physics = await server.ssrLoadModule('/src/core/world/rapier.ts');
    await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')).default);
    const { runRobotBench } = await server.ssrLoadModule('/src/core/run/__fixtures__/robot-bench.ts');
    report = await runRobotBench({ smoke: options.smoke, gripper: options.gripper });
  } catch (error) {
    throw new Failure(1, `The bench did not run: ${messageOf(error)}`);
  } finally {
    await server.close();
  }

  const lines = [
    `pnpm bench:robot${options.smoke ? ' --smoke (a moment of each: not the budgets’ numbers)' : ''}${options.gripper ? ' --gripper' : ''}: ${report.machine}`,
    `budgets of the robot plan §5${options.budgetScale === 1 ? '' : ` × ${options.budgetScale}`}`,
    '',
    '| measure | value | budget | result | detail |',
    '|---|---|---|---|---|',
  ];
  const missed = [];
  for (const row of report.rows) {
    const budget = row.budget === null ? null : row.budget * options.budgetScale;
    const ok = budget === null || row.value <= budget;
    if (!ok) missed.push(row.name);
    lines.push(`| ${row.name} | ${shown(row.value, row.unit)} | ${budget === null ? '—' : `≤ ${shown(budget, row.unit)}`} | ${budget === null ? 'told' : ok ? 'ok' : 'MISSED'} | ${row.detail} |`);
  }
  lines.push('', `${report.rows.length} measures, ${missed.length} budget${missed.length === 1 ? '' : 's'} missed, ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (missed.length > 0) {
    throw new Failure(1, `Missed: ${missed.join('; ')}.`);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  process.exitCode = error instanceof Failure ? error.code : 1;
}
