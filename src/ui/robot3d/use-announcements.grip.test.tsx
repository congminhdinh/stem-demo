// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import pickPlace from '../../core/scenario/__fixtures__/pick-place.scenario.json';
import { loadScenario } from '../../core/scenario/scenario';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { createAnnouncer, type Announcer } from './announcer';
import type { RobotCheckStore } from './robot-check-store';
import { createRobotRunStore, type RobotRunStore } from './robot-run-store';
import { useRunAnnouncements } from './use-announcements';

// N19 E1: the hook that tells the announcer about the run also says a grip: "Đã gắp khối đỏ." and "Đã thả khối đỏ.", the object named as the
// check's report names it (check-report.ts objectName, in that round's colour), at most one in 1.5 s, silently for a run that begins or a check.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const naming = loadScenario(pickPlace);

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** Animation frames that run only when the test says so. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => void pending.delete(handle),
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

/** A check store that is running or not: all the hook asks of it. */
const checkStore = (running: () => boolean) => ({ getState: () => ({ running: running() ? {} : null }), subscribe: () => () => {} }) as unknown as RobotCheckStore;

function Probe({ store, checks, announcer, locale = 'vi', clock }: { store: RobotRunStore; checks: RobotCheckStore; announcer: Announcer; locale?: 'vi' | 'en'; clock: () => number }) {
  return (
    <TextProvider locale={locale}>
      <Said store={store} checks={checks} announcer={announcer} clock={clock} />
    </TextProvider>
  );
}
function Said({ store, checks, announcer, clock }: { store: RobotRunStore; checks: RobotCheckStore; announcer: Announcer; clock: () => number }) {
  useRunAnnouncements(store, checks, announcer, undefined, { scenario: naming, now: clock });
  return null;
}

async function setup(locale: 'vi' | 'en' = 'vi') {
  const fake = fakeSession(scenario, kit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  store.getState().connect();
  const announcer = createAnnouncer();
  let ms = 0;
  let checking = false;
  await act(async () => root.render(<Probe store={store} checks={checkStore(() => checking)} announcer={announcer} locale={locale} clock={() => ms} />));
  const holding = (t: number, heldId: string | null): RobotSnapshot => {
    const world = fake.world(t);
    return { ...world, robot: { ...world.robot, gripper: { clawDeg: 27, liftDeg: 60, heldId } } };
  };
  /** The world at `t` s holding `heldId`, handed to the store at a frame, `at` ms on the clock. */
  const show = async (t: number, heldId: string | null, at: number) => {
    ms = at;
    await act(async () => {
      fake.publish({ status: 'running', world: holding(t, heldId) });
      frames.frame(at);
    });
    await act(async () => void (await Promise.resolve()));
  };
  /** What the polite region was told, in order (the run's own words too: "Đã bắt đầu chạy." when the run starts). */
  const heard: string[] = [];
  announcer.polite.subscribe((message) => void heard.push(message.text));
  return { ...fake, frames, store, announcer, show, heard, clock: (at: number) => void (ms = at), check: (on: boolean) => void (checking = on), holding };
}

const STARTED = 'Đã bắt đầu chạy.';

describe('the lab says a grip (N19 E1)', () => {
  it('says "Đã gắp khối đỏ." when the gripper takes the cube and "Đã thả khối đỏ." when it lets go', async () => {
    const { show, heard } = await setup();
    // The run's first world is no grip.
    await show(0, null, 0);
    expect(heard).toEqual([STARTED]);
    await show(2, 'cube', 2000);
    expect(heard).toEqual([STARTED, 'Đã gắp khối đỏ.']);
    // Held, and the time moves: nothing more.
    await show(3, 'cube', 3000);
    await show(4, 'cube', 4000);
    expect(heard).toHaveLength(2);
    await show(5, null, 5000);
    expect(heard).toEqual([STARTED, 'Đã gắp khối đỏ.', 'Đã thả khối đỏ.']);
  });

  it('names it as the check’s report does: its colour in the round the view shows, a base by its colour, a parcel by its number', async () => {
    const { show, heard, store } = await setup();
    await show(0, null, 0);
    await act(async () => store.getState().setRound({ index: 1, count: 3, score: null }));
    await show(2, 'cube', 2000);
    await show(4, 'base', 4000);
    await show(6, 'parcel-2', 6000);
    await show(8, 'parcel-2', 8000);
    await show(10, null, 10000);
    expect(heard.slice(1)).toEqual(['Đã gắp khối xanh lá.', 'Đã gắp bệ vàng.', 'Đã gắp kiện hàng 2.', 'Đã thả kiện hàng 2.']);
  });

  it('says it in English', async () => {
    const { show, heard } = await setup('en');
    await show(0, null, 0);
    await show(2, 'cube', 2000);
    await show(4, null, 4000);
    expect(heard.slice(1)).toEqual(['Picked up the red cube.', 'Put down the red cube.']);
  });

  it('says at most one in 1.5 s: a let-go 0.5 s after the grip is said when the window ends, by a timer, if it still stands', async () => {
    vi.useFakeTimers();
    const { show, heard, clock } = await setup();
    await show(0, null, 0);
    await show(1, 'cube', 1000);
    expect(heard.slice(1)).toEqual(['Đã gắp khối đỏ.']);
    await show(1.5, null, 1500);
    expect(heard.slice(1)).toEqual(['Đã gắp khối đỏ.']);
    clock(2500);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(heard.slice(1)).toEqual(['Đã gắp khối đỏ.', 'Đã thả khối đỏ.']);
  });

  it('says nothing for a grip taken again inside the window, and the timer finds nothing to say', async () => {
    vi.useFakeTimers();
    const { show, heard, clock } = await setup();
    await show(0, null, 0);
    await show(1, 'cube', 1000);
    await show(1.2, null, 1200);
    await show(1.4, 'cube', 1400);
    clock(2600);
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(heard.slice(1)).toEqual(['Đã gắp khối đỏ.']);
  });

  it('says nothing when the run is stopped or put back while it holds the cube, nor for the next run’s start', async () => {
    const { show, heard, session, publish, frames, world } = await setup();
    await show(0, null, 0);
    await show(2, 'cube', 2000);
    expect(heard.slice(1)).toEqual(['Đã gắp khối đỏ.']);
    // Dừng: the session is idle and the lab keeps what it left.
    await act(async () => {
      session.stop();
      frames.frame(2100);
    });
    await act(async () => void (await Promise.resolve()));
    // A new run holds nothing at t = 0: no "Đã thả".
    await act(async () => {
      publish({ status: 'running', world: world(0) });
      frames.frame(9000);
    });
    await act(async () => void (await Promise.resolve()));
    expect(heard.filter((text) => text.includes('thả'))).toEqual([]);
    expect(heard.filter((text) => text.includes('gắp'))).toEqual(['Đã gắp khối đỏ.']);
  });

  it('is silent while a check is under way: it says its own rounds', async () => {
    const { show, heard, check } = await setup();
    await show(0, null, 0);
    check(true);
    await show(2, 'cube', 2000);
    await show(4, null, 4000);
    expect(heard.slice(1)).toEqual([]);
  });
});
