import type { PaintZone, ZoneKind } from '../../core/world/arena/arena-schema';
import { bodyColorName } from '../../core/world/arena/body-colors';
import { colorReflectance } from '../../core/world/arena/ground-paint';
import { contrastRatio } from '../a11y/contrast';
import { bodyMarks, type BodyMark } from './body-marks';

// The patterns that tell the zones apart for a learner who cannot tell their pastel colours apart (N18 R8): the start is dotted, a target
// is hatched with diagonal lines, an `area` (the schema's generic region: it means nothing to the world, and none of the lessons paints one;
// an author who wants a place to keep out of paints it as an area) is cross-hatched; a checkpoint has its numbered tag (zone-tags.ts), so
// no pattern. N19 E4/E5: a zone the lesson names after a colour has that colour's mark instead (red striped across, green a grid, blue
// large dots), as an object of that colour has on the 2D map (`markPattern`), so that a cube and its zone look alike. The patterns are visual only: the 3D mat's texture (mat-paint.ts), R4.2's fallback floor and the 2D map (ground-paint.ts
// `patterns`) draw them over a zone's fill; the line sensor reads the scenario's vector paint (core/world/arena/ground-paint.ts), never a
// texture, and the printed mat (core/scenario/arena-mat.ts, which does not share this painter) is left as it is.
//
// The ink depends on where the picture is:
//   - 'screen' (the 2D map): drawn only on a screen, never printed, never sensed. Its ink is the zone's own hue, darkened (or lightened,
//     for a dark fill) until it has at least WCAG 1.4.11's 3:1 against the fill, with no floor on its luma (at worst black or white itself,
//     which has 4.58:1 with any fill). So every fill, any author's, has a pattern of 3:1 or more on the map.
//   - 'mat' (the 3D mat and R4.2's floor): it looks like the paper a robot drives on, so nothing on it may look darker than the line
//     sensor's dark threshold: R4.7's rule for the mat's borders, the pattern's ink has a luma above 0.5. That caps its contrast against
//     the pale fills of the lessons at 2.96 to 3.53:1, **a recorded exception to 1.4.11** (2.96 on the start's light blue): the zone's tag
//     (its name, its number) and its colour are the redundant cue there, and the map, one click away, has the 3:1 ink.
//
// The shapes are worked out here in centimetres, cut to the zone with the even-odd rule the fill uses (a concave zone, a zone with a
// hole), kept a margin clear of its edge, and laid on a grid of the whole mat (so that the hatching of two zones side by side lines up).
// The painter turns them into strokes: all the lines of a zone in one path, all its dots in another.

/** What a zone's pattern is made of. */
export type ZonePatternSpec =
  | { readonly kind: 'dots'; readonly spacingCm: number; readonly radiusCm: number }
  | { readonly kind: 'hatch'; readonly anglesDeg: readonly number[]; readonly spacingCm: number; readonly widthCm: number };

/** The pattern of a kind of zone, or null for one with none (a checkpoint's mark is its tag). */
export function zonePattern(kind: ZoneKind): ZonePatternSpec | null {
  switch (kind) {
    case 'start':
      return { kind: 'dots', spacingCm: 3.2, radiusCm: 0.45 };
    case 'target':
      return { kind: 'hatch', anglesDeg: [45], spacingCm: 2.6, widthCm: 0.32 };
    case 'area':
      return { kind: 'hatch', anglesDeg: [45, 135], spacingCm: 3.2, widthCm: 0.32 };
    case 'checkpoint':
      return null;
  }
}

/**
 * N19 E4/E5: the marks of the palette's colours (body-marks.ts: red striped across, green a grid, blue large dots, as the foam cube's top
 * face and the HUD's swatch have them) as patterns, at a zone's scale or an object's (a 4 cm cube: three stripes, three by three lines,
 * seven dots). None of them is a kind's pattern: the start's dots are half the size of these, a target's hatch is at 45°, an area's crossed.
 */
export function markPattern(mark: BodyMark, scale: 'zone' | 'object'): ZonePatternSpec {
  const zone = scale === 'zone';
  switch (mark) {
    case 'stripes':
      return { kind: 'hatch', anglesDeg: [0], spacingCm: zone ? 2.6 : 1, widthCm: zone ? 0.32 : 0.3 };
    case 'grid':
      return { kind: 'hatch', anglesDeg: [0, 90], spacingCm: zone ? 3.2 : 1.2, widthCm: zone ? 0.32 : 0.25 };
    case 'dots':
      return zone ? { kind: 'dots', spacingCm: 4.4, radiusCm: 0.9 } : { kind: 'dots', spacingCm: 1.3, radiusCm: 0.38 };
  }
}

