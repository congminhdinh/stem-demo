import { beforeAll, describe, expect, it } from 'vitest';
import { createKitCatalog, echoToCm, motorDuty, unoR3Board, type DcMotorSpec, type Kit } from '../hardware';
import refUnoRoverJson from '../hardware/kits/ref-uno-rover.kit.json';
import { buttonPressed, buzzerTone, driveMove, driveStop, led, lineDark, motorSet, servoSet, ultrasonic, unoDivide } from '../program/__fixtures__/uno-blocks';
import { cmp, getVar, ifThen, num, print, repeat, setVar, wait } from '../program/__fixtures__/ybc-blocks';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import type { GoalFrame } from '../scenario/goals/frame';
import { loadScenario } from '../scenario/scenario';
import { initPhysics, PHYSICS_HZ } from '../world/rapier';
import { hashSnapshot } from '../world/snapshot';
import { driveScenario, everyGoalScorer, numbers, published, robotProject, rover, roverSession, sandboxScenario, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession, JITTER_TICKS, MAX_TICKS_PER_FRAME, type RobotRunSession, type RobotScorerFactory } from './robot-run-session';
import { registry } from '../program/__fixtures__/uno-blocks';

// N18 R3.6: RobotRunSession, where the learner's program, the virtual UNO and the world meet (robot plan §3). Each test runs the real
// pieces: the uno compiler and interpreter on the virtual clock, the kit's drivers on the virtual UNO, the Rapier world.

beforeAll(() => initPhysics(), 30_000);

const TICK_MS = 1000 / PHYSICS_HZ;
const allGoals = () => loadScenario(allGoalsScenario);

/** A scorer that keeps every frame it is fed, with its tick. */
function framesOf(): { scorer: RobotScorerFactory; frames: { frame: GoalFrame; dtS: number }[] } {
  const frames: { frame: GoalFrame; dtS: number }[] = [];
  return {
    frames,
    scorer: () => ({
      update: (frame, dtS) => void frames.push({ frame, dtS }),
      score: () => ({ points: 0, maxScore: null, goals: [] }),
    }),
  };
}

/** Forward until the ultrasonic reads under 25 cm, then turn left; the servo sweeps, the LED shows the turn. */
const avoider = () =>
  robotProject(
    [servoSet('servo1', num(30))],
    [
      setVar('x', ultrasonic()),
      ifThen(cmp('LT', getVar('x'), num(25)), [driveMove('spinLeft', num(60)), led('ON'), servoSet('servo1', num(150))], [driveMove('forward', num(70)), led('OFF'), servoSet('servo1', num(30))]),
    ],
  );

