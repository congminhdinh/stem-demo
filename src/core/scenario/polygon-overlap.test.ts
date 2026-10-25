import { describe, expect, it } from 'vitest';
import type { PointCm } from '../world/arena/arena-schema';
import { polygonsOverlap } from './polygon-overlap';

const rect = (x0: number, y0: number, x1: number, y1: number): PointCm[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe('polygonsOverlap', () => {
  describe('polygons whose insides share an area', () => {
    it('overlap when they cross each other', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true);
    });

    it('overlap when one is inside the other, with no edge crossing', () => {
      expect(polygonsOverlap(rect(0, 0, 40, 40), rect(10, 10, 20, 20))).toBe(true);
      expect(polygonsOverlap(rect(10, 10, 20, 20), rect(0, 0, 40, 40))).toBe(true);
    });

    it('overlap when they are the same polygon, however it is wound or where it starts', () => {
      const square = rect(0, 0, 10, 10);
      expect(polygonsOverlap(square, rect(0, 0, 10, 10))).toBe(true);
      expect(polygonsOverlap(square, [...square].reverse())).toBe(true);
      expect(polygonsOverlap(square, [square[2]!, square[3]!, square[0]!, square[1]!])).toBe(true);
    });

    it('overlap when one is a part of the other that shares an edge with it', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(0, 0, 5, 10))).toBe(true);
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(2, 0, 5, 4))).toBe(true);
    });

    it('overlap when they cross like a plus sign, so that no corner of either is inside the other', () => {
      expect(polygonsOverlap(rect(0, 10, 30, 20), rect(10, 0, 20, 30))).toBe(true);
    });

    it('overlap when only a thin sliver of them is shared', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(9.99, 0, 20, 10))).toBe(true);
    });

    it('overlap when they are turned: triangles that cross', () => {
      expect(polygonsOverlap([[0, 0], [20, 0], [10, 20]], [[0, 15], [20, 15], [10, -5]])).toBe(true);
    });

    it('overlap when they share an area only in a part of the stretch between two corners, where the edges cross', () => {
      // the triangle is under y = x; the rectangle is above y = 15: they meet only where x > 15, and nothing happens at x = 10, the middle
      expect(polygonsOverlap([[0, 0], [20, 0], [20, 20]], rect(0, 15, 20, 30))).toBe(true);
      expect(polygonsOverlap(rect(0, 15, 20, 30), [[0, 0], [20, 0], [20, 20]])).toBe(true);
    });

    it('overlap when the part they share is in the second stretch of one of them, an arm of a C', () => {
      const c: PointCm[] = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 20], [30, 20], [30, 30], [0, 30]]; // opens to the right: notch x 10..30, y 10..20
      expect(polygonsOverlap(c, rect(15, 22, 25, 28))).toBe(true); // the upper arm
      expect(polygonsOverlap(rect(15, 22, 25, 28), c)).toBe(true);
      expect(polygonsOverlap(c, rect(15, 2, 25, 8))).toBe(true); // the lower arm
    });

    it('overlap when the shared part is a corner of one that pokes into a notch of the other', () => {
      const u: PointCm[] = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]]; // a U with the notch x 10..20, y 10..30
      expect(polygonsOverlap(u, rect(15, 5, 25, 15))).toBe(true); // reaches down into the base of the U and into its right arm
    });
  });

  describe('polygons that have no area in common', () => {
    it('do not overlap when they are apart', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false);
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(20, 0, 30, 10))).toBe(false);
    });

    it('do not overlap when they only share an edge, as tiles of a floor do', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false);
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(0, 10, 10, 20))).toBe(false);
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 3, 20, 7))).toBe(false); // a part of an edge
      expect(polygonsOverlap(rect(10, 3, 20, 7), rect(0, 0, 10, 10))).toBe(false);
    });

    it('do not overlap when they only share a corner', () => {
      expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 10, 20, 20))).toBe(false);
    });

    it('do not overlap when one stands in the notch of the other', () => {
      const u: PointCm[] = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
      expect(polygonsOverlap(u, rect(10, 10, 20, 30))).toBe(false); // fills the notch exactly
      expect(polygonsOverlap(u, rect(11, 12, 19, 28))).toBe(false); // floats in it
    });

    it('do not overlap when triangles meet along a slanted edge', () => {
      expect(polygonsOverlap([[0, 0], [10, 0], [0, 10]], [[10, 0], [10, 10], [0, 10]])).toBe(false);
    });

    it('do not overlap when one stands in the opening of a C, between its arms', () => {
      const c: PointCm[] = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 20], [30, 20], [30, 30], [0, 30]];
      expect(polygonsOverlap(c, rect(15, 12, 25, 18))).toBe(false);
      expect(polygonsOverlap(rect(15, 12, 25, 18), c)).toBe(false);
      expect(polygonsOverlap(c, rect(10, 10, 30, 20))).toBe(false); // fills the opening exactly
    });

    // The two polygons are on either side of the line from (0, 0) to (10, 7), which one writes as a single edge and the other splits at a
    // point on it. Interpolating along the two gives y that differ in the last digits, so the stretches seem to overlap by 1e-16.
    it.each([[3, 2.1], [1, 0.7], [2.3, 1.61], [4.1, 2.87], [6.7, 4.69]] as const)('do not overlap when the slanted edge they share is split at (%f, %f) in one of them', (x, y) => {
      const above: PointCm[] = [[0, 0], [10, 7], [0, 7]];
      const below: PointCm[] = [[0, 0], [x, y], [10, 7], [10, 0]];
      expect(polygonsOverlap(above, below)).toBe(false);
      expect(polygonsOverlap(below, above)).toBe(false);
    });

    it('do not overlap when the edge they share is wound the other way', () => {
      expect(polygonsOverlap([[0, 0], [7, 0], [3, 9], [0, 9]], [[3, 9], [7, 0], [20, 0], [20, 9]])).toBe(false);
    });
  });

  it('gives the same answer whichever polygon is asked first', () => {
    const shapes: PointCm[][] = [rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(10, 0, 20, 10), rect(30, 30, 40, 40), [[0, 0], [20, 0], [10, 20]]];
    for (const a of shapes) for (const b of shapes) expect(polygonsOverlap(a, b)).toBe(polygonsOverlap(b, a));
  });
});
