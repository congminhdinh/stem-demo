import type { BodyColorName } from '../../core/world/arena/body-colors';

// The marks that tell the palette's colours apart for a learner who cannot (N19 E1, as the foam cube's top face has them, E7): red is
// striped across, green is a grid, blue is dotted with large dots, yellow has none (it is the one that needs no help: it is the light one).
// The HUD's swatch of the held object draws them; the words ("khối đỏ") say the colour as well, so the mark is never the only cue.

export type BodyMark = 'stripes' | 'grid' | 'dots';

export const bodyMarks: Readonly<Record<BodyColorName, BodyMark | null>> = Object.freeze({ red: 'stripes', green: 'grid', blue: 'dots', yellow: null });