/** The colour of a zone the lesson names after one (zones[].name red, green, blue), whose mark it then has. */
const markOfName = (name: PaintZone['name']): BodyMark | null => (name === 'red' || name === 'green' || name === 'blue' ? bodyMarks[name] : null);

/**
 * N19 E5: the pattern a zone is drawn with: the mark of its colour for a zone the lesson names after one (so that the red zone looks like
 * the red cube), whatever its kind; its kind's pattern for any other.
 */
export function zonePatternOf(zone: Pick<PaintZone, 'kind' | 'name'>): ZonePatternSpec | null {
  const mark = markOfName(zone.name);
  return mark === null ? zonePattern(zone.kind) : markPattern(mark, 'zone');
}

/** N19 E4: an object's mark on the 2D map, from its colour: the palette's red, green and blue have one; yellow (the light one) and any other colour none. */
export function objectPattern(color: string | undefined): ZonePatternSpec | null {
  const name = bodyColorName(color);
  const mark = name === undefined ? null : bodyMarks[name];
  return mark === null ? null : markPattern(mark, 'object');
}

/** An object's mark keeps this clear of its edge (cm): the map's outline of it is 0.25 cm wide. */
export const OBJECT_PATTERN_MARGIN_CM = 0.3;

type Point = readonly [number, number];
type Polygon = readonly Point[];
/** A stretch of a line: x0, y0, x1, y1 (cm). */
export type PatternSegment = readonly [x0: number, y0: number, x1: number, y1: number];

/** A line stretch shorter than this (cm) is not drawn: a speck beside a corner. */
const MIN_SEGMENT_CM = 0.5;

/** The distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/** Whether `p` is inside `polygon` by the even-odd rule (the fill's). */
function insidePolygon(polygon: Polygon, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i]!, polygon[j]!];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * The part of the line `o + t·d` (|d| = 1) within `margin` of the segment `a`–`b`, as [t0, t1], or null. The set of points within
 * `margin` of a segment is convex (a stadium), so its part of a line is one stretch: the union of the line's parts in the rectangle round
 * the segment and in the discs at its ends.
 */
function nearStretch(o: Point, d: Point, a: Point, b: Point, margin: number): [number, number] | null {
  const parts: [number, number][] = [];
  for (const centre of [a, b]) {
    const [ox, oy] = [o[0] - centre[0], o[1] - centre[1]];
    const half = ox * d[0] + oy * d[1];
    const discriminant = half * half - (ox * ox + oy * oy - margin * margin);
    if (discriminant >= 0) parts.push([-half - Math.sqrt(discriminant), -half + Math.sqrt(discriminant)]);
  }
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length > 0) {
    const [ux, uy] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const [ox, oy] = [o[0] - a[0], o[1] - a[1]];
    // Along the segment (u) from 0 to its length, across it (v = u turned a quarter) within the margin: each a band in t.
    let [lo, hi] = [-Infinity, Infinity];
    for (const [base, slope, from, to] of [
      [ox * ux + oy * uy, d[0] * ux + d[1] * uy, 0, length],
      [-ox * uy + oy * ux, -d[0] * uy + d[1] * ux, -margin, margin],
    ] as const) {
      if (slope === 0) {
        if (base < from || base > to) [lo, hi] = [Infinity, -Infinity];
      } else {
        const [t0, t1] = [(from - base) / slope, (to - base) / slope];
        [lo, hi] = [Math.max(lo, Math.min(t0, t1)), Math.min(hi, Math.max(t0, t1))];
      }
    }
    if (lo <= hi) parts.push([lo, hi]);
  }
  return parts.length === 0 ? null : [Math.min(...parts.map(([t0]) => t0)), Math.max(...parts.map(([, t1]) => t1))];
}

/** `from`–`to` without the stretches in `cuts`. */
function without(from: number, to: number, cuts: readonly (readonly [number, number])[]): [number, number][] {
  let pieces: [number, number][] = [[from, to]];
  for (const [c0, c1] of cuts) {
    pieces = pieces.flatMap(([p0, p1]): [number, number][] => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      return [...(c0 > p0 ? [[p0, c0] as [number, number]] : []), ...(c1 < p1 ? [[c1, p1] as [number, number]] : [])];
    });
  }
  return pieces;
}

/**
 * The lines of a hatch inside `polygon`, kept `marginCm` clear of its edge: for each angle, parallel lines `spacingCm` apart on a grid of
 * the whole mat (a line is at a whole number of spacings from the origin), each cut to where the even-odd fill is. A margin of 0 keeps the
 * lines to the zone's very edge.
 */
