import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/pick-place.scenario.json';
import allGoals from './__fixtures__/all-goals.scenario.json';
import { createWorldRng } from '../world/rng';
import { circleShape, rectShape, shapesOverlap, wallShape } from './overlap';
import { loadScenario, type Scenario } from './scenario';
import { applyVariant, variantJitterSeed, variantObjectColors, variantOffsets, VARIANT_MAX_ATTEMPTS } from './variants';

// N19 D1 (plan §4.5): a variant moves the objects of `variants.objectJitter` (one draw of dx, dy per entry, which moves every object of the
// entry by it) and gives the objects of `variants.objectColors` the colour of its index. The new draws come after every draw N18 takes, so
// the start and the obstacles of a variant are the same with or without them (n19-neutral.test.ts pins the N18 scenarios themselves).

const RADIUS = 11;
const scenario = loadScenario(fixture);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edited = (edit: (json: any) => void): Scenario => {
  const json = structuredClone(fixture);
  edit(json);
  return loadScenario(json);
};
const ZERO = { dxCm: 0, dyCm: 0 };

describe('the objects of a variant (N19 D1)', () => {
  it('leaves every object where it is in variant 0, with the arena’s own colours, and gives the arena itself', () => {
    const offsets = variantOffsets(scenario, 0, RADIUS);
    expect(offsets.objects).toEqual([ZERO, ZERO, ZERO, ZERO, ZERO, ZERO]);
    expect(applyVariant(scenario, offsets).arena).toBe(scenario.arena);
    expect(variantObjectColors(scenario, 0)).toEqual({ cube: '#d32f2f', base: '#fbc02d' });
  });

  it('draws them after the start (and the obstacles): x and y of each entry in order, from the same stream', () => {
    for (const index of [1, 2]) {
      const rng = createWorldRng(variantJitterSeed(scenario, index));
      const start = { dxCm: rng.uniform(-1, 1), dyCm: rng.uniform(-1, 1), dYawDeg: rng.uniform(-2, 2) };
      const cube = { dxCm: rng.uniform(-5, 5), dyCm: rng.uniform(-0, 0) + 0 };
      const parcels = { dxCm: rng.uniform(-0, 0) + 0, dyCm: rng.uniform(-3, 3) };
      expect(variantOffsets(scenario, index, RADIUS)).toEqual({
        index,
        seed: 7 + index,
        start,
        boxes: [],
        cylinders: [],
        objects: [cube, ZERO, parcels, parcels, parcels, ZERO],
      });
    }
  });

  it('pins the numbers of the fixture (golden)', () => {
    expect(variantOffsets(scenario, 1, RADIUS).objects!.map(({ dxCm, dyCm }) => [dxCm, dyCm])).toMatchInlineSnapshot(`
      [
        [
          0.19299937412142754,
          0,
        ],
        [
          0,
          0,
        ],
        [
          0,
          -0.44703687680885196,
        ],
        [
          0,
          -0.44703687680885196,
        ],
        [
          0,
          -0.44703687680885196,
        ],
        [
          0,
          0,
        ],
      ]
    `);
    expect(variantOffsets(scenario, 2, RADIUS).objects!.map(({ dxCm, dyCm }) => [dxCm, dyCm])).toMatchInlineSnapshot(`
      [
        [
          4.131280593574047,
          0,
        ],
        [
          0,
          0,
        ],
        [
          0,
          -1.3479142463766038,
        ],
        [
          0,
          -1.3479142463766038,
        ],
        [
          0,
          -1.3479142463766038,
        ],
        [
          0,
          0,
        ],
      ]
    `);
  });

  it('does not change the draws N18 takes: the start and the obstacles are those of the same scenario without the new fields', () => {
    const withObstacles = (json: typeof allGoals, extra: object) => loadScenario({ ...json, variants: { ...json.variants, ...extra } });
    const plain = loadScenario(allGoals);
    const moved = withObstacles(allGoals, { objectJitter: [{ objects: ['crate'], dxCm: 4, dyCm: 4 }] });
    for (const index of [0, 1, 2]) {
      const before = variantOffsets(plain, index, RADIUS);
      const after = variantOffsets(moved, index, RADIUS);
      expect({ ...after, objects: undefined }).toEqual(before);
      expect(after.objects).toHaveLength(1);
    }
    expect(variantOffsets(moved, 1, RADIUS).objects![0]).not.toEqual(ZERO);
  });

  it('takes no draw and adds no field for the colours alone: they are a list, one per variant', () => {
    const coloursOnly = edited((json) => delete json.variants.objectJitter);
    const plain = edited((json) => {
      delete json.variants.objectJitter;
      delete json.variants.objectColors;
    });
    for (const index of [0, 1, 2]) {
      expect(variantOffsets(coloursOnly, index, RADIUS)).toEqual(variantOffsets(plain, index, RADIUS));
      expect(variantOffsets(coloursOnly, index, RADIUS)).not.toHaveProperty('objects');
    }
    expect([0, 1, 2].map((index) => variantObjectColors(coloursOnly, index).cube)).toEqual(['#d32f2f', '#388e3c', '#1976d2']);
  });

  it('moves the objects and paints them in the arena it gives; an object that neither moves nor changes is the same object', () => {
    const offsets = variantOffsets(scenario, 1, RADIUS);
    const { arena } = applyVariant(scenario, offsets);
    const [cube, base, p1, p2, p3, can] = arena.objects;
    const move = offsets.objects!;
    expect(cube).toEqual({ ...scenario.arena.objects[0], centerCm: [85 + move[0]!.dxCm, 60 + move[0]!.dyCm], color: '#388e3c' });
    expect(base).toBe(scenario.arena.objects[1]);
    expect([p1!.centerCm, p2!.centerCm, p3!.centerCm]).toEqual([60, 80, 100].map((x) => [x + move[2]!.dxCm, 20 + move[2]!.dyCm]));
    expect(can).toBe(scenario.arena.objects[5]);
    expect(arena.walls).toBe(scenario.arena.walls);
    expect(scenario.arena.objects[0]!.color).toBe('#d32f2f'); // the scenario is not changed
    expect(applyVariant(scenario, variantOffsets(scenario, 2, RADIUS)).arena.objects[0]!.color).toBe('#1976d2');
  });

  it('keeps the objects off the walls, the robot at its start, the boxes and cylinders, and one another', () => {
    for (let seed = 0; seed < 40; seed++) {
      const crowded = edited((json) => {
        json.variants.seed = seed;
        json.variants.count = 10;
        json.variants.objectColors = undefined;
        json.variants.objectJitter = [
          { objects: ['cube'], dxCm: 20, dyCm: 20 },
          { objects: ['parcel-1', 'parcel-2', 'parcel-3'], dxCm: 10, dyCm: 15 },
          { objects: ['can'], dxCm: 15, dyCm: 25 },
        ];
        json.arena.boxes = [{ centerCm: [85, 85], sizeCm: [10, 4, 5] }];
        json.arena.cylinders = [{ centerCm: [60, 45], radiusCm: 3, heightCm: 5 }];
      });
      for (let index = 1; index < 10; index++) {
        const offsets = variantOffsets(crowded, index, RADIUS);
        const { arena, start } = applyVariant(crowded, offsets);
        const shapes = arena.objects.map((object) =>
          object.shape === 'box'
            ? rectShape(object.centerCm[0], object.centerCm[1], object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.yawDeg)
            : circleShape(object.centerCm[0], object.centerCm[1], object.radiusCm),
        );
        const fixed = [
          ...arena.walls.map((wall) => wallShape(wall.fromCm[0], wall.fromCm[1], wall.toCm[0], wall.toCm[1], wall.thicknessCm)),
          rectShape(85, 85, 5, 2, 0),
          circleShape(60, 45, 3),
          circleShape(start.xCm, start.yCm, RADIUS),
        ];
        shapes.forEach((shape, i) => {
          expect(fixed.some((other) => shapesOverlap(shape, other)), `seed ${seed} variant ${index} object ${i}`).toBe(false);
          shapes.forEach((other, j) => {
            if (j !== i) expect(shapesOverlap(shape, other), `seed ${seed} variant ${index} objects ${i} ${j}`).toBe(false);
          });
        });
      }
    }
  });

  it(`keeps an object where the author put it when ${VARIANT_MAX_ATTEMPTS} draws do not fit`, () => {
    // A cube in a slot between two boxes as wide as itself can move only along it: every draw with a dy is thrown away.
    const boxedIn = edited((json) => {
      json.variants.objectColors = undefined;
      json.variants.objectJitter = [{ objects: ['cube'], dxCm: 0, dyCm: 5 }];
      json.arena.boxes = [
        { centerCm: [85, 54], sizeCm: [10, 8, 5] },
        { centerCm: [85, 66], sizeCm: [10, 8, 5] },
      ];
    });
    for (const index of [1, 2]) expect(variantOffsets(boxedIn, index, RADIUS).objects![0]).toEqual(ZERO);
  });

  it('keeps variant 0 the arena itself when its list gives the arena’s colour in another case (review M2)', () => {
    const upper = edited((json) => (json.variants.objectColors.cube = ['#D32F2F', '#388e3c', '#1976d2']));
    const { arena } = applyVariant(upper, variantOffsets(upper, 0, RADIUS));
    expect(arena).toBe(upper.arena);
    expect(arena.objects[0]!.color).toBe('#d32f2f');
    expect(applyVariant(upper, variantOffsets(upper, 1, RADIUS)).arena.objects[0]!.color).toBe('#388e3c');
  });

  it('refuses offsets that are not of the arena: one per object when it has any', () => {
    const offsets = variantOffsets(scenario, 1, RADIUS);
    expect(() => applyVariant(scenario, { ...offsets, objects: offsets.objects!.slice(1) })).toThrow(RangeError);
    expect(() => variantObjectColors(scenario, 3)).toThrow('The scenario has 3 variants (0..2), not variant 3.');
  });
});
