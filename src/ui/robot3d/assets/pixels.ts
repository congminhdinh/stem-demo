// The 3D view's small run-time textures (N18 R4.7), made from code: the mat's paper fibres and the soft contact shadow (the modelled
// parts bring their own textures, drawn by the Blender scripts of assets-src/robot3d/). Each returns plain RGBA pixels (a linear normal
// map or grey values); textures.ts turns them into three.js textures. Noise is a seeded, periodic value noise, so a texture that
// repeats across the mat has no seam. Pure functions: the same arguments give the same pixels.

export type Pixels = { width: number; height: number; data: Uint8Array };

/** mulberry32: a small seeded generator of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export type NoiseOptions = { seed: number; cells: number; octaves?: number; gain?: number; cellsY?: number };

/**
 * A tileable fractal value noise of `width` × `height`, values in [0, 1]: `cells` lattice cells across (and `cellsY` down, by default
 * in proportion), each octave twice as fine and `gain` as strong as the one before. The lattice of each octave wraps, so the field does.
 */
export function fbmField(width: number, height: number, { seed, cells, octaves = 4, gain = 0.5, cellsY }: NoiseOptions): Float32Array {
  const random = seededRandom(seed);
  const field = new Float32Array(width * height);
  let amplitude = 1;
  let total = 0;
  const baseY = cellsY ?? Math.max(1, Math.round((cells * height) / width));
  for (let octave = 0; octave < octaves; octave++) {
    const cx = cells << octave;
    const cy = baseY << octave;
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    for (let y = 0; y < height; y++) {
      const fy = (y / height) * cy;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % cy) * cx;
      const r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < width; x++) {
        const fx = (x / width) * cx;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % cx;
        const c1 = (x0 + 1) % cx;
        const top = mix(lattice[r0 + c0]!, lattice[r0 + c1]!, tx);
        const bottom = mix(lattice[r1 + c0]!, lattice[r1 + c1]!, tx);
        field[y * width + x]! += mix(top, bottom, ty) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= gain;
  }
  for (let i = 0; i < field.length; i++) field[i] = field[i]! / total;
  return field;
}

function pixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function put(target: Pixels, i: number, r: number, g: number, b: number, a = 255): void {
  const o = i * 4;
  target.data[o] = r;
  target.data[o + 1] = g;
  target.data[o + 2] = b;
  target.data[o + 3] = a;
}

/** A tangent-space normal map (OpenGL convention, +Y up the texture) from a height field in [0, 1], wrapping at the edges. */
export function heightToNormal(height: Float32Array, width: number, rows: number, strength: number): Pixels {
  const out = pixels(width, rows);
  const h = (x: number, y: number) => height[((y + rows) % rows) * width + ((x + width) % width)]!;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      // Rows run down the image, the texture's v up: a height growing down the rows is a slope towards −v.
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      put(out, y * width + x, Math.round(((-dx / length) * 0.5 + 0.5) * 255), Math.round(((-dy / length) * 0.5 + 0.5) * 255), Math.round(((1 / length) * 0.5 + 0.5) * 255));
    }
  }
  return out;
}

/** A grey value map (roughness, AO) from a field in [0, 1], remapped to [lo, hi]. */
export function greyPixels(field: Float32Array, width: number, height: number, lo: number, hi: number): Pixels {
  const out = pixels(width, height);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round(mix(lo, hi, field[i]!) * 255);
    put(out, i, v, v, v);
  }
  return out;
}

/** A soft round contact shadow: highest in the middle, zero at the edge of the square, in every channel (an alphaMap reads green). */
export function blobPixels(size: number): Pixels {
  const out = pixels(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = r >= 1 ? 0 : (1 - smooth(r)) ** 1.5;
      const v = Math.round(a * 255);
      put(out, y * size + x, v, v, v, v);
    }
  }
  return out;
}

