import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, DoubleSide, Shape, SRGBColorSpace } from 'three';
import { useStore } from 'zustand';
import type { Kit } from '../../core/hardware/kit';
import { robotOutlineCm, type PlacementPose } from '../../core/scenario/placement';
import type { Scenario } from '../../core/scenario/scenario';
import { useLocale, useText } from '../i18n/text';
import { clientToNdc, pickFloor } from './floor-pick';
import { formatNumber } from './format';
import type { RobotRunStore } from './robot-run-store';
import { measure, onRobot, type ArenaPoint } from './robot-tools';
import type { RobotToolsStore } from './robot-tools-store';
import { arenaToThree } from './scene-math';
import { toolColors as colors } from './tool-colors';

// The view tools in the 3D view (N18 R4.8): the pointer on the mat, and what the tools draw there. A press is turned into the point of the
// mat under it (floor-pick.ts: the camera's ray on the floor, back through scene-math), in every camera view.
//   - The ruler takes a click: a press and a release within CLICK_SLOP_PX, so that a drag still turns the camera (OrbitControls sees
//     every press). It draws the segment on the mat, its points, and a label with the length (cm, one decimal) over its middle that
//     keeps its size on the screen.
//   - The move tool takes a press on the robot: that press is stopped before the camera's controls see it (a listener in the capture phase
//     on the canvas's parent), so the drag moves the robot's ghost, not the camera; a press elsewhere still turns the camera. The ghost is
//     the robot's outline, raised to its body's height, blue where it may stand and red where it cannot.
// The canvas draws on demand: a change of the tools asks for a frame.

/** A press and a release this close (px) are a click; farther, the camera's drag. */
const CLICK_SLOP_PX = 5;
/** How high the ruler floats over the mat, and the ghost's height, m. */
const RULER_Y_M = 0.0015;
const GHOST_HEIGHT_M = 0.05;
/** The label's height on the screen as a share of the canvas's, through the camera's field of view (a sprite of fixed size). */
const LABEL_SCREEN = 0.05;

type FloorPickerProps = {
  tools: RobotToolsStore;
  store: RobotRunStore;
  kit: Kit;
  scenario: Pick<Scenario, 'start'>;
};

/** The robot as the view shows it. */
const shownPose = (store: RobotRunStore, scenario: Pick<Scenario, 'start'>): PlacementPose => {
  const robot = store.getState().latestWorld()?.robot;
  return robot ? { xCm: robot.xCm, yCm: robot.yCm, yawDeg: robot.yawDeg } : scenario.start;
};

/** The ruler's label: the length on a dark rounded tag, drawn on a canvas. */
function useLabelTexture(text: string | null): { texture: CanvasTexture; aspect: number } | null {
  const label = useMemo(() => {
    if (text === null || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    const font = '600 40px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 36;
    canvas.width = width;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = colors.labelBackground;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, 64, 16);
    ctx.fill();
    ctx.fillStyle = colors.labelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, 34);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { texture, aspect: width / 64 };
  }, [text]);
  useEffect(() => () => label?.texture.dispose(), [label]);
  return label;
}

function RulerMark({ point }: { point: ArenaPoint }) {
  return (
    <group position={arenaToThree(point.xCm, point.yCm, RULER_Y_M * 100) as [number, number, number]} renderOrder={20}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={20}>
        <circleGeometry args={[0.009, 24]} />
        <meshBasicMaterial color={colors.rulerEdge} depthTest={false} transparent />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={21}>
        <circleGeometry args={[0.006, 24]} />
        <meshBasicMaterial color={colors.rulerPoint} depthTest={false} transparent />
      </mesh>
    </group>
  );
}

function RulerSegment({ a, b, text, fovDeg }: { a: ArenaPoint; b: ArenaPoint; text: string; fovDeg: number }) {
  const label = useLabelTexture(text);
  const { distanceCm, angleDeg } = measure(a, b, 0);
  const middle = { xCm: (a.xCm + b.xCm) / 2, yCm: (a.yCm + b.yCm) / 2 };
  const height = LABEL_SCREEN * 2 * Math.tan((fovDeg * Math.PI) / 360);
  return (
    <group>
      <mesh position={arenaToThree(middle.xCm, middle.yCm, RULER_Y_M * 100) as [number, number, number]} rotation-y={(angleDeg * Math.PI) / 180} renderOrder={19}>
        <boxGeometry args={[distanceCm / 100, 0.0005, 0.005]} />
        <meshBasicMaterial color={colors.ruler} depthTest={false} transparent />
      </mesh>
      {label && (
        <sprite position={arenaToThree(middle.xCm, middle.yCm, 4) as [number, number, number]} scale={[height * label.aspect, height, 1]} renderOrder={22}>
          <spriteMaterial map={label.texture} depthTest={false} sizeAttenuation={false} transparent />
        </sprite>
      )}
    </group>
  );
}

