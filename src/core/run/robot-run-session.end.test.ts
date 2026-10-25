import { beforeAll, describe, expect, it } from 'vitest';
import { driveMove, driveStop } from '../program/__fixtures__/uno-blocks';
import { add, getVar, num, print, setVar, wait } from '../program/__fixtures__/ybc-blocks';
import type { GoalFrame } from '../scenario/goals/frame';
import { loadScenario, type Scenario, type ScenarioJson } from '../scenario/scenario';
import { initPhysics, PHYSICS_DT_S, PHYSICS_HZ } from '../world/rapier';
import { published, robotProject, roverSession, withEndOnContact, worldOf } from './__fixtures__/robot-session';
import {
  endingTag,
  MAX_TICKS_PER_FRAME,
  REST_HOLD_S,
  REST_SPEED_CM_S,
  SLOW_BADGE_FRAMES,
  type RobotRunEnd,
  type RobotRunSession,
  type RobotScorerFactory,
} from './robot-run-session';

// N18 R6.2: what ends a run besides the program (robot plan §R6.2, controller rulings): its time limit, the first contact with a tag of
// the scenario's `endOnContact`; and a finished run whose robot is at rest stops publishing. The slower-than-real-time badge is debounced.

beforeAll(() => initPhysics(), 30_000);

const TICK_MS = 1000 / PHYSICS_HZ;
const tickOf = (session: RobotRunSession) => Math.round(worldOf(session).t * PHYSICS_HZ);

/**
 * The sandbox floor of 300 × 150 cm, the robot at (40, 75) facing +x, a wall across x = 120 (its kind `wall` is a tag); then `change`, and
 * the run ends at a contact with `endOnContact` when it is given.
 */
function arenaScenario(change: Partial<ScenarioJson> = {}, endOnContact?: string[]): Scenario {
  const scenario = loadScenario({
    key: 'rb-sandbox',
    version: 1,
    title: { vi: 'Bài thử', en: 'Fixture' },
    profile: 'uno-basic',
    kit: 'ref-uno-rover',
    arena: { ground: { sizeCm: [300, 150], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [120, 0], toCm: [120, 150] }] },
    start: { xCm: 40, yCm: 75, yawDeg: 0 },
    variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
    inputs: [],
    timeLimitS: 60,
    goals: [],
    starter: {},
    ...change,
  });
  return endOnContact === undefined ? scenario : withEndOnContact(scenario, endOnContact);
}

/** A scorer that keeps every frame it is fed and every end it is told; its verdict is `passed(frame)` of the latest frame. */
function recording(passed: (frame: GoalFrame) => boolean = () => false) {
  const frames: GoalFrame[] = [];
  const ends: RobotRunEnd[] = [];
  const scorer: RobotScorerFactory = () => ({
    update: (frame) => void frames.push(frame),
    score: () => {
      const last = frames.at(-1);
      const ok = last !== undefined && passed(last);
      return { points: ok ? 100 : 0, maxScore: 100, goals: [{ id: 'g', passed: ok, points: ok ? 100 : 0, progress: ok ? 1 : 0 }] };
    },
    end: (end) => void ends.push(end),
  });
  return { scorer, frames, ends };
}

const forever = (project = robotProject([], [driveMove('forward', num(100))])) => project;
/** Counts its loops and prints the count: what it printed says when it stopped. */
const counting = () => robotProject([], [setVar('x', add(getVar('x'), num(1))), print(getVar('x')), wait(num(100))]);

