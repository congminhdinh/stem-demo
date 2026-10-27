import { describe, expect, it } from 'vitest';
import { parseArena } from '../../core/world/arena/arena-schema';
import { paintGround, type PaintContext } from './ground-paint';

// N19 E8 (E4/E5 review M5): a zone the lesson names (the pick-and-place lessons' "Khu lấy hàng", "Vùng đỏ"…) has its name painted by its outer
// edge, inside it: the top or the bottom one, whichever is farther from the arena's middle (the top for a tie), so that it stays readable
// while an object sits at the zone's middle, where those lessons put one, and the car comes in from the arena's middle (on the 2D map and R4.2's
// fallback floor). A zone with no name (every rover lesson's) keeps its word at its middle, as N18 painted it.

function recorder(): PaintContext & { texts: [string, string, number, number][] } {
  const texts: [string, string, number, number][] = [];
  const target: Record<string, unknown> = { texts };
  for (const method of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke']) target[method] = () => {};
  target.fillText = (text: string, x: number, y: number) => texts.push(['fill', text, x, y]);
  target.strokeText = (text: string, x: number, y: number) => texts.push(['stroke', text, x, y]);
  return target as unknown as PaintContext & { texts: [string, string, number, number][] };
}

const arena = parseArena({
  ground: { sizeCm: [100, 60], color: '#f2f2f2' },
  paint: {
    zones: [
      { id: 'start', kind: 'start', polygonCm: [[10, 10], [30, 10], [30, 40], [10, 40]], color: '#cfe2f3' },
      { id: 'pickup', kind: 'area', name: 'pickup', polygonCm: [[50, 10], [80, 10], [80, 50], [50, 50]], color: '#fff2cc' },
      { id: 'blue-zone', kind: 'target', name: 'blue', polygonCm: [[84, 2], [98, 2], [98, 22], [84, 22]], color: '#cfe2f3' },
    ],
    lines: [],
  },
});
const labels = { start: 'Xuất phát', pickup: 'Khu lấy hàng', 'blue-zone': 'Vùng xanh dương' } as const;
const zoneLabel = (zone: { id: string }) => labels[zone.id as keyof typeof labels] ?? null;

describe('where a zone’s name is painted (N19 E8)', () => {
  it('a named zone’s by its outer edge: the font’s half and 0.15 of it (or a centimetre) inside it, across its middle', () => {
    const ctx = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel, patterns: 'screen' });
    // 30 × 40 cm at 4 px a cm: a font of 30 × 4 × 0.2 = 24 px. Its top (y 50) is 20 cm from the arena's middle (y 30), its bottom (y 10) as
    // far: a tie, the top. The top is 10 cm from the canvas's top, 40 px; the name 12 + 4 px under it.
    const size = 24;
    const y = (60 - 50) * 4 + size / 2 + Math.max(4, size * 0.15);
    expect(ctx.texts.filter(([, text]) => text === 'Khu lấy hàng')).toEqual([
      ['stroke', 'Khu lấy hàng', 65 * 4, y],
      ['fill', 'Khu lấy hàng', 65 * 4, y],
    ]);
    // 14 × 20 cm near the arena's bottom: its bottom (y 2) is 28 cm from the middle, its top (y 22) 8: by the bottom. A font of
    // 14 × 4 × 0.2 = 11.2, rounded 11 px; the bottom is 58 cm from the canvas's top, 232 px; the name 5.5 + 4 px over it.
    const small = 11;
    expect(ctx.texts.filter(([, text]) => text === 'Vùng xanh dương')).toEqual([
      ['stroke', 'Vùng xanh dương', 91 * 4, (60 - 2) * 4 - small / 2 - Math.max(4, small * 0.15)],
      ['fill', 'Vùng xanh dương', 91 * 4, (60 - 2) * 4 - small / 2 - Math.max(4, small * 0.15)],
    ]);
  });

  it('a zone with no name keeps its word at its middle (the rover’s lessons, as N18 painted them)', () => {
    const ctx = recorder();
    paintGround(ctx, arena, { pxPerCm: 4, zoneLabel, patterns: 'screen' });
    expect(ctx.texts.filter(([, text]) => text === 'Xuất phát')).toEqual([
      ['stroke', 'Xuất phát', 20 * 4, (60 - 25) * 4],
      ['fill', 'Xuất phát', 20 * 4, (60 - 25) * 4],
    ]);
  });
});
