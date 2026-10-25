import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, LineBasicMaterial, SRGBColorSpace, SpriteMaterial } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import { ZONE_TAG_M } from '../camera-studio';
import { robot3dColors as colors } from '../colors';
import { arenaToThree } from '../scene-math';
import type { MatLabels } from './mat-paint';
import { zoneTags, type ZoneTag } from './zone-tags';

// The zones' tags over the mat (N18 R4.7 fix round 1, zone-tags.ts): each a rounded tag drawn on a canvas (the checkpoint's number in a
// disc of the zone's colour, or a dot of it, and the zone's name), a sprite that faces the camera and keeps its size on the screen, over
// the zone's middle at ZONE_TAG_M, with a thin line down to the mat. They are the view's labels, drawn over the scene (no depth test).

/** The tag's height on the screen as a share of the canvas's, through the camera's field of view (a sprite of fixed size). */
const TAG_SCREEN = 0.062;
/** The canvas a tag is drawn on: its pill's height and the room round it for the shadow, px. */
const PILL_PX = 72;
const MARGIN_PX = 10;
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

const hex = (colour: string): [number, number, number] => {
  const value = Number.parseInt(colour.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const shade = (colour: string, k: number) => `rgb(${hex(colour).map((c) => Math.round(c * (1 - k))).join(', ')})`;

type DrawnTag = { texture: CanvasTexture; aspect: number; centerY: number };

/** Draws `tag` on a canvas: null where a 2D canvas cannot be made. */
function drawTag(tag: ZoneTag): DrawnTag | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const textFont = `600 32px ${FONT}`;
  ctx.font = textFont;
  const textWidth = tag.text === null ? 0 : Math.ceil(ctx.measureText(tag.text).width);
  const badge = tag.number === null ? 18 : 48;
  const pad = tag.text === null ? 12 : 22;
  const pillWidth = pad + badge + (tag.text === null ? 0 : 14 + textWidth) + pad;
  canvas.width = pillWidth + 2 * MARGIN_PX;
  canvas.height = PILL_PX + 2 * MARGIN_PX;
  ctx.shadowColor = colors.tagShadow;
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = colors.tagBackground;
  ctx.beginPath();
  ctx.roundRect(MARGIN_PX, MARGIN_PX, pillWidth, PILL_PX, PILL_PX / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = shade(tag.color, 0.3);
  ctx.stroke();
  const middle = MARGIN_PX + PILL_PX / 2;
  const badgeX = MARGIN_PX + pad + badge / 2;
  ctx.beginPath();
  ctx.arc(badgeX, middle, badge / 2, 0, Math.PI * 2);
  ctx.fillStyle = shade(tag.color, tag.number === null ? 0.18 : 0.42);
  ctx.fill();
  ctx.textBaseline = 'middle';
  if (tag.number !== null) {
    ctx.fillStyle = colors.tagNumber;
    ctx.font = `800 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(tag.number), badgeX, middle + 1);
  }
  if (tag.text !== null) {
    ctx.fillStyle = colors.tagText;
    ctx.font = textFont;
    ctx.textAlign = 'left';
    ctx.fillText(tag.text, MARGIN_PX + pad + badge + 14, middle + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height, centerY: MARGIN_PX / canvas.height };
}

export function ZoneTags({ scenario, labels }: { scenario: Pick<Scenario, 'arena' | 'goals'>; labels: MatLabels }) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const fovDeg = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 40;
  // The tags are drawn again once the app's font is in (a canvas draws in whatever font it has).
  const [fontsIn, setFontsIn] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts?.load(`600 32px ${FONT}`).then(() => live && setFontsIn((count) => count + 1), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  const tags = useMemo(() => {
    void fontsIn;
    return zoneTags(scenario, labels).flatMap((tag) => {
      const drawn = drawTag(tag);
      return drawn ? [{ tag, drawn, material: new SpriteMaterial({ map: drawn.texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }) }] : [];
    });
  }, [scenario, labels, fontsIn]);
  const leaders = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        tags.flatMap(({ tag }) => {
          const [x, , z] = arenaToThree(tag.centerCm[0], tag.centerCm[1], 0);
          return [x, 0.001, z, x, ZONE_TAG_M, z];
        }),
        3,
      ),
    );
    return { geometry, material: new LineBasicMaterial({ color: colors.tagLine, transparent: true, opacity: 0.6, depthWrite: false }) };
  }, [tags]);
  useEffect(() => {
    invalidate();
    return () => {
      for (const { drawn, material } of tags) {
        drawn.texture.dispose();
        material.dispose();
      }
    };
  }, [tags, invalidate]);
  useEffect(
    () => () => {
      leaders.geometry.dispose();
      leaders.material.dispose();
    },
    [leaders],
  );
  // The pill TAG_SCREEN of the canvas high (the sprite has the shadow's margin round it).
  const height = TAG_SCREEN * 2 * Math.tan((fovDeg * Math.PI) / 360) * ((PILL_PX + 2 * MARGIN_PX) / PILL_PX);
  return (
    <group name="zone-tags">
      <lineSegments geometry={leaders.geometry} material={leaders.material} renderOrder={29} />
      {tags.map(({ tag, drawn, material }) => {
        const [x, , z] = arenaToThree(tag.centerCm[0], tag.centerCm[1], 0);
        return <sprite key={tag.zoneId} material={material} position={[x, ZONE_TAG_M, z]} center={[0.5, drawn.centerY]} scale={[height * drawn.aspect, height, 1]} renderOrder={30} />;
      })}
    </group>
  );
}
