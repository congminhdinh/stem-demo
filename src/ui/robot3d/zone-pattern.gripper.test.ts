import { describe, expect, it } from 'vitest';
import { zoneKinds, zoneNames, type PaintZone } from '../../core/world/arena/arena-schema';
import { colorReflectance } from '../../core/world/arena/ground-paint';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { contrastRatio } from '../a11y/contrast';
import { gripperTestScenario } from './__fixtures__/gripper-scene';
import { markPattern, objectPattern, OBJECT_PATTERN_MARGIN_CM, paintZonePattern, patternDots, patternInk, patternSegments, zonePattern, zonePatternOf, type PatternPaintContext, type ZonePatternSpec } from './zone-pattern';

// N19 E4/E5: the pick-and-place lessons tell their colours apart by a mark as well as by colour, for a learner who cannot (N18 R8): red is
// striped across, green is a grid, blue has large dots (the foam cube's top face, E7, and the HUD's swatch, E1). A zone the lesson names
// after a colour has its colour's mark, and so does an object of that colour on the 2D map, so that a cube and its zone look alike. The
// marks are none of the kinds' (the start's small dots, a target's 45° hatch, an area's cross-hatch). On the map their ink has 3:1 against
// the fill (`patternInk` 'screen'); on the 3D mat it stays above the line sensor's 0.5 ('mat').

const zone = (kind: PaintZone['kind'], name?: PaintZone['name'], color = '#f4cccc'): PaintZone => ({ id: 'z', kind, polygonCm: [[0, 0], [20, 0], [20, 20], [0, 20]], color, ...(name === undefined ? {} : { name }) });
const cube = [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const;

describe('the colour marks as patterns (N19 E4/E5)', () => {
  it('are horizontal stripes, a grid and large dots, at a zone’s scale and at an object’s', () => {
    expect(markPattern('stripes', 'zone')).toEqual({ kind: 'hatch', anglesDeg: [0], spacingCm: 2.6, widthCm: 0.32 });
    expect(markPattern('grid', 'zone')).toEqual({ kind: 'hatch', anglesDeg: [0, 90], spacingCm: 3.2, widthCm: 0.32 });
    expect(markPattern('dots', 'zone')).toEqual({ kind: 'dots', spacingCm: 4.4, radiusCm: 0.9 });
    expect(markPattern('stripes', 'object')).toEqual({ kind: 'hatch', anglesDeg: [0], spacingCm: 1, widthCm: 0.3 });
    expect(markPattern('grid', 'object')).toEqual({ kind: 'hatch', anglesDeg: [0, 90], spacingCm: 1.2, widthCm: 0.25 });
    expect(markPattern('dots', 'object')).toEqual({ kind: 'dots', spacingCm: 1.3, radiusCm: 0.38 });
  });

  it('differ from every kind’s pattern: the start’s small dots, a target’s 45° hatch, an area’s cross-hatch', () => {
    const kinds = new Set(zoneKinds.map((kind) => JSON.stringify(zonePattern(kind))));
    for (const mark of ['stripes', 'grid', 'dots'] as const) expect(kinds.has(JSON.stringify(markPattern(mark, 'zone'))), mark).toBe(false);
    // The large dots are twice the start's.
    expect((markPattern('dots', 'zone') as { radiusCm: number }).radiusCm).toBe(2 * (zonePattern('start') as { radiusCm: number }).radiusCm);
  });

  it('give a zone named after a colour its colour’s mark, whatever its kind; every other zone keeps its kind’s pattern', () => {
    for (const kind of zoneKinds) {
      expect(zonePatternOf(zone(kind, 'red'))).toEqual(markPattern('stripes', 'zone'));
      expect(zonePatternOf(zone(kind, 'green'))).toEqual(markPattern('grid', 'zone'));
      expect(zonePatternOf(zone(kind, 'blue'))).toEqual(markPattern('dots', 'zone'));
      for (const name of zoneNames.filter((candidate) => !['red', 'green', 'blue'].includes(candidate))) expect(zonePatternOf(zone(kind, name))).toEqual(zonePattern(kind));
      expect(zonePatternOf(zone(kind))).toEqual(zonePattern(kind));
    }
  });

  it('give an object of a palette colour its mark (yellow, the light one, and any other colour none)', () => {
    expect(objectPattern(bodyPalette.red)).toEqual(markPattern('stripes', 'object'));
    expect(objectPattern('#D32F2F')).toEqual(markPattern('stripes', 'object'));
    expect(objectPattern(bodyPalette.green)).toEqual(markPattern('grid', 'object'));
    expect(objectPattern(bodyPalette.blue)).toEqual(markPattern('dots', 'object'));
    expect(objectPattern(bodyPalette.yellow)).toBeNull();
    expect(objectPattern('#123456')).toBeNull();
    expect(objectPattern(undefined)).toBeNull();
  });

  it('fit a 4 cm cube: three stripes, a grid of three by three lines, seven dots, each kept 0.3 cm inside its edge', () => {
    expect(OBJECT_PATTERN_MARGIN_CM).toBe(0.3);
    const stripes = patternSegments(cube, markPattern('stripes', 'object') as Extract<ZonePatternSpec, { kind: 'hatch' }>, OBJECT_PATTERN_MARGIN_CM);
    expect(stripes.map(([x0, y0, x1, y1]) => [x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000))).toEqual([
      [-1.7, -1, 1.7, -1],
      [-1.7, 0, 1.7, 0],
      [-1.7, 1, 1.7, 1],
    ]);
    const grid = patternSegments(cube, markPattern('grid', 'object') as Extract<ZonePatternSpec, { kind: 'hatch' }>, OBJECT_PATTERN_MARGIN_CM);
    expect(grid).toHaveLength(6);
    expect(grid.filter(([, y0, , y1]) => Math.abs(y0 - y1) < 1e-9).map(([, y]) => Math.round(y * 1000) / 1000)).toEqual([-1.2, 0, 1.2]);
    const dots = patternDots(cube, markPattern('dots', 'object') as Extract<ZonePatternSpec, { kind: 'dots' }>, OBJECT_PATTERN_MARGIN_CM);
    expect(dots.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])).toEqual([
      [-0.65, -1.3],
      [0.65, -1.3],
      [-1.3, 0],
      [0, 0],
      [1.3, 0],
      [-0.65, 1.3],
      [0.65, 1.3],
    ]);
  });
});

