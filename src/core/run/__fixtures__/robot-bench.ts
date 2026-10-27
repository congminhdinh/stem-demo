import { arch, cpus, loadavg, platform } from 'node:os';
import { productionKits } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { readAllocation, tickAllocation, heapAllocated } from '../../program/__fixtures__/allocation';
import { driveMove, led, lineDark, registry, servoSet, ultrasonic } from '../../program/__fixtures__/uno-blocks';
import { cmp, getVar, ifElif, ifThen, num, setVar } from '../../program/__fixtures__/ybc-blocks';
import allGoalsScenario from '../../scenario/__fixtures__/all-goals.scenario.json';
import { gripperReferences, pilotReferences } from '../../scenario/__fixtures__/check-cases';
import { checkRobot } from '../../scenario/check-robot';
import { loadScenario, type Scenario } from '../../scenario/scenario';
import { threadCpuMs } from '../../world/__fixtures__/cpu-time';
import { PHYSICS_HZ } from '../../world/rapier';
import type { ProjectDocument } from '../../circuit/document';
import { everyGoalScorer, robotProject, rover, roverSession, unoR3Board, worldOf } from './robot-session';

// DEV TOOL (N18 P1): the measurements of `pnpm bench:robot` (scripts/bench-robot.mjs loads this module through Vite and prints them), with
// the strict budgets of the robot plan §5 that `pnpm verify` does not hold: its cost tests assert generous bounds that survive other
// workers on the machine (2 ms a tick, 20 s a headless check), these the plan's own.
//
//   - a tick with the program in the loop (the interpreter, the virtual UNO, the world, the goal frame, every goal), for the obstacle avoider
//     and the line follower in the all-goals scenario, variant 1: CPU time of this thread in batches of 10 ticks. Plan §5's 0.5 ms (physics
//     ≤ 0.5 ms/tick on a mid-range machine) holds for the median, the p95 and the mean, so a batch with a collection in it counts and the
//     time the collector takes on this thread too (the M4 Pro of P1 measures a median of 0.13–0.18 ms, a p95 of 0.17–0.23 ms and a mean
//     of 0.14–0.19 ms, from a load average of 3.5 to one of 12); the JS heap per tick told. The world's own budget (world.cost.test.ts) is inside these: a
//     tick here is the world's and the program's;
//   - the headless check (checkRobot, as R6.3 calls it) of 3 variants × 60 s of the avoider with every goal: within 10 s of CPU;
//   - the headless check of each pilot scenario's reference solution (src/samples/robot-solutions.ts): within the same rate, 10 s per
//     3 × 60 s of simulated time (variants × the scenario's time limit). Each check must run every variant to its time limit, or its time
//     is not the budget's (a check that ended early fails the bench);
//   - the JS heap per hardware read on the interpreter's read path (three line reads in every loop(), program/__fixtures__/allocation.ts):
//     within 64 bytes, everything the ticks allocate included; the line follower with its drive, the ultrasonic (a few reads a tick, which
//     share the tick's own allocation) and what a tick allocates by itself, told.
//
//   - N19 E9, with `gripper`: the same check of each gripper lesson's reference solution (rb-grip-pick, -deliver, -sort, -stack, on
//     ref-uno-gripper@0), at the same rate. Not in the default table: tests/bench-robot.test.ts pins that table row for row, and the rover's
//     rows, method and budgets are as they were.
//
// `smoke` runs everything for a moment (a few ticks, checks cut to 1 s a variant), to show the tool works: its numbers are not the budgets'.

export type BenchOptions = { smoke?: boolean; gripper?: boolean };

/** One measurement: a value in `unit`, and the budget it must stay within, or null for one only told. */
export type BenchRow = { name: string; value: number; unit: 'ms' | 's' | 'B' | 'KiB'; budget: number | null; detail: string };

export type BenchReport = { machine: string; smoke: boolean; rows: BenchRow[] };

/** Plan §5: physics ≤ 0.5 ms a tick on a mid-range machine. */
export const TICK_BUDGET_MS = 0.5;
/** Plan §5: a headless check of 3 variants × 60 s within 10 s on a mid-range machine. */
export const CHECK_BUDGET_S = 10;
/** N18 P1: the JS heap of a hardware read on the interpreter's read path. */
export const READ_BUDGET_BYTES = 64;

