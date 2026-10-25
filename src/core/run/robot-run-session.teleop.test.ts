import { beforeAll, describe, expect, it } from 'vitest';
import { unoR3Board, type Kit } from '../hardware';
import { driveMove, driveStop } from '../program/__fixtures__/uno-blocks';
import { num, wait } from '../program/__fixtures__/ybc-blocks';
import { loadScenario, type Scenario } from '../scenario/scenario';
import { initPhysics, PHYSICS_HZ } from '../world/rapier';
import { hashSnapshot, type RobotSnapshot } from '../world/snapshot';
import { driveScenario, everyGoalScorer, published, robotProject, rover, roverSession, sandboxScenario, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession, type RobotRunSession } from './robot-run-session';
import { TELEOP_LIMIT_S, type TeleopCommand } from './teleop';
import { registry } from '../program/__fixtures__/uno-blocks';

// N18 R4.8: teleop ("Lái tay") and the placed start ("Di chuyển robot") in the run session. Teleop is a run without a program whose drive
// follows the UI's commands, each applied at the next tick through the module binding; placeRobot sets where every next world starts.

beforeAll(() => initPhysics(), 30_000);

const move = (direction: 'forward' | 'backward' | 'spinLeft' | 'spinRight', speed: number): TeleopCommand => ({ op: 'move', direction, speed });
const stop: TeleopCommand = { op: 'stop' };

/** The sandbox floor of 300 × 150 cm, the robot at (40, 75) facing +x, a wall across x = 120; a run ends when it touches a wall. */
function wallScenario(timeLimitS = 10): Scenario {
  return loadScenario({
    key: 'rb-sandbox',
    version: 1,
    title: { vi: 'Bài thử', en: 'Fixture' },
    profile: 'uno-basic',
    kit: 'ref-uno-rover',
    arena: { ground: { sizeCm: [300, 150], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [120, 0], toCm: [120, 150] }] },
    start: { xCm: 40, yCm: 75, yawDeg: 0 },
    variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
    inputs: [],
    timeLimitS,
    goals: [],
    starter: {},
    endOnContact: ['wall'],
  });
}

/** The world's hash without what only a program has (the block it is in): what the physics and the hardware did. */
const bodyHash = (world: RobotSnapshot) => hashSnapshot({ ...world, activeBlockId: null });

/** Runs `session` (a teleop run) to each tick of `log` and gives the command there, then to `untilS`. */
async function drive(session: RobotRunSession, log: readonly { tick: number; command: TeleopCommand }[], untilS: number) {
  for (const { tick, command } of log) {
    await session.runUntil(tick / PHYSICS_HZ);
    expect(worldOf(session).t * PHYSICS_HZ).toBeCloseTo(tick, 6);
    session.teleop(command);
  }
  await session.runUntil(untilS);
}

