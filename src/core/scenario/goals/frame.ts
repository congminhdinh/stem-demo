import type { PointCm } from '../../world/arena/arena-schema';

// What a goal sees of the world on one tick (N18 R6.1, robot plan §4.6). The goals judge a run from `GoalFrame`s, never from the
// world's own `RobotSnapshot` (§4.5): R3.5 adapts a snapshot to a frame, so the goal library stays plain numbers and the physics
// engine can change without a goal noticing. Every length is in centimetres and every angle in degrees, in the arena's frame
// (arena-schema.ts: x right, y away, yaw counter-clockwise from +x).

/** The robot's shape on the floor. No goal kind reads it yet; it rides along for the replay and the overlays of R6.3. */
export type GoalFootprint =
  | { readonly kind: 'circle'; readonly radiusCm: number }
  /** A closed polygon, in the arena's frame (not the robot's), the first point not repeated. */
  | { readonly kind: 'polygon'; readonly pointsCm: readonly PointCm[] };

/** A thing standing on the floor: the point under its centre, and its heading. */
export type GoalPose = { readonly xCm: number; readonly yCm: number; readonly yawDeg: number };

/** One collider the robot touches on this tick, as the contact sensor names it. */
export type GoalContact = {
  /** The id of the collider (an arena id, or a generated one that starts with "#"). */
  readonly otherId: string;
  /**
   * Every tag of the collider: the ones the arena gives it and its kind (`wall`, `box`, `cylinder`, `object`), which build-arena.ts
   * adds. `avoid-contact { tag }` looks for its tag here.
   */
  readonly tags: readonly string[];
};

export type GoalFrame = {
  /** The simulated time of this tick, in seconds (`world.t`). Never the wall clock. */
  readonly tS: number;
  readonly robot: GoalPose & {
    /**
     * How fast the robot drives over the floor, cm/s, 0 or more (a speed, not a velocity): the speed of the middle of its wheel
     * axle, the point a two-wheel robot turns about, with a turn about any point within 1 cm of it counting as no drive (R3.5,
     * world.ts `TURN_IN_PLACE_TOLERANCE_CM`). Turning on the spot is 0, though the middle of the body (`xCm`, `yCm`, which says
     * where the robot is) moves on a small circle. It is what `stay-on-line` weighs its share of the distance by (speed × tick) and
     * what `stop-in-zone` holds under its limit (a robot spinning in place is stopped). The guard goals' reach is from `xCm`, `yCm`.
     */
    readonly speedCmS: number;
    readonly footprint: GoalFootprint;
    /**
     * Where each line sensor looks, on the floor: the centre of its spot, in the arena's frame. Left out, or empty, for a kit
     * without line sensors; a spot that is lifted off the floor is left out. `stay-on-line` reads it.
     */
    readonly lineSpotsCm?: readonly PointCm[];
  };
  /** Every arena object (`arena.objects`) by id; a goal that names an object the frame lacks treats it as nowhere. */
  readonly objects: Readonly<Record<string, GoalPose>>;
  /** What the robot touches on this tick: a contact that lasts is in each of its frames. The floor and the robot's own parts are not contacts. */
  readonly contacts: readonly GoalContact[];
  /**
   * The angle of each servo by role (`servo1`), in degrees, within its servo's range (0 to 180): R3.5's adapter snaps the arm's
   * physical angle to a thousandth of a degree and clamps it to the range, so an arm folded at 0° or held at 180° reads exactly that.
   */
  readonly servoDeg: Readonly<Record<string, number>>;
  /** Whether each LED (by role) is lit. No goal kind reads it yet. */
  readonly leds: Readonly<Record<string, boolean>>;
  /** The frequency the buzzer plays, or null when it is silent. No goal kind reads it yet. */
  readonly buzzerHz: number | null;
  /** The robot has left the arena (fallen off the ground). The run is over for the goals that depend on where things are. */
  readonly outOfArena: boolean;
};
