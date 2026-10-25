// Where the zones' tags go on the screen (N18 R4.7 fix round 2, review N1): a tag never covers what the learner watches. Each frame,
// the view projects every tag's anchor (its line's top over the zone's middle) and the robot's box (with its raised flag) into the
// screen, and places each tag at the first of a few spots (centred over its line, reaching right or left from it, or wholly beside it;
// then the same higher up its line, then lower down it) where its pill overlaps neither the robot, nor what floats over the view (the HUD, the camera buttons, the view
// tools, an open results card), nor a tag placed before it. A tag with no such spot is hidden; so is the tag of the zone the robot is in
// (it stands on it), and every tag in "Theo xe". Plain numbers in the view's normalised device coordinates (−1..1), tested exactly.

export type ScreenBox = { left: number; right: number; bottom: number; top: number };

export const overlaps = (a: ScreenBox, b: ScreenBox) => a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;

/**
 * A spot for a tag: which share of its pill is left of its line (0.5 centred, 0.1 reaching right, −0.12 wholly right of it with a gap),
 * and which of TAG_LIFTS_M its line's top is at.
 */
export type TagPlace = { centerX: number; lift: 0 | 1 | 2 };

/** How far a tag's line's top is from its usual height for each lift (m): there, higher, lower. */
export const TAG_LIFTS_M = [0, 0.07, -0.06] as const;

export const TAG_PLACES: readonly TagPlace[] = ([0, 1, 2] as const).flatMap((lift) => [0.5, 0.1, 0.9, -0.12, 1.12].map((centerX) => ({ centerX, lift })));

/** A tag to place: its anchor on the screen at each lift (null where it is behind the camera), its pill's size, and whether it is hidden. */
export type TagToPlace = { anchors: readonly ((readonly [number, number]) | null)[]; width: number; height: number; hidden: boolean };

/** The pill's box of a tag at `place`. */
export function tagBox(tag: TagToPlace, place: TagPlace): ScreenBox | null {
  const anchor = tag.anchors[place.lift] ?? null;
  if (!anchor) return null;
  const left = anchor[0] - place.centerX * tag.width;
  return { left, right: left + tag.width, bottom: anchor[1], top: anchor[1] + tag.height };
}

/** Each tag's spot, in order: the first that overlaps none of `avoid` nor a tag placed before it; null where it is hidden. */
export function placeTags(tags: readonly TagToPlace[], avoid: readonly ScreenBox[]): (TagPlace | null)[] {
  const taken: ScreenBox[] = [];
  return tags.map((tag) => {
    if (tag.hidden) return null;
    for (const place of TAG_PLACES) {
      const box = tagBox(tag, place);
      if (!box || box.left < -1 || box.right > 1 || box.top > 1) continue;
      if ([...avoid, ...taken].some((other) => overlaps(box, other))) continue;
      taken.push(box);
      return place;
    }
    return null;
  });
}

/** Whether the floor point (arena cm) lies inside the zone's polygon (even-odd rule). */
export function inPolygon(point: readonly [number, number], polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The box round projected points (NDC), or null when there are none. */
export function boxOf(points: readonly (readonly [number, number])[]): ScreenBox | null {
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}
