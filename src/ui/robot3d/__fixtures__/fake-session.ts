import { vi } from 'vitest';
import type { Kit } from '../../../core/hardware/kit';
import type { RobotRunSession, RobotRunSnapshot, RobotStartResult } from '../../../core/run/robot-run-session';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { idleSnapshot } from '../scene-math';

// A RobotRunSession that runs nothing by itself (N18 R4.2 tests): the test publishes the snapshots it wants and sees every call.

export const idleRun: RobotRunSnapshot = { status: 'idle', diagnostics: [], error: null, console: { lines: [], hidden: 0 }, world: null, slowerThanRealtime: false };

export function fakeSession(scenario: Scenario, kit: Kit) {
  let snapshot = idleRun;
  const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();
  const advances: [number, number][] = [];
  let startResult: Promise<RobotStartResult> = Promise.resolve({ ok: true });
  const publish = (next: Partial<RobotRunSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener(snapshot));
  };
  const start = idleSnapshot(scenario, kit);
  /** A world at `t` with the robot at `xCm`, running, and whatever else is given. */
  const world = (t: number, xCm = start.robot.xCm, changes: Partial<RobotSnapshot> = {}): RobotSnapshot => ({ ...start, t, status: 'running', robot: { ...start.robot, xCm }, ...changes });
  const session = {
    start: vi.fn(async () => {
      const result = await startResult;
      if (result.ok) publish({ status: 'running', world: world(0) });
      return result;
    }),
    stop: vi.fn(() => publish(idleRun)),
    advance: vi.fn(async (wallMs: number, speed = 1) => {
      advances.push([wallMs, speed]);
    }),
    runUntil: vi.fn(async () => {}),
    resetRobot: vi.fn(async (): Promise<RobotStartResult> => {
      publish({ status: 'running', world: world(0) });
      return { ok: true };
    }),
    pressButton: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: RobotRunSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies RobotRunSession;
  return {
    session,
    advances,
    publish,
    world,
    willStart(result: Promise<RobotStartResult>) {
      startResult = result;
    },
  };
}
