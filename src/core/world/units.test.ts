import { describe, expect, it } from 'vitest';
import {
  arenaToWorld,
  cmToM,
  degToRad,
  gToKg,
  mToCm,
  radToDeg,
  rotateVector,
  worldToArena,
  yawOfQuaternion,
  yawToQuaternion,
} from './units';

describe('units', () => {
  it('converts arena centimetres and grams to SI', () => {
    expect(cmToM(150)).toBe(1.5);
    expect(cmToM(2)).toBe(0.02);
    expect(mToCm(1.5)).toBe(150);
    expect(gToKg(100)).toBe(0.1);
  });

  it('converts degrees and radians, exactly at the right angles', () => {
    expect(degToRad(180)).toBe(Math.PI);
    expect(degToRad(90)).toBe(Math.PI / 2);
    expect(degToRad(-45)).toBe(-Math.PI / 4);
    expect(radToDeg(Math.PI)).toBe(180);
    expect(radToDeg(Math.PI / 2)).toBe(90);
  });
});

describe('arena frame', () => {
  it('maps the arena plane onto the world floor: x to +X, y to -Z, height to +Y', () => {
    expect(arenaToWorld(50, 30, 10)).toEqual({ x: 0.5, y: 0.1, z: -0.3 });
    expect(worldToArena({ x: 0.5, y: 0.1, z: -0.3 })).toEqual({ xCm: 50, yCm: 30, heightCm: 10 });
  });

  it('never produces a negative zero for the arena origin', () => {
    const origin = arenaToWorld(0, 0);
    expect(Object.is(origin.z, 0)).toBe(true);
    expect(Object.is(worldToArena(origin).yCm, 0)).toBe(true);
  });

  it('gives the identity rotation for yaw 0', () => {
    expect(yawToQuaternion(0)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('turns counter-clockwise seen from above: yaw 90° points the body +X along arena +y', () => {
    const forward = rotateVector(yawToQuaternion(degToRad(90)), { x: 1, y: 0, z: 0 });
    const arena = worldToArena(forward);
    expect(arena.xCm).toBeCloseTo(0, 12);
    expect(arena.yCm).toBeCloseTo(100, 12);
    expect(arena.heightCm).toBe(0);
  });

  it('reads back the yaw it wrote, over the whole circle', () => {
    for (let deg = -165; deg <= 180; deg += 15) {
      expect(yawOfQuaternion(yawToQuaternion(degToRad(deg)))).toBeCloseTo(degToRad(deg), 14);
    }
  });

  it('is bit-identical from run to run (dmath, no Math.sin)', () => {
    expect(yawToQuaternion(degToRad(30))).toEqual({ x: 0, y: 0.25881904510252074, z: 0, w: 0.9659258262890683 });
  });
});
