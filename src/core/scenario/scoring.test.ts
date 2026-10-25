import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/all-goals.scenario.json';
import { robotCheckResultProblems, ROBOT_ENGINE } from './check-result';
import { frameAt, type FrameInit } from './goals/__fixtures__/frames';
import { createGoal, goalReasons, type GoalResult } from './goals';
import { loadScenario, type Scenario, type ScenarioJson } from './scenario';
import { checkResultOf, checkScore, createScenarioScorer, RUN_ENDED_CONTACT_REASON, timeBonus, variantScore, type RunScore, type ScenarioScorer } from './scoring';

// N18 R6.2 (robot plan §4.6, controller rulings): the score of a run and of a check. A variant scores the points of the goals it passed,
// plus the time bonus when it passed every goal, clamped to 0..maxScore; a check scores the lowest of its variants and passes when every
// goal passed in every variant. finish-within and the time bonus read the start of the final streak in which the other goals all passed.

/** The fixture arena (all-goals.scenario.json) with these goals and time bonus. */
function scenarioWith(goals: ScenarioJson['goals'], timeBonusMax?: number, change: Partial<ScenarioJson> = {}): Scenario {
  const json = structuredClone(fixture) as unknown as ScenarioJson;
  return loadScenario({ ...json, goals, scoring: timeBonusMax === undefined ? {} : { timeBonusMax }, ...change });
}

const label = (en: string) => ({ vi: `${en} (vi)`, en });
const dock = { id: 'reach-dock', kind: 'reach-zone', label: label('Reach the dock'), points: 30, zone: 'dock' } as const;
const crate = { id: 'push-crate', kind: 'object-in-zone', label: label('Push the crate'), points: 40, object: 'crate', zone: 'gate' } as const;
const inTime = (seconds: number) => ({ id: 'in-time', kind: 'finish-within', label: label('In time'), points: 20, seconds }) as const;
const park = { id: 'park', kind: 'stop-in-zone', label: label('Park'), points: 25, zone: 'dock', maxSpeedCmS: 2, holdS: 1 } as const;
const gate = { id: 'gate-open', kind: 'servo-angle', label: label('Open the gate'), points: 25, role: 'servo1', minDeg: 80, maxDeg: 100, whenInZone: 'gate' } as const;
const noBump = { id: 'no-bump', kind: 'avoid-contact', label: label('No bump'), points: 25, tag: 'obstacle' } as const;
const reachGate = { id: 'reach-gate', kind: 'reach-zone', label: label('Reach the gate'), points: 25, zone: 'gate' } as const;

const IN_DOCK = { xCm: 30, yCm: 120 };
const crateAt = (where: 'in' | 'out') => ({ crate: { xCm: where === 'in' ? 100 : 130, yCm: 80, yawDeg: 0 } });

/** Feeds `scorer` frames every `dtS` from t = 0 (the first with a tick of 0 s, as the session does) until `untilS`; `at(tS)` says each. */
function run(scorer: ScenarioScorer, untilS: number, at: (tS: number) => FrameInit, dtS = 0.25): RunScore {
  const ticks = Math.round(untilS / dtS);
  for (let k = 0; k <= ticks; k++) {
    const tS = k * dtS;
    scorer.update(frameAt({ tS, ...at(tS) }), k === 0 ? 0 : dtS);
  }
  return scorer.result();
}

const scorerOf = (scenario: Scenario, program: unknown = {}) => createScenarioScorer({ scenario, arena: scenario.arena, program });

describe('timeBonus', () => {
  it.each([
    [10, 0, 60, 10],
    [10, 6, 60, 9],
    [10, 30, 60, 5],
    [10, 12.3, 60, 7], // 10 × 47.7 / 60 = 7.95
    [10, 54, 60, 1], // 1 exactly, though 10 × (1 − 54/60) is 0.9999999999999998 in doubles
    [10, 54.01, 60, 0],
    [10, 60, 60, 0],
    [10, 75, 60, 0],
    [0, 0, 60, 0],
    [7, 1 / 120, 0.5, 6], // 7 × (0.5 − 1/120) / 0.5 = 6.8833…
  ])('timeBonusMax %d finished at %d s of a %d s limit is %d whole points', (max, finishedAtS, limitS, points) => {
    expect(timeBonus(max, finishedAtS, limitS)).toBe(points);
  });
});

