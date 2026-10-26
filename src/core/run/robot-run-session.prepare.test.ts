import { describe, expect, it } from 'vitest';
import { cmp, getVar, ifThen, num, setVar } from '../program/__fixtures__/ybc-blocks';
import { driveMove, led, servoSet, ultrasonic } from '../program/__fixtures__/uno-blocks';
import { isPhysicsReady } from '../world/rapier';
import { hashSnapshot } from '../world/snapshot';
import { published, robotProject, roverSession, sandboxScenario, worldOf } from './__fixtures__/robot-session';

// N18 P2: RobotRunSession.preparePhysics on a page (a test file: its own module instance) that has not loaded the physics engine yet:
// it loads it and runs a scratch world of the scenario, then drops it; the runs after it are what they would be without it.

const wallScenario = () => sandboxScenario({ wallAtCm: 120 });
/** Forward until the ultrasonic reads under 25 cm, then turn left; the servo sweeps, the LED shows the turn (robot-run-session.test.ts). */
const avoider = () =>
  robotProject(
    [servoSet('servo1', num(30))],
    [
      setVar('x', ultrasonic()),
      ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
    ],
  );

describe('preparePhysics on a page without the physics engine (N18 P2)', () => {
  it('loads it and runs a scratch world: true, nothing published, the session idle, once a session; a run after it is the same run', async () => {
    expect(isPhysicsReady()).toBe(false);
    const prepared = roverSession(wallScenario());
    const seen = published(prepared);
    const first = prepared.preparePhysics();
    expect(prepared.preparePhysics()).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(isPhysicsReady()).toBe(true);
    expect(seen).toEqual([]);
    expect(prepared.getSnapshot().status).toBe('idle');
    await prepared.start(avoider());
    await prepared.runUntil(3);
    const warmed = hashSnapshot(worldOf(prepared));
    prepared.stop();

    const plain = roverSession(wallScenario());
    await plain.start(avoider());
    await plain.runUntil(3);
    expect(hashSnapshot(worldOf(plain))).toBe(warmed);
    plain.stop();
    // Now the page has the engine: another session's warm-up does nothing.
    await expect(roverSession(wallScenario()).preparePhysics()).resolves.toBe(false);
  });
});
