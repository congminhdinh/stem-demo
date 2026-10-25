import { vi } from 'vitest';
import type { RobotRunSnapshot } from '../../../core/run/robot-run-session';
import type { CheckProgress, RobotCheck } from '../../../core/scenario/check-robot';
import type { RobotCheckResult } from '../../../core/scenario/check-result';
import type { CreateCheck } from '../robot-check-store';
import { idleRun } from './fake-session';

// A robot check that does nothing by itself (N18 R6.3 tests): the test tells its progress, publishes its run's snapshots and settles it.

export function fakeCheck() {
  let settle: (result: RobotCheckResult | null) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const result = new Promise<RobotCheckResult | null>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let snapshot: RobotRunSnapshot = idleRun;
  const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();
  const frames: [number, number | undefined][] = [];
  const check: RobotCheck = {
    progress: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
    result,
    cancel: vi.fn(() => settle(null)),
    frame: vi.fn(async (wallMs: number, speed?: number) => {
      frames.push([wallMs, speed]);
    }),
    run: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return {
    check,
    frames,
    settle,
    fail,
    publish(next: Partial<RobotRunSnapshot>) {
      snapshot = { ...snapshot, ...next };
      listeners.forEach((listener) => listener(snapshot));
    },
  };
}

export type FakeCheck = ReturnType<typeof fakeCheck>;

/** A `CreateCheck` that makes a fake check each time and keeps what it was asked. */
export function fakeChecks() {
  const made: { check: FakeCheck; project: unknown; mode: string; speed: number; onProgress: (progress: CheckProgress) => void }[] = [];
  const createCheck: CreateCheck = (project, mode, speed, onProgress) => {
    const check = fakeCheck();
    made.push({ check, project, mode, speed, onProgress });
    return check.check;
  };
  return { createCheck, made, last: () => made[made.length - 1]! };
}
