import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MOUSE, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { cameraLimits, topPose, type ArenaSpan, type CameraMode, type CameraPose } from './camera';
import { chaseViewPose, clearSight, freeViewPose, keepOutOfProps, MIN_ROBOT_PX, VIEW_SAFE_RECT, type FreeViewScene, type SafeRect, type SightProp, type SightWall } from './camera-studio';
import type { CardEdge, HudCorner, ToolsCorner } from './hud-corner';
import { arenaToThree, type Vec3Tuple } from './scene-math';

// The camera of the robot lab's 3D view (N18 R4.2; R4.7 gives it depth). three's own OrbitControls (ADR 0002 §5: no drei), wired by
// hand: every change asks for a frame (the canvas draws on demand). Three views: "Tự do" (orbit; it opens behind and beside the
// robot's start, the arena receding, framed clear of the HUD and the view tools, camera-studio.ts), "Theo xe" (a chase camera behind
// the robot that swings round as it turns and stays inside the arena's walls; the learner may orbit it, and the chase keeps the angle
// they leave it at) and "Nhìn từ trên" (straight down, pan and zoom only).
// Going from one view to another, "đặt lại góc nhìn" (a new `resetKey`) and the start of a replay glide for a moment, unless the
// learner asked for reduced motion: then it jumps, and nothing eases, drifts or trails. A check's results card turns the camera to the
// robot's end spot; when the card folds or closes, the camera glides back to where it was, unless the learner moved it meanwhile.

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
  /** The arena's walls: the chase camera stays inside them. */
  walls?: readonly SightWall[];
  /** The arena's fixed bodies and hanging dressing: the chase camera never goes into one, even orbited low (fix round 2). */
  props?: readonly SightProp[];
  /** The check's open results card (NDC): while it is open, the camera looks at the robot and its picture slides left, so the
   * robot's end spot shows in the part of the view the card leaves. */
  card?: CardEdge | null;
  /** The view tools' corner (NDC, bottom left): the free view frames the robot and its start clear of it. */
  tools?: ToolsCorner | null;
  /** A replay of a check's round is under way: when one starts, the camera goes back to frame the view's start. */
  replaying?: boolean;
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

