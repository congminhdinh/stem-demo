import type { LightIntegral, Rgbc } from './tcs34725-model.ts';

// The scripted light of the G0.2 runs: what the TCS34725 sees in front of an object of each colour, and a timeline of it.
// PLACEHOLDER mapping for the spike only (task B3 makes the world's: a ray, body-colors.ts, distance): the plan's ColorSensorSpec
// (§4.1: white 48/44/36 counts per ms at 1× for R/G/B, ambient 0.2 per ms) times each sRGB component / 255 of the palette colour,
// plus the ambient; the clear channel is R + G + B. Irradiance is in counts per second at 1× (integers), as tcs34725-model.ts takes it.

export const WHITE_PER_S = { r: 48_000, g: 44_000, b: 36_000 } as const;
export const AMBIENT_PER_S = 200;

/** The palette (plan §4.4) and the two neutrals the spike scripts: white, and a black foam cube (#212121). */
export const SPIKE_COLOURS = {
  red: '#d32f2f',
  green: '#388e3c',
  blue: '#1976d2',
  yellow: '#fbc02d',
  white: '#ffffff',
  black: '#212121',
} as const;
export type SpikeLight = keyof typeof SPIKE_COLOURS | 'none';

/** Irradiance per channel (counts per second at 1×) in front of an object of `hex`; ambient only for 'none'. */
export function irradianceOf(light: SpikeLight): Rgbc {
  if (light === 'none') {
    return { c: 3 * AMBIENT_PER_S, r: AMBIENT_PER_S, g: AMBIENT_PER_S, b: AMBIENT_PER_S };
  }
  const hex = SPIKE_COLOURS[light];
  const component = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const channel = (white: number, value: number) => Math.floor((white * value) / 255) + AMBIENT_PER_S;
  const r = channel(WHITE_PER_S.r, component(1));
  const g = channel(WHITE_PER_S.g, component(3));
  const b = channel(WHITE_PER_S.b, component(5));
  return { c: r + g + b, r, g, b };
}

export type LightSegment = { readonly fromUs: number; readonly light: SpikeLight };

/** The integral of a piecewise-constant light timeline (segments in time order, the first from 0 or earlier). */
export function timelineIntegral(segments: readonly LightSegment[]): LightIntegral {
  return (fromUs, toUs) => {
    const sum = { c: 0, r: 0, g: 0, b: 0 };
    for (const [index, segment] of segments.entries()) {
      const end = segments[index + 1]?.fromUs ?? Number.POSITIVE_INFINITY;
      const from = Math.max(fromUs, segment.fromUs);
      const to = Math.min(toUs, end);
      if (to > from) {
        const irradiance = irradianceOf(segment.light);
        // µs are whole at the window edges the model asks for (multiples of 2400 from a whole start); round guards a float edge.
        const span = Math.round(to - from);
        sum.c += irradiance.c * span;
        sum.r += irradiance.r * span;
        sum.g += irradiance.g * span;
        sum.b += irradiance.b * span;
      }
    }
    return sum;
  };
}