describe('start', () => {
  it('publishes the world at t = 0 with the pins setup() left: running, no block yet, frozen plain JSON', async () => {
    const session = roverSession(driveScenario(), { scorer: everyGoalScorer });
    const seen = published(session);
    expect(await session.start(robotProject([driveMove('forward', num(50)), led('ON')]))).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ status: 'running', diagnostics: [], error: null, console: { lines: [], hidden: 0 }, slowerThanRealtime: false });
    const world = worldOf(session);
    expect(world).toMatchObject({ t: 0, status: 'running', activeBlockId: null, leds: { led1: false }, outOfArena: false });
    expect(world.robot.xCm).toBeCloseTo(40, 2);
    // setup() of the drive and the LED: their pins are outputs, LOW; the pins the program does not use stay inputs.
    const pin = (id: string) => world.pins.find((state) => state.pin === id);
    for (const id of ['D2', 'D4', 'D5', 'D6', 'D7', 'D8', 'D13']) {
      expect(pin(id)).toEqual({ pin: id, mode: 'OUTPUT', level: 0, duty: 0, toneHz: null, servoDeg: null });
    }
    expect(pin('D9')).toEqual({ pin: 'D9', mode: 'INPUT', level: 0, duty: 0, toneHz: null, servoDeg: null });
    expect(world.pins.map((state) => state.pin)).toEqual(unoR3Board.pins.map((spec) => spec.id));
    // The scorer saw tick 0.
    expect(world.score).toEqual({
      points: 0,
      maxScore: 100,
      goals: [
        { id: 'reach', passed: false, points: 0, progress: expect.any(Number), reasonKey: 'robot.goal.reason.zone-not-reached' },
        { id: 'reach-far', passed: false, points: 0, progress: expect.any(Number), reasonKey: 'robot.goal.reason.zone-not-reached' },
      ],
    });
    expect(Object.isFrozen(world) && Object.isFrozen(world.pins[0]) && Object.isFrozen(world.score.goals)).toBe(true);
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
    session.stop();
  });

  it('an unknown kit is the L-1 diagnostic unknown-kit, never a throw; the session stays idle', async () => {
    const session = roverSession(driveScenario());
    const result = await session.start(robotProject([driveStop()], undefined, { kit: { id: 'no-such-rover', version: '3' } }));
    expect(result).toEqual({
      ok: false,
      reason: 'layer',
      diagnostics: [{ severity: 'error', code: 'unknown-kit', message: 'The robot kit "no-such-rover@3" is not one this app knows.' }],
    });
    expect(session.getSnapshot()).toEqual({ status: 'idle', diagnostics: [], error: null, console: { lines: [], hidden: 0 }, world: null, slowerThanRealtime: false });
  });

  it('refuses a program whose servo takes the timer its motor needs (timer-claimed), and a program that does not compile', async () => {
    // A vendor kit with the left motor's EN on D10 (Timer1) and the buzzer on D5.
    const raw = structuredClone(refUnoRoverJson) as unknown as { version: string; ports: { id: string; pins: Record<string, string> }[] };
    raw.version = 'en-on-d10';
    for (const port of raw.ports) {
      if (port.id === 'M1') port.pins = { ...port.pins, EN: 'D10' };
      if (port.id === 'BZ1') port.pins = { PIN: 'D5' };
    }
    const vendorKit = createKitCatalog([raw], [unoR3Board]).get({ id: 'ref-uno-rover', version: 'en-on-d10' }) as Kit;
    const session = createRobotRunSession({ scenario: driveScenario(), kit: vendorKit, board: unoR3Board, registry });
    const kit = { id: 'ref-uno-rover', version: 'en-on-d10' };
    expect(await session.start(robotProject([motorSet('motorLeft', num(50)), servoSet('servo1', num(10), 'servo')], undefined, { kit }))).toEqual({
      ok: false,
      reason: 'compile',
      diagnostics: [
        { severity: 'error', code: 'timer-claimed', message: 'Port M1 needs PWM on D10, but the servo holds timer T1 there: the pin would stay LOW (contract U-48).', blockId: 'servo' },
      ],
    });
    expect(await session.start(robotProject([motorSet('motorLeft', num(50))], undefined, { kit }))).toEqual({ ok: true });
    // A failed start stops the run it would have replaced.
    const failed = await session.start(robotProject([setVar('x', driveStop('not-a-value'))], undefined, { kit }));
    expect(failed).toMatchObject({ ok: false, reason: 'compile' });
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('rejects a variant the scenario does not have; refuses a kit that is not the scenario’s or a board that is not the kit’s', async () => {
    const session = roverSession(driveScenario());
    await expect(session.start(robotProject([]), 2)).rejects.toThrow('Scenario "rb-drive-to-zone" has variants 0..1, not 2.');
    await expect(session.start(robotProject([]), 0.5)).rejects.toThrow(RangeError);
    const otherKit = { ...rover, id: 'other-rover' } as Kit;
    expect(() => createRobotRunSession({ scenario: driveScenario(), kit: otherKit, board: unoR3Board, registry })).toThrow('Scenario "rb-drive-to-zone" runs on the kit "ref-uno-rover", not "other-rover".');
    expect(() => createRobotRunSession({ scenario: driveScenario(), kit: rover, board: { ...unoR3Board, id: 'mega' }, registry })).toThrow(RangeError);
  });
});

