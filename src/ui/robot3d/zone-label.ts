import type { PaintZone } from '../../core/world/arena/arena-schema';
import type { Text } from '../i18n/text';

// What the learner calls a zone on the mat (N18 R4.2, R4.7) and, N19 E5, by its name first: a zone the lesson names (`zones[].name`, the
// pick-and-place lessons' "warehouse", "red"…) is called by that name whatever its kind ("Kho", "Vùng đỏ"); one without a name by its kind
// (the start, the target, a checkpoint; an area has no word). The 2D map paints it over the zone, the fallback floor too, and the 3D view's
// tags float it over the zone (parts/zone-tags.ts). The check's report has its own words for a zone inside a sentence ("vùng xanh dương",
// check-report.ts), lower case: these are labels.

/** The label of `zone` in the learner's words, or null for a zone that has none. */
export function zoneLabelOf(t: Text, zone: Pick<PaintZone, 'kind' | 'name'>): string | null {
  if (zone.name !== undefined) return t(`robot.zone.tag.${zone.name}`);
  switch (zone.kind) {
    case 'start':
      return t('robot.zone.start');
    case 'target':
      return t('robot.zone.target');
    case 'checkpoint':
      return t('robot.zone.checkpoint');
    case 'area':
      return null;
  }
}
