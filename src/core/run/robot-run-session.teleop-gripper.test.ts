import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, unoR3Board, type Kit } from '../hardware';
import { registry } from '../program/__fixtures__/uno-blocks';
import type { Scenario } from '../scenario/scenario';
import { initPhysics, PHYSICS_HZ } from '../world/rapier';
import { hashSnapshot } from '../world/snapshot';
import { loadScenario } from '../scenario/scenario';
import { sandboxScenario, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession } from './robot-run-session';
import type { TeleopCommand } from './teleop';

// N19 E3: teleop ("Lái tay") on the gripper car. The teleop run sets up the gripper's two servos as a program that uses the gripper does
// (both attach, setup() writes claw 0°, lift 90°), and the claw and lift commands go through the module binding: the pins D9 and D10 carry
// the angles, the world moves the gripper, and the log holds each command with its tick. The sandbox floor stands in for a gripper lesson
// (no key yet, task D4), as the colour-lead test does.

beforeAll(() => initPhysics(), 30_000);

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const gripperSession = () => {
  const scenario: Scenario = { ...sandboxScenario(), kit: gripperKit.id };
  return createRobotRunSession({ scenario, kit: gripperKit, board: unoR3Board, registry });
};
const claw = (deg: number): TeleopCommand => ({ op: 'gripper', part: 'claw', deg });
const lift = (deg: number): TeleopCommand => ({ op: 'gripper', part: 'lift', deg });

describe('teleop on the gripper car (N19 E3)', () => {
  it('attaches both servos in setup(): D9 carries claw 0°, D10 lift 90°, and the world holds the gripper at that', async () => {
    const session = gripperSession();
    expect(await session.startTeleop()).toEqual({ ok: true });
    const world = worldOf(session);
    const pin = (id: string) => world.pins.find((state) => state.pin === id)!;
    expect([pin('D9').servoDeg, pin('D10').servoDeg]).toEqual([0, 90]);
    // The physical angles are read back from the bodies: a hair off what the servos are told (snapshot.ts).
    expect(world.robot.gripper!.clawDeg).toBeCloseTo(0, 1);
    expect(world.robot.gripper!.liftDeg).toBeCloseTo(90, 1);
    expect(world.robot.gripper!.heldId).toBeNull();
    session.stop();
  });

  it('begins the colour sensor in setup() (colorBegin): Wire pulls A4 and A5 up, with no diagnostic, and a command at tick 0 still applies at tick 0', async () => {
    const session = gripperSession();
    await session.startTeleop();
    const pin = (id: string) => worldOf(session).pins.find((state) => state.pin === id)!;
    expect([pin('A4'), pin('A5')].map((state) => [state.mode, state.level])).toEqual([
      ['INPUT_PULLUP', 1],
      ['INPUT_PULLUP', 1],
    ]);
    session.teleop(lift(30));
    await session.runUntil(0.2);
    expect(session.getSnapshot().diagnostics).toEqual([]);
    expect(session.teleopLog()).toEqual([{ tick: 0, command: lift(30) }]);
    expect(worldOf(session).robot.gripper!.liftDeg).toBeCloseTo(30, 0);
    session.stop();
  });

  it('a claw and a lift command reach the pins and move the gripper: lift 45 lowers the arm to 45°, claw 80 closes the jaws to their stop', async () => {
    const session = gripperSession();
    await session.startTeleop();
    session.teleop(lift(45));
    session.teleop(claw(80));
    await session.runUntil(1);
    const world = worldOf(session);
    const pin = (id: string) => world.pins.find((state) => state.pin === id)!;
    expect([pin('D9').servoDeg, pin('D10').servoDeg]).toEqual([80, 45]);
    expect(world.robot.gripper!.liftDeg).toBeCloseTo(45, 0);
    expect(world.robot.gripper!.clawDeg).toBeGreaterThan(70);
    expect(session.teleopLog()).toEqual([
      { tick: 0, command: lift(45) },
      { tick: 0, command: claw(80) },
    ]);
    // Open and up again.
    session.teleop(claw(0));
    session.teleop(lift(90));
    await session.runUntil(2);
    const back = worldOf(session);
    expect(back.robot.gripper!.clawDeg).toBeCloseTo(0, 0);
    expect(back.robot.gripper!.liftDeg).toBeCloseTo(90, 0);
    session.stop();
  });

  it('the same input log gives the same hash, and a gripper command at a tick is logged at that tick', async () => {
    const log = [
      { tick: 0, command: lift(30) },
      { tick: 24, command: claw(80) },
      { tick: 90, command: lift(0) },
    ];
    const run = async () => {
      const session = gripperSession();
      await session.startTeleop();
      for (const { tick, command } of log) {
        await session.runUntil(tick / PHYSICS_HZ);
        session.teleop(command);
      }
      await session.runUntil(2);
      const result = { hash: hashSnapshot(worldOf(session)), log: session.teleopLog() };
      session.stop();
      return result;
    };
    const first = await run();
    expect(first.log).toEqual(log);
    expect((await run()).hash).toBe(first.hash);
  });

  it('a grab by hand: lower the arm over a cube in front of the claw, close the claw, and the snapshot says the claw holds it; opening lets it go', async () => {
    // The sandbox floor with a foam cube 4 cm, 15 g, red, 4.5 cm past the lowered carriage's origin (4.5 + 5·cos(−40°) ahead of the robot): the open
    // claw comes down with it between its jaws (measured: at 3 cm the descending jaws push it, at 6 cm it is past the grip's window).
    const floor = sandboxScenario();
    const scenario: Scenario = {
      ...loadScenario({
        key: 'rb-sandbox',
        version: 1,
        title: { vi: 'Bài thử', en: 'Fixture' },
        profile: 'uno-basic',
        kit: 'ref-uno-rover',
        arena: {
          ground: { sizeCm: [300, 150], color: '#ffffff' },
          objects: [{ id: 'cube', shape: 'box', centerCm: [40 + 4.5 + 5 * Math.cos((-40 * Math.PI) / 180) + 4.5, 75], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#d32f2f' }],
        },
        start: floor.start,
        variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
        inputs: [],
        timeLimitS: 60,
        goals: [],
        starter: {},
      }),
      kit: gripperKit.id,
    };
    const session = createRobotRunSession({ scenario, kit: gripperKit, board: unoR3Board, registry });
    await session.startTeleop();
    session.teleop(lift(0));
    await session.runUntil(0.6);
    expect(worldOf(session).robot.gripper!.heldId).toBeNull();
    session.teleop(claw(80));
    await session.runUntil(1.6);
    const held = worldOf(session);
    expect(held.robot.gripper!.heldId).toBe('cube');
    // The jaws stop on the cube, well short of the 80° they are told.
    expect(held.robot.gripper!.clawDeg).toBeGreaterThan(20);
    expect(held.robot.gripper!.clawDeg).toBeLessThan(35);
    session.teleop(claw(0));
    await session.runUntil(2.4);
    expect(worldOf(session).robot.gripper!.heldId).toBeNull();
    session.stop();
  });
});
