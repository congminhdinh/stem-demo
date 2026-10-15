import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../../core/simulation/peripherals/light';
import { controlsOf, sliderValueOf } from './controls-model';

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybcBoard = registry.get('ybc-board');
const profileControls = (id: string) => productionProfiles.get(id)?.controls ?? [];

/** The board definition with its onboard parts replaced. */
const withOnboard = (onboard: { id: string; model: string; label: string }[]) => ({
  ...ybcBoard,
  board: {
    ...ybcBoard.board,
    pins: ybcBoard.board?.pins ?? [],
    onboard: onboard.map((part) => ({ ...part, capability: 'x', at: { x: 0, y: 0, width: 1, height: 1 } })),
  },
});

describe('controlsOf', () => {
  it.each(['ybc-basic', 'ybc-advanced'])('gives Button A, Button B and the light slider for %s, as component ids of the board', (id) => {
    const specs = controlsOf('board-1', ybcBoard, profileControls(id));

    expect(specs).toEqual([
      { kind: 'hold', partId: 'button-a', componentId: 'board-1/button-a', label: 'Button A' },
      { kind: 'hold', partId: 'button-b', componentId: 'board-1/button-b', label: 'Button B' },
      {
        kind: 'slider',
        partId: 'light',
        componentId: 'board-1/light',
        label: 'Light level',
        range: { min: LIGHT_LEVEL_MIN, max: LIGHT_LEVEL_MAX, initial: LIGHT_LEVEL_INITIAL },
      },
    ]);
  });

  it('keeps the component id of a board whose own id has a slash', () => {
    expect(controlsOf('saved/board', ybcBoard, ['button-a'])[0]?.componentId).toBe('saved/board/button-a');
  });

  it('shows only the parts the profile lists', () => {
    expect(controlsOf('b', ybcBoard, ['light']).map((spec) => spec.partId)).toEqual(['light']);
    expect(controlsOf('b', ybcBoard, [])).toEqual([]);
  });

  it('has no control for a part that takes no input (display, buzzer), even when the profile lists it', () => {
    expect(controlsOf('b', ybcBoard, ['display', 'buzzer'])).toEqual([]);
  });

  it('has no control for a board without onboard parts', () => {
    expect(controlsOf('b', registry.get('board'), ['button-a'])).toEqual([]);
  });

  it('has no control yet for an input kind with no widget (tilt) or a slider with no known range (temperature)', () => {
    const definition = withOnboard([
      { id: 'accel', model: 'accelerometer', label: 'Accelerometer' },
      { id: 'temp', model: 'temperature-sensor', label: 'Temperature' },
    ]);

    expect(controlsOf('b', definition, ['accel', 'temp'])).toEqual([]);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('does not take the model %s for a model with an input', (model) => {
    const definition = withOnboard([{ id: 'p', model, label: 'P' }]);

    expect(controlsOf('b', definition, ['p'])).toEqual([]);
  });

  it('follows the order of the definition, not the order of the profile', () => {
    expect(controlsOf('b', ybcBoard, ['light', 'button-b', 'button-a']).map((spec) => spec.partId)).toEqual([
      'button-a',
      'button-b',
      'light',
    ]);
  });
});

describe('sliderValueOf', () => {
  const range = { min: LIGHT_LEVEL_MIN, max: LIGHT_LEVEL_MAX, initial: LIGHT_LEVEL_INITIAL };

  it.each([
    ['50', 50],
    ['0', 0],
    ['100', 100],
    ['37.6', 38],
    ['-5', 0],
    ['250', 100],
  ])('reads %s as %d', (raw, expected) => {
    expect(sliderValueOf(raw, range)).toBe(expected);
  });

  it.each(['abc', 'NaN', 'Infinity'])('is null for %s', (raw) => {
    expect(sliderValueOf(raw, range)).toBeNull();
  });
});
