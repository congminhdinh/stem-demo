import { describe, expect, it } from 'vitest';
import pickPlace from '../../core/scenario/__fixtures__/pick-place.scenario.json';
import { loadScenario } from '../../core/scenario/scenario';
import { bodyMarks } from './body-marks';
import { objectColorName } from './check-report';

// N19 E1: the colour of an object as the learner names it in a round ("đỏ" of "khối đỏ"), read from the same place as the check's report
// (variants.ts `variantObjectColors`), so that the HUD's swatch and the words agree. The fixture: a red cube (green in round 2, blue in round 3),
// a yellow base, three parcels with no colour, a can with neither noun nor colour.

const scenario = loadScenario(pickPlace);

describe('objectColorName', () => {
  it('is the colour the object has in that round of the scenario: the cube turns green and blue, the base stays yellow', () => {
    expect([0, 1, 2].map((round) => objectColorName(scenario, 'cube', round))).toEqual(['red', 'green', 'blue']);
    expect([0, 1, 2].map((round) => objectColorName(scenario, 'base', round))).toEqual(['yellow', 'yellow', 'yellow']);
  });

  it('is undefined for an object with no colour of the palette, an unknown object, or no scenario', () => {
    expect(objectColorName(scenario, 'parcel-2', 0)).toBeUndefined();
    expect(objectColorName(scenario, 'can', 0)).toBeUndefined();
    expect(objectColorName(scenario, 'nothing', 0)).toBeUndefined();
    expect(objectColorName(scenario, undefined, 0)).toBeUndefined();
    expect(objectColorName(undefined, 'cube', 0)).toBeUndefined();
  });

  it('takes the arena’s own colour for a round the scenario does not have (a replay index out of range)', () => {
    expect(objectColorName(scenario, 'cube', 7)).toBe('red');
    expect(objectColorName(scenario, 'cube', -1)).toBe('red');
  });
});

describe('bodyMarks: the colour-blind marks of the palette', () => {
  it('red is stripes, green a grid, blue dots, yellow none: the foam cube’s marks (E7)', () => {
    expect(bodyMarks).toEqual({ red: 'stripes', green: 'grid', blue: 'dots', yellow: null });
  });
});
