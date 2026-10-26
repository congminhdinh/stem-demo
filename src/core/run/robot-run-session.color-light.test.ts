import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { productionKits, type Kit } from '../hardware';
import type { LightIntegral, Rgbc } from '../hardware/devices/tcs34725';
import { claw, colorIs, colorRaw, driveMove, driveStop, irDetect, lift, registry } from '../program/__fixtures__/uno-blocks';
import { not, num, print, wait, whileLoop, type Json } from '../program/__fixtures__/ybc-blocks';
import type { Scenario } from '../scenario/scenario';
import { parseArena } from '../world/arena/arena-schema';
import { bodyPalette } from '../world/arena/body-colors';
import { initPhysics, PHYSICS_HZ, type PhysicsWorld } from '../world/rapier';
import type { World } from '../world/world';
import { robotProject, sandboxScenario, unoR3Board, worldOf } from './__fixtures__/robot-session';
import { createRobotRunSession } from './robot-run-session';

// N19 B4 (plan §4.4, §4.7, §5 Review Focus 2): the run session's colour sensor. The session keeps the world's light of each tick (tick 0
// when the run is made, then each step) and puts a TCS34725 register model on the virtual UNO's bus whose integration windows read that
// history. A gripper car on a sandbox floor, a cube of a palette colour 22 cm ahead, runs block programs on ref-uno-gripper@0 (no gripper
// scenario key yet: task D4; the kit is passed to the session).
//
// The probes: every world the session builds (its light, tick by tick, logged from its own measure), every light a register model asks the
// history for (with the world's tick then), and, for every data byte the program reads, the window whose counts it carries.

type Ask = { readonly fromUs: number; readonly toUs: number; readonly tick: number; readonly answer: Rgbc };
type RunProbe = { world: World; lights: Rgbc[]; asks: Ask[]; reads: { readonly toUs: number; readonly answer: Rgbc }[]; last: { toUs: number; answer: Rgbc } | null };

const probe = vi.hoisted(() => ({
  runs: [] as RunProbe[],
  physics: [] as PhysicsWorld[],
  /** When set, the colour sensor's light of each tick is this instead of the world's (hit and distance stay the world's). */
  light: null as ((tick: number) => Rgbc) | null,
}));

vi.mock('../world/rapier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../world/rapier')>();
  return {
    ...actual,
    createPhysicsWorld: () => {
      const world = actual.createPhysicsWorld();
      probe.physics.push(world);
      return world;
    },
  };
});

vi.mock('../world/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../world/world')>();
  return {
    ...actual,
    createScenarioWorld: async (...args: Parameters<typeof actual.createScenarioWorld>) => {
      const world: World = await actual.createScenarioWorld(...args);
      const synthetic = probe.light;
      if (synthetic !== null) {
        const { sense } = world;
        Object.defineProperty(world, 'sense', { value: { ...sense, color: (role: string) => ({ ...sense.color(role), light: synthetic(world.tick) }) } });
      }
      const run: RunProbe = { world, lights: [world.sense.color('color1').light], asks: [], reads: [], last: null };
      probe.runs.push(run);
      const step = world.step.bind(world);
      world.step = (dt) => {
        step(dt);
        run.lights.push(world.sense.color('color1').light);
      };
      return world;
    },
  };
});

vi.mock('../hardware/devices/tcs34725', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware/devices/tcs34725')>();
  return {
    ...actual,
    createTcs34725: (light: LightIntegral) => {
      const run = probe.runs.at(-1)!;
      const device = actual.createTcs34725((fromUs, toUs) => {
        const answer = light(fromUs, toUs);
        run.asks.push({ fromUs, toUs, tick: run.world.tick, answer });
        run.last = { toUs, answer };
        return answer;
      });
      return {
        ...device,
        read(nowUs: number) {
          const byte = device.read(nowUs);
          if (run.last !== null) run.reads.push(run.last);
          return byte;
        },
      };
    },
  };
});

beforeAll(() => initPhysics(), 30_000);
afterEach(() => {
  probe.light = null;
});

