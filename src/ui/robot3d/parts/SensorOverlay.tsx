import { addTail, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { Vector3 } from 'three';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { VIEW_SAFE_RECT } from '../camera-studio';
import { shownColorSensorsOn } from '../color-sensors-on';
import type { CardEdge, HudCorner, ToolsCorner } from '../hud-corner';
import type { Detail } from '../lighting/look';
import type { RobotModel } from '../robot-model';
import type { RobotRunStore } from '../robot-run-store';
import type { RobotToolsStore } from '../robot-tools-store';
import { shownObjectColors } from '../round-colors';
import { gripperTagLayout, labelBoxes, LABEL_CENTERS, LABEL_REACH_SHARES, MAX_LABEL_BOXES, MAX_TAG_OBJECTS, placeLabel, type LabelPlace } from '../sensor-label-boxes';
import { registerSensorOverlay } from '../sensor-overlay-state';
import { pulseLevel } from '../sensor-overlay-math';
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

/**
 * N19 E5: where the gripper's tag may stand, in the carriage's frame (m: up, across), in the order tried: over the jaws, higher, beside them
 * on either side (fix round 1: seen from above, every spot over the jaws covers the beam and the spot), lower. N19 E8 (review F1): then
 * higher still and farther out, for "Theo xe", where the claw servo and the object fill the spots by the jaws.
 */
const GRIPPER_LABEL_SPOTS_M = [
  [GRIPPER_LABEL_LIFT_M, 0],
  [GRIPPER_LABEL_LIFT_M + 0.04, 0],
  [GRIPPER_LABEL_LIFT_M, -0.075],
  [GRIPPER_LABEL_LIFT_M, 0.075],
  [GRIPPER_LABEL_LIFT_M - 0.02, 0],
  [GRIPPER_LABEL_LIFT_M + 0.08, 0],
  [GRIPPER_LABEL_LIFT_M + 0.03, -0.13],
  [GRIPPER_LABEL_LIFT_M + 0.03, 0.13],
  [GRIPPER_LABEL_LIFT_M + 0.13, 0],
] as const;

/** N19 E8 (review F1): how far the gripper's tag keeps from the claw and the objects on the screen, px. */
const GRIPPER_KEEP_OUT_PX = 6;

/**
 * N19 E8: on a gripper car, where else a distance tag may stand when none of its spots along the ray is clear (an echo a few centimetres off,
 * the held cube's, puts them all by the jaws, where the gripper's tag is): beside its echo on either side, then over it (m, in the beam's
 * frame: up from the ray, over the height its spots along it stand at, the overlay's `distanceLiftM`; across). Review F5: the sides first,
 * so that it stays at its height by the echo before it climbs; fix round 1, farther out last, as it keeps clear of the claw and the objects
 * too. Fix round 2: with none clear it is not shown, as the sensors' tag is not. A rover's tag has its spots along the ray alone, and with
 * none clear stands at its echo.
 */
const DISTANCE_LABEL_MORE_SPOTS_M = [
  [0, -0.09],
  [0, 0.09],
  [0.04, 0],
  [0.08, 0],
  [0.04, -0.14],
  [0.04, 0.14],
  [0.12, 0],
] as const;

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
  const size = useThree((state) => state.size);
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
    // N19 final fix (G2 I1): the colour sensors the run in view sets up, which the frame gives the overlay: another run's asks for a frame.
    let shownColorSensors = shownColorSensorsOn(store.getState());
    const ask = () => {
      if (get().internal.frames < 2) invalidate(2);
    };
    const check = () => {
      const state = store.getState();
      const next = state.latestWorld();
      const colorSensors = shownColorSensorsOn(state);
      // Minor round (review 2, N2): the overlay's own check, with the colours it lights the goal's zone by (the arena's with no round).
      if (!overlay.sameView(shown, next) || colorSensors !== shownColorSensors) {
        shown = next;
        shownColorSensors = colorSensors;
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
  // N19 E8 (review F1): each object's half sizes (cm: along its x, its y, up), for the box the gripper's tag keeps clear of.
  const objectHalves = useMemo(
    () => new Map(scenario.arena.objects.map((object) => [object.id, object.shape === 'box' ? ([object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.sizeCm[2] / 2] as const) : ([object.radiusCm, object.radiusCm, object.heightCm / 2] as const)])),
    [scenario.arena.objects],
  );
  const scratch = useMemo(
    () => ({
      anchor: new Vector3(),
      anchors: new Float64Array(2 * (LABEL_REACH_SHARES.length + DISTANCE_LABEL_MORE_SPOTS_M.length)),
      // What floats over the view, and (N19 E5, for the gripper's tag) the distance tags placed before it this frame and the jaws' room.
      // Fix round 2: and the jaws' room, the objects in the view (MAX_TAG_OBJECTS) and the gripper's own tag, before the distance tags.
      avoid: Array.from({ length: MAX_AVOID + 1 + MAX_TAG_OBJECTS + 1 + MAX_LABEL_BOXES }, (): ScreenBox => ({ left: 0, right: 0, bottom: 0, top: 0 })),
      spotAnchors: new Float64Array(2 * GRIPPER_LABEL_SPOTS_M.length),
      corner: new Vector3(),
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
    overlay.setColorSensorsOn(shownColorSensorsOn(store.getState()));
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
    // N19 E5: the gripper's tag over the jaws, at the first height over the carriage where it is in the view and clear of what floats over
    // it and of the jaws' room. N19 E8: it is laid out first, and the distance tags keep clear of it, as they slide back along their rays
    // (four reaches, three ways each); the gripper's tag has only its few spots by the jaws (E5 laid it out last, and in "Theo xe" none
    // was clear of the distance tag over the jaws, the HUD beside them: it stood under both). The zones' tags keep clear of both. Review F1:
    // the room holds the claw servo's case too, and (fix round 2, review R1) every object in the view is kept clear of as well, all with
    // GRIPPER_KEEP_OUT_PX round them; a tag with no clear spot is not shown (it would hide what it speaks of).
    let gripperPlaced = false;
    const words = overlay.gripperLabel;
    const room = overlay.gripperRoom;
    gripperTagLayout.shown = false;
    gripperTagLayout.keepOutCount = 0;
    // The keep-outs (a gripper car's, whether its tag is shown or not: the distance tags keep clear of them too, review minor).
    let kept = avoidCount;
    if (room !== null) {
      const corner = scratch.corner;
      // (Plain numbers: an array destructured here would be garbage every frame, N18 P2.)
      const marginX = (2 * GRIPPER_KEEP_OUT_PX) / Math.max(1, size.width);
      const marginY = (2 * GRIPPER_KEEP_OUT_PX) / Math.max(1, size.height);
      // The jaws' room on the screen: the box round its eight corners (behind the camera: none).
      const box = avoid[kept]!;
      cover(box, Infinity, -Infinity, Infinity, -Infinity);
      let corners = 0;
      for (let k = 0; k < 8; k++) {
        corner.set(k & 1 ? room.max[0] : room.min[0], k & 2 ? room.max[1] : room.min[1], k & 4 ? room.max[2] : room.min[2]);
        room.frame.localToWorld(corner).project(camera);
        if (corner.z > 1 || corner.z < -1) continue;
        corners += 1;
        if (corner.x < box.left) box.left = corner.x;
        if (corner.x > box.right) box.right = corner.x;
        if (corner.y < box.bottom) box.bottom = corner.y;
        if (corner.y > box.top) box.top = corner.y;
      }
      if (corners > 0) {
        cover(box, box.left - marginX, box.right + marginX, box.bottom - marginY, box.top + marginY);
        kept += 1;
      }
      // Fix round 2: every object's box on the screen (turned with it), for the keep-outs and the E2E.
      let objectCount = 0;
      for (let o = 0; o < world.objects.length && objectCount < MAX_TAG_OBJECTS; o++) {
        const object = world.objects[o]!;
        const halves = objectHalves.get(object.id);
        if (halves === undefined) continue;
        const into = gripperTagLayout.objects[objectCount]!;
        cover(into, Infinity, -Infinity, Infinity, -Infinity);
        const c = Math.cos((object.pose.yawDeg * Math.PI) / 180);
        const s = Math.sin((object.pose.yawDeg * Math.PI) / 180);
        for (let k = 0; k < 8; k++) {
          const dx = k & 1 ? halves[0] : -halves[0];
          const dy = k & 2 ? halves[1] : -halves[1];
          const dz = k & 4 ? halves[2] : -halves[2];
          overlay.root.localToWorld(corner.set((object.pose.xCm + dx * c - dy * s) / 100, (object.pose.zCm + dz) / 100, 0 - (object.pose.yCm + dx * s + dy * c) / 100)).project(camera);
          if (corner.z > 1 || corner.z < -1) continue;
          if (corner.x < into.left) into.left = corner.x;
          if (corner.x > into.right) into.right = corner.x;
          if (corner.y < into.bottom) into.bottom = corner.y;
          if (corner.y > into.top) into.top = corner.y;
        }
        gripperTagLayout.objectIds[objectCount] = object.id;
        objectCount += 1;
      }
      gripperTagLayout.objectCount = objectCount;
      // Review R1: every object in the view, the one the car drives to as much as the one it holds (fix round 1 kept clear only of the one
      // held or seen and the one within 10 cm of the jaws' tips, which the car's own deck hides in "Theo xe"), with the room round it.
      for (let o = 0; o < objectCount; o++) {
        const from = gripperTagLayout.objects[o]!;
        if (from.right <= -1 || from.left >= 1 || from.top <= -1 || from.bottom >= 1) continue;
        cover(avoid[kept]!, from.left - marginX, from.right + marginX, from.bottom - marginY, from.top + marginY);
        kept += 1;
      }
      // For the E2E: the keep-out boxes.
      gripperTagLayout.keepOutCount = kept - avoidCount;
      for (let k = avoidCount; k < kept; k++) {
        const from = avoid[k]!;
        cover(gripperTagLayout.keepOut[k - avoidCount]!, from.left, from.right, from.bottom, from.top);
      }
    }
    if (words !== null && room !== null && overlay.gripperLabelShown()) {
      const sprite = words.sprite;
      const spotAnchors = scratch.spotAnchors;
      for (let a = 0; a < GRIPPER_LABEL_SPOTS_M.length; a++) {
        sprite.position.y = GRIPPER_LABEL_SPOTS_M[a]![0];
        sprite.position.z = GRIPPER_LABEL_SPOTS_M[a]![1];
        sprite.getWorldPosition(anchor).project(camera);
        const seen = anchor.z <= 1 && anchor.z >= -1;
        spotAnchors[2 * a] = seen ? anchor.x : Number.NaN;
        spotAnchors[2 * a + 1] = seen ? anchor.y : Number.NaN;
      }
      sprite.position.y = GRIPPER_LABEL_SPOTS_M[0][0];
      sprite.position.z = 0;
      if (!Number.isNaN(spotAnchors[0]!)) {
        const width = sprite.scale.x * elements[0]! * words.widthShare;
        const height = sprite.scale.y * elements[5]! * words.heightShare;
        placeLabel(labelBoxes.boxes[count]!, place, spotAnchors, GRIPPER_LABEL_SPOTS_M.length, width, height, avoid, kept);
        sprite.visible = place.clear;
        if (place.clear) {
          const chosen = GRIPPER_LABEL_SPOTS_M[place.reach]!;
          sprite.position.y = chosen[0];
          sprite.position.z = chosen[1];
          sprite.center.x = (1 - words.widthShare) / 2 + LABEL_CENTERS[place.center]! * words.widthShare;
          const placed = labelBoxes.boxes[count]!;
          cover(gripperTagLayout.box, placed.left, placed.right, placed.bottom, placed.top);
          gripperTagLayout.shown = true;
          count += 1;
          gripperPlaced = true;
        }
      }
    }
    // The distance tags, clear of what floats over the view and (a gripper car's) of the claw, the objects by it and the gripper's tag. A
    // rover's avoid what they did.
    let distanceAvoid = kept;
    if (gripperPlaced) {
      const from = labelBoxes.boxes[0]!;
      cover(avoid[distanceAvoid++]!, from.left, from.right, from.bottom, from.top);
    }
    for (let i = 0; i < overlay.labels.length && count < MAX_LABEL_BOXES; i++) {
      const label = overlay.labels[i];
      if (!label || label.widthShare === 0 || !overlay.labelShown(i)) continue;
      const sprite = label.sprite;
      const reach = overlay.labelReach(i);
      // The tag's anchor on the screen at each of the places along the ray it may stand (NaN where it is behind the camera); N19 E8, on a
      // gripper car (its tag laid out), over and beside its echo too.
      // (Review M3: on any gripper car, placed or not this frame, so that a spot over or beside the echo is never left over.)
      const lift = overlay.distanceLiftM;
      if (room !== null) sprite.position.set(sprite.position.x, lift, 0);
      for (let a = 0; a < LABEL_REACH_SHARES.length; a++) {
        sprite.position.x = reach * LABEL_REACH_SHARES[a]!;
        sprite.getWorldPosition(anchor).project(camera);
        const seen = anchor.z <= 1 && anchor.z >= -1;
        anchors[2 * a] = seen ? anchor.x : Number.NaN;
        anchors[2 * a + 1] = seen ? anchor.y : Number.NaN;
      }
      let anchorCount = LABEL_REACH_SHARES.length;
      // (Fix round 2: on any gripper car, its sensors' tag placed or not.)
      if (room !== null) {
        for (let e = 0; e < DISTANCE_LABEL_MORE_SPOTS_M.length; e++, anchorCount++) {
          sprite.position.set(reach, lift + DISTANCE_LABEL_MORE_SPOTS_M[e]![0], DISTANCE_LABEL_MORE_SPOTS_M[e]![1]);
          sprite.getWorldPosition(anchor).project(camera);
          const seen = anchor.z <= 1 && anchor.z >= -1;
          anchors[2 * anchorCount] = seen ? anchor.x : Number.NaN;
          anchors[2 * anchorCount + 1] = seen ? anchor.y : Number.NaN;
        }
        sprite.position.set(reach, lift, 0);
      }
      if (Number.isNaN(anchors[0]!)) {
        sprite.position.x = reach;
        continue;
      }
      const width = sprite.scale.x * elements[0]! * label.widthShare;
      const height = sprite.scale.y * elements[5]! * LABEL_PILL_HEIGHT_SHARE;
      placeLabel(labelBoxes.boxes[count]!, place, anchors, anchorCount, width, height, avoid, distanceAvoid);
      // Fix round 2: a gripper car's distance tag with no clear spot is not shown, as its sensors' tag is not (it would stand on the claw or
      // an object); a rover's stands at its echo, as N18 had it.
      if (room !== null) {
        sprite.visible = place.clear;
        if (!place.clear) continue;
      }
      if (place.reach < LABEL_REACH_SHARES.length) sprite.position.x = reach * LABEL_REACH_SHARES[place.reach]!;
      else sprite.position.set(reach, lift + DISTANCE_LABEL_MORE_SPOTS_M[place.reach - LABEL_REACH_SHARES.length]![0], DISTANCE_LABEL_MORE_SPOTS_M[place.reach - LABEL_REACH_SHARES.length]![1]);
      // The pill is centred on its canvas: `center.x` puts the share of it that the place says to the left of the anchor.
      sprite.center.x = (1 - label.widthShare) / 2 + LABEL_CENTERS[place.center]! * label.widthShare;
      count += 1;
    }
    labelBoxes.count = count;
  }, -1);

  return overlay ? <primitive object={overlay.root} /> : null;
}
