import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from 'three';

// The masks of a line sensor's spot on the mat (N18 R4.3, sensor-overlay.ts): a ring where the sensor reads bright, a disc where it reads
// dark. Each is one quad per eye, coloured by its material and cut to shape by an alpha map (read from the green channel), so that a spot
// is one draw call whatever it looks like, and the mesh shares the program the contact shadows are drawn with. The shape is worked out
// here, on the CPU, once (no canvas: it runs in a Node test too); the quad is 2 × 2 and the shape fills `SPOT_EXTENT` of its half.

/** The side of a mask, px. */
export const SPOT_MASK_PX = 64;
/** How far out the shape reaches, as a share of the quad's half width (the rest is room for the soft edge). */
export const SPOT_EXTENT = 0.9;
/** A ring's inner radius, as a share of its outer one. */
export const SPOT_RING_INNER = 0.58;
/** The width of the soft edge, as a share of the quad's half width. */
const EDGE = 0.07;

export type SpotShape = 'ring' | 'disc';

/** How much of the pixel at (x, y) (centres of a `size` × `size` grid) the shape covers, 0 to 1, with a soft edge. */
export function spotCoverage(shape: SpotShape, x: number, y: number, size = SPOT_MASK_PX): number {
  const half = size / 2;
  const r = Math.hypot((x + 0.5 - half) / half, (y + 0.5 - half) / half);
  const outer = Math.min(1, Math.max(0, (SPOT_EXTENT - r) / EDGE + 0.5));
  if (shape === 'disc') return outer;
  const inner = Math.min(1, Math.max(0, (r - SPOT_EXTENT * SPOT_RING_INNER) / EDGE + 0.5));
  return outer * inner;
}

/** The mask's pixels: RGBA, white, with the coverage in every channel (an alpha map reads green). */
export function spotMaskPixels(shape: SpotShape, size = SPOT_MASK_PX): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.round(255 * spotCoverage(shape, x, y, size));
      pixels.fill(value, 4 * (y * size + x), 4 * (y * size + x) + 4);
    }
  }
  return pixels;
}

/** The mask as a texture, filtered smoothly (a spot is a few pixels across when far, and tens when close). */
export function spotMaskTexture(shape: SpotShape): DataTexture {
  const texture = new DataTexture(spotMaskPixels(shape), SPOT_MASK_PX, SPOT_MASK_PX, RGBAFormat, UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
