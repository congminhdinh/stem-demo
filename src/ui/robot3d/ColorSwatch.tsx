import { bodyPalette, type BodyColorName } from '../../core/world/arena/body-colors';
import { bodyMarks, type BodyMark } from './body-marks';

// A swatch of a colour with its colour-blind mark (N19 E1, E2), 16 × 16 units drawn at any size: the HUD's chip of the object the gripper holds
// and the ports & pins tab's colour card draw it. The palette's four colours have their marks (body-marks.ts), the colour sensor's white and
// black are plain, and no colour (an object or a reading the palette has no word for) is an outline with no fill; N19 E8 fix round 1, a
// parcel with no colour has the parcel drawn in it (its board and its tape, as the 3D prop's), not an empty box like a checkbox's.

/** The mark of `mark` over a 16 × 16 swatch: light ink on the colour (red 5.0:1, green 4.1:1, blue 4.6:1 against white). */
function MarkShapes({ mark }: { mark: BodyMark }) {
  const ink = { stroke: '#ffffff', strokeOpacity: 0.92, 'data-mark-part': '' } as const;
  switch (mark) {
    case 'stripes':
      return (
        <>
          {[4.5, 8, 11.5].map((y) => (
            <line key={y} x1={2.5} x2={13.5} y1={y} y2={y} strokeWidth={1.6} {...ink} />
          ))}
        </>
      );
    case 'grid':
      return (
        <>
          {[5.5, 10.5].map((at) => (
            <line key={`v${at}`} x1={at} x2={at} y1={2.5} y2={13.5} strokeWidth={1.3} {...ink} />
          ))}
          {[5.5, 10.5].map((at) => (
            <line key={`h${at}`} x1={2.5} x2={13.5} y1={at} y2={at} strokeWidth={1.3} {...ink} />
          ))}
        </>
      );
    case 'dots':
      return (
        <>
          {[
            [5, 5],
            [11, 5],
            [5, 11],
            [11, 11],
          ].map(([cx, cy]) => (
            <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={1.9} fill="#ffffff" fillOpacity={0.92} data-mark-part="" />
          ))}
        </>
      );
  }
}

/** What a swatch can show: a colour of the palette (with its mark), or (the colour sensor's) plain white or black. */
export type SwatchColor = BodyColorName | 'white' | 'black';

const plainFills = { white: '#ffffff', black: '#212121' } as const;

const swatchColors: ReadonlySet<string> = new Set<SwatchColor>(['red', 'green', 'blue', 'yellow', 'white', 'black']);

/** Whether `name` is a colour a swatch can show (the colour sensor's "unknown" is not: it has no colour to draw). */
export const isSwatchColor = (name: string | null | undefined): name is SwatchColor => name !== null && name !== undefined && swatchColors.has(name);

/** The mark of a swatch's colour: the palette's four have one (yellow none), white and black none. */
const markOf = (color: SwatchColor): BodyMark | null => (color === 'white' || color === 'black' ? null : bodyMarks[color]);

/** N19 E8 fix round 1: the parcel's board and kraft tape (assets-src/robot3d: the board's tint, `parcel_tape`). */
const PARCEL_BOARD = '#c49a68';
const PARCEL_TAPE = '#9a6a35';

/**
 * A swatch of a colour with its mark, `size` px; an outline without a fill for no colour (an object or a reading the palette has no word for),
 * with the parcel drawn in it for a parcel (`noun`, the object's).
 */
export function ColorSwatch({ color, size = 16, noun }: { color: SwatchColor | undefined; size?: number; noun?: string | undefined }) {
  const mark = color === undefined ? null : markOf(color);
  const fill = color === undefined ? 'none' : color === 'white' || color === 'black' ? plainFills[color] : bodyPalette[color];
  return (
    <svg className="color-swatch" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x={1} y={1} width={14} height={14} rx={3} fill={fill} stroke="currentColor" strokeWidth={1} />
      {mark !== null && <MarkShapes mark={mark} />}
      {color === undefined && noun === 'parcel' && (
        <g data-glyph="parcel">
          <path d="M3.5 4.5 h9 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 h-9 a1 1 0 0 1 -1 -1 v-6 a1 1 0 0 1 1 -1 z" fill={PARCEL_BOARD} />
          <path d="M7 4.5 h2 v8 h-2 z" fill={PARCEL_TAPE} />
        </g>
      )}
    </svg>
  );
}

/** The mark a swatch of `color` carries, in a word for the page: stripes, grid, dots or none. */
export const swatchMark = (color: SwatchColor | undefined): BodyMark | 'none' => (color === undefined ? 'none' : (markOf(color) ?? 'none'));
