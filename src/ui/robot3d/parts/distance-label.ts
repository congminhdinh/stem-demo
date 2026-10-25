import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { GLYPH, GLYPH_COUNT } from '../sensor-overlay-math';
import { sensorColors as colors } from '../sensor-colors';

// The ultrasonic distance label of the 3D view (N18 R4.3): a white tag over the ray, writing the distance in cm with the learner's decimal
// sign ("23,4 cm"), or, with no echo, "không thấy vật" (the messages' words). A sprite that faces the camera and keeps its size on the
// screen, as the zones' tags do (parts/ZoneTags.tsx), so it reads from every camera and shares their shader program.
//
// A number costs nothing but a few `drawImage` calls: its digits and sign are drawn once on a small atlas, in cells of fixed widths (so the
// tag does not change size with the font), and the unit is one more cell (the messages' "cm", not a hard-coded one); no text and no string
// is made. The overlay paints it at most about ten times a second and settles it when the draw loop stops (sensor-overlay.ts). The
// no-echo words are static: painted once, when the echo goes. A canvas cannot be made without a document (a Node test): then there is no
// label (`createDistanceLabel` returns null) and the rest of the overlay stands.

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
/** The glyphs' font size and the tag's metrics on its canvas, px. */
const GLYPH_PX = 34;
const WORDS_PX = 26;
const PILL_PX = 48;
const MARGIN_PX = 6;
const PAD_PX = 14;
/** The tag's height on the screen as a share of the canvas's, through the camera's field of view (a sprite of fixed size). */
export const LABEL_SCREEN = 0.05;
/** The pill's height as a share of the sprite's (its canvas's), for the box it covers on the screen. */
export const LABEL_PILL_HEIGHT_SHARE = PILL_PX / (PILL_PX + 2 * MARGIN_PX);

/** The width of each glyph's cell, as shares of GLYPH_PX: the digits, then the decimal sign. */
const CELL_EM = [0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.34] as const;
const CELL_PX = CELL_EM.map((em) => Math.ceil(em * GLYPH_PX));
/** What the unit's cell is wide per letter, as a share of GLYPH_PX, and the gap before it. */
const UNIT_EM = 0.66;
const UNIT_GAP_EM = 0.5;
const WORDS_EM = 0.6;

export type DistanceLabel = {
  sprite: Sprite;
  /** The pill's width as a share of the sprite's, as painted last (0 before the first). */
  widthShare: number;
  /** Paints the number (the first `count` of `glyphs`) and the unit on the tag. */
  show(glyphs: Int8Array, count: number): void;
  /** Paints the words for no echo on the tag. */
  showNoEcho(): void;
  dispose(): void;
};

export type DistanceLabelOptions = {
  /** The learner's decimal sign. */
  decimal: string;
  /** The unit that follows the number, from the messages ("cm"). */
  unit: string;
  /** The words for no echo, from the messages. */
  noEcho: string;
  /** The camera's vertical field of view, degrees. */
  fovDeg: number;
};

type Atlas = { canvas: HTMLCanvasElement; x: Float32Array; unitX: number; unitWidth: number };

/** The glyphs and the unit drawn side by side on a canvas, each in its cell. */
function drawAtlas(decimal: string, unit: string, unitWidth: number): Atlas | null {
  const canvas = document.createElement('canvas');
  const x = new Float32Array(GLYPH_COUNT);
  let total = 0;
  for (let i = 0; i < GLYPH_COUNT; i++) {
    x[i] = total;
    total += CELL_PX[i]!;
  }
  const unitX = total;
  canvas.width = total + unitWidth;
  canvas.height = GLYPH_PX + 8;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.font = `700 ${GLYPH_PX}px ${FONT}`;
  ctx.fillStyle = colors.labelText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', decimal].forEach((text, i) => ctx.fillText(text, x[i]! + CELL_PX[i]! / 2, canvas.height / 2 + 1));
  // Right-aligned in its cell: the gap is on its left, between the number and the unit.
  ctx.textAlign = 'right';
  ctx.fillText(unit, unitX + unitWidth, canvas.height / 2 + 1);
  return { canvas, x, unitX, unitWidth };
}

/** The label for the learner's decimal sign and words, sized for a camera of vertical field of view `fovDeg`; null where a 2D canvas cannot be made. */
export function createDistanceLabel(options: DistanceLabelOptions): DistanceLabel | null {
  if (typeof document === 'undefined') return null;
  const unitWidth = Math.ceil(UNIT_EM * GLYPH_PX * options.unit.length + UNIT_GAP_EM * GLYPH_PX);
  const wordsWidth = Math.ceil(WORDS_EM * WORDS_PX * options.noEcho.length);
  // "400,0 cm": five digits' worth of room, the sign and the unit; or the words, whichever is longer.
  const longest = Math.max(5 * CELL_PX[0]! + CELL_PX[GLYPH.separator]! + unitWidth, wordsWidth);
  const surface = document.createElement('canvas');
  surface.width = longest + 2 * PAD_PX + 2 * MARGIN_PX;
  surface.height = PILL_PX + 2 * MARGIN_PX;
  const ctx = surface.getContext('2d');
  if (ctx === null) return null;
  const texture = new CanvasTexture(surface);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ name: 'sensor-label', map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
  const sprite = new Sprite(material);
  sprite.name = 'sensor-label';
  sprite.renderOrder = 31;
  // The tag stands over its anchor at its bottom middle.
  sprite.center.set(0.5, MARGIN_PX / surface.height);
  const height = LABEL_SCREEN * 2 * Math.tan((options.fovDeg * Math.PI) / 360) * (surface.height / PILL_PX);
  sprite.scale.set(height * (surface.width / surface.height), height, 1);
  // Drawn when first needed: the app's font is in by the first reading.
  let atlas: Atlas | null | undefined;
  /** The white pill with its border, `inner` px wide inside its padding, centred; returns its left edge. */
  const pill = (inner: number): number => {
    const width = inner + 2 * PAD_PX;
    label.widthShare = width / surface.width;
    const left = (surface.width - width) / 2;
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.fillStyle = colors.labelBackground;
    ctx.beginPath();
    ctx.roundRect(left, MARGIN_PX, width, PILL_PX, PILL_PX / 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = colors.labelBorder;
    ctx.stroke();
    return left;
  };
  const label: DistanceLabel = {
    sprite,
    widthShare: 0,
    show(glyphs, count) {
      atlas ??= drawAtlas(options.decimal, options.unit, unitWidth);
      if (atlas === null) return;
      let width = unitWidth;
      for (let i = 0; i < count; i++) width += CELL_PX[glyphs[i]!]!;
      let at = pill(width) + PAD_PX;
      const top = MARGIN_PX + (PILL_PX - atlas.canvas.height) / 2;
      for (let i = 0; i < count; i++) {
        const glyph = glyphs[i]!;
        const cell = CELL_PX[glyph]!;
        ctx.drawImage(atlas.canvas, atlas.x[glyph]!, 0, cell, atlas.canvas.height, at, top, cell, atlas.canvas.height);
        at += cell;
      }
      ctx.drawImage(atlas.canvas, atlas.unitX, 0, atlas.unitWidth, atlas.canvas.height, at, top, atlas.unitWidth, atlas.canvas.height);
      texture.needsUpdate = true;
    },
    showNoEcho() {
      ctx.font = `600 ${WORDS_PX}px ${FONT}`;
      const width = Math.ceil(ctx.measureText(options.noEcho).width);
      const left = pill(width);
      ctx.fillStyle = colors.labelText;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(options.noEcho, left + PAD_PX, MARGIN_PX + PILL_PX / 2 + 1);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
  return label;
}