function Ghost({ pose, clear, outline }: { pose: PlacementPose; clear: boolean; outline: readonly (readonly [number, number])[] }) {
  // The outline in the shape's plane (x forward, y left, m), laid on the floor by the turn about X: (x, y) → (x, 0, −y), as scene-math maps
  // the robot frame; extruded up to the body's height.
  const shape = useMemo(() => {
    const drawn = new Shape();
    outline.forEach(([x, y], i) => (i === 0 ? drawn.moveTo(x / 100, y / 100) : drawn.lineTo(x / 100, y / 100)));
    drawn.closePath();
    return drawn;
  }, [outline]);
  const color = clear ? colors.ghostClear : colors.ghostBlocked;
  return (
    <group position={arenaToThree(pose.xCm, pose.yCm, 0.2) as [number, number, number]} rotation-y={(pose.yawDeg * Math.PI) / 180} name="robot-ghost">
      <mesh rotation-x={-Math.PI / 2} renderOrder={18}>
        <extrudeGeometry args={[shape, { depth: GHOST_HEIGHT_M, bevelEnabled: false }]} />
        <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={18}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} depthTest={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}

export function FloorPicker({ tools, store, kit, scenario }: FloorPickerProps) {
  const t = useText();
  const locale = useLocale();
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const tool = useStore(tools, (state) => state.tool);
  const ruler = useStore(tools, (state) => state.ruler);
  const ghost = useStore(tools, (state) => state.ghost);
  const outline = useMemo(() => robotOutlineCm(kit), [kit]);
  const fovDeg = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 40;

  useEffect(() => {
    invalidate();
  }, [ruler, ghost, invalidate]);

  // The pointer over the canvas: what the tool in use does with it (see the top of this file).
  useEffect(() => {
    const canvas = gl.domElement;
    const host = canvas.parentElement;
    if (host === null) return undefined;
    canvas.style.cursor = tool === 'ruler' ? 'crosshair' : '';
    const at = (event: PointerEvent): ArenaPoint | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      camera.updateMatrixWorld();
      return pickFloor(clientToNdc(event.clientX, event.clientY, rect), camera.matrixWorld.elements, camera.projectionMatrixInverse.elements);
    };
    let pressed: { id: number; x: number; y: number } | null = null;
    let dragging: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
      if (tools.getState().tool !== 'move') return;
      const point = at(event);
      if (point === null || !tools.getState().grab(point)) return;
      // The robot is grabbed: the camera's controls never see this press, so the drag moves the robot.
      event.stopPropagation();
      dragging = event.pointerId;
      canvas.style.cursor = 'grabbing';
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Without a capture the moves still come while the pointer is over the canvas.
      }
    };
    const onMove = (event: PointerEvent) => {
      if (dragging === event.pointerId) {
        const point = at(event);
        if (point !== null) tools.getState().drag(point);
        return;
      }
      if (tools.getState().tool === 'move' && pressed === null) {
        const point = at(event);
        canvas.style.cursor = point !== null && onRobot(point, shownPose(store, scenario), outline) ? 'grab' : '';
      }
    };
    const onUp = (event: PointerEvent) => {
      if (dragging === event.pointerId) {
        dragging = null;
        pressed = null;
        canvas.style.cursor = 'grab';
        void tools.getState().drop();
        return;
      }
      const start = pressed;
      pressed = null;
      if (start === null || start.id !== event.pointerId || tools.getState().tool !== 'ruler') return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
      const point = at(event);
      if (point !== null) tools.getState().pick(point);
    };
    const onCancel = (event: PointerEvent) => {
      if (dragging === event.pointerId) {
        dragging = null;
        tools.getState().cancelDrag();
      }
      pressed = null;
    };
    host.addEventListener('pointerdown', onDown, { capture: true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      if (dragging !== null) tools.getState().cancelDrag();
      canvas.style.cursor = '';
    };
  }, [gl, camera, tools, store, scenario, outline, tool]);

  const [a, b] = ruler;
  const length = a !== undefined && b !== undefined ? measure(a.point, b.point, 0).distanceCm : null;
  return (
    <group name="robot-tools">
      {a && <RulerMark point={a.point} />}
      {b && <RulerMark point={b.point} />}
      {a && b && length !== null && <RulerSegment a={a.point} b={b.point} text={t('robot.ruler.cm', { value: formatNumber(length, locale, 1) })} fovDeg={fovDeg} />}
      {ghost && <Ghost pose={ghost.pose} clear={ghost.clear} outline={outline} />}
    </group>
  );
}
