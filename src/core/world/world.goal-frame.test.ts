import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../scenario/scenario';
import { toGoalFrame } from './goal-frame';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import { createScenarioWorld } from './world';

// N18 R3.6: the goal frame of a tick straight from the world's bodies and measures (`World.goalFrame`), without building the snapshot:
// the run session feeds its goals every tick and builds a snapshot only for a view. It is the frame `toGoalFrame` makes of the
// snapshot with the run's LEDs and buzzer, on every tick.

beforeAll(() => initPhysics(), 30_000);

const kit = productionKits.get(referenceKitRef) as Kit;
const run = (duty: number, dir: -1 | 0 | 1) => ({ duty, dir, brake: false });

describe('World.goalFrame', () => {
  it('is the frame toGoalFrame makes of the snapshot with the run’s LEDs and buzzer, tick after tick', async () => {
    const scenario = loadScenario(allGoalsScenario);
    // Variant 1: a jittered start. The robot drives into the line loop, turns, swings its servo and lights its LED.
    const world = await createScenarioWorld(scenario, kit, 1);
    try {
      const compare = (tick: number) => {
        const leds = { led1: tick % 50 < 25 };
        const buzzerHz = tick % 90 < 30 ? null : 440 + tick;
        const raw = world.goalFrame({ leds, buzzerHz });
        expect(raw).toEqual(toGoalFrame({ ...world.snapshot(), leds }, { ...world.frameExtras(), buzzerHz }));
        return raw;
      };
      let seenObject = false;
      let seenSpots = false;
      compare(0);
      for (let tick = 0; tick < 600; tick++) {
        const targets: ActuatorTargets =
          tick < 240
            ? { motors: { motorLeft: run(220, 1), motorRight: run(220, 1) }, servos: { servo1: tick < 120 ? 30 : 150 } }
            : { motors: { motorLeft: run(180, 1), motorRight: run(180, -1) }, servos: { servo1: 90 } };
        world.applyActuators(targets);
        world.step(PHYSICS_DT_S);
        const frame = compare(tick + 1);
        seenObject ||= Object.keys(frame.objects).length > 0;
        seenSpots ||= (frame.robot.lineSpotsCm?.length ?? 0) > 0;
      }
      expect([seenObject, seenSpots]).toEqual([true, true]);
    } finally {
      world.dispose();
    }
  });

  it('is a new frame each call, leaves out the floor, and throws once the world is disposed', async () => {
    const world = await createScenarioWorld(loadScenario(allGoalsScenario), kit, 0);
    const first = world.goalFrame({ leds: { led1: false }, buzzerHz: null });
    const second = world.goalFrame({ leds: { led1: false }, buzzerHz: null });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(world.sense.contacts().some((contact) => contact.kind === 'ground')).toBe(true);
    expect(first.contacts.some((contact) => contact.otherId === '#ground')).toBe(false);
    world.dispose();
    expect(() => world.goalFrame({ leds: {}, buzzerHz: null })).toThrow('The world has been disposed.');
  });
});
