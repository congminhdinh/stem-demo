import type { ArenaBox, ArenaCylinder, ArenaObject, ArenaWall, PaintLine, PaintZone, PointCm, ZoneKind } from '../world/arena/arena-schema';
import { productionKits } from '../hardware/catalog';
import { scenarioKitRef } from './scenario';
import type { Scenario } from './scenario-schema';
import { kitFootprintRadiusCm } from './variants';

// The printable arena (N18 R5.3, robot plan §R5.3): a scenario's arena as SVG text in true physical units, so that a real mat can be made
// for a real robot to drive on, and the pages that print it at home on A4. Pure text in, text out (no DOM, no Node), so it sits in the
// core and is tested like any other builder; scripts/export-arena-mat.mjs renders it to PDF and PNG with the installed Chromium.
//
// The geometry is the scenario's own, read from the validated `Scenario` the sim loads: the tape is `lines` at their exact `widthCm` with
// the round joins and caps that ground-paint.ts samples (a point is on the tape when it is within half the width of a segment), the zones
// are the `zones` polygons painted in their order (the even-odd fill the sensor uses), the floor is `ground`. Nothing is copied or redrawn
// from anything else. What is not paint is drawn as a hatched footprint, because it is an object to put on the mat, not ink: the walls,
// boxes and cylinders of the arena, the objects to push, and where the robot starts (its footprint circle, the middle of its body, its heading).
// N19 D1: the footprint circle is the floor the scenario's kit keeps clear at its start (`kitFootprintRadiusCm`: 11 cm for the rover, more for
// a kit that reaches past its body), and the zone labels and the pose words keep off that circle.
//
// Frame: the arena has x to the right and y away from the viewer, the sheet has y down, so a point (x, y) is drawn at (x, depth − y); the
// viewBox is `0 0 width depth` in centimetres and the root's width and height are the same numbers in `cm`, so 1 SVG unit is 1 cm at 100 %.
//
// The labels are the language of the people who cut and glue the mat (Vietnamese), written on the print: they are not UI strings of the app
// (the app never shows them), which is why they are here and not in src/ui/i18n/messages.ts.
//
// What a real robot's line sensor will see is ink, and a label or an outline is ink too: the zone outlines are a darker shade of the zone's
// own colour and the labels are kept off the tape and the robot's start. The SVG is in groups (`mat-ground`, `mat-zones`, `mat-tape` are the
// paint; `mat-zone-labels`, `mat-obstacles`, `mat-labels`, `mat-start` are marks), so a mat can be printed without the marks by hiding them
// in a vector editor (docs/robot-scenario-authoring.md, "In sa bàn").

/** What a mat is built from: the part of a validated scenario that is on the floor, and its kit (a `Scenario` is one). */
export type MatScenario = Pick<Scenario, 'key' | 'version' | 'title' | 'arena' | 'start' | 'goals' | 'kit'>;

export type ArenaMatOptions = {
  /** N19 D1: the radius of the start ring, centimetres. Left out: the kit's (`matFootprintRadiusCm`). */
  footprintRadiusCm?: number;
};

/**
 * N19 D1: the floor the scenario's kit keeps clear around its start, centimetres: `kitFootprintRadiusCm` of the kit the scenario runs on, at
 * the version a lab launches it at. Throws for a kit the app has no file for, whose reach it cannot know.
 */
export function matFootprintRadiusCm(scenario: Pick<Scenario, 'kit'>): number {
  const ref = scenarioKitRef(scenario);
  const kit = ref === undefined ? undefined : productionKits.get(ref);
  if (kit === undefined) {
    throw new Error(`The robot kit "${scenario.kit}" is not one this app knows: a mat draws the floor its robot needs at the start, which only the kit says.`);
  }
  return kitFootprintRadiusCm(kit);
}

/** The resolution of the PNG, dots per inch (it is the true-scale mat: 1 cm is 59.06 px). */
export const MAT_DPI = 150;
export const CM_PER_INCH = 2.54;
/** A PDF's unit: 72 points to the inch (a point is 0.3528 mm). */
export const POINTS_PER_INCH = 72;
export const POINTS_PER_CM = POINTS_PER_INCH / CM_PER_INCH;
/** The length of the scale bar of the legend, centimetres: what a printed mat is measured against. */
export const SCALE_BAR_CM = 10;
/** A4 portrait, centimetres. */
export const A4_CM = { width: 21, height: 29.7 } as const;
/** The paper kept free around the part of the mat a sheet shows: room for the crop and registration marks, and the legend at the foot. */
export const TILE_MARGIN_CM = { left: 1.2, right: 1.2, top: 1.2, bottom: 1.8 } as const;
/** The part of the mat one A4 sheet shows. */
export const TILE_WINDOW_CM = { width: 18.6, height: 26.7 } as const;
/** How much of the mat two neighbouring sheets both show, so that they can be laid over each other and glued. */
export const TILE_OVERLAP_CM = 1;