/** Forward until the ultrasonic reads under 25 cm, then turn; the servo and the LED follow (robot-run-session.cost.test.ts). */
export const avoider = (): ProjectDocument =>
  robotProject(
    [servoSet('servo1', num(30))],
    [
      setVar('x', ultrasonic()),
      ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
    ],
  );

/** Three line sensors in every loop(), then the drive (robot-run-session.cost.test.ts). */
const lineFollowerBlocks = () => [
  ifElif([[lineDark('lineCenter'), [driveMove('forward', num(60))]], [lineDark('lineLeft'), [driveMove('spinLeft', num(50))]], [lineDark('lineRight'), [driveMove('spinRight', num(50))]]], [driveMove('forward', num(40))]),
];
export const lineFollower = (): ProjectDocument => robotProject([], lineFollowerBlocks());

const allGoals = () => loadScenario(allGoalsScenario);

/** The machine the numbers come from. */
function machine(): string {
  const [first] = cpus();
  return `${first?.model ?? 'unknown CPU'} (${cpus().length} cores), ${platform()} ${arch()}, Node ${process.version}, load average ${loadavg()
    .map((load) => load.toFixed(1))
    .join(' ')}`;
}

/** The sorted value at quantile `q` (nearest rank). */
const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? Number.NaN;

/** A tick of `project` in the all-goals scenario, variant 1, every goal fed: ms of CPU per tick in batches of 10 ticks, and the heap per tick. */
async function tickCost(project: ProjectDocument, smoke: boolean): Promise<{ median: number; p95: number; mean: number; kibPerTick: number; ticks: number }> {
  const warmup = smoke ? 30 : 300;
  const batches = smoke ? 20 : 300;
  const heapTicks = smoke ? 30 : 1000;
  const session = roverSession(allGoals(), { scorer: everyGoalScorer });
  try {
    const started = await session.start(project, 1);
    if (!started.ok) {
      throw new Error(`The bench program did not start: ${started.reason}`);
    }
    await session.runUntil(warmup / PHYSICS_HZ);
    const perTick: number[] = [];
    let tick = warmup;
    const cpuStarted = threadCpuMs();
    for (let batch = 0; batch < batches; batch++) {
      const begin = threadCpuMs();
      tick += 10;
      await session.runUntil(tick / PHYSICS_HZ);
      perTick.push((threadCpuMs() - begin) / 10);
    }
    const mean = (threadCpuMs() - cpuStarted) / (batches * 10);
    const bytes = await heapAllocated(() => session.runUntil((tick + heapTicks) / PHYSICS_HZ));
    if (worldOf(session).t !== (tick + heapTicks) / PHYSICS_HZ) {
      throw new Error(`The bench run ended early, at ${worldOf(session).t} s.`);
    }
    perTick.sort((a, b) => a - b);
    return { median: quantile(perTick, 0.5), p95: quantile(perTick, 0.95), mean, kibPerTick: bytes / heapTicks / 1024, ticks: batches * 10 };
  } finally {
    session.stop();
  }
}

/**
 * A headless check of `project` in `scenario` (cut to 1 s a variant when `smoke`): CPU s, and the simulated time it covers. Every variant
 * must have run to the time limit: a check that ended early (a crash that ends the run, a fault) took less time than its budget is for.
 */
async function checkCost(project: ProjectDocument, scenario: Scenario, smoke: boolean, kit: Kit = rover): Promise<{ cpuS: number; simulatedS: number; score: number | null }> {
  const checked = smoke ? { ...scenario, timeLimitS: 1 } : scenario;
  const started = threadCpuMs();
  const result = await checkRobot(project, checked, { mode: 'headless', kit, board: unoR3Board, registry }).result;
  const cpuS = (threadCpuMs() - started) / 1000;
  const simTimes = result?.variants.map((variant) => variant.simTimeMs) ?? [];
  const full = Array.from({ length: checked.variants.count }, () => checked.timeLimitS * 1000);
  if (simTimes.join() !== full.join()) {
    throw new Error(`The headless check of ${checked.key} ran [${simTimes.join(', ')}] ms of simulated time, not [${full.join(', ')}]: its time is not the budget's.`);
  }
  return { cpuS, simulatedS: checked.variants.count * checked.timeLimitS, score: result?.score ?? null };
}

