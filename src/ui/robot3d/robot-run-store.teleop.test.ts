import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createRobotRunSession } from '../../core/run/robot-run-session';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { fakeCheckView, fakeSession as fakeRobotSession, idleRun } from './__fixtures__/fake-session';
import { createRobotRunStore, labBusy, labStatus, selectHostRun } from './robot-run-store';
import { idleSnapshot } from './scene-math';

// N18 R4.8: teleop ("Lái tay") and the placed start ("Di chuyển robot") as the lab's run store drives them: teleop is a run of the
// session that the frames drive like any other, but the host never hears of it as a run and a load-project never waits for it; a check
// (the lock), a check shown in the view and a replay keep it off; Chạy replaces it. The placed start is shown before a run, and Đặt lại
// robot goes back to it first, then to the scenario's start.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const project = robotStarterDocument('rb-drive-to-zone');
const registry = createDeviceRegistry(localDeviceDefinitions);
const startView = (pose: { xCm: number; yCm: number; yawDeg: number }) => idleSnapshot({ ...scenario, start: pose }, kit);

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
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

function setup() {
  const fake = fakeRobotSession(scenario, kit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, startView });
  store.getState().connect();
  return { ...fake, frames, store };
}

const forward = { op: 'move', direction: 'forward', speed: 50 } as const;

describe('teleop in the run store (N18 R4.8)', () => {
  it('starts teleop as a run the frames drive, says so, and is no run for the host nor a reason for a load-project to wait', async () => {
    const { store, session, frames, advances } = setup();
    await store.getState().startTeleop();
    expect(session.startTeleop).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ teleop: true, active: true, starting: false });
    expect(labStatus(store.getState())).toBe('teleop');
    expect(selectHostRun(store.getState())).toBe(false);
    expect(labBusy(store.getState())).toBe(false);
    frames.frame(100);
    frames.frame(116);
    expect(advances).toEqual([
      [0, 1],
      [16, 1],
    ]);
    store.getState().teleopCommand(forward);
    expect(session.teleop).toHaveBeenCalledWith(forward);
  });

  it('Chạy turns teleop off: the program’s run replaces it, and the host hears of a run from its first snapshot', async () => {
    const { store, session } = setup();
    await store.getState().startTeleop();
    const told: boolean[] = [];
    store.subscribe((state, previous) => {
      if (selectHostRun(state) !== selectHostRun(previous)) told.push(selectHostRun(state));
    });
    await store.getState().run(project);
    expect(session.start).toHaveBeenCalledWith(project);
    expect(store.getState().teleop).toBe(false);
    expect(labStatus(store.getState())).toBe('running');
    expect(told).toEqual([true]);
    store.getState().teleopCommand(forward);
    expect(session.teleop).not.toHaveBeenCalled();
  });

  it('a Run that does not start still ends teleop, and the host hears of no run', async () => {
    const { store, willStart, session, publish } = setup();
    await store.getState().startTeleop();
    const told: boolean[] = [];
    store.subscribe((state, previous) => {
      if (selectHostRun(state) !== selectHostRun(previous)) told.push(selectHostRun(state));
    });
    willStart(Promise.resolve({ ok: false, reason: 'compile', diagnostics: [] }));
    // As the real session: a start that fails leaves it idle.
    session.start.mockImplementationOnce(async () => {
      publish(idleRun);
      return { ok: false, reason: 'compile', diagnostics: [] };
    });
    await store.getState().run(project);
    expect(store.getState().teleop).toBe(false);
    expect(told).toEqual([]);
  });

  it('turning teleop off keeps where the robot got to in view, as Dừng does; Dừng turns it off too', async () => {
    const { store, session, publish, world } = setup();
    await store.getState().startTeleop();
    publish({ world: world(2, 60), teleop: true });
    store.getState().stopTeleop();
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ teleop: false, active: false });
    expect(store.getState().held?.world?.robot.xCm).toBe(60);
    expect(labStatus(store.getState())).toBe('stopped');
    await store.getState().startTeleop();
    store.getState().stop();
    expect(store.getState().teleop).toBe(false);
    // Off already: nothing to stop.
    store.getState().stopTeleop();
    expect(session.stop).toHaveBeenCalledTimes(2);
  });

  it('is refused while a check holds the lab, while a check’s run is shown, and while a replay of a round goes on', async () => {
    const { store, session, publish, world } = setup();
    store.getState().setLocked(true);
    await store.getState().startTeleop();
    expect(session.startTeleop).not.toHaveBeenCalled();
    store.getState().setLocked(false);

    const check = fakeCheckView();
    const detach = store.getState().attach(check.view, 1);
    await store.getState().startTeleop();
    expect(session.startTeleop).not.toHaveBeenCalled();
    detach(null);

    await store.getState().replay(project, { index: 1, count: 2, score: null });
    await store.getState().startTeleop();
    expect(session.startTeleop).not.toHaveBeenCalled();
    // A replay that is over gives way.
    publish({ world: world(3), end: { reason: 'time-limit', atS: 3 } });
    await store.getState().startTeleop();
    expect(session.startTeleop).toHaveBeenCalledTimes(1);
    expect(store.getState().round).toBeNull();
  });

  it('a check that starts while teleop is on ends it (the check stops the learner’s run and locks the lab)', async () => {
    const { store } = setup();
    await store.getState().startTeleop();
    store.getState().stop();
    store.getState().setLocked(true);
    expect(store.getState().teleop).toBe(false);
    store.getState().teleopCommand(forward);
    await store.getState().startTeleop();
    expect(store.getState().teleop).toBe(false);
  });

  it('drives the real session by hand: the robot moves forward while the frames come, through the store', { timeout: 30_000 }, async () => {
    const real = createRobotRunSession({ scenario, kit, board: unoR3Board, registry });
    const frames = fakeFrames();
    const store = createRobotRunStore(real, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
    const stop = store.getState().connect();
    await store.getState().startTeleop();
    const startX = store.getState().latestWorld()!.robot.xCm;
    store.getState().teleopCommand(forward);
    for (let i = 0; i <= 30; i++) {
      frames.frame(i * 1000 / 60);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(store.getState().latestWorld()!.robot.xCm - startX).toBeGreaterThan(3);
    expect(real.getSnapshot().teleop).toBe(true);
    stop();
  });
});

