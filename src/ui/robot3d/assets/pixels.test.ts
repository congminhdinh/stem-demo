import { describe, expect, it } from 'vitest';
import { blobPixels, fbmField, heightToNormal, type Pixels } from './pixels';

// N18 R4.7: the 3D view's run-time textures (the mat's fibres, the contact shadow), made from code: plain RGBA pixels, the same for the
// same seed, and tileable where they repeat across the mat.

const at = (pixels: Pixels, x: number, y: number) => Array.from(pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4));

describe('procedural pixels (N18 R4.7)', () => {
  it('a noise field is the same for the same seed, between 0 and 1, and wraps around both edges', () => {
    const a = fbmField(64, 32, { seed: 7, cells: 4, octaves: 3 });
    const b = fbmField(64, 32, { seed: 7, cells: 4, octaves: 3 });
    const c = fbmField(64, 32, { seed: 8, cells: 4, octaves: 3 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    // Across the seam (last column → first, last row → first) the field changes no more than between two neighbours inside it.
    let inside = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 63; x++) inside = Math.max(inside, Math.abs(a[y * 64 + x + 1]! - a[y * 64 + x]!));
    for (let y = 0; y < 32; y++) expect(Math.abs(a[y * 64]! - a[y * 64 + 63]!)).toBeLessThanOrEqual(inside + 1e-6);
    for (let x = 0; x < 64; x++) expect(Math.abs(a[x]! - a[31 * 64 + x]!)).toBeLessThanOrEqual(inside * 2 + 1e-6);
  });

  it('a flat height field is a flat normal map, a slope tilts it towards the low side', () => {
    const flat = heightToNormal(new Float32Array(16).fill(0.5), 4, 4, 1);
    expect(at(flat, 1, 1)).toEqual([128, 128, 255, 255]);
    // Height growing with x: the normal leans to −x (red under 128).
    const slope = new Float32Array(16).map((_, i) => (i % 4) / 4);
    expect(at(heightToNormal(slope, 4, 4, 1), 1, 1)[0]).toBeLessThan(128);
  });

  it('a contact-shadow blob is dark in the middle and clear at its edge', () => {
    const blob = blobPixels(32);
    expect(blob.width).toBe(32);
    expect(at(blob, 16, 16)[3]).toBeGreaterThan(200);
    expect(at(blob, 0, 0)[3]).toBe(0);
    expect(at(blob, 31, 16)[3]).toBeLessThan(10);
  });


});