describe('teleop (N18 R4.8)', () => {
  it('starts a run without a program on a new world: the snapshot says teleop, the drive’s pins are set up, the rest are not', async () => {
    const session = roverSession(sandboxScenario());
    const seen = published(session);
    expect(await session.startTeleop()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ status: 'running', teleop: true, diagnostics: [], error: null });
    const world = worldOf(session);
    expect(world).toMatchObject({ t: 0, status: 'running', activeBlockId: null });
    const pin = (id: string) => world.pins.find((state) => state.pin === id);
    for (const id of ['D2', 'D4', 'D5', 'D6', 'D7', 'D8']) expect(pin(id)).toMatchObject({ mode: 'OUTPUT', level: 0, duty: 0 });
    expect(pin('D13')).toMatchObject({ mode: 'INPUT' });
    session.teleop(move('forward', 50));
    await session.runUntil(0.1);
    // motorLeft is M1 (EN D5, IN1 D7, IN2 D8), motorRight M2 (EN D6, IN1 D2, IN2 D4): forward at 50 % is duty 128, IN1 HIGH.
    const driving = worldOf(session);
    expect([pin('D5'), pin('D7'), pin('D8')].map((state) => driving.pins.find((p) => p.pin === state!.pin)!.duty)).toEqual([128, 255, 0]);
    expect(driving.pins.find((p) => p.pin === 'D6')!.duty).toBe(128);
    expect(driving.robot.xCm).toBeGreaterThan(40.5);
    expect(session.teleopLog()).toEqual([{ tick: 0, command: move('forward', 50) }]);
    session.stop();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', world: null });
    expect(session.getSnapshot().teleop).toBeUndefined();
  });

  it('teleop forward for 1 s moves the robot exactly as far as a program that drives forward for 1 s', async () => {
    const program = roverSession(sandboxScenario());
    await program.start(robotProject([driveMove('forward', num(50)), wait(num(1000)), driveStop(), wait(num(5000))]));
    await program.runUntil(2);
    const byProgram = worldOf(program);

    const teleop = roverSession(sandboxScenario());
    await teleop.startTeleop();
    await drive(teleop, [{ tick: 0, command: move('forward', 50) }, { tick: PHYSICS_HZ, command: stop }], 2);
    const byHand = worldOf(teleop);

    expect(byHand.t).toBe(2);
    expect(byHand.robot.xCm - 40).toBeGreaterThan(10);
    expect(byHand.robot.xCm).toBe(byProgram.robot.xCm);
    expect(byHand.robot.yCm).toBe(byProgram.robot.yCm);
    expect(byHand.robot.yawDeg).toBe(byProgram.robot.yawDeg);
    program.stop();
    teleop.stop();
  });

  it('hashes the same as a program that makes the same drive calls at the same ticks, and the same input log gives the same hash', async () => {
    // forward 60 at tick 0, spin left 40 at tick 60 (0.5 s), back 50 at tick 150 (1.25 s), stop at tick 200 (1.67 s).
    const log = [
      { tick: 0, command: move('forward', 60) },
      { tick: 60, command: move('spinLeft', 40) },
      { tick: 150, command: move('backward', 50) },
      { tick: 200, command: stop },
    ];
    const program = roverSession(driveScenario(), { scorer: everyGoalScorer });
    await program.start(
      robotProject([driveMove('forward', num(60)), wait(num(500)), driveMove('spinLeft', num(40)), wait(num(750)), driveMove('backward', num(50)), wait(num(417)), driveStop(), wait(num(9000))]),
    );
    await program.runUntil(2.5);

    const teleop = roverSession(driveScenario(), { scorer: everyGoalScorer });
    await teleop.startTeleop();
    await drive(teleop, log, 2.5);
    expect(teleop.teleopLog()).toEqual(log);
    expect(bodyHash(worldOf(teleop))).toBe(bodyHash(worldOf(program)));
    // The goals are judged on the same frames (the scenario's zone is reached or not the same way).
    expect(worldOf(teleop).score.goals.map((goal) => goal.id)).toEqual(['reach', 'reach-far']);

    const again = roverSession(driveScenario(), { scorer: everyGoalScorer });
    await again.startTeleop();
    await drive(again, teleop.teleopLog(), 2.5);
    expect(hashSnapshot(worldOf(again))).toBe(hashSnapshot(worldOf(teleop)));
    for (const session of [program, teleop, again]) session.stop();
  });

  it('applies the commands given while its world is built at its first tick', async () => {
    const session = roverSession(sandboxScenario());
    const started = session.startTeleop();
    session.teleop(move('spinRight', 70));
    expect(await started).toEqual({ ok: true });
    await session.runUntil(0.05);
    expect(session.teleopLog()).toEqual([{ tick: 0, command: move('spinRight', 70) }]);
    expect(worldOf(session).robot.yawDeg).toBeLessThan(-1);
    session.stop();
  });

  it('is refused during a check, and its commands reach no run but its own', async () => {
    const session = roverSession(driveScenario());
    await session.start(robotProject([driveStop()]), 0, { check: true });
    expect(await session.startTeleop()).toEqual({ ok: false, reason: 'check', diagnostics: [] });
    expect(session.getSnapshot().teleop).toBeUndefined();
    session.teleop(move('forward', 80));
    await session.runUntil(0.5);
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    expect(session.teleopLog()).toEqual([]);
    // A learner's program run: teleop's commands are not its.
    await session.start(robotProject([driveStop()]));
    session.teleop(move('forward', 80));
    await session.runUntil(0.5);
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
  });

  it('a Run (start) replaces teleop: the program runs on a new world from the start, and teleop’s commands are ignored', async () => {
    const session = roverSession(sandboxScenario());
    await session.startTeleop();
    session.teleop(move('forward', 80));
    await session.runUntil(0.5);
    expect(worldOf(session).robot.xCm).toBeGreaterThan(45);
    expect(await session.start(robotProject([driveStop()]))).toEqual({ ok: true });
    expect(session.getSnapshot().teleop).toBeUndefined();
    expect(worldOf(session)).toMatchObject({ t: 0 });
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.teleop(move('forward', 80));
    await session.runUntil(0.5);
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    expect(session.teleopLog()).toEqual([]);
    session.stop();
  });

  it('stopTeleop ends a teleop run (idle) and a teleop start still building its world, never a program’s run', async () => {
    const session = roverSession(sandboxScenario());
    await session.startTeleop();
    session.stopTeleop();
    expect(session.getSnapshot().status).toBe('idle');
    const building = session.startTeleop();
    session.stopTeleop();
    expect(await building).toEqual({ ok: false, reason: 'superseded', diagnostics: [] });
    expect(session.getSnapshot().status).toBe('idle');
    await session.start(robotProject([driveMove('forward', num(50))]));
    session.stopTeleop();
    expect(session.getSnapshot().status).toBe('running');
    session.stop();
  });

  it('Đặt lại robot of a teleop run is a new teleop run from the start: a new world, the log empty', async () => {
    const session = roverSession(sandboxScenario());
    await session.startTeleop();
    session.teleop(move('forward', 80));
    await session.runUntil(0.5);
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ status: 'running', teleop: true });
    expect(worldOf(session).t).toBe(0);
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    expect(session.teleopLog()).toEqual([]);
    // The drive was told nothing yet: the robot stays.
    await session.runUntil(0.5);
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
  });

  it('ignores the scenario’s time limit (exploration is never scored): it runs on to TELEOP_LIMIT_S, 600 s, and ends there', { timeout: 120_000 }, async () => {
    expect(TELEOP_LIMIT_S).toBe(600);
    const session = roverSession(wallScenario(10));
    await session.startTeleop();
    await session.runUntil(11);
    expect(session.getSnapshot()).toMatchObject({ status: 'running', teleop: true });
    expect(session.getSnapshot().end).toBeUndefined();
    await session.runUntil(TELEOP_LIMIT_S + 1);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', teleop: true, end: { reason: 'time-limit', atS: 600 } });
    // A program's run of the same scenario still ends at its own limit.
    await session.start(robotProject([driveStop()]));
    await session.runUntil(11);
    expect(session.getSnapshot()).toMatchObject({ end: { reason: 'time-limit', atS: 10 } });
    session.stop();
  });

  it('a crash still ends it (the scenario’s endOnContact), and Đặt lại robot is a new teleop run at once', async () => {
    const session = roverSession(wallScenario());
    await session.startTeleop();
    session.teleop(move('forward', 100));
    await session.runUntil(8);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', teleop: true, end: { reason: 'contact', tag: 'wall' } });
    const crashedAt = worldOf(session).t;
    expect(crashedAt).toBeLessThan(8);
    // Nothing more is ticked or taken.
    session.teleop(move('backward', 100));
    await session.runUntil(9);
    expect(worldOf(session).t).toBe(crashedAt);
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ status: 'running', teleop: true });
    expect(session.getSnapshot().end).toBeUndefined();
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
  });

  it('startTeleop during a frame in flight: the program’s frame publishes nothing more, the teleop run stands', async () => {
    const session = roverSession(sandboxScenario());
    await session.start(robotProject([driveMove('forward', num(80))]));
    const seen = published(session);
    const frame = session.advance(100);
    const started = session.startTeleop();
    await frame;
    expect(await started).toEqual({ ok: true });
    expect(seen.at(-1)).toMatchObject({ status: 'running', teleop: true, world: { t: 0 } });
    expect(seen.every((snapshot, i) => i === seen.length - 1 || snapshot.teleop === undefined)).toBe(true);
    await session.runUntil(0.2);
    expect(session.getSnapshot().teleop).toBe(true);
    session.stop();
  });

  it('a Run (start) while a teleop start builds its world supersedes it, and the teleop commands given meanwhile reach nothing', async () => {
    const session = roverSession(sandboxScenario());
    const teleop = session.startTeleop();
    session.teleop(move('forward', 80));
    const run = session.start(robotProject([driveStop()]));
    expect(await teleop).toEqual({ ok: false, reason: 'superseded', diagnostics: [] });
    expect(await run).toEqual({ ok: true });
    await session.runUntil(0.5);
    expect(session.getSnapshot().teleop).toBeUndefined();
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
  });

  it('a kit without the drive cannot be driven by hand', async () => {
    const oneMotor = { ...rover, modules: rover.modules.filter((module) => module.role !== 'motorRight') } as Kit;
    const session = createRobotRunSession({ scenario: sandboxScenario(), kit: oneMotor, board: unoR3Board, registry });
    expect(await session.startTeleop()).toEqual({ ok: false, reason: 'no-drive', diagnostics: [] });
    expect(session.getSnapshot().status).toBe('idle');
  });
});

