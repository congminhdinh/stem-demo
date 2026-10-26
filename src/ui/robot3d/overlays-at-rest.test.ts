import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef, unoR3Board, type Kit } from '../../core/hardware';
import { claw, colorIs, driveMove, driveStop, irDetect, lift, registry } from '../../core/program/__fixtures__/uno-blocks';
import { not, num, print, wait, whileLoop, type Json } from '../../core/program/__fixtures__/ybc-blocks';
import { robotProject, sandboxScenario } from '../../core/run/__fixtures__/robot-session';
import { createRobotRunSession } from '../../core/run/robot-run-session';
import { parseArena } from '../../core/world/arena/arena-schema';
import { bodyPalette } from '../../core/world/arena/body-colors';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { sameView } from './scene-math';
import { sameSensorView } from './sensor-overlay-math';
import { sameTopView } from './top-view-math';

// N18 P2's rule, "a robot at rest draws nothing", for the gripper car (N19 E5, review B3/B4 M1): a real run session at 1×, 60 frames a
// second for 10 s, a program that is over in about 3 s, and every snapshot it publishes from t = 5 s (ten a second: the HUD clock's rest
// pace). The 3D overlay asks for a frame when `sameSensorView` says no (SensorOverlay.tsx), the 2D map's sensor layer redraws when
// `sameTopView && sameSensorView` says no (TopViewSensors.tsx), the scene when `sameView` does (Scene.tsx RedrawOnChange): none of them may,
// on either kit. The gripper car holds a red cube up, its IR seeing it and its colour sensor reading it (the readings the overlays draw).
// The measure of spikes/n19-b34/redraw-at-rest.test.ts, as an assertion: before E5 the gripper car's overlays changed on 69 of 70 publishes.

const gripperRef = { id: 'ref-uno-gripper', version: '0' } as const;

/** The gripper car on a floor of 200 × 100 cm with a red cube 22 cm ahead; the rover on the same floor without one. */
function scenarioFor(kit: Kit) {
  const floor = sandboxScenario({ sizeCm: [200, 100], start: { xCm: 40, yCm: 50, yawDeg: 0 } });
  if (kit.id !== gripperRef.id) return floor;
  const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [62, 50], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.red }] });
  return { ...floor, kit: kit.id, arena };
}

/** Lower and open, creep up until the IR sees the cube, stop, read its colour, grab it and lift it: then nothing more. */
const pickUp: Json[] = [
  lift('DOWN'),
  claw('OPEN'),
  wait(num(400)),
  driveMove('forward', num(45)),
  whileLoop(not(irDetect()), []),
  driveStop(),
  wait(num(300)),
  print(colorIs('red')),
  claw('CLOSE'),
  wait(num(600)),
  lift('UP'),
];
const roverDrive: Json[] = [driveMove('forward', num(50)), wait(num(800)), driveStop()];

async function restingWorlds(kit: Kit): Promise<RobotSnapshot[]> {
  const session = createRobotRunSession({ scenario: scenarioFor(kit), kit, board: unoR3Board, registry });
  const seen: RobotSnapshot[] = [];
  session.subscribe((snapshot) => {
    if (snapshot.world !== null) seen.push(snapshot.world);
  });
  const started = await session.start(robotProject(kit.id === gripperRef.id ? pickUp : roverDrive, undefined, { kit: { id: kit.id, version: kit.version } }));
  expect(started).toEqual({ ok: true });
  for (let i = 0; i < 600; i++) await session.advance(1000 / 60, 1);
  session.stop();
  return seen.filter((world) => world.t >= 5);
}

/** How many of the publishes at rest each view calls a change of its picture. */
function changes(rest: readonly RobotSnapshot[]) {
  let overlay = 0;
  let map = 0;
  let scene = 0;
  for (let i = 1; i < rest.length; i++) {
    const [a, b] = [rest[i - 1]!, rest[i]!];
    if (!sameSensorView(a, b, [])) overlay += 1;
    if (!(sameTopView(a, b) && sameSensorView(a, b, []))) map += 1;
    if (!sameView(a, b)) scene += 1;
  }
  return { overlay, map, scene };
}

describe('a car at rest draws nothing for its overlays (N18 P2, N19 E5)', () => {
  it('the gripper car holding a red cube up, its IR seeing it and its colour read: no change on any of 50 publishes', async () => {
    const kit = productionKits.get(gripperRef) as Kit;
    const rest = await restingWorlds(kit);
    expect(rest.length).toBeGreaterThanOrEqual(45);
    const last = rest.at(-1)!;
    // What the overlays draw is there: the cube held, the IR seeing it, the colour sensor's counts.
    expect(last.robot.gripper?.heldId).toBe('cube');
    expect(last.sensors.find((sensor) => sensor.kind === 'ir-obstacle')).toMatchObject({ detected: true, hitId: 'cube' });
    expect(last.sensors.find((sensor) => sensor.kind === 'color-sensor')).toMatchObject({ hitId: 'cube', rgbc: expect.any(Object) });
    expect(changes(rest)).toEqual({ overlay: 0, map: 0, scene: 0 });
  }, 120_000);

  it('the rover, as before', async () => {
    const rest = await restingWorlds(productionKits.get(referenceKitRef) as Kit);
    expect(rest.length).toBeGreaterThanOrEqual(45);
    expect(changes(rest)).toEqual({ overlay: 0, map: 0, scene: 0 });
  }, 120_000);
});
