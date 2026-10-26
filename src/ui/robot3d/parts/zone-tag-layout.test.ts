import { describe, expect, it } from 'vitest';
import { boxOf, boxOfInto, createTagLayout, inPolygon, overlaps, placeTags, TAG_PLACES, tagBox, type ScreenBox, type TagToPlace } from './zone-tag-layout';

// N18 R4.7 fix round 2 (review N1): the zones' tags never cover the robot, its raised flag, the HUD or another tag; the zone the robot
// stands in shows none, nor does "Theo xe" (ZoneTags.tsx hides them all there).

const tag = (x: number, y: number, hidden = false): TagToPlace => ({ anchors: [[x, y], [x, y + 0.1], [x, y - 0.08]], width: 0.2, height: 0.08, hidden });

describe('laying out the zones’ tags (N18 R4.7)', () => {
  it('puts a tag over its line, centred, when nothing is in the way', () => {
    expect(placeTags([tag(0.2, 0.1)], [])).toEqual([{ centerX: 0.5, lift: 0 }]);
    expect(tagBox(tag(0.2, 0.1), TAG_PLACES[0]!)).toEqual({ left: 0.1, right: 0.30000000000000004, bottom: 0.1, top: 0.18 });
  });

  it('moves a tag off the robot (its box with a raised flag): reaching right or left of its line or beside it, higher, lower, else hidden', () => {
    // The robot right over the line's top: every spot there cuts it, the pill beside the line too; one higher clears it.
    const robot: ScreenBox = { left: -0.1, right: 0.5, bottom: 0.05, top: 0.15 };
    const [place] = placeTags([tag(0.2, 0.1)], [robot]);
    expect(place).toEqual({ centerX: 0.5, lift: 1 });
    expect(overlaps(tagBox(tag(0.2, 0.1), place!)!, robot)).toBe(false);
    // A robot (and flag) tall enough to cut every spot: no tag.
    expect(placeTags([tag(0.2, 0.1)], [{ left: -0.3, right: 0.7, bottom: -0.1, top: 0.4 }])).toEqual([null]);
    // A spot is tried in a fixed order: there, higher, lower.
    expect(TAG_PLACES.slice(0, 5).map(({ centerX }) => centerX)).toEqual([0.5, 0.1, 0.9, -0.12, 1.12]);
    expect([...new Set(TAG_PLACES.map(({ lift }) => lift))]).toEqual([0, 1, 2]);
  });

  it('keeps a tag clear of the HUD’s corner and of the tags placed before it', () => {
    const hud: ScreenBox = { left: -1, right: -0.1, bottom: 0.3, top: 1 };
    // Centred, it would reach under the HUD's corner: it reaches right of its line instead.
    expect(placeTags([tag(-0.08, 0.4)], [hud])).toEqual([{ centerX: 0.1, lift: 0 }]);
    // Two tags whose centred spots meet: the second goes elsewhere, and the two pills do not overlap.
    const [first, second] = placeTags([tag(0.3, 0), tag(0.35, 0.02)], []);
    expect(first).toEqual({ centerX: 0.5, lift: 0 });
    expect(overlaps(tagBox(tag(0.3, 0), first!)!, tagBox(tag(0.35, 0.02), second!)!)).toBe(false);
  });

  it('hides a tag asked hidden (the robot’s own zone, "Theo xe") and one whose anchor is behind the camera or off the screen', () => {
    expect(placeTags([tag(0, 0, true)], [])).toEqual([null]);
    expect(placeTags([{ anchors: [null, null], width: 0.2, height: 0.08, hidden: false }], [])).toEqual([null]);
    expect(placeTags([tag(1.3, 1.2)], [])).toEqual([null]);
  });

  it('finds the zone the robot stands in, and boxes projected points', () => {
    const zone = [[76, 20], [106, 20], [106, 60], [76, 60]] as const;
    expect(inPolygon([90, 40], zone)).toBe(true);
    expect(inPolygon([70, 40], zone)).toBe(false);
    expect(boxOf([[0.1, 0.2], [-0.3, 0.5], [0.2, -0.1]])).toEqual({ left: -0.3, right: 0.2, bottom: -0.1, top: 0.5 });
    expect(boxOf([])).toBeNull();
  });
});

describe('the zones’ tags from frame to frame (N18 P2)', () => {
  /** The robot's box, 0.07 wide round `x`. */
  const robotAt = (x: number): ScreenBox => ({ left: x - 0.035, right: x + 0.035, bottom: -0.2, top: 0.15 });
  const hud: ScreenBox = { left: -1, right: -0.1, bottom: 0.3, top: 1 };

  it('lays out each frame afresh into the same array, the robot driving past (placeTags is one frame of it; the R4.7 tests above pin the spots)', () => {
    const layout = createTagLayout();
    const tags = [tag(0.2, 0.1), tag(0.3, 0), tag(0.35, 0.02), tag(-0.08, 0.4), tag(0.6, 0.5, true)];
    const first = layout.place(tags, [hud]);
    for (let x = -0.9; x <= 0.9; x += 0.01) {
      const avoid = [hud, robotAt(x)];
      const placed = layout.place(tags, avoid);
      expect(placed).toBe(first);
      expect([...placed]).toEqual(placeTags(tags, avoid));
    }
    // Fewer tags (a canvas with fewer zones): the answer is as long as the tags.
    expect([...layout.place([tag(0.2, 0.1)], [robotAt(0.13)])]).toEqual([{ centerX: 0.1, lift: 0 }]);
  });

  it('boxes projected points into a box it is given, from a flat list of x, y', () => {
    const into: ScreenBox = { left: 0, right: 0, bottom: 0, top: 0 };
    expect(boxOfInto([0.1, 0.2, -0.3, 0.5, 0.2, -0.1], 3, into)).toBe(true);
    expect(into).toEqual({ left: -0.3, right: 0.2, bottom: -0.1, top: 0.5 });
    expect(boxOfInto([9, 9], 0, into)).toBe(false);
  });
});