describe('the program drives the robot (end to end)', () => {
  it('“drive forward 50 % for 2 s then stop” moves the rover about the distance the kit’s speed gives, into the zone; reach-zone passes', async () => {
    const session = roverSession(driveScenario(), { scorer: everyGoalScorer });
    await session.start(robotProject([driveMove('forward', num(50)), wait(num(2000)), driveStop()]));
    const startX = worldOf(session).robot.xCm;
    await session.runUntil(4);
    const world = worldOf(session);
    // The kit's speed at 50 %: duty 128 of 255; unloaded the wheel runs at ω₀·(u − T_f/T_s) (kit.ts DcMotorSpec), reached through
    // the lag τ, so 2 s of driving cover v·(2 s − τ).
    const spec = rover.modules.find((module) => module.role === 'motorLeft')!.spec as unknown as DcMotorSpec;
    const u = motorDuty(50) / 255;
    const speedCmS = ((spec.maxRpm * 2 * Math.PI) / 60) * (u - spec.gearFrictionNm / spec.stallTorqueNm) * spec.wheelRadiusCm;
    const expectedCm = speedCmS * (2 - spec.tauS);
    expect(speedCmS).toBeCloseTo(13.09, 2);
    const travelledCm = world.robot.xCm - startX;
    expect(Math.abs(travelledCm - expectedCm) / expectedCm).toBeLessThan(0.05);
    expect(Math.abs(world.robot.yCm - 50)).toBeLessThan(0.5);
    expect(Math.abs(world.robot.yawDeg)).toBeLessThan(1);
    // Stopped by the program (the motors coast): it ends inside the zone "target" (x 55..75).
    expect(world.robot.xCm).toBeGreaterThan(55);
    expect(world.robot.xCm).toBeLessThan(75);
    expect(world.status).toBe('finished');
    expect(world.score.goals.map((goal) => [goal.id, goal.passed])).toEqual([
      ['reach', true],
      ['reach-far', false],
    ]);
    expect(world.score.points).toBe(50);
    session.stop();
  });

  it('tells the block the program is in: the wait while it waits, none once it finished', async () => {
    const pause = wait(num(500));
    const session = roverSession(driveScenario());
    await session.start(robotProject([driveMove('forward', num(40), 'go'), pause, driveStop('halt')]));
    await session.runUntil(0.25);
    expect(worldOf(session).activeBlockId).toBe(pause.id);
    await session.runUntil(0.6);
    expect(worldOf(session)).toMatchObject({ activeBlockId: null, status: 'finished' });
    session.stop();
  });

  it('robot falling off arena yields outOfArena and finite poses', async () => {
    const session = roverSession(sandboxScenario({ sizeCm: [80, 60], start: { xCm: 40, yCm: 30, yawDeg: 0 } }), { scorer: everyGoalScorer });
    await session.start(robotProject([driveMove('forward', num(100)), wait(num(4000)), driveStop()]));
    const outs: boolean[] = [];
    for (let t = 0.25; t <= 4.25; t += 0.25) {
      await session.runUntil(t);
      const world = worldOf(session);
      outs.push(world.outOfArena);
      expect(numbers(world).filter(([, value]) => !Number.isFinite(value))).toEqual([]);
    }
    const world = worldOf(session);
    // It drove off the edge (x 80) and fell: out of the arena from then on (latched), far below the floor.
    expect(outs.indexOf(true)).toBeGreaterThan(0);
    expect(outs.slice(outs.indexOf(true)).every(Boolean)).toBe(true);
    expect(world.robot.zCm).toBeLessThan(-20);
    expect(world.status).toBe('finished');
    session.stop();
  });
});

