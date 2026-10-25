import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { echoToCm, unoR3Board } from '../hardware';
import { ultrasonic } from '../program/__fixtures__/uno-blocks';
import { getVar, num, print, setVar, wait } from '../program/__fixtures__/ybc-blocks';
import { initPhysics, PHYSICS_HZ } from '../world/rapier';
import type { World } from '../world/world';
import { driveScenario, published, robotProject, roverSession, sandboxScenario, worldOf } from './__fixtures__/robot-session';
import type { VirtualScheduler } from './virtual-clock';

// N18 R3.6, robot plan §6 Review Focus 1 and 3: the session's ticks never overlap, a stop mid-tick ends everything at once, a failure
// of the simulation (a timer task that throws, a step the world refuses) ends the run in an error instead of crashing the tick loop,
// and the program never reads the world more than dt ahead of it, with the real ultrasonic. The real scheduler and world are wrapped
// (vi.mock) only to watch them and to fail them on cue.

const probe = vi.hoisted(() => ({
  schedulers: [] as VirtualScheduler[],
  worlds: [] as World[],
  /** Called as advanceTo starts, before the real one. */
  onAdvanceTo: undefined as ((tMs: number, scheduler: VirtualScheduler) => void) | undefined,
  /** Called before each real step. */
  onStep: undefined as ((world: World) => void) | undefined,
  active: 0,
  maxActive: 0,
  disposed: 0,
  /** Steps and actuator targets given to a world after it was disposed. */
  usedAfterDispose: 0,
  /** Each echo the world gives pulseIn: the program clock then, the world's time, the distance. */
  reads: [] as { clockMs: number; worldMs: number; cm: number }[],
  /** Each module op the program starts (`ultrasonic.cm`): the program clock and the world's time. */
  ops: [] as { clockMs: number; worldMs: number }[],
}));

vi.mock('../hardware/binding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware/binding')>();
  return {
    ...actual,
    createProgramIO: (...args: Parameters<typeof actual.createProgramIO>) => {
      const io = actual.createProgramIO(...args);
      const read = io.modules.read.bind(io.modules);
      io.modules.read = (role, op) => {
        const world = probe.worlds.at(-1);
        probe.ops.push({ clockMs: probe.schedulers.at(-1)?.programClock.now() ?? Number.NaN, worldMs: world === undefined ? Number.NaN : (world.tick * 1000) / PHYSICS_HZ });
        return read(role, op);
      };
      return io;
    },
  };
});

vi.mock('./virtual-clock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./virtual-clock')>();
  return {
    ...actual,
    createVirtualScheduler: (options: Parameters<typeof actual.createVirtualScheduler>[0]) => {
      const scheduler = actual.createVirtualScheduler(options);
      const watched: VirtualScheduler = {
        ...scheduler,
        async advanceTo(tMs) {
          probe.active += 1;
          probe.maxActive = Math.max(probe.maxActive, probe.active);
          try {
            probe.onAdvanceTo?.(tMs, scheduler);
            await scheduler.advanceTo(tMs);
          } finally {
            probe.active -= 1;
          }
        },
      };
      probe.schedulers.push(watched);
      return watched;
    },
  };
});

vi.mock('../world/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../world/world')>();
  return {
    ...actual,
    createScenarioWorld: async (...args: Parameters<typeof actual.createScenarioWorld>) => {
      const world = await actual.createScenarioWorld(...args);
      let disposed = false;
      // The world's getters and methods are closures: a wrapper that inherits them reads the same world.
      const watched = Object.create(world) as World;
      Object.defineProperties(watched, {
        step: {
          value: (dt: number) => {
            if (disposed) probe.usedAfterDispose += 1;
            probe.onStep?.(world);
            world.step(dt);
          },
        },
        applyActuators: {
          value: (targets: Parameters<World['applyActuators']>[0]) => {
            if (disposed) probe.usedAfterDispose += 1;
            world.applyActuators(targets);
          },
        },
        dispose: {
          value: () => {
            disposed = true;
            probe.disposed += 1;
            world.dispose();
          },
        },
        sense: {
          value: {
            ...world.sense,
            ultrasonic(role: string) {
              const reading = world.sense.ultrasonic(role);
              const clock = probe.schedulers.at(-1)?.programClock.now() ?? Number.NaN;
              probe.reads.push({ clockMs: clock, worldMs: (world.tick * 1000) / PHYSICS_HZ, cm: reading.cm });
              return reading;
            },
          },
        },
      });
      probe.worlds.push(watched);
      return watched;
    },
  };
});

beforeAll(() => initPhysics(), 30_000);

beforeEach(() => {
  probe.schedulers.length = 0;
  probe.worlds.length = 0;
  probe.onAdvanceTo = undefined;
  probe.onStep = undefined;
  probe.active = 0;
  probe.maxActive = 0;
  probe.disposed = 0;
  probe.usedAfterDispose = 0;
  probe.reads.length = 0;
  probe.ops.length = 0;
});

