import { describe, expect, it } from 'vitest';
import { createWorldRng } from '../world/rng';
import { parseArena, type ArenaInput } from '../world/arena/arena-schema';
import fixture from './__fixtures__/all-goals.scenario.json';
import { circleShape, insideGround } from './overlap';
import { loadScenario } from './scenario';
import type { PoseCm, Scenario } from './scenario-schema';
import {
  applyVariant,
  JITTER_TAG,
  ROBOT_FOOTPRINT_RADIUS_CM,
  VARIANT_MAX_ATTEMPTS,
  variantJitterSeed,
  variantOffsets,
  variantSeed,
  type VariantSource,
} from './variants';

const withVariants = (variants: Partial<Scenario['variants']>): Scenario => {
  const scenario = loadScenario(fixture);
  return { ...scenario, variants: { ...scenario.variants, ...variants } };
};

const NONE = { dxCm: 0, dyCm: 0 };

/** A variant source from an arena as JSON, a start and the jitter. */
function source(arena: ArenaInput, start: PoseCm, variants: Partial<VariantSource['variants']> = {}): VariantSource {
  return {
    arena: parseArena(arena),
    start,
    variants: { count: 10, seed: 7, startJitterCm: 0, yawJitterDeg: 0, ...variants },
  };
}

describe('variant 0 is exact start', () => {
  it('moves nothing: the start and every obstacle are the scenario’s own', () => {
    const scenario = loadScenario(fixture);
    const offsets = variantOffsets(scenario, 0);
    expect(offsets).toEqual({
      index: 0,
      seed: 2026,
      start: { dxCm: 0, dyCm: 0, dYawDeg: 0 },
      boxes: [NONE, NONE],
      cylinders: [NONE],
    });
    const applied = applyVariant(scenario, offsets);
    expect(applied.start).toEqual(scenario.start);
    expect(applied.arena).toEqual(scenario.arena);
  });

  it('holds for a scenario of one variant, with or without jitter, and when other seeds are used', () => {
    for (const variants of [{ count: 1 }, { count: 1, seed: 99, startJitterCm: 0, yawJitterDeg: 0 }, { seed: 12345 }]) {
      const scenario = withVariants(variants);
      const offsets = variantOffsets(scenario, 0);
      expect(offsets.start).toEqual({ dxCm: 0, dyCm: 0, dYawDeg: 0 });
      expect(applyVariant(scenario, offsets).start).toEqual(scenario.start);
    }
  });

  it('is exactly +0, never −0, in every offset', () => {
    const offsets = variantOffsets(loadScenario(fixture), 0);
    const numbers = [offsets.start.dxCm, offsets.start.dyCm, offsets.start.dYawDeg, ...offsets.boxes.flatMap((b) => [b.dxCm, b.dyCm]), ...offsets.cylinders.flatMap((c) => [c.dxCm, c.dyCm])];
    expect(numbers.every((n) => Object.is(n, 0))).toBe(true);
  });

  it('is what a scenario with count 1 and no jitter gives, the only variant it has', () => {
    const scenario = withVariants({ count: 1, startJitterCm: 0, yawJitterDeg: 0, obstacleJitterCm: undefined });
    expect(variantOffsets(scenario, 0).boxes).toEqual([NONE, NONE]);
    expect(() => variantOffsets(scenario, 1)).toThrow(RangeError);
  });
});

