// Where the 2D map's two-line tag of the gripper's sensors stands ("IR: có vật" / "Màu: đỏ", TopViewSensors.tsx), N19 E8 (E4/E5 review M4):
// by the jaws' tips, on the first side of four where it covers neither the car (its body and fingers), nor the ring round what it holds,
// nor a distance tag of the ultrasonic, and stays on the map. The sides are tried beyond the jaws first (the one of the four nearest to
// where the car faces on the screen), then beside them on the car's right and on its left, then behind them; with no clear side, the first.
// On each side the tag stands GRIPPER_TAG_GAP_PX from the tips, or just past the car's box on that side when that is farther (beside the
// jaws, the body is wider than they are), its pointer towards them. The tag is a Konva Label, whose origin is its pointer's tip; the pointer
// is 5 px long up or down (its 7 px base across), 7 px long left or right. Plain numbers in stage pixels (y down), written in place.

/** A box on the stage, px, y down. */
export type StageBox = { left: number; top: number; right: number; bottom: number };

export const createStageBox = (): StageBox => ({ left: 0, top: 0, right: 0, bottom: 0 });

/** N19 E8 fix round 2 (review M1): sets `out` in place. */
export function setStageBox(out: StageBox, left: number, top: number, right: number, bottom: number): void {
  out.left = left;
  out.top = top;
  out.right = right;
  out.bottom = bottom;
}

/** Where the tag stands from the anchor; its pointer points back at it (below: up). */
export type GripperTagSide = 'below' | 'above' | 'right' | 'left';

/** The Konva Tag's pointer direction for each side. */
export const TAG_POINTER_OF: Readonly<Record<GripperTagSide, 'up' | 'down' | 'left' | 'right'>> = Object.freeze({ below: 'up', above: 'down', right: 'left', left: 'right' });

/** How far the pointer's tip stands from the anchor at least, px. */
export const GRIPPER_TAG_GAP_PX = 12;
/** How far past the car's box the tip stands when the car's box is farther than the gap on that side, px. */
export const GRIPPER_TAG_CLEARANCE_PX = 3;
/** The pointer: `width` its base for up and down (its length for left and right), `height` its length for up and down, px (TopViewSensors.tsx). */
export const GRIPPER_TAG_POINTER = { width: 7, height: 5 } as const;
/** The tag's outline is 1.5 px wide: its box reaches this far past the pill and the pointer, px. */
const OUTLINE_PX = 1;

/** The side chosen, how far from the anchor the pointer's tip stands (px, `tipX`, `tipY`), and whether the side is clear (else it is the first). */
export type GripperTagPlace = { side: GripperTagSide; tipX: number; tipY: number; clear: boolean };

export const createTagPlace = (): GripperTagPlace => ({ side: 'below', tipX: 0, tipY: 0, clear: true });

const DIRECTION: Readonly<Record<GripperTagSide, readonly [number, number]>> = { below: [0, 1], above: [0, -1], right: [1, 0], left: [-1, 0] };

/**
 * Writes into `out` the box of the whole tag, its text (`width` × `height` px, as Konva measures it), its pointer and its outline, on
 * `side` of the anchor (`x`, `y`) with its pointer's tip `gap` px from it.
 */
export function tagBoxAt(out: StageBox, side: GripperTagSide, x: number, y: number, width: number, height: number, gap: number = GRIPPER_TAG_GAP_PX): StageBox {
  const [tipX, tipY] = [x + DIRECTION[side][0] * gap, y + DIRECTION[side][1] * gap];
  const { width: base, height: length } = GRIPPER_TAG_POINTER;
  const [halfAcross, halfDown] = [Math.max(width, base) / 2, Math.max(height, base) / 2];
  switch (side) {
    case 'below':
      [out.left, out.right, out.top, out.bottom] = [tipX - halfAcross, tipX + halfAcross, tipY, tipY + length + height];
      break;
    case 'above':
      [out.left, out.right, out.top, out.bottom] = [tipX - halfAcross, tipX + halfAcross, tipY - length - height, tipY];
      break;
    case 'right':
      [out.left, out.right, out.top, out.bottom] = [tipX, tipX + base + width, tipY - halfDown, tipY + halfDown];
      break;
    case 'left':
      [out.left, out.right, out.top, out.bottom] = [tipX - base - width, tipX, tipY - halfDown, tipY + halfDown];
      break;
  }
  out.left -= OUTLINE_PX;
  out.top -= OUTLINE_PX;
  out.right += OUTLINE_PX;
  out.bottom += OUTLINE_PX;
  return out;
}