export function CameraRig({ mode, span, free, view, reducedMotion, resetKey = 0, hud = null, walls = [], props = [], card = null, tools = null, replaying = false }: CameraRigProps) {
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
  /** Where the camera was when a results card opened, in which view, and whether the learner has moved it since. */
  const beforeCard = useRef<{ pose: CameraPose; mode: CameraMode } | null>(null);
  const movedSinceCard = useRef(false);
  const wasReplaying = useRef(false);
  // Read when the view changes, without being a reason to change it: a new window shape or a switch of reduced motion keeps the camera.
  // A HUD or tools corner that would take most of the view is held back (the free view then frames under part of it).
  const safe = useMemo<SafeRect>(
    () => ({
      ...VIEW_SAFE_RECT,
      ...(hud ? { hud: { right: Math.min(0.9, hud.right), bottom: Math.max(-0.2, hud.bottom) } } : {}),
      ...(tools ? { tools: { right: Math.min(0.2, tools.right), top: Math.min(0.2, tools.top) } } : {}),
    }),
    [hud, tools],
  );
  const minRobot = (2 * MIN_ROBOT_PX) / Math.max(1, size.width);
  const latest = useRef({ aspect, reducedMotion, view, span, free, mode, safe, walls, props, minRobot });
  useEffect(() => {
    latest.current = { aspect, reducedMotion, view, span, free, mode, safe, walls, props, minRobot };
  });

  useEffect(() => {
    const onChange = () => invalidate();
    const onStart = () => {
      dragging.current = true;
      moved.current = true;
      movedSinceCard.current = true;
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

  /** Where the chase camera wants to be for `world`: inside the arena's walls (clearSight). */
  const chaseGoal = (world: RobotSnapshot): CameraPose => {
    const [px, py, pz] = robotPoint(world);
    const yaw = robotYaw(world);
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const { forward, up, side, ahead } = chase.current;
    const target: Vec3Tuple = [px + ahead * c, py + 0.03, pz - ahead * s];
    const inside = clearSight({ position: [target[0] + forward * c + side * s, target[1] + up, target[2] - forward * s + side * c], target }, latest.current.walls, [px, py + 0.03, pz]);
    return { position: keepOutOfProps(inside.position, latest.current.props), target: inside.target };
  };

  /** Where the view `mode` starts. */
  const startPose = (mode: CameraMode): CameraPose => {
    const { aspect: ratio, view: now, span: arena, free: scene, safe: rect, minRobot: least } = latest.current;
    return mode === 'top' ? topPose(arena, camera.fov, ratio) : mode === 'follow' ? chaseGoal(now()) : freeViewPose(arena, scene, camera.fov, ratio, rect, least);
  };

  /** Sends the camera to `goal`: a glide, or at once (the first time, with reduced motion). */
  const goTo = (goal: CameraPose) => {
    const jump = latest.current.reducedMotion;
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
  };

  // A new view (or a reset): the camera goes to its pose, and the controls take its rules.
  useEffect(() => {
    moved.current = false;
    movedSinceCard.current = true;
    chase.current = defaultChase();
    controls.enableRotate = mode !== 'top';
    controls.mouseButtons.LEFT = mode === 'top' ? MOUSE.PAN : MOUSE.ROTATE;
    goTo(startPose(mode));
    // startPose and goTo read refs only.
  }, [mode, resetKey, controls, camera, invalidate]);

  // A replay starts: the camera goes back to where the view starts, so the robot is framed at its start (the results card that turned
  // it to the end spot has folded).
  useEffect(() => {
    if (replaying && !wasReplaying.current && placed.current) {
      moved.current = false;
      beforeCard.current = null;
      chase.current = defaultChase();
      goTo(startPose(mode));
    }
    wasReplaying.current = replaying;
    // startPose and goTo read refs only; a new view while it replays is the view's own effect.
  }, [replaying]);

  // The HUD or the view tools measured (or grown) before the learner touched the camera: the free view is framed again for them, at once.
  useEffect(() => {
    const { aspect: ratio, span: arena, free: scene, minRobot: least } = latest.current;
    if (mode !== 'orbit' || moved.current || !placed.current || glide.current) return;
    const goal = freeViewPose(arena, scene, camera.fov, ratio, safe, least);
    camera.position.set(...goal.position);
    controls.target.set(...goal.target);
    controls.update();
    invalidate();
  }, [safe, mode, camera, controls, invalidate]);

  // A results card opens: the camera turns to the robot where the run left it (a glide; in "Theo xe" it is there already), and the
  // picture slides left by half the card, so that spot shows beside the card. It folds or closes: the picture slides back, and the camera
  // glides back to where it was when the card opened, unless the learner has moved it since (or chose another view).
  useEffect(() => {
    const shift = lens.current;
    shift.goalX = card ? Math.max(-0.8, (card.left - 1) / 2) : 0;
    // Under the HUD as well when the slid picture's middle falls below it: halfway between the HUD and the bottom.
    const hudBottom = latest.current.safe.hud.bottom;
    shift.goalY = card && shift.goalX <= latest.current.safe.hud.right ? (hudBottom + latest.current.safe.bottom) / 2 : 0;
    if (latest.current.reducedMotion) [shift.x, shift.y] = [shift.goalX, shift.goalY];
    if (card) {
      if (!beforeCard.current) {
        beforeCard.current = { pose: { position: camera.position.toArray(), target: controls.target.toArray() }, mode };
        movedSinceCard.current = false;
      }
      if (mode !== 'follow') {
        const [px, py, pz] = robotPoint(latest.current.view());
        const offset = new Vector3().subVectors(camera.position, controls.target);
        goTo({ position: [px + offset.x, py + offset.y, pz + offset.z], target: [px, py, pz] });
      }
    } else if (beforeCard.current) {
      const back = beforeCard.current;
      beforeCard.current = null;
      if (!movedSinceCard.current && back.mode === mode && mode !== 'follow') goTo(back.pose);
    }
    invalidate();
    // goTo reads refs only.
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
    // "Theo xe" orbited low by the learner: never inside a prop (the gate, a block, the gantry's beam).
    if (mode === 'follow') {
      const [x, y, z] = keepOutOfProps([camera.position.x, camera.position.y, camera.position.z], props);
      if (y !== camera.position.y) camera.position.set(x, y, z);
    }
  }, -1);

  return null;
}