describe('placeRobot (N18 R4.8)', () => {
  it('sets where the next world starts: a Run then starts there, and placeRobot(null) gives the scenario’s start back', async () => {
    const session = roverSession(sandboxScenario());
    expect(await session.placeRobot({ xCm: 120, yCm: 60, yawDeg: 90 })).toEqual({ ok: true, pose: { xCm: 120, yCm: 60, yawDeg: 90 } });
    expect(session.getSnapshot().status).toBe('idle');
    await session.start(robotProject([driveStop()]));
    let world = worldOf(session);
    expect(world.robot.xCm).toBeCloseTo(120, 1);
    expect(world.robot.yCm).toBeCloseTo(60, 1);
    expect(world.robot.yawDeg).toBeCloseTo(90, 1);
    session.stop();
    expect(await session.placeRobot(null)).toEqual({ ok: true, pose: { xCm: 40, yCm: 75, yawDeg: 0 } });
    await session.start(robotProject([driveStop()]));
    world = worldOf(session);
    expect(world.robot.xCm).toBeCloseTo(40, 1);
    expect(world.robot.yCm).toBeCloseTo(75, 1);
    session.stop();
  });

  it('during a run, starts it again from the placed pose (a new world, as Đặt lại robot); Đặt lại robot keeps the placed pose', async () => {
    const session = roverSession(sandboxScenario());
    await session.start(robotProject([driveMove('forward', num(50))]));
    await session.runUntil(0.5);
    expect(await session.placeRobot({ xCm: 150, yCm: 100, yawDeg: 180 })).toEqual({ ok: true, pose: { xCm: 150, yCm: 100, yawDeg: 180 } });
    expect(worldOf(session).t).toBe(0);
    expect(worldOf(session).robot.xCm).toBeCloseTo(150, 1);
    await session.runUntil(1);
    // Facing -x, forward goes left.
    expect(worldOf(session).robot.xCm).toBeLessThan(145);
    await session.resetRobot();
    expect(worldOf(session).t).toBe(0);
    expect(worldOf(session).robot.xCm).toBeCloseTo(150, 1);
    // Teleop starts there too.
    await session.startTeleop();
    expect(worldOf(session).robot.xCm).toBeCloseTo(150, 1);
    session.stop();
  });

  it('moves a pose back inside the arena, and refuses one that stands in something (the placement stays as it was)', async () => {
    const session = roverSession(sandboxScenario({ wallAtCm: 100 }));
    expect(await session.placeRobot({ xCm: -30, yCm: 75, yawDeg: 0 })).toEqual({ ok: true, pose: { xCm: 7.5, yCm: 75, yawDeg: 0 } });
    const refused = await session.placeRobot({ xCm: 100, yCm: 75, yawDeg: 0 });
    expect(refused).toMatchObject({ ok: false, reason: 'overlap' });
    expect(refused.ok === false && refused.reason === 'overlap' && refused.issues[0]!.message).toContain('walls[0] (wall)');
    await session.start(robotProject([driveStop()]));
    expect(worldOf(session).robot.xCm).toBeCloseTo(7.5, 1);
    session.stop();
  });

  it('refuses a pose that is not numbers, instead of throwing', async () => {
    const session = roverSession(sandboxScenario());
    expect(await session.placeRobot({ xCm: Number.NaN, yCm: 60, yawDeg: 0 })).toEqual({ ok: false, reason: 'invalid', issues: [] });
    expect(await session.placeRobot({ xCm: 10, yCm: 60, yawDeg: Number.POSITIVE_INFINITY })).toEqual({ ok: false, reason: 'invalid', issues: [] });
    await session.start(robotProject([driveStop()]));
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
  });

  it('placeRobot while a start builds its world: that start keeps its pose, the next world takes the new one', async () => {
    const session = roverSession(sandboxScenario());
    const started = session.start(robotProject([driveStop()]));
    expect(await session.placeRobot({ xCm: 150, yCm: 100, yawDeg: 0 })).toEqual({ ok: true, pose: { xCm: 150, yCm: 100, yawDeg: 0 } });
    expect(await started).toEqual({ ok: true });
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    await session.resetRobot();
    expect(worldOf(session).robot.xCm).toBeCloseTo(150, 1);
    session.stop();
  });

  it('never moves a check: a check run starts at the scenario’s start, and placeRobot is refused while one runs', async () => {
    const session = roverSession(driveScenario());
    await session.placeRobot({ xCm: 120, yCm: 50, yawDeg: 0 });
    await session.start(robotProject([driveStop()]), 0, { check: true });
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    expect(await session.placeRobot({ xCm: 150, yCm: 50, yawDeg: 0 })).toEqual({ ok: false, reason: 'check', issues: [] });
    await session.resetRobot();
    expect(worldOf(session).robot.xCm).toBeCloseTo(40, 1);
    session.stop();
    // The learner's own runs still start where the robot was placed.
    await session.start(robotProject([driveStop()]));
    expect(worldOf(session).robot.xCm).toBeCloseTo(120, 1);
    session.stop();
  });

  it('a placed run is as deterministic as any: the same pose and program give the same hash', async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const session = roverSession(driveScenario(), { scorer: everyGoalScorer });
      await session.placeRobot({ xCm: 30, yCm: 40, yawDeg: 20 });
      await session.start(robotProject([driveMove('forward', num(70))]));
      await session.runUntil(1.5);
      hashes.push(hashSnapshot(worldOf(session)));
      session.stop();
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});