describe('the placed start in the run store (N18 R4.8)', () => {
  it('places the robot before a run: the view shows it there, what a stopped run left gives way', async () => {
    const { store, session, publish, world } = setup();
    await store.getState().run(project);
    publish({ world: world(1, 70) });
    store.getState().stop();
    expect(store.getState().held).not.toBeNull();
    const result = await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 90 });
    expect(result).toEqual({ ok: true, pose: { xCm: 100, yCm: 50, yawDeg: 90 } });
    expect(session.placeRobot).toHaveBeenCalledWith({ xCm: 100, yCm: 50, yawDeg: 90 });
    expect(store.getState()).toMatchObject({ placement: { xCm: 100, yCm: 50, yawDeg: 90 }, held: null });
    expect(store.getState().latestWorld()?.robot).toMatchObject({ xCm: 100, yCm: 50, yawDeg: 90 });
    expect(store.getState().latestWorld()?.status).toBe('idle');
    expect(labStatus(store.getState())).toBe('idle');
  });

  it('a run that is over gives way to the placed robot; a run going on, a start, a check or a shown check refuse it', async () => {
    const { store, session, publish, world } = setup();
    await store.getState().run(project);
    expect(await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 })).toBeNull();
    publish({ world: world(15), end: { reason: 'time-limit', atS: 15 } });
    expect(await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 })).toMatchObject({ ok: true });
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ active: false, held: null });
    store.getState().setLocked(true);
    expect(await store.getState().placeRobot({ xCm: 90, yCm: 50, yawDeg: 0 })).toBeNull();
    store.getState().setLocked(false);
    const detach = store.getState().attach(fakeCheckView().view, 1);
    expect(await store.getState().placeRobot({ xCm: 90, yCm: 50, yawDeg: 0 })).toBeNull();
    detach(null);
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
  });

  it('keeps the placement when the session refuses a pose (it stands in something)', async () => {
    const { store, session } = setup();
    await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 });
    session.placeRobot.mockResolvedValueOnce({ ok: false, reason: 'overlap', issues: [{ path: 'start', message: 'the robot’s body overlaps walls[0] (wall)' }] });
    expect(await store.getState().placeRobot({ xCm: 5, yCm: 5, yawDeg: 0 })).toMatchObject({ ok: false, reason: 'overlap' });
    expect(store.getState().placement).toEqual({ xCm: 100, yCm: 50, yawDeg: 0 });
  });

  it('Đặt lại robot goes back to the placed pose, and a second one to the scenario’s start (during a run, and after one)', async () => {
    const { store, session, publish, world } = setup();
    await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 });
    await store.getState().run(project);
    await store.getState().resetRobot();
    expect(session.resetRobot).toHaveBeenCalledTimes(1);
    expect(store.getState().placement).not.toBeNull();
    expect(store.getState().resetToStart).toBe(true);
    await store.getState().resetRobot();
    expect(session.resetRobot).toHaveBeenCalledTimes(1);
    expect(session.placeRobot).toHaveBeenLastCalledWith(null);
    expect(store.getState()).toMatchObject({ placement: null, resetToStart: false });

    // After a run: the first Reset clears what it left (the robot back at the placed pose), the second goes to the start.
    store.getState().stop();
    await store.getState().resetRobot();
    await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 });
    expect(store.getState().placement).toEqual({ xCm: 100, yCm: 50, yawDeg: 0 });
    await store.getState().run(project);
    publish({ world: world(2, 120) });
    store.getState().stop();
    await store.getState().resetRobot();
    expect(store.getState()).toMatchObject({ held: null, placement: { xCm: 100 }, resetToStart: true });
    await store.getState().resetRobot();
    expect(store.getState()).toMatchObject({ placement: null, resetToStart: false });
    expect(store.getState().latestWorld()).toBeNull();
  });

  it('during a replay of a check’s round, every Đặt lại robot starts that round again (a check never takes the placed pose)', async () => {
    const { store, session } = setup();
    await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 });
    await store.getState().replay(project, { index: 1, count: 2, score: null });
    await store.getState().resetRobot();
    await store.getState().resetRobot();
    expect(session.resetRobot).toHaveBeenCalledTimes(2);
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ placement: { xCm: 100 }, resetToStart: false });
  });

  it('with the robot already at its placed pose, the first Reset only arms the way back, and anything else in between disarms it', async () => {
    const { store } = setup();
    await store.getState().placeRobot({ xCm: 100, yCm: 50, yawDeg: 0 });
    await store.getState().resetRobot();
    expect(store.getState()).toMatchObject({ placement: { xCm: 100 }, resetToStart: true });
    // A check locks the lab after its Reset: the learner's placement stays.
    store.getState().setLocked(true);
    store.getState().setLocked(false);
    expect(store.getState().resetToStart).toBe(false);
    await store.getState().resetRobot();
    await store.getState().run(project);
    expect(store.getState().resetToStart).toBe(false);
    expect(store.getState().placement).not.toBeNull();
  });
});
