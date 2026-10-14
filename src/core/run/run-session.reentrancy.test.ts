import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { program } from '../program/__fixtures__/ybc-blocks';
import { createRunSession, type RunEnvironment, type RunSession, type RunSnapshot } from './run-session';

// YBCP-R4: the session may be re-entered while a run is retired. Aborting a run runs its abort handlers; a handler
// may write to the console (RuntimeServices.console, a supported service), which notifies the listeners
// synchronously, and a listener may call `start` or `stop`: the latest call wins (plan §6.4). The operation that
// began retiring run A must act only on A, and must not touch what the reentrant call established.

const registry = createDeviceRegistry(localDeviceDefinitions);
/** A program that keeps running (an empty forever), so a run stays alive until it is stopped. */
const running = () => fixtureDocument('ybc-basic', { blocks: program([], []) });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A session whose runs each write "cleanup" to their console when they are aborted. */
function setup() {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(registry, {
    capabilities: (environment) => {
      environments.push(environment);
      environment.services.signal.addEventListener('abort', () => environment.services.console.write('cleanup'));
      return {};
    },
  });
  const published: RunSnapshot[] = [];
  session.subscribe((snapshot) => published.push(snapshot));
  return { session, environments, published };
}

/** Starts a run and reads its snapshot once, so the next console write is a new notice (one notice per burst). */
async function startRun(session: RunSession) {
  expect(session.start(running())).toEqual({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  session.getSnapshot();
}

const env = (environments: RunEnvironment[], index: number) => environments[index] as RunEnvironment;

describe('a listener that stops while the session is stopping', () => {
  it('does not throw, retires the run once, and leaves the session idle', async () => {
    const { session, environments, published } = setup();
    await startRun(session);
    const a = env(environments, 0).services;
    const disposeA = vi.spyOn(a.scheduler, 'dispose');

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        session.stop();
      }
    });
    const before = published.length;

    expect(() => session.stop()).not.toThrow();

    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    expect(() => a.budget.step()).toThrow();
    expect(disposeA).toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    // Exactly one idle was published: the inner stop's. The outer stop did not publish it again.
    expect(published.slice(before).filter((snapshot) => snapshot.status === 'idle')).toHaveLength(1);
    // Nothing is current any more: another stop is a no-op, and a new run starts normally.
    expect(() => session.stop()).not.toThrow();
    expect(session.start(running())).toEqual({ ok: true });
    session.stop();
  });
});

describe('a listener that starts while the session is stopping', () => {
  it('keeps the new run: not disposed, not aborted, not published over', async () => {
    const { session, environments, published } = setup();
    await startRun(session);
    const a = env(environments, 0).services;

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(running())).toEqual({ ok: true });
      }
    });
    const before = published.length;

    expect(() => session.stop()).not.toThrow();

    // Run A is retired.
    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    // Run B owns the session, with its own services, all alive.
    expect(environments).toHaveLength(2);
    const b = env(environments, 1).services;
    expect(b).not.toBe(a);
    expect(b.signal.aborted).toBe(false);
    expect(b.scheduler.disposed).toBe(false);
    expect(b.budget.step()).toBeUndefined();
    // The outer stop did not publish idle over B: the last thing published and the current snapshot are B's.
    const after = published.slice(before);
    expect(after.some((snapshot) => snapshot.status === 'idle')).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ status: 'running' });
    expect(after.at(-1)?.status).toBe('running');

    // B is a normal run: it still ticks, and it can be stopped.
    const task = vi.fn();
    b.scheduler.schedule(task, 20);
    await vi.advanceTimersByTimeAsync(30);
    expect(task).toHaveBeenCalledTimes(1);
    session.stop();
    expect(b.signal.aborted).toBe(true);
    expect(session.getSnapshot().status).toBe('idle');
  });
});

describe('a listener that acts while a run is being replaced', () => {
  it('start(C) during start(B): the later call wins, B is discarded, C stands', async () => {
    const { session, environments } = setup();
    await startRun(session);
    const a = env(environments, 0).services;

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(running())).toEqual({ ok: true });
      }
    });

    expect(session.start(running())).toEqual({ ok: true });

    // Factories ran for A, then B (prepared by the outer start), then C (the reentrant start).
    expect(environments).toHaveLength(3);
    const [b, c] = [env(environments, 1).services, env(environments, 2).services];
    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    // B was never run: its prepared services are cancelled, and it never overwrote C.
    expect(b.signal.aborted).toBe(true);
    expect(b.scheduler.disposed).toBe(true);
    expect(c.signal.aborted).toBe(false);
    expect(c.scheduler.disposed).toBe(false);
    expect(c.budget.step()).toBeUndefined();
    expect(session.getSnapshot().status).toBe('running');

    // C is the current run: Stop ends C, and only C.
    session.stop();
    expect(c.signal.aborted).toBe(true);
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('stop() during start(B): the later call wins, B is discarded and the session is idle', async () => {
    const { session, environments } = setup();
    await startRun(session);

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        session.stop();
      }
    });

    expect(session.start(running())).toEqual({ ok: true });

    const b = env(environments, 1).services;
    expect(b.signal.aborted).toBe(true);
    expect(b.scheduler.disposed).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    // The session is usable afterwards.
    expect(session.start(running())).toEqual({ ok: true });
    session.stop();
  });
});

describe('the ordinary lifecycle is unchanged', () => {
  it('stops a run once: signal aborted, scheduler disposed, one idle snapshot, its console shows the cleanup line', async () => {
    const { session, environments, published } = setup();
    await startRun(session);
    const a = env(environments, 0).services;
    const before = published.length;
    session.stop();
    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    expect(session.getSnapshot().status).toBe('idle');
    // The abort handler's write notified once, then idle: nothing else.
    expect(published.slice(before).map((snapshot) => snapshot.status)).toEqual(['running', 'idle']);
  });

  it('replaces a run: the old one is retired, the new one is alive, no idle in between', async () => {
    const { session, environments, published } = setup();
    await startRun(session);
    const before = published.length;
    expect(session.start(running())).toEqual({ ok: true });
    const [a, b] = [env(environments, 0).services, env(environments, 1).services];
    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(published.slice(before).some((snapshot) => snapshot.status === 'idle')).toBe(false);
    expect(session.getSnapshot().status).toBe('running');
    session.stop();
  });
});
