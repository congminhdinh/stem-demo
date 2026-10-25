import { describe, expect, it } from 'vitest';
import { ultrasonicRayDirections } from '../src/core/world/sensors/ultrasonic';
import { coneDirections } from '../src/ui/robot3d/__fixtures__/ray-oracle';

// N18 R4.3 fix round 1: the 3D sensor overlay's test oracle (src/ui/robot3d/__fixtures__/ray-oracle.ts) draws the five rays of an
// ultrasonic cone from their definition, in the kit's frame (forward +x, left +y, up +z). The world's own directions (core/world/sensors/
// ultrasonic.ts, which measures them) are in Rapier's frame: forward +X, up +Y, left −Z. This holds the oracle to the world's, ray by ray,
// through the change of frame (arena = (x, −z, y) of Rapier's), for the kit's cone and others: if the world's cone changes (another ray,
// another order), the overlay's tests say so here and not by drawing a different cone from what is measured.

const toArena = ({ x, y, z }: { x: number; y: number; z: number }): [number, number, number] => [x, 0 - z, y];

describe('the overlay’s cone is the world’s cone', () => {
  for (const halfDeg of [0, 5, 15, 30, 60]) {
    it(`${halfDeg}° half angle: the same five rays in the same order, in the arena's frame`, () => {
      const world = ultrasonicRayDirections(halfDeg).map(toArena);
      const oracle = coneDirections(halfDeg);
      expect(oracle).toHaveLength(world.length);
      oracle.forEach((ray, i) => ray.forEach((component, k) => expect(component).toBeCloseTo(world[i]![k]!, 12)));
    });
  }
});
