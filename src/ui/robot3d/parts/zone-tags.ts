import type { Scenario } from '../../../core/scenario/scenario';
import type { PaintZone } from '../../../core/world/arena/arena-schema';
import { checkpointNumbers, type MatLabels } from './mat-paint';

// The zones' tags in the 3D view (N18 R4.7 fix round 1): the names of the zones the lesson sends the robot to and the checkpoints'
// numbers float over their zones as labels of the view (a rounded tag that faces the camera, a thin line down to the zone's middle),
// readable from any camera, never printed sideways on the mat. They are no part of the world: nothing collides with them, no sensor
// sees them. The start zone has none (the robot stands on it).

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
    const text = labels.zoneLabel(zone);
    const number = numbers.get(zone.id) ?? null;
    return text === null && number === null ? [] : [{ zoneId: zone.id, text, number, color: zone.color, centerCm: middleOf(zone) }];
  });
}

/** Every text the view writes for `scenario`'s zones: what a brand check reads (no vendor's name may be shown). */
export function zoneTexts(scenario: Pick<Scenario, 'arena' | 'goals'>, labels: MatLabels): string[] {
  return zoneTags(scenario, labels).flatMap((tag) => [...(tag.text === null ? [] : [tag.text]), ...(tag.number === null ? [] : [String(tag.number)])]);
}
