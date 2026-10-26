import { beforeAll, describe, expect, it, vi } from 'vitest';
import { productionKits, unoR3Board, type I2cDevice, type Kit } from '../hardware';
import { colorIs, registry } from '../program/__fixtures__/uno-blocks';
import { print } from '../program/__fixtures__/ybc-blocks';
import type { Scenario } from '../scenario/scenario';
import { initPhysics, PHYSICS_HZ } from '../world/rapier';
import type { World } from '../world/world';
import { robotProject, sandboxScenario } from './__fixtures__/robot-session';
import { createRobotRunSession } from './robot-run-session';

// N19 A4 (plan §4.7, the B3 contract): a color.is read in a running session never leads the world by more than one tick. A module op
// starts inside its tick (the interpreter's atHardware: world.t ≤ program clock < world.t + dt), and a colour read's last bus event
// comes 1123.8125 µs after the op starts (colorReadLastEventUs), so every call the bus makes on the TCS34725, and every light it asks
// the world for, falls within [world.t, world.t + dt + 1123.8125 µs). The session runs ref-uno-gripper@0, passed to it as its kit,
// on a test arena (the sandbox's floor, no gripper scenario key yet: task D4); the world's light model is B3's, so a TCS34725 model under
// a steady red light is put on the session's virtual UNO here (vi.mock), and every bus call is recorded with the world's time.

const probe = vi.hoisted(() => ({
  worlds: [] as { tick: number }[],
  /** Each bus call on the sensor: its time on the program clock (µs since setup()) and the world's time then (ms). */
  events: [] as { us: number; worldMs: number }[],
  /** Each light the model asked for: up to when (µs) and the world's time then (ms). */
  light: [] as { toUs: number; worldMs: number }[],
}));

vi.mock('../hardware/virtual-uno', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware/virtual-uno')>();
  const { createTcs34725 } = await import('../hardware/devices/tcs34725');
  return {
    ...actual,
    createVirtualUno: (...args: Parameters<typeof actual.createVirtualUno>) => {
      const uno = actual.createVirtualUno(...args);
      const worldMs = () => ((probe.worlds.at(-1)?.tick ?? Number.NaN) * 1000) / PHYSICS_HZ;
      const red = { c: 47_600, r: 39_917, g: 8_316, b: 6_856 };
      const model = createTcs34725((fromUs, toUs) => {
        probe.light.push({ toUs, worldMs: worldMs() });
        const span = Math.round(toUs - fromUs);
        return { c: red.c * span, r: red.r * span, g: red.g * span, b: red.b * span };
      });
      const record = (us: number) => void probe.events.push({ us, worldMs: worldMs() });
      const watched: I2cDevice = {
        connect: (us, read) => (record(us), model.connect(us, read)),
        write: (us, byte) => (record(us), model.write(us, byte)),
        read: (us) => (record(us), model.read(us)),
        stop: (us) => (record(us), model.stop(us)),
      };
      uno.attachWireDevice(model.address, watched);
      return uno;
    },
  };
});

vi.mock('../world/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../world/world')>();
  return {
    ...actual,
    createScenarioWorld: async (...args: Parameters<typeof actual.createScenarioWorld>) => {
      const world: World = await actual.createScenarioWorld(...args);
      probe.worlds.push(world);
      return world;
    },
  };
});

beforeAll(() => initPhysics(), 30_000);

const gripper = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const dtUs = 1_000_000 / PHYSICS_HZ;

describe('the program never runs ahead of the world: the colour sensor (N19 A4)', () => {
  it('a color.is read in a running session never leads the world by more than one tick', async () => {
    const floor = sandboxScenario();
    const scenario: Scenario = { ...floor, kit: gripper.id };
    const session = createRobotRunSession({ scenario, kit: gripper, board: unoR3Board, registry });
    const start = await session.start(robotProject([], [print(colorIs('red'))], { kit: { id: gripper.id, version: gripper.version } }));
    expect(start).toEqual({ ok: true });
    await session.runUntil(2);
    const lines = session.getSnapshot().console.lines;
    session.stop();
    // setup()'s colorBegin, then a read every 1.3 ms or so of the program clock for 2 s: twelve bus calls each.
    expect(probe.events.length).toBeGreaterThan(10_000);
    const bound = (worldMs: number) => worldMs * 1000 + dtUs + 1123.8125;
    expect(probe.events.filter((event) => !(event.worldMs * 1000 <= event.us && event.us < bound(event.worldMs)))).toEqual([]);
    expect(probe.light.length).toBeGreaterThan(30);
    expect(probe.light.filter((ask) => !(ask.toUs < bound(ask.worldMs)))).toEqual([]);
    // The red light reads red.
    expect(lines.length).toBeGreaterThan(100);
    expect(new Set(lines)).toEqual(new Set(['1']));
  });
});
