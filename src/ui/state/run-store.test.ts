import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectDocumentSchema } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { createRunSession } from '../../core/run/run-session';
import ledOnSample from '../../samples/led-on.project.json';
import { createRunStore, selectIsRunning } from './run-store';

const registry = createDeviceRegistry(localDeviceDefinitions);
const ledOn = projectDocumentSchema.parse(ledOnSample);

/** A runStore whose animation frames run only when the test says so. */
function setup() {
  const session = createRunSession(registry);
  const frames: (() => void)[] = [];
  const store = createRunStore(session, (callback) => frames.push(callback));
  const renderFrame = () => frames.splice(0).forEach((callback) => callback());
  return { session, store, frames, renderFrame };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('runStore', () => {
  it('hands React at most one snapshot per animation frame: the latest', async () => {
    const { session, store, frames, renderFrame } = setup();
    let snapshotUpdates = 0;
    store.subscribe((state, previous) => {
      if (state.snapshot !== previous.snapshot) {
        snapshotUpdates++;
      }
    });

    store.getState().run(ledOn);
    await vi.advanceTimersByTimeAsync(0);

    // Running, the D13 write and finished were published within one frame.
    expect(session.getSnapshot().status).toBe('finished');
    expect(store.getState().snapshot.status).toBe('idle');
    expect(frames).toHaveLength(1);

    renderFrame();
    expect(store.getState().snapshot).toBe(session.getSnapshot());
    expect(snapshotUpdates).toBe(1);
  });

  it('keeps why a Run did not start until a Run starts', () => {
    const { store } = setup();
    const unknownPin = {
      ...ledOn,
      program: { blocks: JSON.parse(JSON.stringify(ledOn.program.blocks).replace('"D13"', '"D99"')) },
    };

    store.getState().run(unknownPin);
    expect(store.getState().startFailure).toMatchObject({ ok: false, reason: 'compile-error' });

    store.getState().run(ledOn);
    expect(store.getState().startFailure).toBeNull();
  });

  it('forgets why a Run did not start on clearStartFailure, without touching the session', () => {
    const { session, store, frames } = setup();
    store.getState().run({ ...ledOn, circuit: { components: [], wires: [] } });
    expect(store.getState().startFailure).toMatchObject({ ok: false, reason: 'no-board' });

    store.getState().clearStartFailure();

    expect(store.getState().startFailure).toBeNull();
    expect(session.getSnapshot().status).toBe('idle');
    expect(selectIsRunning(store.getState())).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('counts a finished program as running until Stop (the board stays powered)', async () => {
    const { store, renderFrame } = setup();
    expect(selectIsRunning(store.getState())).toBe(false);

    store.getState().run(ledOn);
    await vi.advanceTimersByTimeAsync(0);
    renderFrame();
    expect(store.getState().snapshot.status).toBe('finished');
    expect(selectIsRunning(store.getState())).toBe(true);

    store.getState().stop();
    renderFrame();
    expect(selectIsRunning(store.getState())).toBe(false);
  });

  it('switches the edit lock at once on Run and on Stop, without waiting for a frame', () => {
    const { store, frames } = setup();

    store.getState().run(ledOn);
    expect(selectIsRunning(store.getState())).toBe(true);
    expect(store.getState().snapshot.status).toBe('idle'); // the snapshot still waits for its frame

    store.getState().stop();
    expect(selectIsRunning(store.getState())).toBe(false);
    expect(frames).toHaveLength(1);
  });
});
