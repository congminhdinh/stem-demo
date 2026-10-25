import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, DataTexture, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, SpriteMaterial, Vector3, type Mesh, type Sprite } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import type { CameraMode } from '../camera';
import { VIEW_SAFE_RECT, ZONE_TAG_M } from '../camera-studio';
import { robot3dColors as colors } from '../colors';
import type { CardEdge, HudCorner, ToolsCorner } from '../hud-corner';
import { arenaToThree } from '../scene-math';
import { labelBoxes } from '../sensor-label-boxes';
import type { MatLabels } from './mat-paint';
import { boxOf, inPolygon, placeTags, TAG_LIFTS_M, TAG_PLACES, type ScreenBox, type TagPlace, type TagToPlace } from './zone-tag-layout';
import { zoneTags, type ZoneTag } from './zone-tags';

// The zones' tags over the mat (N18 R4.7 fix round 1, zone-tags.ts): each a rounded tag drawn on a canvas (a checkpoint's number in a
// disc of the zone's colour, or a target's dot and name), a sprite that faces the camera and keeps its size on the screen, over the
// zone's middle at ZONE_TAG_M, with a thin line down to the mat. They are the view's labels, drawn over the scene (no depth test).
// Fix round 2 (review N1): every frame they are laid out so that none covers the robot, its raised flag, what floats over the view or
// another tag (zone-tag-layout.ts); the zone the robot is in has none shown, and "Theo xe" shows none. The lines are thin quads turned to
// the camera and drawn with the contact shadows' shader (no program of their own); the tags' textures are made once the app's font is
// in, and the tags come one frame after the view's first, so they cost its first frame nothing.

/** The tag's height on the screen as a share of the canvas's, through the camera's field of view (a sprite of fixed size). */
const TAG_SCREEN = 0.062;
/** The canvas a tag is drawn on: its pill's height and the room round it for the shadow, px. */
const PILL_PX = 72;
const MARGIN_PX = 10;
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const TEXT_FONT = `600 32px ${FONT}`;
/** The line's width on the screen (px). */
const LINE_PX = 1.5;

