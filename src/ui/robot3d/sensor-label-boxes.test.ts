import { describe, expect, it } from 'vitest';
import type { ScreenBox } from './parts/zone-tag-layout';
import { labelBlocked, labelBoxes, LABEL_CENTERS, LABEL_REACH_SHARES, MAX_LABEL_BOXES, placeLabel, writeLabelBox, type LabelPlace } from './sensor-label-boxes';

// N18 R4.3: the distance tag's pill on the screen, which the zones' tags keep clear of, and the spot the tag takes so that it is in the
// view and clear of what floats over it: at the echo if it can, else back along the ray, reaching right or left.

const box = (): ScreenBox => ({ left: 9, right: 9, bottom: 9, top: 9 });
const place = (): LabelPlace => ({ reach: -1, center: -1, clear: false });

describe('the box of a distance tag on the screen', () => {
  it('is centred over its anchor and stands on it: scale × projection, the pill’s share of the sprite', () => {
    const out = box();
    writeLabelBox(out, 0.2, -0.1, 0.5, 0.25, 0.8, 1.6, 0.75, 0.5);
    expect(out.left).toBeCloseTo(0.2 - (0.5 * 0.8 * 0.75) / 2, 12);
    expect(out.right).toBeCloseTo(0.2 + (0.5 * 0.8 * 0.75) / 2, 12);
    expect(out.bottom).toBe(-0.1);
    expect(out.top).toBeCloseTo(-0.1 + 0.25 * 1.6 * 0.5, 12);
  });

  it('reaches right of its anchor with a small share of its width to the left of it', () => {
    const out = box();
    writeLabelBox(out, 0, 0, 1, 1, 0.5, 0.5, 1, 1, 0.1);
    expect(out.left).toBeCloseTo(-0.05, 12);
    expect(out.right).toBeCloseTo(0.45, 12);
  });

  it('has room for each ultrasonic sensor of a kit, none shown at first, in boxes that are written in place', () => {
    expect(labelBoxes.boxes).toHaveLength(MAX_LABEL_BOXES);
    expect(labelBoxes.count).toBe(0);
    const before = labelBoxes.boxes[0];
    writeLabelBox(labelBoxes.boxes[0]!, 0, 0, 1, 1, 1, 1, 1, 1);
    expect(labelBoxes.boxes[0]).toBe(before);
  });
});

describe('where a tag may stand', () => {
  const hud: ScreenBox = { left: -1, right: -0.2, bottom: 0.6, top: 1 };

  it('is blocked by leaving the view or by covering what floats over it, and by nothing else', () => {
    expect(labelBlocked({ left: 0.1, right: 0.4, bottom: 0.1, top: 0.2 }, [hud], 1)).toBe(false);
    expect(labelBlocked({ left: -0.5, right: -0.3, bottom: 0.7, top: 0.8 }, [hud], 1)).toBe(true);
    expect(labelBlocked({ left: -0.5, right: -0.3, bottom: 0.7, top: 0.8 }, [hud], 0)).toBe(false);
    expect(labelBlocked({ left: 0.8, right: 1.1, bottom: 0, top: 0.1 }, [], 0)).toBe(true);
    expect(labelBlocked({ left: 0, right: 0.1, bottom: 0.9, top: 1.2 }, [], 0)).toBe(true);
    expect(labelBlocked({ left: 0, right: 0.1, bottom: -1.1, top: -0.9 }, [], 0)).toBe(true);
  });

  it('is the echo’s own spot, centred, when nothing is in the way', () => {
    const [out, chosen] = [box(), place()];
    placeLabel(out, chosen, [0.1, 0.5, 0.1, 0.3, 0.1, 0.1, 0.1, -0.1], 4, 0.3, 0.1, [hud], 1);
    expect(chosen).toEqual({ reach: 0, center: 0, clear: true });
    expect(out.left).toBeCloseTo(0.1 - 0.5 * 0.3, 12);
    expect(out.right).toBeCloseTo(0.1 + 0.5 * 0.3, 12);
    expect(out.bottom).toBe(0.5);
    expect(out.top).toBeCloseTo(0.6, 12);
  });

  it('reaches right of its anchor first when the left half would be under the HUD', () => {
    const [out, chosen] = [box(), place()];
    // The anchor at x = −0.25, y = 0.62: centred, its pill (−0.4…−0.1) is under the HUD (x up to −0.2); reaching right (−0.28…0.02) still touches it.
    placeLabel(out, chosen, [-0.25, 0.62, -0.25, 0.4, -0.25, 0.2, -0.25, 0], 4, 0.3, 0.1, [hud], 1);
    // Back along the ray, the anchor (−0.25, 0.4) is below the HUD: the first spot that is clear.
    expect(chosen).toEqual({ reach: 1, center: 0, clear: true });
    expect(out.bottom).toBe(0.4);
  });

  it('slides back along the ray, to the first anchor that is clear, skipping one behind the camera', () => {
    const [out, chosen] = [box(), place()];
    const anchors = [-0.6, 0.8, Number.NaN, Number.NaN, -0.6, 0.45, -0.6, 0.2];
    placeLabel(out, chosen, anchors, 4, 0.3, 0.1, [hud], 1);
    expect(chosen.reach).toBe(2);
    expect(chosen.clear).toBe(true);
    expect(out.bottom).toBe(0.45);
  });

  it('takes the echo’s own spot, and says it is not clear, when every spot is covered', () => {
    const [out, chosen] = [box(), place()];
    const everything: ScreenBox = { left: -1, right: 1, bottom: -1, top: 1 };
    placeLabel(out, chosen, [0, 0, 0, 0, 0, 0, 0, 0], 4, 0.2, 0.1, [everything], 1);
    expect(chosen).toEqual({ reach: 0, center: 0, clear: false });
    expect(out.left).toBeCloseTo(-0.1, 12);
  });

  it('tries every share along the ray and every reach, in the order the overlay uses', () => {
    expect(LABEL_REACH_SHARES).toEqual([1, 0.75, 0.5, 0.25]);
    expect(LABEL_CENTERS).toEqual([0.5, 0.1, 0.9]);
  });
});
