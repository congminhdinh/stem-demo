import { describe, expect, it } from 'vitest';
import { noBoardInputs, withBoardInput } from './board-inputs';

// N17 B2: what the UI keeps of the inputs it gave a run, to draw them. A shake is counted, never kept as the part's input.

describe('withBoardInput', () => {
  it('keeps the latest input of each part', () => {
    let state = withBoardInput(noBoardInputs, 'b/temperature', { kind: 'slider', value: 30 });
    state = withBoardInput(state, 'b/temperature', { kind: 'slider', value: 31 });
    state = withBoardInput(state, 'b/accelerometer', { kind: 'tilt', x: -700, y: 0 });
    expect(state).toEqual({
      inputs: { 'b/temperature': { kind: 'slider', value: 31 }, 'b/accelerometer': { kind: 'tilt', x: -700, y: 0 } },
      events: {},
    });
  });

  it('counts a shake as an event of the part, and leaves its tilt as it was', () => {
    let state = withBoardInput(noBoardInputs, 'b/accelerometer', { kind: 'tilt', x: -700, y: 0 });
    state = withBoardInput(state, 'b/accelerometer', { kind: 'gesture' });
    state = withBoardInput(state, 'b/accelerometer', { kind: 'gesture' });
    expect(state).toEqual({ inputs: { 'b/accelerometer': { kind: 'tilt', x: -700, y: 0 } }, events: { 'b/accelerometer': 2 } });
  });

  it('never changes the state it is given, and keeps an id such as __proto__ as a key', () => {
    const before = withBoardInput(noBoardInputs, '__proto__', { kind: 'gesture' });
    expect(Object.hasOwn(before.events, '__proto__')).toBe(true);
    const after = withBoardInput(before, '__proto__', { kind: 'gesture' });
    expect(before.events['__proto__']).toBe(1);
    expect(after.events['__proto__']).toBe(2);
    expect(noBoardInputs).toEqual({ inputs: {}, events: {} });
  });
});
