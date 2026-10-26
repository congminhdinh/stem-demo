import { describe, expect, it } from 'vitest';
import { productionKits } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import { robotFootprint } from '../world/robot/footprint';
import { parseArena } from '../world/arena/arena-schema';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { applyVariant, kitFootprintRadiusCm, ROBOT_FOOTPRINT_RADIUS_CM, variantOffsets, type VariantSource } from './variants';

// N19 A1 (plan D-G8): the floor the variants keep clear around a start is the kit's (`chassis.footprintRadiusCm`), the 11 cm of the rover
// when the kit does not say. The gripper car reaches farther than the rover, so its radius is data of its kit; the rover's draws are
// the ones they always were.

const rover = productionKits.refs().map((ref) => productionKits.get(ref) as Kit)[0] as Kit;
const withRadius = (kit: Kit, footprintRadiusCm: number): Kit => ({ ...kit, chassis: { ...kit.chassis!, footprintRadiusCm } });

describe('kitFootprintRadiusCm', () => {
  it('is 11 cm for the rover, which says nothing of it', () => {
    expect(rover.id).toBe('ref-uno-rover');
    expect(rover.chassis).not.toHaveProperty('footprintRadiusCm');
    expect(kitFootprintRadiusCm(rover)).toBe(11);
    expect(kitFootprintRadiusCm(rover)).toBe(ROBOT_FOOTPRINT_RADIUS_CM);
  });

  it('is the kit’s own number when it gives one: 16 for a fixture kit that does', () => {
    expect(kitFootprintRadiusCm(withRadius(rover, 16))).toBe(16);
    expect(kitFootprintRadiusCm(withRadius(rover, 9.5))).toBe(9.5);
  });

  it('is 11 cm for a kit without a chassis', () => {
    const bare: Kit = { id: rover.id, version: rover.version, board: rover.board, ports: rover.ports, modules: rover.modules };
    expect(bare.chassis).toBeUndefined();
    expect(kitFootprintRadiusCm(bare)).toBe(11);
  });

  it('covers how far the kit reaches from the point of its pose, for every kit of the catalog (servo arm and, later, gripper included)', () => {
    for (const ref of productionKits.refs()) {
      const kit = productionKits.get(ref) as Kit;
      expect(robotFootprint(kit).radiusCm, `${ref.id}@${ref.version}`).toBeLessThanOrEqual(kitFootprintRadiusCm(kit));
    }
  });
});

describe('variantOffsets with the radius of a kit', () => {
  /** A start 20 cm from the west and south walls (2 cm thick) that jitters 12 cm: radius 11 needs x, y ≥ 13, radius 16 needs x, y ≥ 18. */
  const near: VariantSource = {
    arena: parseArena({
      ground: { sizeCm: [100, 100], color: '#ffffff' },
      walls: [
        { fromCm: [0, 1], toCm: [100, 1] },
        { fromCm: [1, 0], toCm: [1, 100] },
      ],
    }),
    start: { xCm: 20, yCm: 20, yawDeg: 0 },
    variants: { count: 40, seed: 7, startJitterCm: 12, yawJitterDeg: 0 },
  };
  const starts = (radiusCm?: number) =>
    Array.from({ length: near.variants.count - 1 }, (_, i) => applyVariant(near, radiusCm === undefined ? variantOffsets(near, i + 1) : variantOffsets(near, i + 1, radiusCm)).start);

  it('defaults to the 11 cm of the rover: the same offsets as asking for 11, in every variant', () => {
    for (let i = 0; i < near.variants.count; i++) {
      expect(variantOffsets(near, i)).toEqual(variantOffsets(near, i, ROBOT_FOOTPRINT_RADIUS_CM));
    }
    for (const { xCm, yCm } of starts()) {
      expect(xCm - 11).toBeGreaterThanOrEqual(2);
      expect(yCm - 11).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps a start 16 cm clear of the walls when the radius is 16, which 11 does not', () => {
    const wide = starts(16);
    for (const { xCm, yCm } of wide) {
      expect(xCm - 16).toBeGreaterThanOrEqual(2);
      expect(yCm - 16).toBeGreaterThanOrEqual(2);
    }
    // The rover's draws put at least one start inside that margin, so it is the radius that moved them.
    expect(starts().some(({ xCm, yCm }) => xCm - 16 < 2 || yCm - 16 < 2)).toBe(true);
    expect(wide).not.toEqual(starts());
  });

  it('draws the same numbers whatever the radius, and moves only what does not fit: variant 0 is exact and the seed is the same', () => {
    for (const radius of [11, 16, 30]) {
      expect(variantOffsets(near, 0, radius)).toEqual(variantOffsets(near, 0));
      expect(variantOffsets(near, 5, radius).seed).toBe(variantOffsets(near, 5).seed);
    }
  });

  it('gives the shipped scenarios the offsets they always had when the radius is the default', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      for (let i = 0; i < scenario.variants.count; i++) {
        expect(variantOffsets(scenario, i), `${scenario.key} variant ${i}`).toEqual(variantOffsets(scenario, i, kitFootprintRadiusCm(rover)));
      }
    }
  });
});
