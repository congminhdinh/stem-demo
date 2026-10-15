import { describe, expect, it } from 'vitest';
import { blankFrame, type Frame, type HexColour } from '../../core/capabilities/frame';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { displayLines, partStateOf, renderedPixels } from './display-view';

const red = '#FF0000';
/** A frame with the given (column, row) cells lit red. */
function frameWith(...lit: [number, number][]): Frame {
  const pixels: (HexColour | null)[] = blankFrame().pixels.map(() => null);
  for (const [x, y] of lit) {
    pixels[y * 5 + x] = red;
  }
  return { pixels };
}

describe('renderedPixels', () => {
  it('is the frame row-major: the pixel at column x, row y is pixels[y * 5 + x]', () => {
    const pixels = renderedPixels({ frame: frameWith([4, 0], [0, 4]) });

    expect(pixels).toHaveLength(25);
    expect(pixels[4]).toBe(red);
    expect(pixels[20]).toBe(red);
    expect(pixels.filter((pixel) => pixel !== null)).toHaveLength(2);
  });

  it('keeps the colour of a lit pixel', () => {
    const frame = frameWith();
    const pixels = [...frame.pixels];
    pixels[12] = '#00FF00';

    expect(renderedPixels({ frame: { pixels } })[12]).toBe('#00FF00');
  });

  it('is a copy: changing it does not change the snapshot', () => {
    const frame = frameWith([0, 0]);

    renderedPixels({ frame }).fill(null);

    expect(frame.pixels[0]).toBe(red);
  });

  it.each([
    ['no state (idle)', undefined],
    ['a state without a frame', {}],
    ['a frame that is not an object', { frame: 'x' }],
    ['a frame with 24 pixels', { frame: { pixels: Array.from({ length: 24 }, () => null) } }],
    ['a frame with 26 pixels', { frame: { pixels: Array.from({ length: 26 }, () => null) } }],
    ['a sparse frame', { frame: { pixels: new Array(25) } }],
    ['a pixel that is not a colour', { frame: { pixels: Array.from({ length: 25 }, (_, i) => (i === 3 ? 'red' : null)) } }],
    ['a lower case colour', { frame: { pixels: Array.from({ length: 25 }, (_, i) => (i === 3 ? '#ff0000' : null)) } }],
  ])('is all cells off for %s', (_label, state) => {
    expect(renderedPixels(state as never)).toEqual(Array.from({ length: 25 }, () => null));
  });
});

describe('displayLines', () => {
  it('is 5 lines of 5 characters, # for a lit cell and . for an off one', () => {
    expect(displayLines({ frame: frameWith([0, 0], [4, 0], [2, 2], [0, 4], [4, 4]) })).toEqual([
      '#...#',
      '.....',
      '..#..',
      '.....',
      '#...#',
    ]);
  });

  it('is all off while idle', () => {
    expect(displayLines(undefined)).toEqual(['.....', '.....', '.....', '.....', '.....']);
  });
});

describe('partStateOf', () => {
  const simulation = (components: SimulationResult['components']): SimulationResult => ({ nets: [], components, pinReads: {} });

  it('reads the state of a part of the board as <board>/<part>', () => {
    const state = { frame: frameWith([1, 1]) };

    expect(partStateOf(simulation({ 'board-1/display': state }), 'board-1', 'display')).toBe(state);
  });

  it('is undefined while idle and for a part that has not reported', () => {
    expect(partStateOf(null, 'board-1', 'display')).toBeUndefined();
    expect(partStateOf(simulation({}), 'board-1', 'display')).toBeUndefined();
  });

  it('does not read the part of another board', () => {
    expect(partStateOf(simulation({ 'other/buzzer': { hz: 262 } }), 'board-1', 'buzzer')).toBeUndefined();
  });

  it('reads own entries only: a state a prototype would supply is not a state of the run', () => {
    const inherited: SimulationResult['components'] = Object.create({ 'board-1/display': { frame: frameWith([1, 1]) } });

    expect(partStateOf(simulation(inherited), 'board-1', 'display')).toBeUndefined();
  });
});
