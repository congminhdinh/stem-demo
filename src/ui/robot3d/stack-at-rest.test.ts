import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board, type Kit } from '../../core/hardware';
import { registry } from '../../core/program/__fixtures__/uno-blocks';
import { createRobotRunSession } from '../../core/run/robot-run-session';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { sameView } from './scene-math';
import { sameSensorView } from './sensor-overlay-math';
import { sameTopView } from './top-view-math';

// N19 B7 (plan §4.17): N18 P2's rule, "a robot at rest draws nothing", for the end of rb-grip-stack, the lesson E9's bench found drawing 10
// frames a second at rest (e910-report concern 1: its car turned at 0.0102 °/s after its program's `stop`, each publish moving the
// quaternion past the scene's SAME_QUAT). The lab's Chạy at 1×, 60 frames a second: from 2 s after the program finished (the window of E9's
// spikes/n19-e9/rest-draws.mjs; the car stops within 0.1 s of it and its lift holds 1 s later, gripper.ts), 10 s of publishes (the HUD
// clock's rest pace, ten a second), none of which the 3D scene (Scene.tsx RedrawOnChange), its overlays or the 2D map calls a change of the
// picture it last drew. Before B7: 49 scene redraws (two frames each) in those 10 s.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

describe('rb-grip-stack at rest publishes no change (N19 B7)', () => {
  it('the reference, 2 s after its program finished: no change on any publish over 10 s', async () => {
    const key = 'rb-grip-stack';
    const session = createRobotRunSession({ scenario: scenarioCatalog.get(key)!, kit: gripperKit, board: unoR3Board, registry });
    const seen: RobotSnapshot[] = [];
    let finishedAtS: number | null = null;
    session.subscribe((snapshot) => {
      if (snapshot.world === null) return;
      seen.push(snapshot.world);
      if (finishedAtS === null && snapshot.status === 'finished') finishedAtS = snapshot.world.t;
    });
    try {
      expect(await session.start({ ...robotStarterDocument(key), program: { blocks: structuredClone(robotSolutions[key].reference) } })).toEqual({ ok: true });
      for (let frame = 0; frame < 60 * 30 && (finishedAtS === null || seen.at(-1)!.t < finishedAtS + 12); frame++) await session.advance(1000 / 60, 1);
    } finally {
      session.stop();
    }
    expect(finishedAtS).not.toBeNull();
    const from = finishedAtS! + 2;
    const rest = seen.filter((world) => world.t >= from && world.t <= from + 10);
    expect(rest.length).toBeGreaterThanOrEqual(95);
    expect(rest.at(-1)!.robot.gripper).toMatchObject({ heldId: null });
    // Each view against the picture it last drew, as Scene.tsx's RedrawOnChange keeps `shown`: a creep under a threshold per publish still
    // redraws once it adds up past it.
    const redraws = (same: (a: RobotSnapshot, b: RobotSnapshot) => boolean) => {
      let shown = rest[0]!;
      let count = 0;
      for (const next of rest.slice(1)) {
        if (same(shown, next)) continue;
        count += 1;
        shown = next;
      }
      return count;
    };
    const scene = redraws(sameView);
    const overlay = redraws((a, b) => sameSensorView(a, b, []));
    const map = redraws((a, b) => sameTopView(a, b) && sameSensorView(a, b, []));
    expect({ scene, overlay, map }).toEqual({ scene: 0, overlay: 0, map: 0 });
  }, 120_000);
});
