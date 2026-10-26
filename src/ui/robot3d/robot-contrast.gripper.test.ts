import { describe, expect, it } from 'vitest';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { contrastRatio } from '../a11y/contrast';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { gripperTestScenario } from './__fixtures__/gripper-scene';
import { robot3dColors } from './colors';
import { readingTints, sensorColors } from './sensor-colors';
import { topViewColors } from './top-view-colors';
import { objectMarks } from './top-view-gripper';
import { movingBodies } from './top-view-math';

// N18 R8 (WCAG 2.2 AA: 1.4.11, 3:1 for graphics) for what N19 E4/E5 draws on the 2D map. Each new ink is drawn over a casing, and the pair
// must read on every fill it can meet (fix round 1, review I1 and M3): the ink has 3:1 against its casing, and on each fill the ink or the
// casing has 3:1 (the edge the eye finds). The fills: the light mat and white ground, every zone of the pick-and-place arena and of the
// lessons' catalogue, the black tape, the palette's cubes and the black foam the sensors are tested with, and the car's own parts under
// the jaws. A white casing does not do for the fuchsia IR beam: on the yellow cube the beam has 2.81:1 and white 1.68:1, so the beam has a
// dark one (and the dark inks, the colour ray, the spot's ring and the held ring's violet, a white one). The objects' marks have 3:1 against
// their fills; a white or yellow reading's spot shows in its ring. The tags' words are the distance tag's colours (robot-contrast.test.ts).

const zoneFills = [...new Set([...gripperTestScenario.arena.paint.zones, ...scenarioCatalog.scenarios.flatMap((scenario) => scenario.arena.paint.zones)].map((zone) => zone.color.toLowerCase()))];
const cubes = [...Object.values(bodyPalette), '#212121'];
// The car's parts a 2D ink can lie on: the carriage (the beams start in it), the boom's and fingers' metal, the chassis (the held ring,
// with the arm raised). Not the fingers' rubber pads: they face each other at |v| 2 cm and more, the beams run at v ±0.6.
const carParts = [topViewColors.gripperBody, topViewColors.gripperMetal, topViewColors.chassis];
const fills = { mat: ['#f2f2f2', '#ffffff'], zones: zoneFills, tape: [robot3dColors.tape], cubes, carParts };

/** The ink and its casing read on `fill`: 3:1 between them, and 3:1 from the ink or the casing to the fill. */
const reads = (ink: string, casing: string, fill: string) => contrastRatio(ink, casing) >= 3 && Math.max(contrastRatio(ink, fill), contrastRatio(casing, fill)) >= 3;

/** Every new 2D ink with its casing, and the fills it can lie on. */
const pairs = {
  irBeam: { ink: sensorColors.ir, casing: sensorColors.irCasing, on: [...fills.mat, ...fills.zones, ...fills.tape, ...fills.cubes, ...fills.carParts] },
  irDot: { ink: sensorColors.ir, casing: sensorColors.irCasing, on: [...fills.mat, ...fills.zones, ...fills.tape, ...fills.cubes] },
  colorRay: { ink: sensorColors.spotRing, casing: sensorColors.lightCasing, on: [...fills.mat, ...fills.zones, ...fills.tape, ...fills.cubes, ...fills.carParts] },
  spotRing: { ink: sensorColors.spotRing, casing: sensorColors.lightCasing, on: [...fills.cubes, ...fills.carParts, ...fills.mat] },
  heldRing: { ink: topViewColors.heldRing, casing: topViewColors.heldRingCasing, on: [...fills.mat, ...fills.zones, ...fills.tape, ...fills.cubes, ...fills.carParts] },
};

describe('what the gripper car’s map draws (N18 R8, N19 E4/E5)', () => {
  it('has the fills it is checked on: the mat, every zone, the tape, five cubes and the car’s parts', () => {
    // The lessons' pastels: light blue, green, yellow and pink.
    expect(zoneFills.length).toBeGreaterThanOrEqual(4);
    expect(cubes).toHaveLength(5);
  });

  it.each(Object.entries(pairs))('%s: its ink and its casing read together on every fill it can meet', (_, { ink, casing, on }) => {
    expect(contrastRatio(ink, casing)).toBeGreaterThanOrEqual(3);
    for (const fill of on) expect(reads(ink, casing, fill), `${ink} over ${casing} on ${fill}: ${contrastRatio(ink, fill).toFixed(2)} / ${contrastRatio(casing, fill).toFixed(2)}`).toBe(true);
  });

  it('needs its casings: the IR ink alone is about 1:1 on the red, green and blue cubes, a white casing too weak on the yellow one; the dark inks vanish on the tape', () => {
    for (const fill of [bodyPalette.red, bodyPalette.green, bodyPalette.blue]) expect(contrastRatio(sensorColors.ir, fill)).toBeLessThan(1.2);
    expect(contrastRatio(sensorColors.ir, bodyPalette.yellow)).toBeLessThan(3);
    expect(contrastRatio('#ffffff', bodyPalette.yellow)).toBeLessThan(3);
    expect(contrastRatio(sensorColors.spotRing, robot3dColors.tape)).toBeLessThan(1.1);
    expect(contrastRatio(topViewColors.heldRing, robot3dColors.tape)).toBeLessThan(3);
  });

  it('the jaws’ edge and the carriage stand out from the mat and every zone (the car’s outline)', () => {
    for (const colour of [topViewColors.gripperEdge, topViewColors.gripperBody]) {
      for (const fill of [...fills.mat, ...fills.zones]) expect(contrastRatio(colour, fill), `${colour} on ${fill}`).toBeGreaterThanOrEqual(3);
    }
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