describe('variantScore', () => {
  const scenario = scenarioWith([dock, crate, inTime(45)], 10);
  const passed = (id: string, points: number): GoalResult => ({ id, passed: true, points, progress: 1 });
  const failed = (id: string): GoalResult => ({ id, passed: false, points: 0, progress: 0, reasonKey: goalReasons.zoneNotReached });

  it('adds the points of the goals that passed; the time bonus only when every goal passed', () => {
    expect(variantScore(scenario, [passed('reach-dock', 30), failed('push-crate'), passed('in-time', 20)], null)).toBe(50);
    expect(variantScore(scenario, [passed('reach-dock', 30), failed('push-crate'), passed('in-time', 20)], 6)).toBe(50);
    expect(variantScore(scenario, [passed('reach-dock', 30), passed('push-crate', 40), passed('in-time', 20)], 6)).toBe(99);
    expect(variantScore(scenario, [failed('reach-dock'), failed('push-crate'), failed('in-time')], null)).toBe(0);
  });

  it('is clamped to 0..maxScore', () => {
    const generous = { ...scenario, goals: scenario.goals.map((goal) => ({ ...goal, points: 60 })) };
    const results = generous.goals.map((goal) => passed(goal.id, 60));
    expect(variantScore(generous, results, 0)).toBe(100);
  });

  it('is 0 for the sandbox, which has no score', () => {
    expect(variantScore({ ...scenario, key: 'rb-sandbox', goals: [], scoring: {} }, [], 0)).toBe(0);
  });
});

describe('checkScore', () => {
  it('is the lowest of the variants’ scores: robustness first, as passed is every variant', () => {
    expect(checkScore([80, 22, 21.75])).toBe(21.75);
    expect(checkScore([100])).toBe(100);
    expect(checkScore([96, 100, 99])).toBe(96);
    expect(() => checkScore([])).toThrow(RangeError);
  });
});

