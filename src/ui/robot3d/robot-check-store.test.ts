import { describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createRobotRunSession, type RobotRunSnapshot } from '../../core/run/robot-run-session';
import { checkRobot, RobotCheckError, type CheckProgress } from '../../core/scenario/check-robot';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasons } from '../../core/scenario/goals';
import { scenarioScorer } from '../../core/scenario/scoring';
import { hashSnapshot } from '../../core/world/snapshot';
import { robotSolutions } from '../../samples/robot-solutions';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { fakeCheck } from './__fixtures__/fake-check';
import { fakeSession, idleRun } from './__fixtures__/fake-session';
import { CANCEL_GUARD_MS, checkFraction, createRobotCheckStore, type CheckHost, type CheckSpeed, type CreateCheck } from './robot-check-store';
import { createRobotRunStore, labStatus } from './robot-run-store';

// N18 R6.3: Kiểm tra in the robot lab. The check is R6.2's checkRobot; this store starts it from the saved document, holds the lab while it
// runs, shows its run in the lab's view at 1× and 4× (the run store's `attach`) and nothing but its progress when it is fast (headless),
// keeps its report and its rounds' ends, replays a round, and tells the host in the order the bridge needs (beginCheck after the editor
// saved, robotCheckResult, endCheck in a finally). A cancelled check gives no result and sends the host nothing.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const stopAtWall = scenarioCatalog.get('rb-stop-at-wall')!;
const document = robotStarterDocument('rb-stop-at-wall');

/** Animation frames that run only when the test says so. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => pending.delete(handle),
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

const twoRounds: RobotCheckResult = {
  passed: false,
  goals: [
    { id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', passed: false },
    { id: 'no-crash', label: 'Xe không chạm tường', passed: false },
  ],
  score: 0,
  maxScore: 100,
  simTimeMs: 20000,
  variants: [
    { seed: 11, passed: true, score: 100, simTimeMs: 20000 },
    { seed: 12, passed: false, score: 0, simTimeMs: 6600 },
  ],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: 'ab',
};

function setup(options: { host?: CheckHost } = {}) {
  // The cancel guard's clock: a cancel counts once the test has let CANCEL_GUARD_MS go by (`later`).
  let clock = 1000;
  const fake = fakeSession(stopAtWall, kit);
  const frames = fakeFrames();
  const runStore = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  runStore.getState().connect();
  const log: string[] = [];
  const checks: { check: ReturnType<typeof fakeCheck>; project: ProjectDocument; mode: string; speed: number; onProgress: (progress: CheckProgress) => void }[] = [];
  const createCheck: CreateCheck = (project, mode, speed, onProgress) => {
    const check = fakeCheck();
    checks.push({ check, project, mode, speed, onProgress });
    log.push(`check:${mode}:${speed}`);
    return check.check;
  };
  let current = document;
  runStore.subscribe((state, previous) => {
    if (state.locked !== previous.locked) log.push(state.locked ? 'locked' : 'unlocked');
    if (state.active !== previous.active) log.push(state.active ? 'run-started' : 'run-stopped');
  });
  const host: CheckHost = options.host ?? {
    begin: () => log.push('begin'),
    result: (result) => log.push(`result:${result.score}`),
    end: () => log.push('end'),
  };
  const store = createRobotCheckStore({
    runStore,
    scenario: stopAtWall,
    createCheck,
    document: () => current,
    flushProgram: () => {
      log.push('flush');
      current = { ...current, name: 'saved' };
    },
    host: () => host,
    now: () => clock,
  });
  const later = (ms = CANCEL_GUARD_MS) => {
    clock += ms;
  };
  return { ...fake, runStore, store, frames, log, checks, later, saved: () => current };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The ends of two rounds as checkRobot tells them: the first passed, the second hit the wall at 6.6 s. */
