import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import { echoToCm } from '../../hardware/drivers/hcsr04';
import type { Kit, UltrasonicSpec } from '../../hardware/kit';
import { modulesOfKind } from '../../hardware/kit-mechanics';
import { cos, sin } from '../dmath';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import boxes from '../arena/fixtures/boxes.json';
import { createPhysicsWorld, getRapier, initPhysics, refreshQueries, type Collider, type PhysicsWorld } from '../rapier';
import { createWorldRng } from '../rng';
import { arenaToWorld, degToRad, yawToQuaternion } from '../units';
import type { ColliderLookup, SensedCollider, SensorPose } from './collider-lookup';
import { measureUltrasonic, ULTRASONIC_MAX_INCIDENCE_DEG, ultrasonicRayDirections, ULTRASONIC_RAY_COUNT } from './ultrasonic';

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

/** The reference kit's HC-SR04 (ref-uno-rover@0), as the kit gives it to the world. */
const HC_SR04: UltrasonicSpec = modulesOfKind(productionKits.get(referenceKitRef) as Kit, 'ultrasonic')[0]!.spec;

/** A white 200 × 200 cm floor with the walls given, nothing else. */
function arenaWith(walls: ArenaInput['walls'] = [], extra: Partial<ArenaInput> = {}): ArenaInput {
  return { ground: { sizeCm: [200, 200], color: '#ffffff' }, walls, ...extra };
}

function withWorld<T>(arena: ArenaInput, use: (world: PhysicsWorld, built: BuiltArena) => T): T {
  const world = createPhysicsWorld();
  try {
    return use(world, buildArena(world, parseArena(arena)));
  } finally {
    world.free();
  }
}

/** A sensor at an arena point (cm), `heightCm` above the floor, facing `yawDeg` counter-clockwise from arena +x. */
function poseAt(xCm: number, yCm: number, heightCm: number, yawDeg = 0): SensorPose {
  return { position: arenaToWorld(xCm, yCm, heightCm), rotation: yawToQuaternion(degToRad(yawDeg)) };
}

/** A wall whose inner face (towards smaller x) is at x = `faceCm`: 2 cm thick, 10 cm high, across the whole floor. */
const eastWallAt = (faceCm: number) => ({ id: 'east', fromCm: [faceCm + 1, 0] as [number, number], toCm: [faceCm + 1, 200] as [number, number] });
/** The same along y: inner face (towards smaller y) at y = `faceCm`. */
const northWallAt = (faceCm: number) => ({ id: 'north', fromCm: [0, faceCm + 1] as [number, number], toCm: [200, faceCm + 1] as [number, number] });

it('reads the reference kit’s spec: a ±15° cone over 2..400 cm', () => {
  expect(HC_SR04).toEqual({ coneHalfDeg: 15, minCm: 2, maxCm: 400 });
});

describe('ultrasonicRayDirections', () => {
  it('casts five fixed unit rays: the axis, then the cone edge left, right, up and down', () => {
    const c = cos(degToRad(15));
    const s = sin(degToRad(15));
    expect(ULTRASONIC_RAY_COUNT).toBe(5);
    expect(ultrasonicRayDirections(15)).toEqual([
      { x: 1, y: 0, z: 0 },
      { x: c, y: 0, z: -s },
      { x: c, y: 0, z: s },
      { x: c, y: s, z: 0 },
      { x: c, y: -s, z: 0 },
    ]);
    for (const d of ultrasonicRayDirections(15)) {
      expect(d.x * d.x + d.y * d.y + d.z * d.z).toBeCloseTo(1, 15);
    }
  });

  it('computes them once per cone and hands out the same frozen array', () => {
    const first = ultrasonicRayDirections(15);
    expect(ultrasonicRayDirections(15)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[1])).toBe(true);
  });

  it('refuses a cone that is not 0 ≤ half angle < 90°', () => {
    expect(() => ultrasonicRayDirections(-1)).toThrow(RangeError);
    expect(() => ultrasonicRayDirections(90)).toThrow(RangeError);
    expect(() => ultrasonicRayDirections(Number.NaN)).toThrow(RangeError);
  });
});

