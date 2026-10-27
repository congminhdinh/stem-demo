// The grasp's numbers that a view words too, in a module with no Rapier (N19 final fix, G2 M3; as gripper-geometry.ts holds the shapes):
// grasp.ts judges the world by them, and the "Cổng & chân" tab says the claw open or closed by them (ui/robot3d/pin-text.ts), which must
// not load physics.

/**
 * Release (and the latch after a break) at a claw command of θc less this, degrees; nothing attaches to a claw under it (plan §4.6 rule 5),
 * so the pins tab calls a claw under it open.
 */
export const RELEASE_HYSTERESIS_DEG = 6;
