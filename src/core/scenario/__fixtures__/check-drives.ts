import { expect } from 'vitest';
import type { ProjectDocument } from '../../circuit/document';
import { productionKits, type Kit } from '../../hardware';
import { registry } from '../../program/__fixtures__/uno-blocks';
import { unoR3Board } from '../../run/__fixtures__/robot-session';
import { hashSnapshot } from '../../world/snapshot';
import { checkRobot, type CheckProgress } from '../check-robot';
import { robotCheckResultProblems, type RobotCheckResult } from '../check-result';
import { scenarioKitRef, type Scenario } from '../scenario';
import type { CheckCase } from './check-cases';

// TEST-ONLY (N18 R6.2): the ways a check is driven, and what a check gives that must not depend on the way (Review Focus 2: a hidden tab
// or a slow machine during a check gives the very same result). check-robot.determinism.test.ts and check-robot.pilots.test.ts run the
// cases of `checkCases` through them.

export type Drive = { readonly name: string; readonly mode: 'headless' | 'realtime'; readonly speed?: number; readonly frames?: () => () => number };

/** A seeded stream of frame lengths, ms (a linear congruential generator: the same frames every run). */
const randomFrames = (fromMs: number, toMs: number) => () => {
  let seed = 7;
  return () => fromMs + ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * (toMs - fromMs);
};
/** 60 Hz frames, with the tab hidden for a second (no frame) every 100 frames: the frame after it is 1 s long. */
const hiddenTab = () => {
  let frame = 0;
  return () => (++frame % 100 === 0 ? 1000 : 1000 / 60);
};

const headless: Drive = { name: 'headless', mode: 'headless' };
const realtime1x: Drive = { name: 'realtime 1×', mode: 'realtime', speed: 1 };
const realtime4x: Drive = { name: 'realtime 4×', mode: 'realtime', speed: 4 };

/** The drives of a case (`CheckCase.drives`): headless, 1× and 4×; every way adds frames that drop ticks and a tab hidden and back. */
export const drivesOf: Readonly<Record<CheckCase['drives'], readonly Drive[]>> = {
  speeds: [headless, realtime1x, realtime4x],
  every: [
    headless,
    realtime1x,
    realtime4x,
    { name: 'realtime 2×, frames of 4 to 50 ms', mode: 'realtime', speed: 2, frames: randomFrames(4, 50) },
    { name: 'realtime 4×, the tab hidden and back', mode: 'realtime', speed: 4, frames: hiddenTab },
  ],
};

/** The kit a scenario runs on, from the catalog (the rover for every N18 scenario; N19 D4: the gripper car for lessons 8-11). */
export const kitOfScenario = (scenario: Scenario): Kit => productionKits.get(scenarioKitRef(scenario)!)!;

/** A check of `project` driven `drive`'s way, and everything it gives that must not depend on the way. The result passes the builder. */
export async function outcomeOf(project: ProjectDocument, scenario: Scenario, drive: Drive) {
  const ended: CheckProgress[] = [];
  const run = checkRobot(project, scenario, {
    mode: drive.mode,
    ...(drive.speed === undefined ? {} : { speed: drive.speed }),
    kit: kitOfScenario(scenario),
    board: unoR3Board,
    registry,
    onProgress: (progress) => progress.kind === 'variant-ended' && ended.push(progress),
  });
  let settled = false;
  const result = run.result.finally(() => (settled = true));
  if (drive.mode === 'realtime') {
    const next = drive.frames?.() ?? (() => 1000 / 60);
    while (!settled) await run.frame(next());
  }
  const checked = await result;
  expect(checked).not.toBeNull();
  expect(robotCheckResultProblems(checked!)).toEqual([]);
  return {
    result: checked as RobotCheckResult,
    variants: ended.map((progress) =>
      progress.kind === 'variant-ended' ? { goals: progress.goals, end: progress.end, error: progress.error, world: hashSnapshot(progress.snapshot.world!) } : null,
    ),
  };
}

/**
 * Checks `check` every way its `drives` says, all at once, and expects the same outcome from each: score, verdicts, variants, programHash,
 * goal results, ends and the hash of each variant's last world. One project (its block ids, which an error names) and one scenario for
 * every way. Gives the headless outcome.
 */
export async function sameEveryWay(check: CheckCase) {
  const project = check.project();
  const scenario = check.scenario();
  const drives = drivesOf[check.drives];
  const [first, ...others] = await Promise.all(drives.map((drive) => outcomeOf(project, scenario, drive)));
  expect(first!.variants).toHaveLength(scenario.variants.count);
  for (const [index, other] of others.entries()) {
    expect({ drive: drives[index + 1]!.name, ...other }).toEqual({ drive: drives[index + 1]!.name, ...first });
  }
  return first!;
}

/** What `check.expected` says of a result: it passed, or it failed with at most its score. */
export function expectAsCase(check: Pick<CheckCase, 'name' | 'expected'>, result: RobotCheckResult): void {
  if (check.expected === undefined) return;
  expect({ case: check.name, passed: result.passed }).toEqual({ case: check.name, passed: check.expected.passed });
  if (check.expected.maxScore !== undefined) {
    expect(result.score, `${check.name}: its score`).toBeLessThanOrEqual(check.expected.maxScore);
  }
}
