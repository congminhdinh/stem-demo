import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits } from '../../hardware/catalog';
import type { ColorSensorSpec, Kit } from '../../hardware/kit';
import { modulesOfKind } from '../../hardware/kit-mechanics';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { bodyPalette } from '../arena/body-colors';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import { createPhysicsWorld, initPhysics, type PhysicsWorld } from '../rapier';
import { arenaToWorld, degToRad, yawToQuaternion } from '../units';
import type { SensorPose } from './collider-lookup';
import { colorLight, measureColor } from './color';
import { sensedBodies } from './sensed-bodies';

// N19 B3 (plan §4.4, §4.1): the TCS34725's light as a pure measure over a pose: one ray along the sensor's forward axis, `rangeCm` (4 cm)
// long, and the irradiance of each channel from the first body it meets: white_k · refl_k / (1 + (d / halfLightCm)²) + ambientPerMs per
// ms at 1× gain, refl_k = the body's sRGB component / 255, the clear channel R + G + B (the G0.2 spike's mapping), in whole counts per
// second (what devices/tcs34725.ts integrates). Only + × / and floor. No noise.

beforeAll(() => initPhysics(), 30_000);

/** The gripper kit's colour sensor (ref-uno-gripper@0, PLACEHOLDER). */
const CS: ColorSensorSpec = modulesOfKind(productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit, 'color-sensor')[0]!.spec;

const cubeAt = (id: string, faceCm: number, color?: string) => ({ id, centerCm: [faceCm + 2, 50] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], ...(color === undefined ? {} : { color }) });

function withWorld<T>(arena: Partial<ArenaInput>, use: (world: PhysicsWorld, built: BuiltArena) => T): T {
  const world = createPhysicsWorld();
  try {
    return use(world, buildArena(world, parseArena({ ground: { sizeCm: [100, 100], color: '#ffffff' }, ...arena })));
  } finally {
    world.free();
  }
}

const poseAt = (xCm: number, yawDeg = 0): SensorPose => ({ position: arenaToWorld(xCm, 50, 2), rotation: yawToQuaternion(degToRad(yawDeg)) });

describe('colorLight (N19 B3)', () => {
  it('reads the gripper kit’s spec', () => {
    expect(CS).toEqual({ rangeCm: 4, halfLightCm: 1.5, whiteRPerMs: 48, whiteGPerMs: 44, whiteBPerMs: 36, ambientPerMs: 0.2 });
  });

  it('is the ambient alone with nothing in front: 0.2 per ms a channel, 200 counts per second', () => {
    expect(colorLight(CS, null)).toEqual({ c: 600, r: 200, g: 200, b: 200 });
  });

  it('is white’s counts on a white body touching it, half its body light at halfLightCm, and only the ambient off a black one', () => {
    expect(colorLight(CS, { color: '#ffffff', distanceCm: 0 })).toEqual({ c: 128_600, r: 48_200, g: 44_200, b: 36_200 });
    // Red #d32f2f at 1.5 cm: 48 · 211/255 / 2 + 0.2 = 20.0588… per ms.
    expect(colorLight(CS, { color: bodyPalette.red, distanceCm: 1.5 })).toEqual({ c: 27_829, r: 20_058, g: 4_254, b: 3_517 });
    expect(colorLight(CS, { color: bodyPalette.yellow, distanceCm: 1 })).toEqual({ c: 60_642, r: 32_909, g: 23_135, b: 4_598 });
    expect(colorLight(CS, { color: '#000000', distanceCm: 0.5 })).toEqual({ c: 600, r: 200, g: 200, b: 200 });
  });

  it('falls with the distance, never under the ambient, in whole counts', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 4; d += 0.25) {
      const light = colorLight(CS, { color: bodyPalette.blue, distanceCm: d });
      expect(Object.values(light).every(Number.isSafeInteger)).toBe(true);
      expect(light.c).toBe(light.r + light.g + light.b);
      expect(light.b).toBeLessThan(previous);
      expect(light.b).toBeGreaterThan(200);
      previous = light.b;
    }
  });
});

describe('measureColor (N19 B3)', () => {
  it('meets the first body within 4 cm and gives its light at its distance, snapped to whole µm', () => {
    for (const [faceCm, distanceCm] of [
      [41, 1],
      [43, 3],
      [43.9999, 3.9999],
    ] as const) {
      withWorld({ boxes: [cubeAt('cube', faceCm, bodyPalette.green)] }, (world, built) => {
        const reading = measureColor(world, sensedBodies(built, null), poseAt(40), CS);
        expect([reading.hit?.id, reading.distanceCm]).toEqual(['cube', distanceCm]);
        expect(reading.light).toEqual(colorLight(CS, { color: bodyPalette.green, distanceCm }));
      });
    }
  });

  it('sees nothing past 4 cm, nor what it leaves out, nor from a pose that is not finite: the ambient', () => {
    withWorld({ boxes: [cubeAt('cube', 44.01, '#ffffff')] }, (world, built) => {
      const lookup = sensedBodies(built, null);
      expect(measureColor(world, lookup, poseAt(40), CS)).toEqual({ hit: null, distanceCm: null, light: colorLight(CS, null) });
      expect(measureColor(world, lookup, poseAt(41), CS, { exclude: () => true })).toEqual({ hit: null, distanceCm: null, light: colorLight(CS, null) });
      expect(measureColor(world, lookup, { position: { x: 0.4, y: Number.POSITIVE_INFINITY, z: -0.5 }, rotation: yawToQuaternion(0) }, CS)).toEqual({ hit: null, distanceCm: null, light: colorLight(CS, null) });
    });
  });

  it('reads a body without a colour by its kind’s, an object’s as the 3D view paints it (#f2c14e)', () => {
    withWorld({ objects: [{ shape: 'box', id: 'plain', centerCm: [43, 50], sizeCm: [4, 4, 4], massG: 15 }] }, (world, built) => {
      expect(measureColor(world, sensedBodies(built, null), poseAt(40), CS).light).toEqual(colorLight(CS, { color: '#f2c14e', distanceCm: 1 }));
    });
  });
});