const TICK_MS = 1000 / PHYSICS_HZ;
const dt = TICK_MS;
/** The world's time of tick k, ms, as the session computes it. */
const tickMs = (k: number) => (k * 1000) / PHYSICS_HZ;
const tickOf = (session: ReturnType<typeof roverSession>) => Math.round(worldOf(session).t * PHYSICS_HZ);
const looper = () => robotProject([], [setVar('x', ultrasonic())]);

describe('one tick at a time', () => {
  it('overlapping advance calls never run ticks concurrently', async () => {
    const session = roverSession(driveScenario());
    await session.start(looper());
    const seen = published(session);
    // A frame of 50 ms (6 ticks); two calls while it runs add their time to it; a headless run waits for it; a frame asked for
    // during the headless run adds its time too.
    // The frame starts after the calls that ask for it in the same turn: the time of the three before the headless run (50 + 50 +
    // 66.7 ms, 20 ticks) is owed to it, so it runs 8 ticks, drops 12 and says it is slower than real time. The headless run goes on to
    // 0.5 s; the advance asked for after it adds no time, and once it ends nothing is owed and the run is not slower than real time.
    const calls = [session.advance(50), session.advance(50), session.advance(1000 / 60, 4), session.runUntil(0.5), session.advance(20)];
    expect(calls[1]).toBe(calls[0]);
    expect(calls[2]).toBe(calls[0]);
    expect(calls[4]).toBe(calls[3]);
    await Promise.all(calls);
    expect(probe.maxActive).toBe(1);
    expect(seen.map((snapshot) => [Math.round(snapshot.world!.t * PHYSICS_HZ), snapshot.slowerThanRealtime])).toEqual([
      [8, true],
      [60, false],
    ]);
    await session.advance(0);
    expect([tickOf(session), session.getSnapshot().slowerThanRealtime]).toEqual([60, false]);
    await session.advance(3 * TICK_MS);
    expect(tickOf(session)).toBe(63);
    expect(probe.maxActive).toBe(1);
    session.stop();
  });
});

describe('stop and failures inside a tick', () => {
  // Mid-tick: the stop comes while the program runs its part of tick 10 (inside advanceTo), before the tick's step.
  it('stop mid-tick publishes no further snapshot', async () => {
    const session = roverSession(driveScenario());
    await session.start(looper());
    const seen = published(session);
    probe.onAdvanceTo = (tMs) => {
      if (tMs === tickMs(10)) session.stop();
    };
    await session.runUntil(1);
    expect(seen.map((snapshot) => snapshot.status)).toEqual(['idle']);
    // The world stopped at tick 10 and was disposed; nothing ran after the stop.
    expect([probe.worlds[0]?.tick, probe.disposed, probe.usedAfterDispose]).toEqual([10, 1, 0]);
    await session.advance(100);
    expect(seen).toHaveLength(1);
  });

  it('a stop from inside the program (its budget step reading the wall clock) during runUntil publishes nothing more and touches no disposed world', async () => {
    // The virtual budget reads the wall clock every 256 steps of the program: the stop comes from inside the program's statement.
    let reads = 0;
    const holder: { session?: ReturnType<typeof roverSession> } = {};
    const session = roverSession(driveScenario(), {
      wallNow: () => {
        reads += 1;
        if (reads === 400) holder.session?.stop();
        return reads * 0.01;
      },
    });
    holder.session = session;
    await session.start(robotProject([], [setVar('x', num(1))]));
    const seen = published(session);
    await session.runUntil(5);
    expect(reads).toBeGreaterThanOrEqual(400);
    expect(seen.map((snapshot) => snapshot.status)).toEqual(['idle']);
    expect(probe.disposed).toBe(1);
    expect(probe.worlds[0]!.tick).toBeLessThan(5 * PHYSICS_HZ);
    expect(probe.usedAfterDispose).toBe(0);
  });

  it('a stop during a headless run’s turn of the event loop publishes nothing more', async () => {
    let wall = 0;
    // Every read of the wall clock is 10 ms later: the run gives the event loop a turn after every tick.
    const session = roverSession(driveScenario(), { wallNow: () => (wall += 10) });
    await session.start(looper());
    const seen = published(session);
    setTimeout(() => session.stop(), 0);
    await session.runUntil(30);
    expect(seen.map((snapshot) => snapshot.status)).toEqual(['idle']);
    expect(probe.worlds[0]?.tick).toBeLessThan(30 * PHYSICS_HZ);
    expect(probe.disposed).toBe(1);
  });

  it('a timer task that throws (a charge while the program waits) ends the run in an error with a diagnostic; the loop lives on', async () => {
    const session = roverSession(driveScenario());
    await session.start(robotProject([wait(num(1000)), print(num(1))]));
    probe.onAdvanceTo = (tMs, scheduler) => {
      // A task of the run's timers that charges the program clock: the program is in its wait, so the charge throws (virtual-clock.ts).
      if (tMs === tickMs(5)) scheduler.timers.setTimeout(() => scheduler.programClock.charge(1), 1);
    };
    await session.runUntil(1);
    const message = 'The robot simulation stopped: The program clock is charged only while the program runs (its own Arduino calls), never while it is blocked.';
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ status: 'error', error: { code: 'internal-error', message } });
    expect(snapshot.diagnostics).toEqual([{ severity: 'error', code: 'internal-error', message }]);
    expect(snapshot.world).toMatchObject({ t: 5 / PHYSICS_HZ, status: 'error', activeBlockId: null });
    // The program was stopped with the run: it never printed. Driving the run does nothing more.
    await session.runUntil(2);
    await session.advance(100);
    expect(session.getSnapshot()).toBe(snapshot);
    expect(snapshot.console.lines).toEqual([]);
    // A new start runs.
    probe.onAdvanceTo = undefined;
    expect(await session.start(robotProject([print(num(2))]))).toEqual({ ok: true });
    await session.runUntil(0.1);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['2'] } });
    session.stop();
  });

  it('a step the world refuses ends the run in an error with a diagnostic', async () => {
    const session = roverSession(driveScenario());
    await session.start(looper());
    probe.onStep = (world) => {
      if (world.tick === 3) throw new RangeError('A motor’s duty is 0..255, not 300.');
    };
    await session.runUntil(1);
    expect(session.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'internal-error', message: 'The robot simulation stopped: A motor’s duty is 0..255, not 300.' },
      world: { t: 3 / PHYSICS_HZ },
    });
    session.stop();
  });

  it('retiring a run disposes its world: a reset builds a new one, a stop disposes it', async () => {
    const session = roverSession(driveScenario());
    await session.start(looper());
    await session.runUntil(0.1);
    await session.resetRobot();
    expect([probe.worlds.length, probe.disposed]).toEqual([2, 1]);
    session.stop();
    expect(probe.disposed).toBe(2);
  });
});

