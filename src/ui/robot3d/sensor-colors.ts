// The colours of the sensor overlays (N18 R4.3), in the 3D view and on the 2D map. They read over the light mat, its black tape and its
// zones, and over the studio's walls: the ultrasonic beam is a sky blue (the 2D map's ray since R4.6), the echo a rose, a line sensor's
// spot a red disc where it reads dark (the lamp's red) and a blue ring where it reads bright, the next goal's zone a stronger shade of its own hue
// (`highlightColor`). The label is a white tag with the beam's blue, like the zones' tags.

import type { ColorName } from '../../core/hardware/drivers';
import { bodyPalette } from '../../core/world/arena/body-colors';

export const sensorColors = {
  /** The ultrasonic beam: its axis ray, the cone's edges and its soft fill. */
  ray: '#0284c7',
  cone: '#38bdf8',
  /** The cone's soft fill on the 2D map (the 3D view's is a material's opacity). */
  coneFill: 'rgba(56, 189, 248, 0.16)',
  /** The dot at the end of the axis ray: the heard distance on the axis (not the point the echo came from: an edge ray may have heard it). */
  hit: '#e11d48',
  /** A line sensor's spot on the mat: a red disc where it reads dark, a blue ring where it reads bright. */
  spotDark: '#ef4444',
  spotLight: '#2563eb',
  /** The distance label: a white tag, the beam's blue round it, dark blue digits. */
  labelBackground: 'rgba(255, 255, 255, 0.96)',
  labelBorder: '#0284c7',
  labelText: '#0c4a6e',
  /** N19 E4/E5: the IR sensor's short beam between the jaws (a fuchsia no other overlay uses), faint until it sees something. */
  ir: '#c026d3',
  /** N19 E4/E5: the dark ring round the colour sensor's spot, so that a white or a yellow reading still shows on the light mat. */
  spotRing: '#0f172a',
} as const;

/**
 * N19 E4/E5: the tint of the colour sensor's spot for the colour its counts read (`shownColor`): the palette's own for its four colours
 * (the cubes' colours, body-colors.ts), white and black for those, and none for "không rõ" (the spot is a ring alone).
 */
export const readingTints: Readonly<Record<ColorName, string | null>> = Object.freeze({
  red: bodyPalette.red,
  green: bodyPalette.green,
  blue: bodyPalette.blue,
  yellow: bodyPalette.yellow,
  white: '#ffffff',
  black: '#212121',
  unknown: null,
});

export type SensorColor = keyof typeof sensorColors;
