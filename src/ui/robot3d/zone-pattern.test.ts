import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../a11y/contrast';
import { zoneKinds, type PaintZone } from '../../core/world/arena/arena-schema';
import { colorReflectance } from '../../core/world/arena/ground-paint';
import { buildArenaMat } from '../../core/scenario/arena-mat';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { paintZonePattern, patternDots, patternInk, patternSegments, zonePattern, type PatternPaintContext } from './zone-pattern';

// N18 R8: zones told apart by pattern as well as colour, for learners who cannot tell the pastel fills apart: the start by dots, a target by
// diagonal hatching, an area (the schema's generic region) by cross-hatching; a checkpoint by its numbered tag, so no pattern. The patterns
// are visual only (the 3D mat texture, the fallback floor and the 2D map): the line sensor reads the scenario's vector paint, never this.
// On the mat they are drawn light (luma above the sensor's 0.5) so that nothing there reads dark that the sensor would not: a recorded
// exception to WCAG 1.4.11 (below 3:1 on the palest fill). The 2D map is never printed or sensed: its ink has 3:1 on every fill.

const square = [[0, 0], [10, 0], [10, 10], [0, 10]] as const;
const length = ([x0, y0, x1, y1]: readonly number[]) => Math.hypot(x1! - x0!, y1! - y0!);

describe('zonePattern', () => {
  it('gives each kind of zone its pattern', () => {
    expect(zonePattern('start')).toEqual({ kind: 'dots', spacingCm: 3.2, radiusCm: 0.45 });
    expect(zonePattern('target')).toEqual({ kind: 'hatch', anglesDeg: [45], spacingCm: 2.6, widthCm: 0.32 });
    expect(zonePattern('area')).toEqual({ kind: 'hatch', anglesDeg: [45, 135], spacingCm: 3.2, widthCm: 0.32 });
    // The checkpoint has its numbered tag.
    expect(zonePattern('checkpoint')).toBeNull();
  });

  it('knows every kind of zone the arena schema has', () => {
    for (const kind of zoneKinds) expect(() => zonePattern(kind)).not.toThrow();
    expect(new Set(zoneKinds.map((kind) => JSON.stringify(zonePattern(kind)))).size).toBe(zoneKinds.length);
  });
});

describe('patternSegments', () => {
  it('cuts the hatching to the zone: a 10 cm square at 45° with a line for every y − x = k has the 19 lines that cross its inside', () => {
    // Neighbouring lines of y − x = k are 1/√2 apart, measured across them.
    const spacing = Math.SQRT1_2;
    const segments = patternSegments(square, { anglesDeg: [45], spacingCm: spacing }, 0);
    expect(segments).toHaveLength(19);
    // The line y = x + 3 runs from the left edge to the top edge.
    const three = segments.find(([x0, y0, x1, y1]) => Math.abs(y0 - x0 - 3) < 1e-9 && Math.abs(y1 - x1 - 3) < 1e-9);
    expect(three?.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([0, 3, 7, 10]);
    // The diagonal is the longest; the lengths add up to every line of the grid (√2 · (10 + 2 · (1 + … + 9))).
    expect(Math.max(...segments.map(length))).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(segments.reduce((sum, segment) => sum + length(segment), 0)).toBeCloseTo(Math.SQRT2 * 100, 9);
  });

  it('keeps the lines on a grid of the whole mat, so that neighbouring zones’ hatching lines up', () => {
    const shifted = [[5, 0], [15, 0], [15, 10], [5, 10]] as const;
    const spacing = 2.5;
    const all = (polygon: readonly (readonly [number, number])[]) => patternSegments(polygon, { anglesDeg: [45], spacingCm: spacing }, 0).map(([x0, y0]) => ((y0 - x0) / Math.SQRT2) / spacing);
    for (const offset of [...all(square), ...all(shifted)]) expect(Math.abs(offset - Math.round(offset))).toBeLessThan(1e-9);
  });

  it('leaves the notch of a concave zone empty: a line through both arms of a U is two segments (even-odd, as the fill is)', () => {
    const u = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]] as const;
    // Horizontal lines (0°) every 5 cm: y = 0 (the base's edge), 5 and 10 (the arms' tops).
    const segments = patternSegments(u, { anglesDeg: [0], spacingCm: 5 }, 0);
    const at5 = segments.filter(([, y0]) => y0 === 5).map(([x0, , x1]) => [x0, x1]);
    expect(at5).toEqual([[0, 3], [7, 10]]);
  });

  it('keeps clear of the zone’s edge: each end of a line is cut back by the margin, and a line too short for that is dropped', () => {
    const spacing = 5;
    const segments = patternSegments(square, { anglesDeg: [0], spacingCm: spacing }, 1);
    // y = 5 only (y = 0 and y = 10 lie on the zone's edge, within the margin of it): from x = 1 to x = 9.
    expect(segments).toEqual([[1, 5, 9, 5]]);
    expect(patternSegments(square, { anglesDeg: [0], spacingCm: 5 }, 5)).toEqual([]);
  });

  it('draws the cross-hatch of an area as the two diagonals’ lines together', () => {
    const cross = patternSegments(square, { anglesDeg: [45, 135], spacingCm: 2 }, 0);
    const one = patternSegments(square, { anglesDeg: [45], spacingCm: 2 }, 0);
    const other = patternSegments(square, { anglesDeg: [135], spacingCm: 2 }, 0);
    expect(cross).toHaveLength(one.length + other.length);
    expect(other.length).toBeGreaterThan(0);
  });
});