export function patternSegments(polygon: Polygon, hatch: { anglesDeg: readonly number[]; spacingCm: number }, marginCm: number): PatternSegment[] {
  const segments: PatternSegment[] = [];
  for (const angle of hatch.anglesDeg) {
    const radians = (angle * Math.PI) / 180;
    const d: Point = [Math.cos(radians), Math.sin(radians)];
    const n: Point = [-Math.sin(radians), Math.cos(radians)];
    const offsets = polygon.map(([x, y]) => x * n[0] + y * n[1]);
    const first = Math.ceil(Math.min(...offsets) / hatch.spacingCm - 1e-9);
    const last = Math.floor(Math.max(...offsets) / hatch.spacingCm + 1e-9);
    for (let line = first; line <= last; line++) {
      const c = line * hatch.spacingCm;
      const o: Point = [n[0] * c, n[1] * c];
      // Where the line crosses the zone's edges: an edge counts when its ends are on different sides (a vertex on the line goes to one
      // side), so the crossings come in pairs, and the line is inside the zone between the first and the second, the third and the fourth…
      const crossings: number[] = [];
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [a, b] = [polygon[j]!, polygon[i]!];
        const [fa, fb] = [a[0] * n[0] + a[1] * n[1] - c, b[0] * n[0] + b[1] * n[1] - c];
        if ((fa <= 0) === (fb <= 0)) continue;
        const k = fa / (fa - fb);
        crossings.push((a[0] + k * (b[0] - a[0])) * d[0] + (a[1] + k * (b[1] - a[1])) * d[1]);
      }
      crossings.sort((p, q) => p - q);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        let pieces: [number, number][] = [[crossings[pair]!, crossings[pair + 1]!]];
        if (marginCm > 0) {
          const cuts: [number, number][] = [];
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const near = nearStretch(o, d, polygon[j]!, polygon[i]!, marginCm);
            if (near !== null) cuts.push(near);
          }
          pieces = without(pieces[0]![0], pieces[0]![1], cuts);
        }
        for (const [t0, t1] of pieces) {
          if (t1 - t0 < MIN_SEGMENT_CM && marginCm > 0) continue;
          if (t1 - t0 < 1e-9) continue;
          segments.push([o[0] + d[0] * t0 + 0, o[1] + d[1] * t0 + 0, o[0] + d[0] * t1 + 0, o[1] + d[1] * t1 + 0]);
        }
      }
    }
  }
  return segments;
}

/**
 * The dots of a dotted zone: rows `spacingCm` apart on a grid of the whole mat, every other row shifted by half a spacing, a dot only
 * where its whole disc and `marginCm` more are inside the zone.
 */
export function patternDots(polygon: Polygon, dots: { spacingCm: number; radiusCm: number }, marginCm: number): Point[] {
  const { spacingCm, radiusCm } = dots;
  const ys = polygon.map(([, y]) => y);
  const xs = polygon.map(([x]) => x);
  const clear = marginCm + radiusCm;
  const found: Point[] = [];
  for (let row = Math.ceil(Math.min(...ys) / spacingCm); row <= Math.floor(Math.max(...ys) / spacingCm); row++) {
    const y = row * spacingCm;
    const shift = Math.abs(row % 2) / 2;
    for (let column = Math.ceil(Math.min(...xs) / spacingCm - shift); column <= Math.floor(Math.max(...xs) / spacingCm - shift); column++) {
      const point: Point = [(column + shift) * spacingCm + 0, y + 0];
      if (!insidePolygon(polygon, point)) continue;
      if (polygon.every((a, i) => distanceToSegment(point, a, polygon[(i + 1) % polygon.length]!) >= clear - 1e-9)) found.push(point);
    }
  }
  return found;
}

// The ink -------------------------------------------------------------------------------------------------------------------------------

/** Where a pattern is drawn: the 3D mat (and R4.2's floor), which looks like paper, or the 2D map, which is only ever a screen's. */
export type PatternSurface = 'mat' | 'screen';

/** The reflectance a line sensor reads as light: nothing printed on the mat may be darker than this (R4.7). */
const SENSOR_LIGHT = 0.5;
/** The luma of a mat pattern drawn darker than its zone's fill: just above that floor, as dark as the rule lets it be. */
const DARK_INK_LUMA = 0.502;
/** How far towards white a mat pattern drawn lighter than its fill is mixed. */
const LIGHT_INK_MIX = 0.75;
/** The contrast a screen pattern is made to have: WCAG 1.4.11's 3, and a margin, so that rounding to 8 bits never takes it under. */
const SCREEN_INK_RATIO = 3.2;

