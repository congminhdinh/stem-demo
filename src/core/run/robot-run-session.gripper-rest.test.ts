import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, unoR3Board, type Kit } from '../hardware';
import { registry } from '../program/__fixtures__/uno-blocks';
import { initPhysics } from '../world/rapier';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { createRobotRunSession } from './robot-run-session';

// N19 B7 (plan §4.17): every gripper lesson's end state, in the run session the lab's Chạy uses (variant 0, headless): once the reference's
// program has finished and the car has settled (2 s), it does not turn or drift over 10 s, under the brief's bounds (1e-4 °/s, 1e-4 cm/s).
// Before B7 rb-grip-stack's car turned at 0.0102 °/s there (its arm held at 55° by the lift servo's motor; spikes/n19-b7/results.md), which made
// the 3D scene redraw 10 times a second (E9). The snapshot's pose is what the view draws: its yaw (dmath atan2) and its x, y.

beforeAll(() => initPhysics(), 30_000);

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const KEYS = ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'] as const;

describe('a stopped gripper car does not creep (N19 B7): each lesson’s end state', () => {
  it.each(KEYS.map((key) => [key] as const))('%s: the reference’s car, 2 s after its program finished, over 10 s', async (key) => {
    const scenario = scenarioCatalog.get(key)!;
    const session = createRobotRunSession({ scenario, kit: gripperKit, board: unoR3Board, registry });
    try {
      expect(await session.start({ ...robotStarterDocument(key), program: { blocks: structuredClone(robotSolutions[key].reference) } })).toEqual({ ok: true });
      let t = 0;
      while (session.getSnapshot().status !== 'finished' && t < scenario.timeLimitS) {
        t = Math.round((t + 0.1) * 10) / 10;
        await session.runUntil(t);
      }
      expect(session.getSnapshot().status).toBe('finished');
      // The program finished: the run goes on to the time limit (the motors as the pins say: stopped).
      expect(session.getSnapshot().end ?? null).toBeNull();
      await session.runUntil(t + 2);
      const before = session.getSnapshot().world!;
      await session.runUntil(t + 12);
      const after = session.getSnapshot().world!;
      expect(after.t - before.t).toBeCloseTo(10, 6);
      expect(Math.abs(after.robot.yawDeg - before.robot.yawDeg) / 10).toBeLessThan(1e-4);
      expect(Math.hypot(after.robot.xCm - before.robot.xCm, after.robot.yCm - before.robot.yCm) / 10).toBeLessThan(1e-4);
    } finally {
      session.stop();
    }
  }, 120_000);
});