describe('the pins read the world, and the world reads the pins', () => {
  it('the ultrasonic hears the wall ahead through pulseIn (cm·58 µs), and nothing in an open arena (400 cm)', async () => {
    const walled = roverSession(sandboxScenario({ wallAtCm: 120 }));
    await walled.start(robotProject([print(ultrasonic())]));
    const sensor = worldOf(walled).sensors.find((readout) => readout.role === 'ultrasonic');
    const cm = sensor?.kind === 'ultrasonic' ? sensor.cm : NaN;
    expect(cm).toBeGreaterThan(60);
    expect(cm).toBeLessThan(75);
    await walled.runUntil(0.1);
    expect(walled.getSnapshot().console.lines).toEqual([String(echoToCm(Math.trunc(cm * 58)))]);
    walled.stop();

    const open = roverSession(sandboxScenario());
    await open.start(robotProject([print(ultrasonic())]));
    await open.runUntil(0.1);
    expect(open.getSnapshot().console.lines).toEqual(['400']);
    open.stop();
  });

  it('a line sensor over the tape reads dark through line.dark (the LED shows it)', async () => {
    // Variant 0 of the fixture starts on the corner of the line loop: the centre sensor looks at the tape.
    const session = roverSession(allGoals());
    await session.start(robotProject([], [ifThen(lineDark('lineCenter'), [led('ON')], [led('OFF')])]));
    await session.runUntil(0.05);
    const world = worldOf(session);
    const center = world.sensors.find((readout) => readout.role === 'lineCenter');
    expect(center).toMatchObject({ kind: 'line-sensor', dark: true });
    expect(world.leds).toEqual({ led1: true });
    session.stop();
  });

  it('an input due in tick 0 is seen from the program’s first statement: the first tick at once or a frame later, headless or realtime, the same hash', async () => {
    // The reviewer's probe P7: the button is pressed at t = 0; the program drives while it is pressed.
    const scenario = sandboxScenario({ inputs: [{ atS: 0, role: 'button1', action: 'press' }] });
    const project = robotProject([], [ifThen(buttonPressed(), [driveMove('forward', num(100))], [driveStop()])]);
    const results: Record<string, string> = {};
    for (const mode of ['headless-at-once', 'realtime-later', 'realtime-at-once', 'headless-later'] as const) {
      const session = roverSession(scenario);
      expect(await session.start(project)).toEqual({ ok: true });
      if (mode.endsWith('later')) await new Promise((resolve) => setTimeout(resolve, 20));
      if (mode.startsWith('headless')) await session.runUntil(0.5);
      else while (worldOf(session).t < 0.5) await session.advance(TICK_MS);
      results[mode] = hashSnapshot(worldOf(session));
      session.stop();
    }
    expect(new Set(Object.values(results)).size).toBe(1);
    // A press of the UI between the start and the first tick is seen from the first statement too.
    const pressed: string[] = [];
    for (const wait of [0, 20]) {
      const session = roverSession(sandboxScenario());
      await session.start(project);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      session.pressButton('button1', true);
      await session.runUntil(0.5);
      pressed.push(hashSnapshot(worldOf(session)));
      session.stop();
    }
    expect(pressed[0]).toBe(pressed[1]);
  });

  it('the scenario’s inputs press the button at their atS; pressButton presses it from the next tick, but not during a check', async () => {
    const scenario = sandboxScenario({ inputs: [{ atS: 0.5, role: 'button1', action: 'press' }, { atS: 1, role: 'button1', action: 'release' }] });
    const program = robotProject([], [ifThen(buttonPressed(), [led('ON')], [led('OFF')])]);
    const session = roverSession(scenario);
    await session.start(program);
    const ledAt = async (tick: number) => {
      await session.runUntil(tick / PHYSICS_HZ);
      expect(worldOf(session).t).toBe(tick / PHYSICS_HZ);
      return worldOf(session).leds.led1;
    };
    // The press at 0.5 s is due in tick 60's interval: the program sees it then, and the world after that tick shows it.
    expect(await ledAt(60)).toBe(false);
    expect(await ledAt(61)).toBe(true);
    expect(await ledAt(120)).toBe(true);
    expect(await ledAt(121)).toBe(false);
    session.pressButton('button1', true);
    session.pressButton('nobody', true);
    expect(await ledAt(122)).toBe(true);
    session.pressButton('button1', false);
    expect(await ledAt(123)).toBe(false);

    await session.start(program, 0, { check: true });
    session.pressButton('button1', true);
    expect(await ledAt(30)).toBe(false);
    expect(await ledAt(61)).toBe(true);
    session.stop();
  });

  it('the servo, the LED and the buzzer reach the world, the snapshot and the goal frame', async () => {
    const { scorer, frames } = framesOf();
    const session = roverSession(sandboxScenario(), { scorer });
    await session.start(robotProject([servoSet('servo1', num(45)), led('ON'), buzzerTone(num(440), num(1000)), wait(num(2000))]));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ dtS: 0, frame: { tS: 0, leds: { led1: false }, buzzerHz: null } });
    await session.runUntil(0.5);
    const world = worldOf(session);
    expect(world.robot.servoDeg.servo1).toBeCloseTo(45, 1);
    expect(world.leds).toEqual({ led1: true });
    expect(world.pins.find((state) => state.pin === 'D10')).toMatchObject({ mode: 'OUTPUT', toneHz: 440 });
    expect(frames).toHaveLength(61);
    expect(frames.slice(1).every(({ dtS }) => dtS === 1 / PHYSICS_HZ)).toBe(true);
    expect(frames.at(-1)?.frame).toMatchObject({ tS: 0.5, leds: { led1: true }, buzzerHz: 440 });
    expect(frames.at(-1)?.frame.servoDeg.servo1).toBeCloseTo(45, 1);
    // The tone ends after its 1000 ms, while the program waits (its own clock stands still in the wait): in the tick that ends at or
    // after its end, tick 120 (1.0 s … 1.00833 s), since it began a few µs after t = 0.
    await session.runUntil(1);
    expect(frames.at(-1)?.frame).toMatchObject({ tS: 1, buzzerHz: 440 });
    await session.runUntil(121 / PHYSICS_HZ);
    expect(frames.at(-1)?.frame).toMatchObject({ tS: 121 / PHYSICS_HZ, buzzerHz: null });
    expect(worldOf(session).pins.find((state) => state.pin === 'D10')).toMatchObject({ mode: 'OUTPUT', level: 0, toneHz: null });
    session.stop();
  });

  it('keeps each warning once per code, message and block, and the program’s prints', async () => {
    const session = roverSession(sandboxScenario());
    await session.start(robotProject([repeat(num(3), [setVar('x', unoDivide(num(7), num(0), 'first')), setVar('y', unoDivide(num(1), num(0), 'second'))]), print(num(12))]));
    await session.runUntil(0.1);
    const snapshot = session.getSnapshot();
    const message = 'A division or a remainder by 0 gave 0, as on the board.';
    expect(snapshot.diagnostics).toEqual([
      { severity: 'warning', code: 'division-by-zero', message, blockId: 'first' },
      { severity: 'warning', code: 'division-by-zero', message, blockId: 'second' },
    ]);
    expect(snapshot.console.lines).toEqual(['12']);
    expect(snapshot.status).toBe('finished');
    session.stop();
  });
});

