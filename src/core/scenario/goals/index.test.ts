import { describe, expect, it } from 'vitest';
import { goalKinds, type RobotGoalSpec } from '../scenario-schema';
import { base, ctx, inside, nowhere, scenario } from './__fixtures__/context';
import { feed, frameAt, type FrameInit } from './__fixtures__/frames';
import { createGoal, type Goal, type GoalResult } from './index';
import { goalReasonKeys, goalReasons } from './reasons';

const specOf = (id: string): RobotGoalSpec => scenario.goals.find((goal) => goal.id === id)!;
const program = { blocks: { languageVersion: 0, blocks: [{ type: 'stem_forever', id: 'f', inputs: { DO: { block: { type: 'controls_repeat_ext', id: 'r' } } } }] } };
const full = { ...ctx, program, othersPassedAtS: () => null };

describe('createGoal', () => {
  it('makes a goal for each kind of the schema, with the id of its spec in every result', () => {
    expect(scenario.goals.map((goal) => goal.kind)).toEqual([...goalKinds]); // the fixture has one of each
    for (const spec of scenario.goals) {
      const goal = createGoal(spec, full);
      expect(goal.result().id).toBe(spec.id);
    }
  });

  it('starts every goal with the points it has not earned, a progress in 0..1, and a reason unless it has already passed', () => {
    for (const spec of scenario.goals) {
      const result = createGoal(spec, full).result();
      expect(result.points).toBe(result.passed ? spec.points : 0);
      expect(result.progress).toBeGreaterThanOrEqual(0);
      expect(result.progress).toBeLessThanOrEqual(1);
      expect(result.reasonKey === undefined).toBe(result.passed);
      if (result.reasonKey !== undefined) expect(goalReasonKeys).toContain(result.reasonKey);
    }
  });

  it('refuses a kind it does not know', () => {
    expect(() => createGoal({ ...base, kind: 'teleport' } as unknown as RobotGoalSpec, ctx)).toThrow('unknown goal kind "teleport"');
  });

  describe('when the robot leaves the arena', () => {
    const run = (id: string): GoalResult => {
      const goal = createGoal(specOf(id), full);
      // driving at 60 cm/s: the first 0.5 s tick is 30 cm, more than the guard goals ask
      feed(goal, [{ ...nowhere, speedCmS: 60 }, { ...nowhere, speedCmS: 60, outOfArena: true }], { dtS: 0.5 });
      return goal.result();
    };

    it.each(['reach-dock', 'route', 'on-line', 'push-crate', 'park', 'gate-open'])('fails %s, which depends on where things are, with the reason and the time', (id) => {
      expect(run(id)).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.outOfArena, atS: 0.5 });
    });

    it.each(['no-bump', 'loop'])('leaves %s, which does not, as it was', (id) => {
      expect(run(id)).toMatchObject({ passed: true, points: 10 });
    });

    it('lets the scorer decide finish-within, which has no place of its own', () => {
      const goal = createGoal(specOf('in-time'), { ...full, othersPassedAtS: () => 20 });
      feed(goal, [{ ...nowhere, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: true, atS: 20 });
    });
  });
});

// A run of the fixture scenario, scored the way R6.2 wires the goals: every goal is updated on each frame, and finish-within asks
// the scorer for the time at which the others had all passed.

type Leg = { to: readonly [number, number]; ticks: number; speedCmS: number; tape: boolean; servoDeg?: number; crate?: readonly [number, number]; contacts?: FrameInit['contacts'] };

function course(legs: readonly Leg[], from: readonly [number, number]): FrameInit[] {
  const frames: FrameInit[] = [];
  let [x, y] = from;
  let servoDeg = 0;
  let crate: readonly [number, number] = [130, 80];
  for (const leg of legs) {
    const [x0, y0] = [x, y];
    servoDeg = leg.servoDeg ?? servoDeg;
    crate = leg.crate ?? crate;
    for (let k = 1; k <= leg.ticks; k++) {
      x = x0 + ((leg.to[0] - x0) * k) / leg.ticks;
      y = y0 + ((leg.to[1] - y0) * k) / leg.ticks;
      frames.push({
        xCm: x,
        yCm: y,
        speedCmS: leg.speedCmS,
        lineSpotsCm: leg.tape ? [[x, y]] : [],
        servoDeg: { servo1: servoDeg },
        objects: { crate: { xCm: crate[0], yCm: crate[1], yawDeg: 0 } },
        contacts: leg.contacts ?? [],
      });
    }
  }
  return frames;
}

