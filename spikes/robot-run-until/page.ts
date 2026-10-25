import { driveMove, led, servoSet, ultrasonic } from '../../src/core/program/__fixtures__/uno-blocks';
import { cmp, getVar, ifThen, num, setVar } from '../../src/core/program/__fixtures__/ybc-blocks';
import { everyGoalScorer, robotProject, roverSession } from '../../src/core/run/__fixtures__/robot-session';
import { createVirtualScheduler } from '../../src/core/run/virtual-clock';
import allGoals from '../../src/core/scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../../src/core/scenario/scenario';
import { hashSnapshot } from '../../src/core/world/snapshot';

// N18 R3.6 spike (R2.3's M6): what RobotRunSession.runUntil's yields cost in a browser. Each yield is VirtualScheduler.yieldNow, a turn
// of the event loop through a fresh MessageChannel, taken once EXEC_SLICE_MS (8 ms) of wall time has passed since the last one.
//   1. The cost of one turn: 20 000 yieldNow() in a row (and, for scale, 200 setTimeout(0) in a row, which browsers clamp to 4 ms).
//   2. A headless check run: runUntil(60) of the obstacle avoider in variant 1 of the all-goals fixture with every goal, as the session
//      runs it (yields every 8 ms), against the same run with a wall clock that never moves (no yield at all: the page is blocked for
//      the whole run). The difference is what the yields cost. A setTimeout(0) heartbeat during the run gives the longest the page
//      was blocked, and the snapshot hashes of the two runs must be equal.

const avoider = robotProject(
  [servoSet('servo1', num(30))],
  [
    setVar('x', ultrasonic()),
    ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
  ],
);

async function turnCostUs(turns: number): Promise<number> {
  const scheduler = createVirtualScheduler();
  const begin = performance.now();
  for (let turn = 0; turn < turns; turn++) await scheduler.yieldNow();
  return ((performance.now() - begin) / turns) * 1000;
}

async function timeoutCostUs(turns: number): Promise<number> {
  const begin = performance.now();
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  return ((performance.now() - begin) / turns) * 1000;
}

async function check(yields: boolean) {
  const session = roverSession(loadScenario(allGoals), { scorer: everyGoalScorer, ...(yields ? {} : { wallNow: () => 0 }) });
  await session.start(avoider, 1, { check: true });
  let beats = 0;
  let last = performance.now();
  let longestGapMs = 0;
  let beating = true;
  const beat = () => {
    const now = performance.now();
    longestGapMs = Math.max(longestGapMs, now - last);
    last = now;
    beats += 1;
    if (beating) setTimeout(beat, 0);
  };
  setTimeout(beat, 0);
  const begin = performance.now();
  await session.runUntil(60);
  const wallMs = performance.now() - begin;
  beating = false;
  const world = session.getSnapshot().world!;
  const result = { wallMs, beats, longestGapMs, t: world.t, hash: hashSnapshot(world) };
  session.stop();
  return result;
}

declare global {
  interface Window {
    __robotRunUntil?: unknown;
  }
}

const out = document.getElementById('out')!;
(async () => {
  // Warm up the JIT and load physics.
  await check(true);
  const fresh = await turnCostUs(20_000);
  const timeout = await timeoutCostUs(200);
  const withYields = [await check(true), await check(true), await check(true)];
  const withoutYields = [await check(false), await check(false), await check(false)];
  return { userAgent: navigator.userAgent, freshMessageChannelTurnUs: fresh, setTimeout0TurnUs: timeout, withYields, withoutYields };
})().then(
  (result) => {
    window.__robotRunUntil = result;
    out.textContent = JSON.stringify(result, null, 2);
  },
  (error: unknown) => {
    window.__robotRunUntil = { error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error) };
    out.textContent = JSON.stringify(window.__robotRunUntil);
  },
);
