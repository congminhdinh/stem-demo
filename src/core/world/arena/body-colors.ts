// The colours of the bodies a pick-and-place lesson uses (N19 plan §4.4): the one table of them, which the check's report names an object
// by ("khối đỏ") and which the renderer and the colour sensor read (N19 B3 adds what they need). A body's `color` (arena-schema.ts) may be
// any "#rrggbb"; one of these is a colour the learner has a word for. N19 D3 needs the names only.

export const bodyPalette = {
  red: '#d32f2f',
  green: '#388e3c',
  blue: '#1976d2',
  yellow: '#fbc02d',
} as const;

export type BodyColorName = keyof typeof bodyPalette;

/** The name of a colour of the palette (whatever the case of its hex digits), or undefined for any other colour, or none. */
export function bodyColorName(color: string | undefined): BodyColorName | undefined {
  if (color === undefined) return undefined;
  const hex = color.toLowerCase();
  return (Object.keys(bodyPalette) as BodyColorName[]).find((name) => bodyPalette[name] === hex);
}
