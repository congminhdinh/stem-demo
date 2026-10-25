import { describe, expect, it } from 'vitest';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { sightProps } from './sight-props';

// N18 R4.7 fix round 2 (N3): what the chase camera keeps out of in each lesson.

const of = (key: string) => sightProps(scenarioCatalog.get(key)!);

describe('the props the chase camera keeps out of (N18 R4.7)', () => {
  it('has rb-servo-gate’s gate (its box) and its finish gantry’s beam and banner, 25–35 cm up across the arena', () => {
    const [gate, beam] = of('rb-servo-gate');
    expect(gate).toEqual({ centre: [1.43, -0.5], half: [0.03, 0.3], yawRad: 0, bottom: 0, top: 0.12 });
    expect(beam!.centre[0]).toBeCloseTo(1.18, 9);
    expect(beam!.half[1]).toBeCloseTo(0.5 + 0.12, 9);
    expect([beam!.bottom, beam!.top]).toEqual([0.25, 0.35]);
  });

  it('has rb-mini-mission’s two marker blocks, rb-line-follow’s carport roof on its walls, the sandbox’s block and pole', () => {
    expect(of('rb-mini-mission').map(({ top }) => top)).toEqual([0.12, 0.12]);
    const [roof] = of('rb-line-follow');
    expect(roof!.bottom).toBeCloseTo(0.1, 9);
    expect(roof!.half[0]).toBeCloseTo(0.29 + 0.02, 9);
    // The sandbox's garage has no walls round it: a finish gantry over it.
    expect(of('rb-sandbox').map(({ top }) => top)).toEqual([0.1, 0.2, 0.35]);
    expect(of('rb-drive-to-zone').map(({ bottom }) => bottom)).toEqual([0.25]);
  });
});
