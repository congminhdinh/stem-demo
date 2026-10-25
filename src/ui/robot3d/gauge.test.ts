import { describe, expect, it } from 'vitest';
import { arcPath, needleAngle, polar } from './gauge';

// N18 R4.5: the arithmetic of the half-circle dials of the "Cổng & chân" tab (the drive motors, the servo). Angles are the page's:
// 0° is the right end, 90° the top, 180° the left end.

describe('polar', () => {
  it('puts a point on the circle: 180° is the left end, 90° the top, 0° the right end', () => {
    expect(polar(50, 50, 40, 180)).toEqual([10, 50]);
    expect(polar(50, 50, 40, 90)).toEqual([50, 10]);
    expect(polar(50, 50, 40, 0)).toEqual([90, 50]);
  });

  it('rounds to a hundredth, so the path text is the same on every engine, and never writes −0', () => {
    expect(polar(50, 50, 40, 45)).toEqual([78.28, 21.72]);
    expect(Object.is(polar(0, 0, 10, 180)[1], 0)).toBe(true);
  });
});

describe('needleAngle', () => {
  it('maps the range of the dial onto the half circle, minimum at the left', () => {
    expect(needleAngle(-100, -100, 100)).toBe(180);
    expect(needleAngle(0, -100, 100)).toBe(90);
    expect(needleAngle(100, -100, 100)).toBe(0);
    expect(needleAngle(50, -100, 100)).toBe(45);
    expect(needleAngle(0, 0, 180)).toBe(180);
    expect(needleAngle(90, 0, 180)).toBe(90);
    expect(needleAngle(180, 0, 180)).toBe(0);
  });

  it('stops at the ends of the dial for a value beyond them', () => {
    expect(needleAngle(250, -100, 100)).toBe(0);
    expect(needleAngle(-250, -100, 100)).toBe(180);
  });
});

describe('arcPath', () => {
  it('draws the arc over the top from one angle to another, clockwise on the page when the angle falls', () => {
    expect(arcPath(50, 50, 40, 180, 0)).toBe('M 10 50 A 40 40 0 0 1 90 50');
    expect(arcPath(50, 50, 40, 90, 45)).toBe('M 50 10 A 40 40 0 0 1 78.28 21.72');
    expect(arcPath(50, 50, 40, 90, 135)).toBe('M 50 10 A 40 40 0 0 0 21.72 21.72');
  });

  it('draws nothing for an arc of no length', () => {
    expect(arcPath(50, 50, 40, 90, 90)).toBe('');
  });
});
