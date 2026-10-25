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
import { labelBoxes, MAX_LABEL_BOXES } from '../sensor-label-boxes';
import type { MatLabels } from './mat-paint';
import { boxOfInto, createTagLayout, inPolygon, TAG_LIFTS_M, TAG_PLACES, type ScreenBox, type TagPlace } from './zone-tag-layout';
import { tagBadgeColor, zoneTags, type ZoneTag } from './zone-tags';

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
/** N18 P2: what the layout is made from, as numbers (ZoneTags' frame callback): two 4 × 4 matrices, 6 more and the sensors' tags. */
const SEEN_LENGTH = 16 + 16 + 6 + 4 * MAX_LABEL_BOXES;

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
  ctx.fillStyle = tagBadgeColor(tag.color, tag.number !== null);
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

  // N18 P2: what the frame callback works with, made once for the tags, so that it makes no garbage a frame (it made 3–5 KB a frame,
  // and the layout 3–10 KB more): the layout (createTagLayout) and every array and box are made once, and reused.
  const work = useMemo(() => {
    const point = new Vector3();
    return {
      layout: createTagLayout(),
      point,
      /** Projects (x, y, z) into `into` (NDC x, y); false where it is behind the camera or past its far plane. */
      project: (x: number, y: number, z: number, into: [number, number]): boolean => {
        point.set(x, y, z).project(camera);
        if (point.z > 1 || point.z < -1) return false;
        into[0] = point.x;
        into[1] = point.y;
        return true;
      },
      distance: new Vector3(),
      /** The robot's box's corners on the screen, x, y each. */
      corners: new Float64Array(16),
      robot: { left: 0, right: 0, bottom: 0, top: 0 },
      above: { left: -1, right: 1, bottom: VIEW_SAFE_RECT.top, top: 1 },
      hud: { left: -1, right: 0, bottom: 0, top: 1 },
      card: { left: 0, right: 1, bottom: -1, top: 1 },
      tools: { left: -1, right: 0, bottom: -1, top: 0 },
      avoid: [] as ScreenBox[],
      /** The robot's spot on the floor (arena cm), for its zone. */
      at: [0, 0] as [number, number],
      toPlace: tags.map(() => ({ anchors: [null, null, null] as ([number, number] | null)[], points: TAG_LIFTS_M.map((): [number, number] => [0, 0]), width: 0, height: 0, hidden: false })),
      /** What the last layout was made from: the camera's two matrices, the robot's pose, the view's height, the mode and the sensors' tags (and, by identity, the overlays and the robot's box). */
      seen: new Float64Array(SEEN_LENGTH).fill(Number.NaN),
      next: new Float64Array(SEEN_LENGTH),
      seenOverlays: null as ZoneTagsProps['overlays'] | null,
      seenRobot: null as RobotTagBox | null,
    };
  }, [tags, camera]);

  useFrame(() => {
    const { view: now, mode: cameraMode, overlays: over, robot: box } = latest.current;
    const world = now();
    const { xCm, yCm, yawDeg } = world.robot;
    // Nothing the layout reads has changed since the last frame (a frame for an LED, a blink): it stands as it is.
    const { seen, next } = work;
    next.set(camera.matrixWorld.elements, 0);
    next.set(camera.projectionMatrix.elements, 16);
    next[32] = xCm;
    next[33] = yCm;
    next[34] = yawDeg;
    next[35] = size.height;
    next[36] = cameraMode === 'follow' ? 1 : 0;
    next[37] = labelBoxes.count;
    for (let i = 0; i < MAX_LABEL_BOXES; i++) {
      const label = labelBoxes.boxes[i]!;
      const at = 38 + 4 * i;
      const used = i < labelBoxes.count;
      next[at] = used ? label.left : 0;
      next[at + 1] = used ? label.right : 0;
      next[at + 2] = used ? label.bottom : 0;
      next[at + 3] = used ? label.top : 0;
    }
    let same = over === work.seenOverlays && box === work.seenRobot;
    for (let i = 0; same && i < SEEN_LENGTH; i++) same = next[i] === seen[i];
    if (same) return;
    seen.set(next);
    work.seenOverlays = over;
    work.seenRobot = box;

    const elements = camera.projectionMatrix.elements;
    const { point, corners, project } = work;
    // The robot's box on the screen, its raised flag in it.
    const c = Math.cos((yawDeg * Math.PI) / 180);
    const s = Math.sin((yawDeg * Math.PI) / 180);
    let cornerCount = 0;
    for (let i = 0; i < 4; i++) {
      const dx = i < 2 ? -box.halfLength : box.halfLength;
      const dy = i % 2 === 0 ? -box.halfWidth : box.halfWidth;
      // arenaToThree, inline: (x cm, y cm) → (x m, 0 − y m).
      const x = (xCm + (dx * c - dy * s) * 100) / 100;
      const z = 0 - (yCm + (dx * s + dy * c) * 100) / 100;
      for (let k = 0; k < 2; k++) {
        point.set(x, k === 0 ? 0 : box.height, z).project(camera);
        if (point.z > 1 || point.z < -1) continue;
        corners[2 * cornerCount] = point.x;
        corners[2 * cornerCount + 1] = point.y;
        cornerCount += 1;
      }
    }
    work.at[0] = xCm;
    work.at[1] = yCm;
    const avoid = work.avoid;
    avoid.length = 0;
    avoid.push(work.above);
    if (boxOfInto(corners, cornerCount, work.robot)) avoid.push(work.robot);
    if (over.hud) {
      work.hud.right = over.hud.right;
      work.hud.bottom = over.hud.bottom;
      avoid.push(work.hud);
    }
    if (over.card) {
      work.card.left = over.card.left;
      avoid.push(work.card);
    }
    if (over.tools) {
      work.tools.right = over.tools.right;
      work.tools.top = over.tools.top;
      avoid.push(work.tools);
    }
    // N18 R4.3: the ultrasonic distance tags (sensor-label-boxes.ts).
    for (let i = 0; i < labelBoxes.count; i++) avoid.push(labelBoxes.boxes[i]!);
    for (let i = 0; i < tags.length; i++) {
      const { tag, drawn, polygon } = tags[i]!;
      const entry = work.toPlace[i]!;
      const x = tag.centerCm[0] / 100;
      const z = 0 - tag.centerCm[1] / 100;
      for (let lift = 0; lift < TAG_LIFTS_M.length; lift++) entry.anchors[lift] = project(x, ZONE_TAG_M + TAG_LIFTS_M[lift]!, z, entry.points[lift]!) ? entry.points[lift]! : null;
      const spriteWidth = spriteHeight * (drawn.canvasWidth / (PILL_PX + 2 * MARGIN_PX));
      entry.width = spriteWidth * elements[0]! * (drawn.pillWidth / drawn.canvasWidth);
      entry.height = spriteHeight * elements[5]! * (PILL_PX / (PILL_PX + 2 * MARGIN_PX));
      entry.hidden = cameraMode === 'follow' || inPolygon(work.at, polygon);
    }
    const places = work.layout.place(work.toPlace, avoid);
    for (let i = 0; i < tags.length; i++) {
      const { tag, drawn } = tags[i]!;
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
          const x = tag.centerCm[0] / 100;
          const z = 0 - tag.centerCm[1] / 100;
          const height = ZONE_TAG_M + TAG_LIFTS_M[place.lift];
          // A line LINE_PX wide at its distance, turned to face the camera about the upright.
          const far = work.distance.set(x, height / 2, z).distanceTo(camera.position);
          leader.scale.set((LINE_PX * 2 * far * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, size.height), height, 1);
          leader.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
        }
      }
    }
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
