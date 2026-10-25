import { describe, expect, it } from 'vitest';
import { circleShape, insideGround, rectShape, shapesOverlap, wallShape } from './overlap';

describe('shapesOverlap', () => {
  it('two circles overlap when their centres are closer than the sum of the radii; touching is not overlapping', () => {
    expect(shapesOverlap(circleShape(0, 0, 5), circleShape(9.99, 0, 5))).toBe(true);
    expect(shapesOverlap(circleShape(0, 0, 5), circleShape(10, 0, 5))).toBe(false);
    expect(shapesOverlap(circleShape(0, 0, 5), circleShape(6, 8, 5))).toBe(false); // 10 cm apart, 3-4-5 twice
    expect(shapesOverlap(circleShape(0, 0, 5), circleShape(0, 0, 1))).toBe(true);
  });

  it('a circle and a box: edge, inside, corner (3-4-5)', () => {
    const box = rectShape(0, 0, 5, 5, 0);
    expect(shapesOverlap(circleShape(9, 0, 4), box)).toBe(false); // touches the right edge
    expect(shapesOverlap(circleShape(9, 0, 4.01), box)).toBe(true);
    expect(shapesOverlap(circleShape(0, 0, 0.1), box)).toBe(true); // wholly inside
    expect(shapesOverlap(circleShape(8, 9, 5), box)).toBe(false); // the corner (5, 5) is 5 cm from (8, 9)
    expect(shapesOverlap(circleShape(8, 9, 5.01), box)).toBe(true);
    expect(shapesOverlap(circleShape(-9, 0, 4.01), box)).toBe(true);
  });

  it('a circle and a box turned 45°: the corner reaches 5·√2 = 7.07 cm', () => {
    const diamond = rectShape(0, 0, 5, 5, 45);
    expect(shapesOverlap(circleShape(12, 0, 4.9), diamond)).toBe(false);
    expect(shapesOverlap(circleShape(12, 0, 5), diamond)).toBe(true);
    // The corner of the unturned box is 2.83 cm from (7, 7); the turned one is 4.9 cm away (its side is the line x + y = 7.07).
    expect(shapesOverlap(circleShape(7, 7, 3), rectShape(0, 0, 5, 5, 0))).toBe(true);
    expect(shapesOverlap(circleShape(7, 7, 3), diamond)).toBe(false);
  });

  it('two boxes: apart, touching, overlapping', () => {
    const a = rectShape(0, 0, 5, 5, 0);
    expect(shapesOverlap(a, rectShape(10, 0, 5, 5, 0))).toBe(false);
    expect(shapesOverlap(a, rectShape(9.99, 0, 5, 5, 0))).toBe(true);
    expect(shapesOverlap(a, rectShape(0, 10, 5, 5, 0))).toBe(false);
    expect(shapesOverlap(a, rectShape(2, 2, 1, 1, 0))).toBe(true);
    expect(shapesOverlap(a, rectShape(10, 0, 5, 5, 180))).toBe(false);
  });

  it('a box turned 90° swaps its sides, exactly', () => {
    const tall = rectShape(0, 0, 10, 1, 90); // 2 cm along x, 20 cm along y
    expect(shapesOverlap(tall, rectShape(2, 0, 1, 1, 0))).toBe(false); // touches at x = 1
    expect(shapesOverlap(tall, rectShape(1.99, 0, 1, 1, 0))).toBe(true);
    expect(shapesOverlap(tall, rectShape(0, 11, 1, 1, 0))).toBe(false);
    expect(shapesOverlap(tall, rectShape(0, 10.99, 1, 1, 0))).toBe(true);
  });

  it('two boxes turned 45° and 0°', () => {
    const diamond = rectShape(0, 0, 5, 5, 45);
    expect(shapesOverlap(diamond, rectShape(12.5, 0, 5, 5, 0))).toBe(false); // spans 7.5.., the diamond’s tip is at 7.07
    expect(shapesOverlap(diamond, rectShape(11.5, 0, 5, 5, 0))).toBe(true);
  });

  it('two boxes whose bounding boxes overlap but that do not touch', () => {
    const slanted = rectShape(0, 0, 20, 1, 45); // a thin bar along y = x
    const away = rectShape(10, -10, 2, 2, 0);
    expect(shapesOverlap(slanted, away)).toBe(false);
    expect(shapesOverlap(away, slanted)).toBe(false);
    expect(shapesOverlap(slanted, rectShape(10, 10, 2, 2, 0))).toBe(true);
  });

  it('is symmetric for every pair', () => {
    const shapes = [circleShape(3, 4, 2), rectShape(5, 5, 4, 1, 30), rectShape(-2, 1, 3, 3, 0), circleShape(0, 0, 6)];
    for (const a of shapes) {
      for (const b of shapes) {
        expect(shapesOverlap(a, b)).toBe(shapesOverlap(b, a));
      }
    }
  });
});

describe('wallShape', () => {
  it('is the box along the segment, with square ends that reach half the thickness past both points', () => {
    const wall = wallShape(0, 0, 10, 0, 2); // x -1..11, y -1..1
    expect(shapesOverlap(wall, circleShape(12.5, 0, 1.5))).toBe(false);
    expect(shapesOverlap(wall, circleShape(12.5, 0, 1.51))).toBe(true);
    expect(shapesOverlap(wall, circleShape(5, 2.5, 1.5))).toBe(false);
    expect(shapesOverlap(wall, circleShape(5, 2.5, 1.51))).toBe(true);
    expect(shapesOverlap(wall, circleShape(-2.5, 0, 1.51))).toBe(true);
  });

  it('follows a slanted segment, in either direction', () => {
    // (0, 0) → (10, 10), 2 cm thick: the point (0, 10) is 10/√2 − 1 = 6.07 cm from its side.
    for (const wall of [wallShape(0, 0, 10, 10, 2), wallShape(10, 10, 0, 0, 2)]) {
      expect(shapesOverlap(wall, circleShape(0, 10, 6))).toBe(false);
      expect(shapesOverlap(wall, circleShape(0, 10, 6.1))).toBe(true);
    }
  });
});

describe('insideGround', () => {
  it('holds a circle or a turned box that is wholly on the ground, borders included', () => {
    expect(insideGround(circleShape(10, 10, 10), 100, 50)).toBe(true);
    expect(insideGround(circleShape(9.99, 10, 10), 100, 50)).toBe(false);
    expect(insideGround(circleShape(90, 40, 10), 100, 50)).toBe(true);
    expect(insideGround(circleShape(90, 40.01, 10), 100, 50)).toBe(false);
    expect(insideGround(rectShape(50, 25, 50, 25, 0), 100, 50)).toBe(true);
    expect(insideGround(rectShape(50, 25, 50, 25, 90), 100, 50)).toBe(false); // turned, it is 25 wide and 100 deep
    expect(insideGround(rectShape(50, 25, 5, 5, 45), 100, 50)).toBe(true);
    // Turned 45°, a 10 cm square reaches 5·√2 = 7.07 cm from its centre.
    expect(insideGround(rectShape(7, 25, 5, 5, 45), 100, 50)).toBe(false);
    expect(insideGround(rectShape(7.1, 25, 5, 5, 45), 100, 50)).toBe(true);
  });
});
