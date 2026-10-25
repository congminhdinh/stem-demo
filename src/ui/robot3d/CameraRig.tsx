import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MOUSE, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { cameraLimits, chasePose, overviewPose, topPose, type ArenaSpan, type CameraMode, type CameraPose } from './camera';
import { arenaToThree } from './scene-math';

// The camera of the robot lab's 3D view (N18 R4.2; R4.3 refines it). three's own OrbitControls (ADR 0002 §5: no drei), wired by hand:
// every change asks for a frame (the canvas draws on demand). Three views: "Tự do" (orbit, the overview a lab opens on), "Theo xe" (the
// target follows the robot, the learner may still orbit around it) and "Nhìn từ trên" (straight down, pan and zoom only). Going from
// one view to another glides for a moment, unless the learner asked for reduced motion: then it jumps, and nothing eases or drifts.

type CameraRigProps = {
  mode: CameraMode;
  span: ArenaSpan;
  view: () => RobotSnapshot;
  reducedMotion: boolean;
};

/** How long the camera glides from one view to the next, s. */
const GLIDE_S = 0.45;
/** How fast "Theo xe" catches up with the robot: the share of the gap closed per second, as a rate. */
const FOLLOW_RATE = 6;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

type Glide = { from: CameraPose; to: CameraPose; elapsed: number };

/** The robot's origin in three's frame (m): on the floor under the middle of its body. */
const robotPoint = (world: RobotSnapshot) => arenaToThree(world.robot.xCm, world.robot.yCm, world.robot.zCm);

export function CameraRig({ mode, span, view, reducedMotion }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const dom = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const controls = useMemo(() => new OrbitControls(camera, dom), [camera, dom]);
  const glide = useRef<Glide | null>(null);
  const placed = useRef(false);
  // Read when the view changes, without being a reason to change it: a new window shape or a switch of reduced motion keeps the camera.
  const latest = useRef({ aspect, reducedMotion, view, span });
  useEffect(() => {
    latest.current = { aspect, reducedMotion, view, span };
  });

  useEffect(() => {
    const onChange = () => invalidate();
    controls.addEventListener('change', onChange);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.dispose();
    };
  }, [controls, invalidate]);

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

  // A new view: the camera goes to its pose (at once the first time, or with reduced motion), and the controls take its rules.
  useEffect(() => {
    const { aspect: ratio, reducedMotion: jump, view: now, span: arena } = latest.current;
    const world = now();
    const goal =
      mode === 'top'
        ? topPose(arena, camera.fov, ratio)
        : mode === 'follow'
          ? chasePose(robotPoint(world), (world.robot.yawDeg * Math.PI) / 180)
          : overviewPose(arena, camera.fov, ratio);
    controls.enableRotate = mode !== 'top';
    controls.mouseButtons.LEFT = mode === 'top' ? MOUSE.PAN : MOUSE.ROTATE;
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
  }, [mode, controls, camera, invalidate]);

  useFrame((_, delta) => {
    const moving = glide.current;
    if (moving) {
      moving.elapsed += Math.min(delta, 0.1);
      const k = ease(Math.min(1, moving.elapsed / GLIDE_S));
      const at = (from: readonly number[], to: readonly number[], i: number) => from[i]! + (to[i]! - from[i]!) * k;
      camera.position.set(at(moving.from.position, moving.to.position, 0), at(moving.from.position, moving.to.position, 1), at(moving.from.position, moving.to.position, 2));
      controls.target.set(at(moving.from.target, moving.to.target, 0), at(moving.from.target, moving.to.target, 1), at(moving.from.target, moving.to.target, 2));
      if (moving.elapsed >= GLIDE_S) glide.current = null;
      invalidate();
    } else if (mode === 'follow') {
      const [px, py, pz] = robotPoint(view());
      const [x, y, z] = [px, py + 0.03, pz];
      const share = reducedMotion ? 1 : 1 - Math.exp(-FOLLOW_RATE * Math.min(delta, 0.1));
      const [dx, dy, dz] = [(x - controls.target.x) * share, (y - controls.target.y) * share, (z - controls.target.z) * share];
      controls.target.set(controls.target.x + dx, controls.target.y + dy, controls.target.z + dz);
      camera.position.set(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
      if (Math.hypot(x - controls.target.x, y - controls.target.y, z - controls.target.z) > 1e-4) invalidate();
    }
    controls.update();
  }, -1);

  return null;
}