/** A light that changes every tick (whole counts per second), so a window's counts tell exactly which ticks it averaged. */
const changing = (tick: number): Rgbc => {
  const r = 2000 + ((tick * 37) % 5000);
  const g = 1000 + ((tick * 53) % 3000);
  const b = 1500 + ((tick * 71) % 2000);
  return { c: r + g + b, r, g, b };
};

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const DT_US = 1_000_000 / PHYSICS_HZ;
const LEAD_US = 1123.8125;

/** The sandbox's floor with a 4 cm cube of `color` 22 cm ahead of the robot, for the gripper car. */
function cubeScenario(color: string): Scenario {
  const floor = sandboxScenario({ sizeCm: [200, 100], start: { xCm: 40, yCm: 50, yawDeg: 0 } });
  const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [62, 50], sizeCm: [4, 4, 4], massG: 15, color }] });
  return { ...floor, kit: gripperKit.id, arena };
}

async function runProgram(color: string, onStart: Json[], forever: Json[] | undefined, untilS: number, profile: 'uno-basic' | 'uno-advanced' = 'uno-basic') {
  const session = createRobotRunSession({ scenario: cubeScenario(color), kit: gripperKit, board: unoR3Board, registry });
  const started = await session.start(robotProject(onStart, forever, { profile, kit: { id: gripperKit.id, version: gripperKit.version } }));
  expect(started).toEqual({ ok: true });
  await session.runUntil(untilS);
  return { session, run: probe.runs.at(-1)!, lines: session.getSnapshot().console.lines };
}

/** The window rule restated (light-history.ts): the mean of the ticks wholly inside [from, to), times its length, floored. */
function oracle(lights: readonly Rgbc[], fromUs: number, toUs: number): Rgbc {
  const inside = lights.map((light, tick) => ({ light, tick })).filter(({ tick }) => tick * DT_US >= fromUs - 1e-6 && (tick + 1) * DT_US <= toUs + 1e-6);
  const of = (key: keyof Rgbc) => Math.floor((inside.reduce((sum, { light }) => sum + light[key], 0) * (toUs - fromUs)) / inside.length);
  return { c: of('c'), r: of('r'), g: of('g'), b: of('b') };
}

/** Lower and open, then drive on at half speed (through the cube and on): the light changes tick by tick. */
const driveThrough = [lift('DOWN'), claw('OPEN'), wait(num(400)), driveMove('forward', num(50))];

