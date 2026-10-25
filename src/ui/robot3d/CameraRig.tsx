import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MOUSE, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { cameraLimits, topPose, type ArenaSpan, type CameraMode, type CameraPose } from './camera';
import { chaseViewPose, freeViewPose } from './camera-studio';
import { arenaToThree } from './scene-math';

// The camera of the robot lab's 3D view (N18 R4.2; R4.7 gives it depth). three's own OrbitControls (ADR 0002 §5: no drei), wired by
// hand: every change asks for a frame (the canvas draws on demand). Three views: "Tự do" (orbit; it opens low behind and beside the
// robot's start, the arena receding, camera-studio.ts), "Theo xe" (a chase camera low behind the robot that swings round as it turns;
// the learner may orbit it, and the chase keeps the angle they leave it at) and "Nhìn từ trên" (straight down, pan and zoom only).
// Going from one view to another, and "đặt lại góc nhìn" (a new `resetKey`), glides for a moment, unless the learner asked for reduced
// motion: then it jumps, and nothing eases, drifts or trails.

type CameraRigProps = {
  mode: CameraMode;
  span: ArenaSpan;
  /** The robot's start (arena cm, yaw deg): the free view is framed from behind it. */
  start: { xCm: number; yCm: number; yawDeg: number };
  view: () => RobotSnapshot;
  reducedMotion: boolean;
  /** A new value puts the current view's camera back where the view starts. */
  resetKey?: number;
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

export function CameraRig({ mode, span, start, view, reducedMotion, resetKey = 0 }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const dom = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const controls = useMemo(() => new OrbitControls(camera, dom), [camera, dom]);
  const glide = useRef<Glide | null>(null);
  const placed = useRef(false);
  const dragging = useRef(false);
  const chase = useRef<ChaseOffset>(defaultChase());
  // Read when the view changes, without being a reason to change it: a new window shape or a switch of reduced motion keeps the camera.
  const latest = useRef({ aspect, reducedMotion, view, span, start, mode });
  useEffect(() => {
    latest.current = { aspect, reducedMotion, view, span, start, mode };
  });

  useEffect(() => {
    const onChange = () => invalidate();
    const onStart = () => {
      dragging.current = true;
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
    return { position: [target[0] + forward * c + side * s, target[1] + up, target[2] - forward * s + side * c], target };
  };

  // A new view (or a reset): the camera goes to its pose (at once the first time, or with reduced motion), and the controls take its rules.
  useEffect(() => {
    const { aspect: ratio, reducedMotion: jump, view: now, span: arena, start: from } = latest.current;
    const world = now();
    chase.current = defaultChase();
    const goal = mode === 'top' ? topPose(arena, camera.fov, ratio) : mode === 'follow' ? chaseGoal(world) : freeViewPose(arena, from, camera.fov, ratio);
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

  useFrame((_, delta) => {
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
