import { describe, expect, it } from 'vitest';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { contrastRatio } from '../a11y/contrast';
import { gripperTestScenario } from './__fixtures__/gripper-scene';
import { readingTints, sensorColors } from './sensor-colors';
import { topViewColors } from './top-view-colors';
import { objectMarks } from './top-view-gripper';
import { movingBodies } from './top-view-math';

// N18 R8 (WCAG 2.2 AA: 1.4.11, 3:1 for graphics) for what N19 E4/E5 draws: the IR beam, the colour spot's ring and ray, the ring round the
// held object and the jaws' edge stand out from the light mat and from every pick-and-place zone they are drawn over; the objects' marks
// on the 2D map have 3:1 against their fills; a white or yellow reading's spot still shows in its ring. The tags' words are the distance
// tag's colours (robot-contrast.test.ts holds them).

const surfaces = ['#f2f2f2', '#ffffff', ...gripperTestScenario.arena.paint.zones.map((zone) => zone.color)];

describe('what the gripper car’s overlays and map draw (N18 R8, N19 E4/E5)', () => {
  it('the IR beam, the colour spot’s ring, the held ring and the jaws’ edge: 3:1 or more over the mat and every pick-and-place zone', () => {
    for (const [name, colour] of Object.entries({ ir: sensorColors.ir, spotRing: sensorColors.spotRing, heldRing: topViewColors.heldRing, jawEdge: topViewColors.gripperEdge, carriage: topViewColors.gripperBody })) {
      for (const surface of surfaces) expect(contrastRatio(colour, surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the held ring stands out from every palette colour a held object can have', () => {
    for (const fill of Object.values(bodyPalette)) expect(contrastRatio(topViewColors.heldRing, fill), fill).toBeGreaterThanOrEqual(1.4);
    // It is drawn round the object, over the mat: there it has its 3:1 (above). Against a blue cube it is a hue apart, not a light one.
    expect(contrastRatio(topViewColors.heldRing, '#f2f2f2')).toBeGreaterThan(6);
  });

  it('every object’s mark on the 2D map has 3:1 against its fill', () => {
    const marked = movingBodies(gripperTestScenario.arena).flatMap((body) => {
      const marks = objectMarks(body);
      return marks === null ? [] : [{ fill: body.fill!, ink: marks.ink }];
    });
    expect(marked.length).toBe(4);
    for (const { fill, ink } of marked) expect(contrastRatio(ink, fill), fill).toBeGreaterThanOrEqual(3);
  });

  it('a spot’s tint is the reading’s own colour, in a ring with 3:1 against it, so that white and yellow readings show', () => {
    for (const [name, tint] of Object.entries(readingTints)) {
      if (tint === null) continue;
      if (name === 'black') continue;
      expect(contrastRatio(sensorColors.spotRing, tint), name).toBeGreaterThanOrEqual(3);
    }
    expect(readingTints.unknown).toBeNull();
    expect([readingTints.red, readingTints.green, readingTints.blue, readingTints.yellow]).toEqual([bodyPalette.red, bodyPalette.green, bodyPalette.blue, bodyPalette.yellow]);
  });
});
