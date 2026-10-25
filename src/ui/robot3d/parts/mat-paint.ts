import type { Scenario } from '../../../core/scenario/scenario';
import type { Arena, PaintZone } from '../../../core/world/arena/arena-schema';
import { paintGround, paintTape, type PaintContext } from '../ground-paint';
import { wallBox } from '../scene-math';

// The mat of the 3D view (N18 R4.7): the scenario's vector paint exactly as the line sensors read it (ground-paint.ts: the ground's
// colour, the zones, the black tape on top), and on the zones, under the tape, a thin printed border in a darker shade of each zone's
// colour (dashed round the start). The zones' names and the checkpoints' numbers are not printed (fix round 1): they float over the
// zones as the view's tags (zone-tags.ts), readable from any camera. Two more maps are painted from the same data: the roughness (the
// tape as matte as the paper) and the baked contact shading under the walls and the fixed bodies. Nothing dark is printed that the
// sensors do not read as the zone it is on: the borders are shades of the zone's own colour with a luma above the line sensor's dark
// threshold (0.5), never black; the same goes for the zones' patterns (zone-pattern.ts, N18 R8).

export type MatLabels = {
  /** A zone's name (the learner's words), or null to leave it unnamed. */
  zoneLabel(zone: PaintZone): string | null;
};

/** Checkpoint zones numbered by the order the scenario's routes visit them (then by their place in the paint). */
export function checkpointNumbers(scenario: Pick<Scenario, 'arena' | 'goals'>): Map<string, number> {
  const checkpoints = scenario.arena.paint.zones.filter((zone) => zone.kind === 'checkpoint').map((zone) => zone.id);
  const order: string[] = [];
  const routes = scenario.goals.flatMap((goal) => (goal.kind === 'checkpoints-in-order' ? [goal.zones] : [])).sort((a, b) => b.length - a.length);
  for (const route of routes) for (const id of route) if (checkpoints.includes(id) && !order.includes(id)) order.push(id);
  for (const id of checkpoints) if (!order.includes(id)) order.push(id);
  return new Map(order.map((id, i) => [id, i + 1]));
}

const hex = (colour: string): [number, number, number] => {
  const value = Number.parseInt(colour.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
/** A zone's colour, darkened by `k` (0 the colour, 1 black). */
const shade = (colour: string, k: number, alpha = 1) => {
  const [r, g, b] = hex(colour).map((c) => Math.round(c * (1 - k)));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type Box = { minX: number; maxX: number; minY: number; maxY: number };
const boundsOf = (zone: PaintZone): Box => {
  const xs = zone.polygonCm.map(([x]) => x);
  const ys = zone.polygonCm.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/** Paints the mat: the sensors' paint, then each zone's border, then the tape over everything. */
export function paintMat(ctx: PaintContext & Pick<CanvasRenderingContext2D, 'setLineDash'>, scenario: Pick<Scenario, 'arena' | 'goals'>, options: { pxPerCm: number }): void {
  const { arena } = scenario;
  const { pxPerCm } = options;
  const depthCm = arena.ground.sizeCm[1];
  const px = (x: number) => x * pxPerCm;
  const py = (y: number) => (depthCm - y) * pxPerCm;
  // N18 R8: each zone's pattern (dots, hatching) over its fill, in a light shade of the zone's own colour, under the borders and the tape.
  paintGround(ctx, { ground: arena.ground, paint: { zones: arena.paint.zones, lines: [] } }, { pxPerCm, zoneLabel: () => null, patterns: 'mat' });
  for (const zone of arena.paint.zones) {
    const box = boundsOf(zone);
    // A printed border 3 mm wide, 6 mm inside the zone's edge.
    ctx.strokeStyle = shade(zone.color, 0.22);
    ctx.lineWidth = 0.3 * pxPerCm;
    ctx.lineJoin = 'round';
    ctx.setLineDash(zone.kind === 'start' ? [1.6 * pxPerCm, 0.9 * pxPerCm] : []);
    const inset = 0.6;
    ctx.beginPath();
    zone.polygonCm.forEach(([x, y], i) => {
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      const ix = x + Math.sign(cx - x) * inset;
      const iy = y + Math.sign(cy - y) * inset;
      if (i === 0) ctx.moveTo(px(ix), py(iy));
      else ctx.lineTo(px(ix), py(iy));
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  paintTape(ctx, arena, pxPerCm);
}

/** The mat's roughness (green channel): matte paper, and the tape a matte vinyl a shade smoother. */
export function paintMatRoughness(ctx: PaintContext, arena: Pick<Arena, 'ground' | 'paint'>, pxPerCm: number): void {
  const [widthCm, depthCm] = arena.ground.sizeCm;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthCm * pxPerCm, depthCm * pxPerCm);
  paintTape(ctx, arena, pxPerCm, '#d2d2d2');
}

type ShadeContext = PaintContext & Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'translate' | 'rotate' | 'arc'> & { filter: string };

/**
 * The baked contact shading of the mat (an aoMap): white, darker where a wall or a fixed body stands on it and fading over a few
 * centimetres, as an occluded corner looks under soft light. The moving bodies bring their own (a soft shadow under each).
 */
export function paintMatShading(ctx: ShadeContext, arena: Arena, pxPerCm: number): void {
  const [widthCm, depthCm] = arena.ground.sizeCm;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthCm * pxPerCm, depthCm * pxPerCm);
  const px = (x: number) => x * pxPerCm;
  const py = (y: number) => (depthCm - y) * pxPerCm;
  const footprint = (xCm: number, yCm: number, lengthCm: number, widthCm2: number, yawRad: number, spreadCm: number, darkness: number) => {
    ctx.save();
    ctx.filter = `blur(${Math.max(1, spreadCm * pxPerCm * 0.5)}px)`;
    ctx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
    ctx.translate(px(xCm), py(yCm));
    ctx.rotate(-yawRad);
    const grow = spreadCm * 0.6;
    ctx.fillRect(-(lengthCm / 2 + grow) * pxPerCm, -(widthCm2 / 2 + grow) * pxPerCm, (lengthCm + 2 * grow) * pxPerCm, (widthCm2 + 2 * grow) * pxPerCm);
    ctx.restore();
  };
  for (const wall of arena.walls) {
    const { yawRad } = wallBox(wall);
    const [x0, y0] = wall.fromCm;
    const [x1, y1] = wall.toCm;
    footprint((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) + wall.thicknessCm, wall.thicknessCm, yawRad, 4, 0.55);
  }
  for (const box of arena.boxes) {
    if (box.body !== 'fixed') continue;
    footprint(box.centerCm[0], box.centerCm[1], box.sizeCm[0], box.sizeCm[1], (box.yawDeg * Math.PI) / 180, 3, 0.5);
  }
  for (const cylinder of arena.cylinders) {
    if (cylinder.body !== 'fixed') continue;
    ctx.save();
    ctx.filter = `blur(${Math.max(1, 3 * pxPerCm * 0.5)}px)`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(px(cylinder.centerCm[0]), py(cylinder.centerCm[1]), (cylinder.radiusCm + 1.5) * pxPerCm, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
