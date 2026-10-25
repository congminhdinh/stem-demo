import { describe, expect, it } from 'vitest';
import { parseArena } from '../../core/world/arena/arena-schema';
import { robot3dColors } from './colors';
import { groundTextureSize, paintGround, type PaintContext } from './ground-paint';

// N18 R4.2: the floor of the arena is drawn from the same vector paint the line sensors read (ground-paint.ts of the world): the ground's
// colour, the zones in order (a later one over an earlier one, even-odd), then the black tape with round ends and joins, on a canvas that
// becomes the floor's texture. Canvas rows run down from the far edge (arena y = depth) so that the texture lies the right way up.

/** A 2D context that records what is drawn on it. */
function recorder(): PaintContext & { log: unknown[][] } {
  const log: unknown[][] = [];
  const target: Record<string, unknown> = { log };
  for (const method of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillText']) {
    target[method] = (...args: unknown[]) => log.push([method, ...args]);
  }
  return new Proxy(target, {
    set(object, key, value) {
      log.push([`${String(key)}=`, value]);
      object[key as string] = value;
      return true;
    },
  }) as unknown as PaintContext & { log: unknown[][] };
}

const arena = parseArena({
  ground: { sizeCm: [100, 50], color: '#f2f2f2' },
  paint: {
    zones: [
      { id: 'start', kind: 'start', polygonCm: [[10, 10], [30, 10], [30, 40], [10, 40]], color: '#cfe2f3' },
      { id: 'target', kind: 'target', polygonCm: [[60, 5], [90, 5], [75, 45]], color: '#d9ead3' },
    ],
    lines: [{ pointsCm: [[5, 25], [95, 25], [95, 45]], widthCm: 2 }],
  },
});

describe('the floor texture (N18 R4.2)', () => {
  it('paints the ground, the zones in order, then the tape, in pixels with rows from the far edge down', () => {
    const ctx = recorder();
    paintGround(ctx, arena, { pxPerCm: 2, zoneLabel: () => null });
    expect(ctx.log).toEqual([
      ['fillStyle=', '#f2f2f2'],
      ['fillRect', 0, 0, 200, 100],
      ['fillStyle=', '#cfe2f3'],
      ['beginPath'],
      ['moveTo', 20, 80],
      ['lineTo', 60, 80],
      ['lineTo', 60, 20],
      ['lineTo', 20, 20],
      ['closePath'],
      ['fill', 'evenodd'],
      ['fillStyle=', '#d9ead3'],
      ['beginPath'],
      ['moveTo', 120, 90],
      ['lineTo', 180, 90],
      ['lineTo', 150, 10],
      ['closePath'],
      ['fill', 'evenodd'],
      ['strokeStyle=', robot3dColors.tape],
      ['lineWidth=', 4],
      ['lineCap=', 'round'],
      ['lineJoin=', 'round'],
      ['beginPath'],
      ['moveTo', 10, 50],
      ['lineTo', 190, 50],
      ['lineTo', 190, 10],
      ['stroke'],
    ]);
  });

  it('writes a zone’s label at the middle of its bounds, under the tape, sized to the zone', () => {
    const ctx = recorder();
    paintGround(ctx, arena, { pxPerCm: 2, zoneLabel: (zone) => (zone.kind === 'target' ? 'Đích' : null) });
    const text = ctx.log.findIndex(([method]) => method === 'fillText');
    expect(ctx.log[text]).toEqual(['fillText', 'Đích', 150, 50]);
    expect(text).toBeLessThan(ctx.log.findIndex(([method]) => method === 'stroke'));
    expect(ctx.log.slice(text - 4, text)).toEqual([
      ['fillStyle=', robot3dColors.zoneLabel],
      ['font=', '600 12px "Be Vietnam Pro", system-ui, sans-serif'],
      ['textAlign=', 'center'],
      ['textBaseline=', 'middle'],
    ]);
  });

  it('gives the texture as many pixels per centimetre as the largest texture allows, at most 8', () => {
    expect(groundTextureSize([160, 80], 4096)).toEqual({ pxPerCm: 8, width: 1280, height: 640 });
    expect(groundTextureSize([300, 200], 2048)).toEqual({ pxPerCm: 2048 / 300, width: 2048, height: 1366 });
  });
});
