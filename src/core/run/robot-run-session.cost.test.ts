import { getHeapStatistics, GCProfiler } from 'node:v8';
import { beforeAll, describe, expect, it } from 'vitest';
import { driveMove, led, lineDark, servoSet, ultrasonic } from '../program/__fixtures__/uno-blocks';
import { add, cmp, getVar, ifElif, ifThen, num, setVar } from '../program/__fixtures__/ybc-blocks';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../scenario/scenario';
import { threadCpuMs } from '../world/__fixtures__/cpu-time';
import { toGoalFrame } from '../world/goal-frame';
import { initPhysics, PHYSICS_DT_S, PHYSICS_HZ } from '../world/rapier';
import { createScenarioWorld } from '../world/world';
import { everyGoalScorer, robotProject, rover, roverSession, worldOf } from './__fixtures__/robot-session';

// N18 R3.6, the budget of plan §5 with the program in the loop (R3.5 measured the world alone): physics ≤ 0.5 ms per tick on a
// mid-range machine, and a headless check of 3 variants × 60 s ≤ 10 s. CPU time of this thread (world/__fixtures__/cpu-time.ts), so
// other test workers do not count; the heap allocations per tick from V8's GC profile (what the heap grew by, plus what each GC freed).
//
// N18 P1: `pnpm verify` runs next to other workers and agents, and CPU time still grows under that load (0.64 ms against 0.5 for the
// line follower with three agents running), so these tests hold generous bounds that survive it, 2 ms a tick and 20 s a headless check:
// they catch a cost gone wrong by an order of magnitude. The plan's own budgets are `pnpm bench:robot`'s (scripts/bench-robot.mjs),
// measured on a quiet machine.

beforeAll(() => initPhysics(), 30_000);

const scenario = () => loadScenario(allGoalsScenario);

/** Forward until the ultrasonic reads under 25 cm, then turn; the servo and the LED follow (one read per loop(): ~2 loops a tick). */
const avoider = robotProject(
  [servoSet('servo1', num(30))],
  [
    setVar('x', ultrasonic()),
    ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
  ],
);
/** Three line sensors in every loop(): ~140 loops a tick. */
const lineFollower = robotProject(
  [],
  [ifElif([[lineDark('lineCenter'), [driveMove('forward', num(60))]], [lineDark('lineLeft'), [driveMove('spinLeft', num(50))]], [lineDark('lineRight'), [driveMove('spinRight', num(50))]]], [driveMove('forward', num(40))])],
);
/** loop() with no hardware at all: the most iterations a tick holds (~160), the interpreter's worst case (R2.3). */
const counter = robotProject([], [setVar('x', add(getVar('x'), num(1)))]);

/** The JS heap allocated while `work` runs, in bytes: what the heap grew by plus what every GC in between freed. */
async function heapAllocated(work: () => Promise<void>): Promise<number> {
  const profiler = new GCProfiler();
  const before = getHeapStatistics().used_heap_size;
  profiler.start();
  await work();
  const { statistics } = profiler.stop();
  const after = getHeapStatistics().used_heap_size;
  return after - before + statistics.reduce((freed, gc) => freed + gc.beforeGC.heapStatistics.usedHeapSize - gc.afterGC.heapStatistics.usedHeapSize, 0);
}

describe('the cost of a robot run', () => {
  it('a tick with the program in the loop (interpreter, virtual UNO, world, goal frame, every goal) stays within 2 ms for a robot program (the strict 0.5 ms: pnpm bench:robot)', async () => {
    const results: string[] = [];
    for (const [name, project] of [['avoider', avoider], ['line follower', lineFollower], ['counter loop', counter]] as const) {
      const session = roverSession(scenario(), { scorer: everyGoalScorer });
      await session.start(project, 1);
      await session.runUntil(300 / PHYSICS_HZ);
      const ticks = 3000;
      const started = threadCpuMs();
      await session.runUntil(3300 / PHYSICS_HZ);
      const mean = (threadCpuMs() - started) / ticks;
      const bytes = (await heapAllocated(() => session.runUntil(6300 / PHYSICS_HZ))) / ticks;
      expect(worldOf(session).t).toBe(6300 / PHYSICS_HZ);
      results.push(`${name}: ${mean.toFixed(4)} ms CPU and ${(bytes / 1024).toFixed(1)} KiB of JS heap per tick`);
      if (name !== 'counter loop') expect(mean).toBeLessThan(2);
      // A loop() without hardware fills its whole tick with ~160 iterations of the interpreter: about 1 ms, still far inside a frame.
      else expect(mean).toBeLessThan(8);
      session.stop();
    }
    console.info(`robot run tick (all-goals scenario, variant 1): ${results.join('; ')}`);
  }, 120_000);

  it('the goal frame from the world’s bodies costs less than building the snapshot for it', async () => {
    const world = await createScenarioWorld(scenario(), rover, 1);
    try {
      const run = { motors: { motorLeft: { duty: 180, dir: 1 as const, brake: false }, motorRight: { duty: 160, dir: 1 as const, brake: false } } };
      /** The CPU time of `frame()` once per tick (each step makes the world build its snapshot anew), µs per tick. */
      const measure = (frame: () => unknown) => {
        const ticks = 4000;
        let cpu = 0;
        for (let n = 0; n < ticks; n++) {
          world.applyActuators(run);
          world.step(PHYSICS_DT_S);
          world.frameExtras();
          const begin = threadCpuMs();
          frame();
          cpu += threadCpuMs() - begin;
        }
        return (cpu / ticks) * 1000;
      };
      const leds = { led1: false };
      measure(() => world.goalFrame({ leds, buzzerHz: null }));
      const fromSnapshot = measure(() => toGoalFrame({ ...world.snapshot(), leds }, { ...world.frameExtras(), buzzerHz: null }));
      const fromBodies = measure(() => world.goalFrame({ leds, buzzerHz: null }));
      console.info(`goal frame per tick: ${fromBodies.toFixed(2)} µs from the bodies, ${fromSnapshot.toFixed(2)} µs through the tick's snapshot`);
      expect(fromBodies).toBeLessThan(50);
    } finally {
      world.dispose();
    }
    // 12 000 world steps: 1.4 s alone, 6.4 s next to other workers and agents, past Vitest's default of 5 s (N18 P1).
  }, 120_000);

  it('a headless check of 3 variants × 60 s with the program in the loop and every goal fed each tick takes under 20 s (the strict 10 s: pnpm bench:robot)', async () => {
    const started = threadCpuMs();
    for (let variant = 0; variant < 3; variant++) {
      const session = roverSession(scenario(), { scorer: everyGoalScorer });
      await session.start(avoider, variant, { check: true });
      await session.runUntil(60);
      expect(worldOf(session)).toMatchObject({ t: 60, status: 'running' });
      expect(worldOf(session).score.goals.map((goal) => goal.id)).toEqual(scenario().goals.map((goal) => goal.id));
      session.stop();
    }
    const ms = threadCpuMs() - started;
    console.info(`headless 3 variants × 60 s with the avoider program: ${ms.toFixed(0)} ms CPU (${(ms / (3 * 60 * PHYSICS_HZ)).toFixed(4)} ms per tick)`);
    expect(ms).toBeLessThan(20_000);
  }, 120_000);
});