describe('variants differ and stay inside arena', () => {
  const scenario = withVariants({ count: 10 });
  const { startJitterCm, yawJitterDeg, obstacleJitterCm } = scenario.variants;
  const applied = Array.from({ length: 10 }, (_, i) => ({ offsets: variantOffsets(scenario, i), ...applyVariant(scenario, variantOffsets(scenario, i)) }));
  const [width, depth] = scenario.arena.ground.sizeCm;

  it('differ: ten different starts, and variants 1..9 each differ from the exact start', () => {
    expect(new Set(applied.map((v) => JSON.stringify(v.start))).size).toBe(10);
    for (const v of applied.slice(1)) {
      expect(v.start).not.toEqual(scenario.start);
    }
  });

  it('keep the start within the jitter, in x, y and yaw', () => {
    for (const { offsets } of applied) {
      expect(Math.abs(offsets.start.dxCm)).toBeLessThanOrEqual(startJitterCm);
      expect(Math.abs(offsets.start.dyCm)).toBeLessThanOrEqual(startJitterCm);
      expect(Math.abs(offsets.start.dYawDeg)).toBeLessThanOrEqual(yawJitterDeg);
    }
  });

  it('keep the robot’s footprint on the ground, clear of the walls (which are 2 cm thick)', () => {
    for (const { start } of applied) {
      expect(insideGround(circleShape(start.xCm, start.yCm, ROBOT_FOOTPRINT_RADIUS_CM), width, depth)).toBe(true);
      expect(start.xCm - ROBOT_FOOTPRINT_RADIUS_CM).toBeGreaterThanOrEqual(2);
      expect(start.yCm - ROBOT_FOOTPRINT_RADIUS_CM).toBeGreaterThanOrEqual(2);
    }
  });

  it('move only the obstacles tagged `jitter`, by no more than the obstacle jitter, and keep them on the ground', () => {
    expect(scenario.arena.boxes.map((box) => box.tags.includes(JITTER_TAG))).toEqual([true, false]);
    expect(scenario.arena.cylinders.map((cylinder) => cylinder.tags.includes(JITTER_TAG))).toEqual([true]);
    for (const { offsets, arena } of applied.slice(1)) {
      expect(offsets.boxes[1]).toEqual(NONE); // the bench is not tagged
      expect(arena.boxes[1]).toBe(scenario.arena.boxes[1]);
      for (const move of [offsets.boxes[0]!, offsets.cylinders[0]!]) {
        expect(Math.abs(move.dxCm)).toBeLessThanOrEqual(obstacleJitterCm!);
        expect(Math.abs(move.dyCm)).toBeLessThanOrEqual(obstacleJitterCm!);
      }
      const block = arena.boxes[0]!;
      const pole = arena.cylinders[0]!;
      expect(block.centerCm).toEqual([100 + offsets.boxes[0]!.dxCm, 25 + offsets.boxes[0]!.dyCm]);
      expect(pole.centerCm).toEqual([100 + offsets.cylinders[0]!.dxCm, 140 + offsets.cylinders[0]!.dyCm]);
      expect(block.centerCm[1]).toBeGreaterThan(2 + 4 + 5); // clear of the south wall and as far as the box reaches
      expect(pole.centerCm[1]).toBeLessThan(depth - 2 - 3);
    }
    // Somewhere among the nine variants the obstacles really move.
    expect(applied.slice(1).some((v) => v.offsets.boxes[0]!.dxCm !== 0 && v.offsets.cylinders[0]!.dyCm !== 0)).toBe(true);
  });

  it('keep the robot, the obstacles and the objects of the arena clear of each other', () => {
    const rest = [
      { name: 'bench', x: 60, y: 100, reach: Math.sqrt(5 * 5 + 5 * 5) },
      { name: 'crate', x: 130, y: 80, reach: Math.sqrt(4 * 4 + 4 * 4) },
    ];
    for (const { start, arena } of applied) {
      const things = [
        { name: 'robot', x: start.xCm, y: start.yCm, reach: ROBOT_FOOTPRINT_RADIUS_CM },
        { name: 'block', x: arena.boxes[0]!.centerCm[0], y: arena.boxes[0]!.centerCm[1], reach: Math.sqrt(7 * 7 + 4 * 4) },
        { name: 'pole', x: arena.cylinders[0]!.centerCm[0], y: arena.cylinders[0]!.centerCm[1], reach: 3 },
        ...rest,
      ];
      for (const a of things) {
        for (const b of things) {
          if (a.name < b.name) {
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.name} and ${b.name}`).toBeGreaterThan(a.reach + b.reach);
          }
        }
      }
    }
  });

  it('give an index that is not a variant of the scenario a RangeError', () => {
    expect(() => variantOffsets(scenario, 10)).toThrow(RangeError);
    expect(() => variantOffsets(scenario, -1)).toThrow(RangeError);
    expect(() => variantOffsets(scenario, 1.5)).toThrow(RangeError);
    expect(() => variantOffsets(scenario, Number.NaN)).toThrow(RangeError);
    expect(() => variantOffsets(loadScenario(fixture), 3)).toThrow('The scenario has 3 variants (0..2), not variant 3.');
  });
});

describe('seeded', () => {
  it('gives the same offsets for the same seed and index, whatever was asked before', () => {
    const scenario = withVariants({ count: 10 });
    const first = variantOffsets(scenario, 4);
    variantOffsets(scenario, 7);
    variantOffsets(scenario, 1);
    expect(variantOffsets(scenario, 4)).toEqual(first);
    expect(variantOffsets(structuredClone(scenario), 4)).toEqual(first);
  });

  it('gives different offsets for another seed, and for another index', () => {
    const starts = (seed: number) => JSON.stringify(variantOffsets(withVariants({ seed }), 1).start);
    expect(new Set([1, 2, 3, 4, 5, 2026, 2027, 99999].map(starts)).size).toBe(8);
    const scenario = withVariants({ count: 10 });
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => JSON.stringify(variantOffsets(scenario, i)))).size).toBe(9);
  });

  it('seeds a variant with the scenario seed plus its index, and its jitter from another stream', () => {
    const scenario = withVariants({ count: 10, seed: 4294967295 });
    expect(variantSeed(scenario, 0)).toBe(4294967295);
    expect(variantSeed(scenario, 1)).toBe(0); // 32 bits, so the seed wraps
    expect(variantSeed(scenario, 9)).toBe(8);
    expect(variantOffsets(scenario, 3).seed).toBe(2);
    expect(variantJitterSeed(scenario, 3)).not.toBe(variantSeed(scenario, 3));
  });

  it('draws x, y and yaw of the start, then x and y of each tagged box and then each tagged cylinder, from the one stream', () => {
    const scenario = loadScenario(fixture);
    const rng = createWorldRng(variantJitterSeed(scenario, 1));
    const expected = {
      index: 1,
      seed: 2027,
      start: { dxCm: rng.uniform(-4, 4), dyCm: rng.uniform(-4, 4), dYawDeg: rng.uniform(-10, 10) },
      boxes: [{ dxCm: rng.uniform(-5, 5), dyCm: rng.uniform(-5, 5) }, NONE],
      cylinders: [{ dxCm: rng.uniform(-5, 5), dyCm: rng.uniform(-5, 5) }],
    };
    expect(variantOffsets(scenario, 1)).toEqual(expected);
  });

  it('pins the numbers of the fixture, which must not change with the engine (golden)', () => {
    const scenario = loadScenario(fixture);
    expect(variantOffsets(scenario, 1)).toMatchInlineSnapshot(`
      {
        "boxes": [
          {
            "dxCm": 2.2470549936406314,
            "dyCm": 2.8385308105498552,
          },
          {
            "dxCm": 0,
            "dyCm": 0,
          },
        ],
        "cylinders": [
          {
            "dxCm": -2.3958403640426695,
            "dyCm": 3.0585488700307906,
          },
        ],
        "index": 1,
        "seed": 2027,
        "start": {
          "dYawDeg": -7.535964520648122,
          "dxCm": -2.17309202067554,
          "dyCm": -2.863245766609907,
        },
      }
    `);
    expect(variantOffsets(scenario, 2)).toMatchInlineSnapshot(`
      {
        "boxes": [
          {
            "dxCm": 1.969060346018523,
            "dyCm": 1.797123090364039,
          },
          {
            "dxCm": 0,
            "dyCm": 0,
          },
        ],
        "cylinders": [
          {
            "dxCm": -1.617473119404167,
            "dyCm": -3.2288665953092277,
          },
        ],
        "index": 2,
        "seed": 2028,
        "start": {
          "dYawDeg": 1.43508892506361,
          "dxCm": -1.6433734688907862,
          "dyCm": -2.4798919800668955,
        },
      }
    `);
  });

  it('adds the offset to the start: x + dx, y + dy, yaw + dYaw', () => {
    const scenario = loadScenario(fixture);
    const offsets = variantOffsets(scenario, 2);
    expect(applyVariant(scenario, offsets).start).toEqual({
      xCm: 30 + offsets.start.dxCm,
      yCm: 40 + offsets.start.dyCm,
      yawDeg: 0 + offsets.start.dYawDeg,
    });
  });

  it('does not touch the scenario', () => {
    const scenario = loadScenario(fixture);
    const before = structuredClone(scenario);
    applyVariant(scenario, variantOffsets(scenario, 1));
    expect(scenario).toEqual(before);
  });

  it('keeps the start still when its jitter is 0, and the obstacles when there is no obstacle jitter', () => {
    const still = withVariants({ startJitterCm: 0, yawJitterDeg: 0, obstacleJitterCm: undefined });
    for (let i = 0; i < 3; i++) {
      const offsets = variantOffsets(still, i);
      expect(offsets.start).toEqual({ dxCm: 0, dyCm: 0, dYawDeg: 0 });
      expect(offsets.boxes).toEqual([NONE, NONE]);
      expect(offsets.cylinders).toEqual([NONE]);
      expect(applyVariant(still, offsets).arena).toBe(still.arena);
    }
  });

  it('turns the robot alone when only the yaw jitters', () => {
    const turning = withVariants({ startJitterCm: 0, yawJitterDeg: 15 });
    const offsets = variantOffsets(turning, 1);
    expect(offsets.start.dxCm).toBe(0);
    expect(offsets.start.dyCm).toBe(0);
    expect(Math.abs(offsets.start.dYawDeg)).toBeGreaterThan(0);
    expect(Math.abs(offsets.start.dYawDeg)).toBeLessThanOrEqual(15);
  });
});

describe('a draw that overlaps is thrown away and drawn again', () => {
  // 200 × 100 floor, a fixed barrier at x 85..95 across the whole depth, a pole of radius 5 at x = 100 touching it.
  // A pole whose centre is 0 to 20 cm to the left of where it stands (x 80..100) overlaps the barrier; any other place is free.
  // The robot starts far off and does not jitter.
  const arena: ArenaInput = {
    ground: { sizeCm: [200, 100], color: '#ffffff' },
    boxes: [{ id: 'barrier', centerCm: [90, 50], sizeCm: [10, 100, 10] }],
    cylinders: [{ id: 'pole', centerCm: [100, 50], radiusCm: 5, heightCm: 20, tags: [JITTER_TAG] }],
  };
  const scenario = source(arena, { xCm: 20, yCm: 50, yawDeg: 0 }, { obstacleJitterCm: 40 });

  it('keeps the first draw that fits: not in the barrier, which a pole centred 0..20 cm left of x = 100 would overlap', () => {
    let redrawn = 0;
    for (let i = 1; i < 10; i++) {
      const rng = createWorldRng(variantJitterSeed(scenario, i));
      let dx = rng.uniform(-40, 40);
      let dy = rng.uniform(-40, 40);
      while (dx > -20 && dx < 0) {
        redrawn++;
        dx = rng.uniform(-40, 40);
        dy = rng.uniform(-40, 40);
      }
      expect(variantOffsets(scenario, i).cylinders).toEqual([{ dxCm: dx, dyCm: dy }]);
    }
    // The test is only worth something when it really made a variant draw again.
    expect(redrawn).toBeGreaterThan(0);
  });

  it('keeps the pole on the ground: a draw that would put it off the floor is thrown away too', () => {
    const corner = source(
      { ground: { sizeCm: [100, 100], color: '#ffffff' }, cylinders: [{ id: 'pole', centerCm: [95, 50], radiusCm: 5, heightCm: 20, tags: [JITTER_TAG] }] },
      { xCm: 20, yCm: 50, yawDeg: 0 },
      { obstacleJitterCm: 30 },
    );
    for (let i = 1; i < 10; i++) {
      const { dxCm, dyCm } = variantOffsets(corner, i).cylinders[0]!;
      expect(95 + dxCm + 5).toBeLessThanOrEqual(100);
      expect(50 + dyCm + 5).toBeLessThanOrEqual(100);
      expect(50 + dyCm - 5).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the robot away from the walls of the arena and from the obstacles, the start being drawn again', () => {
    const near = source(
      {
        ground: { sizeCm: [100, 100], color: '#ffffff' },
        walls: [
          { fromCm: [0, 1], toCm: [100, 1] },
          { fromCm: [1, 0], toCm: [1, 100] },
        ],
        boxes: [{ id: 'crate', centerCm: [40, 12], sizeCm: [10, 10, 10] }],
      },
      { xCm: 13, yCm: 14, yawDeg: 90 },
      { startJitterCm: 20, yawJitterDeg: 30 },
    );
    let moved = 0;
    for (let i = 1; i < 10; i++) {
      const { start } = applyVariant(near, variantOffsets(near, i));
      expect(start.xCm - ROBOT_FOOTPRINT_RADIUS_CM).toBeGreaterThanOrEqual(2); // not in the west wall (x 0..2)
      expect(start.yCm - ROBOT_FOOTPRINT_RADIUS_CM).toBeGreaterThanOrEqual(2); // nor in the south wall
      // The crate spans x 35..45, y 7..17: the robot’s circle stays out of it.
      const nearestX = Math.max(35, Math.min(45, start.xCm));
      const nearestY = Math.max(7, Math.min(17, start.yCm));
      expect(Math.hypot(start.xCm - nearestX, start.yCm - nearestY)).toBeGreaterThanOrEqual(ROBOT_FOOTPRINT_RADIUS_CM);
      if (start.xCm !== 13) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps tagged obstacles from landing on each other or on the robot, over many seeds', () => {
    const crowded = source(
      {
        ground: { sizeCm: [80, 80], color: '#ffffff' },
        boxes: [
          { id: 'a', centerCm: [30, 40], sizeCm: [10, 10, 10], tags: [JITTER_TAG] },
          { id: 'b', centerCm: [50, 40], sizeCm: [10, 10, 10], tags: [JITTER_TAG] },
        ],
        cylinders: [{ id: 'c', centerCm: [40, 60], radiusCm: 5, heightCm: 10, tags: [JITTER_TAG] }],
      },
      { xCm: 40, yCm: 15, yawDeg: 0 },
      { obstacleJitterCm: 15, startJitterCm: 3 },
    );
    for (let seed = 0; seed < 200; seed++) {
      const scenario = { ...crowded, variants: { ...crowded.variants, seed, count: 10 } };
      for (let i = 1; i < 10; i++) {
        const { start, arena } = applyVariant(scenario, variantOffsets(scenario, i));
        const [a, b] = arena.boxes.map((box) => box.centerCm);
        const c = arena.cylinders[0]!.centerCm;
        // Two 10 cm squares, not turned: they overlap when both axes are closer than 10; the circle is checked by distance to the square.
        const apart = (p: readonly number[], q: readonly number[]) => Math.abs(p[0]! - q[0]!) >= 10 || Math.abs(p[1]! - q[1]!) >= 10;
        const circleApart = (square: readonly number[], circle: readonly number[], r: number) =>
          Math.hypot(circle[0]! - Math.max(square[0]! - 5, Math.min(square[0]! + 5, circle[0]!)), circle[1]! - Math.max(square[1]! - 5, Math.min(square[1]! + 5, circle[1]!))) >= r;
        const at = `seed ${seed} variant ${i}`;
        expect(apart(a!, b!), at).toBe(true);
        expect(circleApart(a!, c, 5), at).toBe(true);
        expect(circleApart(b!, c, 5), at).toBe(true);
        for (const square of [a!, b!]) {
          expect(circleApart(square, [start.xCm, start.yCm], ROBOT_FOOTPRINT_RADIUS_CM), at).toBe(true);
        }
        expect(Math.hypot(c[0]! - start.xCm, c[1]! - start.yCm), at).toBeGreaterThanOrEqual(5 + ROBOT_FOOTPRINT_RADIUS_CM);
      }
    }
  });
});

describe('a thing that does not move still counts as being where it is', () => {
  it('keeps the robot clear of a tagged obstacle that does not move (no obstacle jitter), over many seeds', () => {
    // The robot at (50, 50) may jitter 15 cm; the box at x 67..77 is 7 cm from its circle, so moving right by more than 7 overlaps it.
    const arena: ArenaInput = {
      ground: { sizeCm: [120, 100], color: '#ffffff' },
      boxes: [{ id: 'box', centerCm: [72, 50], sizeCm: [10, 10, 10], tags: [JITTER_TAG] }],
    };
    let toTheRight = 0;
    for (let seed = 0; seed < 300; seed++) {
      const scenario = source(arena, { xCm: 50, yCm: 50, yawDeg: 0 }, { startJitterCm: 15, seed, count: 4 });
      for (let i = 1; i < 4; i++) {
        const { start } = applyVariant(scenario, variantOffsets(scenario, i));
        const gap = Math.hypot(start.xCm - Math.max(67, Math.min(77, start.xCm)), start.yCm - Math.max(45, Math.min(55, start.yCm)));
        expect(gap, `seed ${seed} variant ${i}`).toBeGreaterThanOrEqual(ROBOT_FOOTPRINT_RADIUS_CM);
        if (start.xCm > 50) toTheRight++;
      }
    }
    expect(toTheRight).toBeGreaterThan(0);
  });

  it('keeps an obstacle off the authored place of a later one that cannot move, over many seeds', () => {
    // The cylinder (a later draw than the box) stands in a cage open at the bottom: with a jitter of 4 cm any sideways move overlaps a
    // wall, so it always keeps its place. The small box, drawn first, stands just under it and can move up into it, unless the
    // cylinder’s place counts.
    const arena: ArenaInput = {
      ground: { sizeCm: [100, 100], color: '#ffffff' },
      walls: [
        { fromCm: [44, 40], toCm: [44, 60], thicknessCm: 2 },
        { fromCm: [56, 40], toCm: [56, 60], thicknessCm: 2 },
        { fromCm: [44, 60], toCm: [56, 60], thicknessCm: 2 },
      ],
      boxes: [{ id: 'small', centerCm: [50, 41], sizeCm: [4, 4, 4], tags: [JITTER_TAG] }],
      cylinders: [{ id: 'caged', centerCm: [50, 50], radiusCm: 5, heightCm: 10, tags: [JITTER_TAG] }],
    };
    for (let seed = 0; seed < 3000; seed++) {
      const scenario = source(arena, { xCm: 15, yCm: 85, yawDeg: 0 }, { obstacleJitterCm: 4, seed, count: 3 });
      for (let i = 1; i < 3; i++) {
        const offsets = variantOffsets(scenario, i);
        expect(offsets.cylinders[0], `seed ${seed} variant ${i}`).toEqual(NONE);
        const [x, y] = applyVariant(scenario, offsets).arena.boxes[0]!.centerCm;
        const gap = Math.hypot(50 - Math.max(x - 2, Math.min(x + 2, 50)), 50 - Math.max(y - 2, Math.min(y + 2, 50)));
        expect(gap, `seed ${seed} variant ${i}`).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('after a bounded number of draws the authored value is kept', () => {
  // A pole of radius 5 in a 10 × 10 pocket made by four walls: any move at all overlaps a wall. A second pole outside moves freely.
  const pocket: ArenaInput = {
    ground: { sizeCm: [100, 100], color: '#ffffff' },
    walls: [
      { fromCm: [44, 40], toCm: [44, 60], thicknessCm: 2 },
      { fromCm: [56, 40], toCm: [56, 60], thicknessCm: 2 },
      { fromCm: [40, 44], toCm: [60, 44], thicknessCm: 2 },
      { fromCm: [40, 56], toCm: [60, 56], thicknessCm: 2 },
    ],
    cylinders: [
      { id: 'caged', centerCm: [50, 50], radiusCm: 5, heightCm: 10, tags: [JITTER_TAG] },
      { id: 'free', centerCm: [80, 20], radiusCm: 3, heightCm: 10, tags: [JITTER_TAG] },
    ],
  };
  const scenario = source(pocket, { xCm: 15, yCm: 80, yawDeg: 0 }, { obstacleJitterCm: 10 });

  it('leaves the caged pole exactly where it was, in every variant, while the free one moves', () => {
    for (let i = 1; i < 10; i++) {
      const offsets = variantOffsets(scenario, i);
      expect(offsets.cylinders[0]).toEqual(NONE);
      expect(Object.is(offsets.cylinders[0]!.dxCm, 0) && Object.is(offsets.cylinders[0]!.dyCm, 0)).toBe(true);
      expect(offsets.cylinders[1]).not.toEqual(NONE);
      const { arena } = applyVariant(scenario, offsets);
      expect(arena.cylinders[0]).toBe(scenario.arena.cylinders[0]);
    }
  });

  it('gives up after VARIANT_MAX_ATTEMPTS draws, so the next obstacle’s draws come after 2 × that many numbers of the stream', () => {
    expect(VARIANT_MAX_ATTEMPTS).toBe(20);
    const rng = createWorldRng(variantJitterSeed(scenario, 1));
    for (let k = 0; k < 2 * VARIANT_MAX_ATTEMPTS; k++) rng.next();
    expect(variantOffsets(scenario, 1).cylinders[1]).toEqual({ dxCm: rng.uniform(-10, 10), dyCm: rng.uniform(-10, 10) });
  });

  it('keeps the authored position when no draw of it fits, and the yaw of the first draw', () => {
    // The gap between two walls is 20 cm and the robot’s circle 20 cm across: it fits only where it is (y 50); any move in y overlaps a wall.
    const slot = source(
      {
        ground: { sizeCm: [100, 100], color: '#ffffff' },
        walls: [
          { fromCm: [0, 39], toCm: [100, 39], thicknessCm: 2 }, // y 38..40
          { fromCm: [0, 61], toCm: [100, 61], thicknessCm: 2 }, // y 60..62
        ],
      },
      { xCm: 50, yCm: 50, yawDeg: 45 },
      { startJitterCm: 1, yawJitterDeg: 20 },
    );
    for (let i = 1; i < 10; i++) {
      const rng = createWorldRng(variantJitterSeed(slot, i));
      rng.uniform(-1, 1); // the first draw’s x and y, which do not fit,
      rng.uniform(-1, 1);
      const firstYaw = rng.uniform(-20, 20); // and its yaw, which the position falling back does not take with it
      const offsets = variantOffsets(slot, i);
      expect(offsets.start).toEqual({ dxCm: 0, dyCm: 0, dYawDeg: firstYaw });
      expect(firstYaw).not.toBe(0);
      expect(applyVariant(slot, offsets).start).toEqual({ xCm: 50, yCm: 50, yawDeg: 45 + firstYaw });
    }
  });

  it('draws the obstacles after the start’s VARIANT_MAX_ATTEMPTS draws of three numbers, when the start falls back', () => {
    const arena: ArenaInput = {
      ground: { sizeCm: [100, 100], color: '#ffffff' },
      walls: [
        { fromCm: [0, 39], toCm: [100, 39], thicknessCm: 2 },
        { fromCm: [0, 61], toCm: [100, 61], thicknessCm: 2 },
      ],
      cylinders: [{ id: 'free', centerCm: [80, 50], radiusCm: 3, heightCm: 10, tags: [JITTER_TAG] }],
    };
    // The cylinder is in the same corridor, so it can only slide along x: a move in y of more than 8 cm hits a wall; a small one fits.
    const scenario = source(arena, { xCm: 20, yCm: 50, yawDeg: 0 }, { startJitterCm: 1, yawJitterDeg: 20, obstacleJitterCm: 5 });
    const rng = createWorldRng(variantJitterSeed(scenario, 1));
    for (let k = 0; k < 3 * VARIANT_MAX_ATTEMPTS; k++) rng.next();
    expect(variantOffsets(scenario, 1).cylinders[0]).toEqual({ dxCm: rng.uniform(-5, 5), dyCm: rng.uniform(-5, 5) });
  });

  it('lets a start close to a wall keep its yaw jitter, since the yaw does not move the robot’s footprint', () => {
    const close = source(
      { ground: { sizeCm: [100, 100], color: '#ffffff' }, walls: [{ fromCm: [0, 1], toCm: [100, 1] }] },
      { xCm: 50, yCm: 8, yawDeg: 90 }, // 8 cm from the floor’s edge: the 10 cm circle already touches the wall (y 0..2)
      { yawJitterDeg: 25 },
    );
    for (let i = 1; i < 10; i++) {
      const { start } = variantOffsets(close, i);
      expect(start.dxCm).toBe(0);
      expect(start.dyCm).toBe(0);
      expect(start.dYawDeg).not.toBe(0);
      expect(Math.abs(start.dYawDeg)).toBeLessThanOrEqual(25);
    }
  });
});

// N18 R5.2a fix round 2: `startJitterAlongCm` moves the start up to that far along its heading, and `startJitterCm` across it.
describe('a start that moves farther along its heading than across it', () => {
  const line = { ground: { sizeCm: [300, 200] as [number, number], color: '#ffffff' } };

  it('moves up to ±along along the heading and ±startJitterCm across it, at any heading', () => {
    for (const yawDeg of [0, 90, 180, -90, 30]) {
      const scenario = source(line, { xCm: 150, yCm: 100, yawDeg }, { count: 10, seed: 11, startJitterCm: 1.5, startJitterAlongCm: 15, yawJitterDeg: 0 });
      const a = (yawDeg * Math.PI) / 180;
      let farthestAlong = 0;
      for (let index = 1; index < 10; index++) {
        const { dxCm, dyCm } = variantOffsets(scenario, index).start;
        const along = dxCm * Math.cos(a) + dyCm * Math.sin(a);
        const across = -dxCm * Math.sin(a) + dyCm * Math.cos(a);
        expect(Math.abs(along)).toBeLessThanOrEqual(15 + 1e-9);
        expect(Math.abs(across)).toBeLessThanOrEqual(1.5 + 1e-9);
        farthestAlong = Math.max(farthestAlong, Math.abs(along));
      }
      expect(farthestAlong).toBeGreaterThan(5);
    }
  });

  it('draws the same numbers as the jitter without it, only scaled: the first draw along, the second across', () => {
    const plainScenario = source(line, { xCm: 150, yCm: 100, yawDeg: 0 }, { count: 4, seed: 5, startJitterCm: 4, yawJitterDeg: 6 });
    const alongScenario = source(line, { xCm: 150, yCm: 100, yawDeg: 0 }, { count: 4, seed: 5, startJitterCm: 1, startJitterAlongCm: 12, yawJitterDeg: 6 });
    for (let index = 1; index < 4; index++) {
      const before = variantOffsets(plainScenario, index).start;
      const after = variantOffsets(alongScenario, index).start;
      expect(after.dxCm).toBeCloseTo((before.dxCm * 12) / 4, 9);
      expect(after.dyCm).toBeCloseTo(before.dyCm / 4, 9);
      expect(after.dYawDeg).toBe(before.dYawDeg);
    }
  });

  it('is exact at the right angles: a start heading +y moves along y', () => {
    const scenario = source(line, { xCm: 150, yCm: 100, yawDeg: 90 }, { count: 3, seed: 2, startJitterCm: 0, startJitterAlongCm: 10, yawJitterDeg: 0 });
    for (let index = 1; index < 3; index++) {
      const { dxCm, dyCm } = variantOffsets(scenario, index).start;
      expect(dxCm).toBe(0);
      expect(Math.abs(dyCm)).toBeGreaterThan(0);
    }
  });

  it('jitters a start with only the along jitter set, and keeps one that fits nowhere at its place', () => {
    const scenario = source(line, { xCm: 150, yCm: 100, yawDeg: 0 }, { count: 3, seed: 2, startJitterCm: 0, startJitterAlongCm: 10, yawJitterDeg: 0 });
    expect(variantOffsets(scenario, 1).start.dxCm).not.toBe(0);
    const boxedIn = source(
      { ...line, walls: [{ fromCm: [138, 80], toCm: [138, 120] }, { fromCm: [162, 80], toCm: [162, 120] }] },
      { xCm: 150, yCm: 100, yawDeg: 0 },
      { count: 3, seed: 2, startJitterCm: 0, startJitterAlongCm: 10, yawJitterDeg: 0 },
    );
    expect(variantOffsets(boxedIn, 1).start).toEqual({ dxCm: 0, dyCm: 0, dYawDeg: 0 });
  });
});
