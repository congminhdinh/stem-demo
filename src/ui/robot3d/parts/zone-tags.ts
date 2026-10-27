import type { Scenario } from '../../../core/scenario/scenario';
import type { PaintZone } from '../../../core/world/arena/arena-schema';
import { bodyColor } from '../../../core/world/arena/body-colors';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { contrastRatio, parseColor } from '../../a11y/contrast';
import type { CameraMode } from '../camera';
import { robot3dColors } from '../colors';
import { dynamicBodyIds } from '../scene-math';
import { outerEdgeIsBottom } from '../zone-label';
import { checkpointNumbers, type MatLabels } from './mat-paint';

// The zones' tags in the 3D view (N18 R4.7 fix round 1): the names of the zones the lesson sends the robot to and the checkpoints'
// numbers float over their zones as labels of the view (a rounded tag that faces the camera, a thin line down to the zone's middle),
// readable from any camera, never printed sideways on the mat. They are no part of the world: nothing collides with them, no sensor
// sees them. The start zone has none (the robot stands on it); N19 E5: a zone the lesson names has its name, whatever its kind. A checkpoint with its number shows the number alone, in a disc (fix
// round 2: "Điểm kiểm tra" four times over cluttered the view); its name goes on one without a number.

export type ZoneTag = {
  zoneId: string;
  /** The zone's name (the learner's words), or null for a number alone. */
  text: string | null;
  /** A checkpoint's place in the route (1, 2, …). */
  number: number | null;
  /** The zone's colour: the tag's dot or disc. */
  color: string;
  /**
   * Where its line meets the mat (arena cm): the middle of the zone's bounds; N19 E8, for a named zone with something standing in it at
   * the start, a spot clear of it (anchorOf).
   */
  centerCm: [number, number];
};

