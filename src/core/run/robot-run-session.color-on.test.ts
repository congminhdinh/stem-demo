import { describe, expect, it } from 'vitest';
import { productionKits, type Kit } from '../hardware';
import { colorIs, colorRaw, driveMove, driveStop, lift, registry } from '../program/__fixtures__/uno-blocks';
import { num, print, wait } from '../program/__fixtures__/ybc-blocks';
import type { Scenario } from '../scenario/scenario';
import { driveScenario, robotProject, rover, sandboxScenario, unoR3Board, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession } from './robot-run-session';

// N19 final fix (G2 I1): a run's state says which of the kit's colour sensors its program sets up (an op of theirs in its uses, `color.is`
// or `color.raw`, whose setup() runs colorBegin; a teleop run's `color.is`, teleop.ts, ruling E3), so that the views show a colour sensor's
// ray, spot and tag line only for a sensor that will read: lessons 8, 9 and 11 have no colour block and said "Màu: chưa có số đọc" on every
// run. It is no part of the world (the hashes are unchanged), the same frozen array on every publish of a run, and left out for a kit with
// no colour sensor: a rover's states are as they were.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const gripperScenario = (): Scenario => ({ ...sandboxScenario(), kit: gripperKit.id });
const onGripper = { kit: { id: gripperKit.id, version: gripperKit.version } };

describe('the colour sensors a run sets up (N19 final fix, G2 I1)', () => {
  it('are the colour sensor of a program that reads it (color.is, color.raw): one frozen array on every publish of the run, no part of the world', async () => {
    // color.raw is an Advanced block (uno.color.ts, U-39).
    for (const [reads, profile] of [
      [print(colorIs('red')), 'uno-basic'],
      [print(colorRaw('red')), 'uno-advanced'],
    ] as const) {
      const session = createRobotRunSession({ scenario: gripperScenario(), kit: gripperKit, board: unoR3Board, registry });
      const published: unknown[] = [];
      session.subscribe((snapshot) => void published.push(snapshot.colorSensorsOn));
      expect(await session.start(robotProject([wait(num(100)), reads], undefined, { ...onGripper, profile }), 0)).toEqual({ ok: true });
      await session.runUntil(0.5);
      const snapshot = session.getSnapshot();
      expect(snapshot.colorSensorsOn).toEqual(['color1']);
      expect(Object.isFrozen(snapshot.colorSensorsOn)).toBe(true);
      const said = published.filter((value) => value !== undefined);
      expect(said.length).toBeGreaterThanOrEqual(2);
      expect(new Set(said).size).toBe(1);
      expect('colorSensorsOn' in snapshot.world!).toBe(false);
      expect(worldOf(session).sensors.map((sensor) => Object.keys(sensor).sort())).toContainEqual(['distanceCm', 'hitId', 'kind', 'rgbc', 'role']);
      session.stop();
    }
  }, 120_000);

  it('are none for a gripper car’s program with no colour block (lessons 8, 9 and 11): the sensor is never begun, and the world still has its readout', async () => {
    const session = createRobotRunSession({ scenario: gripperScenario(), kit: gripperKit, board: unoR3Board, registry });
    expect(await session.start(robotProject([lift('DOWN'), driveMove('forward', num(40)), wait(num(300)), driveStop()], undefined, onGripper), 0)).toEqual({ ok: true });
    await session.runUntil(0.5);
    expect(session.getSnapshot().colorSensorsOn).toEqual([]);
    // The world measures the sensor's ray all the same; no window is ever counted (the program never begins it).
    expect(worldOf(session).sensors.find((sensor) => sensor.kind === 'color-sensor')).toEqual({ role: 'color1', kind: 'color-sensor', hitId: null, distanceCm: null });
    session.stop();
  }, 120_000);

  it('are the colour sensor in teleop on the gripper car: teleop begins it (ruling E3)', async () => {
    const session = createRobotRunSession({ scenario: gripperScenario(), kit: gripperKit, board: unoR3Board, registry });
    expect(await session.startTeleop()).toEqual({ ok: true });
    await session.runUntil(0.2);
    expect(session.getSnapshot().colorSensorsOn).toEqual(['color1']);
    session.stop();
  }, 120_000);

  it('are left out for a kit with no colour sensor: the rover’s runs and its teleop', async () => {
    const session = createRobotRunSession({ scenario: driveScenario(), kit: rover, board: unoR3Board, registry });
    expect(await session.start(robotProject([driveMove('forward', num(50)), wait(num(300)), driveStop()]), 1)).toEqual({ ok: true });
    await session.runUntil(0.5);
    expect('colorSensorsOn' in session.getSnapshot()).toBe(false);
    session.stop();
    expect(await session.startTeleop()).toEqual({ ok: true });
    await session.runUntil(0.2);
    expect('colorSensorsOn' in session.getSnapshot()).toBe(false);
    session.stop();
  }, 120_000);
});
