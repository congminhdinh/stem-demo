import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, unoR3Board, type Kit } from '../src/core/hardware';
import { colorRaw, claw, driveMove, driveStop, irDetect, lift, registry } from '../src/core/program/__fixtures__/uno-blocks';
import { not, num, print, wait, whileLoop } from '../src/core/program/__fixtures__/ybc-blocks';
import { robotProject, sandboxScenario, worldOf } from '../src/core/run/__fixtures__/robot-session';
import { createRobotRunSession } from '../src/core/run/robot-run-session';
import { parseArena } from '../src/core/world/arena/arena-schema';
import { bodyPalette } from '../src/core/world/arena/body-colors';
import { initPhysics } from '../src/core/world/rapier';
import { hubMap, hubValues } from '../src/ui/robot3d/pin-map';

// N19 B4 with E2: the "Cổng & chân" tab on a real run of the gripper car, its snapshots from the run session. The IR card follows pin A3, which
// the world's IR drives every tick (active low); the colour card shows the counts the session publishes as the sensor's `rgbc` (the register
// model's last window) and the colour COLOR_RULES names them, which are what the program read.

beforeAll(() => initPhysics(), 30_000);

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

describe('the pins tab on a gripper car’s run (N19 B4, E2)', () => {
  it('shows A3 HIGH with nothing between the jaws and LOW once the IR sees the cube, and the counts the program read', async () => {
    const floor = sandboxScenario({ sizeCm: [200, 100], start: { xCm: 40, yCm: 50, yawDeg: 0 } });
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [62, 50], sizeCm: [4, 4, 4], massG: 15, color: bodyPalette.green }] });
    const session = createRobotRunSession({ scenario: { ...floor, kit: gripperKit.id, arena }, kit: gripperKit, board: unoR3Board, registry });
    const program = [
      lift('DOWN'),
      claw('OPEN'),
      wait(num(400)),
      driveMove('forward', num(45)),
      whileLoop(not(irDetect()), []),
      driveStop(),
      wait(num(300)),
      ...(['red', 'green', 'blue', 'clear'] as const).map((channel) => print(colorRaw(channel))),
    ];
    expect(await session.start(robotProject(program, undefined, { profile: 'uno-advanced', kit: { id: gripperKit.id, version: gripperKit.version } }))).toEqual({ ok: true });
    const map = hubMap(gripperKit, unoR3Board);
    const first = hubValues(map, worldOf(session));
    expect(first.modules.irClaw).toEqual({ kind: 'ir-obstacle', level: 'high', detected: false });
    expect(first.modules.color1).toEqual({ kind: 'color-sensor', rgbc: null, color: null });
    await session.runUntil(4);
    const last = hubValues(map, worldOf(session));
    const [r, g, b, c] = session.getSnapshot().console.lines.map(Number);
    session.stop();
    expect(last.modules.irClaw).toEqual({ kind: 'ir-obstacle', level: 'low', detected: true });
    expect(last.modules.color1).toEqual({ kind: 'color-sensor', rgbc: { r, g, b, c }, color: 'green' });
  }, 120_000);
});
