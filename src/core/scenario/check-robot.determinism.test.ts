import { beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../program/__fixtures__/uno-blocks';
import { rover, unoR3Board } from '../run/__fixtures__/robot-session';
import type { ProjectDocument } from '../circuit/document';
import { initPhysics } from '../world/rapier';
import { hashSnapshot } from '../world/snapshot';
import { checkCases, type CheckCase } from './__fixtures__/check-cases';
import { checkRobot, type CheckProgress } from './check-robot';
import { robotCheckResultProblems } from './check-result';
import type { Scenario } from './scenario';

// N18 R6.2, Review Focus 2 (robot plan §6): a hidden tab or a slow machine during a check gives the very same result. A check is driven
// headless, or in realtime by the page's frames at 1× and 4×, by frames of any length (slow ones drop ticks, the run does not catch up),
// and by a tab hidden for a second and back; every way, the same score, verdicts, goal results, times, program hash, and the same hash of
// each variant's last world. The cases are `checkCases` (__fixtures__/check-cases.ts), where R5.2b adds the pilot scenarios.

beforeAll(() => initPhysics(), 30_000);

type Drive = { name: string; mode: 'headless' | 'realtime'; speed?: number; frames?: () => () => number };

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

const drives: readonly Drive[] = [
  { name: 'headless', mode: 'headless' },
  { name: 'realtime 1×', mode: 'realtime', speed: 1 },
  { name: 'realtime 4×', mode: 'realtime', speed: 4 },
  { name: 'realtime 2×, frames of 4 to 50 ms', mode: 'realtime', speed: 2, frames: randomFrames(4, 50) },
  { name: 'realtime 4×, the tab hidden and back', mode: 'realtime', speed: 4, frames: hiddenTab },
];

/** Everything a check of `project` gives that must not depend on how it was driven. */
async function outcomeOf(project: ProjectDocument, scenario: Scenario, drive: Drive) {
  const ended: CheckProgress[] = [];
  const run = checkRobot(project, scenario, {
    mode: drive.mode,
    ...(drive.speed === undefined ? {} : { speed: drive.speed }),
    kit: rover,
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
    result: checked,
    variants: ended.map((progress) =>
      progress.kind === 'variant-ended' ? { goals: progress.goals, end: progress.end, error: progress.error, world: hashSnapshot(progress.snapshot.world!) } : null,
    ),
  };
}

describe('same score/passed/hash for 1×, 4× and headless', () => {
  it.each(checkCases.map((check) => [check.name, check] as const))('%s', async (_name, check: CheckCase) => {
    // One project (its block ids, which an error names) and one scenario for every way of driving the check.
    const project = check.project();
    const scenario = check.scenario();
    const [first, ...others] = await Promise.all(drives.map((drive) => outcomeOf(project, scenario, drive)));
    expect(first!.variants).toHaveLength(scenario.variants.count);
    for (const [index, other] of others.entries()) {
      expect({ drive: drives[index + 1]!.name, ...other }).toEqual({ drive: drives[index + 1]!.name, ...first });
    }
  }, 120_000);
});