/** Printed on the mat and on every sheet. */
export const PRINT_NOTE = 'In 100 %, không co giãn';
const WALL_LABEL = 'tường';
const OBSTACLE_LABEL = 'vật cản';
const PUSH_LABEL = 'vật đẩy';
const START_LABEL = 'xuất phát';
const ROUTE_LABEL = 'điểm kiểm tra';
const ROUTE_SHORT_LABEL = 'điểm';
const zoneKindLabels: Readonly<Record<ZoneKind, string>> = {
  start: 'vùng xuất phát',
  target: 'vùng đích',
  checkpoint: ROUTE_LABEL,
  area: 'vùng',
};

const FONT_FAMILY = "'Be Vietnam Pro', 'Helvetica Neue', Arial, sans-serif";
const INK = '#2b2b2b';
const HALO = '#ffffff';
const TAPE_COLOR = '#000000';
const FOOTPRINT_STROKE = '#555555';
const START_COLOR = '#1a5fb4';
const CUT_COLOR = '#c01c28';
/** The air a label keeps off the tape and the robot, centimetres. */
const LABEL_KEEP_OFF_CM = 0.4;
const EDGE_TOLERANCE_CM = 1e-6;
/** The size of the words that say where the robot starts, centimetres. */
const START_LABEL_SIZE_CM = 1.1;
/** How much darker than its fill a zone's outline is: a shade, not black, so a sensor does not take it for tape. */
const ZONE_OUTLINE_SHADE = 0.8;

