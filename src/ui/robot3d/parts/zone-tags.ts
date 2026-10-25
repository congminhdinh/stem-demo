import type { Scenario } from '../../../core/scenario/scenario';
import type { PaintZone } from '../../../core/world/arena/arena-schema';
import { contrastRatio, parseColor } from '../../a11y/contrast';
import { robot3dColors } from '../colors';
import { checkpointNumbers, type MatLabels } from './mat-paint';

// The zones' tags in the 3D view (N18 R4.7 fix round 1): the names of the zones the lesson sends the robot to and the checkpoints'
// numbers float over their zones as labels of the view (a rounded tag that faces the camera, a thin line down to the zone's middle),
// readable from any camera, never printed sideways on the mat. They are no part of the world: nothing collides with them, no sensor
// sees them. The start zone has none (the robot stands on it). A checkpoint with its number shows the number alone, in a disc (fix
// round 2: "Điểm kiểm tra" four times over cluttered the view); its name goes on one without a number.

export type ZoneTag = {
  zoneId: string;
  /** The zone's name (the learner's words), or null for a number alone. */
  text: string | null;
  /** A checkpoint's place in the route (1, 2, …). */
  number: number | null;
  /** The zone's colour: the tag's dot or disc. */
  color: string;
  /** Where its line meets the mat: the middle of the zone's bounds (arena cm). */
  centerCm: [number, number];
};

const middleOf = (zone: PaintZone): [number, number] => {
  const xs = zone.polygonCm.map(([x]) => x);
  const ys = zone.polygonCm.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/** The tags of `scenario`'s zones: every target and checkpoint that has a name or a number, in the paint's order. */
export function zoneTags(scenario: Pick<Scenario, 'arena' | 'goals'>, labels: MatLabels): ZoneTag[] {
  const numbers = checkpointNumbers(scenario);
  return scenario.arena.paint.zones.flatMap((zone) => {
    if (zone.kind !== 'target' && zone.kind !== 'checkpoint') return [];
    const number = numbers.get(zone.id) ?? null;
    const text = zone.kind === 'checkpoint' && number !== null ? null : labels.zoneLabel(zone);
    return text === null && number === null ? [] : [{ zoneId: zone.id, text, number, color: zone.color, centerCm: middleOf(zone) }];
  });
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
