import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../src/core/hardware/catalog';
import type { Kit } from '../src/core/hardware/kit';
import type { PhysicsWorld } from '../src/core/world/rapier';
import { PHYSICS_DT_S } from '../src/core/world/rapier';
import { createScenarioWorld } from '../src/core/world/world';
import { scenarioCatalog } from '../src/samples/robot-scenarios';
import { robotTemplateKeys } from '../src/samples/robot-templates';

// N19 A1 guard (docs/n19-gripper-plan.md §5 item 3): "a rover world creates the same number of bodies, colliders and impulse joints as
// before". Every later N19 task (the gripper's assembly, the held-object joint, the grasp) adds code to the world; none of it may add a
// body, a collider or a joint to a world whose kit has no gripper. The golden hashes (tests/__snapshots__/robot-determinism.json) would
// catch a change that moves a pose, but not an extra collider that never touches anything, nor a joint that is created and never loaded:
// this test names the numbers.
//
// The numbers below were measured on master 8c85ad6 (before N19 touched anything), with `ref-uno-rover@0`, right after `createScenarioWorld`
// (the settle steps of the robot's assembly included) and again after 120 more ticks (1 s), in every variant of each scenario (a variant
// moves things, it does not add any). Three bodies and one joint are the same in all seven: the arena's one fixed body, the chassis, and
// the kit's one servo arm with its hinge (built whether or not the scenario's goals use the servo; the wheels are colliders on the chassis,
// and none of the seven has an object to push, which would be a body each). The colliders differ with the arena's walls, boxes and
// cylinders. They are written out, never computed, so that a change to them is a deliberate edit of this file that a reviewer sees.
//
// The physics world is read through the factory the world is built from (`createPhysicsWorld`), wrapped to remember what it made:
// `World` does not expose it, and nothing in src is widened for a test.

const made = vi.hoisted(() => [] as unknown[]);

vi.mock('../src/core/world/rapier', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/world/rapier')>();
  return {
    ...original,
    createPhysicsWorld: () => {
      const world = original.createPhysicsWorld();
      made.push(world);
      return world;
    },
  };
});

type Counts = { readonly bodies: number; readonly colliders: number; readonly impulseJoints: number; readonly multibodyJoints: number };

const countsOf = (physics: PhysicsWorld): Counts => ({
  bodies: physics.bodies.len(),
  colliders: physics.colliders.len(),
  impulseJoints: physics.impulseJoints.len(),
  multibodyJoints: physics.multibodyJoints.len(),
});

const kit = (): Kit => productionKits.get(referenceKitRef) as Kit;

/** What a rover world of each shipped scenario holds, measured on master 8c85ad6. */
const ROVER_COUNTS: Readonly<Record<string, Counts>> = {
  'rb-drive-to-zone': { bodies: 3, colliders: 12, impulseJoints: 1, multibodyJoints: 0 },
  'rb-square-route': { bodies: 3, colliders: 12, impulseJoints: 1, multibodyJoints: 0 },
  'rb-stop-at-wall': { bodies: 3, colliders: 12, impulseJoints: 1, multibodyJoints: 0 },
  'rb-line-follow': { bodies: 3, colliders: 14, impulseJoints: 1, multibodyJoints: 0 },
  'rb-servo-gate': { bodies: 3, colliders: 13, impulseJoints: 1, multibodyJoints: 0 },
  'rb-mini-mission': { bodies: 3, colliders: 14, impulseJoints: 1, multibodyJoints: 0 },
  'rb-sandbox': { bodies: 3, colliders: 14, impulseJoints: 1, multibodyJoints: 0 },
};

describe('a rover world creates the same bodies, colliders and joints as before (N19 A1 guard)', () => {
  beforeEach(() => {
    made.length = 0;
  });

  it('is written for every shipped scenario, in the order of the lessons', () => {
    expect(Object.keys(ROVER_COUNTS)).toEqual([...robotTemplateKeys]);
  });

  it.each(robotTemplateKeys)('%s: the counts after the build and after 120 ticks, in every variant', async (key) => {
    const scenario = scenarioCatalog.get(key);
    if (scenario === undefined) throw new Error(`no scenario ${key}`);
    for (let variant = 0; variant < scenario.variants.count; variant++) {
      made.length = 0;
      const world = await createScenarioWorld(scenario, kit(), variant);
      try {
        expect(made, `${key} variant ${variant}`).toHaveLength(1);
        const physics = made[0] as PhysicsWorld;
        expect(countsOf(physics), `${key} variant ${variant}, built`).toEqual(ROVER_COUNTS[key]);
        for (let tick = 0; tick < 120; tick++) world.step(PHYSICS_DT_S);
        expect(countsOf(physics), `${key} variant ${variant}, after 120 ticks`).toEqual(ROVER_COUNTS[key]);
      } finally {
        world.dispose();
      }
    }
  });
});
