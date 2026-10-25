import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createRobotRunSession, type RobotStartResult } from '../../core/run/robot-run-session';
import { driveMove, driveStop } from '../../core/program/__fixtures__/uno-blocks';
import { num, wait } from '../../core/program/__fixtures__/ybc-blocks';
import { robotProject } from '../../core/run/__fixtures__/robot-session';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { robotSolutions } from '../../samples/robot-solutions';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { createRobotRunStore, isRunOver, labStatus, ROBOT_SPEEDS, selectRunActive, shownRun } from './robot-run-store';
import { fakeSession as fakeRobotSession, idleRun } from './__fixtures__/fake-session';
import { sameView } from './scene-math';

// N18 R4.2/R4.4: the robot lab's run, as the UI drives it. The session (R3.6) runs the world; this store drives it from
// requestAnimationFrame while a run goes on (`advance(wallMs, speed)`), holds it on Pause, steps it 0.1 s at a time, and hands React at
// most one snapshot per frame. The view reads the session's latest world itself, in its own frame callback.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const project = robotStarterDocument('rb-drive-to-zone');

const idle = idleRun;
const fakeSession = () => fakeRobotSession(scenario, kit);

/** Animation frames that run only when the test says so, with the time it gives. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => pending.delete(handle),
    pending: () => pending.size,
    /** Runs every frame callback queued so far, at `now`. */
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

