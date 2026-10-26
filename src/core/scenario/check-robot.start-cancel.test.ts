import { afterEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../program/__fixtures__/uno-blocks';
import { rover, unoR3Board } from '../run/__fixtures__/robot-session';
import type { World } from '../world/world';
import { parker, parkScenario } from './__fixtures__/check-cases';
import { checkRobot, type CheckProgress } from './check-robot';

// N18 final fix M7: "Dừng kiểm tra" while the check's first world is still being built (a slow school network: the 1.18 MB of Rapier's
// wasm not here yet). The world is the test's: a promise it settles when it says, or never. The cancel gives no result at once, so the lab
// unlocks; the world that arrives later is disposed, and nothing of it runs.

const building = vi.hoisted(() => ({ worlds: [] as { resolve(world: unknown): void; reject(error: unknown): void }[] }));

vi.mock('../world/world', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../world/world')>()),
  createScenarioWorld: () =>
    new Promise((resolve, reject) => {
      building.worlds.push({ resolve, reject });
    }),
}));

afterEach(() => {
  building.worlds.length = 0;
});

/** The check's result, or `pending` if it has none within a few turns of the event loop. */
const settledSoon = <T,>(promise: Promise<T>) => Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50))]);

describe('Dừng kiểm tra while the first world is being built (N18 final fix M7)', () => {
  it.each(['headless', 'realtime'] as const)('%s: a world that never comes still gives null at once, and the progress ends', async (mode) => {
    const told: CheckProgress[] = [];
    const check = checkRobot(parker(), parkScenario(), { mode, kit: rover, board: unoR3Board, registry, onProgress: (progress) => told.push(progress) });
    await vi.waitFor(() => expect(building.worlds).toHaveLength(1));
    expect(told).toEqual([{ kind: 'variant-started', index: 0, count: 3, seed: 11 }]);
    // The start is suspended in the world: without a cancel, the check waits for it.
    expect(await settledSoon(check.result)).toBe('pending');
    check.cancel();
    expect(await settledSoon(check.result)).toBeNull();
    const seen: CheckProgress[] = [];
    for await (const progress of check.progress) seen.push(progress);
    expect(seen).toEqual(told);
    expect(check.run.getSnapshot().status).toBe('idle');
  });

  it('disposes the world that comes after the cancel, and runs nothing in it; one that fails after it is no error', async () => {
    const check = checkRobot(parker(), parkScenario(), { mode: 'headless', kit: rover, board: unoR3Board, registry });
    await vi.waitFor(() => expect(building.worlds).toHaveLength(1));
    check.cancel();
    expect(await check.result).toBeNull();
    const dispose = vi.fn();
    const step = vi.fn();
    building.worlds[0]!.resolve({ dispose, step } as unknown as World);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(step).not.toHaveBeenCalled();
    expect(check.run.getSnapshot()).toMatchObject({ status: 'idle', world: null });

    const failing = checkRobot(parker(), parkScenario(), { mode: 'headless', kit: rover, board: unoR3Board, registry });
    await vi.waitFor(() => expect(building.worlds).toHaveLength(2));
    failing.cancel();
    expect(await failing.result).toBeNull();
    building.worlds[1]!.reject(new Error('the wasm did not load'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failing.run.getSnapshot().status).toBe('idle');
  });
});
