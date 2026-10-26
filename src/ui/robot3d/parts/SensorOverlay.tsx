import { addTail, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { Vector3 } from 'three';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { VIEW_SAFE_RECT } from '../camera-studio';
import type { CardEdge, HudCorner, ToolsCorner } from '../hud-corner';
import type { Detail } from '../lighting/look';
import type { RobotModel } from '../robot-model';
import type { RobotRunStore } from '../robot-run-store';
import type { RobotToolsStore } from '../robot-tools-store';
import { shownObjectColors } from '../round-colors';
import { labelBoxes, LABEL_CENTERS, LABEL_REACH_SHARES, MAX_LABEL_BOXES, placeLabel, type LabelPlace } from '../sensor-label-boxes';
import { registerSensorOverlay } from '../sensor-overlay-state';
import { pulseLevel, sameSensorView } from '../sensor-overlay-math';
import { LABEL_PILL_HEIGHT_SHARE } from './distance-label';
import { createSensorOverlay, GRIPPER_LABEL_LIFT_M, type GripperWords } from './sensor-overlay';
import type { ScreenBox } from './zone-tag-layout';

// The sensor overlays in the 3D canvas (N18 R4.3, sensor-overlay.ts): what the robot "sees" over the arena. This only mounts the
// overlay and drives it: the geometry and the materials are made once, the frame callback sets them from the run store's latest world
// (no React render for a snapshot), and a frame is asked for when the overlay's own picture changes (a new tenth of a cm, another colour
// under a line sensor, another goal zone, a run starting or ending) or the learner turns it on or off, never otherwise: a robot at rest
// draws nothing. The goal zone pulses only while a run goes on, and not at all with reduced motion.

type SensorOverlayProps = {
  scenario: Pick<Scenario, 'arena' | 'goals'>;
  kit: Kit;
  model: RobotModel;
  /** The world to draw now. */
  view: () => RobotSnapshot;
  store: RobotRunStore;
  /** Holds the learner's "Hiện cảm biến" switch; without it the overlays are on. */
  tools?: RobotToolsStore | undefined;
  reducedMotion: boolean;
  /** The learner's decimal sign: ',' in Vietnamese. */
  decimal: string;
  /** The unit after the distance and the words for no echo (the messages'), and the tier's detail (the light tier has no cone surface). */
  unit: string;
  noEchoText: string;
  detail: Detail;
  /** Where the HUD, the results card and the view tools cover the view (NDC): the distance tag keeps clear of them. */
  overlays: { hud: HudCorner | null; card: CardEdge | null; tools: ToolsCorner | null };
  /** N19 E5: the words of the gripper's tag ("IR: có vật", "Màu: đỏ"), made once; a car without a gripper's sensors needs none. */
  gripperWords?: GripperWords | undefined;
};

/** N19 E5: how far over the carriage the gripper's tag may stand, m, in the order tried: its own height, higher, lower. */
const GRIPPER_LABEL_LIFTS_M = [GRIPPER_LABEL_LIFT_M, GRIPPER_LABEL_LIFT_M + 0.04, GRIPPER_LABEL_LIFT_M - 0.02] as const;

/** What the tag keeps clear of: the strips at the top and the bottom, the HUD's corner, the card's side and the tools' corner. */
const MAX_AVOID = 5;

/** Sets a box (NDC) in place. */
function cover(box: ScreenBox, left: number, right: number, bottom: number, top: number): void {
  box.left = left;
  box.right = right;
  box.bottom = bottom;
  box.top = top;
}

export function SensorOverlay({ scenario, kit, model, view, store, tools, reducedMotion, decimal, unit, noEchoText, detail, overlays, gripperWords }: SensorOverlayProps) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  const fovDeg = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 40;
  const overlay = useMemo(() => {
    try {
      return createSensorOverlay({ kit, model, scenario, decimal, unit, noEchoText, fovDeg, detail, gripperWords });
    } catch (error) {
      // An overlay that cannot be built is no reason to lose the view.
      console.warn('The robot lab’s sensor overlay could not be built; the view draws without it.', error);
      return null;
    }
  }, [kit, model, scenario, decimal, unit, noEchoText, fovDeg, detail, gripperWords]);
  useEffect(() => () => overlay?.dispose(), [overlay]);
  // N19 E4/E5: the round's colours, for the zone a goal placed by colour needs; a frame when they change (a new round), none else.
  const roundColors = useStore(store, shownObjectColors);
  const colorsRef = useRef(roundColors);
  useEffect(() => {
    overlay?.setRoundColors(roundColors);
    if (colorsRef.current !== roundColors) {
      colorsRef.current = roundColors;
      invalidate();
    }
  }, [overlay, roundColors, invalidate]);
  useEffect(() => (overlay ? registerSensorOverlay(gl.domElement, overlay) : undefined), [gl, overlay]);

  // A frame when the overlay's picture changes. The run's own snapshots that move the robot ask for theirs in Scene.tsx (RedrawOnChange);
  // this asks for what they do not see (the readings, the goal zone). As there, a change keeps the loop asked for one frame more.
  useEffect(() => {
    if (!overlay) return undefined;
    let shown = store.getState().latestWorld();
    const ask = () => {
      if (get().internal.frames < 2) invalidate(2);
    };
    const check = () => {
      const next = store.getState().latestWorld();
      if (!sameSensorView(shown, next, scenario.goals, colorsRef.current ?? undefined)) {
        shown = next;
        ask();
      }
    };
    const stopPublishes = store.getState().onPublish(check);
    const stopState = store.subscribe(check);
    const stopSwitch = tools?.subscribe((state, previous) => {
      if (state.sensors !== previous.sensors) ask();
    });
    return () => {
      stopPublishes();
      stopState();
      stopSwitch?.();
    };
  }, [overlay, store, tools, scenario, invalidate, get]);

  // The tag is painted at most about ten times a second while a reading changes; when the draw loop stops (R3F's tail) the tag held back is
  // painted to the latest reading and one frame shows it, so a robot that comes to rest says its distance exactly. That frame is the only
  // one the overlay asks for, and only when the tag was behind; it paints nothing the next time the loop stops.
  useEffect(() => {
    if (!overlay) return undefined;
    return addTail(() => {
      if (overlay.flushLabels()) invalidate();
    });
  }, [overlay, invalidate]);

  // The distance tag's spot is worked out in the frame, before the frame's other callbacks (priority −1: only a positive one takes
  // rendering over, as CompiledDraw's does), so that the zones' tags, laid out in the same frame, keep clear of it (sensor-label-boxes.ts).
  const scratch = useMemo(
    () => ({
      anchor: new Vector3(),
      anchors: new Float64Array(2 * LABEL_REACH_SHARES.length),
      // What floats over the view, and (N19 E5, for the gripper's tag) the distance tags placed before it this frame.
      avoid: Array.from({ length: MAX_AVOID + MAX_LABEL_BOXES }, (): ScreenBox => ({ left: 0, right: 0, bottom: 0, top: 0 })),
      place: { reach: 0, center: 0, clear: false } as LabelPlace,
    }),
    [],
  );
  const latest = useRef(overlays);
  useEffect(() => {
    latest.current = overlays;
  });
  useEffect(
    () => () => {
      labelBoxes.count = 0;
    },
    [],
  );
  useFrame(({ clock }) => {
    if (!overlay) return;
    const world = view();
    overlay.update(world, tools ? tools.getState().sensors : true, pulseLevel(world.status === 'running', reducedMotion, clock.elapsedTime), clock.elapsedTime);
    const { anchor, anchors, avoid, place } = scratch;
    const { hud, card, tools: toolsCorner } = latest.current;
    const elements = camera.projectionMatrix.elements;
    let avoidCount = 0;
    cover(avoid[avoidCount++]!, -1, 1, VIEW_SAFE_RECT.top, 1);
    cover(avoid[avoidCount++]!, -1, 1, -1, VIEW_SAFE_RECT.bottom);
    if (hud) cover(avoid[avoidCount++]!, -1, hud.right, hud.bottom, 1);
    if (card) cover(avoid[avoidCount++]!, card.left, 1, -1, 1);
    if (toolsCorner) cover(avoid[avoidCount++]!, -1, toolsCorner.right, -1, toolsCorner.top);
    let count = 0;
    for (let i = 0; i < overlay.labels.length && count < MAX_LABEL_BOXES; i++) {
      const label = overlay.labels[i];
      if (!label || label.widthShare === 0 || !overlay.labelShown(i)) continue;
      const sprite = label.sprite;
      const reach = overlay.labelReach(i);
      // The tag's anchor on the screen at each of the places along the ray it may stand (NaN where it is behind the camera).
      for (let a = 0; a < LABEL_REACH_SHARES.length; a++) {
        sprite.position.x = reach * LABEL_REACH_SHARES[a]!;
        sprite.getWorldPosition(anchor).project(camera);
        const seen = anchor.z <= 1 && anchor.z >= -1;
        anchors[2 * a] = seen ? anchor.x : Number.NaN;
        anchors[2 * a + 1] = seen ? anchor.y : Number.NaN;
      }
      if (Number.isNaN(anchors[0]!)) {
        sprite.position.x = reach;
        continue;
      }
      const width = sprite.scale.x * elements[0]! * label.widthShare;
      const height = sprite.scale.y * elements[5]! * LABEL_PILL_HEIGHT_SHARE;
      placeLabel(labelBoxes.boxes[count]!, place, anchors, LABEL_REACH_SHARES.length, width, height, avoid, avoidCount);
      sprite.position.x = reach * LABEL_REACH_SHARES[place.reach]!;
      // The pill is centred on its canvas: `center.x` puts the share of it that the place says to the left of the anchor.
      sprite.center.x = (1 - label.widthShare) / 2 + LABEL_CENTERS[place.center]! * label.widthShare;
      count += 1;
    }
    // N19 E5: the gripper's tag over the jaws, at the first height over the carriage where it is in the view and clear of what floats over
    // it and of the distance tags; the zones' tags keep clear of it as of them.
    const words = overlay.gripperLabel;
    if (words !== null && count < MAX_LABEL_BOXES && overlay.gripperLabelShown()) {
      const sprite = words.sprite;
      for (let a = 0; a < GRIPPER_LABEL_LIFTS_M.length; a++) {
        sprite.position.y = GRIPPER_LABEL_LIFTS_M[a]!;
        sprite.getWorldPosition(anchor).project(camera);
        const seen = anchor.z <= 1 && anchor.z >= -1;
        anchors[2 * a] = seen ? anchor.x : Number.NaN;
        anchors[2 * a + 1] = seen ? anchor.y : Number.NaN;
      }
      sprite.position.y = GRIPPER_LABEL_LIFTS_M[0];
      if (!Number.isNaN(anchors[0]!)) {
        for (let i = 0; i < count; i++) {
          const from = labelBoxes.boxes[i]!;
          cover(avoid[avoidCount + i]!, from.left, from.right, from.bottom, from.top);
        }
        const width = sprite.scale.x * elements[0]! * words.widthShare;
        const height = sprite.scale.y * elements[5]! * words.heightShare;
        placeLabel(labelBoxes.boxes[count]!, place, anchors, GRIPPER_LABEL_LIFTS_M.length, width, height, avoid, avoidCount + count);
        sprite.position.y = GRIPPER_LABEL_LIFTS_M[place.reach]!;
        sprite.center.x = (1 - words.widthShare) / 2 + LABEL_CENTERS[place.center]! * words.widthShare;
        count += 1;
      }
    }
    labelBoxes.count = count;
  }, -1);

  return overlay ? <primitive object={overlay.root} /> : null;
}