describe('the program never runs ahead of the world', () => {
  it('pulseIn loop never leads world by more than dt', async () => {
    // A loop() that only reads the real ultrasonic (HC-SR04 driver, pulseIn on the virtual UNO, echo from the world's raycast):
    // with a wall 70 cm ahead (an echo of ~4 ms), and in an open arena (no echo: 20.8 ms per read).
    // Every read starts inside the tick of its time: world.t ≤ clock < world.t + dt. The driver then sends its trigger (LOW, 2 µs, HIGH,
    // 10 µs, LOW) before pulseIn samples the echo, so the echo is sampled up to that trigger's time later (the world gives the echo's
    // width only, no wait before it: a model that does not resolve a few µs).
    const trigger = 3 * unoR3Board.costsUs.digitalWrite + 2 + 10;
    expect(trigger).toBe(25.6875);
    for (const scenario of [sandboxScenario({ wallAtCm: 120 }), sandboxScenario()]) {
      probe.reads.length = 0;
      probe.ops.length = 0;
      const session = roverSession(scenario);
      await session.start(robotProject([], [setVar('x', ultrasonic()), print(getVar('x'))]));
      await session.runUntil(5);
      const reads = probe.reads.splice(0);
      const ops = probe.ops.splice(0);
      expect(ops.length).toBe(reads.length);
      expect(ops.filter((op) => !(op.worldMs <= op.clockMs && op.clockMs < op.worldMs + dt))).toEqual([]);
      // The clock sums widths of cm·58 µs, which are not multiples of 1/32 µs: equal to a millionth of a µs.
      expect(reads.filter((read, i) => !(read.worldMs === ops[i]!.worldMs && Math.abs((read.clockMs - ops[i]!.clockMs) * 1000 - trigger) < 1e-6))).toEqual([]);
      expect(reads.filter((read) => !(read.worldMs <= read.clockMs && read.clockMs < read.worldMs + dt + trigger / 1000))).toEqual([]);
      console.info(`R36-LEAD reads ${reads.length}, echo sampled past world.t + dt: ${reads.filter((read) => read.clockMs >= read.worldMs + dt).length}, max lead ${Math.max(...reads.map((read) => read.clockMs - read.worldMs)).toFixed(6)} ms`);
      const echo = reads[0]!.cm < 400;
      expect(reads.length).toBeGreaterThan(echo ? 1000 : 200);
      // What the program read is what the world measured (the robot stands still: the same every tick).
      expect(new Set(reads.map((read) => read.cm)).size).toBe(1);
      expect(new Set(session.getSnapshot().console.lines)).toEqual(new Set([String(echoToCm(Math.trunc(reads[0]!.cm * 58)))]));
      session.stop();
    }
  });
});
