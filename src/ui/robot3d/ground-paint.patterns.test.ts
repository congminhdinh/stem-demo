import { describe, expect, it } from 'vitest';
import { parseArena } from '../../core/world/arena/arena-schema';
import { robot3dColors } from './colors';
import { paintGround, type PaintContext } from './ground-paint';
import { patternInk } from './zone-pattern';

// N18 R8: with `patterns`, a zone's pattern is drawn right over its fill, before the next zone's fill (a later zone covers an earlier
// one's pattern as it covers its fill), its label and the tape; without it paintGround draws what it always did (ground-paint.test.ts).

/** Records the order of what is drawn, and the stroke style, line width and cap each stroke has. */
function recorder() {
  const log: string[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: 'butt', lineJoin: 'miter', font: '', textAlign: 'start', textBaseline: 'alphabetic' };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      return () => {
        if (key === 'fill') log.push(`fill ${String(state.fillStyle)}`);
        else if (key === 'stroke') log.push(`stroke ${String(state.strokeStyle)} ${String(state.lineWidth)} ${String(state.lineCap)}`);
        else if (key === 'fillText') log.push('text');
        else if (key === 'strokeText') log.push(`halo ${String(state.strokeStyle)}`);
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as PaintContext;
  return { ctx, log };
}

const arena = parseArena({
  ground: { sizeCm: [100, 60], color: '#f2f2f2' },
  paint: {
    zones: [
      { id: 'start', kind: 'start', polygonCm: [[10, 10], [40, 10], [40, 40], [10, 40]], color: '#cfe2f3' },
      { id: 'cp', kind: 'checkpoint', polygonCm: [[45, 10], [60, 10], [60, 40], [45, 40]], color: '#fff2cc' },
      { id: 'goal', kind: 'target', polygonCm: [[65, 10], [95, 10], [95, 40], [65, 40]], color: '#d9ead3' },
      { id: 'keep-out', kind: 'area', polygonCm: [[10, 45], [40, 45], [40, 58], [10, 58]], color: '#f4cccc' },
    ],
    lines: [{ pointsCm: [[5, 25], [95, 25]], widthCm: 2 }],
  },
});

describe('paintGround patterns (N18 R8)', () => {
  it('draws each zone’s pattern over its own fill and before the next zone’s, a checkpoint’s none, and the tape over all', () => {
    const { ctx, log } = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel: () => null, patterns: 'mat' });
    expect(log[0]).toBe('fill #cfe2f3');
    // start: its fill, then dots in its ink (round caps); the checkpoint: its fill only; the target: fill, hatching; the area: fill, cross-hatching.
    expect(log).toEqual([
      'fill #cfe2f3',
      expect.stringMatching(new RegExp(`^stroke ${patternInk('#cfe2f3', 'mat')} 3.6 round$`)),
      'fill #fff2cc',
      'fill #d9ead3',
      expect.stringMatching(new RegExp(`^stroke ${patternInk('#d9ead3', 'mat')} 1.6 butt$`)),
      'fill #f4cccc',
      expect.stringMatching(new RegExp(`^stroke ${patternInk('#f4cccc', 'mat')} 1.6 butt$`)),
      expect.stringMatching(/^stroke #15171c 8 round$/),
    ]);
  });

  it('draws nothing more than before without the option', () => {
    const { ctx, log } = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel: () => null });
    expect(log).toEqual(['fill #cfe2f3', 'fill #fff2cc', 'fill #d9ead3', 'fill #f4cccc', expect.stringMatching(/^stroke #15171c 8 round$/)]);
  });

  it('keeps a pattern under the zone’s label, which has a pale halo of its own over the lines', () => {
    const { ctx, log } = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel: (zone) => (zone.kind === 'target' ? 'Đích' : null), patterns: 'mat' });
    const hatch = log.findIndex((entry) => entry.startsWith(`stroke ${patternInk('#d9ead3', 'mat')}`));
    expect(log[hatch + 1]).toBe(`halo ${robot3dColors.zoneLabelHalo}`);
    expect(log[hatch + 2]).toBe('text');
  });

  it('draws the label as it always did, with no halo, when there are no patterns', () => {
    const { ctx, log } = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel: (zone) => (zone.kind === 'target' ? 'Đích' : null) });
    expect(log.some((entry) => entry.startsWith('halo'))).toBe(false);
    expect(log).toContain('text');
  });
});
