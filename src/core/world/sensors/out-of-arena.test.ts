import { beforeAll, describe, expect, it } from 'vitest';
import { parseArena } from '../arena/arena-schema';
import { buildArena } from '../arena/build-arena';
import { createGroundPaint } from '../arena/ground-paint';
import { createPhysicsWorld, getRapier, initPhysics, refreshQueries } from '../rapier';
import { arenaToWorld, rotateVector, type Vec3 } from '../units';
import { isFiniteVector } from './collider-lookup';
import { readContacts } from './contacts';
import { measureLine } from './line';
import { BELOW_GROUND_TOLERANCE_CM, isOutOfArena } from './out-of-arena';
import { measureUltrasonic } from './ultrasonic';

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

/** A 150 × 100 cm floor with a 2 cm tape along y = 50 and a wall along its west edge; open on the other sides. */
const arena = parseArena({
  ground: { sizeCm: [150, 100], color: '#ffffff' },
  paint: { lines: [{ pointsCm: [[10, 50], [140, 50]], widthCm: 2 }] },
  walls: [{ id: 'west', fromCm: [1, 0], toCm: [1, 100] }],
});

describe('isOutOfArena', () => {
  it('is in over the floor, on its border, and sunk into it by up to 1 cm', () => {
    expect(BELOW_GROUND_TOLERANCE_CM).toBe(1);
    for (const [x, y, h] of [
      [75, 50, 0],
      [0, 0, 0],
      [150, 100, 0],
      [0, 100, 3],
      [75, 50, -1],
      [75, 50, 40],
    ]) {
      expect(isOutOfArena(arena, arenaToWorld(x!, y!, h))).toBe(false);
    }
  });

  it('is out beyond any edge of the floor, at any height', () => {
    for (const [x, y, h] of [
      [-0.1, 50, 0],
      [150.1, 50, 0],
      [75, -0.1, 0],
      [75, 100.1, 0],
      [200, 50, 5],
    ]) {
      expect(isOutOfArena(arena, arenaToWorld(x!, y!, h))).toBe(true);
    }
  });

  it('is out more than 1 cm below the floor plane, even within the footprint', () => {
    expect(isOutOfArena(arena, arenaToWorld(75, 50, -1.01))).toBe(true);
    expect(isOutOfArena(arena, arenaToWorld(75, 50, -100))).toBe(true);
  });

  it('is out for a position that is not finite', () => {
    const middle = arenaToWorld(75, 50);
    expect(isOutOfArena(arena, { ...middle, x: Number.NaN })).toBe(true);
    expect(isOutOfArena(arena, { ...middle, y: Number.NEGATIVE_INFINITY })).toBe(true);
    expect(isOutOfArena(arena, { ...middle, z: Number.POSITIVE_INFINITY })).toBe(true);
  });

  it('a body sliding off the arena falls out of it, with finite poses and finite sensor readings all the way down', () => {
    const R = getRapier();
    const world = createPhysicsWorld();
    try {
      const built = buildArena(world, arena);
      const paint = createGroundPaint(arena);
      // A 10 cm cube (the robot’s stand-in) 10 cm from the open east edge, sliding east at 2 m/s (friction alone stops it after 27 cm).
      const cube = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(1.35, 0.05, -0.5).setLinvel(2, 0, 0));
      world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05), cube);
      refreshQueries(world);
      const sensorAt = (local: Vec3) => {
        const t = cube.translation();
        const d = rotateVector(cube.rotation(), local);
        return { x: t.x + d.x, y: t.y + d.y, z: t.z + d.z };
      };
      const out: boolean[] = [];
      for (let tick = 0; tick < 240; tick++) {
        world.step();
        const position = cube.translation();
        const rotation = cube.rotation();
        expect(isFiniteVector(position)).toBe(true);
        expect([rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)).toBe(true);
        out.push(isOutOfArena(arena, position));
        // Looking back west at the wall, then forward and down at the floor from the cube's front.
        const echo = measureUltrasonic(world, built, { position: sensorAt({ x: -0.05, y: 0, z: 0 }), rotation }, { coneHalfDeg: 15, minCm: 2, maxCm: 400 });
        expect(echo.cm).toBeGreaterThanOrEqual(2);
        expect(echo.cm).toBeLessThanOrEqual(400);
        expect(Number.isFinite(echo.echoUs)).toBe(true);
        const line = measureLine(paint, sensorAt({ x: 0.04, y: -0.04, z: 0 }), { spotRadiusCm: 0.3, darkBelow: 0.5 });
        expect(Number.isInteger(line.raw) && line.raw >= 0 && line.raw <= 1023).toBe(true);
        expect(line.reflectance >= 0 && line.reflectance <= 1).toBe(true);
        for (const contact of readContacts(world, built, [cube])) expect(['#ground', 'west']).toContain(contact.id);
      }
      expect(out[0]).toBe(false);
      // Once out, it stays out, and it is far below the floor after two seconds.
      const firstOut = out.indexOf(true);
      expect(firstOut).toBeGreaterThan(0);
      expect(out.slice(firstOut).every(Boolean)).toBe(true);
      expect(cube.translation().y).toBeLessThan(-10);
      expect(readContacts(world, built, [cube])).toEqual([]);
    } finally {
      world.free();
    }
  });
});