const toHex = (channels: readonly number[]) => `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
const channelsOf = (fill: string) => [1, 3, 5].map((at) => Number.parseInt(fill.slice(at, at + 2), 16));

/** The ink of the mat: see the top of this file. */
function matInk(fill: string): string {
  const channels = channelsOf(fill);
  const luma = colorReflectance(fill);
  const light = toHex(channels.map((channel) => channel + (255 - channel) * LIGHT_INK_MIX));
  if (luma <= DARK_INK_LUMA + 0.01) return light;
  let scale = DARK_INK_LUMA / luma;
  let dark = toHex(channels.map((channel) => channel * scale));
  // Rounding the channels can leave the luma a hair under the floor: darken a little less until it is above it.
  while (colorReflectance(dark) <= SENSOR_LIGHT + 0.0005 && scale < 1) {
    scale += 0.002;
    dark = toHex(channels.map((channel) => channel * scale));
  }
  return contrastRatio(dark, fill) >= contrastRatio(light, fill) ? dark : light;
}

/** The ink of the 2D map: the fill's hue, shaded in 1 % steps towards black or white until it has SCREEN_INK_RATIO against the fill. */
function screenInk(fill: string): string {
  const channels = channelsOf(fill);
  const shade = (towards: 0 | 255): { ink: string; steps: number } | null => {
    for (let steps = 1; steps <= 100; steps++) {
      const ink = toHex(channels.map((channel) => channel + (towards - channel) * (steps / 100)));
      if (contrastRatio(ink, fill) >= SCREEN_INK_RATIO) return { ink, steps };
    }
    return null;
  };
  // The nearer of the two that get there. The last step of each is black or white itself, whose contrast with any fill is at least 4.58:1
  // (the smaller of (L + 0.05) / 0.05 and 1.05 / (L + 0.05) is lowest, 4.58, at a relative luminance of 0.179), so one of them always does:
  // every fill, an author's too, has a pattern of 3:1 or more on the map.
  const found = [shade(0), shade(255)].filter((candidate) => candidate !== null).sort((a, b) => a.steps - b.steps);
  return found[0]?.ink ?? (contrastRatio('#000000', fill) >= contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff');
}

/** The colour a zone's pattern is drawn in on `surface`, `#rrggbb`, from the zone's fill `#rrggbb` (see the top of this file). */
export function patternInk(fill: string, surface: PatternSurface): string {
  return surface === 'screen' ? screenInk(fill) : matInk(fill);
}

// The painter ---------------------------------------------------------------------------------------------------------------------------

/** What the painter uses of a 2D context. */
export type PatternPaintContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'> & {
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  lineWidth: number;
  lineCap: CanvasLineCap;
};

/** A pattern stays this clear of its zone's edge (cm): the border the 3D mat prints is 0.6 cm inside it. */
const PATTERN_MARGIN_CM = 1;
/** A hatch line is never thinner than this many pixels, and a dot never smaller: the 2D map is drawn at a few pixels to the centimetre. */
const MIN_LINE_PX = 1.6;
const MIN_DOT_PX = 3;
/** A dot is a stroke this long (px) with round ends. */
const SPECK_PX = 0.01;

/**
 * Paints `zone`'s pattern (`zonePatternOf`: N19 E5, a zone named after a colour has its colour's mark) over its fill: the lines of a hatch as one stroked path, the dots of a dotted zone as specks (a stroke of next
 * to no length with round ends) in another. `pxPerCm` and `depthCm` place it as ground-paint.ts places the zone: rows run down from the
 * arena's far edge; `surface` says which ink. A zone with no pattern is left alone.
 */
export function paintZonePattern(ctx: PatternPaintContext, zone: Pick<PaintZone, 'kind' | 'color' | 'polygonCm' | 'name'>, frame: { pxPerCm: number; depthCm: number; surface: PatternSurface }): void {
  const spec = zonePatternOf(zone);
  if (spec === null) return;
  const { pxPerCm, depthCm, surface } = frame;
  const px = (xCm: number) => xCm * pxPerCm;
  const py = (yCm: number) => (depthCm - yCm) * pxPerCm;
  if (spec.kind === 'hatch') {
    const lines = patternSegments(zone.polygonCm, spec, PATTERN_MARGIN_CM);
    if (lines.length === 0) return;
    ctx.strokeStyle = patternInk(zone.color, surface);
    ctx.lineWidth = Math.max(spec.widthCm * pxPerCm, MIN_LINE_PX);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of lines) {
      ctx.moveTo(px(x0), py(y0));
      ctx.lineTo(px(x1), py(y1));
    }
    ctx.stroke();
    return;
  }
  const dots = patternDots(zone.polygonCm, spec, PATTERN_MARGIN_CM);
  if (dots.length === 0) return;
  ctx.strokeStyle = patternInk(zone.color, surface);
  ctx.lineWidth = Math.max(2 * spec.radiusCm * pxPerCm, MIN_DOT_PX);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [x, y] of dots) {
    ctx.moveTo(px(x), py(y));
    ctx.lineTo(px(x), py(y) + SPECK_PX);
  }
  ctx.stroke();
}
