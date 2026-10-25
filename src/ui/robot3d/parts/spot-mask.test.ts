import { describe, expect, it } from 'vitest';
import { SPOT_EXTENT, SPOT_MASK_PX, SPOT_RING_INNER, spotCoverage, spotMaskPixels, spotMaskTexture } from './spot-mask';

// N18 R4.3: a line sensor's spot is cut from a quad by a mask: a ring where it reads bright, a disc where it reads dark.

const at = (shape: 'ring' | 'disc', radius: number) => spotCoverage(shape, SPOT_MASK_PX / 2 + radius * (SPOT_MASK_PX / 2) - 0.5, SPOT_MASK_PX / 2 - 0.5);

describe('the masks of a line sensor’s spot', () => {
  it('a disc is covered from its middle to its edge, and nothing past the edge', () => {
    expect(at('disc', 0)).toBe(1);
    expect(at('disc', SPOT_EXTENT * 0.9)).toBe(1);
    expect(at('disc', SPOT_EXTENT)).toBeCloseTo(0.5, 6);
    expect(at('disc', 1)).toBe(0);
  });

  it('a ring is empty in the middle, covered between its inner and outer edge, and nothing outside', () => {
    expect(at('ring', 0)).toBe(0);
    expect(at('ring', SPOT_EXTENT * SPOT_RING_INNER * 0.8)).toBe(0);
    expect(at('ring', SPOT_EXTENT * (1 + SPOT_RING_INNER) * 0.5)).toBe(1);
    expect(at('ring', SPOT_EXTENT)).toBeCloseTo(0.5, 6);
    expect(at('ring', 1)).toBe(0);
  });

  it('is the same all round: a pixel of a diagonal at the same distance is covered the same', () => {
    const r = 0.7;
    const diagonal = spotCoverage('ring', SPOT_MASK_PX / 2 + (r * (SPOT_MASK_PX / 2)) / Math.SQRT2 - 0.5, SPOT_MASK_PX / 2 + (r * (SPOT_MASK_PX / 2)) / Math.SQRT2 - 0.5);
    expect(diagonal).toBeCloseTo(at('ring', r), 6);
  });

  it('has the coverage in every channel of an RGBA pixel, so that an alpha map reads it from green', () => {
    const pixels = spotMaskPixels('disc');
    expect(pixels).toHaveLength(SPOT_MASK_PX * SPOT_MASK_PX * 4);
    const middle = 4 * (SPOT_MASK_PX * (SPOT_MASK_PX / 2) + SPOT_MASK_PX / 2);
    expect([...pixels.subarray(middle, middle + 4)]).toEqual([255, 255, 255, 255]);
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('makes a smoothly filtered texture of the mask’s size', () => {
    const texture = spotMaskTexture('ring');
    expect(texture.image.width).toBe(SPOT_MASK_PX);
    expect(texture.generateMipmaps).toBe(true);
    texture.dispose();
  });
});
