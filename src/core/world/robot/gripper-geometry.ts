// The gripper's shapes the kit does not name (ADR 0004 §2), in one place without Rapier: the world builds its colliders from them
// (gripper.ts) and the robot's footprint sweeps them (footprint.ts, which the UI's placement check reaches, so it must not load physics).

/** The carriage box (it holds the claw servo), half extents in the carriage frame, cm. Geometry the kit does not name (ADR 0004 §2). */
export const CARRIAGE_HALF_CM: Readonly<{ u: number; v: number; w: number }> = Object.freeze({ u: 0.5, v: 2.6, w: 0.6 });
/** A boom side plate's half extents across (y) and up, cm; it runs the boom's length. Geometry the kit does not name (ADR 0004 §2). */
export const BOOM_PLATE_HALF_CM: Readonly<{ across: number; up: number }> = Object.freeze({ across: 0.2, up: 0.5 });
/** The boom's cross bar at the tip: half its square section, cm; it spans both plates. Geometry the kit does not name (ADR 0004 §2). */
export const BOOM_BAR_HALF_CM = 0.3;
