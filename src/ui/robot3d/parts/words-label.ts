import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { sensorColors as colors } from '../sensor-colors';

// The tag of the gripper's sensors in the 3D view (N19 E5): a white pill over the jaws with a line for each sensor on the carriage ("IR: có
// vật", "Màu: đỏ", the messages' words), in the distance tag's look (distance-label.ts): a sprite that faces the camera and keeps its size on
// the screen, drawn over the scene. Its words change only when a reading does (the IR sees or stops seeing, the colour read changes), and
// it is painted then and only then; every text it can say is made once, by the overlay, so a paint makes no string. A canvas cannot be made
// without a document (a Node test): then there is no tag (`createWordsLabel` returns null) and the rest of the overlay stands.

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const TEXT_PX = 26;
const LINE_PX = 34;
const MARGIN_PX = 6;
const PAD_PX = 14;
/** The canvas is this wide: room for the longest words ("Màu: chưa có số đọc"), measured when painted and never past it. */
const CANVAS_WIDTH_PX = 440;
/** The tag's line height on the screen as a share of the canvas's (the distance tag's, distance-label.ts `LABEL_SCREEN`, for its pill). */
const LINE_SCREEN = 0.036;

export type WordsLabel = {
  sprite: Sprite;
  /** The pill's width and height as shares of the sprite's, as painted last (0 before the first). */
  widthShare: number;
  heightShare: number;
  /** Paints the lines (one or two; null leaves a line out). */
  show(first: string | null, second: string | null): void;
  dispose(): void;
};

export type WordsLabelOptions = { fovDeg: number };

/** A tag of up to two lines for a camera of vertical field of view `fovDeg`; null where a 2D canvas cannot be made. */
export function createWordsLabel(options: WordsLabelOptions): WordsLabel | null {
  if (typeof document === 'undefined') return null;
  const surface = document.createElement('canvas');
  surface.width = CANVAS_WIDTH_PX;
  surface.height = 2 * LINE_PX + PAD_PX + 2 * MARGIN_PX;
  const ctx = surface.getContext('2d');
  if (ctx === null) return null;
  const texture = new CanvasTexture(surface);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ name: 'sensor-label', map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
  const sprite = new Sprite(material);
  sprite.name = 'gripper-sensor-label';
  sprite.renderOrder = 31;
  // The tag stands over its anchor at its bottom middle.
  sprite.center.set(0.5, MARGIN_PX / surface.height);
  const height = LINE_SCREEN * 2 * Math.tan((options.fovDeg * Math.PI) / 360) * (surface.height / LINE_PX);
  sprite.scale.set(height * (surface.width / surface.height), height, 1);
  const label: WordsLabel = {
    sprite,
    widthShare: 0,
    heightShare: 0,
    show(first, second) {
      ctx.font = `600 ${TEXT_PX}px ${FONT}`;
      const rows = (first === null ? 0 : 1) + (second === null ? 0 : 1);
      const widest = Math.max(first === null ? 0 : ctx.measureText(first).width, second === null ? 0 : ctx.measureText(second).width);
      const width = Math.min(surface.width - 2 * MARGIN_PX, Math.ceil(widest) + 2 * PAD_PX);
      const pillHeight = rows * LINE_PX + PAD_PX;
      label.widthShare = width / surface.width;
      label.heightShare = pillHeight / surface.height;
      const left = (surface.width - width) / 2;
      ctx.clearRect(0, 0, surface.width, surface.height);
      if (rows === 0) {
        texture.needsUpdate = true;
        return;
      }
      // The pill from the bottom margin up (the sprite stands on its bottom), as high as its lines.
      const top = surface.height - MARGIN_PX - pillHeight;
      ctx.fillStyle = colors.labelBackground;
      ctx.beginPath();
      ctx.roundRect(left, top, width, pillHeight, 16);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.labelBorder;
      ctx.stroke();
      ctx.fillStyle = colors.labelText;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let y = top + PAD_PX / 2 + LINE_PX / 2;
      for (const line of [first, second]) {
        if (line === null) continue;
        ctx.fillText(line, left + PAD_PX, y + 1, width - 2 * PAD_PX);
        y += LINE_PX;
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