const hex = (colour: string): [number, number, number] => {
  const value = Number.parseInt(colour.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const shade = (colour: string, k: number) => `rgb(${hex(colour).map((c) => Math.round(c * (1 - k))).join(', ')})`;

type DrawnTag = { texture: CanvasTexture; canvasWidth: number; pillWidth: number };

/** Draws `tag` on a canvas: null where a 2D canvas cannot be made. */
function drawTag(tag: ZoneTag): DrawnTag | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.font = TEXT_FONT;
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
    ctx.font = TEXT_FONT;
    ctx.textAlign = 'left';
    ctx.fillText(tag.text, MARGIN_PX + pad + badge + 14, middle + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, canvasWidth: canvas.width, pillWidth };
}

const fontsIn = () => typeof document === 'undefined' || (document.fonts?.check?.(TEXT_FONT) ?? true);

/** The robot's box as the tags keep clear of it (m): half its length and width with the wheels, and its height with a raised flag. */
export type RobotTagBox = { halfLength: number; halfWidth: number; height: number };

type ZoneTagsProps = {
  scenario: Pick<Scenario, 'arena' | 'goals'>;
  labels: MatLabels;
  view: () => RobotSnapshot;
  mode: CameraMode;
  overlays: { hud: HudCorner | null; card: CardEdge | null; tools: ToolsCorner | null };
  robot: RobotTagBox;
};

export function ZoneTags({ scenario, labels, view, mode, overlays, robot }: ZoneTagsProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const fovDeg = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 40;
  // The tags are drawn once the app's font is in (a canvas draws in whatever font it has): at once when it is in already.
  const [fontReady, setFontReady] = useState(fontsIn);
  useEffect(() => {
    if (fontReady) return;
    let live = true;
    void document.fonts?.load(TEXT_FONT).then(() => live && setFontReady(true), () => live && setFontReady(true));
    return () => {
      live = false;
    };
  }, [fontReady]);
  const tags = useMemo(() => {
    void fontReady;
    return zoneTags(scenario, labels).flatMap((tag) => {
      const drawn = drawTag(tag);
      if (!drawn) return [];
      const polygon = scenario.arena.paint.zones.find((zone) => zone.id === tag.zoneId)?.polygonCm ?? [];
      return [{ tag, drawn, polygon, material: new SpriteMaterial({ map: drawn.texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }) }];
    });
  }, [scenario, labels, fontReady]);
  // The lines: a unit quad standing on its bottom edge, with an alpha map that lets all of it through (so it is drawn with the contact
  // shadows' program: MeshBasicMaterial, an alpha map, transparent).
  const line = useMemo(() => {
    const clear = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    clear.needsUpdate = true;
    return {
      clear,
      geometry: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      material: new MeshBasicMaterial({ name: 'tag-line', color: colors.tagLine, alphaMap: clear, transparent: true, opacity: 0.7, depthWrite: false }),
    };
  }, []);
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
      line.clear.dispose();
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  // Read in the frame callback without making it a new one.
  const latest = useRef({ view, mode, overlays, robot });
  useEffect(() => {
    latest.current = { view, mode, overlays, robot };
  });
  const sprites = useRef<(Sprite | null)[]>([]);
  const lines = useRef<(Mesh | null)[]>([]);
  // The pill TAG_SCREEN of the canvas high (the sprite has the shadow's margin round it).
  const spriteHeight = TAG_SCREEN * 2 * Math.tan((fovDeg * Math.PI) / 360) * ((PILL_PX + 2 * MARGIN_PX) / PILL_PX);

  useFrame(() => {
    const { view: now, mode: cameraMode, overlays: over, robot: box } = latest.current;
    const world = now();
    const { xCm, yCm, yawDeg } = world.robot;
    const elements = camera.projectionMatrix.elements;
    const point = new Vector3();
    const project = (x: number, y: number, z: number): [number, number] | null => {
      point.set(x, y, z).project(camera);
      return point.z > 1 || point.z < -1 ? null : [point.x, point.y];
    };
    // The robot's box on the screen, its raised flag in it.
    const [c, s] = [Math.cos((yawDeg * Math.PI) / 180), Math.sin((yawDeg * Math.PI) / 180)];
    const corners: [number, number][] = [];
    for (const dx of [-box.halfLength, box.halfLength]) {
      for (const dy of [-box.halfWidth, box.halfWidth]) {
        const [x, , z] = arenaToThree(xCm + (dx * c - dy * s) * 100, yCm + (dx * s + dy * c) * 100, 0);
        for (const h of [0, box.height]) {
          const at = project(x, h, z);
          if (at) corners.push(at);
        }
      }
    }
    const avoid: ScreenBox[] = [{ left: -1, right: 1, bottom: VIEW_SAFE_RECT.top, top: 1 }];
    const robotBox = boxOf(corners);
    if (robotBox) avoid.push(robotBox);
    if (over.hud) avoid.push({ left: -1, right: over.hud.right, bottom: over.hud.bottom, top: 1 });
    if (over.card) avoid.push({ left: over.card.left, right: 1, bottom: -1, top: 1 });
    if (over.tools) avoid.push({ left: -1, right: over.tools.right, bottom: -1, top: over.tools.top });
    // N18 R4.3: the ultrasonic distance tags (sensor-label-boxes.ts).
    for (let i = 0; i < labelBoxes.count; i++) avoid.push(labelBoxes.boxes[i]!);
    const toPlace: TagToPlace[] = tags.map(({ tag, drawn, polygon }) => {
      const [x, , z] = arenaToThree(tag.centerCm[0], tag.centerCm[1], 0);
      const spriteWidth = spriteHeight * (drawn.canvasWidth / (PILL_PX + 2 * MARGIN_PX));
      return {
        anchors: TAG_LIFTS_M.map((lift) => project(x, ZONE_TAG_M + lift, z)),
        width: spriteWidth * elements[0]! * (drawn.pillWidth / drawn.canvasWidth),
        height: spriteHeight * elements[5]! * (PILL_PX / (PILL_PX + 2 * MARGIN_PX)),
        hidden: cameraMode === 'follow' || inPolygon([xCm, yCm], polygon),
      };
    });
    const places = placeTags(toPlace, avoid);
    const distance = new Vector3();
    tags.forEach(({ tag, drawn }, i) => {
      const sprite = sprites.current[i];
      const leader = lines.current[i];
      const place: TagPlace | null = places[i] ?? null;
      if (sprite) {
        sprite.visible = place !== null;
        if (place) {
          sprite.center.set((MARGIN_PX + place.centerX * drawn.pillWidth) / drawn.canvasWidth, MARGIN_PX / (PILL_PX + 2 * MARGIN_PX));
          sprite.position.y = ZONE_TAG_M + TAG_LIFTS_M[place.lift];
        }
      }
      if (leader) {
        leader.visible = place !== null;
        if (place) {
          const [x, , z] = arenaToThree(tag.centerCm[0], tag.centerCm[1], 0);
          const height = ZONE_TAG_M + TAG_LIFTS_M[place.lift];
          // A line LINE_PX wide at its distance, turned to face the camera about the upright.
          const far = distance.set(x, height / 2, z).distanceTo(camera.position);
          leader.scale.set((LINE_PX * 2 * far * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, size.height), height, 1);
          leader.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
        }
      }
    });
  });

  return (
    <group name="zone-tags">
      {tags.map(({ tag, drawn, material }, i) => {
        const [x, , z] = arenaToThree(tag.centerCm[0], tag.centerCm[1], 0);
        const height = spriteHeight;
        return (
          <group key={tag.zoneId}>
            <mesh
              ref={(node) => {
                lines.current[i] = node;
              }}
              geometry={line.geometry}
              material={line.material}
              position={[x, 0.001, z]}
              renderOrder={29}
            />
            <sprite
              ref={(node) => {
                sprites.current[i] = node;
              }}
              material={material}
              position={[x, ZONE_TAG_M, z]}
              center={[(MARGIN_PX + TAG_PLACES[0]!.centerX * drawn.pillWidth) / drawn.canvasWidth, MARGIN_PX / (PILL_PX + 2 * MARGIN_PX)]}
              scale={[height * (drawn.canvasWidth / (PILL_PX + 2 * MARGIN_PX)), height, 1]}
              renderOrder={30}
            />
          </group>
        );
      })}
    </group>
  );
}
