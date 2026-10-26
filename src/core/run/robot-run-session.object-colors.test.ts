import { describe, expect, it } from 'vitest';
import { productionKits, type Kit } from '../hardware';
import { colorIs, driveMove, driveStop, irDetect, lift, claw, registry } from '../program/__fixtures__/uno-blocks';
import { not, num, print, wait, whileLoop } from '../program/__fixtures__/ybc-blocks';
import type { Scenario } from '../scenario/scenario';
import { parseArena } from '../world/arena/arena-schema';
import { bodyPalette } from '../world/arena/body-colors';
import { driveScenario, robotProject, rover, sandboxScenario, unoR3Board, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession } from './robot-run-session';

// N19 E4/E5 (ruling on the E4/E5 report, decision 8): a run's snapshot says the colour of each arena object in the run's variant (the
// world's own arena, `applyVariant`: what the colour sensor reads), so that the views paint the round they show in its colours and never
// work the variant out again. It is no part of the world (the hashes are unchanged), the same frozen object on every publish of a run, and
// only for a scenario whose variants recolour objects (`variants.objectColors`): a rover's snapshots are as they were.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

/** The sort lesson's shape: a 4 cm cube 22 cm ahead of the car, green, red, blue in the three rounds; no other jitter. */
function sortScenario(recolour = true): Scenario {
  const floor = sandboxScenario({ sizeCm: [200, 100], start: { xCm: 40, yCm: 50, yawDeg: 0 } });
  const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [62, 50], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.green }] });
  const variants = { ...floor.variants, count: 3, ...(recolour ? { objectColors: { cube: [bodyPalette.green, bodyPalette.red, bodyPalette.blue] } } : {}) };
  return { ...floor, kit: gripperKit.id, arena, variants };
}
const creepToCube = [lift('DOWN'), claw('OPEN'), wait(num(400)), driveMove('forward', num(45)), whileLoop(not(irDetect()), []), driveStop(), wait(num(300)), print(colorIs('red'))];

describe('the colours of a run’s objects (N19 E4/E5)', () => {
  it('are the variant’s: round 1 green, round 2 red, round 3 blue, what the colour sensor reads; one frozen object a run', async () => {
    const scenario = sortScenario();
    const read: string[] = [];
    for (const [index, colour] of [bodyPalette.green, bodyPalette.red, bodyPalette.blue].entries()) {
      const session = createRobotRunSession({ scenario, kit: gripperKit, board: unoR3Board, registry });
      const published: unknown[] = [];
      session.subscribe((snapshot) => void published.push(snapshot.objectColors));
      expect(await session.start(robotProject(creepToCube, undefined, { kit: { id: gripperKit.id, version: gripperKit.version } }), index)).toEqual({ ok: true });
      await session.runUntil(4);
      const snapshot = session.getSnapshot();
      expect(snapshot.objectColors).toEqual({ cube: colour });
      expect(Object.isFrozen(snapshot.objectColors)).toBe(true);
      // The same object on every publish of the run (a view's selector of it renders once a run).
      const colours = published.filter((value) => value !== undefined);
      expect(colours.length).toBeGreaterThanOrEqual(2);
      expect(new Set(colours).size).toBe(1);
      read.push(session.getSnapshot().console.lines.join(' '));
      // The world's sensors read that colour: red is "1" only in round 2.
      expect(worldOf(session).sensors.find((sensor) => sensor.kind === 'color-sensor')).toMatchObject({ hitId: 'cube' });
      session.stop();
    }
    expect(read).toEqual(['0', '1', '0']);
  }, 120_000);

  it('are left out for a scenario whose variants recolour nothing: the rover’s runs, and a gripper car’s plain floor', async () => {
    const roverSession = createRobotRunSession({ scenario: driveScenario(), kit: rover, board: unoR3Board, registry });
    expect(await roverSession.start(robotProject([driveMove('forward', num(50)), wait(num(300)), driveStop()]), 1)).toEqual({ ok: true });
    await roverSession.runUntil(1);
    expect('objectColors' in roverSession.getSnapshot()).toBe(false);
    roverSession.stop();
    const session = createRobotRunSession({ scenario: sortScenario(false), kit: gripperKit, board: unoR3Board, registry });
    expect(await session.start(robotProject([wait(num(100))], undefined, { kit: { id: gripperKit.id, version: gripperKit.version } }), 1)).toEqual({ ok: true });
    await session.runUntil(0.5);
    expect('objectColors' in session.getSnapshot()).toBe(false);
    session.stop();
  }, 120_000);
});
