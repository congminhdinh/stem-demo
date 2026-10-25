import { beforeAll, describe, expect, it } from 'vitest';
import { driveMove, led, registry, servoSet, ultrasonic } from '../program/__fixtures__/uno-blocks';
import { cmp, getVar, ifThen, num, setVar } from '../program/__fixtures__/ybc-blocks';
import { robotProject, rover, unoR3Board } from '../run/__fixtures__/robot-session';
import { threadCpuMs } from '../world/__fixtures__/cpu-time';
import { initPhysics } from '../world/rapier';
import allGoalsScenario from './__fixtures__/all-goals.scenario.json';
import { checkRobot } from './check-robot';
import { robotCheckResultProblems } from './check-result';
import { loadScenario } from './scenario';

// N18 R6.2, the budget of plan §5: a headless check of 3 variants × 60 s takes at most 10 s on a mid-range machine. The whole check, as
// R6.3 calls it: the compile and the program's hash, three worlds, the interpreter, every goal of the scenario fed each tick, the scorer,
// a snapshot each simulated second. CPU time of this thread (world/__fixtures__/cpu-time.ts), so other test workers do not count; the wall
// time is logged too.
//
// N18 P1: `pnpm verify` runs next to other workers and agents, and CPU time still grows under that load, so this test holds a generous
// bound that survives it (20 s); the plan's own 10 s, and the check of each pilot scenario's reference solution, are `pnpm bench:robot`'s
// (scripts/bench-robot.mjs), measured on a quiet machine.

beforeAll(() => initPhysics(), 30_000);

/** Forward until the ultrasonic reads under 25 cm, then turn left; the servo and the LED follow. */
const avoider = () =>
  robotProject(
    [servoSet('servo1', num(30))],
    [
      setVar('x', ultrasonic()),
      ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
    ],
  );

describe('the cost of a robot check', () => {
  it('a headless check of 3 variants × 60 s, every goal of the scenario scored each tick, takes under 20 s (the strict 10 s: pnpm bench:robot)', async () => {
    const scenario = loadScenario(allGoalsScenario);
    expect([scenario.variants.count, scenario.timeLimitS, scenario.goals.length]).toEqual([3, 60, 9]);
    const wallStarted = performance.now();
    const cpuStarted = threadCpuMs();
    const result = await checkRobot(avoider(), scenario, { mode: 'headless', kit: rover, board: unoR3Board, registry }).result;
    const cpuMs = threadCpuMs() - cpuStarted;
    const wallMs = performance.now() - wallStarted;
    expect(robotCheckResultProblems(result!)).toEqual([]);
    expect(result!.variants.map((variant) => variant.simTimeMs)).toEqual([60000, 60000, 60000]);
    console.info(`R62-CHECK headless 3 variants × 60 s, avoider, all-goals scenario: ${cpuMs.toFixed(0)} ms CPU, ${wallMs.toFixed(0)} ms wall (${(cpuMs / (3 * 7200)).toFixed(4)} ms CPU per tick); score ${result!.score}`);
    expect(cpuMs).toBeLessThan(20_000);
  }, 120_000);
});