/** Every measurement of the bench (see the top of this file), in the order the table prints them. */
export async function runRobotBench(options: BenchOptions = {}): Promise<BenchReport> {
  const smoke = options.smoke === true;
  const rows: BenchRow[] = [];

  for (const [name, project] of [
    ['obstacle avoider', avoider],
    ['line follower', lineFollower],
  ] as const) {
    const cost = await tickCost(project(), smoke);
    const detail = `${cost.ticks} ticks of the all-goals scenario, variant 1, every goal; CPU of this thread, batches of 10 ticks`;
    rows.push({ name: `tick, ${name}: median`, value: cost.median, unit: 'ms', budget: TICK_BUDGET_MS, detail });
    rows.push({ name: `tick, ${name}: p95`, value: cost.p95, unit: 'ms', budget: TICK_BUDGET_MS, detail: 'of the batches of 10 ticks: a batch with a collection in it counts' });
    rows.push({ name: `tick, ${name}: mean`, value: cost.mean, unit: 'ms', budget: TICK_BUDGET_MS, detail: 'every tick measured, the collector\u2019s time on this thread included' });
    rows.push({ name: `tick, ${name}: JS heap`, value: cost.kibPerTick, unit: 'KiB', budget: null, detail: 'per tick: the world, the goals, the program' });
  }

  const allGoalsCheck = await checkCost(avoider(), allGoals(), smoke);
  rows.push({
    name: 'headless check 3 × 60 s, avoider, every goal',
    value: allGoalsCheck.cpuS,
    unit: 's',
    budget: CHECK_BUDGET_S * (allGoalsCheck.simulatedS / 180),
    detail: `${allGoalsCheck.simulatedS} s simulated, score ${String(allGoalsCheck.score)}`,
  });

  for (const reference of pilotReferences) {
    const scenario = reference.scenario();
    const cost = await checkCost(reference.project(), scenario, smoke);
    rows.push({
      name: `headless check, ${scenario.key} reference (${scenario.variants.count} × ${smoke ? 1 : scenario.timeLimitS} s)`,
      value: cost.cpuS,
      unit: 's',
      budget: CHECK_BUDGET_S * (cost.simulatedS / 180),
      detail: `10 s per 3 × 60 s simulated; score ${String(cost.score)}`,
    });
  }

  if (options.gripper === true) {
    const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
    for (const reference of gripperReferences) {
      const scenario = reference.scenario();
      const cost = await checkCost(reference.project(), scenario, smoke, gripperKit);
      rows.push({
        name: `headless check, ${scenario.key} reference (${scenario.variants.count} × ${smoke ? 1 : scenario.timeLimitS} s)`,
        value: cost.cpuS,
        unit: 's',
        budget: CHECK_BUDGET_S * (cost.simulatedS / 180),
        detail: `10 s per 3 × 60 s simulated; ref-uno-gripper@0; score ${String(cost.score)}`,
      });
    }
  }

  const window = smoke ? { warmupTicks: 60, ticks: 60 } : { warmupTicks: 600, ticks: 1200 };
  const reads = await readAllocation([ifElif([[lineDark('lineCenter'), []], [lineDark('lineLeft'), []], [lineDark('lineRight'), []]])], window);
  rows.push({
    name: 'heap per hardware read: three line reads a loop()',
    value: reads.bytesPerRead,
    unit: 'B',
    budget: READ_BUDGET_BYTES,
    detail: `${(reads.reads / reads.ticks).toFixed(1)} reads a tick; everything the ticks allocate`,
  });
  const follower = await readAllocation(lineFollowerBlocks(), window);
  rows.push({
    name: 'heap per hardware read: line follower (three reads, a drive)',
    value: follower.bytesPerRead,
    unit: 'B',
    budget: null,
    detail: `${(follower.reads / follower.ticks).toFixed(1)} reads a tick; the drive's call included`,
  });
  const echo = await readAllocation([setVar('x', ultrasonic())], { ...window, echoUs: 20 * 58 });
  rows.push({
    name: 'heap per hardware read: ultrasonic, echo at 20 cm',
    value: echo.bytesPerRead,
    unit: 'B',
    budget: null,
    detail: `${(echo.reads / echo.ticks).toFixed(1)} reads a tick, which share the tick's own allocation`,
  });
  rows.push({
    name: 'heap a tick allocates by itself (the program waits once a tick)',
    value: await tickAllocation(window),
    unit: 'B',
    budget: null,
    detail: 'the virtual clock\u2019s wait and the tick\u2019s wait for the program, the harness\u2019s own',
  });

  return { machine: machine(), smoke, rows };
}
