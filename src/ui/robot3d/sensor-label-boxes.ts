import { overlaps, type ScreenBox } from './parts/zone-tag-layout';

// Where the ultrasonic distance tags stand on the screen (N18 R4.3), and where they may. The tag belongs at the point of the echo; there it
// can fall under what floats over the view (the HUD, the camera's buttons, the view tools, an open results card), as the far wall does in
// "Theo xe". So it slides back along the ray, towards the sensor, and reaches left or right of it, to the first spot that is in the view
// and clear of those; the ray is still the tag's. In stop-at-wall the echo is also on the wall the goal's zone is against, and a "Đích"
// tag over the distance would hide it: the overlay writes the boxes of the tags it shows, in its frame callback (before the zones' tags are
// laid out in the same frame), and the zones' tags (parts/ZoneTags.tsx) keep clear of them. Plain numbers in the view's normalised device
// coordinates (−1..1), tested exactly; the boxes are fixed and rewritten in place, so nothing is made per frame.

/** The most distance tags at once (one for each ultrasonic sensor of a kit; the reference kit has one). */
export const MAX_LABEL_BOXES = 4;

export const labelBoxes: { boxes: ScreenBox[]; count: number } = {
  boxes: Array.from({ length: MAX_LABEL_BOXES }, () => ({ left: 0, right: 0, bottom: 0, top: 0 })),
  count: 0,
};

/** How far along the ray the tag may stand, as shares of the way to the echo, in the order tried: at the echo, then back from it. */
export const LABEL_REACH_SHARES = [1, 0.75, 0.5, 0.25] as const;
/** How much of its pill is left of its anchor, in the order tried: centred, reaching right, reaching left. */
export const LABEL_CENTERS = [0.5, 0.1, 0.9] as const;

/**
 * Writes into `out` the box of a tag's pill whose bottom stands at the NDC point (`x`, `y`) with `centerX` of its width to the left of it:
 * the sprite's scale (`scaleX`, `scaleY`) turned into NDC by the projection's diagonal (`projX` = elements[0], `projY` = elements[5]: a
 * sprite of fixed screen size is as big as its scale times these), the pill as wide as `widthShare` of the sprite and as high as
 * `heightShare` of it.
 */
export function writeLabelBox(out: ScreenBox, x: number, y: number, scaleX: number, scaleY: number, projX: number, projY: number, widthShare: number, heightShare: number, centerX = 0.5): void {
  const width = scaleX * projX * widthShare;
  out.left = x - centerX * width;
  out.right = out.left + width;
  out.bottom = y;
  out.top = y + scaleY * projY * heightShare;
}

/** Whether the box leaves the view or covers one of the first `count` boxes of `avoid`. */
export function labelBlocked(box: ScreenBox, avoid: readonly ScreenBox[], count: number): boolean {
  if (box.left < -1 || box.right > 1 || box.top > 1 || box.bottom < -1) return true;
  for (let i = 0; i < count; i++) {
    if (overlaps(box, avoid[i]!)) return true;
  }
  return false;
}

/** The spot `placeLabel` chose: which of LABEL_REACH_SHARES and which of LABEL_CENTERS, and whether it is clear (else the first, with the overlap). */
export type LabelPlace = { reach: number; center: number; clear: boolean };

/**
 * Chooses the tag's spot: the first of LABEL_REACH_SHARES (an anchor each, `anchors` = x, y pairs, the first `anchorCount` of them; NaN
 * for one behind the camera, which is skipped, and the first, the echo's own, is never NaN) and LABEL_CENTERS where its pill, of `width` × `height` (NDC), is in the view and covers none of the first
 * `avoidCount` boxes of `avoid`. Writes the pill's box into `out` and the choice into `place`. With no clear spot it takes the echo's own
 * (the first anchor, centred) and says so. Makes nothing.
 */
export function placeLabel(out: ScreenBox, place: LabelPlace, anchors: ArrayLike<number>, anchorCount: number, width: number, height: number, avoid: readonly ScreenBox[], avoidCount: number): void {
  for (let a = 0; a < anchorCount; a++) {
    if (Number.isNaN(anchors[2 * a])) continue;
    for (let c = 0; c < LABEL_CENTERS.length; c++) {
      out.left = anchors[2 * a]! - LABEL_CENTERS[c]! * width;
      out.right = out.left + width;
      out.bottom = anchors[2 * a + 1]!;
      out.top = out.bottom + height;
      if (!labelBlocked(out, avoid, avoidCount)) {
        place.reach = a;
        place.center = c;
        place.clear = true;
        return;
      }
    }
  }
  out.left = anchors[0]! - LABEL_CENTERS[0] * width;
  out.right = out.left + width;
  out.bottom = anchors[1]!;
  out.top = out.bottom + height;
  place.reach = 0;
  place.center = 0;
  place.clear = false;
}