function tellTwoRounds(onProgress: (progress: CheckProgress) => void, world: ReturnType<typeof fakeSession>['world']) {
  const first: RobotRunSnapshot = { ...idleRun, status: 'finished', world: world(20, 136), end: { reason: 'time-limit', atS: 20 } };
  const second: RobotRunSnapshot = { ...idleRun, status: 'finished', world: world(6.6, 150), end: { reason: 'contact', atS: 6.6, tag: 'wall' } };
  onProgress({ kind: 'variant-started', index: 0, count: 2, seed: 11 });
  onProgress({ kind: 'time', index: 0, tS: 1, timeLimitS: 20 });
  onProgress({
    kind: 'variant-ended',
    index: 0,
    count: 2,
    variant: twoRounds.variants[0]!,
    goals: [
      { id: 'stop-near-wall', passed: true, points: 70, progress: 1, atS: 9 },
      { id: 'no-crash', passed: true, points: 30, progress: 1, atS: 1 },
    ],
    timeBonus: 0,
    end: first.end!,
    error: null,
    snapshot: first,
  });
  onProgress({ kind: 'variant-started', index: 1, count: 2, seed: 12 });
  onProgress({ kind: 'time', index: 1, tS: 5, timeLimitS: 20 });
  onProgress({
    kind: 'variant-ended',
    index: 1,
    count: 2,
    variant: twoRounds.variants[1]!,
    goals: [
      { id: 'stop-near-wall', passed: false, points: 0, progress: 0, reasonKey: goalReasons.runEndedContact, atS: 6.6 },
      { id: 'no-crash', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: 6.6 },
    ],
    timeBonus: 0,
    end: second.end!,
    error: null,
    snapshot: second,
  });
  return { first, second };
}