describe('driving the ticks', () => {
  it('advance runs the whole ticks owed, at most 8 a frame, and says slower than real time beyond; one snapshot per call', async () => {
    const session = roverSession(driveScenario());
    await session.start(avoider());
    const seen = published(session);
    const tick = () => Math.round(worldOf(session).t * PHYSICS_HZ);
    await session.advance(1000 / 60);
    expect([tick(), seen.length]).toEqual([2, 1]);
    // Half a tick, twice: owed time adds up.
    await session.advance(TICK_MS / 2);
    expect([tick(), seen.length]).toEqual([2, 1]);
    await session.advance(TICK_MS / 2);
    expect([tick(), seen.length]).toEqual([3, 2]);
    // 4× at 60 fps is the most a frame runs.
    await session.advance(1000 / 60, 4);
    expect([tick(), session.getSnapshot().slowerThanRealtime]).toEqual([3 + MAX_TICKS_PER_FRAME, false]);
    // A frame of a whole second (a stalled machine, a tab coming back): 8 ticks, the rest dropped, and the badge.
    await session.advance(1000);
    expect([tick(), session.getSnapshot().slowerThanRealtime]).toEqual([3 + 2 * MAX_TICKS_PER_FRAME, true]);
    await session.advance(1000 / 60);
    expect([tick(), session.getSnapshot().slowerThanRealtime]).toEqual([5 + 2 * MAX_TICKS_PER_FRAME, false]);
    expect(seen).toHaveLength(5);
    expect(() => session.advance(-1)).toThrow(RangeError);
    expect(() => session.advance(16, 0)).toThrow(RangeError);
    session.stop();
  });

  it('4× on a 60 Hz display with its jitter (frames of 16.5–16.9 ms) never says slower than real time and drops no tick; a slow host does', async () => {
    const session = roverSession(driveScenario());
    await session.start(avoider());
    let seed = 1;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let wallMs = 0;
    let flagged = 0;
    const ticksRun: number[] = [];
    for (let frame = 0; frame < 600; frame++) {
      const ms = 16.5 + random() * 0.4;
      wallMs += ms;
      const before = Math.round(worldOf(session).t * PHYSICS_HZ);
      await session.advance(ms, 4);
      ticksRun.push(Math.round(worldOf(session).t * PHYSICS_HZ) - before);
      if (session.getSnapshot().slowerThanRealtime) flagged += 1;
    }
    expect(flagged).toBe(0);
    // Every tick owed ran: what is left is less than one tick.
    expect(Math.round(worldOf(session).t * PHYSICS_HZ)).toBe(Math.floor((wallMs * 4) / TICK_MS + 1e-6));
    expect(Math.max(...ticksRun)).toBe(MAX_TICKS_PER_FRAME + JITTER_TICKS);
    // A host that draws a frame every 25 ms at 4× owes 12 ticks a frame: 8 run, the rest is dropped, and it says so.
    const slow: [number, boolean][] = [];
    for (let frame = 0; frame < 10; frame++) {
      const before = Math.round(worldOf(session).t * PHYSICS_HZ);
      await session.advance(25, 4);
      slow.push([Math.round(worldOf(session).t * PHYSICS_HZ) - before, session.getSnapshot().slowerThanRealtime]);
    }
    expect(slow).toEqual(Array.from({ length: 10 }, () => [MAX_TICKS_PER_FRAME, true]));
    // One frame owing 9 ticks runs them all; 10 is beyond the allowance.
    await session.advance(9 * TICK_MS);
    expect(session.getSnapshot().slowerThanRealtime).toBe(false);
    const before = Math.round(worldOf(session).t * PHYSICS_HZ);
    await session.advance(10 * TICK_MS);
    expect([Math.round(worldOf(session).t * PHYSICS_HZ) - before, session.getSnapshot().slowerThanRealtime]).toEqual([MAX_TICKS_PER_FRAME, true]);
    session.stop();
  });

  it('a headless run leaves nothing owed: time owed before it, and asked for during it, is not run afterwards', async () => {
    const session = roverSession(driveScenario());
    await session.start(avoider());
    // Five ms (less than a tick) are owed, then a headless run; four ms more would make a tick if the five were still owed.
    await session.advance(5);
    expect(worldOf(session).t).toBe(0);
    const headless = session.runUntil(0.1);
    void session.advance(500);
    await headless;
    expect(worldOf(session).t).toBe(0.1);
    await session.advance(4);
    expect(worldOf(session).t).toBe(0.1);
    await session.advance(TICK_MS);
    expect(worldOf(session).t).toBe(13 / PHYSICS_HZ);
    session.stop();
  });

  it('once the ticks have stopped (an error), advance and pressButton change nothing and publish nothing', async () => {
    const session = roverSession(driveScenario());
    // A wait longer than the contract allows: a fault of the program (out-of-domain) in its first statement.
    await session.start(robotProject([wait(unoDivide(num(70000), num(1)))]));
    await session.runUntil(0.1);
    const ended = session.getSnapshot();
    expect(ended).toMatchObject({ status: 'error', error: { code: 'out-of-domain' } });
    const seen = published(session);
    for (let frame = 0; frame < 100; frame++) {
      session.pressButton('button1', frame % 2 === 0);
      await session.advance(1000, 4);
    }
    await session.runUntil(10);
    expect(seen).toEqual([]);
    expect(session.getSnapshot()).toBe(ended);
    session.stop();
  });

  it('the result does not depend on how the ticks are driven: frames at 1×, at 4×, of random lengths, and headless hash the same', async () => {
    const ticks = 3 * PHYSICS_HZ;
    const hashes: string[] = [];
    const drive = async (session: RobotRunSession, nextFrame: () => { wallMs: number; speed: number }) => {
      while (Math.round(worldOf(session).t * PHYSICS_HZ) < ticks) {
        const left = ticks - Math.round(worldOf(session).t * PHYSICS_HZ);
        const { wallMs, speed } = nextFrame();
        // The last frame stops on the tick.
        await session.advance(Math.min(wallMs * speed, left * TICK_MS) / speed, speed);
      }
    };
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    // One project: its block ids are in the snapshot (the active block).
    const project = avoider();
    for (const mode of ['1x', '4x', 'random', 'headless'] as const) {
      const session = roverSession(allGoals(), { scorer: everyGoalScorer });
      await session.start(project, 1);
      if (mode === 'headless') await session.runUntil(3);
      else if (mode === '1x') await drive(session, () => ({ wallMs: 1000 / 60, speed: 1 }));
      else if (mode === '4x') await drive(session, () => ({ wallMs: 1000 / 60, speed: 4 }));
      else await drive(session, () => ({ wallMs: 1 + random() * 60, speed: 0.5 + random() * 3.5 }));
      expect(worldOf(session).t).toBe(3);
      hashes.push(hashSnapshot(worldOf(session)));
      session.stop();
    }
    expect(new Set(hashes).size).toBe(1);
  });

  it('runUntil gives the event loop a turn through a MessageChannel while it runs, and publishes once at the end', async () => {
    let wall = 0;
    // A wall clock that moves 1 ms per read: the 8 ms slice ends every few ticks.
    const session = roverSession(driveScenario(), { wallNow: () => (wall += 1) });
    await session.start(avoider());
    const seen = published(session);
    let turns = 0;
    const beat = setInterval(() => void (turns += 1), 0);
    await session.runUntil(1);
    clearInterval(beat);
    expect(worldOf(session).t).toBe(1);
    expect(seen).toHaveLength(1);
    expect(turns).toBeGreaterThan(0);
    expect(() => session.runUntil(Number.NaN)).toThrow(RangeError);
    session.stop();
  });
});

