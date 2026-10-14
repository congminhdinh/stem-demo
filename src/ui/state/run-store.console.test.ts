import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { fixtureDocument } from '../../core/profiles/__fixtures__/test-profiles';
import { num, print, program, repeat } from '../../core/program/__fixtures__/ybc-blocks';
import { createRunSession } from '../../core/run/run-session';
import { createRunStore } from './run-store';

// A print-heavy loop (YB plan section 6.7: at most one UI commit per frame): the store reads the
// session once per frame, however many lines the program printed in between.

const registry = createDeviceRegistry(localDeviceDefinitions);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('run store with a print-heavy YBC loop', () => {
  it('reads the session once per frame, not once per print', async () => {
    const session = createRunSession(registry);
    let reads = 0;
    const counted = {
      ...session,
      getSnapshot: () => {
        reads++;
        return session.getSnapshot();
      },
    };
    const frames: (() => void)[] = [];
    const store = createRunStore(counted, (callback) => frames.push(callback));
    let commits = 0;
    store.subscribe(() => commits++);
    const readsBefore = reads;

    store.getState().run(fixtureDocument('ybc-basic', { blocks: program([repeat(num(10_000), [print(num(1))])], undefined, []) }));
    await vi.advanceTimersByTimeAsync(100);

    // Nothing was read while the program ran: the frame has not come yet.
    expect(frames.length).toBeLessThanOrEqual(1);
    expect(reads - readsBefore).toBe(0);

    frames.splice(0).forEach((frame) => frame());
    expect(reads - readsBefore).toBe(1);
    expect(store.getState().snapshot.console?.lines).toHaveLength(500);
    expect(store.getState().snapshot.console?.hidden).toBe(9_500);
    // running, the start result, and the one frame: 10 000 prints did not add commits
    expect(commits).toBeLessThanOrEqual(3);
  });
});