function setup() {
  const fake = fakeSession();
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  store.getState().connect();
  return { ...fake, frames, store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the robot lab’s run store (N18 R4.2, R4.4)', () => {
  it('drives a run from animation frames with the time between them at the chosen speed, and stops driving when it stops', async () => {
    const { store, session, advances, frames } = setup();
    await store.getState().run(project);
    expect(session.start).toHaveBeenCalledWith(project);
    // The first frame starts the clock; each next one is worth the time since the last.
    frames.frame(1000);
    frames.frame(1016);
    store.getState().setSpeed(4);
    frames.frame(1032.5);
    expect(advances).toEqual([
      [0, 1],
      [16, 1],
      [16.5, 4],
    ]);
    store.getState().stop();
    expect(session.stop).toHaveBeenCalledTimes(1);
    frames.frame(1050);
    expect(advances).toHaveLength(3);
    expect(frames.pending()).toBe(0);
  });

  it('hands React at most one snapshot per frame, the latest, and tells each publish to whoever listens at once', async () => {
    const { store, publish, world, frames } = setup();
    const published: number[] = [];
    store.getState().onPublish((snapshot) => published.push(snapshot.world?.t ?? -1));
    await store.getState().run(project);
    publish({ world: world(0.1) });
    publish({ world: world(0.2) });
    expect(published).toEqual([0, 0.1, 0.2]);
    // The start's own snapshot was handed over with it; the session's publishes after it wait for the frame.
    expect(store.getState().snapshot.world?.t).toBe(0);
    frames.frame(10);
    expect(store.getState().snapshot.world?.t).toBe(0.2);
  });

  it('hands React the snapshot at once after its own Run, Stop and Reset: the HUD never lags the controls by a frame', async () => {
    const { store, publish, world } = setup();
    await store.getState().run(project);
    expect(store.getState().snapshot.status).toBe('running');
    publish({ world: world(1) });
    store.getState().stop();
    expect(store.getState().snapshot.status).toBe('idle');
    expect(labStatus(store.getState())).toBe('stopped');
    await store.getState().run(project);
    await store.getState().resetRobot();
    expect(store.getState().snapshot.world?.t).toBe(0);
  });

  it('says a run is on from its start until it stops, at once (the host’s run-started and run-stopped)', async () => {
    const { store } = setup();
    expect(selectRunActive(store.getState())).toBe(false);
    await store.getState().run(project);
    expect(selectRunActive(store.getState())).toBe(true);
    store.getState().stop();
    expect(selectRunActive(store.getState())).toBe(false);
  });

  it('holds time on Pause and starts the clock again on Resume, so the pause is never owed', async () => {
    const { store, advances, frames } = setup();
    await store.getState().run(project);
    frames.frame(0);
    store.getState().togglePause();
    expect(store.getState().paused).toBe(true);
    frames.frame(16);
    frames.frame(5000);
    store.getState().togglePause();
    frames.frame(6000);
    frames.frame(6016);
    expect(advances).toEqual([
      [0, 1],
      [0, 1],
      [16, 1],
    ]);
  });

  it('steps 0.1 s of simulated time in frames of 25 ms at 1×, after the frame in flight, and pauses a run that was going', async () => {
    const { store, advances } = setup();
    await store.getState().run(project);
    await store.getState().step(project);
    expect(store.getState().paused).toBe(true);
    expect(advances).toEqual([
      [0, 1],
      [25, 1],
      [25, 1],
      [25, 1],
      [25, 1],
    ]);
  });

  it('steps from idle by starting the run paused', async () => {
    const { store, session, advances, frames } = setup();
    await store.getState().step(project);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(store.getState().paused).toBe(true);
    expect(advances.map(([ms]) => ms)).toEqual([0, 25, 25, 25, 25]);
    frames.frame(100);
    expect(advances).toHaveLength(5);
  });

  it('keeps the world of a stopped run in view until Reset, which shows the start; Reset of a run starts it again', async () => {
    const { store, session, publish, world } = setup();
    await store.getState().run(project);
    publish({ world: world(1.5, 60) });
    store.getState().stop();
    expect(store.getState().latestWorld()?.robot.xCm).toBe(60);
    expect(store.getState().held?.world?.robot.xCm).toBe(60);
    await store.getState().resetRobot();
    expect(store.getState().latestWorld()).toBeNull();
    expect(session.resetRobot).not.toHaveBeenCalled();

    await store.getState().run(project);
    publish({ world: world(2, 70) });
    await store.getState().resetRobot();
    expect(session.resetRobot).toHaveBeenCalledTimes(1);
    expect(store.getState().latestWorld()?.t).toBe(0);
  });

  it('keeps why a run did not start until the next start, and forgets a start a newer one superseded', async () => {
    const { store, willStart } = setup();
    const failure: RobotStartResult = { ok: false, reason: 'compile', diagnostics: [{ severity: 'error', code: 'missing-input', message: '"if" needs a condition.' }] };
    willStart(Promise.resolve(failure));
    await store.getState().run(project);
    expect(store.getState().startFailure).toEqual(failure);
    expect(store.getState().starting).toBe(false);
    willStart(Promise.resolve({ ok: false, reason: 'superseded', diagnostics: [] }));
    await store.getState().run(project);
    expect(store.getState().startFailure).toBeNull();
    willStart(Promise.resolve({ ok: true }));
    await store.getState().run(project);
    expect(store.getState().startFailure).toBeNull();
  });

  it('says it is starting while the world is built', async () => {
    const { store, willStart } = setup();
    let finish: (result: RobotStartResult) => void = () => {};
    willStart(new Promise((resolve) => (finish = resolve)));
    const started = store.getState().run(project);
    expect(store.getState().starting).toBe(true);
    finish({ ok: true });
    await started;
    expect(store.getState().starting).toBe(false);
  });

  it('presses the kit’s button through the session, and does nothing of a run while a check holds the lab', async () => {
    const { store, session } = setup();
    await store.getState().run(project);
    store.getState().press('button1', true);
    expect(session.pressButton).toHaveBeenCalledWith('button1', true);
    store.getState().setLocked(true);
    store.getState().press('button1', false);
    await store.getState().run(project);
    await store.getState().step(project);
    await store.getState().resetRobot();
    store.getState().togglePause();
    expect(session.pressButton).toHaveBeenCalledTimes(1);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(session.resetRobot).not.toHaveBeenCalled();
    expect(store.getState().paused).toBe(false);
    store.getState().setLocked(false);
    store.getState().press('button1', false);
    expect(session.pressButton).toHaveBeenCalledTimes(2);
  });

  it('takes a speed that is a finite number above 0, and offers 0.5×, 1×, 2× and 4×', () => {
    const { store } = setup();
    expect(ROBOT_SPEEDS).toEqual([0.5, 1, 2, 4]);
    expect(store.getState().speed).toBe(1);
    store.getState().setSpeed(2);
    expect(store.getState().speed).toBe(2);
    expect(() => store.getState().setSpeed(0)).toThrow(RangeError);
    expect(() => store.getState().setSpeed(Number.NaN)).toThrow(RangeError);
    expect(store.getState().speed).toBe(2);
  });

  it('stops driving once the run is over: an error, or the scenario’s end (its time limit or a crash, which the session decides)', async () => {
    const { store, publish, world, advances, frames } = setup();
    await store.getState().run(project);
    frames.frame(0);
    publish({ status: 'finished', world: world(15), end: { reason: 'time-limit', atS: 15 } });
    frames.frame(16);
    expect(advances).toHaveLength(1);
    expect(isRunOver(idle)).toBe(true);
    expect(isRunOver({ ...idle, status: 'running', world: world(15.5) })).toBe(false);
    expect(isRunOver({ ...idle, status: 'error', world: world(1) })).toBe(true);
    expect(isRunOver({ ...idle, status: 'finished', world: world(1), end: { reason: 'contact', atS: 1, tag: 'wall' } })).toBe(true);
    // A finished run still in its time is driven on, even at rest: its goals are judged and its time limit ends it.
    expect(isRunOver({ ...idle, status: 'finished', world: world(1) })).toBe(false);
  });

  it('is made without listening to anything; connect listens, and its end stops the run and listens no more (StrictMode mounts twice)', async () => {
    const fake = fakeSession();
    const frames = fakeFrames();
    const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const published: number[] = [];
    store.getState().onPublish((snapshot) => published.push(snapshot.world?.t ?? -1));
    fake.publish({ status: 'running', world: fake.world(1) });
    expect(published).toEqual([]);
    const disconnect = store.getState().connect();
    fake.publish({ world: fake.world(2) });
    disconnect();
    expect(fake.session.stop).toHaveBeenCalledTimes(1);
    expect(selectRunActive(store.getState())).toBe(false);
    fake.publish({ status: 'running', world: fake.world(3) });
    expect(published).toEqual([2]);
    store.getState().connect();
    fake.publish({ world: fake.world(4) });
    expect(published).toEqual([2, 4]);
  });

  it('leaves no frame behind when it disconnects: neither the drive nor the commit of a snapshot published just before', async () => {
    const fake = fakeSession();
    const frames = fakeFrames();
    const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const disconnect = store.getState().connect();
    await store.getState().run(project);
    fake.publish({ world: fake.world(0.5) });
    expect(frames.pending()).toBe(2);
    disconnect();
    expect(frames.pending()).toBe(0);
  });

  it('starts its clock again when the page comes back into sight, so a hidden tab is not owed', async () => {
    const fake = fakeSession();
    const frames = fakeFrames();
    const visibility = new EventTarget() as EventTarget & { hidden: boolean };
    visibility.hidden = false;
    const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, visibility });
    const disconnect = store.getState().connect();
    await store.getState().run(project);
    frames.frame(0);
    frames.frame(16);
    visibility.hidden = true;
    visibility.dispatchEvent(new Event('visibilitychange'));
    visibility.hidden = false;
    visibility.dispatchEvent(new Event('visibilitychange'));
    frames.frame(9000);
    frames.frame(9016);
    expect(fake.advances.map(([ms]) => ms)).toEqual([0, 16, 0, 16]);
    disconnect();
  });
});