describe('the marks’ inks (N18 R8 for N19 E4/E5)', () => {
  it('on the 2D map: 3:1 or more against every palette colour an object is filled with, and against the pick-and-place zones', () => {
    for (const fill of Object.values(bodyPalette)) expect(contrastRatio(patternInk(fill, 'screen'), fill), fill).toBeGreaterThanOrEqual(3);
    const named = gripperTestScenario.arena.paint.zones;
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const { color } of named) expect(contrastRatio(patternInk(color, 'screen'), color), color).toBeGreaterThanOrEqual(3);
  });

  it('on the 3D mat: never darker than the line sensor reads as light (luma above 0.5) on the pick-and-place zones', () => {
    for (const { color } of gripperTestScenario.arena.paint.zones) expect(colorReflectance(patternInk(color, 'mat')), color).toBeGreaterThan(0.5);
  });
});

describe('a named zone’s mark on the mat and the map (N19 E5)', () => {
  type Call = { op: string; args: number[]; style: string; width: number; cap: string };
  const recorder = () => {
    const calls: Call[] = [];
    const ctx = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt' as CanvasLineCap,
      beginPath: () => void calls.push({ op: 'begin', args: [], style: '', width: 0, cap: '' }),
      moveTo: (x: number, y: number) => void calls.push({ op: 'move', args: [x, y], style: '', width: 0, cap: '' }),
      lineTo: (x: number, y: number) => void calls.push({ op: 'line', args: [x, y], style: '', width: 0, cap: '' }),
      stroke() {
        calls.push({ op: 'stroke', args: [], style: String(this.strokeStyle), width: this.lineWidth, cap: this.lineCap });
      },
    };
    return { ctx: ctx as unknown as PatternPaintContext, calls };
  };

  it('strokes a red zone with horizontal lines in its ink, a blue one with round dots: rows down from the far edge', () => {
    const red = recorder();
    paintZonePattern(red.ctx, zone('target', 'red'), { pxPerCm: 2, depthCm: 100, surface: 'screen' });
    const moves = red.calls.filter((call) => call.op === 'move');
    const lines = red.calls.filter((call) => call.op === 'line');
    expect(moves.length).toBeGreaterThan(4);
    // Every line is level: its two ends at the same row.
    moves.forEach((move, i) => expect(lines[i]!.args[1]).toBe(move.args[1]));
    expect(red.calls.at(-1)).toMatchObject({ op: 'stroke', style: patternInk('#f4cccc', 'screen'), cap: 'butt' });
    const blue = recorder();
    paintZonePattern(blue.ctx, zone('target', 'blue', '#cfe2f3'), { pxPerCm: 2, depthCm: 100, surface: 'mat' });
    expect(blue.calls.at(-1)).toMatchObject({ op: 'stroke', style: patternInk('#cfe2f3', 'mat'), cap: 'round', width: 3.6 });
  });
});