/** The pointer tip's distance from the anchor (`x`, `y`) on `side`: the gap, or just past `car` on that side when that is farther. */
export function tagGapPx(side: GripperTagSide, x: number, y: number, car: StageBox | null): number {
  if (car === null) return GRIPPER_TAG_GAP_PX;
  const edge = side === 'below' ? car.bottom - y : side === 'above' ? y - car.top : side === 'right' ? car.right - x : x - car.left;
  return Math.max(GRIPPER_TAG_GAP_PX, edge + GRIPPER_TAG_CLEARANCE_PX);
}

const ORDERS: Readonly<Record<GripperTagSide, readonly GripperTagSide[]>> = {
  // Beyond the tips, the car's right, its left, behind (stage y is down: a car facing right has its right side down the screen).
  right: ['right', 'below', 'above', 'left'],
  below: ['below', 'left', 'right', 'above'],
  left: ['left', 'above', 'below', 'right'],
  above: ['above', 'right', 'left', 'below'],
};

/** The sides to try for a car facing (`dx`, `dy`) on the stage (y down): beyond the jaws first. A diagonal goes across (a tie too). */
export function gripperTagSides(dx: number, dy: number): readonly GripperTagSide[] {
  if (Math.abs(dx) >= Math.abs(dy)) return ORDERS[dx >= 0 ? 'right' : 'left'];
  return ORDERS[dy > 0 ? 'below' : 'above'];
}

const meets = (a: StageBox, b: StageBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Chooses the tag's side for a tag `width` × `height` px at the anchor (`x`, `y`: the jaws' tips) of a car facing (`dx`, `dy`): the first of
 * `gripperTagSides` whose box is on the stage and meets none of the first `avoidCount` boxes of `avoid`, of which the first is the car's
 * (none with `avoidCount` 0); with none, the first side GRIPPER_TAG_GAP_PX from the tips. Writes the box into `out` and the choice into
 * `place`. Makes nothing.
 */
export function placeGripperTag(out: StageBox, place: GripperTagPlace, x: number, y: number, width: number, height: number, dx: number, dy: number, avoid: readonly StageBox[], avoidCount: number, stage: { width: number; height: number }): void {
  const sides = gripperTagSides(dx, dy);
  const car = avoidCount > 0 ? avoid[0]! : null;
  for (let s = 0; s < sides.length; s++) {
    const side = sides[s]!;
    const gap = tagGapPx(side, x, y, car);
    tagBoxAt(out, side, x, y, width, height, gap);
    if (out.left < 0 || out.top < 0 || out.right > stage.width || out.bottom > stage.height) continue;
    let clear = true;
    for (let i = 0; i < avoidCount && clear; i++) clear = !meets(out, avoid[i]!);
    if (clear) {
      setPlace(place, side, gap, true);
      return;
    }
  }
  // None clear: beyond the jaws, by them.
  const first = sides[0]!;
  setPlace(place, first, GRIPPER_TAG_GAP_PX, false);
  tagBoxAt(out, first, x, y, width, height, GRIPPER_TAG_GAP_PX);
}

function setPlace(place: GripperTagPlace, side: GripperTagSide, gap: number, clear: boolean): void {
  place.side = side;
  place.tipX = DIRECTION[side][0] * gap;
  place.tipY = DIRECTION[side][1] * gap;
  place.clear = clear;
}