describe('a run ends at its time limit', () => {
  it('runs every tick up to t = timeLimitS, the next one ends it: finished, the reason time-limit, the program stopped, the scorer told', async () => {
    const { scorer, frames, ends } = recording();
    const session = roverSession(arenaScenario({ timeLimitS: 0.5 }), { scorer });
    await session.start(counting());
    await session.runUntil(0.5);
    // The last instant of the run is still running: every frame from t = 0 to the limit is judged.
    expect([tickOf(session), session.getSnapshot().status, session.getSnapshot().end]).toEqual([60, 'running', undefined]);
    expect(frames.map((frame) => frame.tS)).toEqual(Array.from({ length: 61 }, (_, k) => k / PHYSICS_HZ));
    await session.runUntil(5);
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ status: 'finished', error: null, end: { reason: 'time-limit', atS: 0.5 }, slowerThanRealtime: false });
    expect(snapshot.world).toMatchObject({ t: 0.5, status: 'finished', activeBlockId: null });
    expect(frames).toHaveLength(61);
    expect(ends).toEqual([{ reason: 'time-limit', atS: 0.5 }]);
    // The program lived through the ticks to 0.5 s (its last part of a tick ended at 59 ticks): a loop of a little over 100 ms printed
    // 1 at 0 s … 5 at 0.4 s, and nothing once the run ended.
    expect(snapshot.console.lines).toEqual(['1', '2', '3', '4', '5']);
    // Nothing drives an ended run: no time is owed, no press, no snapshot.
    const seen = published(session);
    await session.advance(1000);
    await session.runUntil(10);
    session.pressButton('button1', true);
    await session.advance(100);
    expect([seen.length, tickOf(session), frames.length]).toEqual([0, 60, 61]);
    session.stop();
  });

  it('ends the same in realtime: the frame that owes the tick past the limit ends the run and publishes it', async () => {
    const { scorer, frames, ends } = recording();
    const session = roverSession(arenaScenario({ timeLimitS: 0.5 }), { scorer });
    await session.start(counting());
    const seen = published(session);
    for (let frame = 0; frame < 40 && session.getSnapshot().end === undefined; frame++) await session.advance(1000 / 60, 4);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', end: { reason: 'time-limit', atS: 0.5 } });
    expect([tickOf(session), frames.length, ends.length]).toEqual([60, 61, 1]);
    expect(seen.filter((snapshot) => snapshot.end !== undefined)).toHaveLength(1);
    session.stop();
  });

  it('ends at the first tick at or after a limit that is not a whole number of ticks', async () => {
    for (const [timeLimitS, ticks] of [[0.1, 12], [0.105, 13], [1 / 3, 40]] as const) {
      const session = roverSession(arenaScenario({ timeLimitS }));
      await session.start(forever());
      await session.runUntil(1);
      expect([tickOf(session), session.getSnapshot().end]).toEqual([ticks, { reason: 'time-limit', atS: ticks / PHYSICS_HZ }]);
      session.stop();
    }
  });

  it('a new start or a reset runs again from t = 0 with no end', async () => {
    const session = roverSession(arenaScenario({ timeLimitS: 0.25 }));
    await session.start(forever());
    await session.runUntil(1);
    expect(session.getSnapshot().end).toEqual({ reason: 'time-limit', atS: 0.25 });
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ status: 'running', world: { t: 0 } });
    expect(session.getSnapshot().end).toBeUndefined();
    await session.runUntil(0.1);
    expect(tickOf(session)).toBe(12);
    session.stop();
  });
});

describe('a run ends at the first contact with a tag of endOnContact', () => {
  it('the tick of the contact is the last: its frame is judged, then finished with the reason contact, the tag and the time', async () => {
    const { scorer, frames, ends } = recording();
    const session = roverSession(arenaScenario({}, ['wall']), { scorer });
    await session.start(forever());
    await session.runUntil(20);
    const snapshot = session.getSnapshot();
    const last = frames.at(-1)!;
    expect(last.contacts.some((contact) => contact.tags.includes('wall'))).toBe(true);
    expect(frames.at(-2)!.contacts.some((contact) => contact.tags.includes('wall'))).toBe(false);
    expect(snapshot).toMatchObject({ status: 'finished', error: null, end: { reason: 'contact', tag: 'wall', atS: last.tS } });
    expect(snapshot.world!.t).toBe(last.tS);
    expect(last.tS).toBeGreaterThan(1);
    expect(last.tS).toBeLessThan(10);
    expect(ends).toEqual([{ reason: 'contact', tag: 'wall', atS: last.tS }]);
    // The robot stays where it hit the wall.
    await session.runUntil(30);
    expect(worldOf(session).t).toBe(last.tS);
    session.stop();
  });

  it('a scenario without endOnContact, or whose tags the contact does not have, runs on through the contact', async () => {
    const cone: Partial<ScenarioJson> = {
      arena: { ground: { sizeCm: [300, 150], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [120, 0], toCm: [120, 150] }], boxes: [{ id: 'cone', centerCm: [250, 20], sizeCm: [5, 5, 5], tags: ['obstacle'] }] },
    };
    for (const scenario of [arenaScenario(), arenaScenario(cone, ['obstacle'])]) {
      const { scorer, frames } = recording();
      const session = roverSession(scenario, { scorer });
      await session.start(forever());
      await session.runUntil(10);
      expect(frames.some((frame) => frame.contacts.some((contact) => contact.tags.includes('wall')))).toBe(true);
      expect([tickOf(session), session.getSnapshot().status, session.getSnapshot().end]).toEqual([10 * PHYSICS_HZ, 'running', undefined]);
      session.stop();
    }
  });

  it('names the first tag of the list that a contact of the tick has, the whole tag, or null', () => {
    const wall = { otherId: '#wall-0', tags: ['wall'] };
    const cone = { otherId: 'cone-1', tags: ['box', 'obstacle'] };
    const crate = { otherId: 'crate', tags: ['object', 'pushable'] };
    expect(endingTag(['wall', 'obstacle'], [crate])).toBeNull();
    expect(endingTag(['wall', 'obstacle'], [])).toBeNull();
    expect(endingTag(['wall', 'obstacle'], [crate, cone])).toBe('obstacle');
    expect(endingTag(['wall', 'obstacle'], [cone, wall])).toBe('wall');
    expect(endingTag([], [wall])).toBeNull();
    expect(endingTag(['wall', 'obstacle'], [{ otherId: 'x', tags: ['walls', 'obstacles', 'Wall'] }])).toBeNull();
  });

  it('a scorer that throws when told the end ends the run in internal-error', async () => {
    const session = roverSession(arenaScenario({ timeLimitS: 0.1 }), {
      scorer: () => ({
        update: () => {},
        score: () => ({ points: 0, maxScore: 100, goals: [] }),
        end: () => {
          throw new Error('no end for me');
        },
      }),
    });
    await session.start(forever());
    await session.runUntil(1);
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'internal-error', message: 'The robot simulation stopped: no end for me' } });
    session.stop();
  });
});