describe('resetRobot', () => {
  it('resetRobot hash equals fresh start', async () => {
    const run = async (session: RobotRunSession) => {
      const hashes = [hashSnapshot(worldOf(session))];
      for (const t of [0.5, 2]) {
        await session.runUntil(t);
        hashes.push(hashSnapshot(worldOf(session)));
      }
      return hashes;
    };
    // Variant 1: a jittered start and obstacles, the avoider reading the ultrasonic and sweeping the servo. One project: its block
    // ids are in the snapshot (the active block).
    const project = avoider();
    const fresh = roverSession(allGoals(), { scorer: everyGoalScorer });
    await fresh.start(project, 1);
    const expected = await run(fresh);
    fresh.stop();

    const session = roverSession(allGoals(), { scorer: everyGoalScorer });
    await session.start(project, 1);
    await session.runUntil(1.3);
    session.pressButton('button1', true);
    await session.advance(50);
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(worldOf(session).t).toBe(0);
    expect(await run(session)).toEqual(expected);
    // Again, from a run that finished its time.
    expect(await session.resetRobot()).toEqual({ ok: true });
    expect(await run(session)).toEqual(expected);
    expect(new Set(expected).size).toBe(3);
    session.stop();
    expect(await session.resetRobot()).toEqual({ ok: false, reason: 'idle', diagnostics: [] });
  });
});

