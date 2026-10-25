import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MOUSE, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { cameraLimits, topPose, type ArenaSpan, type CameraMode, type CameraPose } from './camera';
import { chaseViewPose, clearSight, freeViewPose, VIEW_SAFE_RECT, type FreeViewScene, type SightWall } from './camera-studio';
import type { CardEdge, HudCorner } from './hud-corner';
import { arenaToThree } from './scene-math';

// The camera of the robot lab's 3D view (N18 R4.2; R4.7 gives it depth). three's own OrbitControls (ADR 0002 §5: no drei), wired by
// hand: every change asks for a frame (the canvas draws on demand). Three views: "Tự do" (orbit; it opens low behind and beside the
// robot's start, the arena receding, camera-studio.ts), "Theo xe" (a chase camera low behind the robot that swings round as it turns
// and rises to look over a wall between them; the learner may orbit it, and the chase keeps the angle they leave it at) and "Nhìn từ
// trên" (straight down, pan and zoom only).
// Going from one view to another, and "đặt lại góc nhìn" (a new `resetKey`), glides for a moment, unless the learner asked for reduced
// motion: then it jumps, and nothing eases, drifts or trails.

type CameraRigProps = {
  mode: CameraMode;
  span: ArenaSpan;
  /** The robot's start and the lesson's goal zones: the free view is framed from behind the one over to the other. */
  free: FreeViewScene;
  view: () => RobotSnapshot;
  reducedMotion: boolean;
  /** A new value puts the current view's camera back where the view starts. */
  resetKey?: number;
  /** Where the HUD covers the view (NDC): the free view frames the lesson clear of it; until it is measured, a default corner. */
  hud?: HudCorner | null;
  /** The arena's walls: the chase camera rises to look over any between it and the robot. */
  walls?: readonly SightWall[];
  /** The check's open results card (NDC): while it is open, the camera looks at the robot and its picture slides left, so the
   * robot's end spot shows in the part of the view the card leaves. */
  card?: CardEdge | null;
};

/** How long the camera glides from one view to the next, s. */
const GLIDE_S = 0.45;
/** How fast "Theo xe" catches up with the robot and swings behind it: the share of the gap closed per second, as a rate. */
const FOLLOW_RATE = 5;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

type Glide = { from: CameraPose; to: CameraPose; elapsed: number };

/** The robot's origin in three's frame (m): on the floor under the middle of its body. */
const robotPoint = (world: RobotSnapshot) => arenaToThree(world.robot.xCm, world.robot.yCm, world.robot.zCm);
const robotYaw = (world: RobotSnapshot) => (world.robot.yawDeg * Math.PI) / 180;

/** The chase's offset from its target, in the robot's own frame (x forward, z right of it in three): turns with the robot. */
type ChaseOffset = { forward: number; up: number; side: number; ahead: number };
const defaultChase = (): ChaseOffset => {
  const pose = chaseViewPose([0, 0, 0], 0);
  return { forward: pose.position[0] - pose.target[0], up: pose.position[1] - pose.target[1], side: pose.position[2] - pose.target[2], ahead: pose.target[0] };
};

