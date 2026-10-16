import { describe, expect, it } from 'vitest';
import { boardShareAfterKey, boardShareAt, clampBoardShare, defaultBoardShare, maxBoardShare, minBoardShare, stackedQuery } from './lab-layout';

describe('the lab layout (N8s)', () => {
  it('gives the program the larger part at launch', () => {
    expect(defaultBoardShare).toBeLessThan(50);
  });

  it('keeps the circuit between its smallest and largest share, in whole percent', () => {
    expect(clampBoardShare(5)).toBe(minBoardShare);
    expect(clampBoardShare(90)).toBe(maxBoardShare);
    expect(clampBoardShare(41.6)).toBe(42);
  });

  it('follows the pointer across the workspace', () => {
    expect(boardShareAt(500, 100, 1000)).toBe(40);
    expect(boardShareAt(100, 100, 1000)).toBe(minBoardShare);
    expect(boardShareAt(1100, 100, 1000)).toBe(maxBoardShare);
    expect(boardShareAt(500, 100, 0)).toBe(defaultBoardShare);
  });

  it.each([
    ['ArrowLeft', 38, 33],
    ['ArrowRight', 38, 43],
    ['ArrowLeft', 22, minBoardShare],
    ['ArrowRight', 63, maxBoardShare],
    ['Home', 50, minBoardShare],
    ['End', 30, maxBoardShare],
  ])('moves the separator on %s from %i to %i', (key, from, to) => {
    expect(boardShareAfterKey(from, key)).toBe(to);
  });

  it('leaves other keys to the page', () => {
    expect(boardShareAfterKey(38, 'Enter')).toBeNull();
  });

  it('stacks the panels below 800 px', () => {
    expect(stackedQuery).toBe('(max-width: 799px)');
  });
});
