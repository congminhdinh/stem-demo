import { describe, expect, it } from 'vitest';
import { createGripAnnouncer, GRIP_INTERVAL_MS, gripMomentOf, type GripMoment } from './lab-announcements';
import { createRobotRunStore } from './robot-run-store';
import { fakeSession } from './__fixtures__/fake-session';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';

// N19 E1: what the lab says politely when the held object changes: "Đã gắp khối đỏ" and "Đã thả khối đỏ", as events (never while the object
// is held), at most one in 1.5 s (a grip that slips and is taken again does not chatter: what is said is where it settles), and nothing
// for a run that begins, ends or is replaced, nor while a check holds the lab (it says its own rounds).

const live = (heldId: string | null, t = 1): GripMoment => ({ live: true, t, heldId });
const off: GripMoment = { live: false, t: 0, heldId: null };
const picked = (id: string) => ({ key: 'robot.announce.grip.picked', id });
const released = (id: string) => ({ key: 'robot.announce.grip.released', id });

describe('the grip announcer', () => {
  it('says a grip taken and a grip let go, once each, by the object’s id', () => {
    const grip = createGripAnnouncer();
    expect(grip.update(live(null, 1), 0)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 2), 100)).toEqual({ say: picked('cube'), retryAt: null });
    // While it is held, however long, nothing more.
    expect(grip.update(live('cube', 3), 400)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 9), 5000)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live(null, 10), 6000)).toEqual({ say: released('cube'), retryAt: null });
    expect(grip.update(live(null, 11), 9000)).toEqual({ say: null, retryAt: null });
  });

  it('says at most one in 1.5 s: a change inside the window waits for its end, and is said then if it still stands', () => {
    expect(GRIP_INTERVAL_MS).toBe(1500);
    const grip = createGripAnnouncer();
    expect(grip.update(live(null, 1), 0).say).toBeNull();
    expect(grip.update(live('cube', 2), 1000).say).toEqual(picked('cube'));
    // Let go 0.5 s after: inside the window, so it waits for 2500 ms (1000 + 1500).
    expect(grip.update(live(null, 3), 1500)).toEqual({ say: null, retryAt: 2500 });
    expect(grip.update(live(null, 3.1), 2499)).toEqual({ say: null, retryAt: 2500 });
    expect(grip.update(live(null, 3.2), 2500)).toEqual({ say: released('cube'), retryAt: null });
  });

  it('says nothing for a grip that was taken again inside the window: what the listener heard is still true', () => {
    const grip = createGripAnnouncer();
    grip.update(live(null, 1), 0);
    expect(grip.update(live('cube', 2), 1000).say).toEqual(picked('cube'));
    expect(grip.update(live(null, 3), 1200)).toEqual({ say: null, retryAt: 2500 });
    expect(grip.update(live('cube', 4), 1400)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 5), 2600)).toEqual({ say: null, retryAt: null });
  });

  it('says the object it settles on when it passes from one to another inside a look', () => {
    const grip = createGripAnnouncer();
    grip.update(live(null, 1), 0);
    grip.update(live('cube', 2), 0);
    expect(grip.update(live('base', 3), 2000)).toEqual({ say: picked('base'), retryAt: null });
    expect(grip.update(live(null, 4), 4000)).toEqual({ say: released('base'), retryAt: null });
  });

  it('a run that begins, ends or is replaced is no grip: nothing is said for what its first world holds or for the world going', () => {
    const grip = createGripAnnouncer();
    // A run that starts holding something (a replay of a state, a placed world) is no pick.
    expect(grip.update(live('cube', 0), 0)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 1), 100)).toEqual({ say: null, retryAt: null });
    // Time going back is a new world (Chạy again, Đặt lại robot): its first look is no event, though it holds nothing now.
    expect(grip.update(live(null, 0), 200)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 1), 300)).toEqual({ say: picked('cube'), retryAt: null });
    // The run is over and gone (idle, Dừng, Đặt lại, a check): nothing is said, and the next run starts clean.
    expect(grip.update(off, 5000)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live(null, 0), 5100)).toEqual({ say: null, retryAt: null });
    expect(grip.update(live('cube', 1), 5200)).toEqual({ say: picked('cube'), retryAt: null });
  });

  it('is silent while a check holds the lab and says its first grip afterwards at once', () => {
    const grip = createGripAnnouncer();
    grip.update(live(null, 1), 0);
    expect(grip.update(live('cube', 2), 10).say).toEqual(picked('cube'));
    expect(grip.update({ ...off }, 20).say).toBeNull();
    expect(grip.update(live(null, 0), 30).say).toBeNull();
    // The window of the grip said before the check does not hold this one back.
    expect(grip.update(live('cube', 1), 40).say).toEqual(picked('cube'));
  });
});

describe('gripMomentOf', () => {
  const kit = productionKits.get(referenceKitRef) as Kit;
  const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
  /** The store's state with a running snapshot of `world` (the snapshot the lab shows). */
  const running = (world: RobotSnapshot | null) => {
    const fake = fakeSession(scenario, kit);
    const state = createRobotRunStore(fake.session, { requestFrame: () => 0, cancelFrame: () => {} }).getState();
    return { fake, state: { ...state, snapshot: { ...state.snapshot, status: 'running' as const, world } } };
  };
  const holding = (world: RobotSnapshot, heldId: string | null): RobotSnapshot => ({ ...world, robot: { ...world.robot, gripper: { clawDeg: 27, liftDeg: 60, heldId } } });

  it('is not live before a run, and reads the held id and the time of the run’s world', () => {
    const { fake, state } = running(null);
    expect(gripMomentOf({ ...state, snapshot: fake.session.getSnapshot() })).toEqual({ live: false, t: 0, heldId: null });
    const world = fake.world(2);
    expect(gripMomentOf(running(holding(world, 'cube')).state)).toEqual({ live: true, t: 2, heldId: 'cube' });
    expect(gripMomentOf(running(holding(world, null)).state)).toEqual({ live: true, t: 2, heldId: null });
  });

  it('is not live while a check holds the lab or a start builds its world; a robot with no gripper holds nothing', () => {
    const { fake, state } = running(null);
    const world = fake.world(1);
    const on = { ...state, snapshot: { ...state.snapshot, world } };
    expect(gripMomentOf(on)).toEqual({ live: true, t: 1, heldId: null });
    expect(gripMomentOf(on, true)).toEqual({ live: false, t: 0, heldId: null });
    expect(gripMomentOf({ ...on, locked: true }).live).toBe(false);
    expect(gripMomentOf({ ...on, starting: true }).live).toBe(false);
  });
});