describe('the scorer of a run', () => {
  it('finish-within reads the start of the FINAL streak of the others: a goal that passes and later fails resets it', () => {
    // The robot waits in the dock from t = 0; the crate is pushed into the gate at 5 s, out again at 8 s, and in for good at 20 s.
    const crateMoves = (tS: number): FrameInit => ({ ...IN_DOCK, objects: crateAt((tS >= 5 && tS < 8) || tS >= 20 ? 'in' : 'out') });
    const lenient = run(scorerOf(scenarioWith([dock, crate, inTime(25)], 10)), 30, crateMoves);
    expect(lenient.goals.find((goal) => goal.id === 'in-time')).toEqual({ id: 'in-time', passed: true, points: 20, progress: 1, atS: 20 });
    expect(lenient).toMatchObject({ passed: true, finishedAtS: 20, timeBonus: 6, points: 96, maxScore: 100 }); // 10 × 40 / 60 = 6.67
    // The first moment they were all passed (5 s) is not the one: by 15 s the crate had been pushed out again.
    const strict = run(scorerOf(scenarioWith([dock, crate, inTime(15)], 10)), 30, crateMoves);
    expect(strict.goals.find((goal) => goal.id === 'in-time')).toEqual({ id: 'in-time', passed: false, points: 0, progress: 0, reasonKey: goalReasons.notFinishedInTime });
    expect(strict).toMatchObject({ passed: false, finishedAtS: null, timeBonus: 0, points: 70 });
  });

  it('a run that ends while the others are not all passed has no finish time, and finish-within fails', () => {
    const result = run(scorerOf(scenarioWith([dock, crate, inTime(25)], 10)), 30, (tS) => ({ ...IN_DOCK, objects: crateAt(tS >= 5 && tS < 29 ? 'in' : 'out') }));
    expect(result).toMatchObject({ passed: false, finishedAtS: null, timeBonus: 0, points: 30 });
    expect(result.goals.map((goal) => [goal.id, goal.passed])).toEqual([['reach-dock', true], ['push-crate', false], ['in-time', false]]);
  });

  it('a guard goal passes once the robot has driven far enough, and that is when the streak starts', () => {
    // The robot drives through the gate at 20 cm/s. When the guard goal passes is the goal's own rule (goals/travel.ts): the scorer only
    // reads its verdict, so the test asks the goal itself.
    const scenario = scenarioWith([noBump, { ...inTime(30), points: 25 }, reachGate], 25);
    const drive = (tS: number): FrameInit => ({ xCm: 82 + 20 * tS, yCm: 80, speedCmS: tS > 0 ? 20 : 0 });
    const guard = createGoal(noBump, { arena: scenario.arena, scenario });
    let guardPassedAtS: number | null = null;
    for (let k = 0; k <= 12; k++) {
      guard.update(frameAt({ tS: k * 0.25, ...drive(k * 0.25) }), k === 0 ? 0 : 0.25);
      if (guardPassedAtS === null && guard.result().passed) guardPassedAtS = k * 0.25;
    }
    expect(guardPassedAtS).toBeGreaterThan(0.5);
    expect(guardPassedAtS).toBeLessThan(2);
    const result = run(scorerOf(scenario), 3, drive);
    expect(result).toMatchObject({ passed: true, finishedAtS: guardPassedAtS, timeBonus: timeBonus(25, guardPassedAtS!, 60) });
    expect(result.points).toBe(75 + timeBonus(25, guardPassedAtS!, 60));
  });

  it('only finish-within goals: the others are none, so they all passed from t = 0', () => {
    const result = run(scorerOf(scenarioWith([{ ...inTime(10), points: 90 }], 10)), 2, () => ({}));
    expect(result).toMatchObject({ passed: true, finishedAtS: 0, timeBonus: 10, points: 100 });
  });

  it('scores the run so far as if it ended now: the snapshot’s score while it runs', () => {
    const scorer = scorerOf(scenarioWith([dock, crate, inTime(25)], 10));
    scorer.update(frameAt({ tS: 0, ...IN_DOCK, objects: crateAt('out') }), 0);
    expect(scorer.score()).toEqual({
      points: 30,
      maxScore: 100,
      goals: [
        { id: 'reach-dock', passed: true, points: 30, progress: 1, atS: 0 },
        { id: 'push-crate', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectNotInZone },
        { id: 'in-time', passed: false, points: 0, progress: 0, reasonKey: goalReasons.notFinishedInTime },
      ],
    });
    scorer.update(frameAt({ tS: 0.25, ...IN_DOCK, objects: crateAt('in') }), 0.25);
    expect(scorer.score().points).toBe(99); // 30 + 40 + 20 + floor(10 × 59.75 / 60)
    // A copy: changing it changes nothing.
    (scorer.score().goals as GoalResult[]).length = 0;
    expect(scorer.score().goals).toHaveLength(3);
  });

  // What each kind decides at the end is the goal's own (R6.1; R5.2a judges stop-in-zone at the end): these tests take each goal's
  // verdict from the goal itself and hold only what the scorer adds.
  describe('at the end of the run', () => {
    const scenario = scenarioWith([park, gate, { ...dock, points: 25 }, { ...reachGate, points: 25 }]);
    /** In the dock, moving (so not parked), the servo at 0°. */
    const busy = (): FrameInit => ({ ...IN_DOCK, speedCmS: 10, servoDeg: { servo1: 0 } });
    /** In the dock, still, the servo at 0°. */
    const parked = (): FrameInit => ({ ...IN_DOCK, speedCmS: 0, servoDeg: { servo1: 0 } });

    it('a contact end: a hold or a stop not met fails with run-ended-contact at the end’s time; the other goals are as they were', () => {
      const scorer = scorerOf(scenario);
      const before = run(scorer, 3, busy).goals;
      expect(before.map((goal) => goal.passed)).toEqual([false, false, true, false]);
      scorer.end({ reason: 'contact', atS: 3, tag: 'obstacle' });
      const after = scorer.result().goals;
      expect(after[0]).toEqual({ ...before[0], reasonKey: RUN_ENDED_CONTACT_REASON, atS: 3 });
      expect(after[1]).toEqual({ ...before[1], reasonKey: RUN_ENDED_CONTACT_REASON, atS: 3 });
      expect(after.slice(2)).toEqual(before.slice(2));
      expect(scorer.score().goals.map((goal) => goal.reasonKey)).toEqual([RUN_ENDED_CONTACT_REASON, RUN_ENDED_CONTACT_REASON, undefined, goalReasons.zoneNotReached]);
      expect(RUN_ENDED_CONTACT_REASON).toBe('robot.goal.reason.run-ended-contact');
    });

    it('a contact end keeps a stop that passed, and a hold that failed for good by leaving the arena', () => {
      const still = scorerOf(scenario);
      run(still, 3, parked);
      still.end({ reason: 'contact', atS: 3, tag: 'wall' });
      expect(still.result().goals[0]).toMatchObject({ id: 'park', passed: true, points: 25 });
      const fallen = scorerOf(scenario);
      run(fallen, 2, (tS) => (tS < 1.5 ? parked() : { xCm: 100, yCm: 80, outOfArena: true }));
      fallen.end({ reason: 'contact', atS: 2, tag: 'wall' });
      expect(fallen.result().goals[1]).toEqual({ id: 'gate-open', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 1.5 });
    });

    it('a time-limit end leaves every goal to its own end rules', () => {
      const scorer = scorerOf(scenario);
      const before = run(scorer, 3, busy);
      scorer.end({ reason: 'time-limit', atS: 3 });
      expect(scorer.result()).toEqual(before);
    });
  });

  it('gives the same results for the same frames', () => {
    const scenario = loadScenario(fixture);
    const frames = (tS: number): FrameInit => ({ xCm: 30 + tS * 2, yCm: 40, speedCmS: 20, lineSpotsCm: [[30 + tS * 2, 40]], objects: crateAt(tS > 4 ? 'in' : 'out') });
    const once = JSON.stringify(run(scorerOf(scenario), 10, frames, 1 / 120));
    expect(JSON.stringify(run(scorerOf(scenario), 10, frames, 1 / 120))).toBe(once);
  });

  it('the sandbox has no score', () => {
    const sandbox = { ...loadScenario(fixture), key: 'rb-sandbox' as const, goals: [], scoring: {} };
    const scorer = scorerOf(sandbox);
    scorer.update(frameAt(), 0);
    expect(scorer.score()).toEqual({ points: 0, maxScore: null, goals: [] });
  });
});