describe('Kiểm tra in the robot lab (N18 R6.3)', () => {
  it('checks the saved document at 1×: the host hears begin after the save, the run, then the result after the run stopped, then end', async () => {
    const { store, runStore, log, checks, saved, world, frames } = setup();
    expect(store.getState().speed).toBe('1x');
    const started = store.getState().start();
    expect(checks).toHaveLength(1);
    const [{ check, project, mode, speed, onProgress }] = checks as [(typeof checks)[number]];
    expect([project, mode, speed]).toEqual([saved(), 'realtime', 1]);
    expect(project.name).toBe('saved');
    // The lab is held, and shows the check's run.
    expect(runStore.getState().locked).toBe(true);
    check.publish({ status: 'running', world: world(0) });
    expect(runStore.getState().latestWorld()?.t).toBe(0);
    frames.frame(100);
    frames.frame(116);
    expect(check.frames).toEqual([
      [0, 1],
      [16, 1],
    ]);
    const { second } = tellTwoRounds(onProgress, world);
    check.publish(idleRun);
    check.settle(twoRounds);
    await started;
    expect(log).toEqual(['flush', 'begin', 'locked', 'check:realtime:1', 'run-started', 'run-stopped', 'result:0', 'end', 'unlocked']);
    // The view keeps where the last round ended, that round and the check's score of it.
    expect(runStore.getState().latestWorld()).toBe(second.world);
    expect(runStore.getState().round).toEqual({ index: 1, count: 2, score: { points: 0, maxScore: 100, goals: expect.any(Array) } });
    expect(labStatus(runStore.getState())).toBe('crashed');
    expect(store.getState().running).toBeNull();
    expect(store.getState().report).toMatchObject({ result: twoRounds, document: saved() });
    expect(store.getState().report?.variants.map((variant) => [variant.index, variant.score, variant.end?.reason])).toEqual([
      [0, 100, 'time-limit'],
      [1, 0, 'contact'],
    ]);
  });

  it('checks at 4× through the view with the check’s speed, once its first round has a world', async () => {
    const { store, checks, frames, world } = setup();
    store.getState().setSpeed('4x');
    const started = store.getState().start();
    const [{ check, mode, speed }] = checks as [(typeof checks)[number]];
    expect([mode, speed]).toEqual(['realtime', 4]);
    // Not shown, not driven, while the first round builds its world.
    frames.frame(-20);
    expect(check.frames).toEqual([]);
    check.publish({ status: 'running', world: world(0) });
    frames.frame(0);
    frames.frame(20);
    expect(check.frames).toEqual([
      [0, 4],
      [20, 4],
    ]);
    check.settle(twoRounds);
    await started;
  });

  it('checks fast without showing the check’s run (headless): no run for the host, its progress told, its last round left in view', async () => {
    const { store, runStore, log, checks, world, frames } = setup();
    store.getState().setSpeed('fast');
    const started = store.getState().start();
    const [{ check, mode, onProgress }] = checks as [(typeof checks)[number]];
    expect(mode).toBe('headless');
    check.publish({ status: 'running', world: world(3) });
    // The lab's view does not show the check's run: a progress view stands over it.
    expect(runStore.getState().latestWorld()).toBeNull();
    frames.frame(0);
    expect(check.frames).toEqual([]);
    onProgress({ kind: 'variant-started', index: 1, count: 3, seed: 12 });
    onProgress({ kind: 'time', index: 1, tS: 7, timeLimitS: 20 });
    expect(store.getState().running).toMatchObject({ speed: 'fast', index: 1, count: 3, tS: 7, timeLimitS: 20 });
    const { second } = tellTwoRounds(onProgress, world);
    check.settle(twoRounds);
    await started;
    expect(log).toEqual(['flush', 'begin', 'locked', 'check:headless:1', 'result:0', 'end', 'unlocked']);
    expect(runStore.getState().latestWorld()).toBe(second.world);
    expect(runStore.getState().round).toMatchObject({ index: 1, count: 2 });
  });

  it.each<CheckSpeed>(['1x', 'fast'])('stops the learner’s run before a check at %s, so that nothing of it goes on under the check', async (speed) => {
    const { store, runStore, session, checks, log } = setup();
    await runStore.getState().run(document);
    expect(runStore.getState().active).toBe(true);
    store.getState().setSpeed(speed);
    const started = store.getState().start();
    expect(session.stop).toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe('idle');
    expect(runStore.getState().held).toBeNull();
    // The learner's run stopped (the host's run-stopped) after the check began, before the lab was held.
    expect(log.slice(0, 4)).toEqual(['run-started', 'flush', 'begin', 'run-stopped']);
    checks[0]!.check.settle(null);
    await started;
  });

  it('tells the round and the progress as the check tells them, and the HUD the round a check at 1× is in', async () => {
    const { store, runStore, checks, world } = setup();
    const started = store.getState().start();
    const [{ check, onProgress }] = checks as [(typeof checks)[number]];
    expect(store.getState().running).toEqual({ speed: '1x', index: 0, count: 3, tS: 0, timeLimitS: 20, ended: [] });
    onProgress({ kind: 'variant-started', index: 0, count: 2, seed: 11 });
    expect(runStore.getState().round).toEqual({ index: 0, count: 2, score: null });
    onProgress({ kind: 'time', index: 0, tS: 4, timeLimitS: 20 });
    expect(store.getState().running).toMatchObject({ index: 0, tS: 4 });
    tellTwoRounds(onProgress, world);
    expect(store.getState().running?.ended.map((variant) => variant.index)).toEqual([0, 1]);
    check.settle(twoRounds);
    await started;
  });

  it('cancels: no result, nothing for the host but begin and end (the edit kept meanwhile goes out after), nothing kept in view, unlocked', async () => {
    const { store, runStore, log, checks, world, later } = setup();
    const started = store.getState().start();
    const [{ check, onProgress }] = checks as [(typeof checks)[number]];
    onProgress({ kind: 'variant-started', index: 0, count: 2, seed: 11 });
    check.publish({ status: 'running', world: world(2, 60) });
    later();
    store.getState().cancel();
    expect(check.check.cancel).toHaveBeenCalledTimes(1);
    await started;
    expect(log).toEqual(['flush', 'begin', 'locked', 'check:realtime:1', 'run-started', 'run-stopped', 'end', 'unlocked']);
    expect(store.getState().report).toBeNull();
    expect(store.getState().running).toBeNull();
    expect(runStore.getState().latestWorld()).toBeNull();
    expect(runStore.getState().round).toBeNull();
    expect(labStatus(runStore.getState())).toBe('idle');
  });

  it('a check that cannot be made says why, as a Run that cannot start does: no run for the host, only begin and end', async () => {
    const { store, runStore, log, checks } = setup();
    const started = store.getState().start();
    const diagnostics = [{ severity: 'error' as const, code: 'empty-input', message: 'An input is empty.', blockId: 'go' }];
    checks[0]!.check.fail(new RobotCheckError('compile', diagnostics, null));
    await started;
    // N18 R6.3 fix round 1 (ruled): a check whose program does not compile has no run, as a Run that cannot start.
    expect(log).toEqual(['flush', 'begin', 'locked', 'check:realtime:1', 'end', 'unlocked']);
    expect(runStore.getState().startFailure).toEqual({ ok: false, reason: 'compile', diagnostics });
    expect(store.getState().report).toBeNull();
  });

  it('says the check did not complete when sending its result throws, and shows no result as if the lesson had it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    const { store, runStore, checks } = setup({
      host: {
        begin: () => calls.push('begin'),
        result: () => {
          throw new Error('the host would not read it');
        },
        end: () => calls.push('end'),
      },
    });
    const started = store.getState().start();
    checks[0]!.check.settle(twoRounds);
    await started;
    expect(calls).toEqual(['begin', 'end']);
    expect(store.getState().report).toBeNull();
    expect(store.getState().failure).toEqual({ detail: 'Error: the host would not read it' });
    expect(runStore.getState().locked).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    // The next check starts afresh.
    const again = store.getState().start();
    expect(store.getState().failure).toBeNull();
    checks[1]!.check.settle(null);
    await again;
    error.mockRestore();
  });

  it('ends the check for the host and lets the lab go when anything throws after it began', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, runStore, log, checks } = setup();
    vi.spyOn(runStore.getState(), 'stop').mockImplementation(() => {
      throw new Error('the run would not stop');
    });
    await store.getState().start();
    expect(checks).toHaveLength(0);
    expect(log).toEqual(['flush', 'begin', 'end']);
    expect(runStore.getState().locked).toBe(false);
    expect(store.getState().running).toBeNull();
    expect(store.getState().failure).toEqual({ detail: 'Error: the run would not stop' });
    error.mockRestore();
  });

  it('takes a cancel within CANCEL_GUARD_MS of the start for the second click of a double click; abort ends it at once', async () => {
    const { store, checks, later } = setup();
    expect(CANCEL_GUARD_MS).toBe(400);
    const started = store.getState().start();
    const [{ check }] = checks as [(typeof checks)[number]];
    later(CANCEL_GUARD_MS - 1);
    store.getState().cancel();
    expect(check.check.cancel).not.toHaveBeenCalled();
    later(1);
    store.getState().cancel();
    expect(check.check.cancel).toHaveBeenCalledTimes(1);
    await started;
    // The lab going away does not wait.
    const again = store.getState().start();
    store.getState().abort();
    expect(checks[1]!.check.check.cancel).toHaveBeenCalledTimes(1);
    await again;
    expect(store.getState().report).toBeNull();
  });

  it('runs one check at a time, none while the lab is held, and refuses a speed it does not offer', async () => {
    const { store, runStore, checks } = setup();
    const started = store.getState().start();
    await store.getState().start();
    expect(checks).toHaveLength(1);
    store.getState().setSpeed('4x');
    expect(store.getState().speed).toBe('1x');
    checks[0]!.check.settle(null);
    await started;
    runStore.getState().setLocked(true);
    await store.getState().start();
    expect(checks).toHaveLength(1);
    expect(() => store.getState().setSpeed('2x' as CheckSpeed)).toThrow(RangeError);
  });

  it('replays a round of the last check from its start at 1×, as that variant’s check run of the document it checked', async () => {
    const { store, runStore, checks, session, world, saved } = setup();
    const started = store.getState().start();
    tellTwoRounds(checks[0]!.onProgress, world);
    checks[0]!.check.settle(twoRounds);
    await started;
    await store.getState().replay(1);
    expect(session.start).toHaveBeenCalledWith(saved(), 1, { check: true });
    expect(runStore.getState().round).toEqual({ index: 1, count: 2, score: { points: 0, maxScore: 100, goals: expect.any(Array) } });
    expect(runStore.getState().speed).toBe(1);
    // Only a round the check ran.
    await store.getState().replay(5);
    expect(session.start).toHaveBeenCalledTimes(1);
    store.getState().dismiss();
    expect(store.getState().report).toBeNull();
  });
});

