import { fitCameraDistance, type Vec3Tuple } from './scene-math';

// The camera of the robot lab's 3D view (N18 R4.2; R4.3 refines it): where each of its views puts the camera and what it looks at, and
// the limits of the free orbit. Plain numbers in three's frame (m, +Y up, arena y along −Z), tested exactly; CameraRig.tsx moves the
// camera to them.

export type CameraMode = 'orbit' | 'follow' | 'top';

export type CameraPose = { position: Vec3Tuple; target: Vec3Tuple };

export type ArenaSpan = { widthM: number; depthM: number };

/** The overview's angles: 52° above the floor, from the learner's side (+Z), turned 14° to the left. */
const OVERVIEW_ELEVATION = (52 * Math.PI) / 180;
const OVERVIEW_AZIMUTH = (14 * Math.PI) / 180;
/** The height of the arena's walls the overview keeps in sight, m. */
const OVERVIEW_WALL_M = 0.1;
/** The top view leaves a margin around the arena. */
const TOP_MARGIN = 1.08;
/** "Theo xe": this far behind the robot and this high, looking at a point this high on it. */
const CHASE_BACK_M = 0.46;
const CHASE_UP_M = 0.3;
const CHASE_LOOK_UP_M = 0.03;

const centreOf = (span: ArenaSpan): Vec3Tuple => [span.widthM / 2, 0, 0 - span.depthM / 2];

/** The share of the screen (from its middle to an edge) the overview gives the arena: room is left for the HUD and the buttons. */
const OVERVIEW_FILL = 0.9;

/**
 * The least distance at which a camera looking at `target` from the unit direction `toCamera` sees every one of `points` inside
 * `fill` of the screen (a field of `fovDeg` high, `aspect` wide), found by bisection on the projected corners.
 */
export function fitPointsDistance(points: readonly Vec3Tuple[], target: Vec3Tuple, toCamera: Vec3Tuple, fovDeg: number, aspect: number, fill: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360) * fill;
  const tanH = tanV * aspect;
  // The camera's axes: forward (towards the target), right and up on the screen.
  const forward: Vec3Tuple = [-toCamera[0], -toCamera[1], -toCamera[2]];
  // right = forward × (0, 1, 0), up = right × forward: the screen's axes of a camera whose up is +Y.
  const across = Math.hypot(forward[0], forward[2]) || 1;
  const right: Vec3Tuple = [-forward[2] / across, 0, forward[0] / across];
  const up: Vec3Tuple = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const fits = (distance: number) =>
    points.every((point) => {
      const relative = [point[0] - target[0] - toCamera[0] * distance, point[1] - target[1] - toCamera[1] * distance, point[2] - target[2] - toCamera[2] * distance];
      const depth = relative[0]! * forward[0] + relative[1]! * forward[1] + relative[2]! * forward[2];
      const x = relative[0]! * right[0] + relative[1]! * right[1] + relative[2]! * right[2];
      const y = relative[0]! * up[0] + relative[1]! * up[1] + relative[2]! * up[2];
      return depth > 0 && Math.abs(x) <= depth * tanH && Math.abs(y) <= depth * tanV;
    });
  let [near, far] = [0, 1];
  while (!fits(far)) far *= 2;
  for (let i = 0; i < 48; i++) {
    const middle = (near + far) / 2;
    if (fits(middle)) far = middle;
    else near = middle;
  }
  return far;
}

/** The view a lab opens on: the whole arena (its floor and the walls' height) as large as the screen allows, from above the learner's side. */
export function overviewPose(span: ArenaSpan, fovDeg: number, aspect: number): CameraPose {
  const target = centreOf(span);
  const toCamera: Vec3Tuple = [-Math.cos(OVERVIEW_ELEVATION) * Math.sin(OVERVIEW_AZIMUTH), Math.sin(OVERVIEW_ELEVATION), Math.cos(OVERVIEW_ELEVATION) * Math.cos(OVERVIEW_AZIMUTH)];
  const corners: Vec3Tuple[] = [];
  for (const x of [0, span.widthM]) for (const z of [0, -span.depthM]) for (const y of [0, OVERVIEW_WALL_M]) corners.push([x, y, z]);
  const distance = fitPointsDistance(corners, target, toCamera, fovDeg, aspect, OVERVIEW_FILL);
  return { position: [target[0] + toCamera[0] * distance, target[1] + toCamera[1] * distance, target[2] + toCamera[2] * distance], target };
}

/**
 * "Nhìn từ trên": straight down on the middle of the arena, high enough for its whole width and depth. The camera is a hair towards the
 * learner's side (+Z), so that up on the screen is the arena's far side (+y) and right is +x, as on the floor plan.
 */
export function topPose(span: ArenaSpan, fovDeg: number, aspect: number): CameraPose {
  const target = centreOf(span);
  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const height = Math.max(span.depthM / 2 / Math.tan(vertical / 2), span.widthM / 2 / Math.tan(horizontal / 2)) * TOP_MARGIN;
  return { position: [target[0], height, target[2] + height * 1e-4], target };
}

/** "Theo xe": behind the robot at `robot` (three's frame, m) facing `yawRad` (arena yaw), above it, looking at it. */
export function chasePose(robot: Vec3Tuple, yawRad: number): CameraPose {
  const target: Vec3Tuple = [robot[0], robot[1] + CHASE_LOOK_UP_M, robot[2]];
  // The robot's forward in three is (cos yaw, 0, −sin yaw): behind it is the opposite way.
  return { position: [target[0] - Math.cos(yawRad) * CHASE_BACK_M, target[1] + CHASE_UP_M, target[2] + Math.sin(yawRad) * CHASE_BACK_M], target };
}

/** The free orbit's limits: above the floor (85° at most from straight down), close enough to see the robot, never far from the arena. */
export function cameraLimits(span: ArenaSpan, fovDeg: number, aspect: number) {
  return {
    minDistance: 0.12,
    maxDistance: fitCameraDistance(span, fovDeg, aspect) * 3,
    maxPolarAngle: Math.PI * 0.47,
    /** The target stays within this of the arena's middle (OrbitControls' `cursor` and `maxTargetRadius`). */
    cursor: centreOf(span),
    maxTargetRadius: Math.hypot(span.widthM, span.depthM) / 2 + 0.1,
  };
}
