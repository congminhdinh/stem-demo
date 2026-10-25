import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Circle, Group, Label, Layer, Line, Tag, Text } from 'react-konva';
import { useStore } from 'zustand';
import type { Kit } from '../../core/hardware/kit';
import { robotOutlineCm, type PlacementPose } from '../../core/scenario/placement';
import type { Scenario } from '../../core/scenario/scenario';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import type { RobotRunStore } from './robot-run-store';
import { measure, onRobot, robotToArena, type ArenaPoint } from './robot-tools';
import type { RobotToolsStore } from './robot-tools-store';
import { arenaToStage, stageToArena, type TopViewFit } from './top-view-math';
import { toolColors as colors } from './tool-colors';

// The view tools on the 2D map (N18 R4.8), as FloorPicker is in the 3D view: the pointer on the map's container goes back to the arena's
// cm through the map's fit (top-view-math `stageToArena`: the world group's transform undone), and the same tools store takes it: a click
// with the ruler, a press on the robot and its drag with the move tool. A layer over the map's draws the ruler (its segment and points in
// the arena's frame, its label upright in the stage's) and the move tool's ghost. Nothing else of the map listens to the pointer.

const labelFont = '"Be Vietnam Pro", system-ui, sans-serif';
/** A press and a release this close (px) are a click. */
const CLICK_SLOP_PX = 5;

/** The robot as the view shows it. */
const shownPose = (store: RobotRunStore, scenario: Pick<Scenario, 'start'>): PlacementPose => {
  const robot = store.getState().latestWorld()?.robot;
  return robot ? { xCm: robot.xCm, yCm: robot.yCm, yawDeg: robot.yawDeg } : scenario.start;
};

/** The pointer on the map's container (`container`), for the tools, while the map has a fit. */
export function useTopViewPointer(container: RefObject<HTMLElement | null>, tools: RobotToolsStore | undefined, store: RobotRunStore, scenario: Pick<Scenario, 'start'>, kit: Kit, fit: TopViewFit | null) {
  const outline = useMemo(() => robotOutlineCm(kit), [kit]);
  // The map's fit is a new object on each of its renders: the listeners read the latest, and stay (a render never ends a drag).
  const latestFit = useRef(fit);
  useEffect(() => {
    latestFit.current = fit;
  });
  const shown = fit !== null;
  useEffect(() => {
    const element = container.current;
    if (tools === undefined || element === null || !shown) return undefined;
    const toolCursor = () => {
      element.style.cursor = tools.getState().tool === 'ruler' ? 'crosshair' : '';
    };
    toolCursor();
    const stopCursor = tools.subscribe((state, previous) => {
      if (state.tool !== previous.tool) toolCursor();
    });
    const at = (event: PointerEvent): ArenaPoint | null => {
      const now = latestFit.current;
      if (now === null) return null;
      const rect = element.getBoundingClientRect();
      return stageToArena(now, event.clientX - rect.left, event.clientY - rect.top);
    };
    let pressed: { id: number; x: number; y: number } | null = null;
    let dragging: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
      const point = at(event);
      if (tools.getState().tool !== 'move' || point === null || !tools.getState().grab(point)) return;
      dragging = event.pointerId;
      element.style.cursor = 'grabbing';
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Without a capture the moves still come while the pointer is over the map.
      }
    };
    const onMove = (event: PointerEvent) => {
      const point = at(event);
      if (dragging === event.pointerId) {
        if (point !== null) tools.getState().drag(point);
        return;
      }
      if (tools.getState().tool === 'move' && pressed === null) element.style.cursor = point !== null && onRobot(point, shownPose(store, scenario), outline) ? 'grab' : '';
    };
    const onUp = (event: PointerEvent) => {
      if (dragging === event.pointerId) {
        dragging = null;
        pressed = null;
        element.style.cursor = 'grab';
        void tools.getState().drop();
        return;
      }
      const start = pressed;
      pressed = null;
      if (start === null || start.id !== event.pointerId || tools.getState().tool !== 'ruler') return;
      const point = at(event);
      if (point !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_SLOP_PX) tools.getState().pick(point);
    };
    const onCancel = (event: PointerEvent) => {
      if (dragging === event.pointerId) {
        dragging = null;
        tools.getState().cancelDrag();
      }
      pressed = null;
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      if (dragging !== null) tools.getState().cancelDrag();
      stopCursor();
      element.style.cursor = '';
    };
  }, [container, tools, store, scenario, outline, shown]);
}

/** The ruler and the ghost over the map (inside its Stage). */
export function TopViewToolsLayer({ tools, kit, fit }: { tools: RobotToolsStore; kit: Kit; fit: TopViewFit }) {
  const t = useText();
  const locale = useLocale();
  const ruler = useStore(tools, (state) => state.ruler);
  const ghost = useStore(tools, (state) => state.ghost);
  const outline = useMemo(() => robotOutlineCm(kit), [kit]);
  const [a, b] = ruler;
  const world = { x: fit.originX, y: fit.originY, scaleX: fit.scale, scaleY: -fit.scale };
  const ghostPoints = ghost === null ? null : outline.flatMap((point) => {
    const at = robotToArena(ghost.pose, point);
    return [at.xCm, at.yCm];
  });
  const label = a !== undefined && b !== undefined ? arenaToStage(fit, { xCm: (a.point.xCm + b.point.xCm) / 2, yCm: (a.point.yCm + b.point.yCm) / 2 }) : null;
  const length = a !== undefined && b !== undefined ? measure(a.point, b.point, 0).distanceCm : null;
  return (
    <Layer listening={false} name="topview-tools">
      <Group {...world} name="topview-tools-world">
        {ghostPoints && ghost && (
          <Line
            name="topview-ghost"
            clear={ghost.clear}
            points={ghostPoints}
            closed
            fill={ghost.clear ? colors.ghostClear : colors.ghostBlocked}
            opacity={0.45}
            stroke={ghost.clear ? colors.ghostClear : colors.ghostBlocked}
            strokeWidth={0.5}
            // Fill and stroke at one opacity: no buffer canvas of its own for a ghost (Konva's "perfect draw").
            perfectDrawEnabled={false}
          />
        )}
        {a && b && <Line name="topview-ruler" points={[a.point.xCm, a.point.yCm, b.point.xCm, b.point.yCm]} stroke={colors.ruler} strokeWidth={0.7} lineCap="round" />}
        {[a, b].map((point, i) =>
          point ? <Circle key={i} name="topview-ruler-point" x={point.point.xCm} y={point.point.yCm} radius={1.1} fill={colors.rulerPoint} stroke={colors.rulerEdge} strokeWidth={0.4} /> : null,
        )}
      </Group>
      {label && length !== null && (
        <Label x={label.x} y={label.y - 10} name="topview-ruler-label">
          <Tag fill={colors.labelBackground} cornerRadius={6} pointerDirection="down" pointerWidth={8} pointerHeight={5} />
          <Text text={t('robot.ruler.cm', { value: formatNumber(length, locale, 1) })} fontFamily={labelFont} fontSize={13} fontStyle="600" padding={5} fill={colors.labelText} />
        </Label>
      )}
    </Layer>
  );
}
