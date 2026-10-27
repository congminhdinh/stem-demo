import { describe, expect, it } from 'vitest';
import { createStageBox, createTagPlace, GRIPPER_TAG_CLEARANCE_PX, GRIPPER_TAG_GAP_PX, gripperTagSides, placeGripperTag, tagBoxAt, tagGapPx, type StageBox } from './top-view-tag-layout';

// N19 E8 (E4/E5 review M4, the parked 2D nit): where the 2D map's two-line tag of the gripper's sensors stands. Stage pixels, y down.

const box = (left: number, top: number, right: number, bottom: number): StageBox => ({ left, top, right, bottom });

describe('the box of a tag whose pointer stands `gap` px from its anchor (Konva Label: the pointer tip at the origin)', () => {
  it('below, above, right and left of the anchor: the pill, its pointer (5 px long up or down, 7 px across) and its outline (1 px)', () => {
    const out = createStageBox();
    const gap = GRIPPER_TAG_GAP_PX;
    expect(tagBoxAt(out, 'below', 100, 50, 60, 30)).toEqual(box(69, 50 + gap - 1, 131, 50 + gap + 36));
    expect(tagBoxAt(out, 'above', 100, 50, 60, 30)).toEqual(box(69, 50 - gap - 36, 131, 50 - gap + 1));
    expect(tagBoxAt(out, 'right', 100, 50, 60, 30)).toEqual(box(100 + gap - 1, 34, 100 + gap + 68, 66));
    expect(tagBoxAt(out, 'left', 100, 50, 60, 30)).toEqual(box(100 - gap - 68, 34, 100 - gap + 1, 66));
    expect(tagBoxAt(out, 'below', 100, 50, 60, 30, 20)).toEqual(box(69, 69, 131, 106));
    // Written in place.
    expect(tagBoxAt(out, 'below', 0, 0, 10, 10)).toBe(out);
  });

  it('stands GRIPPER_TAG_GAP_PX from the anchor, or GRIPPER_TAG_CLEARANCE_PX past the car’s box on that side when that is farther', () => {
    const car = box(40, 30, 104, 70);
    expect(tagGapPx('right', 100, 50, car)).toBe(GRIPPER_TAG_GAP_PX);
    expect(tagGapPx('below', 100, 50, car)).toBe(20 + GRIPPER_TAG_CLEARANCE_PX);
    expect(tagGapPx('above', 100, 50, car)).toBe(20 + GRIPPER_TAG_CLEARANCE_PX);
    expect(tagGapPx('left', 100, 50, car)).toBe(60 + GRIPPER_TAG_CLEARANCE_PX);
    expect(tagGapPx('below', 100, 50, null)).toBe(GRIPPER_TAG_GAP_PX);
  });
});

describe('the sides it tries, from where the car faces on the screen', () => {
  it('beyond the jaws first (the nearest of the four to the heading), then the car’s right, its left, then behind', () => {
    // Stage y is down: a car facing +x faces right, one facing +y (up the arena) faces up the screen.
    expect(gripperTagSides(1, 0)).toEqual(['right', 'below', 'above', 'left']);
    expect(gripperTagSides(0, -1)).toEqual(['above', 'right', 'left', 'below']);
    expect(gripperTagSides(-1, 0)).toEqual(['left', 'above', 'below', 'right']);
    expect(gripperTagSides(0, 1)).toEqual(['below', 'left', 'right', 'above']);
    // A heading between two: the nearer wins (a tie goes to across).
    expect(gripperTagSides(0.8, 0.6)[0]).toBe('right');
    expect(gripperTagSides(0.6, 0.8)[0]).toBe('below');
    expect(gripperTagSides(Math.SQRT1_2, -Math.SQRT1_2)[0]).toBe('right');
  });
});

describe('placeGripperTag', () => {
  const stage = { width: 600, height: 400 };
  const place = (anchor: [number, number], heading: [number, number], avoid: StageBox[]) => {
    const [out, chosen] = [createStageBox(), createTagPlace()];
    placeGripperTag(out, chosen, anchor[0], anchor[1], 60, 30, heading[0], heading[1], avoid, avoid.length, stage);
    return { ...chosen, box: { ...out } };
  };

  it('stands beyond the jaws when nothing is there', () => {
    expect(place([300, 200], [0, 1], [])).toEqual({ side: 'below', tipX: 0, tipY: GRIPPER_TAG_GAP_PX, clear: true, box: box(269, 211, 331, 248) });
  });

  it('keeps off the car and off a distance tag: the car facing down the screen, its ultrasonic tag just beyond the jaws', () => {
    // At 3.7 px a cm: the 15 × 12 cm body and its fingers in a box ending at the tips, the distance tag of an echo 20 cm off (N18's: over
    // the ray's end, half its width to the left of it) where the tag below the tips would be. Beside the jaws on the car's right (the
    // screen's left) the tag would stand past the car's box, 25 px from the tips, and meet the distance tag; on its left it is clear.
    const car = box(278, 117, 322, 200);
    const distance = box(250, 212, 300, 232);
    expect(place([300, 200], [0, 1], [car, distance])).toEqual({ side: 'right', tipX: 22 + GRIPPER_TAG_CLEARANCE_PX, tipY: 0, clear: true, box: box(324, 184, 393, 216) });
  });

  it('beside the jaws of a car facing right, past its body: the side below stands under the car, not on it', () => {
    const car = box(200, 178, 300, 222);
    const distance = box(330, 160, 400, 190);
    const chosen = place([300, 200], [1, 0], [car, distance]);
    expect(chosen).toMatchObject({ side: 'below', tipX: 0, tipY: 22 + GRIPPER_TAG_CLEARANCE_PX, clear: true });
    expect(chosen.box.top).toBeGreaterThan(car.bottom);
  });

  it('keeps inside the map: at its right edge the tag goes another way', () => {
    expect(place([560, 200], [1, 0], [])).toMatchObject({ side: 'below', clear: true });
    expect(place([590, 200], [1, 0], [])).toMatchObject({ side: 'left', clear: true });
  });

  it('with no clear side, takes the first (beyond the jaws), GRIPPER_TAG_GAP_PX from them, and says so', () => {
    const everywhere = box(0, 0, 600, 400);
    expect(place([300, 200], [0, -1], [everywhere])).toEqual({ side: 'above', tipX: 0, tipY: -GRIPPER_TAG_GAP_PX, clear: false, box: box(269, 152, 331, 189) });
  });

  it('reads only the first `avoidCount` boxes, and writes into what it is given', () => {
    const [out, chosen] = [createStageBox(), createTagPlace()];
    const avoid = [box(300, 200, 600, 400), box(0, 0, 600, 400)];
    placeGripperTag(out, chosen, 300, 200, 60, 30, 1, 0, avoid, 1, stage);
    expect(chosen).toEqual({ side: 'above', tipX: 0, tipY: -GRIPPER_TAG_GAP_PX, clear: true });
    expect(out).toEqual(box(269, 152, 331, 189));
  });
});
