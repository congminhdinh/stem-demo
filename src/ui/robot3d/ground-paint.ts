import type { Arena, PaintZone, PointCm } from '../../core/world/arena/arena-schema';
import { robot3dColors } from './colors';

// The floor of the robot lab's 3D view (N18 R4.2), drawn from the arena's vector paint, the same data the line sensors read
// (core/world/arena/ground-paint.ts): the ground's colour, the zones in order (a later one over an earlier one, even-odd fill), then the
// black tape along each line with round ends and joins. It is painted once on a 2D canvas, which becomes the floor's texture: one mesh,
// one draw call, however many lines and zones. Canvas rows run down from the arena's far edge (y = depth), so that the texture, which
// three.js flips, lies on the floor the right way up.

/** What `paintGround` uses of a 2D context (a real CanvasRenderingContext2D, or a recorder in tests). */
export type PaintContext = Pick<CanvasRenderingContext2D, 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'fillText'> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

/** The sharpest the floor gets: 8 pixels a centimetre makes a 2 cm tape 16 pixels wide. */
const MAX_PX_PER_CM = 8;

/** The texture's resolution for a ground of `sizeCm`, no side longer than `maxTexturePx` (the renderer's limit). */
export function groundTextureSize([widthCm, depthCm]: readonly [number, number], maxTexturePx: number): { pxPerCm: number; width: number; height: number } {
  const pxPerCm = Math.min(MAX_PX_PER_CM, maxTexturePx / Math.max(widthCm, depthCm));
  return { pxPerCm, width: Math.ceil(widthCm * pxPerCm), height: Math.ceil(depthCm * pxPerCm) };
}

/** The font of a zone's label; the UI's font, loaded before the lab draws (main.tsx). */
const labelFont = (px: number) => `600 ${px}px "Be Vietnam Pro", system-ui, sans-serif`;

/**
 * Paints `arena`'s floor on `ctx`, `pxPerCm` pixels a centimetre, origin at the canvas's top left = the arena's far left corner.
 * `zoneLabel` names a zone on the floor (the learner's words for "start", "target"…), or null to leave it unnamed.
 */
export function paintGround(ctx: PaintContext, arena: Pick<Arena, 'ground' | 'paint'>, options: { pxPerCm: number; zoneLabel: (zone: PaintZone) => string | null }): void {
  const { pxPerCm } = options;
  const [widthCm, depthCm] = arena.ground.sizeCm;
  const px = (xCm: number) => xCm * pxPerCm;
  const py = (yCm: number) => (depthCm - yCm) * pxPerCm;
  const trace = (points: readonly PointCm[]) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(px(x), py(y)) : ctx.lineTo(px(x), py(y))));
  };

  ctx.fillStyle = arena.ground.color;
  ctx.fillRect(0, 0, px(widthCm), depthCm * pxPerCm);

  for (const zone of arena.paint.zones) {
    ctx.fillStyle = zone.color;
    trace(zone.polygonCm);
    ctx.closePath();
    ctx.fill('evenodd');
    const label = options.zoneLabel(zone);
    if (label !== null) {
      const xs = zone.polygonCm.map(([x]) => x);
      const ys = zone.polygonCm.map(([, y]) => y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const size = Math.round(Math.max(10, Math.min(48, Math.min(maxX - minX, maxY - minY) * pxPerCm * 0.2)));
      ctx.fillStyle = robot3dColors.zoneLabel;
      ctx.font = labelFont(size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px((minX + maxX) / 2), py((minY + maxY) / 2));
    }
  }

  paintTape(ctx, arena, pxPerCm);
}

/**
 * Paints `arena`'s tape alone, as paintGround does last (round ends and joins, each line its width), in `colour`: the 3D view paints the
 * mat's own decorations under it (N18 R4.7), and the tape's gloss into the mat's roughness map with the same strokes.
 */
export function paintTape(ctx: PaintContext, arena: Pick<Arena, 'ground' | 'paint'>, pxPerCm: number, colour: string = robot3dColors.tape): void {
  if (arena.paint.lines.length === 0) return;
  const depthCm = arena.ground.sizeCm[1];
  ctx.strokeStyle = colour;
  for (const line of arena.paint.lines) {
    ctx.lineWidth = line.widthCm * pxPerCm;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    line.pointsCm.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * pxPerCm, (depthCm - y) * pxPerCm) : ctx.lineTo(x * pxPerCm, (depthCm - y) * pxPerCm)));
    ctx.stroke();
  }
}
