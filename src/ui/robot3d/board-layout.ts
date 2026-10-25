import type { HubMap, PinReading, PinView } from './pin-map';

// The drawing of the generic UNO-compatible board on the "Cổng & chân" tab (N18 R4.5): where each pad, and the name of the part on it, is
// in a drawing of 500 × 312 units. Our own artwork, like the 3D robot: a board with the digital header along the top (D13 at the left to
// D0 at the right, with the gap after D8 that a real header has) and the analog header along the bottom right; no logo, no wordmark.
// The part names stand outside the board, rotated, so that a pin's name never sits on a neighbour's: above the top header, below the
// bottom one.

export type PadPlace = {
  id: string;
  x: number;
  y: number;
  side: 'top' | 'bottom';
  /** Where the pin's own name (`D5`) is written, inside the board. */
  name: { x: number; y: number };
  /** Where the name of the part on the pin starts, outside the board; the text is turned by `rotate` degrees about this point. */
  label: { x: number; y: number; rotate: -90 | 90 };
};

export type BoardLayout = {
  width: number;
  height: number;
  body: { x: number; y: number; width: number; height: number };
  /** The distance between two pads, and the extra distance between D8 and D7. */
  pitch: number;
  gap: number;
  padRadius: number;
  /** The room above and below the board for the part names. */
  labelRoom: number;
  pads: PadPlace[];
};

const WIDTH = 500;
const BODY = { x: 14, y: 112, width: 472, height: 92 } as const;
const PITCH = 28;
const GAP = 14;
const PAD_RADIUS = 8;
const LABEL_ROOM = 108;
/** The centre of the rightmost pad: D0 and A5. */
const RIGHT = 468;
const TOP_Y = BODY.y + 16;
const BOTTOM_Y = BODY.y + BODY.height - 16;
/** Where a pin's own name stands, from its pad's centre: under a top pad, over a bottom one (the baseline of the text). */
const NAME_BELOW = 21;
const NAME_ABOVE = 13;
const LABEL_OFFSET = 6;
/** D13…D8 are six pads; the gap follows them. */
const FIRST_GROUP = 6;

export function boardLayout(map: HubMap): BoardLayout {
  const ids = new Set(map.board.map((pin) => pin.id));
  const pads: PadPlace[] = [];
  // Digital: D13 at the left … D0 at the right.
  for (let number = 13, slot = 0; number >= 0; number--, slot++) {
    const id = `D${number}`;
    if (!ids.has(id)) continue;
    const x = RIGHT - (13 - slot) * PITCH - (slot < FIRST_GROUP ? GAP : 0);
    pads.push({
      id,
      x,
      y: TOP_Y,
      side: 'top',
      name: { x, y: TOP_Y + NAME_BELOW },
      label: { x, y: BODY.y - LABEL_OFFSET, rotate: -90 },
    });
  }
  // Analog: A0 at the left … A5 under D0.
  for (let number = 0; number <= 5; number++) {
    const id = `A${number}`;
    if (!ids.has(id)) continue;
    const x = RIGHT - (5 - number) * PITCH;
    pads.push({
      id,
      x,
      y: BOTTOM_Y,
      side: 'bottom',
      name: { x, y: BOTTOM_Y - NAME_ABOVE },
      label: { x, y: BODY.y + BODY.height + LABEL_OFFSET, rotate: 90 },
    });
  }
  return { width: WIDTH, height: BODY.y + BODY.height + LABEL_ROOM, body: { ...BODY }, pitch: PITCH, gap: GAP, padRadius: PAD_RADIUS, labelRoom: LABEL_ROOM, pads };
}

export type PadLook = {
  /** `idle`: the snapshot says nothing of the pin (no run). */
  state: 'idle' | PinReading['kind'];
  /** How lit the pad is, 0 (dark) to 1 (fully lit). */
  glow: number;
  input: boolean;
};

/** The faintest a PWM pad is drawn: a duty of 1 in 255 is still a pad the learner can see is not LOW. */
const MIN_PWM_GLOW = 0.25;

/** How the drawing shows a pin: lit by level, by duty, or by a tone or servo it carries. */
export function padLook(view: PinView | undefined, pwmMax: number): PadLook {
  if (view === undefined) return { state: 'idle', glow: 0, input: false };
  const { reading, input } = view;
  switch (reading.kind) {
    case 'low':
      return { state: 'low', glow: 0, input };
    case 'pwm':
      return { state: 'pwm', glow: Math.round((MIN_PWM_GLOW + (1 - MIN_PWM_GLOW) * (reading.duty / pwmMax)) * 100) / 100, input };
    default:
      return { state: reading.kind, glow: 1, input };
  }
}