const dtS = 0.25;
const route = (waitS = 0): FrameInit[] =>
  course(
    [
      { to: [30, 40], ticks: waitS / dtS, speedCmS: 0, tape: true }, // waits at the start, on the tape
      { to: [170, 40], ticks: 28, speedCmS: 20, tape: true }, // along the tape to cp-a
      { to: [170, 120], ticks: 16, speedCmS: 20, tape: true }, // up the tape to cp-b
      { to: [100, 80], ticks: 16, speedCmS: 20, tape: false, crate: [110, 70], contacts: [{ otherId: 'crate', tags: ['object', 'pushable'] }] }, // across to the gate, pushing the crate in
      { to: [100, 80], ticks: 12, speedCmS: 0, tape: false, servoDeg: 90, contacts: [] }, // opens the gate for 3 s
      { to: [30, 120], ticks: 16, speedCmS: 20, tape: false }, // to the dock
      { to: [30, 120], ticks: 6, speedCmS: 0, tape: false }, // and parks
    ],
    [30, 40],
  );

/** The fixture's goals, with the line goal asking for what this run does (it leaves the tape for the gate and the dock). */
function scoreRun(frames: readonly FrameInit[]): Map<string, GoalResult> {
  const goals = new Map<string, Goal>();
  let allPassedAtS: number | null = null;
  const wired = { ...ctx, program, othersPassedAtS: () => allPassedAtS };
  for (const spec of scenario.goals) {
    goals.set(spec.id, createGoal(spec.kind === 'stay-on-line' ? { ...spec, minRatio: 0.5 } : spec, wired));
  }
  frames.forEach((init, k) => {
    const frame = frameAt({ tS: k * dtS, ...init });
    for (const [id, goal] of goals) if (id !== 'in-time') goal.update(frame, dtS);
    const othersPassed = [...goals].every(([id, goal]) => id === 'in-time' || goal.result().passed);
    if (othersPassed && allPassedAtS === null) allPassedAtS = frame.tS;
    goals.get('in-time')!.update(frame, dtS);
  });
  return new Map([...goals].map(([id, goal]) => [id, goal.result()]));
}

describe('a run of the fixture scenario', () => {
  it('passes every goal when the robot does what the scenario asks, and finish-within is the time the last of the others passed', () => {
    const results = scoreRun(route());
    expect([...results.values()].filter((result) => !result.passed)).toEqual([]);
    expect([...results.values()].reduce((sum, result) => sum + result.points, 0)).toBe(90);
    // the last goal to pass is the parking: held for a second after the robot first stood still in the dock
    const parkedAtS = results.get('park')!.atS!;
    expect(results.get('in-time')!.atS).toBe(parkedAtS);
    expect(parkedAtS).toBeLessThan(45);
    // the route is complete when the robot enters the dock, which is also when it reaches the dock
    expect(results.get('route')!.atS).toBe(results.get('reach-dock')!.atS);
    expect(results.get('gate-open')!.atS).toBeLessThan(results.get('route')!.atS!);
  });

  it('fails finish-within and keeps the rest when the robot is slow, whatever the points it has', () => {
    const results = scoreRun(route(30)); // waits 30 s at the start
    expect(results.get('in-time')).toEqual({
      id: 'in-time',
      passed: false,
      points: 0,
      progress: 0,
      reasonKey: goalReasons.notFinishedInTime,
    } satisfies GoalResult);
    expect([...results.values()].filter((result) => !result.passed).map((result) => result.id)).toEqual(['in-time']);
    expect(results.get('park')!.atS).toBeGreaterThan(45);
  });

  it('fails the goals that were not met, each with its own reason', () => {
    const results = scoreRun([{ ...inside.start }, { ...inside.start, contacts: [{ otherId: 'pole', tags: ['cylinder', 'obstacle'] }] }]);
    expect(new Map([...results].map(([id, result]) => [id, result.reasonKey]))).toEqual(
      new Map([
        ['reach-dock', goalReasons.zoneNotReached],
        ['route', goalReasons.checkpointMissed],
        ['on-line', goalReasons.robotDidNotMove],
        ['no-bump', goalReasons.contact],
        ['push-crate', goalReasons.objectNotInZone],
        ['park', goalReasons.notStoppedInZone],
        ['gate-open', goalReasons.servoNotSetInZone],
        ['in-time', goalReasons.notFinishedInTime],
        ['loop', undefined],
      ]),
    );
    expect(results.get('no-bump')!.atS).toBe(0.25);
  });

  it('gives the same results for the same frames, every time', () => {
    const frames = route();
    const first = JSON.stringify([...scoreRun(frames)]);
    expect(JSON.stringify([...scoreRun(frames)])).toBe(first);
  });
});