describe('what the lab says the run is doing (N18 R4.4)', () => {
  it('says idle, getting ready, running, paused, stopped, then idle again after Reset', async () => {
    const { store, willStart, frames, publish, world } = setup();
    const status = () => labStatus(store.getState());
    expect(status()).toBe('idle');
    let finish: (result: RobotStartResult) => void = () => {};
    willStart(new Promise((resolve) => (finish = resolve)));
    const started = store.getState().run(project);
    expect(status()).toBe('starting');
    finish({ ok: true });
    await started;
    frames.frame(0);
    expect(status()).toBe('running');
    store.getState().togglePause();
    expect(status()).toBe('paused');
    publish({ status: 'finished', world: world(2) });
    frames.frame(16);
    expect(status()).toBe('paused');
    store.getState().togglePause();
    expect(status()).toBe('finished');
    store.getState().stop();
    frames.frame(32);
    expect(status()).toBe('stopped');
    expect(shownRun(store.getState())?.world?.t).toBe(2);
    await store.getState().resetRobot();
    expect(status()).toBe('idle');
    expect(shownRun(store.getState())).toBeNull();
  });

  it('says time is up at the scenario’s time limit, crashed at an end by contact, and error on an error, as the session tells it', async () => {
    const { store, publish, world, frames } = setup();
    const status = () => labStatus(store.getState());
    await store.getState().run(project);
    publish({ world: world(15.5) });
    frames.frame(0);
    expect(status()).toBe('running');
    publish({ status: 'finished', world: world(15), end: { reason: 'time-limit', atS: 15 } });
    frames.frame(16);
    expect(status()).toBe('timeUp');
    publish({ status: 'finished', world: world(3), end: { reason: 'contact', atS: 3, tag: 'wall' } });
    frames.frame(32);
    expect(status()).toBe('crashed');
    publish({ status: 'error', world: world(3), error: { message: 'Division by zero.', code: 'division-by-zero' } });
    frames.frame(48);
    expect(status()).toBe('error');
  });
});

