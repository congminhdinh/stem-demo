import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { accelerationOf, gestureOf } from '../../core/simulation/peripherals/accelerometer';
import { LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../../core/simulation/peripherals/light';
import {
  controlsOf, flatTilt, padPointOfTilt, sliderValueOf, TILT_KEY_STEP_MG, tiltAfterKey, tiltInputOf, tiltOfPadPoint, tiltStateOf,
} from './controls-model';

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
  it('gives Button A, Button B and the light slider for ybc-basic, as component ids of the board', () => {
    const specs = controlsOf('board-1', ybcBoard, profileControls('ybc-basic'));

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

  it('gives ybc-advanced the temperature slider (−10..50 °C, from 25) and the tilt pad of the accelerometer too (N17 B2)', () => {
    const specs = controlsOf('board-1', ybcBoard, profileControls('ybc-advanced'));
    expect(specs.map((spec) => spec.partId)).toEqual(['button-a', 'button-b', 'light', 'temperature', 'accelerometer']);
    expect(specs[3]).toEqual({
      kind: 'slider',
      partId: 'temperature',
      componentId: 'board-1/temperature',
      label: 'Temp level',
      range: { min: -10, max: 50, initial: 25, unit: '°C' },
    });
    expect(specs[4]).toEqual({ kind: 'tilt', partId: 'accelerometer', componentId: 'board-1/accelerometer', label: 'Accel' });
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

  it('has a control for the accelerometer (tilt) and the temperature (slider) of any board that has them (N17 B2)', () => {
    const definition = withOnboard([
      { id: 'accel', model: 'accelerometer', label: 'Accelerometer' },
      { id: 'temp', model: 'temperature-sensor', label: 'Temperature' },
    ]);

    expect(controlsOf('b', definition, ['accel', 'temp']).map((spec) => [spec.partId, spec.kind])).toEqual([['accel', 'tilt'], ['temp', 'slider']]);
  });

  it('has no control yet for a slider with no known range', () => {
    const definition = withOnboard([{ id: 'knob', model: 'analog-source', label: 'Knob' }]);

    expect(controlsOf('b', definition, ['knob'])).toEqual([]);
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

describe('the tilt pad (N17 B2)', () => {
  it('lies flat, face up, until it is touched: the run reads (0, 0, −1024), face up', () => {
    expect(flatTilt).toEqual({ x: 0, y: 0, faceDown: false });
    expect(tiltInputOf(flatTilt)).toEqual({ kind: 'tilt', x: 0, y: 0 });
    expect(accelerationOf(tiltInputOf(flatTilt))).toEqual({ x: 0, y: 0, z: -1024 });
  });

  it('maps a point of the pad to ±1024 mg: right is x, up is y (the logo edge going down), in steps of 32 mg', () => {
    expect(tiltOfPadPoint(0, 0, false)).toEqual({ x: 0, y: 0, faceDown: false });
    expect(tiltOfPadPoint(-1, 0, false)).toEqual({ x: -1024, y: 0, faceDown: false });
    expect(tiltOfPadPoint(1, -1, false)).toEqual({ x: 1024, y: 1024, faceDown: false });
    expect(tiltOfPadPoint(0, 0.5, true)).toEqual({ x: 0, y: -512, faceDown: true });
    expect(tiltOfPadPoint(0.01, -0.01, false)).toEqual({ x: 0, y: 0, faceDown: false });
    expect(tiltOfPadPoint(-3, 7, false)).toEqual({ x: -1024, y: -1024, faceDown: false });
    expect(Object.is(tiltOfPadPoint(-0.001, 0.001, false).x, 0)).toBe(true);
  });

  it('draws the dot where the point was: the two maps are each other’s inverse on the pad', () => {
    for (const [right, down] of [[0, 0], [-1, 0], [1, -1], [0.5, 0.25], [-0.75, 1]] as const) {
      expect(padPointOfTilt(tiltOfPadPoint(right, down, false))).toEqual({ right, down });
    }
  });

  it('gives the gesture of the place on the pad: left, right, logo up (dot down), logo down (dot up), and face down when turned over', () => {
    const gesture = (right: number, down: number, faceDown = false) => gestureOf(accelerationOf(tiltInputOf(tiltOfPadPoint(right, down, faceDown))));
    expect(gesture(0, 0)).toBe('face_up');
    expect(gesture(-0.6, 0)).toBe('tilt_left');
    expect(gesture(0.6, 0)).toBe('tilt_right');
    expect(gesture(0, 0.6)).toBe('logo_up');
    expect(gesture(0, -0.6)).toBe('logo_down');
    expect(gesture(0, 0, true)).toBe('face_down');
    // Just inside the threshold of 400 mg (0.375 of the half width is 384 mg) is no tilt.
    expect(gesture(-0.375, 0)).toBe('face_up');
  });

  it('moves the dot 128 mg with an arrow key, stops at the edge, and Home lays the board flat; other keys do nothing', () => {
    expect(TILT_KEY_STEP_MG).toBe(128);
    expect(tiltAfterKey(flatTilt, 'ArrowLeft')).toEqual({ x: -128, y: 0, faceDown: false });
    expect(tiltAfterKey(flatTilt, 'ArrowRight')).toEqual({ x: 128, y: 0, faceDown: false });
    expect(tiltAfterKey(flatTilt, 'ArrowUp')).toEqual({ x: 0, y: 128, faceDown: false });
    expect(tiltAfterKey(flatTilt, 'ArrowDown')).toEqual({ x: 0, y: -128, faceDown: false });
    expect(tiltAfterKey({ x: 1000, y: -1000, faceDown: true }, 'ArrowRight')).toEqual({ x: 1024, y: -1000, faceDown: true });
    expect(tiltAfterKey({ x: 1000, y: -1000, faceDown: true }, 'ArrowDown')).toEqual({ x: 1000, y: -1024, faceDown: true });
    expect(tiltAfterKey({ x: 512, y: 256, faceDown: true }, 'Home')).toEqual({ x: 0, y: 0, faceDown: true });
    for (const key of ['Enter', ' ', 'a', 'Escape', 'Tab']) {
      expect(tiltAfterKey(flatTilt, key), key).toBeNull();
    }
  });

  it('sends z only face down: the weight on the other side, so the run reads face down', () => {
    expect(tiltInputOf({ x: 0, y: 0, faceDown: true })).toEqual({ kind: 'tilt', x: 0, y: 0, z: 1024 });
    expect(tiltInputOf({ x: 512, y: 0, faceDown: true })).toEqual({ kind: 'tilt', x: 512, y: 0, z: 887 });
    expect(tiltInputOf({ x: 1024, y: 1024, faceDown: true })).toEqual({ kind: 'tilt', x: 1024, y: 1024, z: 0 });
  });

  it('shows the tilt a check gives (and flat for anything else)', () => {
    expect(tiltStateOf({ kind: 'tilt', x: -800, y: 0 })).toEqual({ x: -800, y: 0, faceDown: false });
    expect(tiltStateOf({ kind: 'tilt', x: 0, y: 0, z: 1024 })).toEqual({ x: 0, y: 0, faceDown: true });
    expect(tiltStateOf({ kind: 'tilt', x: 5000, y: -5000 })).toEqual({ x: 1024, y: -1024, faceDown: false });
    expect(tiltStateOf({ kind: 'gesture' })).toEqual(flatTilt);
    expect(tiltStateOf(undefined)).toEqual(flatTilt);
  });
});