/** A number as short text in a stable form: at most four decimals (0.1 mm is far below any print), no exponent, never "-0". */
function fmt(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return String(rounded === 0 ? 0 : rounded);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** `#rrggbb` with every channel scaled by `factor` (< 1: darker). */
function shade(color: string, factor: number): string {
  const rgb = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => Math.round(((rgb >> shift) & 0xff) * factor);
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

/** The pixels of a mat printed at `dpi` (150 for the PNG): its size in inches times the resolution, to the whole pixel. */
export function matPixelSize(widthCm: number, heightCm: number, dpi: number = MAT_DPI): { width: number; height: number } {
  const pixels = (cm: number) => Math.round((cm / CM_PER_INCH) * dpi);
  return { width: pixels(widthCm), height: pixels(heightCm) };
}

/** What a PNG's pHYs chunk says for `dpi`: pixels per metre, to the whole number (150 dpi is 5905.5, 5906). */
export function matPixelsPerMetre(dpi: number = MAT_DPI): number {
  return Math.round(dpi / (CM_PER_INCH / 100));
}

export type ArenaMat = {
  widthCm: number;
  heightCm: number;
  /** A whole SVG document: the mat at 100 %, `width`/`height` in cm, `viewBox` in cm. */
  svg: string;
  /** What the mat needs defined once (the hatch pattern, the clip to the ground), for a document that shows it more than once. */
  defs: string;
  /** The mat as a group `<g id="mat">`, to be drawn in a document whose units are centimetres and whose `defs` are the above. */
  group: string;
};

/** The arena of a scenario as SVG text at true scale. See the top of this file for what is drawn and why. */
export function buildArenaMat(scenario: MatScenario, options: ArenaMatOptions = {}): ArenaMat {
  const { arena } = scenario;
  const footprintCm = options.footprintRadiusCm ?? matFootprintRadiusCm(scenario);
  const [widthCm, heightCm] = arena.ground.sizeCm;
  const y = (value: number) => heightCm - value;
  const sheetPoint = ([px, py]: PointCm) => `${fmt(px)},${fmt(y(py))}`;
  const route = routeOrder(scenario.goals);

  const defs =
    '<pattern id="mat-hatch" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="0.12" height="0.8" fill="#666666"/></pattern>' +
    `<clipPath id="mat-clip"><rect x="0" y="0" width="${fmt(widthCm)}" height="${fmt(heightCm)}"/></clipPath>`;

  const zones = arena.paint.zones.map((zone) => zoneElement(zone, sheetPoint));
  const tape = arena.paint.lines.map((line, i) => tapeElement(line, i, sheetPoint));
  const footprints = [
    ...arena.walls.map((wall, i) => wallFootprint(wall, i, y)),
    ...arena.boxes.map((box, i) => boxFootprint('box', box, i, y)),
    ...arena.cylinders.map((cylinder, i) => cylinderFootprint('cylinder', cylinder, i, y)),
    ...arena.objects.map((object, i) => (object.shape === 'box' ? boxFootprint('object', object, i, y) : cylinderFootprint('object', object, i, y))),
  ];
  // Where a zone's label must not go: on the tape, under the robot standing at the start, or on the words that say how it stands
  const pose = startLabel(scenario.start, widthCm, heightCm, footprintCm);
  const keepOut: KeepOut[] = [
    ...arena.paint.lines.flatMap((line) =>
      line.pointsCm.slice(1).map((b, k): KeepOut => ({ kind: 'segment', from: line.pointsCm[k]!, to: b, radiusCm: line.widthCm / 2 + LABEL_KEEP_OFF_CM })),
    ),
    { kind: 'disc', center: [scenario.start.xCm, scenario.start.yCm], radiusCm: footprintCm + LABEL_KEEP_OFF_CM },
    { kind: 'segment', from: [pose.xCm - pose.widthCm / 2, y(pose.baselineCm)], to: [pose.xCm + pose.widthCm / 2, y(pose.baselineCm)], radiusCm: START_LABEL_SIZE_CM },
  ];
  const zoneLabels = arena.paint.zones.map((zone) => zoneLabel(zone, route.get(zone.id), keepOut, y));
  const labels = [
    ...arena.walls.map((wall, i) => wallLabel(wall, i, y)),
    ...arena.boxes.map((box) => obstacleLabel(box, OBSTACLE_LABEL, y)),
    ...arena.cylinders.map((cylinder) => obstacleLabel(cylinder, OBSTACLE_LABEL, y)),
    ...arena.objects.map((object) => obstacleLabel(object, PUSH_LABEL, y)),
  ];

  const group =
    '<g id="mat" clip-path="url(#mat-clip)">' +
    `<g id="mat-ground"><rect x="0" y="0" width="${fmt(widthCm)}" height="${fmt(heightCm)}" fill="${arena.ground.color}"/></g>` +
    `<g id="mat-zones">${zones.join('')}</g>` +
    // The labels of the zones lie under the tape: nothing is ever drawn over it
    `<g id="mat-zone-labels">${zoneLabels.join('')}</g>` +
    `<g id="mat-tape">${tape.join('')}</g>` +
    `<g id="mat-obstacles">${footprints.join('')}</g>` +
    `<g id="mat-labels">${labels.join('')}</g>` +
    startMarker(scenario.start, heightCm, pose, footprintCm) +
    '</g>';

  const title = `${scenario.title.vi} (${scenario.key}@${scenario.version})`;
  const description = `Sa bàn ${fmt(widthCm)} × ${fmt(heightCm)} cm vẽ đúng tỉ lệ 1 : 1 (1 đơn vị = 1 cm). ${PRINT_NOTE}.`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(widthCm)}cm" height="${fmt(heightCm)}cm" viewBox="0 0 ${fmt(widthCm)} ${fmt(heightCm)}" font-family="${FONT_FAMILY}">` +
    `<title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>` +
    `<defs>${defs}</defs>${group}</svg>\n`;

  return { widthCm, heightCm, svg, defs, group };
}

/** The place of each zone in the route of the scenario's longest `checkpoints-in-order` goal (from 1), when it is in one. */
function routeOrder(goals: MatScenario['goals']): Map<string, number> {
  let longest: readonly string[] = [];
  for (const goal of goals) {
    if (goal.kind === 'checkpoints-in-order' && goal.zones.length > longest.length) longest = goal.zones;
  }
  const order = new Map<string, number>();
  longest.forEach((id, i) => {
    if (!order.has(id)) order.set(id, i + 1);
  });
  return order;
}

function zoneElement(zone: PaintZone, sheetPoint: (point: PointCm) => string): string {
  return (
    `<polygon id="zone-${zone.id}" data-kind="${zone.kind}" points="${zone.polygonCm.map(sheetPoint).join(' ')}" fill="${zone.color}" fill-rule="evenodd" ` +
    `stroke="${shade(zone.color, ZONE_OUTLINE_SHADE)}" stroke-width="0.15" stroke-linejoin="round"/>`
  );
}

/** Tape: a polyline of the exact width with round caps and joins (the shape ground-paint.ts reads); a line of one place twice is a dot. */
function tapeElement(line: PaintLine, index: number, sheetPoint: (point: PointCm) => string): string {
  const [first] = line.pointsCm;
  if (first !== undefined && line.pointsCm.every(([px, py]) => px === first[0] && py === first[1])) {
    const [cx, cy] = sheetPoint(first).split(',');
    return `<circle id="tape-${index}" cx="${cx}" cy="${cy}" r="${fmt(line.widthCm / 2)}" fill="${TAPE_COLOR}"/>`;
  }
  return (
    `<polyline id="tape-${index}" points="${line.pointsCm.map(sheetPoint).join(' ')}" fill="none" stroke="${TAPE_COLOR}" ` +
    `stroke-width="${fmt(line.widthCm)}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** A footprint on the mat: hatched, with a dashed outline, for something that stands on the floor and is not paint. */
const footprintAttributes = 'class="footprint" fill="url(#mat-hatch)" stroke="' + FOOTPRINT_STROKE + '" stroke-width="0.15" stroke-dasharray="0.7 0.35" stroke-linejoin="round"';

function polygonElement(id: string, dataId: string | undefined, corners: readonly PointCm[], y: (value: number) => number): string {
  const points = corners.map(([px, py]) => `${fmt(px)},${fmt(y(py))}`).join(' ');
  const data = dataId === undefined ? '' : ` data-id="${escapeXml(dataId)}"`;
  return `<polygon id="${id}"${data} ${footprintAttributes} points="${points}"/>`;
}

/** A wall: its centre line with a square end of thickness / 2 past each point (the box build-arena.ts makes), as the four corners. */
function wallCorners(wall: ArenaWall): PointCm[] {
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  const length = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  const half = wall.thicknessCm / 2;
  const nx = -uy * half;
  const ny = ux * half;
  const ex = ux * half;
  const ey = uy * half;
  return [
    [x0 - ex + nx, y0 - ey + ny],
    [x1 + ex + nx, y1 + ey + ny],
    [x1 + ex - nx, y1 + ey - ny],
    [x0 - ex - nx, y0 - ey - ny],
  ];
}

function wallFootprint(wall: ArenaWall, index: number, y: (value: number) => number): string {
  return polygonElement(`wall-${index}`, wall.id, wallCorners(wall), y);
}

/** A box of [along x, along y] turned counter-clockwise by its yaw about its centre. */
function boxCorners(box: Pick<ArenaBox, 'centerCm' | 'sizeCm' | 'yawDeg'>): PointCm[] {
  const [cx, cy] = box.centerCm;
  const yaw = (box.yawDeg * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const hx = box.sizeCm[0] / 2;
  const hy = box.sizeCm[1] / 2;
  return ([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const).map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as PointCm);
}

type BoxLike = Pick<ArenaBox, 'centerCm' | 'sizeCm' | 'yawDeg' | 'id'>;
type CylinderLike = Pick<ArenaCylinder, 'centerCm' | 'radiusCm' | 'id'>;

function boxFootprint(kind: 'box' | 'object', box: BoxLike, index: number, y: (value: number) => number): string {
  return polygonElement(`${kind}-${index}`, box.id, boxCorners(box), y);
}

function cylinderFootprint(kind: 'cylinder' | 'object', cylinder: CylinderLike, index: number, y: (value: number) => number): string {
  const [cx, cy] = cylinder.centerCm;
  const data = cylinder.id === undefined ? '' : ` data-id="${escapeXml(cylinder.id)}"`;
  return `<circle id="${kind}-${index}"${data} ${footprintAttributes} cx="${fmt(cx)}" cy="${fmt(y(cy))}" r="${fmt(cylinder.radiusCm)}"/>`;
}

/** Text, with a white halo when it lies over hatching, so that it reads. */
function textElement(text: string, x: number, baseline: number, size: number, extra = '', halo = true): string {
  const outline = halo ? ` stroke="${HALO}" stroke-width="${fmt(size * 0.22)}" paint-order="stroke" stroke-linejoin="round"` : '';
  return `<text x="${fmt(x)}" y="${fmt(baseline)}" font-size="${fmt(size)}" text-anchor="middle" fill="${INK}"${outline}${extra}>${escapeXml(text)}</text>`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The area centroid of a polygon (shoelace); the middle of its bounding box when it has no area. */
function centroid(points: readonly PointCm[]): PointCm {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    const cross = xj * yi - xi * yj;
    area += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (area === 0) {
    const xs = points.map(([px]) => px);
    const ys = points.map(([, py]) => py);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** Something a zone's label keeps off: a stretch of tape (a segment and half its width) or a disc (the robot at its start). */
type KeepOut = { kind: 'segment'; from: PointCm; to: PointCm; radiusCm: number } | { kind: 'disc'; center: PointCm; radiusCm: number };

/** The air between a point and the nearest thing to keep off, centimetres: negative when the point is on it. */
function clearanceAt(px: number, py: number, keepOut: readonly KeepOut[]): number {
  let clearance = Number.POSITIVE_INFINITY;
  for (const item of keepOut) {
    if (item.kind === 'disc') {
      clearance = Math.min(clearance, Math.hypot(px - item.center[0], py - item.center[1]) - item.radiusCm);
      continue;
    }
    const [ax, ay] = item.from;
    const dx = item.to[0] - ax;
    const dy = item.to[1] - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / length2, 0, 1);
    clearance = Math.min(clearance, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - item.radiusCm);
  }
  return clearance;
}

/** Even-odd point in polygon, as ground-paint.ts reads a zone. */
function insidePolygon(points: readonly PointCm[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The air around a label of this size centred on (`px`, `py`): the least clearance (see `clearanceAt`) over points a centimetre apart along its
 * box, so that tape crossing the label between its middle and its ends is found. Negative when something is under the label.
 */
function boxClearance(px: number, py: number, halfWidth: number, halfHeight: number, keepOut: readonly KeepOut[]): number {
  const columns = Math.max(1, Math.ceil((2 * halfWidth) / 1));
  let clearance = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= columns; i++) {
    const x = px - halfWidth + (2 * halfWidth * i) / columns;
    for (const y of [py - halfHeight, py, py + halfHeight]) clearance = Math.min(clearance, clearanceAt(x, y, keepOut));
  }
  return clearance;
}

/**
 * Where the two lines of a zone's label go: the middle of the zone when the label fits there clear of the tape and the robot, else the first
 * place found, going outwards from the middle over a grid of the zone's bounding box (the label's box inside it, and inside the zone),
 * that fits; if none does, the one with the most air around it.
 */
function labelPlace(zone: PaintZone, halfWidth: number, halfHeight: number, keepOut: readonly KeepOut[]): PointCm {
  const middle = centroid(zone.polygonCm);
  const xs = zone.polygonCm.map(([px]) => px);
  const ys = zone.polygonCm.map(([, py]) => py);
  const [minX, maxX] = [Math.min(...xs) + halfWidth, Math.max(...xs) - halfWidth];
  const [minY, maxY] = [Math.min(...ys) + halfHeight, Math.max(...ys) - halfHeight];
  const GRID = 11;
  const others: PointCm[] = [];
  if (minX <= maxX && minY <= maxY) {
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const point: PointCm = [minX + ((maxX - minX) * i) / (GRID - 1), minY + ((maxY - minY) * j) / (GRID - 1)];
        // The whole label inside the zone: its corners too, not only its middle (a corner on the zone's edge, as the grid's outer ones are,
        // counts: 1 µm in from it)
        const inside = [-1, 1].every((sx) =>
          [-1, 1].every((sy) => insidePolygon(zone.polygonCm, point[0] + sx * (halfWidth - EDGE_TOLERANCE_CM), point[1] + sy * (halfHeight - EDGE_TOLERANCE_CM))),
        );
        if (inside) others.push(point);
      }
    }
  }
  // Nearest the middle first, so that among places that fit the label stays central
  others.sort((a, b) => Math.hypot(a[0] - middle[0], a[1] - middle[1]) - Math.hypot(b[0] - middle[0], b[1] - middle[1]));
  let best = middle;
  let bestClearance = boxClearance(middle[0], middle[1], halfWidth, halfHeight, keepOut);
  if (bestClearance >= 0) return middle;
  for (const point of others) {
    const clearance = boxClearance(point[0], point[1], halfWidth, halfHeight, keepOut);
    if (clearance >= 0) return point;
    if (clearance > bestClearance) {
      best = point;
      bestClearance = clearance;
    }
  }
  return best;
}

/** Two lines in a zone: its id, and what it is (a checkpoint says its place in the route). */
function zoneLabel(zone: PaintZone, routePlace: number | undefined, keepOut: readonly KeepOut[], y: (value: number) => number): string {
  const kind =
    zone.kind === 'checkpoint'
      ? routePlace === undefined
        ? ROUTE_LABEL
        : `${ROUTE_LABEL} ${routePlace}`
      : routePlace === undefined
        ? zoneKindLabels[zone.kind]
        : `${zoneKindLabels[zone.kind]} (${ROUTE_SHORT_LABEL} ${routePlace})`;
  const xs = zone.polygonCm.map(([px]) => px);
  const ys = zone.polygonCm.map(([, py]) => py);
  const boxWidth = Math.max(...xs) - Math.min(...xs);
  const boxHeight = Math.max(...ys) - Math.min(...ys);
  // The id at `size`, the kind at 0.6 of it: the biggest size at which both lines fit the zone's bounding box, between 0.6 and 2.4 cm
  const fitting = clamp(Math.min((0.85 * boxWidth) / (0.65 * zone.id.length), (0.85 * boxWidth) / (0.6 * 0.6 * kind.length), boxHeight / 3), 0.6, 2.4);
  // Smaller and smaller until the label is somewhere clear of the tape and the robot (the last, 0.5 cm, goes where it has the most air)
  let layout = labelLayout(zone, kind, fitting, keepOut);
  for (const scale of LABEL_SCALES) {
    layout = labelLayout(zone, kind, Math.max(LABEL_MIN_SIZE_CM, fitting * scale), keepOut);
    if (layout.clear) break;
  }
  const { size, kindSize, height, x: cx, y: cy } = layout;
  const idBaseline = y(cy) - height / 2 + size * 0.8;
  return (
    `<g id="label-zone-${zone.id}" class="zone-label">` +
    textElement(zone.id, cx, idBaseline, size, ' class="zone-id" font-weight="700"', false) +
    textElement(kind, cx, idBaseline + kindSize * 1.3, kindSize, ' class="zone-kind"', false) +
    '</g>'
  );
}

/** The sizes a label is tried at, as a share of the biggest that fits the zone, until it is clear of the tape and the robot. */
const LABEL_SCALES = [1, 0.8, 0.65, 0.5, 0.4];
const LABEL_MIN_SIZE_CM = 0.5;

type LabelLayout = { size: number; kindSize: number; height: number; x: number; y: number; clear: boolean };

/** A zone's label at an id size: where it goes (`labelPlace`), the two sizes, the height of the two lines, and whether it is clear there. */
function labelLayout(zone: PaintZone, kind: string, size: number, keepOut: readonly KeepOut[]): LabelLayout {
  const kindSize = size * 0.6;
  const height = size + 1.3 * kindSize;
  const halfWidth = Math.max(0.65 * size * zone.id.length, 0.6 * kindSize * kind.length) / 2;
  const [x, y] = labelPlace(zone, halfWidth, height / 2, keepOut);
  return { size, kindSize, height, x, y, clear: boxClearance(x, y, halfWidth, height / 2, keepOut) >= 0 };
}

/** The word along a wall, upright to read (the angle in (−90°, 90°]), centred on it. */
function wallLabel(wall: ArenaWall, index: number, y: (value: number) => number): string {
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  let angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  const cx = (x0 + x1) / 2;
  const cy = y((y0 + y1) / 2);
  const size = clamp(wall.thicknessCm * 0.6, 0.8, 1.4);
  const text = wall.id === undefined ? WALL_LABEL : `${WALL_LABEL} · ${wall.id}`;
  // The sheet turns clockwise where the arena turns counter-clockwise
  const turn = angle === 0 ? '' : ` transform="rotate(${fmt(-angle)} ${fmt(cx)} ${fmt(cy)})"`;
  return textElement(text, cx, cy + size * 0.35, size, ` class="wall-label" data-index="${index}"${turn}`);
}

function obstacleLabel(item: BoxLike | CylinderLike | ArenaObject, word: string, y: (value: number) => number): string {
  const [cx, cy] = item.centerCm;
  const smallest = 'radiusCm' in item ? item.radiusCm * 2 : Math.min(item.sizeCm[0], item.sizeCm[1]);
  const size = clamp(smallest / 5, 0.7, 1.4);
  const text = item.id === undefined ? word : `${word} · ${item.id}`;
  return textElement(text, cx, y(cy) + size * 0.35, size, ' class="obstacle-label"');
}

type StartLabel = { text: string; xCm: number; baselineCm: number; widthCm: number };

/** The pose in words, below the robot's ring of `radiusCm` (above it when the ring is too near the bottom edge), kept inside the sheet. */
function startLabel(start: MatScenario['start'], widthCm: number, heightCm: number, radiusCm: number): StartLabel {
  const text = `${START_LABEL} · x ${fmt(start.xCm)}, y ${fmt(start.yCm)} cm · ${fmt(start.yawDeg)}°`;
  const labelWidth = text.length * START_LABEL_SIZE_CM * 0.55;
  const sheetY = heightCm - start.yCm;
  const below = sheetY + radiusCm + 1.8 <= heightCm;
  const half = labelWidth / 2;
  return {
    text,
    xCm: widthCm <= labelWidth ? widthCm / 2 : clamp(start.xCm, half, widthCm - half),
    baselineCm: below ? sheetY + radiusCm + 1.6 : sheetY - radiusCm - 0.8,
    widthCm: labelWidth,
  };
}

/** The ring of `radiusCm` a robot's footprint makes, a cross at the middle of its body and an arrow along its heading, and the pose in words. */
function startMarker(start: MatScenario['start'], heightCm: number, label: StartLabel, radiusCm: number): string {
  const r = radiusCm;
  const cx = start.xCm;
  const cy = heightCm - start.yCm;
  const yaw = (start.yawDeg * Math.PI) / 180;
  const ux = Math.cos(yaw);
  const uy = -Math.sin(yaw);
  const tipX = cx + r * ux;
  const tipY = cy + r * uy;
  // The head of the arrow: 1.6 cm back from the tip, 0.6 cm to each side
  const back = 1.6;
  const wing = 0.6;
  const head = [
    [tipX, tipY],
    [tipX - back * ux + wing * uy, tipY - back * uy - wing * ux],
    [tipX - back * ux - wing * uy, tipY - back * uy + wing * ux],
  ]
    .map(([px, py]) => `${fmt(px!)},${fmt(py!)}`)
    .join(' ');
  return (
    '<g id="mat-start">' +
    `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${START_COLOR}" stroke-width="0.15" stroke-dasharray="0.8 0.5"/>` +
    `<line class="cross" x1="${fmt(cx - 1.5)}" y1="${fmt(cy)}" x2="${fmt(cx + 1.5)}" y2="${fmt(cy)}" stroke="${START_COLOR}" stroke-width="0.12"/>` +
    `<line class="cross" x1="${fmt(cx)}" y1="${fmt(cy - 1.5)}" x2="${fmt(cx)}" y2="${fmt(cy + 1.5)}" stroke="${START_COLOR}" stroke-width="0.12"/>` +
    `<line class="heading" x1="${fmt(cx)}" y1="${fmt(cy)}" x2="${fmt(tipX)}" y2="${fmt(tipY)}" stroke="${START_COLOR}" stroke-width="0.2"/>` +
    `<polygon class="arrowhead" points="${head}" fill="${START_COLOR}"/>` +
    `<text x="${fmt(label.xCm)}" y="${fmt(label.baselineCm)}" font-size="${START_LABEL_SIZE_CM}" text-anchor="middle" fill="${START_COLOR}">${escapeXml(label.text)}</text>` +
    '</g>'
  );
}

// ---- The legend and the sheets of the A4 print ----

/** The title of the legend is cut to this many characters (with "…"): the strip beside the scale bar is 8 cm wide. */
const LEGEND_TITLE_MAX_CHARS = 34;
/** The legend strip: as wide as the foot of a sheet between its crop marks, and as tall as the bottom margin leaves. */
export const LEGEND_WIDTH_CM = 17.8;

function cut(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * The legend of a print, as a group whose top-left corner is at (`xCm`, `yCm`) of a document in centimetres: the scenario's title (Vietnamese),
 * `key@version` and the size of the arena on the left; on the right a scale bar of exactly 10 cm, ticked every centimetre, with the words
 * "In 100 %, không co giãn". Whoever prints the mat holds a ruler to the bar: it is how a print that was shrunk to fit is found out.
 */
export function buildMatLegend(scenario: Pick<MatScenario, 'key' | 'version' | 'title' | 'arena'>, at: { xCm: number; yCm: number }): string {
  const [widthCm, heightCm] = scenario.arena.ground.sizeCm;
  const barX = LEGEND_WIDTH_CM - SCALE_BAR_CM;
  const ticks = Array.from({ length: SCALE_BAR_CM + 1 }, (_, i) => {
    const long = i === 0 || i === SCALE_BAR_CM / 2 || i === SCALE_BAR_CM;
    return `<line class="scale-tick" x1="${fmt(barX + i)}" y1="${long ? 0.05 : 0.2}" x2="${fmt(barX + i)}" y2="0.4" stroke="${INK}" stroke-width="0.05"/>`;
  });
  const small = (text: string, x: number, baseline: number, anchor: 'start' | 'middle' | 'end') =>
    `<text x="${fmt(x)}" y="${fmt(baseline)}" font-size="0.3" text-anchor="${anchor}" fill="${INK}">${escapeXml(text)}</text>`;
  return (
    `<g class="legend" transform="translate(${fmt(at.xCm)} ${fmt(at.yCm)})" font-family="${FONT_FAMILY}">` +
    `<text class="legend-title" x="0" y="0.4" font-size="0.36" font-weight="700" fill="${INK}">${escapeXml(cut(scenario.title.vi, LEGEND_TITLE_MAX_CHARS))}</text>` +
    `<text class="legend-key" x="0" y="0.85" font-size="0.3" fill="${INK}">${escapeXml(`${scenario.key}@${scenario.version}`)}</text>` +
    `<text class="legend-size" x="0" y="1.25" font-size="0.3" fill="${INK}">${escapeXml(`Sa bàn ${fmt(widthCm)} × ${fmt(heightCm)} cm`)}</text>` +
    `<rect class="scale-bar" x="${fmt(barX)}" y="0.4" width="${SCALE_BAR_CM}" height="0.2" fill="${INK}"/>` +
    ticks.join('') +
    small('0', barX, 0.95, 'middle') +
    small('5', barX + SCALE_BAR_CM / 2, 0.95, 'middle') +
    small(`${SCALE_BAR_CM} cm`, barX + SCALE_BAR_CM, 0.95, 'middle') +
    `<text class="legend-note" x="${fmt(LEGEND_WIDTH_CM)}" y="1.3" font-size="0.34" font-weight="700" text-anchor="end" fill="${INK}">${escapeXml(PRINT_NOTE)}</text>` +
    '</g>'
  );
}

export type Tile = {
  /** 0 is the top row of the mat, and 0 the left column. */
  row: number;
  col: number;
  /** The window's top-left corner on the sheet-frame mat (y down from the mat's top edge), centimetres. */
  x0Cm: number;
  y0Cm: number;
};

export type TilePlan = {
  cols: number;
  rows: number;
  tiles: Tile[];
};

/** The windows of A4 pages that cover a mat of this size, `TILE_OVERLAP_CM` of each shared with the next, in reading order from the top left. */
export function planTiles(widthCm: number, heightCm: number): TilePlan {
  const stepX = TILE_WINDOW_CM.width - TILE_OVERLAP_CM;
  const stepY = TILE_WINDOW_CM.height - TILE_OVERLAP_CM;
  // 1e-9 so that a mat exactly as wide as k windows (less their overlaps) does not get one more for float noise
  const count = (size: number, window: number, step: number) => (size <= window ? 1 : Math.ceil((size - window) / step - 1e-9) + 1);
  const cols = count(widthCm, TILE_WINDOW_CM.width, stepX);
  const rows = count(heightCm, TILE_WINDOW_CM.height, stepY);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) tiles.push({ row, col, x0Cm: col * stepX, y0Cm: row * stepY });
  }
  return { cols, rows, tiles };
}