describe('the run store on the real session (N18 R4.2)', () => {
  it('runs the reference solution of rb-drive-to-zone: the robot moves forward, and a step is 0.1 s of simulated time exactly', async () => {
    const session = createRobotRunSession({ scenario, kit, board: unoR3Board, registry: createDeviceRegistry(localDeviceDefinitions) });
    const frames = fakeFrames();
    const store = createRobotRunStore(session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const disconnect = store.getState().connect();
    const solved: ProjectDocument = { ...project, program: { blocks: robotSolutions['rb-drive-to-zone'].reference } };
    await store.getState().run(solved);
    expect(store.getState().latestWorld()?.t).toBe(0);
    const startX = store.getState().latestWorld()!.robot.xCm;
    for (let now = 0; now <= 1000; now += 1000 / 60) {
      frames.frame(now);
      await flush();
    }
    const after = store.getState().latestWorld()!;
    expect(after.t).toBeCloseTo(1, 1);
    expect(after.robot.xCm).toBeGreaterThan(startX + 5);
    store.getState().togglePause();
    const t0 = store.getState().latestWorld()!.t;
    await store.getState().step(solved);
    expect(Math.round((store.getState().latestWorld()!.t - t0) * 120)).toBe(12);
    disconnect();
  });

  // N18 R4.2 fix round 1: the HUD reads the committed snapshot's time; it must keep going while a finished robot rests, and the picture
  // (what the 3D view draws, `sameView`) must not change for it.
  it('keeps the HUD’s time going in tenths while a finished robot rests, with the same picture: nothing for the 3D view to draw', async () => {
    const session = createRobotRunSession({ scenario, kit, board: unoR3Board, registry: createDeviceRegistry(localDeviceDefinitions) });
    const frames = fakeFrames();
    const store = createRobotRunStore(session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const disconnect = store.getState().connect();
    await store.getState().run(robotProject([driveMove('forward', num(50)), wait(num(300)), driveStop()]));
    const shown: { t: number; world: RobotSnapshot }[] = [];
    for (let frame = 0, now = 0; frame <= 4 * 60; frame++, now += 1000 / 60) {
      frames.frame(now);
      await flush();
      const world = store.getState().snapshot.world;
      if (world !== null && world !== shown.at(-1)?.world) shown.push({ t: world.t, world });
    }
    expect(store.getState().snapshot.status).toBe('finished');
    // From 2 s the robot has long rested (the program ended at 0.3 s): the time still moves on, a tenth at a time, the picture does not.
    const resting = shown.filter((entry) => entry.t >= 2);
    expect(resting.length).toBeGreaterThanOrEqual(15);
    expect(resting.at(-1)!.t).toBeGreaterThan(3.8);
    for (let k = 1; k < resting.length; k++) {
      const gap = resting[k]!.t - resting[k - 1]!.t;
      expect(gap).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(gap).toBeLessThanOrEqual(0.1 + 1 / 60 + 1e-9);
      expect(sameView(resting[k - 1]!.world, resting[k]!.world)).toBe(true);
    }
    disconnect();
  });
});