describe('patternDots', () => {
  it('puts dots on a staggered grid of the whole mat, each a margin and its radius inside the zone', () => {
    const dots = patternDots(square, { spacingCm: 4, radiusCm: 0.5 }, 1);
    // Rows 4 cm apart (y = 4, 8), every other row shifted by half a spacing; each disc 1.5 cm inside every edge (x from 1.5 to 8.5).
    expect(dots).toEqual([
      [2, 4],
      [6, 4],
      [4, 8],
      [8, 8],
    ]);
  });

  it('leaves out the dots a concave zone does not cover', () => {
    const u = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]] as const;
    for (const [x, y] of patternDots(u, { spacingCm: 1.5, radiusCm: 0.2 }, 0.2)) {
      expect(y < 3 || x < 3 || x > 7, `(${x}, ${y})`).toBe(true);
    }
  });
});

describe('patternInk on the mat (a recorded exception to WCAG 1.4.11)', () => {
  const pilotFills = [...new Set(scenarioCatalog.scenarios.flatMap((scenario) => scenario.arena.paint.zones.map((zone) => zone.color)))];

  it('is the zone’s own hue, darkened to a luma just above the sensor’s 0.5, so that it is never printed darker than the sensor reads as light', () => {
    expect(pilotFills.length).toBeGreaterThanOrEqual(3);
    for (const fill of pilotFills) {
      const ink = patternInk(fill, 'mat');
      expect(ink).toMatch(/^#[0-9a-f]{6}$/);
      expect(colorReflectance(ink), fill).toBeGreaterThan(0.5);
      expect(colorReflectance(ink), fill).toBeLessThan(0.52);
    }
  });

  it('shows against the lessons’ fills at 2.96 to 3.53:1, under 3:1 on the palest blue: the exception, held by the luma floor and recorded here', () => {
    const ratios = Object.fromEntries(pilotFills.map((fill) => [fill, contrastRatio(patternInk(fill, 'mat'), fill)]));
    // The floor of what the mat's ink can do: do not let it get worse.
    for (const [fill, ratio] of Object.entries(ratios)) expect(ratio, fill).toBeGreaterThanOrEqual(2.9);
    // And the exception is real: the start's light blue cannot have 3:1 with an ink of luma above 0.5 (that is why the map has its own ink).
    expect(ratios['#cfe2f3']).toBeLessThan(3);
    expect(ratios['#cfe2f3']).toBeCloseTo(2.96, 2);
  });

  it('is lighter than the fill when the fill is dark, and still above 0.5; white and black fills both get a visible one', () => {
    for (const fill of ['#000000', '#222222', '#442200', '#334455', '#ffffff', '#fff2cc', '#808080']) {
      const ink = patternInk(fill, 'mat');
      expect(colorReflectance(ink), fill).toBeGreaterThan(0.5);
      expect(Math.abs(colorReflectance(ink) - colorReflectance(fill)), fill).toBeGreaterThan(0.1);
    }
    expect(colorReflectance(patternInk('#222222', 'mat'))).toBeGreaterThan(colorReflectance('#222222'));
  });
});

describe('patternInk on the 2D map', () => {
  const catalogueFills = [...new Set(scenarioCatalog.scenarios.flatMap((scenario) => [scenario.arena.ground.color, ...scenario.arena.paint.zones.map((zone) => zone.color)]))];

  it('has at least 3:1 against every zone and ground colour of the catalogue, with no floor on its luma', () => {
    expect(catalogueFills.length).toBeGreaterThanOrEqual(4);
    for (const fill of catalogueFills) {
      const ink = patternInk(fill, 'screen');
      expect(ink, fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(ink, fill), fill).toBeGreaterThanOrEqual(3);
    }
    // It goes below the mat's floor where it has to: the start's ink is darker than a luma of 0.5.
    expect(colorReflectance(patternInk('#cfe2f3', 'screen'))).toBeLessThan(0.5);
  });

  it('keeps the zone’s own hue where a shade of it is far enough, so that a pattern still says which zone it is', () => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(patternInk('#cfe2f3', 'screen').slice(at, at + 2), 16));
    // A light blue stays a (dark) blue: blue the largest channel, red the smallest.
    expect(b!).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(r!);
  });

  it('has 3:1 against every colour of the RGB cube (4 096 of them, a step of 17): an author’s fill that no shade of its hue can get away from still gets an ink', () => {
    const steps = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255];
    const hex = (value: number) => value.toString(16).padStart(2, '0');
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const fill = `#${hex(r)}${hex(g)}${hex(b)}`;
          const ink = patternInk(fill, 'screen');
          expect(ink, fill).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrastRatio(ink, fill), `${fill} → ${ink}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('works at the ends: black and white fills, and the greys that are the farthest from both (relative luminance about 0.18)', () => {
    for (const fill of ['#000000', '#ffffff', '#767676', '#777777', '#7a7a7a', '#7f7f7f', '#808080', '#bcbcbc', '#464646']) {
      expect(contrastRatio(patternInk(fill, 'screen'), fill), fill).toBeGreaterThanOrEqual(3);
    }
  });

  it('is a darker shade of a pale fill, a lighter one of a dark fill, and not the fill', () => {
    expect(colorReflectance(patternInk('#fff2cc', 'screen'))).toBeLessThan(colorReflectance('#fff2cc'));
    expect(colorReflectance(patternInk('#101820', 'screen'))).toBeGreaterThan(colorReflectance('#101820'));
    expect(patternInk('#7f7f7f', 'screen')).not.toBe('#7f7f7f');
  });
});

/** A recorder of what is drawn: the stroke styles and the path of each stroke. */
function recorder() {
  const log: (string | number)[][] = [];
  const state = { strokeStyle: '', lineWidth: 0, lineCap: 'butt' };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
      log.push(['strokeStyle', value]);
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
      log.push(['lineWidth', value]);
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(value: string) {
      state.lineCap = value;
      log.push(['lineCap', value]);
    },
    beginPath: () => log.push(['beginPath']),
    moveTo: (x: number, y: number) => log.push(['moveTo', x, y]),
    lineTo: (x: number, y: number) => log.push(['lineTo', x, y]),
    stroke: () => log.push(['stroke']),
  };
  return { ctx: ctx as unknown as PatternPaintContext, log };
}

const zone = (kind: PaintZone['kind'], color = '#d9ead3'): PaintZone => ({ id: 'z', kind, color, polygonCm: [[10, 10], [30, 10], [30, 30], [10, 30]] });

describe('paintZonePattern', () => {
  it('strokes the hatching in the zone’s ink in pixels, rows down from the far edge, as one path', () => {
    const { ctx, log } = recorder();
    paintZonePattern(ctx, zone('target'), { pxPerCm: 4, depthCm: 50, surface: 'mat' });
    expect(log.slice(0, 4)).toEqual([['strokeStyle', patternInk('#d9ead3', 'mat')], ['lineWidth', 1.6], ['lineCap', 'butt'], ['beginPath']]);
    const moves = log.filter(([op]) => op === 'moveTo');
    const lines = log.filter(([op]) => op === 'lineTo');
    expect(moves.length).toBeGreaterThan(5);
    expect(lines).toHaveLength(moves.length);
    expect(log.filter(([op]) => op === 'stroke')).toHaveLength(1);
    // Every point is inside the zone (10..30 cm → 40..120 px; y = 50 − cm → 80..160 px from the top).
    for (const [, x, y] of [...moves, ...lines]) {
      expect(x as number).toBeGreaterThan(40);
      expect(x as number).toBeLessThan(120);
      expect(y as number).toBeGreaterThan(80);
      expect(y as number).toBeLessThan(160);
    }
  });

  it('draws a hatch line as wide as it is in the world when the picture is large, at least 1.6 px when it is small, and dots as round-capped specks', () => {
    const large = recorder();
    paintZonePattern(large.ctx, zone('target'), { pxPerCm: 10, depthCm: 50, surface: 'mat' });
    expect(large.log.find(([op]) => op === 'lineWidth')).toEqual(['lineWidth', 3.2]);
    const small = recorder();
    paintZonePattern(small.ctx, zone('target'), { pxPerCm: 2, depthCm: 50, surface: 'mat' });
    expect(small.log.find(([op]) => op === 'lineWidth')).toEqual(['lineWidth', 1.6]);
    const dots = recorder();
    paintZonePattern(dots.ctx, zone('start', '#cfe2f3'), { pxPerCm: 10, depthCm: 50, surface: 'mat' });
    expect(dots.log.slice(0, 4)).toEqual([['strokeStyle', patternInk('#cfe2f3', 'mat')], ['lineWidth', 9], ['lineCap', 'round'], ['beginPath']]);
    const moves = dots.log.filter(([op]) => op === 'moveTo');
    expect(moves.length).toBeGreaterThan(20);
    // A speck is a stroke of next to no length: its two ends are one point.
    const firstMove = dots.log.findIndex(([op]) => op === 'moveTo');
    const [, x0, y0] = dots.log[firstMove]!;
    const [, x1, y1] = dots.log[firstMove + 1]!;
    expect(Math.hypot((x1 as number) - (x0 as number), (y1 as number) - (y0 as number))).toBeLessThan(0.2);
  });

  it('strokes the map’s pattern in the map’s ink and the mat’s in the mat’s: the same zone, two inks', () => {
    const map = recorder();
    paintZonePattern(map.ctx, zone('start', '#cfe2f3'), { pxPerCm: 4, depthCm: 50, surface: 'screen' });
    expect(map.log[0]).toEqual(['strokeStyle', patternInk('#cfe2f3', 'screen')]);
    const mat = recorder();
    paintZonePattern(mat.ctx, zone('start', '#cfe2f3'), { pxPerCm: 4, depthCm: 50, surface: 'mat' });
    expect(mat.log[0]).toEqual(['strokeStyle', patternInk('#cfe2f3', 'mat')]);
    expect(map.log[0]![1]).not.toBe(mat.log[0]![1]);
  });

  it('paints nothing for a checkpoint (its tag is its mark)', () => {
    const { ctx, log } = recorder();
    paintZonePattern(ctx, zone('checkpoint', '#fff2cc'), { pxPerCm: 4, depthCm: 50, surface: 'mat' });
    expect(log).toEqual([]);
  });
});

describe('the printed mat (N18 R5.3) is not given the patterns', () => {
  it('prints every zone as a plain fill, in the zone’s own colour, which a line sensor reads at the luma of that colour', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      const svg = buildArenaMat(scenario).svg;
      for (const zone of scenario.arena.paint.zones) {
        expect(svg).toContain(`id="zone-${zone.id}"`);
        expect(svg).toContain(`fill="${zone.color}"`);
        // Light, so that nothing printed on the zones reads dark.
        expect(colorReflectance(zone.color), `${scenario.key} ${zone.id}`).toBeGreaterThanOrEqual(0.5);
      }
      // The only pattern the printed mat has is the hatching of a footprint (an object to put on it), not of a zone.
      expect(svg.match(/url\(#mat-hatch\)/g)?.length ?? 0).toBe((svg.match(/class="footprint"/g) ?? []).length);
    }
  });
});