describe('the run session’s colour sensor (N19 B4)', () => {
  it('light history covers world.t + dt + 1124 µs: every window the bus closes is decided by the ticks the session had recorded', async () => {
    // A light that changes every tick: a window short of a tick the world had not measured yet would read other counts than its ticks'.
    probe.light = changing;
    const changed = await runProgram(bodyPalette.red, driveThrough, [print(colorRaw('clear'))], 10, 'uno-advanced');
    changed.session.stop();
    const late = changed.run.asks.filter((ask) => ask.toUs > (ask.tick + 1) * DT_US);
    expect(late.length).toBeGreaterThan(3);
    expect(changed.run.asks.filter((ask) => !(ask.toUs < ask.tick * DT_US + DT_US + LEAD_US))).toEqual([]);
    expect(changed.run.asks.filter((ask) => JSON.stringify(oracle(changed.run.lights, ask.fromUs, ask.toUs)) !== JSON.stringify(ask.answer))).toEqual([]);
    probe.light = null;
    // The world's own light, the red cube coming close.
    const { session, run, lines } = await runProgram(bodyPalette.red, driveThrough, [print(colorRaw('clear'))], 3, 'uno-advanced');
    session.stop();
    expect(run.asks.length).toBeGreaterThan(50);
    // The bus never closes a window past world.t + dt + 1123.8125 µs (A2+A3's bound, A4's session test)…
    expect(run.asks.filter((ask) => !(ask.toUs < ask.tick * DT_US + DT_US + LEAD_US))).toEqual([]);
    // …and some it closes after their tick has ended, the world still at it: the window then holds no tick the world has not measured.
    expect(run.asks.filter((ask) => ask.toUs > (ask.tick + 1) * DT_US).length).toBeGreaterThan(0);
    // Every answer is the window's ticks in the world's own log, all of which the session had recorded when the model asked.
    const wrong = run.asks.filter((ask) => {
      const expected = oracle(run.lights, ask.fromUs, ask.toUs);
      return expected.c !== ask.answer.c || expected.r !== ask.answer.r || expected.g !== ask.answer.g || expected.b !== ask.answer.b;
    });
    expect(wrong).toEqual([]);
    // The light changed: the program read the ambient first (600 counts per second over 50.4 ms: 120 at 4×), then the red cube coming close.
    expect(run.reads[0]!.answer).toEqual({ c: 600 * 50_400, r: 200 * 50_400, g: 200 * 50_400, b: 200 * 50_400 });
    expect(new Set(run.reads.map((read) => read.answer.c)).size).toBeGreaterThan(5);
    expect(lines.length).toBeGreaterThan(100);
  }, 120_000);

  it('the colour reading is the same whenever the program reads within a window', async () => {
    probe.light = changing;
    const polled = await runProgram(bodyPalette.blue, driveThrough, [print(colorRaw('clear'))], 10, 'uno-advanced');
    polled.session.stop();
    // The polling program closed some windows after their tick had ended, the world still at it.
    expect(polled.run.asks.filter((ask) => ask.toUs > (ask.tick + 1) * DT_US).length).toBeGreaterThan(3);
    const lazy = await runProgram(bodyPalette.blue, driveThrough, [wait(num(37)), print(colorRaw('clear'))], 10, 'uno-advanced');
    lazy.session.stop();
    // The same world (reads move nothing): the same light tick for tick.
    expect(lazy.run.lights).toEqual(polled.run.lights.slice(0, lazy.run.lights.length));
    const polledByWindow = new Map(polled.run.reads.map((read) => [read.toUs, read.answer]));
    const lazyWindows = [...new Map(lazy.run.reads.map((read) => [read.toUs, read.answer]))];
    expect(lazyWindows.length).toBeGreaterThan(150);
    // Each window the lazy program read (37 ms and more after it closed), the polling one read too, at once: the same counts.
    expect(lazyWindows.filter(([toUs, answer]) => JSON.stringify(polledByWindow.get(toUs)) !== JSON.stringify(answer))).toEqual([]);
    expect(new Set(lazy.lines).size).toBeGreaterThan(5);
  }, 120_000);

  it('a program reads each palette colour’s class through the blocks: creep up until the IR sees the cube, stop, ask each colour', async () => {
    const read: string[] = [];
    for (const [name, color] of Object.entries(bodyPalette)) {
      const program = [
        ...driveThrough.slice(0, 3),
        driveMove('forward', num(45)),
        whileLoop(not(irDetect()), []),
        driveStop(),
        wait(num(300)),
        ...(['red', 'green', 'blue', 'yellow'] as const).map((asked) => print(colorIs(asked))),
      ];
      const { session, lines } = await runProgram(color, program, undefined, 4);
      const sensor = worldOf(session).sensors.find((readout) => readout.kind === 'color-sensor');
      session.stop();
      // The IR sees the cube's face 2 cm ahead of it; the car stops a little nearer.
      expect(sensor?.kind === 'color-sensor' && sensor.hitId === 'cube' && sensor.distanceCm! > 1.2 && sensor.distanceCm! <= 2).toBe(true);
      read.push(`${name}: ${lines.join(' ')}`);
    }
    expect(read).toEqual(['red: 1 0 0 0', 'green: 0 1 0 0', 'blue: 0 0 1 0', 'yellow: 0 0 0 1']);
  }, 120_000);

  it('stop while holding leaves no impulse joint after dispose', async () => {
    probe.physics.length = 0;
    const pick = [...driveThrough.slice(0, 3), driveMove('forward', num(45)), whileLoop(not(irDetect()), []), driveStop(), wait(num(300)), claw('CLOSE'), wait(num(600)), lift('UP')];
    const { session } = await runProgram(bodyPalette.yellow, pick, undefined, 4);
    expect(worldOf(session).robot.gripper?.heldId).toBe('cube');
    const physics = probe.physics.at(-1)!;
    // The gripper's five joints and the one that holds the cube.
    expect(physics.impulseJoints.len()).toBe(6);
    let jointsAtFree = -1;
    const free = physics.free.bind(physics);
    physics.free = () => {
      jointsAtFree = physics.impulseJoints.len();
      free();
    };
    session.stop();
    expect(jointsAtFree).toBe(5);
    expect(session.getSnapshot().status).toBe('idle');
  }, 120_000);
});
