// N19 B3/B4 review M1 (spike, the hand-off to E5): how often the sensor overlays redraw while a finished run rests, rover against gripper
// car. Run it from tests/ (vitest includes only src/** and tests/**):
//
//   cp spikes/n19-b34/redraw-at-rest.test.ts tests/zz-redraw.test.ts && sed -i '' "s#'\.\./\.\./src/#'../src/#g" tests/zz-redraw.test.ts \
//     && pnpm exec vitest run tests/zz-redraw.test.ts; rm tests/zz-redraw.test.ts
//
// It prints one JSON line per kit: the publishes at rest (t ≥ 3 s of 10 s at 1×, 60 frames a second), and how many of them `sameSensorView`
// (SensorOverlay.tsx asks invalidate(2)) and `sameTopView && sameSensorView` (TopViewSensors.tsx redraws its layer) call a change.

import { beforeAll, it } from 'vitest';
import { productionKits, referenceKitRef, unoR3Board, type Kit } from '../../src/core/hardware';
import { claw, driveMove, driveStop, lift, registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { num, wait } from '../../src/core/program/__fixtures__/ybc-blocks';
import { robotProject, sandboxScenario } from '../../src/core/run/__fixtures__/robot-session';
import { createRobotRunSession, type RobotRunSnapshot } from '../../src/core/run/robot-run-session';
import { initPhysics } from '../../src/core/world/rapier';
import { sameSensorView } from '../../src/ui/robot3d/sensor-overlay-math';
import { sameView } from '../../src/ui/robot3d/scene-math';
import { sameTopView } from '../../src/ui/robot3d/top-view-math';

beforeAll(() => initPhysics(), 30_000);

for (const kitRef of [referenceKitRef, { id: 'ref-uno-gripper', version: '0' }]) {
  it(`redraws at rest: ${kitRef.id}`, async () => {
    const kit = productionKits.get(kitRef) as Kit;
    const floor = sandboxScenario({ sizeCm: [200, 100], start: { xCm: 40, yCm: 50, yawDeg: 0 } });
    const session = createRobotRunSession({ scenario: { ...floor, kit: kit.id }, kit, board: unoR3Board, registry });
    const program =
      kit.id === 'ref-uno-gripper'
        ? [lift('DOWN'), claw('OPEN'), wait(num(300)), driveMove('forward', num(50)), wait(num(500)), driveStop()]
        : [driveMove('forward', num(50)), wait(num(800)), driveStop()];
    const seen: RobotRunSnapshot[] = [];
    session.subscribe((snapshot) => void seen.push(snapshot));
    await session.start(robotProject(program, undefined, { kit: kitRef }));
    for (let i = 0; i < 600; i++) await session.advance(1000 / 60, 1);
    const rest = seen.map((snapshot) => snapshot.world).filter((world) => world !== null && world.t >= 3);
    let overlay = 0;
    let scene = 0;
    let top = 0;
    for (let i = 1; i < rest.length; i++) {
      if (!sameSensorView(rest[i - 1]!, rest[i]!, [])) overlay += 1;
      if (!sameView(rest[i - 1]!, rest[i]!)) scene += 1;
      if (!(sameTopView(rest[i - 1]!, rest[i]!) && sameSensorView(rest[i - 1]!, rest[i]!, []))) top += 1;
    }
    console.log(JSON.stringify({ kit: kit.id, publishesAtRest: rest.length, spanS: rest.at(-1)!.t - rest[0]!.t, overlayChanges: overlay, sceneChanges: scene, topViewRedraws: top }));
    session.stop();
  }, 120_000);
}
