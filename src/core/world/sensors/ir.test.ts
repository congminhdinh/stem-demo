import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits } from '../../hardware/catalog';
import type { IrObstacleSpec, Kit } from '../../hardware/kit';
import { modulesOfKind } from '../../hardware/kit-mechanics';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import { createPhysicsWorld, initPhysics, type Collider, type PhysicsWorld } from '../rapier';
import { arenaToWorld, degToRad, yawToQuaternion } from '../units';
import type { SensorPose } from './collider-lookup';
import { measureIr } from './ir';
import { sensedBodies, type SensedBody } from './sensed-bodies';

// N19 B3 (plan §4.4, §4.1): the IR obstacle sensor between the jaws as a pure measure over a pose: one ray along the sensor's forward axis,
// `rangeCm` long; it sees the first body it meets that the lookup names, when that body's colour reflects at least `minReflectance` (luma,
// ground-paint.ts `colorReflectance`), so a black foam cube is not seen and hides what is behind it. The pin's level follows `activeLow`.

beforeAll(() => initPhysics(), 30_000);

/** The gripper kit's IR (ref-uno-gripper@0, PLACEHOLDER): 2 cm, reflectance 0.15. */
const IR: IrObstacleSpec = modulesOfKind(productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit, 'ir-obstacle')[0]!.spec;

/** A 4 cm cube of `color` whose near face (towards smaller x) is at x = `faceCm`, centred on y = 50. Fixed, so it stays put. */
const cubeAt = (id: string, faceCm: number, color?: string) => ({ id, centerCm: [faceCm + 2, 50] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], ...(color === undefined ? {} : { color }) });

/** A plate 0.3 cm thick, 10 cm across and 6 cm high, its near face at x = `faceCm`. */
const plateAt = (id: string, faceCm: number, color: string) => ({ id, centerCm: [faceCm + 0.15, 50] as [number, number], sizeCm: [0.3, 10, 6] as [number, number, number], color });

function withWorld<T>(arena: Partial<ArenaInput>, use: (world: PhysicsWorld, built: BuiltArena) => T): T {
  const world = createPhysicsWorld();
  try {
    return use(world, buildArena(world, parseArena({ ground: { sizeCm: [100, 100], color: '#ffffff' }, ...arena })));
  } finally {
    world.free();
  }
}

/** The sensor at (xCm, 50), 2 cm above the floor, looking along +x. */
const poseAt = (xCm: number, yawDeg = 0): SensorPose => ({ position: arenaToWorld(xCm, 50, 2), rotation: yawToQuaternion(degToRad(yawDeg)) });

describe('measureIr (N19 B3)', () => {
  it('reads the gripper kit’s spec: a 2 cm ray that sees a reflectance of 0.15', () => {
    expect(IR).toEqual({ rangeCm: 2, minReflectance: 0.15 });
  });

  it('sees a body of a reflecting colour within its range, and its pin goes LOW (active low)', () => {
    withWorld({ boxes: [cubeAt('cube', 41.5, '#d32f2f')] }, (world, built) => {
      const reading = measureIr(world, sensedBodies(built, null), poseAt(40), IR, { activeLow: true });
      expect([reading.detected, reading.level, reading.hit?.id]).toEqual([true, 0, 'cube']);
      // Active high: HIGH while it sees.
      expect(measureIr(world, sensedBodies(built, null), poseAt(40), IR, { activeLow: false }).level).toBe(1);
    });
  });

  it('sees nothing past its range: at 2.05 cm the pin stays HIGH', () => {
    withWorld({ boxes: [cubeAt('cube', 42.05, '#ffffff')] }, (world, built) => {
      expect(measureIr(world, sensedBodies(built, null), poseAt(40), IR, { activeLow: true })).toEqual({ detected: false, level: 1, hit: null });
      expect(measureIr(world, sensedBodies(built, null), poseAt(40.1), IR, { activeLow: true }).detected).toBe(true);
    });
  });

  it('black cube not seen by IR, and it hides a white one behind it', () => {
    withWorld({ boxes: [cubeAt('black', 41, '#212121')] }, (world, built) => {
      const reading = measureIr(world, sensedBodies(built, null), poseAt(40), IR, { activeLow: true });
      expect([reading.detected, reading.level, reading.hit?.id]).toEqual([false, 1, 'black']);
    });
    withWorld({ boxes: [plateAt('black', 40.5, '#000000'), cubeAt('white', 41.2, '#ffffff')] }, (world, built) => {
      const black = measureIr(world, sensedBodies(built, null), poseAt(40), IR, { activeLow: true });
      expect([black.detected, black.hit?.id]).toEqual([false, 'black']);
    });
  });

  it('sees a body without a colour by its kind’s (a box: #d9a066), and any colour from luma 0.15', () => {
    withWorld({ boxes: [cubeAt('plain', 41)] }, (world, built) => {
      expect(measureIr(world, sensedBodies(built, null), poseAt(40), IR).detected).toBe(true);
    });
    // #262626 has luma 0.149, #272727 0.153.
    for (const [color, seen] of [['#262626', false], ['#272727', true]] as const) {
      withWorld({ boxes: [cubeAt('grey', 41, color)] }, (world, built) => {
        expect([color, measureIr(world, sensedBodies(built, null), poseAt(40), IR).detected]).toEqual([color, seen]);
      });
    }
  });

  it('passes through what it is told to leave out and what the lookup does not name, and sees nothing from a pose that is not finite', () => {
    withWorld({ boxes: [plateAt('near', 40.5, '#ffffff'), cubeAt('far', 41.5, '#d32f2f')] }, (world, built) => {
      const lookup = sensedBodies(built, null);
      let near: Collider | null = null;
      world.forEachCollider((collider) => {
        if (built.infoOf(collider)?.id === 'near') near = collider;
      });
      expect(measureIr(world, lookup, poseAt(40), IR).hit?.id).toBe('near');
      const left = measureIr(world, lookup, poseAt(40), IR, { exclude: (collider) => collider === near });
      expect(left.hit?.id).toBe('far');
      const unnamed = { infoOf: (collider: Collider): SensedBody | undefined => (collider === near ? undefined : lookup.infoOf(collider)) };
      expect(measureIr(world, unnamed, poseAt(40), IR).hit?.id).toBe('far');
      expect(measureIr(world, lookup, { position: { x: Number.NaN, y: 0.02, z: -0.5 }, rotation: yawToQuaternion(0) }, IR)).toEqual({ detected: false, level: 1, hit: null });
      expect(measureIr(world, lookup, { position: arenaToWorld(40, 50, 2), rotation: { x: 0, y: 0, z: 0, w: 0 } }, IR)).toEqual({ detected: false, level: 1, hit: null });
    });
  });

  it('looks along its own forward axis: turned away, it sees nothing', () => {
    withWorld({ boxes: [cubeAt('cube', 41, '#ffffff')] }, (world, built) => {
      expect(measureIr(world, sensedBodies(built, null), poseAt(40, 90), IR).hit).toBeNull();
      expect(measureIr(world, sensedBodies(built, null), poseAt(46.5, 180), IR).hit?.id).toBe('cube');
    });
  });
});