describe('a finished run whose robot is at rest stops publishing', () => {
  /** Drives forward at 50 % for 300 ms and stops: the program finishes at 0.3 s and the rover coasts to rest. */
  const shortDrive = () => robotProject([driveMove('forward', num(50)), wait(num(300)), driveStop()]);

  it(`once the program finished and the robot moved under ${REST_SPEED_CM_S} cm/s for ${REST_HOLD_S} s, frames publish nothing; the ticks go on, and the end is published`, async () => {
    const { scorer, frames } = recording();
    const session = roverSession(arenaScenario({ timeLimitS: 4 }), { scorer });
    await session.start(shortDrive());
    const seen = published(session);
    let quiet = 0;
    for (let frame = 0; frame < 4 * 60 + 10; frame++) {
      const before = seen.length;
      await session.advance(1000 / 60);
      quiet = seen.length === before ? quiet + 1 : 0;
    }
    // The ticks went on to the limit: every frame was judged.
    expect(frames.at(-1)!.tS).toBe(4);
    const finished = seen.findIndex((snapshot) => snapshot.status === 'finished');
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ status: 'finished', end: { reason: 'time-limit', atS: 4 } });
    // Published: each frame until the robot rested for half a second after the program ended, then only the end.
    const quietFrom = seen.at(-2)!.world!.t;
    expect(seen[finished]!.world!.t).toBeCloseTo(0.3, 1);
    expect(quietFrom).toBeGreaterThan(0.8);
    expect(quietFrom).toBeLessThan(1.6);
    expect(quiet).toBeGreaterThan(0);
    // The robot really was at rest: under the speed for the last half second before the snapshots stopped.
    const restFrames = frames.filter((frame) => frame.tS > quietFrom - REST_HOLD_S && frame.tS <= quietFrom);
    for (let k = 1; k < restFrames.length; k++) {
      const [a, b] = [restFrames[k - 1]!, restFrames[k]!];
      expect(Math.sqrt((b.robot.xCm - a.robot.xCm) ** 2 + (b.robot.yCm - a.robot.yCm) ** 2) / PHYSICS_DT_S).toBeLessThan(REST_SPEED_CM_S);
    }
    session.stop();
  });

  it('a goal whose verdict changes while the robot rests is published; a headless run still publishes its last snapshot', async () => {
    const { scorer } = recording((frame) => frame.tS >= 2.5);
    const session = roverSession(arenaScenario({ timeLimitS: 4 }), { scorer });
    await session.start(shortDrive());
    const seen = published(session);
    for (let frame = 0; frame < 3 * 60; frame++) await session.advance(1000 / 60);
    const quiet = seen.filter((snapshot) => snapshot.world!.t > 1.6);
    expect(quiet).toHaveLength(1);
    expect(quiet[0]!.world!.t).toBeCloseTo(2.5, 1);
    expect(quiet[0]!.world!.score.goals[0]!.passed).toBe(true);
    await session.runUntil(3.5);
    expect(seen.at(-1)!.world!.t).toBe(3.5);
    session.stop();
  });

  it('a robot spinning in place after its program finished is not at rest: every frame publishes', async () => {
    const session = roverSession(arenaScenario({ timeLimitS: 4 }));
    await session.start(robotProject([driveMove('spinLeft', num(60))]));
    const seen = published(session);
    for (let frame = 0; frame < 3 * 60; frame++) await session.advance(1000 / 60);
    expect(session.getSnapshot().status).toBe('finished');
    expect(seen).toHaveLength(3 * 60);
    session.stop();
  });
});

