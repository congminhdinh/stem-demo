import type { RobotSnapshot } from '../../core/world/snapshot';
import { sameCasters } from './scene-math';

// N18 P2: when the 3D view's key light draws its shadow map again (Scene.tsx ShadowsOnChange, the high tier): on a frame where something
// that casts a shadow has moved since the map was last drawn (the robot, its wheels and servo, the moving bodies: `sameCasters`, to
// within a pixel), and on the first frame after the scene changed; not on a frame where only the camera moved (an orbit, a glide, the
// zones' tags laid out again) or an LED blinked. On the high tier the shadow pass is 49–54 draws and 0.2–0.5 ms of a frame.

export type ShadowWatch = {
  /** The scene changed (a commit of what it draws, a restored context): the next frame draws the shadow map. */
  changed(): void;
  /** Whether the frame that shows `world` draws the shadow map. */
  frame(world: RobotSnapshot): boolean;
};

export function createShadowWatch(): ShadowWatch {
  let drawnFor: RobotSnapshot | null = null;
  let dirty = true;
  return {
    changed() {
      dirty = true;
    },
    frame(world) {
      if (!dirty && sameCasters(drawnFor, world)) return false;
      dirty = false;
      drawnFor = world;
      return true;
    },
  };
}
