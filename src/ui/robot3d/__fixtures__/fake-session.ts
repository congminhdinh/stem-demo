import { vi } from 'vitest';
import type { Kit } from '../../../core/hardware/kit';
import type { RobotPlaceResult, RobotRunSession, RobotRunSnapshot, RobotStartResult, RobotTeleopResult } from '../../../core/run/robot-run-session';
import type { TeleopCommand } from '../../../core/run/teleop';
import type { Scenario } from '../../../core/scenario/scenario';
import type { PlacementPose } from '../../../core/scenario/placement';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import type { CheckRunView } from '../robot-run-store';
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
      // A program's run, never teleop's (N18 R4.8), and a new one: what the one before ended in does not carry over (bt-lab-fix, m1).
      if (result.ok) publish({ status: 'running', world: world(0), teleop: undefined, end: undefined });
      return result;
    }),
    stop: vi.fn(() => publish(idleRun)),
    advance: vi.fn(async (wallMs: number, speed = 1) => {
      advances.push([wallMs, speed]);
    }),
    runUntil: vi.fn(async () => {}),
    resetRobot: vi.fn(async (): Promise<RobotStartResult> => {
      publish({ status: 'running', world: world(0), end: undefined });
      return { ok: true };
    }),
    pressButton: vi.fn(),
    // N18 R4.8: teleop is a run marked `teleop`; its commands are only recorded; a placement is taken as given.
    startTeleop: vi.fn(async (): Promise<RobotTeleopResult> => {
      publish({ status: 'running', world: world(0), teleop: true, end: undefined });
      return { ok: true };
    }),
    teleop: vi.fn((command: TeleopCommand) => void command),
    stopTeleop: vi.fn(() => {
      if (snapshot.teleop) publish(idleRun);
    }),
    teleopLog: () => [],
    placeRobot: vi.fn(async (pose: PlacementPose | null): Promise<RobotPlaceResult> => ({ ok: true, pose: pose ?? { ...scenario.start } })),
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: RobotRunSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // N18 P2: the physics engine's warm-up, recorded only.
    preparePhysics: vi.fn(async () => true),
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

/** N18 R6.3: a check's run as the lab's view shows it (`store.attach`): the test publishes the snapshots it wants. */
export function fakeCheckView() {
  let snapshot = idleRun;
  const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();
  const view: CheckRunView = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    frame: vi.fn(async () => {}),
  };
  return {
    view,
    publish(next: Partial<RobotRunSnapshot>) {
      snapshot = { ...snapshot, ...next };
      listeners.forEach((listener) => listener(snapshot));
    },
  };
}
