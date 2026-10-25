import { describe, expect, it } from 'vitest';
import { boardShareAfterKey, boardShareAt, circuitShares, clampBoardShare, defaultBoardShare, maxBoardShare, minBoardShare, type BoardShares } from './lab-layout';

// N18 R4.2: the robot lab shares the frame the same way, with its own shares: the 3D view is the wider part (about 60 % at launch).

const robot: BoardShares = { initial: 60, min: 35, max: 75 };

describe('the lab layout with other shares (N18 R4.2)', () => {
  it('keeps the circuit’s shares as the default', () => {
    expect(circuitShares).toEqual({ initial: defaultBoardShare, min: minBoardShare, max: maxBoardShare });
  });

  it('clamps, follows the pointer and moves on keys within the shares it is given', () => {
    expect(clampBoardShare(20, robot)).toBe(35);
    expect(clampBoardShare(90, robot)).toBe(75);
    expect(boardShareAt(700, 100, 1000, robot)).toBe(60);
    expect(boardShareAt(500, 100, 0, robot)).toBe(60);
    expect(boardShareAfterKey(60, 'ArrowRight', robot)).toBe(65);
    expect(boardShareAfterKey(37, 'ArrowLeft', robot)).toBe(35);
    expect(boardShareAfterKey(60, 'Home', robot)).toBe(35);
    expect(boardShareAfterKey(60, 'End', robot)).toBe(75);
  });
});