describe('measureUltrasonic', () => {
  it('wall at 50 cm reads 50±1', () => {
    withWorld(arenaWith([eastWallAt(150), northWallAt(150)]), (world, built) => {
      const ahead = measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04);
      expect(Math.abs(ahead.cm - 50)).toBeLessThanOrEqual(1);
      expect(ahead.cm).toBeCloseTo(50, 4);
      expect(ahead.hit?.id).toBe('east');
      // Turned 90° counter-clockwise, the sensor faces arena +y and the north wall.
      const left = measureUltrasonic(world, built, poseAt(100, 100, 4, 90), HC_SR04);
      expect(left.cm).toBeCloseTo(50, 4);
      expect(left.hit?.id).toBe('north');
    });
  });

  it('takes the shortest of the five rays: facing a corner at 45°, the cone edges meet the walls first', () => {
    withWorld(arenaWith([eastWallAt(150), northWallAt(150)]), (world, built) => {
      // The axis meets the corner at 50·√2 = 70.7 cm; the edge rays, 30° off each wall's normal, at 50 / cos 30° = 57.7 cm.
      const reading = measureUltrasonic(world, built, poseAt(100, 100, 4, 45), HC_SR04);
      expect(reading.cm).toBeCloseTo(50 / cos(degToRad(30)), 4);
      // The left edge ray (bearing 60°) meets the north wall, the right one (bearing 30°) the east wall, at the same
      // distance up to float32 rounding; whichever is shorter wins, the left one on an exact tie (fixed order).
      expect(['north', 'east']).toContain(reading.hit?.id);
      const axisOnly = measureUltrasonic(world, built, poseAt(100, 100, 4, 45), { ...HC_SR04, coneHalfDeg: 0 });
      expect(axisOnly.cm).toBeCloseTo(50 * Math.SQRT2, 4);
    });
  });

  it('angled wall beyond cone reads 400', () => {
    // A 20 cm wall 60 cm away, turned to face the sensor, centred on a bearing of 30° from the beam axis: it spans about
    // 19°…41°, outside the ±15° cone. Nothing else echoes (the floor never does), so there is no echo at all.
    const wallAtBearing = (bearingDeg: number) => {
      const b = degToRad(bearingDeg);
      const [cx, cy] = [100 + 60 * cos(b), 100 + 60 * sin(b)];
      const [tx, ty] = [-sin(b) * 10, cos(b) * 10];
      return { id: 'angled', fromCm: [cx - tx, cy - ty] as [number, number], toCm: [cx + tx, cy + ty] as [number, number] };
    };
    withWorld(arenaWith([wallAtBearing(30)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04)).toEqual({ cm: 400, echoUs: 0, hit: null });
    });
    // The same wall at a 10° bearing is inside the cone: its face is 60 cm from the sensor, the nearest ray meets it within a cm.
    withWorld(arenaWith([wallAtBearing(10)]), (world, built) => {
      const reading = measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04);
      expect(reading.hit?.id).toBe('angled');
      expect(reading.cm).toBeGreaterThan(59);
      expect(reading.cm).toBeLessThan(61);
    });
  });

  it('passes through colliders that do not echo, the floor and the robot’s own', () => {
    withWorld(arenaWith([eastWallAt(150)], { cylinders: [{ id: 'pole', centerCm: [130, 100], radiusCm: 1, heightCm: 30, ultrasonic: false }] }), (world, built) => {
      const R = getRapier();
      // A stand-in for the robot's body right in front of the sensor: the arena does not know it.
      const robot = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(1.05, 0.04, -1));
      const own = world.createCollider(R.ColliderDesc.cuboid(0.02, 0.02, 0.02), robot);
      refreshQueries(world);
      const pose = poseAt(100, 100, 4);
      // Any ray meets the robot's box 3 cm ahead, then the pole at 29 cm, and the down ray the floor at 4 / tan 15° = 14.9 cm.
      const any = world.castRay(new R.Ray(pose.position, { x: 1, y: 0, z: 0 }), 4, true);
      expect(any?.collider.handle).toBe(own.handle);
      const reading = measureUltrasonic(world, built, pose, HC_SR04);
      expect(reading.hit?.id).toBe('east');
      expect(reading.cm).toBeCloseTo(50, 4);

      // A lookup that knows the robot's box as something that echoes hits it, unless the box is excluded.
      const withRobot: ColliderLookup<SensedCollider> = {
        infoOf: (collider: Collider) => (collider.handle === own.handle ? { id: 'robot', tags: ['robot'], ultrasonic: true } : built.infoOf(collider)),
      };
      expect(measureUltrasonic(world, withRobot, pose, HC_SR04).hit?.id).toBe('robot');
      const excluded = measureUltrasonic(world, withRobot, pose, HC_SR04, { exclude: (collider) => collider.handle === own.handle });
      expect(excluded.hit?.id).toBe('east');
    });
  });

  // What the program reads: pulseIn truncates the width to whole µs, the helper divides by 58 and truncates again.
  const programCm = (echoUs: number) => echoToCm(Math.trunc(echoUs));

  it('gives the echo width of the contract: echoUs = cm · 58, so the driver reads whole cm, and no echo is 0 µs → 400', () => {
    withWorld(arenaWith([eastWallAt(150)]), (world, built) => {
      const fifty = measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04);
      expect(fifty.cm).toBe(50);
      expect(fifty.echoUs).toBe(2900);
      expect(programCm(fifty.echoUs)).toBe(50);

      const far = measureUltrasonic(world, built, poseAt(26.6, 100, 4), HC_SR04);
      expect(far.cm).toBe(123.4);
      expect(far.echoUs).toBe(far.cm * 58);
      expect(programCm(far.echoUs)).toBe(123);

      const away = measureUltrasonic(world, built, poseAt(100, 100, 4, 180), HC_SR04);
      expect(away).toEqual({ cm: 400, echoUs: 0, hit: null });
      expect(echoToCm(away.echoUs)).toBe(400);
    });
  });

  it('a wall a whole number of cm away reads exactly that through the program: 5..95 cm, facing arena +x and +y', () => {
    // Rapier's float32 time of impact lands a hair under 0.5 m for a wall 50 cm away; pulseIn and the helper both truncate,
    // so without snapping the distance to 1 µm the program would read 49.
    for (const yawDeg of [0, 90]) {
      for (let d = 5; d <= 95; d += 5) {
        const wall = yawDeg === 0 ? eastWallAt(100 + d) : northWallAt(100 + d);
        withWorld(arenaWith([wall]), (world, built) => {
          const reading = measureUltrasonic(world, built, poseAt(100, 100, 4, yawDeg), HC_SR04);
          expect([yawDeg, d, reading.cm, programCm(reading.echoUs)]).toEqual([yawDeg, d, d, d]);
        });
      }
    }
  });

  it('clamps a near echo to 2 cm (or the kit’s larger minCm) and sees nothing beyond its maxCm', () => {
    withWorld(arenaWith([eastWallAt(150)]), (world, built) => {
      const close = measureUltrasonic(world, built, poseAt(149, 100, 4), HC_SR04);
      expect(close).toEqual({ cm: 2, echoUs: 116, hit: built.infoOf(colliderNamed(world, built, 'east')) });
      // Inside the wall: the ray starts in it (time of impact 0).
      expect(measureUltrasonic(world, built, poseAt(150.5, 100, 4), HC_SR04).cm).toBe(2);
      // A kit whose minCm is under the contract's 2 cm still reads 2: 0 µs would mean "no echo" to pulseIn.
      expect(measureUltrasonic(world, built, poseAt(149.5, 100, 4), { ...HC_SR04, minCm: 0 }).cm).toBe(2);
      expect(measureUltrasonic(world, built, poseAt(149, 100, 4), { ...HC_SR04, minCm: 3 }).cm).toBe(3);
      // A 100 cm sensor does not hear the wall 120 cm away; the contract's 400 cm is the most any sensor reads.
      expect(measureUltrasonic(world, built, poseAt(30, 100, 4), { ...HC_SR04, maxCm: 100 })).toEqual({ cm: 400, echoUs: 0, hit: null });
      expect(measureUltrasonic(world, built, poseAt(30, 100, 4), { ...HC_SR04, maxCm: 500 }).cm).toBeCloseTo(120, 4);
    });
  });

  it('refuses a spec whose range is empty', () => {
    withWorld(arenaWith(), (world, built) => {
      expect(() => measureUltrasonic(world, built, poseAt(100, 100, 4), { ...HC_SR04, minCm: 50, maxCm: 40 })).toThrow(RangeError);
      expect(() => measureUltrasonic(world, built, poseAt(100, 100, 4), { ...HC_SR04, maxCm: Number.NaN })).toThrow(RangeError);
    });
  });

  /**
   * A 120 cm wall, 1 cm thick, whose face crosses the beam axis 60 cm ahead of a sensor at (100, 100) facing arena +x, with
   * the face's normal turned `incidenceDeg` from the axis (towards arena +y). A ray at bearing φ meets the face's plane at
   * 60 · cos a / cos(a + φ), at an incidence of a + φ: the right edge ray (φ = −15°) meets it 15° less steeply than the axis.
   */
  const tiltedWall = (incidenceDeg: number) => {
    const a = degToRad(incidenceDeg);
    const [nx, ny] = [0 - cos(a), sin(a)];
    const [tx, ty] = [sin(a), cos(a)];
    const [cx, cy] = [160 - 0.5 * nx, 100 - 0.5 * ny];
    return {
      id: 'tilted',
      fromCm: [cx - 60 * tx, cy - 60 * ty] as [number, number],
      toCm: [cx + 60 * tx, cy + 60 * ty] as [number, number],
      thicknessCm: 1,
    };
  };
  const wideArena = (walls: ArenaInput['walls']) => ({ ...arenaWith(walls), ground: { sizeCm: [300, 200] as [number, number], color: '#ffffff' } });
  const AXIS_ONLY: UltrasonicSpec = { ...HC_SR04, coneHalfDeg: 0 };
  const expectedCm = (incidenceDeg: number, bearingDeg: number) => (60 * cos(degToRad(incidenceDeg))) / cos(degToRad(incidenceDeg + bearingDeg));

  it('a wall at 70° incidence reads 400, and a wall at 30° incidence reads its distance', () => {
    expect(ULTRASONIC_MAX_INCIDENCE_DEG).toBe(60);
    // One ray direction (a cone of 0°): the incidence is the wall's tilt.
    withWorld(wideArena([tiltedWall(70)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY)).toEqual({ cm: 400, echoUs: 0, hit: null });
    });
    withWorld(wideArena([tiltedWall(30)]), (world, built) => {
      const reading = measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY);
      expect(reading.hit?.id).toBe('tilted');
      expect(reading.cm).toBeCloseTo(60, 4);
    });
    // The cutoff is sharp at 60°.
    withWorld(wideArena([tiltedWall(59)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY).cm).toBeCloseTo(60, 4);
    });
    withWorld(wideArena([tiltedWall(61)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY).cm).toBe(400);
    });
  });

  it('a steep wall sends the sound away: it hides what stands behind it', () => {
    withWorld(wideArena([tiltedWall(70), eastWallAt(250)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY).cm).toBe(400);
    });
    withWorld(wideArena([eastWallAt(250)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), AXIS_ONLY).cm).toBeCloseTo(150, 4);
    });
  });

  it('with the ±15° cone the incidence is each ray’s: an edge ray hears a 70° wall at 55°, none hears an 80° wall', () => {
    withWorld(wideArena([tiltedWall(30)]), (world, built) => {
      const reading = measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04);
      expect(reading.cm).toBeCloseTo(expectedCm(30, -15), 3);
    });
    withWorld(wideArena([tiltedWall(70)]), (world, built) => {
      const reading = measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04);
      expect(reading.hit?.id).toBe('tilted');
      expect(reading.cm).toBeCloseTo(expectedCm(70, -15), 3);
    });
    withWorld(wideArena([tiltedWall(80)]), (world, built) => {
      expect(measureUltrasonic(world, built, poseAt(100, 100, 4), HC_SR04)).toEqual({ cm: 400, echoUs: 0, hit: null });
    });
  });

  it('adds seeded noise only when asked: the same seed gives the same readings, within ±amplitude', () => {
    withWorld(arenaWith([eastWallAt(150)]), (world, built) => {
      const pose = poseAt(100, 100, 4);
      const clean = measureUltrasonic(world, built, pose, HC_SR04);
      // Off by default: a reading never changes.
      expect(measureUltrasonic(world, built, pose, HC_SR04)).toEqual(clean);

      const readings = (seed: number) => {
        const rng = createWorldRng(seed);
        return Array.from({ length: 8 }, () => measureUltrasonic(world, built, pose, HC_SR04, { noise: { rng, amplitudeCm: 1 } }));
      };
      const first = readings(7);
      expect(readings(7)).toEqual(first);
      expect(readings(8).map((r) => r.cm)).not.toEqual(first.map((r) => r.cm));
      // Each reading is the clean distance plus one uniform draw in [−1, 1) cm, in the order the stream gives them.
      const stream = createWorldRng(7);
      expect(first.map((r) => r.cm)).toEqual(first.map(() => clean.cm + stream.uniform(-1, 1)));
      for (const r of first) {
        expect(Math.abs(r.cm - clean.cm)).toBeLessThanOrEqual(1);
        expect(r.echoUs).toBe(r.cm * 58);
      }

      // No echo stays 400 / 0 µs, and still takes its draw, so the stream does not depend on what the beam meets.
      const rng = createWorldRng(7);
      const away = measureUltrasonic(world, built, poseAt(100, 100, 4, 180), HC_SR04, { noise: { rng, amplitudeCm: 1 } });
      expect(away).toEqual({ cm: 400, echoUs: 0, hit: null });
      const next = measureUltrasonic(world, built, pose, HC_SR04, { noise: { rng, amplitudeCm: 1 } });
      expect(next.cm).toBe(first[1]!.cm);

      expect(() => measureUltrasonic(world, built, pose, HC_SR04, { noise: { rng, amplitudeCm: -1 } })).toThrow(RangeError);
    });
  });

  it('reads no echo, finite, for a pose that is not finite or has no rotation, and normalises a scaled rotation', () => {
    withWorld(arenaWith([eastWallAt(150)]), (world, built) => {
      const good = poseAt(100, 100, 4);
      const noEcho = { cm: 400, echoUs: 0, hit: null };
      for (const pose of [
        { ...good, position: { ...good.position, x: Number.NaN } },
        { ...good, position: { ...good.position, y: Number.POSITIVE_INFINITY } },
        { ...good, rotation: { ...good.rotation, w: Number.NaN } },
        { ...good, rotation: { x: 0, y: 0, z: 0, w: 0 } },
      ]) {
        expect(measureUltrasonic(world, built, pose, HC_SR04)).toEqual(noEcho);
      }
      const scaled = { ...good, rotation: { x: 0, y: 0, z: 0, w: 2 } };
      expect(measureUltrasonic(world, built, scaled, HC_SR04).cm).toBeCloseTo(50, 4);
    });
  });

  it('costs a few microseconds per measure in the arena with boxes', () => {
    withWorld(boxes as ArenaInput, (world, built) => {
      const pose = poseAt(100, 100, 4, 30);
      for (let i = 0; i < 200; i++) measureUltrasonic(world, built, pose, HC_SR04);
      const count = 5000;
      const started = performance.now();
      for (let i = 0; i < count; i++) measureUltrasonic(world, built, pose, HC_SR04);
      const usPerMeasure = ((performance.now() - started) * 1000) / count;
      console.info(`measureUltrasonic: ${usPerMeasure.toFixed(2)} µs per measure (${count} measures, boxes arena)`);
      // Budget: physics ≤ 0.5 ms per tick for everything (plan §5); one ultrasonic per tick must stay a small part of it.
      expect(usPerMeasure).toBeLessThan(50);
    });
  });
});

function colliderNamed(world: PhysicsWorld, built: BuiltArena, id: string): Collider {
  let found: Collider | undefined;
  world.forEachCollider((collider) => {
    if (built.infoOf(collider)?.id === id) found = collider;
  });
  if (!found) throw new Error(`no collider ${id}`);
  return found;
}