describe('how far a check has got (N18 R6.3)', () => {
  const running = (index: number, tS: number, ended: number) => ({
    speed: '1x' as const,
    index,
    count: 4,
    tS,
    timeLimitS: 20,
    ended: Array.from({ length: ended }, () => ({}) as never),
  });

  it('counts the rounds that ended and the part of the running one its time has reached', () => {
    expect(checkFraction(running(0, 0, 0))).toBe(0);
    expect(checkFraction(running(0, 10, 0))).toBe(0.125);
    // A round that ended early (a crash) counts whole.
    expect(checkFraction(running(0, 6, 1))).toBe(0.25);
    expect(checkFraction(running(2, 5, 2))).toBe(0.5625);
    expect(checkFraction(running(3, 20, 4))).toBe(1);
    expect(checkFraction(running(3, 25, 3))).toBe(1);
  });
});

describe('Kiểm tra on the real check (N18 R6.3, Review Focus 2)', () => {
  // The UI's check is checkRobot itself, driven through the run store's frames at 1× and 4× and on its own when fast: the speed changes
  // only who calls the ticks. The exploit crashes into the wall in every round, so each round ends early and fails with explanations.
  it('same score/passed/hash for 1×, 4× and headless', async () => {
    const registry = createDeviceRegistry(localDeviceDefinitions);
    const exploit = robotSolutions['rb-stop-at-wall'].exploits!.find((candidate) => candidate.name === 'crash-and-back-off')!;
    const crasher: ProjectDocument = { ...robotStarterDocument('rb-stop-at-wall'), program: { blocks: exploit.program } };
    const outcome = async (speed: CheckSpeed) => {
      const session = createRobotRunSession({ scenario: stopAtWall, kit, board: unoR3Board, registry, scorer: scenarioScorer });
      const frames = fakeFrames();
      const runStore = createRobotRunStore(session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
      const disconnect = runStore.getState().connect();
      const sent: RobotCheckResult[] = [];
      const store = createRobotCheckStore({
        runStore,
        scenario: stopAtWall,
        createCheck: (project, mode, factor, onProgress) => checkRobot(project, stopAtWall, { mode, speed: factor, kit, board: unoR3Board, registry, onProgress }),
        document: () => crasher,
        flushProgram: () => {},
        host: () => ({ result: (result) => void sent.push(result) }),
      });
      store.getState().setSpeed(speed);
      let done = false;
      const started = store.getState().start().finally(() => (done = true));
      // 60 Hz frames, and a page hidden for 2 s (no frames) in the middle of the second round.
      for (let now = 0, k = 0; !done; k++) {
        now += k === 700 ? 2000 : 1000 / 60;
        frames.frame(now);
        await flush();
      }
      await started;
      disconnect();
      const report = store.getState().report!;
      return { result: sent[0], hashes: report.variants.map((variant) => hashSnapshot(variant.snapshot.world!)), goals: report.variants.map((variant) => variant.goals) };
    };
    const headless = await outcome('fast');
    expect(headless.result).toMatchObject({ passed: false, score: 0 });
    expect(headless.hashes).toHaveLength(3);
    expect(await outcome('4x')).toEqual(headless);
    expect(await outcome('1x')).toEqual(headless);
  }, 120_000);
});