describe('checkResultOf', () => {
  const scenario = scenarioWith([dock, crate, inTime(45)], 10, { version: 3 });
  const goal = (id: string, ok: boolean, points: number): GoalResult =>
    ok ? { id, passed: true, points, progress: 1 } : { id, passed: false, points: 0, progress: 0, reasonKey: goalReasons.zoneNotReached };
  const variant = (seed: number, simTimeMs: number, oks: [boolean, boolean, boolean], points: number) => ({
    seed,
    simTimeMs,
    score: {
      goals: [goal('reach-dock', oks[0], 30), goal('push-crate', oks[1], 40), goal('in-time', oks[2], 20)],
      passed: oks.every(Boolean),
      finishedAtS: oks.every(Boolean) ? 12 : null,
      timeBonus: oks.every(Boolean) ? 8 : 0,
      points,
      maxScore: 100,
    },
  });
  const hash = 'ab'.repeat(32);

  it('passes when every goal passed in every variant; a goal passed when it passed in every variant; the score is the lowest', () => {
    const result = checkResultOf(scenario, [variant(2026, 60000, [true, true, true], 98), variant(2027, 41250, [true, false, true], 50), variant(2028, 60000, [true, true, false], 70)], hash, 'vi');
    expect(result).toEqual({
      passed: false,
      goals: [
        { id: 'reach-dock', label: 'Reach the dock (vi)', passed: true },
        { id: 'push-crate', label: 'Push the crate (vi)', passed: false },
        { id: 'in-time', label: 'In time (vi)', passed: false },
      ],
      score: 50,
      maxScore: 100,
      simTimeMs: 60000,
      variants: [
        { seed: 2026, passed: true, score: 98, simTimeMs: 60000 },
        { seed: 2027, passed: false, score: 50, simTimeMs: 41250 },
        { seed: 2028, passed: false, score: 70, simTimeMs: 60000 },
      ],
      engine: ROBOT_ENGINE,
      scenarioVersion: 3,
      programHash: hash,
    });
    expect(robotCheckResultProblems(result)).toEqual([]);
  });

  it('passes a check whose every variant passed, in the language asked for; the check’s time is its longest variant’s', () => {
    const result = checkResultOf(scenario, [variant(1, 12000, [true, true, true], 98), variant(2, 13500, [true, true, true], 97)], hash, 'en');
    expect(result).toMatchObject({ passed: true, score: 97, simTimeMs: 13500 });
    expect(result.goals.map((g) => g.label)).toEqual(['Reach the dock', 'Push the crate', 'In time']);
    expect(robotCheckResultProblems(result)).toEqual([]);
  });

  it('refuses what is not a check: no variant, a variant whose goals are not the scenario’s, the sandbox', () => {
    expect(() => checkResultOf(scenario, [], hash, 'vi')).toThrow(RangeError);
    const wrong = variant(1, 1, [true, true, true], 98);
    expect(() => checkResultOf(scenario, [{ ...wrong, score: { ...wrong.score, goals: wrong.score.goals.slice(1) } }], hash, 'vi')).toThrow(RangeError);
    expect(() => checkResultOf({ ...scenario, key: 'rb-sandbox', goals: [], scoring: {} }, [variant(1, 1, [true, true, true], 98)], hash, 'vi')).toThrow(RangeError);
  });
});
