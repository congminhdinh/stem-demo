import { beforeAll, describe, expect, it } from 'vitest';
import type { ProgramClock } from '../capabilities/services';
import { createModuleIO } from '../hardware/binding';
import { productionKits, unoR3Board } from '../hardware/catalog';
import { createTcs34725 } from '../hardware/devices/tcs34725';
import { COLOR_NAMES } from '../hardware/drivers';
import type { Kit } from '../hardware/kit';
import { createVirtualUno } from '../hardware/virtual-uno';
import { parseArena } from '../world/arena/arena-schema';
import { bodyPalette } from '../world/arena/body-colors';
import { initPhysics, PHYSICS_DT_S, PHYSICS_HZ } from '../world/rapier';
import type { MotorCommand } from '../world/robot/dc-motor';
import { createWorld, type World } from '../world/world';
import { createLightHistory } from './light-history';

// N19 B3/B4 (plan §4.4, §4.3): the colour sensor through its whole chain, as the run session wires it: the world's ray and light (B3), the
// run's light history (B4), the TCS34725 register model on the virtual UNO's timed I²C bus, and the tcs34725-wire driver's `color.is`, its
// COLOR_RULES table (A3). The gripper car lowers its open jaws and creeps up to a cube of each palette colour until the sensor is 1 cm and
// then 3 cm from it (of 4 cm); setup() has run colorBegin at t = 0; each read starts inside a tick, on the program clock, as an op of the
// interpreter does. robot-run-session.color-light.test.ts runs the same through the blocks.

beforeAll(() => initPhysics(), 30_000);

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const DT_US = 1_000_000 / PHYSICS_HZ;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const crawl: MotorCommand = { duty: 120, dir: 1, brake: false };

/** The chain on a world: the light history of `color1`, its register model on a virtual UNO whose clock the test sets, setup() run. */
function chainOn(world: World) {
  let us = 0;
  const clock: ProgramClock = { now: () => us / 1000, charge: (by) => void (us += by) };
  const uno = createVirtualUno(unoR3Board, clock);
  const history = createLightHistory();
  history.record(world.tick, world.sense.color('color1').light);
  const device = createTcs34725(history.integral);
  uno.attachWireDevice(device.address, device);
  const modules = createModuleIO(kit, uno, [{ role: 'color1', op: 'color.is' }]);
  let motor = COAST;
  const step = (targets: { liftDeg?: number; clawDeg?: number } = {}) => {
    world.applyActuators({ motors: { motorLeft: motor, motorRight: motor }, gripper: targets });
    world.step(PHYSICS_DT_S);
    history.record(world.tick, world.sense.color('color1').light);
    // The program waits for the world: its clock is at least the new tick's start.
    us = Math.max(us, world.tick * DT_US);
  };
  return {
    drive(command: MotorCommand) {
      motor = command;
    },
    step,
    /** Each colour's `color.is`, each read starting in its own tick (then a tick passes). */
    classes(): boolean[] {
      return COLOR_NAMES.map((_, n) => {
        expect(us).toBeLessThan((world.tick + 1) * DT_US);
        const is = modules.read('color1', 'color.is', [n]) as boolean;
        step();
        return is;
      });
    },
  };
}

describe('the colour sensor’s chain: world, light history, register model, driver (N19 B3/B4)', () => {
  it('colour sensor reads each palette colour’s class at 1 cm and 3 cm', async () => {
    const read: string[] = [];
    for (const [name, color] of Object.entries(bodyPalette)) {
      const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [START.xCm + 22, START.yCm], sizeCm: [4, 4, 4], massG: 15, color }] });
      const world = await createWorld({ arena, start: START, kit, seed: 1 });
      try {
        const chain = chainOn(world);
        for (let i = 0; i < 48; i++) chain.step({ liftDeg: 0, clawDeg: 0 });
        for (const targetCm of [3, 1]) {
          chain.drive(crawl);
          for (let i = 0; i < 600; i++) {
            const seen = world.sense.color('color1');
            if (seen.hitId === 'cube' && seen.distanceCm! <= targetCm + 0.05) break;
            chain.step();
          }
          chain.drive(BRAKE);
          // At rest for 0.2 s, then two windows (52.8 ms each) so the one read has seen only the cube at rest.
          for (let i = 0; i < 24 + 14; i++) chain.step();
          const seen = world.sense.color('color1');
          expect([name, seen.hitId, Math.abs(seen.distanceCm! - targetCm) < 0.2]).toEqual([name, 'cube', true]);
          const classes = chain.classes();
          read.push(`${name} at ${targetCm} cm: ${COLOR_NAMES.filter((_, n) => classes[n]).join(',')}`);
        }
      } finally {
        world.dispose();
      }
    }
    expect(read).toEqual(['red', 'green', 'blue', 'yellow'].flatMap((name) => [`${name} at 3 cm: ${name}`, `${name} at 1 cm: ${name}`]));
  }, 120_000);

  it('reads nothing in front (the ambient alone) as unknown, and a black cube at 1 cm as black', async () => {
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [START.xCm + 22, START.yCm], sizeCm: [4, 4, 4], massG: 15, color: '#212121' }] });
    const world = await createWorld({ arena, start: START, kit, seed: 1 });
    try {
      const chain = chainOn(world);
      for (let i = 0; i < 48; i++) chain.step({ liftDeg: 0, clawDeg: 0 });
      expect(world.sense.color('color1').hitId).toBeNull();
      expect(chain.classes()).toEqual(COLOR_NAMES.map((name) => name === 'unknown'));
      chain.drive(crawl);
      for (let i = 0; i < 600; i++) {
        const seen = world.sense.color('color1');
        if (seen.hitId === 'cube' && seen.distanceCm! <= 1.05) break;
        chain.step();
      }
      chain.drive(BRAKE);
      for (let i = 0; i < 38; i++) chain.step();
      expect(Math.abs(world.sense.color('color1').distanceCm! - 1)).toBeLessThan(0.2);
      expect(chain.classes()).toEqual(COLOR_NAMES.map((name) => name === 'black'));
    } finally {
      world.dispose();
    }
  }, 60_000);
});