describe('stop and the latest call', () => {
  it('stop drops the run: idle, no world; advance and runUntil do nothing', async () => {
    const session = roverSession(driveScenario());
    await session.start(avoider());
    await session.runUntil(0.2);
    const seen = published(session);
    session.stop();
    expect(seen.map((snapshot) => snapshot.status)).toEqual(['idle']);
    expect(session.getSnapshot().world).toBeNull();
    await session.advance(100);
    await session.runUntil(1);
    session.stop();
    expect(seen).toHaveLength(1);
  });

  it('a stop from the scorer, between a tick’s step and the next tick, publishes no further snapshot', async () => {
    const holder: { session?: RobotRunSession } = {};
    let updates = 0;
    const scorer: RobotScorerFactory = () => ({
      update() {
        updates += 1;
        // Tick 30 of the run (the first update is tick 0's).
        if (updates === 31) holder.session?.stop();
      },
      score: () => ({ points: 0, maxScore: null, goals: [] }),
    });
    const session = roverSession(driveScenario(), { scorer });
    holder.session = session;
    await session.start(avoider());
    const seen = published(session);
    await session.runUntil(2);
    expect(seen.map((snapshot) => snapshot.status)).toEqual(['idle']);
    expect(updates).toBe(31);
    // A frame asked for after the stop runs nothing either.
    await session.advance(100);
    expect(seen).toHaveLength(1);
  });

  it('a scorer that throws ends the run in an error with a diagnostic, never the tick loop', async () => {
    let updates = 0;
    const failing = roverSession(driveScenario(), {
      scorer: () => ({
        update() {
          // The first update is tick 0's; the sixth comes after the step of tick 4.
          if (++updates === 6) throw new Error('A goal failed.');
        },
        score: () => ({ points: 0, maxScore: null, goals: [] }),
      }),
    });
    await failing.start(avoider());
    await failing.runUntil(1);
    const message = 'The robot simulation stopped: A goal failed.';
    expect(failing.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'internal-error', message }, world: { t: 5 / PHYSICS_HZ, status: 'error' } });
    expect(failing.getSnapshot().diagnostics).toEqual([{ severity: 'error', code: 'internal-error', message }]);
    failing.stop();

    // A score that cannot be read once the run runs ends it the same way.
    let scores = 0;
    const unreadable = roverSession(driveScenario(), {
      scorer: () => ({
        update() {},
        score() {
          if (++scores === 2) throw new Error('No score.');
          return { points: 0, maxScore: null, goals: [] };
        },
      }),
    });
    expect(await unreadable.start(avoider())).toEqual({ ok: true });
    await unreadable.runUntil(0.5);
    expect(unreadable.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'internal-error', message: 'The robot simulation stopped: No score.' } });
    unreadable.stop();
  });

  it('a scorer that cannot be made, fails on tick 0 or gives no first score fails the start (scorer-error); the session is idle', async () => {
    const failure = (message: string) => ({ ok: false, reason: 'scorer-error', diagnostics: [{ severity: 'error', code: 'internal-error', message: `The run's scorer failed: ${message}` }] });
    const scorers: [RobotScorerFactory, string][] = [
      [() => { throw new Error('No scorer.'); }, 'No scorer.'],
      [() => ({ update() { throw new Error('Tick 0 failed.'); }, score: () => ({ points: 0, maxScore: null, goals: [] }) }), 'Tick 0 failed.'],
      [() => ({ update() {}, score() { throw new Error('No score.'); } }), 'No score.'],
    ];
    for (const [scorer, message] of scorers) {
      const session = roverSession(driveScenario(), { scorer });
      const seen = published(session);
      expect(await session.start(avoider())).toEqual(failure(message));
      expect(session.getSnapshot().status).toBe('idle');
      expect(seen).toEqual([]);
      // A start that fails stops the run it would have replaced.
      const replacing = roverSession(driveScenario(), { scorer: (run) => (run.variantIndex === 1 ? scorer(run) : everyGoalScorer(run)) });
      expect(await replacing.start(avoider())).toEqual({ ok: true });
      expect(await replacing.start(avoider(), 1)).toEqual(failure(message));
      expect(replacing.getSnapshot()).toMatchObject({ status: 'idle', world: null });
    }
  });

  it('a start while another builds its world: the latest wins, the older one is superseded and publishes nothing', async () => {
    const session = roverSession(driveScenario());
    const seen = published(session);
    const first = session.start(robotProject([print(num(1))]));
    const second = session.start(robotProject([print(num(2))]), 1);
    expect(await first).toEqual({ ok: false, reason: 'superseded', diagnostics: [] });
    expect(await second).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    await session.runUntil(0.1);
    expect(session.getSnapshot().console.lines).toEqual(['2']);
    // A stop while a start builds its world supersedes it.
    const third = session.start(avoider());
    session.stop();
    expect(await third).toEqual({ ok: false, reason: 'superseded', diagnostics: [] });
    expect(session.getSnapshot().status).toBe('idle');
  });
});