export type TiledSheet = {
  /** A whole HTML document: one A4 portrait page per tile (`@page` sets the size), for Chromium to print to PDF. */
  html: string;
  cols: number;
  rows: number;
  pages: number;
};

export type TiledSheetOptions = ArenaMatOptions & {
  /** CSS that makes the font available (the `@font-face` rules the script embeds), put first in the document's style. */
  fontCss?: string;
};

/**
 * The mat on A4 portrait pages for printing at home. Every page shows one window of the mat at 100 % (1 cm of mat is 1 cm of paper), with the
 * windows overlapping 1 cm; around the window are crop marks at its corners, registration crosses at the corners of the paper (a print that
 * was scaled or shifted does not put them where the page says), the page's row and column, and the legend with its 10 cm bar. Where the
 * window reaches the edge of the arena a dashed line marks it. The mat itself is in the document once and every page draws it.
 */
export function buildTiledSheet(scenario: MatScenario, options: TiledSheetOptions = {}): TiledSheet {
  const mat = buildArenaMat(scenario, options.footprintRadiusCm === undefined ? {} : { footprintRadiusCm: options.footprintRadiusCm });
  const plan = planTiles(mat.widthCm, mat.heightCm);
  const { left, top } = TILE_MARGIN_CM;
  const { width: windowWidth, height: windowHeight } = TILE_WINDOW_CM;
  const right = left + windowWidth;
  const bottom = top + windowHeight;

  const crop = (cx: number, cy: number, sx: number, sy: number) => {
    // An L of two ticks outside the corner (cx, cy), away from the window by (sx, sy) in {-1, 1}, 0.15 cm from the corner and 0.5 cm long
    const gap = 0.15;
    const length = 0.5;
    return `<path class="crop-mark" d="M${fmt(cx + sx * gap)} ${fmt(cy)}H${fmt(cx + sx * (gap + length))}M${fmt(cx)} ${fmt(cy + sy * gap)}V${fmt(cy + sy * (gap + length))}" fill="none" stroke="#000" stroke-width="0.04"/>`;
  };
  const registration = (cx: number, cy: number) =>
    `<g class="registration-mark" fill="none" stroke="#000" stroke-width="0.04"><circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="0.15"/>` +
    `<path d="M${fmt(cx - 0.3)} ${fmt(cy)}H${fmt(cx + 0.3)}M${fmt(cx)} ${fmt(cy - 0.3)}V${fmt(cy + 0.3)}"/></g>`;
  const marks = [
    crop(left, top, -1, -1),
    crop(right, top, 1, -1),
    crop(left, bottom, -1, 1),
    crop(right, bottom, 1, 1),
    registration(0.6, 0.6),
    registration(A4_CM.width - 0.6, 0.6),
    registration(0.6, A4_CM.height - 0.6),
    registration(A4_CM.width - 0.6, A4_CM.height - 0.6),
  ].join('');
  const legend = buildMatLegend(scenario, { xCm: left + 0.4, yCm: bottom + 0.4 });

  const pages = plan.tiles.map((tile) => {
    // The window shows an edge of the arena when it starts at one or reaches the other
    const touchesEdge = tile.x0Cm <= 0 || tile.x0Cm + windowWidth >= mat.widthCm || tile.y0Cm <= 0 || tile.y0Cm + windowHeight >= mat.heightCm;
    const cutLine = touchesEdge
      ? `<rect class="cut-line" x="0" y="0" width="${fmt(mat.widthCm)}" height="${fmt(mat.heightCm)}" fill="none" stroke="${CUT_COLOR}" stroke-width="0.04" stroke-dasharray="0.4 0.25"/>`
      : '';
    const label = `hàng ${tile.row + 1}/${plan.rows} · cột ${tile.col + 1}/${plan.cols}`;
    return (
      '<section class="page">' +
      `<svg class="sheet" xmlns="http://www.w3.org/2000/svg" width="${A4_CM.width}cm" height="${A4_CM.height}cm" viewBox="0 0 ${A4_CM.width} ${A4_CM.height}" font-family="${FONT_FAMILY}">` +
      `<svg class="window" x="${left}" y="${top}" width="${windowWidth}" height="${windowHeight}" viewBox="${fmt(tile.x0Cm)} ${fmt(tile.y0Cm)} ${windowWidth} ${windowHeight}" overflow="hidden">` +
      `<use href="#mat"/>${cutLine}</svg>` +
      marks +
      `<text class="page-label" x="${fmt(left + 0.4)}" y="0.85" font-size="0.4" font-weight="700" fill="${INK}">${escapeXml(label)}</text>` +
      `<text class="page-key" x="${fmt(right - 0.4)}" y="0.85" font-size="0.3" text-anchor="end" fill="${INK}">${escapeXml(`${scenario.key}@${scenario.version}`)}</text>` +
      legend +
      '</svg></section>'
    );
  });

  const title = `${scenario.title.vi} (${scenario.key}@${scenario.version}) — A4, ${plan.cols} × ${plan.rows} trang`;
  const html =
    '<!doctype html><html lang="vi"><head><meta charset="utf-8">' +
    `<title>${escapeXml(title)}</title><style>${options.fontCss ?? ''}\n` +
    `@page { size: ${A4_CM.width}cm ${A4_CM.height}cm; margin: 0; }\n` +
    'html, body { margin: 0; padding: 0; background: #fff; }\n' +
    `.page { width: ${A4_CM.width}cm; height: ${A4_CM.height}cm; overflow: hidden; position: relative; break-after: page; }\n` +
    '.page:last-child { break-after: auto; }\n' +
    'svg { display: block; }\n' +
    '</style></head><body>' +
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${mat.defs}${mat.group}</defs></svg>` +
    pages.join('') +
    '</body></html>\n';

  return { html, cols: plan.cols, rows: plan.rows, pages: plan.tiles.length };
}
