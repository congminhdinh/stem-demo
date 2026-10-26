import { sameColor } from './arena-schema';

// The colours of the bodies a pick-and-place lesson uses (N19 plan §4.4): the one table of them, which the check's report names an object
// by ("khối đỏ") and which the renderer and the colour sensor read. A body's `color` (arena-schema.ts) may be any "#rrggbb"; one of these is
// a colour the learner has a word for.
//
// N19 B3: what the sensors see of a body (sensors/ir.ts, sensors/color.ts): its own colour (authored, or a variant's,
// `variants.objectColors`), or, without one, the colour of its kind, the one the 3D view paints such a body (src/ui/robot3d/colors.ts;
// tests/body-colors-renderer.test.ts holds the two tables together, since core cannot import the UI). The robot's own fingers, which the
// sensors on its carriage could meet, are the rubber of their pads.

export const bodyPalette = {
  red: '#d32f2f',
  green: '#388e3c',
  blue: '#1976d2',
  yellow: '#fbc02d',
} as const;

export type BodyColorName = keyof typeof bodyPalette;

/** The name of a colour of the palette (whatever the case of its hex digits), or undefined for any other colour, or none. */
export function bodyColorName(color: string | undefined): BodyColorName | undefined {
  return (Object.keys(bodyPalette) as BodyColorName[]).find((name) => sameColor(bodyPalette[name], color));
}

/** The kinds of body that stand on the floor and have a colour (the ground's is the arena's `ground.color`). */
export type ColoredBodyKind = 'wall' | 'box' | 'cylinder' | 'object';

/** N19 B3: the colour of a body of each kind that has none of its own: the 3D view's (robot3dColors `wall`, `box`, `cylinder`, `object`). */
export const bodyKindColors: Readonly<Record<ColoredBodyKind, string>> = Object.freeze({
  wall: '#b8c4d4',
  box: '#d9a066',
  cylinder: '#e07a5f',
  object: '#f2c14e',
});

/** N19 B3: the colour of the gripper's fingers where they face each other, the rubber of their pads (robot3dColors `gripperPad`, N19 E6). */
export const GRIPPER_FINGER_COLOR = '#2b2e33';

/** N19 B3: what the sensors see of a body: its own colour, or its kind's. */
export function bodyColor(kind: ColoredBodyKind, color: string | undefined): string {
  return color ?? bodyKindColors[kind];
}

/** N19 B3: the sRGB components of "#rrggbb" (arena-schema.ts `colorSchema`), 0..255 each. */
export function rgbOf(color: string): { readonly r: number; readonly g: number; readonly b: number } {
  const rgb = Number.parseInt(color.slice(1), 16);
  return { r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff };
}