export function CameraRig({ mode, span, free, view, reducedMotion, resetKey = 0, hud = null, walls = [], card = null }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const dom = useThree((state) => state.gl.domElement);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const controls = useMemo(() => new OrbitControls(camera, dom), [camera, dom]);
  const glide = useRef<Glide | null>(null);
  const placed = useRef(false);
  const dragging = useRef(false);
  /** The learner has moved the camera since the view was last placed: a new HUD size then leaves it where it is. */
  const moved = useRef(false);
  /** The picture's slide (NDC) now and the one it eases to: the middle of the part of the view a results card leaves. */
  const lens = useRef({ x: 0, y: 0, goalX: 0, goalY: 0 });
  const chase = useRef<ChaseOffset>(defaultChase());
  // Read when the view changes, without being a reason to change it: a new window shape or a switch of reduced motion keeps the camera.
  const safe = useMemo(() => (hud ? { ...VIEW_SAFE_RECT, hud: { right: Math.min(0.9, hud.right), bottom: Math.max(-0.2, hud.bottom) } } : VIEW_SAFE_RECT), [hud]);
  const latest = useRef({ aspect, reducedMotion, view, span, free, mode, safe, walls });
  useEffect(() => {
    latest.current = { aspect, reducedMotion, view, span, free, mode, safe, walls };
  });

  useEffect(() => {
    const onChange = () => invalidate();
    const onStart = () => {
      dragging.current = true;
      moved.current = true;
    };
    const onEnd = () => {
      dragging.current = false;
      if (latest.current.mode !== 'follow') return;
      // Keep the angle the learner left the chase at, in the robot's frame.
      const world = latest.current.view();
      const yaw = robotYaw(world);
      const offset = new Vector3().subVectors(camera.position, controls.target);
      const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
      // Three's rotation about +Y by yaw maps the robot's (forward, side) to (x, z) = (f c + s·side, −f s + c·side).
      const forward = offset.x * c - offset.z * s;
      const side = offset.x * s + offset.z * c;
      const [px, , pz] = robotPoint(world);
      const ahead = (controls.target.x - px) * c - (controls.target.z - pz) * s;
      chase.current = { forward, up: offset.y, side, ahead };
    };
    controls.addEventListener('change', onChange);
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.dispose();
    };
  }, [controls, invalidate, camera]);

  useEffect(() => {
    const limits = cameraLimits(span, camera.fov, aspect);
    controls.minDistance = limits.minDistance;
    controls.maxDistance = limits.maxDistance;
    controls.maxPolarAngle = limits.maxPolarAngle;
    controls.cursor.set(...limits.cursor);
    controls.maxTargetRadius = limits.maxTargetRadius;
    controls.screenSpacePanning = false;
  }, [controls, span, camera, aspect]);

  useEffect(() => {
    controls.enableDamping = !reducedMotion;
  }, [controls, reducedMotion]);

  /** Where the chase camera wants to be for `world`. */
  const chaseGoal = (world: RobotSnapshot): CameraPose => {
    const [px, py, pz] = robotPoint(world);
    const yaw = robotYaw(world);
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const { forward, up, side, ahead } = chase.current;
    const target: [number, number, number] = [px + ahead * c, py + 0.03, pz - ahead * s];
    return clearSight({ position: [target[0] + forward * c + side * s, target[1] + up, target[2] - forward * s + side * c], target }, latest.current.walls);
  };

  // A new view (or a reset): the camera goes to its pose (at once the first time, or with reduced motion), and the controls take its rules.
  useEffect(() => {
    const { aspect: ratio, reducedMotion: jump, view: now, span: arena, free: scene, safe: rect } = latest.current;
    moved.current = false;
    const world = now();
    chase.current = defaultChase();
    const goal = mode === 'top' ? topPose(arena, camera.fov, ratio) : mode === 'follow' ? chaseGoal(world) : freeViewPose(arena, scene, camera.fov, ratio, rect);
    controls.enableRotate = mode !== 'top';
    controls.mouseButtons.LEFT = mode === 'top' ? MOUSE.PAN : MOUSE.ROTATE;
    // A drag's damped momentum would carry on through the glide and past it: spend it now (without damping, update() applies what is
    // left and clears it), then glide from where that leaves the camera.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = !jump;
    if (!placed.current || jump) {
      placed.current = true;
      glide.current = null;
      camera.position.set(...goal.position);
      controls.target.set(...goal.target);
      controls.update();
    } else {
      glide.current = { from: { position: camera.position.toArray(), target: controls.target.toArray() }, to: goal, elapsed: 0 };
    }
    invalidate();
    // chaseGoal reads refs only.
  }, [mode, resetKey, controls, camera, invalidate]);

  // The HUD measured (or grown) before the learner touched the camera: the free view is framed again for it, at once.
  useEffect(() => {
    const { aspect: ratio, span: arena, free: scene } = latest.current;
    if (mode !== 'orbit' || moved.current || !placed.current || glide.current) return;
    const goal = freeViewPose(arena, scene, camera.fov, ratio, safe);
    camera.position.set(...goal.position);
    controls.target.set(...goal.target);
    controls.update();
    invalidate();
  }, [safe, mode, camera, controls, invalidate]);

  // A results card opens: the camera turns to the robot where the run left it (a glide; in "Theo xe" it is there already), and the
  // picture slides left by half the card, so that spot shows beside the card. It closes or folds: the picture slides back.
  useEffect(() => {
    const shift = lens.current;
    shift.goalX = card ? Math.max(-0.8, (card.left - 1) / 2) : 0;
    // Under the HUD as well when the slid picture's middle falls below it: halfway between the HUD and the bottom.
    const hudBottom = latest.current.safe.hud.bottom;
    shift.goalY = card && shift.goalX <= latest.current.safe.hud.right ? (hudBottom + latest.current.safe.bottom) / 2 : 0;
    if (latest.current.reducedMotion) [shift.x, shift.y] = [shift.goalX, shift.goalY];
    if (card && mode !== 'follow') {
      const [px, py, pz] = robotPoint(latest.current.view());
      const offset = new Vector3().subVectors(camera.position, controls.target);
      const to: CameraPose = { position: [px + offset.x, py + offset.y, pz + offset.z], target: [px, py, pz] };
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = !latest.current.reducedMotion;
      if (latest.current.reducedMotion) {
        camera.position.set(...to.position);
        controls.target.set(...to.target);
        controls.update();
      } else {
        glide.current = { from: { position: camera.position.toArray(), target: controls.target.toArray() }, to, elapsed: 0 };
      }
    }
    invalidate();
  }, [card, mode, camera, controls, invalidate]);

  useFrame((_, delta) => {
    // The picture's slide (a lens shift: the camera stays, the frustum moves), eased towards its goal.
    const shift = lens.current;
    if (shift.x !== shift.goalX || shift.y !== shift.goalY) {
      const share = reducedMotion ? 1 : 1 - Math.exp(-8 * Math.min(delta, 0.1));
      const ease = (now: number, goal: number) => (Math.abs(goal - now) < 1e-3 ? goal : now + (goal - now) * share);
      [shift.x, shift.y] = [ease(shift.x, shift.goalX), ease(shift.y, shift.goalY)];
      invalidate();
    }
    if (shift.x === 0 && shift.y === 0) {
      if (camera.view?.enabled) camera.clearViewOffset();
    } else {
      // A window over a frame of the same size: the camera stays, the picture moves by the slide (left and down for negative values).
      camera.setViewOffset(size.width, size.height, (-shift.x * size.width) / 2, (shift.y * size.height) / 2, size.width, size.height);
    }
    dom.dataset.lensShift = shift.x === 0 && shift.y === 0 ? '0' : `${shift.x.toFixed(2)},${shift.y.toFixed(2)}`;
    const moving = glide.current;
    if (moving) {
      moving.elapsed += Math.min(delta, 0.1);
      const k = ease(Math.min(1, moving.elapsed / GLIDE_S));
      // A glide into the chase aims at where the chase is now, the robot may be moving.
      const to = mode === 'follow' ? chaseGoal(view()) : moving.to;
      const at = (from: readonly number[], end: readonly number[], i: number) => from[i]! + (end[i]! - from[i]!) * k;
      camera.position.set(at(moving.from.position, to.position, 0), at(moving.from.position, to.position, 1), at(moving.from.position, to.position, 2));
      controls.target.set(at(moving.from.target, to.target, 0), at(moving.from.target, to.target, 1), at(moving.from.target, to.target, 2));
      if (moving.elapsed >= GLIDE_S) glide.current = null;
      invalidate();
    } else if (mode === 'follow') {
      const world = view();
      if (dragging.current) {
        // While the learner orbits, only carry the target along with the robot.
        const [px, py, pz] = robotPoint(world);
        const [dx, dy, dz] = [px - controls.target.x, py + 0.03 - controls.target.y, pz - controls.target.z];
        const share = reducedMotion ? 1 : 1 - Math.exp(-FOLLOW_RATE * Math.min(delta, 0.1));
        controls.target.set(controls.target.x + dx * share, controls.target.y + dy * share, controls.target.z + dz * share);
        camera.position.set(camera.position.x + dx * share, camera.position.y + dy * share, camera.position.z + dz * share);
      } else {
        const goal = chaseGoal(world);
        const share = reducedMotion ? 1 : 1 - Math.exp(-FOLLOW_RATE * Math.min(delta, 0.1));
        const gap = Math.hypot(goal.position[0] - camera.position.x, goal.position[1] - camera.position.y, goal.position[2] - camera.position.z) + Math.hypot(goal.target[0] - controls.target.x, goal.target[1] - controls.target.y, goal.target[2] - controls.target.z);
        if (gap > 1e-5) {
          camera.position.set(camera.position.x + (goal.position[0] - camera.position.x) * share, camera.position.y + (goal.position[1] - camera.position.y) * share, camera.position.z + (goal.position[2] - camera.position.z) * share);
          controls.target.set(controls.target.x + (goal.target[0] - controls.target.x) * share, controls.target.y + (goal.target[1] - controls.target.y) * share, controls.target.z + (goal.target[2] - controls.target.z) * share);
          if (gap * (1 - share) > 1e-4) invalidate();
        }
      }
    }
    controls.update();
  }, -1);

  return null;
}
