import { describe, expect, it } from 'vitest';
import { colorReflectance } from '../../../core/world/arena/ground-paint';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import type { PaintContext } from '../ground-paint';
import { patternInk } from '../zone-pattern';
import { paintMat } from './mat-paint';

// N18 R8: the 3D mat has the zones' patterns (dots on the start, hatching on a target), under the border of each zone and the tape, and as
// light as the border is: a line sensor never reads this texture, but nothing on the mat may look darker than the sensor's 0.5.

function recorder() {
  const calls: { op: string; style: string; cap: string }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect() {
      calls.push({ op: 'fillRect', style: String(this.fillStyle), cap: '' });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    setLineDash() {},
    fill() {
      calls.push({ op: 'fill', style: String(this.fillStyle), cap: '' });
    },
    stroke() {
      calls.push({ op: 'stroke', style: String(this.strokeStyle), cap: String(this.lineCap) });
    },
    fillText() {},
  };
  return { ctx: ctx as unknown as PaintContext & Pick<CanvasRenderingContext2D, 'arc' | 'setLineDash'>, calls };
}

describe('the printed mat’s patterns (N18 R8)', () => {
  it('prints dots on the start and hatching on the target, each in its zone’s ink, before the borders and the tape', () => {
    const scenario = scenarioCatalog.get('rb-line-follow')!;
    const { ctx, calls } = recorder();
    paintMat(ctx, scenario, { pxPerCm: 3 });
    const start = scenario.arena.paint.zones.find((zone) => zone.kind === 'start')!;
    const target = scenario.arena.paint.zones.find((zone) => zone.kind === 'target')!;
    const dots = calls.findIndex((call) => call.op === 'stroke' && call.style === patternInk(start.color));
    const hatch = calls.findIndex((call) => call.op === 'stroke' && call.style === patternInk(target.color));
    expect(calls[dots]!.cap).toBe('round');
    expect(calls[hatch]!.cap).toBe('butt');
    const tape = calls.findIndex((call) => call.op === 'stroke' && call.style === '#15171c');
    expect(Math.max(dots, hatch)).toBeLessThan(tape);
    // The target's fill comes after the start's dots: a later zone covers an earlier one's pattern.
    const targetFill = calls.findIndex((call) => call.op === 'fill' && call.style === target.color);
    expect(dots).toBeLessThan(targetFill);
    expect(targetFill).toBeLessThan(hatch);
  });

  it('prints every pattern of every lesson light: luma above 0.5, like the borders', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      const { ctx, calls } = recorder();
      paintMat(ctx, scenario, { pxPerCm: 3 });
      const strokes = calls.filter((call) => call.op === 'stroke' && call.style !== '#15171c');
      expect(strokes.length, scenario.key).toBeGreaterThan(0);
      for (const stroke of strokes) {
        const luma = /^#/.test(stroke.style) ? colorReflectance(stroke.style) : (() => {
          const m = /rgba?\((\d+), (\d+), (\d+)/.exec(stroke.style)!;
          return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
        })();
        expect(luma, `${scenario.key} ${stroke.style}`).toBeGreaterThan(0.5);
      }
    }
  });
});