const middleOf = (zone: PaintZone): [number, number] => {
  const xs = zone.polygonCm.map(([x]) => x);
  const ys = zone.polygonCm.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/** N19 E8: how clear of a body's footprint a zone tag's line stands (cm). */
const FOOT_CLEAR_CM = 1;

type Footprint = { x: number; y: number; hx: number; hy: number };

/** N19 E8: what stands on the arena's floor at the start: each body's middle and half extents (cm), axis-aligned round a turned box. */
function footprintsOf(arena: Scenario['arena']): Footprint[] {
  return [...arena.boxes, ...arena.cylinders, ...arena.objects].map((body) => {
    if ('radiusCm' in body) return { x: body.centerCm[0], y: body.centerCm[1], hx: body.radiusCm, hy: body.radiusCm };
    const turn = (body.yawDeg * Math.PI) / 180;
    const [sx, sy] = [body.sizeCm[0] / 2, body.sizeCm[1] / 2];
    return { x: body.centerCm[0], y: body.centerCm[1], hx: Math.abs(sx * Math.cos(turn)) + Math.abs(sy * Math.sin(turn)), hy: Math.abs(sx * Math.sin(turn)) + Math.abs(sy * Math.cos(turn)) };
  });
}

/**
 * N19 E8 fix round 1 (review F4): where a zone's tag has its line down to. A named zone with something standing in it at the start (the
 * pick-and-place lessons put their objects at a zone's middle) has it by its outer edge, as the 2D map paints its name (zone-label.ts
 * `outerEdgeIsBottom`), 15 % of its depth (at least 3 cm) inside and across its middle; by its other edge where that spot is on something
 * too; at its middle where both are. Every other zone's line goes down to its middle (N18, N19 E5).
 */
function anchorOf(zone: PaintZone, arena: Scenario['arena'], bodies: readonly Footprint[]): [number, number] {
  const middle = middleOf(zone);
  if (zone.name === undefined) return middle;
  const ys = zone.polygonCm.map(([, y]) => y);
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const xs = zone.polygonCm.map(([x]) => x);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const within = bodies.filter((body) => body.x >= minX && body.x <= maxX && body.y >= minY && body.y <= maxY);
  if (within.length === 0) return middle;
  const on = ([x, y]: readonly [number, number]) => within.some((body) => Math.abs(x - body.x) < body.hx + FOOT_CLEAR_CM && Math.abs(y - body.y) < body.hy + FOOT_CLEAR_CM);
  const inset = Math.max(3, 0.15 * (maxY - minY));
  const top: [number, number] = [middle[0], maxY - inset];
  const bottom: [number, number] = [middle[0], minY + inset];
  const edges = outerEdgeIsBottom(minY, maxY, arena.ground.sizeCm[1]) ? [bottom, top] : [top, bottom];
  return edges.find((spot) => !on(spot)) ?? middle;
}

/**
 * The tags of `scenario`'s zones: every target and checkpoint that has a name or a number, and (N19 E5) every zone the lesson names
 * (`zones[].name`: "Kho", "Vùng đỏ"), whatever its kind, in the paint's order.
 */
export function zoneTags(scenario: Pick<Scenario, 'arena' | 'goals'>, labels: MatLabels): ZoneTag[] {
  const numbers = checkpointNumbers(scenario);
  const bodies = footprintsOf(scenario.arena);
  return scenario.arena.paint.zones.flatMap((zone) => {
    if (zone.kind !== 'target' && zone.kind !== 'checkpoint' && zone.name === undefined) return [];
    const number = numbers.get(zone.id) ?? null;
    // A numbered checkpoint shows its number alone, unless the lesson names it (N19 E5): then its name too.
    const text = zone.kind === 'checkpoint' && number !== null && zone.name === undefined ? null : labels.zoneLabel(zone);
    return text === null && number === null ? [] : [{ zoneId: zone.id, text, number, color: zone.color, centerCm: anchorOf(zone, scenario.arena, bodies) }];
  });
}

/**
 * N19 E5: a tag over an object a goal names (the learner's name of it, "Khối đỏ", and a dot of its colour), which follows the object and
 * is hidden while the gripper holds it.
 */
export type ObjectTag = {
  objectId: string;
  text: string;
  /** The object's colour (its own, or the 3D view's for an object): the tag's dot. */
  color: string;
  /** Its place among a snapshot's `objects` (scene-math.ts `dynamicBodyIds`). */
  index: number;
  /** Half its height, cm: its tag's line starts at its top. */
  halfHeightCm: number;
};

/** N19 E5: the objects the goals name: the one a pick-and-place goal (or a push) moves or guards, the top and the bottom of a stack. */
export function goalObjectIds(goals: Scenario['goals']): Set<string> {
  const ids = new Set<string>();
  for (const goal of goals) {
    if (goal.kind === 'object-held' || goal.kind === 'object-placed' || goal.kind === 'object-unmoved' || goal.kind === 'object-in-zone') ids.add(goal.object);
    else if (goal.kind === 'object-on-object') {
      ids.add(goal.top);
      ids.add(goal.bottom);
    }
  }
  return ids;
}

/** N19 E5: the tags of the objects `scenario`'s goals name, in the arena's order: those the labels have words for (`objectLabel`). */
export function objectTags(scenario: Pick<Scenario, 'arena' | 'goals'>, labels: MatLabels): ObjectTag[] {
  const objectLabel = labels.objectLabel;
  if (objectLabel === undefined) return [];
  const named = goalObjectIds(scenario.goals);
  const ids = dynamicBodyIds(scenario.arena);
  return scenario.arena.objects.flatMap((object) => {
    const text = named.has(object.id) ? objectLabel(object.id) : null;
    if (text === null) return [];
    const heightCm = object.shape === 'box' ? object.sizeCm[2] : object.heightCm;
    return [{ objectId: object.id, text, color: bodyColor('object', object.color), index: ids.indexOf(object.id), halfHeightCm: heightCm / 2 }];
  });
}

/**
 * N19 E8 fix round 2: each moving body's half extents (cm: along x, along y, up; a turned box's footprint is taken as it stands unturned),
 * three numbers a body, in a snapshot's `objects` order (scene-math.ts `dynamicBodyIds`: the dynamic boxes, the dynamic cylinders, the
 * objects).
 */
export function bodyHalvesOf(arena: Pick<Scenario['arena'], 'boxes' | 'cylinders' | 'objects'>): Float64Array {
  const halves = [
    ...arena.boxes.filter((box) => box.body === 'dynamic').map((box) => [box.sizeCm[0] / 2, box.sizeCm[1] / 2, box.sizeCm[2] / 2]),
    ...arena.cylinders.filter((cylinder) => cylinder.body === 'dynamic').map((cylinder) => [cylinder.radiusCm, cylinder.radiusCm, cylinder.heightCm / 2]),
    ...arena.objects.map((object) => (object.shape === 'box' ? [object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.sizeCm[2] / 2] : [object.radiusCm, object.radiusCm, object.heightCm / 2])),
  ];
  return Float64Array.from(halves.flat());
}

/** N19 E8 fix round 2: how near (cm) a body's bottom is to another's top for it to rest on it. */
const RESTS_ON_CM = 0.5;

/**
 * N19 E8 fix round 2 (review R2): whether another body rests on the one at `index` of `world.objects`: its bottom within RESTS_ON_CM of
 * that one's top and their footprints overlapping (`halves`: bodyHalvesOf). Makes nothing.
 */
export function restedOn(world: RobotSnapshot, index: number, halves: Float64Array): boolean {
  const under = world.objects[index];
  if (under === undefined || 3 * world.objects.length !== halves.length) return false;
  const top = under.pose.zCm + halves[3 * index + 2]!;
  for (let i = 0; i < world.objects.length; i++) {
    if (i === index) continue;
    const over = world.objects[i]!.pose;
    if (Math.abs(over.zCm - halves[3 * i + 2]! - top) > RESTS_ON_CM) continue;
    if (Math.abs(over.xCm - under.pose.xCm) < halves[3 * i]! + halves[3 * index]! && Math.abs(over.yCm - under.pose.yCm) < halves[3 * i + 1]! + halves[3 * index + 1]!) return true;
  }
  return false;
}

/**
 * N19 E5: whether an object's tag is hidden: while the gripper holds its object (the HUD's chip names it then), and in "Theo xe" (N18 R4.7).
 * N19 E8 fix round 2 (review R2): with the bodies' sizes (`halves`), also while another object rests on it (lesson 11's base under the
 * stacked cube: its line would rise out of the cube, and its name label the cube). Makes nothing.
 */
export function objectTagHidden(tag: Pick<ObjectTag, 'objectId' | 'index'>, world: RobotSnapshot, mode: CameraMode, halves?: Float64Array): boolean {
  return mode === 'follow' || world.robot.gripper?.heldId === tag.objectId || (halves !== undefined && restedOn(world, tag.index, halves));
}

/** Every text the view writes for `scenario`'s zones: what a brand check reads (no vendor's name may be shown). */
export function zoneTexts(scenario: Pick<Scenario, 'arena' | 'goals'>, labels: MatLabels): string[] {
  return zoneTags(scenario, labels).flatMap((tag) => [...(tag.text === null ? [] : [tag.text]), ...(tag.number === null ? [] : [String(tag.number)])]);
}

/** A colour darkened by `k` (0 the colour, 1 black), as `rgb(r, g, b)`. */
const darken = (colour: string, k: number): string => {
  const [r, g, b] = parseColor(colour);
  return `rgb(${[r, g, b].map((channel) => Math.round(channel * (1 - k))).join(', ')})`;
};

/** How much the dot of a tag with no number is darkened. */
const DOT_SHADE = 0.18;
/** Where the disc of a number starts being darkened, and by how much more each step until its number has AA contrast. */
const DISC_SHADE = 0.42;
const DISC_STEP = 0.02;

/**
 * The disc (or dot) of a zone's tag, drawn in the zone's own hue so that it says which zone it is. A number is white on its disc (N18
 * R8): the disc is darkened until that has the 4.5:1 text needs, so the pale colours of the lessons' zones (a light yellow checkpoint)
 * and any colour an author picks keep a number that reads. A dot carries no text.
 */
export function tagBadgeColor(zoneColor: string, numbered: boolean): string {
  if (!numbered) return darken(zoneColor, DOT_SHADE);
  let k = DISC_SHADE;
  while (k < 1 && contrastRatio(robot3dColors.tagNumber, darken(zoneColor, k)) < 4.5) k += DISC_STEP;
  return darken(zoneColor, Math.min(1, k));
}
