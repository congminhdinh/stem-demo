import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { GLYPH, GLYPH_COUNT } from '../sensor-overlay-math';
import { sensorColors as colors } from '../sensor-colors';

// The ultrasonic distance label of the 3D view (N18 R4.3): a white tag over the point where the echo came from, writing the distance in
// cm with the learner's decimal sign ("23,4 cm"). A sprite that faces the camera and keeps its size on the screen, as the zones' tags do
// (parts/ZoneTags.tsx), so it reads from every camera and shares their shader program.
//
// It costs nothing in a frame: the glyphs (the digits, the decimal sign, a space, "c" and "m") are drawn once on a small atlas, in cells
// of fixed widths (so the tag does not change size with the font), and the tag is painted from them by `drawImage`, with no text and no
// string made, only when the glyphs changed (a new tenth of a cm). A canvas cannot be made without a document (a Node test): then there
// is no label (`createDistanceLabel` returns null) and the rest of the overlay stands.

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
/** The glyphs' font size and the tag's metrics on its canvas, px. */
const GLYPH_PX = 34;
const PILL_PX = 48;
const MARGIN_PX = 6;
const PAD_PX = 14;
/** The tag's height on the screen as a share of the canvas's, through the camera's field of view (a sprite of fixed size). */
export const LABEL_SCREEN = 0.05;

/** The width of each glyph's cell, in the order of the glyph codes (digits 0 to 9, the decimal sign, space, c, m), as shares of GLYPH_PX. */
const CELL_EM = [0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.34, 0.3, 0.56, 0.92] as const;
const CELL_PX = CELL_EM.map((em) => Math.ceil(em * GLYPH_PX));
/** "400,0 cm": five digits' worth of room, the sign, the space, c and m. */
const LONGEST_PX = 5 * CELL_PX[0]! + CELL_PX[GLYPH.separator]! + CELL_PX[GLYPH.space]! + CELL_PX[GLYPH.c]! + CELL_PX[GLYPH.m]!;

/** The pill's height as a share of the sprite's (its canvas's), for the box it covers on the screen. */
export const LABEL_PILL_HEIGHT_SHARE = PILL_PX / (PILL_PX + 2 * MARGIN_PX);

export type DistanceLabel = {
  sprite: Sprite;
  /** The pill's width as a share of the sprite's, as painted last (0 before the first). */
  widthShare: number;
  /** Paints the glyphs (the first `count` of `glyphs`) on the tag. */
  show(glyphs: Int8Array, count: number): void;
  dispose(): void;
};

type Atlas = { canvas: HTMLCanvasElement; x: Float32Array };

/** The glyphs drawn side by side on a canvas, each in its cell. */
function drawAtlas(decimal: string): Atlas | null {
  const canvas = document.createElement('canvas');
  const x = new Float32Array(GLYPH_COUNT);
  let total = 0;
  for (let i = 0; i < GLYPH_COUNT; i++) {
    x[i] = total;
    total += CELL_PX[i]!;
  }
  canvas.width = total;
  canvas.height = GLYPH_PX + 8;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.font = `700 ${GLYPH_PX}px ${FONT}`;
  ctx.fillStyle = colors.labelText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', decimal, ' ', 'c', 'm'].forEach((text, i) => ctx.fillText(text, x[i]! + CELL_PX[i]! / 2, canvas.height / 2 + 1));
  return { canvas, x };
}

/** The label for the learner's decimal sign (',' or '.'), sized for a camera of vertical field of view `fovDeg`; null where a 2D canvas cannot be made. */
export function createDistanceLabel(options: { decimal: string; fovDeg: number }): DistanceLabel | null {
  if (typeof document === 'undefined') return null;
  const surface = document.createElement('canvas');
  surface.width = LONGEST_PX + 2 * PAD_PX + 2 * MARGIN_PX;
  surface.height = PILL_PX + 2 * MARGIN_PX;
  const ctx = surface.getContext('2d');
  if (ctx === null) return null;
  const texture = new CanvasTexture(surface);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ name: 'sensor-label', map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
  const sprite = new Sprite(material);
  sprite.name = 'sensor-label';
  sprite.renderOrder = 31;
  // The tag stands over the echo's point at its bottom middle.
  sprite.center.set(0.5, MARGIN_PX / surface.height);
  const height = LABEL_SCREEN * 2 * Math.tan((options.fovDeg * Math.PI) / 360) * (surface.height / PILL_PX);
  sprite.scale.set(height * (surface.width / surface.height), height, 1);
  // Drawn when first needed: the app's font is in by the first reading.
  let atlas: Atlas | null | undefined;
  const label: DistanceLabel = {
    sprite,
    widthShare: 0,
    show(glyphs, count) {
      atlas ??= drawAtlas(options.decimal);
      if (atlas === null) return;
      let width = 0;
      for (let i = 0; i < count; i++) width += CELL_PX[glyphs[i]!]!;
      const pill = width + 2 * PAD_PX;
      label.widthShare = pill / surface.width;
      const left = (surface.width - pill) / 2;
      ctx.clearRect(0, 0, surface.width, surface.height);
      ctx.fillStyle = colors.labelBackground;
      ctx.beginPath();
      ctx.roundRect(left, MARGIN_PX, pill, PILL_PX, PILL_PX / 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.labelBorder;
      ctx.stroke();
      let at = left + PAD_PX;
      const top = MARGIN_PX + (PILL_PX - atlas.canvas.height) / 2;
      for (let i = 0; i < count; i++) {
        const glyph = glyphs[i]!;
        const cell = CELL_PX[glyph]!;
        ctx.drawImage(atlas.canvas, atlas.x[glyph]!, 0, cell, atlas.canvas.height, at, top, cell, atlas.canvas.height);
        at += cell;
      }
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
  return label;
}
