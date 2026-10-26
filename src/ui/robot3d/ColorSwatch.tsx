import { bodyPalette, type BodyColorName } from '../../core/world/arena/body-colors';
import { bodyMarks, type BodyMark } from './body-marks';

// A swatch of a colour with its colour-blind mark (N19 E1, E2), 16 × 16 units drawn at any size: the HUD's chip of the object the gripper holds
// and the ports & pins tab's colour card draw it. The palette's four colours have their marks (body-marks.ts), the colour sensor's white and
// black are plain, and no colour (an object or a reading the palette has no word for) is an outline with no fill.

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

/** A swatch of a colour with its mark, `size` px; an outline without a fill for no colour (an object or a reading the palette has no word for). */
export function ColorSwatch({ color, size = 16 }: { color: SwatchColor | undefined; size?: number }) {
  const mark = color === undefined ? null : markOf(color);
  const fill = color === undefined ? 'none' : color === 'white' || color === 'black' ? plainFills[color] : bodyPalette[color];
  return (
    <svg className="color-swatch" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x={1} y={1} width={14} height={14} rx={3} fill={fill} stroke="currentColor" strokeWidth={1} />
      {mark !== null && <MarkShapes mark={mark} />}
    </svg>
  );
}

/** The mark a swatch of `color` carries, in a word for the page: stripes, grid, dots or none. */
export const swatchMark = (color: SwatchColor | undefined): BodyMark | 'none' => (color === undefined ? 'none' : (markOf(color) ?? 'none'));