describe('slower than real time', () => {
  /** One frame that drops ticks (a whole second at 1×) or one that fits (a 60 Hz frame). */
  const slowFrame = (session: RobotRunSession) => session.advance(1000);
  const fitFrame = (session: RobotRunSession) => session.advance(1000 / 60);
  const badge = (session: RobotRunSession) => session.getSnapshot().slowerThanRealtime;

  it(`says so after ${SLOW_BADGE_FRAMES} frames in a row drop ticks, and stops after ${SLOW_BADGE_FRAMES} frames in a row fit`, async () => {
    expect(SLOW_BADGE_FRAMES).toBe(3);
    const session = roverSession(arenaScenario());
    await session.start(robotProject([], [setVar('x', num(1))]));
    const flags: boolean[] = [];
    for (const frame of [slowFrame, slowFrame, fitFrame, slowFrame, slowFrame, slowFrame, slowFrame, fitFrame, fitFrame, slowFrame, fitFrame, fitFrame, fitFrame]) {
      await frame(session);
      flags.push(badge(session));
    }
    expect(flags).toEqual([false, false, false, false, false, true, true, true, true, true, true, true, false]);
    // Every slow frame ran its cap and dropped the rest, flagged or not.
    expect(tickOf(session)).toBe(7 * MAX_TICKS_PER_FRAME + 6 * 2);
    session.stop();
  });

  it('is cleared when the program finishes, when the run ends, and when it fails', async () => {
    // The program finishes at 2 s; the run ends at 4 s.
    const session = roverSession(arenaScenario({ timeLimitS: 4 }));
    await session.start(robotProject([driveMove('spinLeft', num(60)), wait(num(2000))]));
    for (let frame = 0; frame < 4; frame++) await slowFrame(session);
    expect(badge(session)).toBe(true);
    for (let frame = 0; frame < 30 && session.getSnapshot().status === 'running'; frame++) await slowFrame(session);
    expect([session.getSnapshot().status, badge(session)]).toEqual(['finished', false]);
    for (let frame = 0; frame < 4; frame++) await slowFrame(session);
    expect(badge(session)).toBe(true);
    for (let frame = 0; frame < 60 && session.getSnapshot().end === undefined; frame++) await slowFrame(session);
    expect(session.getSnapshot()).toMatchObject({ end: { reason: 'time-limit' }, slowerThanRealtime: false });

    const failing = roverSession(arenaScenario(), {
      scorer: () => {
        let ticks = 0;
        return {
          update: () => {
            ticks += 1;
            if (ticks === 60) throw new Error('scorer broke');
          },
          score: () => ({ points: 0, maxScore: 100, goals: [] }),
        };
      },
    });
    await failing.start(robotProject([], [setVar('x', num(1))]));
    for (let frame = 0; frame < 4; frame++) await slowFrame(failing);
    expect(badge(failing)).toBe(true);
    for (let frame = 0; frame < 10 && failing.getSnapshot().status !== 'error'; frame++) await slowFrame(failing);
    expect([failing.getSnapshot().status, badge(failing)]).toEqual(['error', false]);
    failing.stop();
  });

  it('slowBadgeFrames: 1 flags each frame by itself, as R3.6 did', async () => {
    const session = roverSession(arenaScenario(), { slowBadgeFrames: 1 });
    await session.start(robotProject([], [setVar('x', num(1))]));
    const flags: boolean[] = [];
    for (const frame of [slowFrame, fitFrame, slowFrame, slowFrame, fitFrame]) {
      await frame(session);
      flags.push(badge(session));
    }
    expect(flags).toEqual([true, false, true, true, false]);
    expect(() => roverSession(arenaScenario(), { slowBadgeFrames: 0 })).toThrow(RangeError);
    session.stop();
  });

  it('a frame owing exactly one tick more than the cap is no drop', async () => {
    const session = roverSession(arenaScenario());
    await session.start(robotProject([], [setVar('x', num(1))]));
    for (let frame = 0; frame < 5; frame++) await session.advance((MAX_TICKS_PER_FRAME + 1) * TICK_MS);
    expect([tickOf(session), badge(session)]).toEqual([5 * (MAX_TICKS_PER_FRAME + 1), false]);
    session.stop();
  });
});
